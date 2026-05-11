import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { registerChangelogCommand } from '../commands/changelog.js'
import { BaseCliError } from '../lib/errors.js'
import { formatError, formatErrorJson } from '../lib/output.js'

describe('changelog command end-to-end', () => {
    it('rejects with BaseCliError(INVALID_TYPE) when --count is not a number', async () => {
        const program = new Command()
        program.exitOverride()
        registerChangelogCommand(program)

        await expect(
            program.parseAsync(['node', 'ol', 'changelog', '-n', 'abc']),
        ).rejects.toBeInstanceOf(BaseCliError)

        const err = await program
            .parseAsync(['node', 'ol', 'changelog', '-n', 'abc'])
            .catch((e: Error) => e)
        expect(err).toBeInstanceOf(BaseCliError)
        expect((err as BaseCliError).code).toBe('INVALID_TYPE')
    })

    it('formats the rejected BaseCliError through formatError (human)', async () => {
        const program = new Command()
        program.exitOverride()
        registerChangelogCommand(program)

        const err = await program
            .parseAsync(['node', 'ol', 'changelog', '-n', 'abc'])
            .catch((e: Error) => e)
        expect(err).toBeInstanceOf(BaseCliError)
        const out = formatError(err as BaseCliError)
        expect(out).toContain('Error: INVALID_TYPE')
        expect(out).toContain('Count must be a positive integer')
    })

    it('formats the rejected BaseCliError through formatErrorJson', async () => {
        const program = new Command()
        program.exitOverride()
        registerChangelogCommand(program)

        const err = await program
            .parseAsync(['node', 'ol', 'changelog', '-n', 'abc'])
            .catch((e: Error) => e)
        const parsed = JSON.parse(formatErrorJson(err as BaseCliError))
        expect(parsed.error.code).toBe('INVALID_TYPE')
        expect(parsed.error.message).toBe('Count must be a positive integer')
    })
})
