import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errResponse, okResponse } from './_fixtures/auth.js'

const fetchMock = vi.hoisted(() => ({ fetchWithRetry: vi.fn() }))
vi.mock('../transport/fetch-with-retry.js', () => fetchMock)

const cliCoreMock = vi.hoisted(() => ({ migrateLegacyAuth: vi.fn() }))
vi.mock('@doist/cli-core/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@doist/cli-core/auth')>()
    return { ...actual, migrateLegacyAuth: cliCoreMock.migrateLegacyAuth }
})

const configMock = vi.hoisted(() => ({
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
}))
vi.mock('../lib/config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/config.js')>()
    return { ...actual, getConfig: configMock.getConfig, updateConfig: configMock.updateConfig }
})

/** Run the wrapper once, return the options handed to cli-core. */
async function captureCliCoreOptions() {
    cliCoreMock.migrateLegacyAuth.mockResolvedValue({ status: 'no-legacy-state' })
    const { runMigrateLegacyAuth } = await import('../lib/migrate-auth.js')
    await runMigrateLegacyAuth()
    return cliCoreMock.migrateLegacyAuth.mock.calls[0][0]
}

describe('runMigrateLegacyAuth', () => {
    beforeEach(() => {
        cliCoreMock.migrateLegacyAuth.mockReset()
        fetchMock.fetchWithRetry.mockReset()
        configMock.getConfig.mockReset().mockResolvedValue({})
        configMock.updateConfig.mockReset().mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.resetModules()
    })

    it('hands cli-core the outline-cli wiring (service, legacy slot, records store, log prefix)', async () => {
        const opts = await captureCliCoreOptions()
        expect(opts.serviceName).toBe('outline-cli')
        expect(opts.legacyAccount).toBe('api-token')
        expect(opts.logPrefix).toBe('outline-cli')
        expect(opts.silent).toBe(true)
        expect(typeof opts.userRecords.list).toBe('function')
    })

    it('identifyAccount POSTs auth.info to the configured base URL and builds an OutlineAccount', async () => {
        const opts = await captureCliCoreOptions()
        configMock.getConfig.mockResolvedValue({
            base_url: 'https://wiki.example.com/',
            oauth_client_id: 'cid-xyz',
        })
        fetchMock.fetchWithRetry.mockResolvedValue(
            okResponse({
                data: { user: { id: 'user-uuid', name: 'Ada' }, team: { name: 'Analytics' } },
            }),
        )

        const account = await opts.identifyAccount('tk_v1')

        const args = fetchMock.fetchWithRetry.mock.calls[0][0]
        expect(args.url).toBe('https://wiki.example.com/api/auth.info')
        expect(args.options.headers.Authorization).toBe('Bearer tk_v1')
        // Critical: timeout must be set or a stalled connection during
        // lazy migration can hang every CLI invocation. Guards the
        // `IDENTIFY_TIMEOUT_MS` constant in migrate-auth.ts.
        expect(args.options.timeout).toBe(10_000)
        expect(account).toEqual({
            id: 'user-uuid',
            label: 'Ada',
            baseUrl: 'https://wiki.example.com',
            oauthClientId: 'cid-xyz',
            teamName: 'Analytics',
        })
    })

    it('identifyAccount throws when auth.info responds with !ok (triggers identify-failed)', async () => {
        const opts = await captureCliCoreOptions()
        fetchMock.fetchWithRetry.mockResolvedValue(errResponse(401, 'Unauthorized'))
        await expect(opts.identifyAccount('tk')).rejects.toThrow('auth.info failed: 401')
    })
})
