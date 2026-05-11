import { formatJson, formatNdjson, printEmpty, type ViewOptions } from '@doist/cli-core'
import chalk from 'chalk'
import type { Pagination } from './api.js'
import type { BaseCliError, ErrorType } from './errors.js'

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

function resolveErrorParts(
    codeOrError: string | AnyCliError,
    message?: string,
    hints?: string[],
): { code: string; message: string; hints: string[] | undefined; type: ErrorType } {
    if (typeof codeOrError === 'string') {
        return { code: codeOrError, message: message ?? '', hints, type: 'error' }
    }
    return {
        code: codeOrError.code,
        message: codeOrError.message,
        hints: codeOrError.hints,
        type: codeOrError.type ?? 'error',
    }
}

export function formatError(error: AnyCliError): string
export function formatError(code: string, message: string, hints?: string[]): string
export function formatError(
    codeOrError: string | AnyCliError,
    message?: string,
    hints?: string[],
): string {
    const { code, message: msg, hints: h } = resolveErrorParts(codeOrError, message, hints)
    const lines = [`Error: ${code}`, msg]
    if (h && h.length > 0) {
        lines.push('')
        for (const hint of h) {
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
    const { code, message: msg, hints: h } = resolveErrorParts(codeOrError, message, hints)
    return JSON.stringify({ error: { code, message: msg, hints: h } })
}
