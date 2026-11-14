import chalk from 'chalk'
import type { Command } from 'commander'
import { apiRequest } from '../lib/api.js'
import {
    type Attachment,
    type LinkedAttachment,
    attachmentMarkdown,
    attachmentPath,
    downloadAttachment,
    extractLinkedAttachments,
    parseAttachmentId,
    uploadAttachment,
} from '../lib/attachments.js'
import { CliError } from '../lib/errors.js'
import { getOutputOptions, outputItem, outputList } from '../lib/output.js'
import { resolveDocumentRef } from '../lib/refs.js'
import { withSpinner } from '../lib/spinner.js'

type UploadedAttachment = Attachment & { markdown: string }

const uploadKeys: (keyof UploadedAttachment)[] = [
    'id',
    'name',
    'contentType',
    'size',
    'documentId',
    'url',
    'markdown',
]

const linkedKeys: (keyof LinkedAttachment)[] = ['id', 'name', 'size', 'type', 'url']

function formatSize(bytes: number | null): string {
    if (bytes === null) return ''
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB']
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${value.toFixed(1)} ${units[unit]}`
}

function formatLinked(item: LinkedAttachment): string {
    const name = chalk.bold(item.name || '(no name)')
    const meta = chalk.dim([item.type, formatSize(item.size)].filter(Boolean).join(', '))
    return `${name} ${chalk.dim(item.id)} ${meta}`
}

async function documentText(ref: string): Promise<{ id: string; text: string }> {
    const resolved = await resolveDocumentRef(ref)
    if (resolved.text !== undefined) return { id: resolved.id, text: resolved.text }
    const { data } = await apiRequest<{ id: string; text: string }>('documents.info', {
        id: resolved.id,
    })
    return { id: data.id, text: data.text }
}

export function registerAttachmentCommand(program: Command): void {
    const att = program
        .command('attachment')
        .alias('attach')
        .description('Upload, download and manage document attachments')

    att.command('upload <file>')
        .description('Upload a file as an attachment of a document')
        .requiredOption('--doc <ref>', 'Document ID, URL, or name to attach the file to')
        .option('--name <name>', 'File name shown in Outline (default: the file name)')
        .option('--content-type <type>', 'MIME type (default: guessed from the file extension)')
        .option('--append', 'Also append a link to the attachment at the end of the document')
        .option('--json', 'Output JSON')
        .action(async (file: string, opts) => {
            const doc = await resolveDocumentRef(opts.doc)
            const attachment = await uploadAttachment({
                filePath: file,
                documentId: doc.id,
                name: opts.name,
                contentType: opts.contentType,
            })
            const markdown = attachmentMarkdown(attachment)

            if (opts.append) {
                // `append` (rather than `editMode`) is understood by every
                // Outline version with text edits; older servers ignore an
                // unknown `editMode` and would replace the whole document.
                // The leading blank line keeps the link in its own paragraph.
                await apiRequest('documents.update', {
                    id: doc.id,
                    text: `\n\n${markdown}`,
                    append: true,
                })
            }

            const result: UploadedAttachment = {
                ...attachment,
                url: attachmentPath(attachment.id),
                markdown,
            }
            if (opts.json) {
                outputItem(result, () => '', uploadKeys, { json: true })
                return
            }
            console.log(
                chalk.green(`Uploaded: ${attachment.name}`),
                chalk.dim(`${attachment.id} ${formatSize(attachment.size)}`),
            )
            if (opts.append) {
                console.log(chalk.dim(`Appended to: ${doc.title}`))
            } else {
                console.log(chalk.dim('Markdown:'), markdown)
            }
        })

    att.command('download <ref>')
        .description('Download an attachment by ID or link')
        .option(
            '--output <path>',
            'File path, folder (ending in / is created if missing), or - for stdout (default: current directory)',
        )
        .option('--force', 'Overwrite an existing file')
        .option('--json', 'Output JSON')
        .action(async (ref: string, opts) => {
            const toStdout = opts.output === '-'
            const result = toStdout
                ? await downloadAttachment(ref, { output: '-' })
                : await withSpinner({ text: 'Downloading file...', color: 'blue' }, () =>
                      downloadAttachment(ref, { output: opts.output, force: opts.force }),
                  )
            if (toStdout) return
            if (opts.json) {
                outputItem(result, () => '', undefined, { json: true })
                return
            }
            console.log(
                chalk.green(`Downloaded: ${result.path}`),
                chalk.dim(formatSize(result.size)),
            )
        })

    att.command('list')
        .description('List the attachments and images linked in a document')
        .requiredOption('--doc <ref>', 'Document ID, URL, or name')
        .option('--json', 'Output JSON')
        .option('--ndjson', 'Output NDJSON')
        .option('--full', 'Include all fields in JSON output')
        .action(async (opts) => {
            const { text } = await documentText(opts.doc)
            outputList(
                extractLinkedAttachments(text),
                formatLinked,
                linkedKeys,
                getOutputOptions(opts),
                undefined,
                'No attachments found.',
            )
        })

    att.command('delete <ref>')
        .description('Delete an attachment by ID or link (links to it in documents remain)')
        .option('--confirm', 'Skip confirmation')
        .action(async (ref: string, opts) => {
            if (!opts.confirm) {
                throw new CliError(
                    'CONFIRMATION_REQUIRED',
                    'Delete operation requires confirmation.',
                    ['Use --confirm flag to proceed with deletion'],
                )
            }
            const id = parseAttachmentId(ref)
            await apiRequest('attachments.delete', { id })
            console.log('Deleted.')
        })
}
