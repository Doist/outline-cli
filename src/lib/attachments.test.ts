import { mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    authorizedFetch: vi.fn(),
    toApiError: vi.fn(async (res: Response) => new Error(`API error: ${res.status}`)),
}))

vi.mock('./api.js', () => apiMocks)

const ID = '3e7bbd8c-907b-4b10-9160-9b820d5ce255'
const DOC_ID = 'dfb46f8e-4d2d-4c7e-b478-4f07d2c34f18'
const BASE = 'https://test.outline.com'

function attachment(overrides: Record<string, unknown> = {}) {
    return {
        id: ID,
        name: 'note.txt',
        contentType: 'text/plain',
        size: 5,
        documentId: DOC_ID,
        url: `/api/files.get?key=uploads/${ID}/note.txt`,
        ...overrides,
    }
}

describe('attachment helpers', () => {
    it('parses IDs from UUIDs, redirect paths and full URLs', async () => {
        const { parseAttachmentId } = await import('./attachments.js')
        expect(parseAttachmentId(ID.toUpperCase())).toBe(ID)
        expect(parseAttachmentId(`/api/attachments.redirect?id=${ID}`)).toBe(ID)
        expect(parseAttachmentId(`${BASE}/api/attachments.redirect?foo=1&id=${ID}`)).toBe(ID)
        expect(() => parseAttachmentId('nonsense')).toThrow('Not an attachment ID or link')
    })

    it('builds image markdown for images and sized links for files', async () => {
        const { attachmentMarkdown } = await import('./attachments.js')
        expect(attachmentMarkdown(attachment({ contentType: 'image/png', name: 'a.png' }))).toBe(
            `![a.png](/api/attachments.redirect?id=${ID})`,
        )
        expect(attachmentMarkdown(attachment({ name: 'a [draft].pdf', size: 1234 }))).toBe(
            `[a draft.pdf 1234](/api/attachments.redirect?id=${ID})`,
        )
    })

    it('extracts linked attachments and images once each, in order', async () => {
        const { extractLinkedAttachments } = await import('./attachments.js')
        const other = '0d4fff26-6b65-4873-ae45-a79647413550'
        const text = [
            'Intro [a normal link](https://example.com)',
            `[Door schedule rev B.pdf 3000](/api/attachments.redirect?id=${ID})`,
            ` ![dot.png](${BASE}/api/attachments.redirect?id=${other} "title")`,
            `[again 1](/api/attachments.redirect?id=${ID})`,
            `[no size](/api/attachments.redirect?id=${other.replace('0d', '1d')})`,
        ].join('\n\n')

        expect(extractLinkedAttachments(text)).toEqual([
            {
                id: ID,
                name: 'Door schedule rev B.pdf',
                size: 3000,
                type: 'file',
                url: `/api/attachments.redirect?id=${ID}`,
            },
            {
                id: other,
                name: 'dot.png',
                size: null,
                type: 'image',
                url: `${BASE}/api/attachments.redirect?id=${other}`,
            },
            {
                id: other.replace('0d', '1d'),
                name: 'no size',
                size: null,
                type: 'file',
                url: `/api/attachments.redirect?id=${other.replace('0d', '1d')}`,
            },
        ])
    })

    it('reads escaped and nested brackets in labels', async () => {
        const { extractLinkedAttachments } = await import('./attachments.js')
        const other = ID.replace('3e', '4e')
        const text = [
            `[plan \\[final\\].pdf 12](/api/attachments.redirect?id=${ID})`,
            `![dot [x] y](/api/attachments.redirect?id=${other})`,
        ].join('\n\n')
        expect(extractLinkedAttachments(text).map((a) => [a.name, a.size, a.type])).toEqual([
            ['plan [final].pdf', 12, 'file'],
            ['dot [x] y', null, 'image'],
        ])
    })

    it('ignores attachment links inside inline and fenced code', async () => {
        const { extractLinkedAttachments } = await import('./attachments.js')
        const link = `[example 1](/api/attachments.redirect?id=${ID})`
        const text = ['`' + link + '`', '```', link, '```', '    ' + link].join('\n\n')
        expect(extractLinkedAttachments(text)).toEqual([])
    })

    it('reads file names from Content-Disposition, keeping only the base name', async () => {
        const { fileNameFromDisposition } = await import('./attachments.js')
        expect(fileNameFromDisposition('attachment; filename="a b.pdf"')).toBe('a b.pdf')
        expect(
            fileNameFromDisposition(
                `inline; filename="x.pdf"; filename*=UTF-8''%E9%97%A8%E8%A1%A8.pdf`,
            ),
        ).toBe('门表.pdf')
        expect(fileNameFromDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd')
        expect(fileNameFromDisposition('attachment; filename=".."')).toBeUndefined()
        expect(fileNameFromDisposition(null)).toBeUndefined()
    })

    it('strips control characters from server-supplied names', async () => {
        const { fileNameFromDisposition, sanitizeFileName } = await import('./attachments.js')
        expect(fileNameFromDisposition('attachment; filename="\u001b[31mred.txt"')).toBe(
            '[31mred.txt',
        )
        expect(sanitizeFileName('a\u0000b\u007fc\n.txt')).toBe('abc.txt')
        expect(sanitizeFileName('\u001b')).toBeUndefined()
    })

    it('falls back to the storage key in the served URL for the file name', async () => {
        const { fileNameFromUrl } = await import('./attachments.js')
        expect(
            fileNameFromUrl(
                'https://bucket.s3.amazonaws.com/uploads/u1/a1/Site%20plan.pdf?X-Amz-Signature=s',
            ),
        ).toBe('Site plan.pdf')
        expect(fileNameFromUrl(`${BASE}/api/files.get?key=uploads/u1/a1/a%25b.pdf`)).toBe('a%b.pdf')
        expect(fileNameFromUrl(`${BASE}/api/files.get?sig=signed`)).toBeUndefined()
        expect(fileNameFromUrl('not a url')).toBeUndefined()
    })

    it('encodes multipart bodies with escaped names and the file last', async () => {
        const { buildMultipartBody } = await import('./attachments.js')
        const { body, contentType } = buildMultipartBody(
            { key: 'uploads/x', sig: 'abc' },
            {
                field: 'file',
                name: 'a"b\r\n.txt',
                contentType: 'text/plain',
                blob: new Blob(['hello']),
            },
        )
        const boundary = contentType.split('boundary=')[1]
        const text = await body.text()
        expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
        expect(body.size).toBe(Buffer.byteLength(text))
        expect(text).toBe(
            [
                `--${boundary}`,
                'Content-Disposition: form-data; name="key"',
                '',
                'uploads/x',
                `--${boundary}`,
                'Content-Disposition: form-data; name="sig"',
                '',
                'abc',
                `--${boundary}`,
                'Content-Disposition: form-data; name="file"; filename="a%22b%0D%0A.txt"',
                'Content-Type: text/plain',
                '',
                'hello',
                `--${boundary}--`,
                '',
            ].join('\r\n'),
        )
    })

    it('guesses content types from extensions', async () => {
        const { guessContentType } = await import('./attachments.js')
        expect(guessContentType('A.PDF')).toBe('application/pdf')
        expect(guessContentType('photo.jpeg')).toBe('image/jpeg')
        expect(guessContentType('drawing.dwg')).toBe('application/octet-stream')
    })
})

describe('uploadAttachment', () => {
    let dir: string
    let file: string

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), `ol-attach-${process.pid}-`))
        file = join(dir, 'note.txt')
        await writeFile(file, 'hello')
        apiMocks.apiRequest.mockReset()
        apiMocks.authorizedFetch.mockReset()
    })

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('registers the attachment then posts the form to the upload URL', async () => {
        apiMocks.apiRequest.mockResolvedValueOnce({
            data: {
                mode: 'post',
                uploadUrl: '/api/files.create',
                form: { key: 'uploads/x/note.txt', sig: 'signed' },
                attachment: attachment(),
            },
        })
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: Response.json({ success: true }),
            url: `${BASE}/api/x`,
            onInstance: true,
        })

        const { uploadAttachment } = await import('./attachments.js')
        const result = await uploadAttachment({ filePath: file, documentId: DOC_ID })

        expect(apiMocks.apiRequest).toHaveBeenCalledWith('attachments.create', {
            name: 'note.txt',
            documentId: DOC_ID,
            contentType: 'text/plain',
            size: 5,
            preset: 'documentAttachment',
        })
        const [url, init] = apiMocks.authorizedFetch.mock.calls[0]
        expect(url).toBe('/api/files.create')
        expect(init.method).toBe('POST')
        expect(init.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
        const body = await (init.body as Blob).text()
        expect(body).toContain('name="sig"\r\n\r\nsigned\r\n')
        expect(body).toContain('filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n')
        expect(result).toMatchObject({ id: ID, name: 'note.txt', size: 5 })
    })

    it('treats a response without a mode as a form upload (older servers)', async () => {
        apiMocks.apiRequest.mockResolvedValueOnce({
            data: {
                uploadUrl: 'https://bucket.s3.amazonaws.com',
                form: { policy: 'p' },
                attachment: attachment(),
            },
        })
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response(null, { status: 204 }),
            url: 'https://bucket.s3.amazonaws.com/',
            onInstance: false,
        })

        const { uploadAttachment } = await import('./attachments.js')
        await uploadAttachment({ filePath: file, documentId: DOC_ID })

        expect(apiMocks.authorizedFetch.mock.calls[0][0]).toBe('https://bucket.s3.amazonaws.com')
        expect(apiMocks.authorizedFetch.mock.calls[0][1].method).toBe('POST')
    })

    it('uses a presigned PUT with the returned headers in put mode', async () => {
        apiMocks.apiRequest.mockResolvedValueOnce({
            data: {
                mode: 'put',
                url: 'https://bucket.s3.amazonaws.com/x?X-Amz-Signature=s',
                headers: { 'x-amz-acl': 'private' },
                attachment: attachment(),
            },
        })
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response(null, { status: 200 }),
            url: 'https://bucket.s3.amazonaws.com/x',
            onInstance: false,
        })

        const { uploadAttachment } = await import('./attachments.js')
        await uploadAttachment({
            filePath: file,
            documentId: DOC_ID,
            name: 'renamed.md',
            contentType: 'text/markdown',
        })

        expect(apiMocks.apiRequest.mock.calls[0][1]).toMatchObject({
            name: 'renamed.md',
            contentType: 'text/markdown',
        })
        const [url, init] = apiMocks.authorizedFetch.mock.calls[0]
        expect(url).toBe('https://bucket.s3.amazonaws.com/x?X-Amz-Signature=s')
        expect(init.method).toBe('PUT')
        expect(init.headers).toEqual({ 'Content-Type': 'text/markdown', 'x-amz-acl': 'private' })
        expect(await (init.body as Blob).text()).toBe('hello')
    })

    it('deletes the registered attachment when the transfer fails', async () => {
        apiMocks.apiRequest
            .mockResolvedValueOnce({
                data: { mode: 'post', uploadUrl: '/api/files.create', attachment: attachment() },
            })
            .mockResolvedValueOnce({ data: undefined })
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response('nope', { status: 413 }),
            url: `${BASE}/api/x`,
            onInstance: true,
        })

        const { uploadAttachment } = await import('./attachments.js')
        await expect(uploadAttachment({ filePath: file, documentId: DOC_ID })).rejects.toThrow(
            'Upload of note.txt failed: API error: 413',
        )
        expect(apiMocks.apiRequest).toHaveBeenLastCalledWith('attachments.delete', { id: ID })
    })

    it('reports S3 failures as storage errors with the XML message', async () => {
        apiMocks.apiRequest
            .mockResolvedValueOnce({
                data: {
                    mode: 'post',
                    uploadUrl: 'https://bucket.s3.amazonaws.com',
                    attachment: attachment(),
                },
            })
            .mockResolvedValueOnce({ data: undefined })
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response(
                '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
                { status: 403, statusText: 'Forbidden' },
            ),
            url: 'https://bucket.s3.amazonaws.com/',
            onInstance: false,
        })

        const { uploadAttachment } = await import('./attachments.js')
        await expect(uploadAttachment({ filePath: file, documentId: DOC_ID })).rejects.toThrow(
            'Upload of note.txt failed: Storage error: 403 Forbidden (Access Denied)',
        )
        expect(apiMocks.toApiError).not.toHaveBeenCalled()
        expect(apiMocks.apiRequest).toHaveBeenLastCalledWith('attachments.delete', { id: ID })
    })

    it('fails before any request when the file is missing', async () => {
        const { uploadAttachment } = await import('./attachments.js')
        await expect(
            uploadAttachment({ filePath: join(dir, 'missing.txt'), documentId: DOC_ID }),
        ).rejects.toThrow('File not found')
        await expect(uploadAttachment({ filePath: dir, documentId: DOC_ID })).rejects.toThrow(
            'File not found',
        )
        expect(apiMocks.apiRequest).not.toHaveBeenCalled()
    })
})

