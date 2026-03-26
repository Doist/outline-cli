import { readFileSync } from 'node:fs'
import chalk from 'chalk'
import type { Command } from 'commander'
import open from 'open'
import { apiRequest } from '../lib/api.js'
import { getBaseUrl } from '../lib/auth.js'
import { renderMarkdown } from '../lib/markdown.js'
import { formatError, getOutputOptions, outputItem, outputList } from '../lib/output.js'
import { resolveCollectionId, resolveDocumentId, resolveDocumentRef } from '../lib/refs.js'

interface Document {
    id: string
    title: string
    url: string
    urlId: string
    text: string
    collectionId: string
    createdAt: string
    updatedAt: string
    publishedAt: string | null
    archivedAt: string | null
    parentDocumentId: string | null
    revision: number
}

const essentialKeys: (keyof Document)[] = ['id', 'title', 'urlId', 'collectionId', 'updatedAt']

function formatDoc(doc: Document): string {
    const title = chalk.bold(doc.title)
    const id = chalk.dim(doc.urlId)
    const date = chalk.dim(new Date(doc.updatedAt).toLocaleDateString())
    return `${title} ${id} ${date}`
}

function formatDocFull(doc: Document): string {
    return `# ${doc.title}\n\n${doc.text}`
}

function readTextInput(opts: { text?: string; file?: string }): string | undefined {
    if (opts.file) return readFileSync(opts.file, 'utf-8')
    return opts.text
}

function extractTitleFromText(text: string): { title?: string; body: string } {
    const lines = text.split('\n')
    const firstLine = lines[0]?.trim()
    if (firstLine?.startsWith('# ')) {
        return {
            title: firstLine.slice(2).trim(),
            body: lines.slice(1).join('\n').replace(/^\n+/, ''),
        }
    }
    return { body: text }
}

