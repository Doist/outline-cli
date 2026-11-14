import { randomUUID } from 'node:crypto'
import { createWriteStream, openAsBlob } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { type Tokens, marked } from 'marked'
import { apiRequest, authorizedFetch, toApiError } from './api.js'
import { CliError } from './errors.js'

export interface Attachment {
    id: string
    name: string
    contentType: string
    size: number
    documentId: string | null
    url: string
}

/** Response of `attachments.create`; servers before upload modes omit `mode`. */
interface CreateAttachmentResponse {
    mode?: 'post' | 'put'
    uploadUrl?: string
    form?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    attachment: Attachment
}

/** An attachment or image linked from a document's markdown. */
export interface LinkedAttachment {
    id: string
    name: string
    /** Size in bytes from the link label (file attachments only). */
    size: number | null
    type: 'image' | 'file'
    url: string
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const UUID_RE = new RegExp(`^${UUID}$`)
const REDIRECT_ID_RE = new RegExp(`attachments\\.redirect\\?(?:[^#\\s)]*&)?id=(${UUID})`)
const MAX_REDIRECTS = 5

const CONTENT_TYPES: Record<string, string> = {
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.gif': 'image/gif',
    '.gz': 'application/gzip',
    '.heic': 'image/heic',
    '.htm': 'text/html',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.svg': 'image/svg+xml',
    '.tar': 'application/x-tar',
    '.txt': 'text/plain',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
}

/** Guess a content type from a file name; unknown extensions are binary. */
export function guessContentType(name: string): string {
    return CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/** The path Outline uses in document markdown to link an attachment. */
export function attachmentPath(id: string): string {
    return `/api/attachments.redirect?id=${id}`
}

/**
 * Markdown that Outline renders as the attachment: an image for image types,
 * otherwise a file attachment, whose link label is `<name> <size in bytes>`.
 * Brackets and backslashes are dropped from the label rather than escaped:
 * Outline's attachment rule reads only the first text token of the label, so
 * an escaped `\[` cuts the stored title short. The file keeps its real name.
 */
export function attachmentMarkdown(attachment: Attachment): string {
    const path = attachmentPath(attachment.id)
    const name = attachment.name.replace(/[[\]\\]/g, '')
    if (attachment.contentType.startsWith('image/')) {
        return `![${name}](${path})`
    }
    return `[${name} ${attachment.size}](${path})`
}

/**
 * Extract an attachment ID from a UUID, an `attachments.redirect` path, or a
 * full URL containing one.
 */
export function parseAttachmentId(ref: string): string {
    const trimmed = ref.trim()
    if (UUID_RE.test(trimmed)) return trimmed.toLowerCase()
    const match = trimmed.match(REDIRECT_ID_RE)
    if (match) return match[1].toLowerCase()
    throw new CliError('INVALID_ATTACHMENT', `Not an attachment ID or link: "${ref}".`, [
        'Pass the attachment ID, or a link containing /api/attachments.redirect?id=<id>',
        'Run ol attachment list --doc <ref> to see the attachments in a document',
    ])
}

/**
 * Find the attachments and images a document links to, in order of first
 * appearance. Outline writes file attachments as `[<name> <bytes>](<link>)`
 * and images as `![<alt>](<link>)`. The markdown is tokenized rather than
 * scanned with a regex, so escaped or nested brackets in a label are read
 * correctly and links inside inline or fenced code are not counted.
 */
export function extractLinkedAttachments(markdown: string): LinkedAttachment[] {
    const seen = new Set<string>()
    const result: LinkedAttachment[] = []
    marked.walkTokens(marked.lexer(markdown), (token) => {
        if (token.type !== 'link' && token.type !== 'image') return
        const { href, text } = token as Tokens.Link | Tokens.Image
        const match = href.match(REDIRECT_ID_RE)
        if (!match) return
        const id = match[1].toLowerCase()
        if (seen.has(id)) return
        seen.add(id)
        if (token.type === 'image') {
            result.push({ id, name: text, size: null, type: 'image', url: href })
            return
        }
        const label = text.trim()
        const sizeMatch = label.match(/^(.+) (\d+)$/)
        result.push({
            id,
            name: sizeMatch ? sizeMatch[1] : label,
            size: sizeMatch ? Number(sizeMatch[2]) : null,
            type: 'file',
            url: href,
        })
    })
    return result
}

/** Escape a multipart header value the way browsers do (WHATWG HTML form encoding). */
function escapeMultipartValue(value: string): string {
    return value.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
}

/**
 * Encode form fields plus one file as a `multipart/form-data` body.
 *
 * The body is a `Blob` rather than a `FormData` because requests go through
 * the bundled undici `fetch` (see `http-dispatcher.ts`), which does not accept
 * Node's global `FormData` and would send it as the string
 * `[object FormData]`. A `Blob` assembled from the file's lazy `Blob` is
 * accepted by both `fetch` implementations, keeps a known `Content-Length`
 * (presigned S3 POSTs reject chunked bodies), and is never read into memory.
 */
export function buildMultipartBody(
    fields: Record<string, string>,
    file: { field: string; name: string; contentType: string; blob: Blob },
): { body: Blob; contentType: string } {
    const boundary = `----olFormBoundary${randomUUID().replace(/-/g, '')}`
    const parts: (string | Blob)[] = []
    for (const [key, value] of Object.entries(fields)) {
        parts.push(
            `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(key)}"\r\n\r\n${value}\r\n`,
        )
    }
    parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(file.field)}"; filename="${escapeMultipartValue(file.name)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        file.blob,
        `\r\n--${boundary}--\r\n`,
    )
    return { body: new Blob(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

export type UploadOptions = {
    filePath: string
    documentId: string
    name?: string
    contentType?: string
}

/**
 * Upload a local file as an attachment of a document: register it with
 * `attachments.create`, then send the bytes to the upload target Outline
 * returns (its own `files.create` endpoint for local storage, or a presigned
 * S3 POST/PUT). A failed transfer deletes the registered attachment.
 */
export async function uploadAttachment(opts: UploadOptions): Promise<Attachment> {
    let size: number
    try {
        const info = await stat(opts.filePath)
        if (!info.isFile()) throw new Error('not a file')
        size = info.size
    } catch {
        throw new CliError('FILE_NOT_FOUND', `File not found: ${opts.filePath}`, [
            'Pass the path of an existing file',
        ])
    }

    const name = opts.name ?? basename(opts.filePath)
    const contentType = opts.contentType ?? guessContentType(name)

    const { data } = await apiRequest<CreateAttachmentResponse>('attachments.create', {
        name,
        documentId: opts.documentId,
        contentType,
        size,
        preset: 'documentAttachment',
    })

    try {
        const blob = await openAsBlob(opts.filePath, { type: contentType })
        let response: Response
        if (data.mode === 'put') {
            if (!data.url) throw new Error('Outline did not return an upload URL')
            ;({ response } = await authorizedFetch(data.url, {
                method: 'PUT',
                headers: { 'Content-Type': contentType, ...data.headers },
                body: blob,
            }))
        } else {
            if (!data.uploadUrl) throw new Error('Outline did not return an upload URL')
            const multipart = buildMultipartBody(data.form ?? {}, {
                field: 'file',
                name,
                contentType,
                blob,
            })
            ;({ response } = await authorizedFetch(data.uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': multipart.contentType },
                body: multipart.body,
            }))
        }
        if (!response.ok) throw await toApiError(response)
    } catch (error) {
        try {
            await apiRequest('attachments.delete', { id: data.attachment.id })
        } catch {}
        const message = error instanceof Error ? error.message : String(error)
        throw new CliError('UPLOAD_FAILED', `Upload of ${name} failed: ${message}`)
    }

    return { ...data.attachment, size }
}

/**
 * File name from a `Content-Disposition` header, preferring the RFC 5987
 * `filename*` form. Only the base name is kept so a header cannot direct the
 * download outside the chosen folder.
 */
export function fileNameFromDisposition(header: string | null): string | undefined {
    if (!header) return undefined
    let name: string | undefined
    const extended = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/)
    if (extended) {
        try {
            name = decodeURIComponent(extended[1].trim())
        } catch {}
    }
    if (!name) {
        const plain = header.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"|filename\s*=\s*([^;]+)/)
        name = plain ? (plain[1] ?? plain[2])?.replace(/\\(.)/g, '$1').trim() : undefined
    }
    if (!name) return undefined
    const base = basename(name.replace(/\\/g, '/'))
    return base && base !== '.' && base !== '..' ? base : undefined
}

export type DownloadTarget = {
    /** `-` for stdout, an existing directory, or a file path; defaults to the current directory. */
    output?: string
    force?: boolean
}

export type DownloadResult = {
    id: string
    name: string
    /** Written path, or `-` for stdout. */
    path: string
    size: number
}

/**
 * Open the attachment's content. `attachments.redirect` answers with a
 * redirect to a signed URL; redirects are followed by hand so the bearer
 * token is only sent to the Outline instance itself.
 */
async function openAttachment(id: string): Promise<Response> {
    let url = attachmentPath(id)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const { response, baseUrl } = await authorizedFetch(url, {
            method: 'GET',
            redirect: 'manual',
        })
        const location = response.headers.get('location')
        if (response.status >= 300 && response.status < 400 && location) {
            url = new URL(location, new URL(url, `${baseUrl}/`)).toString()
            continue
        }
        if (!response.ok) throw await toApiError(response)
        return response
    }
    throw new Error(`Too many redirects downloading attachment ${id}`)
}

async function resolveOutputPath(output: string | undefined, name: string): Promise<string> {
    if (!output) return name
    try {
        if ((await stat(output)).isDirectory()) return join(output, name)
    } catch {}
    return output
}

/** Download an attachment to a file (or stdout when `output` is `-`). */
export async function downloadAttachment(
    ref: string,
    target: DownloadTarget = {},
): Promise<DownloadResult> {
    const id = parseAttachmentId(ref)
    let response: Response
    try {
        response = await openAttachment(id)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new CliError('DOWNLOAD_FAILED', `Download of attachment ${id} failed: ${message}`)
    }
    const name = fileNameFromDisposition(response.headers.get('content-disposition')) ?? id
    if (!response.body) {
        throw new CliError('DOWNLOAD_FAILED', `Attachment ${id} returned no content.`)
    }
    const webBody = response.body as WebReadableStream<Uint8Array>
    // Wrap the body only right before piping it: a Node stream that errors
    // while nothing listens (e.g. during the awaits below) is an uncaught error.
    const toNode = () => Readable.fromWeb(webBody)
    let size = 0
    // Count bytes inside the pipeline: a 'data' listener would switch the
    // stream to flowing mode and drop chunks emitted before the pipe is set up.
    async function* countBytes(source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
            size += chunk.length
            yield chunk
        }
    }

    if (target.output === '-') {
        await pipeline(toNode(), countBytes, process.stdout, { end: false })
        return { id, name, path: '-', size }
    }

    const path = await resolveOutputPath(target.output, name)
    // Only a file this download created or opened may be removed on failure;
    // a failure before the open (the response stream erroring first) must
    // never touch a file that was already there.
    const existedBefore = await stat(path).then(
        () => true,
        () => false,
    )
    const destination = createWriteStream(path, { flags: target.force ? 'w' : 'wx' })
    let opened = false
    destination.once('open', () => {
        opened = true
    })
    try {
        await pipeline(toNode(), countBytes, destination)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new CliError('FILE_EXISTS', `File already exists: ${path}`, [
                'Use --force to overwrite it, or --output to choose another path',
            ])
        }
        // Do not leave a partial file behind.
        if (opened || !existedBefore) await unlink(path).catch(() => {})
        const message = error instanceof Error ? error.message : String(error)
        throw new CliError('DOWNLOAD_FAILED', `Download of attachment ${id} failed: ${message}`)
    }
    return { id, name, path, size }
}
