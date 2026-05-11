import {
    formatJson,
    formatNdjson,
    printEmpty as corePrintEmpty,
    type ViewOptions,
} from '@doist/cli-core'
import chalk from 'chalk'
import type { Pagination } from './api.js'

export type OutputOptions = ViewOptions & {
    full?: boolean
    raw?: boolean
}

export function getOutputOptions(opts: Record<string, unknown>): OutputOptions {
    return {
        json: Boolean(opts.json),
        ndjson: Boolean(opts.ndjson),
        full: Boolean(opts.full),
        raw: Boolean(opts.raw),
    }
}

/**
 * Wraps cli-core's `printEmpty` so list commands can call a single helper
 * for the empty-state branch and stay consistent with the canonical contract:
 *   --json   → `[]\n`
 *   --ndjson → no output
 *   neither  → human message
 */
export function printEmpty(message: string, opts: OutputOptions = {}): void {
    corePrintEmpty({ options: opts, message })
}

export function outputItem<T extends object>(
    item: T,
    humanFormatter: (item: T) => string,
    essentialKeys?: (keyof T)[],
    opts: OutputOptions = {},
): void {
    if (opts.ndjson) {
        const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
        console.log(formatNdjson([data]))
        return
    }
    if (opts.json) {
        const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
        console.log(formatJson(data))
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
    const project = (item: T) => (opts.full || !essentialKeys ? item : pick(item, essentialKeys))

    if (opts.ndjson) {
        // Stream item-by-item: avoids buffering the whole list and matches
        // the canonical NDJSON contract (one record per write).
        for (const item of items) {
            console.log(formatNdjson([project(item)]))
        }
    } else if (opts.json) {
        console.log(formatJson(items.map(project)))
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
