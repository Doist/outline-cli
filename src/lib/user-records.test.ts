import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORED_ACCOUNT, STORED_USER_ADA as ADA } from '../_fixtures/auth.js'

const configMock = vi.hoisted(() => ({
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
}))

vi.mock('./config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./config.js')>()
    return { ...actual, getConfig: configMock.getConfig, updateConfig: configMock.updateConfig }
})

const GRACE = {
    id: 'grace-uuid',
    name: 'Grace',
    base_url: 'https://other.example.com',
} as const

describe('createOutlineUserRecordStore', () => {
    beforeEach(() => {
        configMock.getConfig.mockReset().mockResolvedValue({})
        configMock.updateConfig.mockReset().mockResolvedValue(undefined)
    })

    it('list() maps StoredUser → UserRecord, surfacing token as fallbackToken when present', async () => {
        configMock.getConfig.mockResolvedValue({
            users: [ADA, { ...GRACE, token: '  plaintext-token  ' }],
        })
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        const records = await createOutlineUserRecordStore().list()

        expect(records).toHaveLength(2)
        expect(records[0]).toEqual({ account: STORED_ACCOUNT })
        expect(records[0].fallbackToken).toBeUndefined()
        expect(records[1].account.id).toBe('grace-uuid')
        expect(records[1].fallbackToken).toBe('plaintext-token')
    })

    it('upsert() appends a brand-new record', async () => {
        configMock.getConfig.mockResolvedValue({ users: [ADA] })
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        await createOutlineUserRecordStore().upsert({
            account: {
                id: 'grace-uuid',
                label: 'Grace',
                baseUrl: 'https://other.example.com',
                oauthClientId: '',
            },
        })

        expect(configMock.updateConfig).toHaveBeenCalledWith({
            users: [
                ADA,
                { id: 'grace-uuid', name: 'Grace', base_url: 'https://other.example.com' },
            ],
        })
    })

    it('upsert() REPLACES an existing record in-place (preserves order, drops absent fallbackToken)', async () => {
        // Critical: an absent `fallbackToken` on the new record must
        // erase any prior plaintext slot. Cli-core's contract says
        // `upsert` is replace-not-merge so a stale fallback can't
        // shadow a fresh keyring-backed write.
        configMock.getConfig.mockResolvedValue({
            users: [{ ...ADA, token: 'stale-plaintext' }, GRACE],
        })
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        await createOutlineUserRecordStore().upsert({ account: STORED_ACCOUNT })

        expect(configMock.updateConfig).toHaveBeenCalledWith({
            users: [ADA, GRACE],
        })
    })

    it('upsert() persists fallbackToken back to the StoredUser.token slot', async () => {
        configMock.getConfig.mockResolvedValue({ users: [] })
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        await createOutlineUserRecordStore().upsert({
            account: STORED_ACCOUNT,
            fallbackToken: 'wsl-plaintext',
        })

        expect(configMock.updateConfig).toHaveBeenCalledWith({
            users: [{ ...ADA, token: 'wsl-plaintext' }],
        })
    })

    it('round-trips expiry + refresh flag, but never persists the refresh token in plaintext', async () => {
        // The expiry/flag metadata must round-trip (proactive refresh needs the
        // expiry), but the refresh token is a long-lived secret and must stay
        // in the secure store only — `fallbackRefreshToken` is dropped, never
        // written to config, even when cli-core supplies it (keyring offline).
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        await createOutlineUserRecordStore().upsert({
            account: STORED_ACCOUNT,
            accessTokenExpiresAt: 1_700_000_000_000,
            refreshTokenExpiresAt: 1_800_000_000_000,
            hasRefreshToken: true,
            fallbackRefreshToken: 'plain-refresh',
        })

        const stored = {
            ...ADA,
            access_token_expires_at: 1_700_000_000_000,
            refresh_token_expires_at: 1_800_000_000_000,
            has_refresh_token: true,
        }
        const [[written]] = configMock.updateConfig.mock.calls
        expect(written).toEqual({ users: [stored] })
        expect(written.users[0]).not.toHaveProperty('refresh_token')

        // ...and back out through list() — still no refresh material.
        configMock.getConfig.mockResolvedValue({ users: [stored] })
        const [record] = await createOutlineUserRecordStore().list()
        expect(record).toEqual({
            account: STORED_ACCOUNT,
            accessTokenExpiresAt: 1_700_000_000_000,
            refreshTokenExpiresAt: 1_800_000_000_000,
            hasRefreshToken: true,
        })
        expect(record.fallbackRefreshToken).toBeUndefined()
    })

    it('remove() drops the matching record', async () => {
        configMock.getConfig.mockResolvedValue({ users: [ADA, GRACE] })
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        await createOutlineUserRecordStore().remove('user-uuid')

        expect(configMock.updateConfig).toHaveBeenCalledWith({ users: [GRACE] })
    })

    it('remove() also clears default_user_id when it matched the removed record', async () => {
        configMock.getConfig.mockResolvedValue({
            users: [ADA, GRACE],
            default_user_id: 'user-uuid',
        })
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        await createOutlineUserRecordStore().remove('user-uuid')

        expect(configMock.updateConfig).toHaveBeenCalledWith({
            users: [GRACE],
            default_user_id: undefined,
        })
    })

    it('remove() is a no-op when the id is unknown (does not touch config)', async () => {
        configMock.getConfig.mockResolvedValue({ users: [ADA] })
        const { createOutlineUserRecordStore } = await import('./user-records.js')

        await createOutlineUserRecordStore().remove('nobody')

        expect(configMock.updateConfig).not.toHaveBeenCalled()
    })

    it('getDefaultId / setDefaultId round-trip via the default_user_id config field', async () => {
        const { createOutlineUserRecordStore } = await import('./user-records.js')
        const store = createOutlineUserRecordStore()

        configMock.getConfig.mockResolvedValueOnce({})
        await expect(store.getDefaultId()).resolves.toBeNull()

        configMock.getConfig.mockResolvedValueOnce({ default_user_id: 'user-uuid' })
        await expect(store.getDefaultId()).resolves.toBe('user-uuid')

        await store.setDefaultId('grace-uuid')
        expect(configMock.updateConfig).toHaveBeenCalledWith({ default_user_id: 'grace-uuid' })

        await store.setDefaultId(null)
        expect(configMock.updateConfig).toHaveBeenLastCalledWith({ default_user_id: undefined })
    })
})

describe('getDefaultUserRecord', () => {
    it('returns null when no users are stored', async () => {
        const { getDefaultUserRecord } = await import('./user-records.js')
        expect(getDefaultUserRecord({})).toBeNull()
        expect(getDefaultUserRecord({ users: [] })).toBeNull()
    })

    it('returns the pinned default when default_user_id matches', async () => {
        const { getDefaultUserRecord } = await import('./user-records.js')
        const record = getDefaultUserRecord({
            users: [ADA, GRACE],
            default_user_id: 'grace-uuid',
        })
        expect(record?.account.id).toBe('grace-uuid')
    })

    it('falls back to the first record when default_user_id is absent or stale', async () => {
        const { getDefaultUserRecord } = await import('./user-records.js')

        const noDefault = getDefaultUserRecord({ users: [ADA, GRACE] })
        expect(noDefault?.account.id).toBe('user-uuid')

        const staleDefault = getDefaultUserRecord({
            users: [ADA, GRACE],
            default_user_id: 'nobody',
        })
        expect(staleDefault?.account.id).toBe('user-uuid')
    })
})
