import { existsSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { apiUpload } from '../lib/api.js'
import { resolveDocumentId } from '../lib/refs.js'

const CONTENT_TYPE_MAP: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
}

function guessContentType(filePath: string): string {
    const ext = extname(filePath).toLowerCase()
    return CONTENT_TYPE_MAP[ext] ?? 'application/octet-stream'
}

export function registerAttachmentCommand(program: Command): void {
    const attachment = program.command('attachment').alias('att').description('Manage attachments')

    attachment
        .command('create <file>')
        .description('Upload a file attachment to a document')
        .requiredOption('--document <ref>', 'Document ID, URL, or name')
        .option('--content-type <type>', 'MIME type (auto-detected from extension)')
        .option('--json', 'Output JSON')
        .action(async (file: string, opts) => {
            if (!existsSync(file)) {
                console.error(chalk.red(`File not found: ${file}`))
                process.exit(1)
            }

            const documentId = await resolveDocumentId(opts.document)
            const contentType = opts.contentType ?? guessContentType(file)
            const fileSize = statSync(file).size

            const result = await apiUpload(file, {
                name: basename(file),
                size: fileSize,
                contentType,
                documentId,
            })

            if (opts.json) {
                console.log(JSON.stringify(result.attachment, null, 2))
            } else {
                const att = result.attachment
                const name = chalk.bold(att.name)
                const size = chalk.dim(`${Math.round(att.size / 1024)}KB`)
                const url = chalk.cyan(att.url)
                console.log(chalk.green('Uploaded:'), `${name} ${size}\n${url}`)
            }
        })
}
