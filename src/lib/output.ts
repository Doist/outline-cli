import { formatJson, formatNdjson, printEmpty, type ViewOptions } from '@doist/cli-core'
import chalk from 'chalk'
import type { Pagination } from './api.js'
import { BaseCliError } from './errors.js'

type AnyCliError = BaseCliError<string>

export type OutputOptions = ViewOptions & {
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
    emptyMessage?: string,
): void {
    if (items.length === 0 && emptyMessage !== undefined) {
        printEmpty({ options: opts, message: emptyMessage })
        return
    }

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

function toCliError(
    codeOrError: string | AnyCliError,
    message?: string,
    hints?: string[],
): AnyCliError {
    if (typeof codeOrError === 'string') {
        return new BaseCliError(codeOrError, message ?? '', { hints })
    }
    return codeOrError
}

export function formatError(error: AnyCliError): string
export function formatError(code: string, message: string, hints?: string[]): string
export function formatError(
    codeOrError: string | AnyCliError,
    message?: string,
    hints?: string[],
): string {
    const err = toCliError(codeOrError, message, hints)
    const lines = [`Error: ${err.code}`, err.message]
    if (err.hints && err.hints.length > 0) {
        lines.push('')
        for (const hint of err.hints) {
            lines.push(`  - ${hint}`)
        }
    }
    return chalk.red(lines.join('\n'))
}

export function formatErrorJson(error: AnyCliError): string
export function formatErrorJson(code: string, message: string, hints?: string[]): string
export function formatErrorJson(
    codeOrError: string | AnyCliError,
    message?: string,
    hints?: string[],
): string {
    const err = toCliError(codeOrError, message, hints)
    return JSON.stringify({ error: { code: err.code, message: err.message, hints: err.hints } })
}
