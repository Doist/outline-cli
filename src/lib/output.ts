import chalk from 'chalk'
import type { Pagination } from './api.js'

interface OutputOptions {
    json?: boolean
    ndjson?: boolean
    full?: boolean
}

export function getOutputOptions(opts: Record<string, unknown>): OutputOptions {
    return {
        json: Boolean(opts.json),
        ndjson: Boolean(opts.ndjson),
        full: Boolean(opts.full),
    }
}

export function outputItem<T extends object>(
    item: T,
    humanFormatter: (item: T) => string,
    essentialKeys?: (keyof T)[],
    opts: OutputOptions = {},
): void {
    if (opts.ndjson) {
        const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
        console.log(JSON.stringify(data))
        return
    }
    if (opts.json) {
        const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
        console.log(JSON.stringify(data, null, 2))
        return
    }
    console.log(humanFormatter(item))
}

export function outputList<T extends object>(
    items: T[],
    humanFormatter: (item: T) => string,
    essentialKeys?: (keyof T)[],
    opts: OutputOptions = {},
    pagination?: Pagination,
): void {
    if (opts.ndjson) {
        for (const item of items) {
            const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
            console.log(JSON.stringify(data))
        }
    } else if (opts.json) {
        const data = items.map((item) =>
            opts.full || !essentialKeys ? item : pick(item, essentialKeys),
        )
        console.log(JSON.stringify(data, null, 2))
    } else {
        for (const item of items) {
            console.log(humanFormatter(item))
        }
    }

    if (pagination?.nextPath && !opts.ndjson) {
        console.log(
            chalk.dim(
                `\n(more results available — use --offset ${pagination.offset + pagination.limit})`,
            ),
        )
    }
}

function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
    const result: Partial<T> = {}
    for (const key of keys) {
        if (key in obj) result[key] = obj[key]
    }
    return result
}

export function formatError(code: string, message: string, hints?: string[]): string {
    const lines = [`Error: ${code}`, message]
    if (hints && hints.length > 0) {
        lines.push('')
        for (const hint of hints) {
            lines.push(`  - ${hint}`)
        }
    }
    return chalk.red(lines.join('\n'))
}
