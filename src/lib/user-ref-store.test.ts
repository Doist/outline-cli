import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OutlineTokenStore } from './auth-provider.js'
import { BaseCliError } from './errors.js'
import { resetGlobalArgs } from './global-args.js'
import { makeOutlineAccount, type OutlineAccount } from './outline-account.js'
import { withUserRefAware } from './user-ref-store.js'

const ADA = makeOutlineAccount({ id: 'id-ada', label: 'Ada' })
const BOB = makeOutlineAccount({ id: 'id-bob', label: 'Bob' })

/**
 * Minimal store double. `activeAccount` resolves a match (the wrap's existence
 * probe); the other methods record the ref they were ultimately called with so
 * tests can assert the substituted/forwarded value.
 */
function fakeStore(accounts: OutlineAccount[]) {
    const seen: Record<string, string | undefined> = {}
    const match = (ref?: string) =>
        ref === undefined
            ? accounts[0]
            : accounts.find((a) => a.id === ref || a.label.toLowerCase() === ref.toLowerCase())
    const store = {
        activeAccount: async (ref?: string) => {
            seen.activeAccount = ref
            const account = match(ref)
            return account ? { account, isDefault: account === accounts[0] } : null
        },
        active: async (ref?: string) => {
            seen.active = ref
            const account = match(ref)
            return account ? { token: `tok:${ref ?? 'default'}`, account } : null
        },
        activeBundle: async (ref?: string) => {
            seen.activeBundle = ref
            const account = match(ref)
            return account ? { account, bundle: { accessToken: `tok:${ref ?? 'default'}` } } : null
        },
        clear: async (ref?: string) => {
            seen.clear = ref
            const account = match(ref)
            return account ? { account, wasDefault: account === accounts[0] } : null
        },
    }
    return { store: store as unknown as OutlineTokenStore, seen }
}

function setUserFlag(ref?: string) {
    process.argv = ref
        ? ['node', 'ol', '--user', ref, 'auth', 'status']
        : ['node', 'ol', 'auth', 'status']
    resetGlobalArgs()
}

describe('withUserRefAware', () => {
    beforeEach(() => setUserFlag(undefined))
    afterEach(() => {
        process.argv = ['node', 'ol']
        resetGlobalArgs()
    })

    it('passes undefined through when no --user is set', async () => {
        const { store, seen } = fakeStore([ADA, BOB])
        await withUserRefAware(store).active()
        expect(seen.active).toBeUndefined()
        // No existence probe when there's nothing to resolve.
        expect(seen.activeAccount).toBeUndefined()
    })

    it('substitutes the global --user ref on a no-arg call', async () => {
        setUserFlag('Bob')
        const { store, seen } = fakeStore([ADA, BOB])
        const snapshot = await withUserRefAware(store).active()
        expect(seen.active).toBe('Bob')
        expect(snapshot?.token).toBe('tok:Bob')
    })

    it('lets an explicit ref win over the global --user', async () => {
        setUserFlag('Bob')
        const { store, seen } = fakeStore([ADA, BOB])
        await withUserRefAware(store).active('id-ada')
        expect(seen.active).toBe('id-ada')
    })

    it('throws ACCOUNT_NOT_FOUND when the global ref matches nothing', async () => {
        setUserFlag('nobody')
        const { store } = fakeStore([ADA, BOB])
        await expect(withUserRefAware(store).active()).rejects.toMatchObject({
            code: 'ACCOUNT_NOT_FOUND',
        })
        // And it is a typed CliError, not a bare Error.
        await expect(withUserRefAware(store).active()).rejects.toBeInstanceOf(BaseCliError)
    })

    it('applies the ref to activeBundle, activeAccount, and clear too', async () => {
        setUserFlag('Ada')
        const { store, seen } = fakeStore([ADA, BOB])
        const wrapped = withUserRefAware(store)
        await wrapped.activeBundle()
        await wrapped.activeAccount()
        await wrapped.clear()
        expect(seen.activeBundle).toBe('Ada')
        expect(seen.activeAccount).toBe('Ada')
        expect(seen.clear).toBe('Ada')
    })
})
