import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BaseCliError } from './errors.js'
import {
    applyUserSelector,
    getRequestedUserRef,
    resetGlobalArgs,
    validateRootUserFlag,
} from './global-args.js'

const COMMANDS = new Set([
    'auth',
    'search',
    'document',
    'collection',
    'skill',
    'changelog',
    'update',
])

// The global-args store reads `process.argv` lazily and caches the result, so
// each case sets argv then clears the cache. (Static import is fine: this file
// doesn't use `vi.resetModules()`, so a dynamic import would return the same
// module instance anyway.)
function setArgv(...args: string[]) {
    process.argv = ['node', 'ol', ...args]
    resetGlobalArgs()
}

beforeEach(() => setArgv())
afterEach(() => setArgv())

describe('getRequestedUserRef', () => {
    it('resolves the ref off argv', () => {
        setArgv('--user', 'scott', 'document', 'list')
        expect(getRequestedUserRef()).toBe('scott')
    })
    // Absent-flag case is covered by the applyUserSelector no-op test below;
    // flag-form parsing (`--user=`) belongs to cli-core's parseGlobalArgs.
})

describe('validateRootUserFlag', () => {
    it('passes a valid ref', () => {
        expect(() =>
            validateRootUserFlag(['--user', 'scott', 'document', 'list'], COMMANDS),
        ).not.toThrow()
    })

    it('is silent when --user is absent', () => {
        expect(() => validateRootUserFlag(['document', 'list'], COMMANDS)).not.toThrow()
    })

    it('ignores a --user that appears after a command (left for Commander)', () => {
        // Late flag: stripUserFlag won't remove it, so Commander reports the
        // unknown option — the validator must not pre-empt with its own error.
        expect(() => validateRootUserFlag(['document', '--user'], COMMANDS)).not.toThrow()
        expect(() =>
            validateRootUserFlag(['document', 'list', '--user', 'scott'], COMMANDS),
        ).not.toThrow()
    })

    it('errors on a bare --user', () => {
        expect(() => validateRootUserFlag(['--user'], COMMANDS)).toThrow(BaseCliError)
    })

    it('errors on an empty --user=', () => {
        expect(() => validateRootUserFlag(['--user=', 'document'], COMMANDS)).toThrow(BaseCliError)
    })

    it('errors when the value is a command name (forgotten value)', () => {
        expect(() => validateRootUserFlag(['--user', 'document', 'list'], COMMANDS)).toThrow(
            expect.objectContaining({ code: 'INVALID_USER_FLAG' }),
        )
    })
})

describe('applyUserSelector (entrypoint flow)', () => {
    it('validates, warms the cache, then strips --user from argv', () => {
        setArgv('--user', 'scott', 'document', 'list')
        applyUserSelector(COMMANDS)
        // Ref survives because the cache was warmed before the strip...
        expect(getRequestedUserRef()).toBe('scott')
        // ...and Commander sees argv without the root --user.
        expect(process.argv.slice(2)).toEqual(['document', 'list'])
    })

    it('throws before stripping when the root flag is malformed', () => {
        setArgv('--user')
        expect(() => applyUserSelector(COMMANDS)).toThrow(BaseCliError)
    })

    it('is a no-op for argv without --user', () => {
        setArgv('document', 'list')
        applyUserSelector(COMMANDS)
        expect(getRequestedUserRef()).toBeUndefined()
        expect(process.argv.slice(2)).toEqual(['document', 'list'])
    })
})
