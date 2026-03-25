import chalk from 'chalk'
import type { Command } from 'commander'
import { apiRequest } from '../lib/api.js'
import { formatError, getOutputOptions, outputItem, outputList } from '../lib/output.js'
import { resolveCollectionId, resolveCollectionRef } from '../lib/refs.js'

interface Collection {
    id: string
    name: string
    description: string
    color: string
    permission: string
    createdAt: string
    updatedAt: string
    documentCount: number
}

const essentialKeys: (keyof Collection)[] = ['id', 'name', 'description', 'color', 'documentCount']

function formatCollection(col: Collection): string {
    const name = chalk.bold(col.name)
    const id = chalk.dim(col.id)
    const count = chalk.dim(`${col.documentCount} docs`)
    return `${name} ${id} ${count}`
}

export function registerCollectionCommand(program: Command): void {
    const col = program.command('collection').alias('col').description('Manage collections')

    col.command('list')
        .description('List collections')
        .option('--limit <n>', 'Max results', '25')
        .option('--offset <n>', 'Pagination offset', '0')
        .option('--json', 'Output JSON')
        .option('--ndjson', 'Output NDJSON')
        .option('--full', 'Include all fields in JSON output')
        .action(async (opts) => {
            const { data, pagination } = await apiRequest<Collection[]>('collections.list', {
                limit: Number(opts.limit),
                offset: Number(opts.offset),
            })

            outputList(data, formatCollection, essentialKeys, getOutputOptions(opts), pagination)
        })

    col.command('get <id>')
        .description('Get collection details by ID or name')
        .option('--json', 'Output JSON')
        .option('--full', 'Include all fields in JSON output')
        .action(async (id: string, opts) => {
            const resolved = await resolveCollectionRef(id)
            // If resolved from name search (collections.list), some fields may be missing
            let data: Collection
            if (resolved.documentCount !== undefined) {
                data = resolved as Collection
            } else {
                const response = await apiRequest<Collection>('collections.info', {
                    id: resolved.id,
                })
                data = response.data
            }
            outputItem(data, formatCollection, essentialKeys, getOutputOptions(opts))
        })

    col.command('create')
        .description('Create a collection')
        .requiredOption('--name <name>', 'Collection name')
        .option('--description <text>', 'Description')
        .option('--color <hex>', 'Color hex code')
        .option('--private', 'Make private')
        .option('--json', 'Output JSON')
        .action(async (opts) => {
            const body: Record<string, unknown> = { name: opts.name }
            if (opts.description) body.description = opts.description
            if (opts.color) body.color = opts.color
            if (opts.private) body.permission = ''

            const { data } = await apiRequest<Collection>('collections.create', body)

            if (opts.json) {
                outputItem(data, formatCollection, essentialKeys, { json: true })
            } else {
                console.log(chalk.green(`Created: ${data.name}`), chalk.dim(data.id))
            }
        })

    col.command('update <id>')
        .description('Update a collection')
        .option('--name <name>', 'New name')
        .option('--description <text>', 'New description')
        .option('--color <hex>', 'New color')
        .option('--json', 'Output JSON')
        .action(async (id: string, opts) => {
            const resolvedId = await resolveCollectionId(id)
            const body: Record<string, unknown> = { id: resolvedId }
            if (opts.name) body.name = opts.name
            if (opts.description) body.description = opts.description
            if (opts.color) body.color = opts.color

            const { data } = await apiRequest<Collection>('collections.update', body)

            if (opts.json) {
                outputItem(data, formatCollection, essentialKeys, { json: true })
            } else {
                console.log(chalk.green(`Updated: ${data.name}`), chalk.dim(data.id))
            }
        })

    col.command('delete <id>')
        .description('Delete a collection')
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
            const resolvedId = await resolveCollectionId(id)
            await apiRequest('collections.delete', { id: resolvedId })
            console.log('Deleted.')
        })
}
