import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BaseCliError } from './errors.js'

const COMMANDS = new Set([
    'auth',
    'search',
    'document',
    'collection',
    'skill',
    'changelog',
    'update',
])

async function load(argv: string[]) {
    process.argv = ['node', 'ol', ...argv]
    const mod = await import('./global-args.js')
    mod.resetGlobalArgs()
    return mod
}

describe('getRequestedUserRef', () => {
    beforeEach(() => {
        process.argv = ['node', 'ol']
    })
    afterEach(() => {
        process.argv = ['node', 'ol']
    })

    it('resolves the space form', async () => {
        const { getRequestedUserRef } = await load(['--user', 'scott', 'document', 'list'])
        expect(getRequestedUserRef()).toBe('scott')
    })

    it('resolves the = form', async () => {
        const { getRequestedUserRef } = await load(['--user=scott@example.com', 'document', 'list'])
        expect(getRequestedUserRef()).toBe('scott@example.com')
    })

    it('is undefined when absent', async () => {
        const { getRequestedUserRef } = await load(['document', 'list'])
        expect(getRequestedUserRef()).toBeUndefined()
    })
})

describe('validateRootUserFlag', () => {
    beforeEach(() => {
        process.argv = ['node', 'ol']
    })
    afterEach(() => {
        process.argv = ['node', 'ol']
    })

    it('passes a valid ref', async () => {
        const { validateRootUserFlag } = await load([])
        expect(() =>
            validateRootUserFlag(['--user', 'scott', 'document', 'list'], COMMANDS),
        ).not.toThrow()
    })

    it('is silent when --user is absent', async () => {
        const { validateRootUserFlag } = await load([])
        expect(() => validateRootUserFlag(['document', 'list'], COMMANDS)).not.toThrow()
    })

    it('errors on a bare --user', async () => {
        const { validateRootUserFlag } = await load([])
        expect(() => validateRootUserFlag(['--user'], COMMANDS)).toThrow(BaseCliError)
    })

    it('errors on an empty --user=', async () => {
        const { validateRootUserFlag } = await load([])
        expect(() => validateRootUserFlag(['--user=', 'document'], COMMANDS)).toThrow(BaseCliError)
    })

    it('errors when the value is a command name (forgotten value)', async () => {
        const { validateRootUserFlag } = await load([])
        let caught: unknown
        try {
            validateRootUserFlag(['--user', 'document', 'list'], COMMANDS)
        } catch (err) {
            caught = err
        }
        expect(caught).toBeInstanceOf(BaseCliError)
        expect((caught as { code: string }).code).toBe('INVALID_USER_FLAG')
    })
})

describe('cache warm before strip', () => {
    afterEach(() => {
        process.argv = ['node', 'ol']
    })

    it('keeps the ref after process.argv is rewritten without --user', async () => {
        const { getRequestedUserRef } = await load(['--user', 'scott', 'document', 'list'])
        // Warm, then simulate index.ts stripping --user from argv.
        expect(getRequestedUserRef()).toBe('scott')
        process.argv = ['node', 'ol', 'document', 'list']
        expect(getRequestedUserRef()).toBe('scott')
    })
})