export function registerDocumentCommand(program: Command): void {
    const doc = program.command('document').alias('doc').description('Manage documents')

    doc.command('list')
        .description('List documents')
        .option('--collection <ref>', 'Filter by collection ID or name')
        .option('--limit <n>', 'Max results', '25')
        .option('--offset <n>', 'Pagination offset', '0')
        .option('--sort <field>', 'Sort by field (title|updatedAt|createdAt)', 'updatedAt')
        .option('--direction <dir>', 'Sort direction (ASC|DESC)', 'DESC')
        .option('--json', 'Output JSON')
        .option('--ndjson', 'Output NDJSON')
        .option('--full', 'Include all fields in JSON output')
        .action(async (opts) => {
            const body: Record<string, unknown> = {
                limit: Number(opts.limit),
                offset: Number(opts.offset),
                sort: opts.sort,
                direction: opts.direction,
            }
            if (opts.collection) {
                body.collectionId = await resolveCollectionId(opts.collection)
            }

            const { data, pagination } = await apiRequest<Document[]>('documents.list', body)

            outputList(data, formatDoc, essentialKeys, getOutputOptions(opts), pagination)
        })

    doc.command('get <id>')
        .description('Get a document by ID, URL, or name')
        .option('--raw', 'Output raw markdown without terminal formatting')
        .option('--json', 'Output JSON')
        .option('--full', 'Include all fields in JSON output')
        .action(async (id: string, opts) => {
            const resolved = await resolveDocumentRef(id)
            // If resolved from name search (documents.list), text may be missing
            let data: Document
            if (resolved.text !== undefined) {
                data = resolved as Document
            } else {
                const response = await apiRequest<Document>('documents.info', {
                    id: resolved.id,
                })
                data = response.data
            }

            const outputOpts = getOutputOptions(opts)
            if (outputOpts.json) {
                outputItem(data, formatDocFull, essentialKeys, outputOpts)
            } else {
                const content = formatDocFull(data)
                console.log(opts.raw ? content : renderMarkdown(content))
            }
        })

    doc.command('open <id>')
        .description('Open a document in the browser')
        .action(async (id: string) => {
            const resolved = await resolveDocumentRef(id)
            const fullUrl = `${getBaseUrl()}${resolved.url}`
            await open(fullUrl)
            console.log(chalk.dim(`Opened: ${fullUrl}`))
        })

    doc.command('create')
        .description('Create a document')
        .requiredOption('--title <title>', 'Document title')
        .option('--collection <ref>', 'Collection ID or name')
        .option('--parent <ref>', 'Parent document ID, URL, or name')
        .option('--text <text>', 'Document body (markdown)')
        .option('--file <path>', 'Read markdown from file')
        .option('--publish', 'Publish immediately')
        .option('--json', 'Output JSON')
        .action(async (opts) => {
            if (!opts.collection && !opts.parent) {
                console.error(
                    formatError(
                        'MISSING_OPTION',
                        'Either --collection or --parent must be provided.',
                        [
                            'Use --collection to create at a collection root',
                            'Use --parent to nest under a parent document',
                        ],
                    ),
                )
                process.exit(1)
            }
            if (opts.collection && opts.parent) {
                console.error(
                    formatError(
                        'CONFLICTING_OPTIONS',
                        '--collection and --parent are mutually exclusive.',
                        [
                            'Use --collection to create at a collection root',
                            'Use --parent to nest under a parent document (collection is inferred)',
                        ],
                    ),
                )
                process.exit(1)
            }

            const body: Record<string, unknown> = {
                title: opts.title,
            }

            if (opts.collection) {
                body.collectionId = await resolveCollectionId(opts.collection)
            }

            if (opts.parent) {
                const parent = await resolveDocumentRef(opts.parent)
                body.parentDocumentId = parent.id
                body.collectionId = (parent as Document).collectionId
            }

            const text = readTextInput(opts)
            if (text) body.text = text
            if (opts.publish) body.publish = true

            const { data } = await apiRequest<Document>('documents.create', body)

            if (opts.json) {
                outputItem(data, formatDoc, essentialKeys, { json: true })
            } else {
                console.log(chalk.green(`Created: ${data.title}`), chalk.dim(data.urlId))
            }
        })

    doc.command('update <id>')
        .description('Update a document')
        .option('--title <title>', 'New title')
        .option('--text <text>', 'New body (markdown)')
        .option('--file <path>', 'Read markdown from file')
        .option('--json', 'Output JSON')
        .action(async (id: string, opts) => {
            const resolvedId = await resolveDocumentId(id)
            const body: Record<string, unknown> = { id: resolvedId }

            const rawText = readTextInput(opts)
            if (rawText && !opts.title) {
                const { title, body: textBody } = extractTitleFromText(rawText)
                if (title) body.title = title
                body.text = textBody
            } else {
                if (rawText) body.text = rawText
                if (opts.title) body.title = opts.title
            }

            const { data } = await apiRequest<Document>('documents.update', body)

            if (opts.json) {
                outputItem(data, formatDoc, essentialKeys, { json: true })
            } else {
                console.log(chalk.green(`Updated: ${data.title}`), chalk.dim(data.urlId))
            }
        })

    doc.command('delete <id>')
        .description('Delete a document')
        .option('--confirm', 'Skip confirmation')
        .action(async (id: string, opts) => {
            if (!opts.confirm) {
                console.error(
                    formatError(
                        'CONFIRMATION_REQUIRED',
                        'Delete operation requires confirmation.',
                        ['Use --confirm flag to proceed with deletion'],
                    ),
                )
                process.exit(1)
            }
            const resolvedId = await resolveDocumentId(id)
            await apiRequest('documents.delete', { id: resolvedId })
            console.log('Deleted.')
        })

    doc.command('move <id>')
        .description('Move a document to another collection or under a parent')
        .option('--collection <ref>', 'Target collection ID or name')
        .option('--parent <ref>', 'Parent document ID, URL, or name')
        .action(async (id: string, opts) => {
            if (!opts.collection && !opts.parent) {
                console.error(
                    formatError(
                        'MISSING_OPTION',
                        'Either --collection or --parent must be provided.',
                        [
                            'Use --collection to move to a collection root',
                            'Use --parent to nest under a parent document',
                        ],
                    ),
                )
                process.exit(1)
            }
            if (opts.collection && opts.parent) {
                console.error(
                    formatError(
                        'CONFLICTING_OPTIONS',
                        '--collection and --parent are mutually exclusive.',
                        [
                            'Use --collection to move to a collection root',
                            'Use --parent to nest under a parent document (collection is inferred)',
                        ],
                    ),
                )
                process.exit(1)
            }

            const resolvedId = await resolveDocumentId(id)
            const body: Record<string, unknown> = { id: resolvedId }

            if (opts.collection) {
                body.collectionId = await resolveCollectionId(opts.collection)
            }
            if (opts.parent) {
                const parent = await resolveDocumentRef(opts.parent)
                body.parentDocumentId = parent.id
                body.collectionId = (parent as Document).collectionId
            }

            await apiRequest('documents.move', body)
            console.log('Moved.')
        })

    doc.command('archive <id>')
        .description('Archive a document')
        .action(async (id: string) => {
            const resolvedId = await resolveDocumentId(id)
            await apiRequest('documents.archive', { id: resolvedId })
            console.log('Archived.')
        })

    doc.command('unarchive <id>')
        .description('Unarchive a document')
        .action(async (id: string) => {
            const resolvedId = await resolveDocumentId(id)
            await apiRequest('documents.unarchive', { id: resolvedId })
            console.log('Unarchived.')
        })
}
