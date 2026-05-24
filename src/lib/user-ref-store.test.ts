import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OutlineTokenStore } from './auth-provider.js'
import { BaseCliError } from './errors.js'
import { resetGlobalArgs } from './global-args.js'
import { makeOutlineAccount, type OutlineAccount } from './outline-account.js'
import { withUserRefAware } from './user-ref-store.js'

const ADA = makeOutlineAccount({ id: 'id-ada', label: 'Ada' })
const BOB = makeOutlineAccount({ id: 'id-bob', label: 'Bob' })

function fakeStore(accounts: OutlineAccount[]) {
    const calls: { method: string; ref?: string }[] = []
    const store = {
        list: async () =>
            accounts.map((account) => ({ account, isDefault: account === accounts[0] })),
        active: async (ref?: string) => {
            calls.push({ method: 'active', ref })
            return { token: `tok:${ref ?? 'default'}`, account: accounts[0] }
        },
        activeBundle: async (ref?: string) => {
            calls.push({ method: 'activeBundle', ref })
            return null
        },
        activeAccount: async (ref?: string) => {
            calls.push({ method: 'activeAccount', ref })
            return null
        },
        clear: async (ref?: string) => {
            calls.push({ method: 'clear', ref })
            return null
        },
    }
    return { store: store as unknown as OutlineTokenStore, calls }
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
        const { store, calls } = fakeStore([ADA, BOB])
        await withUserRefAware(store).active()
        expect(calls).toEqual([{ method: 'active', ref: undefined }])
    })

    it('substitutes the global --user ref on a no-arg call', async () => {
        setUserFlag('Bob')
        const { store, calls } = fakeStore([ADA, BOB])
        await withUserRefAware(store).active()
        expect(calls).toEqual([{ method: 'active', ref: 'Bob' }])
    })

    it('lets an explicit ref win over the global --user', async () => {
        setUserFlag('Bob')
        const { store, calls } = fakeStore([ADA, BOB])
        await withUserRefAware(store).active('id-ada')
        expect(calls).toEqual([{ method: 'active', ref: 'id-ada' }])
    })

    it('throws ACCOUNT_NOT_FOUND when the global ref matches nothing', async () => {
        setUserFlag('nobody')
        const { store } = fakeStore([ADA, BOB])
        let caught: unknown
        try {
            await withUserRefAware(store).active()
        } catch (err) {
            caught = err
        }
        expect(caught).toBeInstanceOf(BaseCliError)
        expect((caught as { code: string }).code).toBe('ACCOUNT_NOT_FOUND')
    })

    it('applies the ref to activeBundle, activeAccount, and clear too', async () => {
        setUserFlag('Ada')
        const { store, calls } = fakeStore([ADA, BOB])
        const wrapped = withUserRefAware(store)
        await wrapped.activeBundle()
        await wrapped.activeAccount()
        await wrapped.clear()
        expect(calls).toEqual([
            { method: 'activeBundle', ref: 'Ada' },
            { method: 'activeAccount', ref: 'Ada' },
            { method: 'clear', ref: 'Ada' },
        ])
    })
})
