import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseCliError } from '../lib/errors.js'
import {
    formatError,
    formatErrorJson,
    getOutputOptions,
    outputItem,
    outputList,
} from '../lib/output.js'

describe('output', () => {
    let logs: string[]

    beforeEach(() => {
        logs = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    const item = { id: '1', name: 'Test', extra: 'hidden' }
    const formatter = (i: typeof item) => `${i.name} (${i.id})`
    const keys: (keyof typeof item)[] = ['id', 'name']

    it('outputItem human mode', () => {
        outputItem(item, formatter, keys)
        expect(logs[0]).toBe('Test (1)')
    })

    it('outputItem json mode shows essential keys only', () => {
        outputItem(item, formatter, keys, { json: true })
        const parsed = JSON.parse(logs[0])
        expect(parsed).toEqual({ id: '1', name: 'Test' })
    })

    it('outputItem json full mode shows all keys', () => {
        outputItem(item, formatter, keys, { json: true, full: true })
        const parsed = JSON.parse(logs[0])
        expect(parsed).toEqual({ id: '1', name: 'Test', extra: 'hidden' })
    })

    it('outputList ndjson mode', () => {
        outputList([item, { ...item, id: '2' }], formatter, keys, { ndjson: true })
        const records = logs
            .flatMap((line) => line.split('\n'))
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        expect(records).toEqual([
            { id: '1', name: 'Test' },
            { id: '2', name: 'Test' },
        ])
    })

    it('getOutputOptions parses flags', () => {
        expect(getOutputOptions({ json: true, full: true, ndjson: false })).toEqual({
            json: true,
            ndjson: false,
            full: true,
        })
    })

    describe('formatError', () => {
        it('formats error with code and message', () => {
            const result = formatError('TEST_ERROR', 'Something went wrong')
            expect(result).toContain('Error: TEST_ERROR')
            expect(result).toContain('Something went wrong')
        })

        it('formats error with hints', () => {
            const result = formatError('TEST_ERROR', 'Something went wrong', [
                'Try this',
                'Or try that',
            ])
            expect(result).toContain('Error: TEST_ERROR')
            expect(result).toContain('Something went wrong')
            expect(result).toContain('  - Try this')
            expect(result).toContain('  - Or try that')
        })

        it('formats error with empty hints array', () => {
            const result = formatError('TEST_ERROR', 'Something went wrong', [])
            expect(result).toContain('Error: TEST_ERROR')
            expect(result).toContain('Something went wrong')
            expect(result).not.toContain('  - ')
        })

        it('formats error without hints', () => {
            const result = formatError('NO_HINTS', 'No hints provided')
            expect(result).toContain('Error: NO_HINTS')
            expect(result).toContain('No hints provided')
            expect(result).not.toContain('  - ')
        })

        it('formats a cli-core CliError instance (code, message, hints)', () => {
            const err = new BaseCliError('FILE_READ_ERROR', 'Could not read changelog file', {
                hints: ['Check the file path'],
            })
            const result = formatError(err)
            expect(result).toContain('Error: FILE_READ_ERROR')
            expect(result).toContain('Could not read changelog file')
            expect(result).toContain('Check the file path')
        })
    })

    describe('formatErrorJson', () => {
        it('serializes a cli-core CliError instance', () => {
            const err = new BaseCliError('INVALID_TYPE', 'Count must be a positive integer')
            const parsed = JSON.parse(formatErrorJson(err))
            expect(parsed).toEqual({
                error: {
                    code: 'INVALID_TYPE',
                    message: 'Count must be a positive integer',
                    hints: undefined,
                },
            })
        })

        it('serializes from positional args', () => {
            const parsed = JSON.parse(formatErrorJson('CODE', 'msg', ['hint']))
            expect(parsed).toEqual({
                error: { code: 'CODE', message: 'msg', hints: ['hint'] },
            })
        })
    })
})