describe('downloadAttachment', () => {
    let dir: string
    const cwd = process.cwd()

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), `ol-download-${process.pid}-`))
        process.chdir(dir)
        apiMocks.authorizedFetch.mockReset()
    })

    afterEach(async () => {
        process.chdir(cwd)
        await rm(dir, { recursive: true, force: true })
    })

    function redirectThenFile(content: string, disposition = 'attachment; filename="a.txt"') {
        apiMocks.authorizedFetch
            .mockResolvedValueOnce({
                response: new Response(null, {
                    status: 302,
                    headers: { location: '/api/files.get?sig=signed' },
                }),
                url: `${BASE}/api/x`,
                onInstance: true,
            })
            .mockResolvedValueOnce({
                response: new Response(content, {
                    headers: { 'content-disposition': disposition },
                }),
                url: `${BASE}/api/x`,
                onInstance: true,
            })
    }

    it('follows the redirect by hand and saves under the server file name', async () => {
        redirectThenFile('content')

        const { downloadAttachment } = await import('./attachments.js')
        const result = await downloadAttachment(`/api/attachments.redirect?id=${ID}`)

        expect(apiMocks.authorizedFetch.mock.calls[0]).toEqual([
            `/api/attachments.redirect?id=${ID}`,
            { method: 'GET', redirect: 'manual' },
        ])
        expect(apiMocks.authorizedFetch.mock.calls[1][0]).toBe('/api/files.get?sig=signed')
        expect(result).toEqual({ id: ID, name: 'a.txt', path: 'a.txt', size: 7 })
        expect(await readFile(join(dir, 'a.txt'), 'utf-8')).toBe('content')
    })

    it('writes into an existing directory passed as --output', async () => {
        redirectThenFile('content')
        const { downloadAttachment } = await import('./attachments.js')
        const result = await downloadAttachment(ID, { output: dir })
        expect(result.path).toBe(join(dir, 'a.txt'))
    })

    it('refuses to overwrite unless forced, and keeps the existing file', async () => {
        await writeFile(join(dir, 'a.txt'), 'original')
        redirectThenFile('new')
        const { downloadAttachment } = await import('./attachments.js')
        await expect(downloadAttachment(ID)).rejects.toThrow('File already exists: a.txt')
        expect(await readFile(join(dir, 'a.txt'), 'utf-8')).toBe('original')

        redirectThenFile('new')
        await downloadAttachment(ID, { force: true })
        expect(await readFile(join(dir, 'a.txt'), 'utf-8')).toBe('new')
    })

    it('keeps an existing file when the response stream fails before the file opens', async () => {
        await writeFile(join(dir, 'a.txt'), 'original')
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(new Error('connection reset'))
                    },
                }),
                { headers: { 'content-disposition': 'attachment; filename="a.txt"' } },
            ),
            url: `${BASE}/api/x`,
            onInstance: true,
        })
        const { downloadAttachment } = await import('./attachments.js')
        await expect(downloadAttachment(ID)).rejects.toThrow()
        expect(await readFile(join(dir, 'a.txt'), 'utf-8')).toBe('original')
    })

    it('removes the partial new file when the response stream fails', async () => {
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('part'))
                        controller.error(new Error('connection reset'))
                    },
                }),
                { headers: { 'content-disposition': 'attachment; filename="b.txt"' } },
            ),
            url: `${BASE}/api/x`,
            onInstance: true,
        })
        const { downloadAttachment } = await import('./attachments.js')
        await expect(downloadAttachment(ID)).rejects.toThrow('connection reset')
        await expect(readFile(join(dir, 'b.txt'))).rejects.toThrow('ENOENT')
    })

    it('creates a missing folder when --output ends in a slash', async () => {
        redirectThenFile('content')
        const { downloadAttachment } = await import('./attachments.js')
        const result = await downloadAttachment(ID, { output: './new/nested/' })
        expect(result.path).toBe(join('new', 'nested', 'a.txt'))
        expect(await readFile(join(dir, 'new', 'nested', 'a.txt'), 'utf-8')).toBe('content')
    })

    it('says the folder is missing instead of a raw ENOENT', async () => {
        redirectThenFile('content')
        const { downloadAttachment } = await import('./attachments.js')
        await expect(downloadAttachment(ID, { output: './missing/a.txt' })).rejects.toThrow(
            'Folder does not exist: ./missing',
        )
    })

    it('names the file from the served URL when there is no Content-Disposition', async () => {
        apiMocks.authorizedFetch
            .mockResolvedValueOnce({
                response: new Response(null, {
                    status: 302,
                    headers: {
                        location: 'https://bucket.s3.amazonaws.com/uploads/u/a/plan.pdf?s=1',
                    },
                }),
                url: `${BASE}/api/attachments.redirect?id=${ID}`,
                onInstance: true,
            })
            .mockResolvedValueOnce({
                response: new Response('pdf'),
                url: 'https://bucket.s3.amazonaws.com/uploads/u/a/plan.pdf?s=1',
                onInstance: false,
            })
        const { downloadAttachment } = await import('./attachments.js')
        const result = await downloadAttachment(ID)
        expect(apiMocks.authorizedFetch.mock.calls[1][0]).toBe(
            'https://bucket.s3.amazonaws.com/uploads/u/a/plan.pdf?s=1',
        )
        expect(result.name).toBe('plan.pdf')
    })

    it('cancels the redirect response body before following it', async () => {
        const cancel = vi.fn()
        apiMocks.authorizedFetch
            .mockResolvedValueOnce({
                response: new Response(new ReadableStream({ cancel }), {
                    status: 302,
                    headers: { location: '/api/files.get?sig=signed' },
                }),
                url: `${BASE}/api/x`,
                onInstance: true,
            })
            .mockResolvedValueOnce({
                response: new Response('content', {
                    headers: { 'content-disposition': 'attachment; filename="a.txt"' },
                }),
                url: `${BASE}/api/x`,
                onInstance: true,
            })
        const { downloadAttachment } = await import('./attachments.js')
        await downloadAttachment(ID)
        expect(cancel).toHaveBeenCalled()
    })

    it('keeps a dangling symlink when the response stream fails before the file opens', async () => {
        await symlink(join(dir, 'nowhere.txt'), join(dir, 'a.txt'))
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(new Error('connection reset'))
                    },
                }),
                { headers: { 'content-disposition': 'attachment; filename="a.txt"' } },
            ),
            url: `${BASE}/api/x`,
            onInstance: true,
        })
        const { downloadAttachment } = await import('./attachments.js')
        await expect(downloadAttachment(ID)).rejects.toThrow()
        expect(await readlink(join(dir, 'a.txt'))).toBe(join(dir, 'nowhere.txt'))
    })

    it('reports Outline errors such as a missing attachment', async () => {
        apiMocks.authorizedFetch.mockResolvedValueOnce({
            response: new Response('{}', { status: 404 }),
            url: `${BASE}/api/x`,
            onInstance: true,
        })
        const { downloadAttachment } = await import('./attachments.js')
        await expect(downloadAttachment(ID)).rejects.toThrow(
            `Download of attachment ${ID} failed: API error: 404`,
        )
    })

    it('stops after too many redirects', async () => {
        apiMocks.authorizedFetch.mockResolvedValue({
            response: new Response(null, { status: 302, headers: { location: '/loop' } }),
            url: `${BASE}/api/x`,
            onInstance: true,
        })
        const { downloadAttachment } = await import('./attachments.js')
        await expect(downloadAttachment(ID)).rejects.toThrow('Too many redirects')
    })
})
