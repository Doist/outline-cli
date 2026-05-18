import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { okResponse, STORED_ACCOUNT } from './_fixtures/auth.js'

// Mock the network so the provider's POST is observable.
vi.mock('../transport/fetch-with-retry.js', () => ({ fetchWithRetry: vi.fn() }))
vi.mock('../lib/api.js', () => ({ apiRequest: vi.fn() }))

// Skip the migration path — these tests focus on the bundle/refresh wiring,
// not the legacy v1 -> v2 dance which is already covered elsewhere.
vi.mock('../lib/migrate-auth.js', () => ({
    runMigrateLegacyAuth: vi.fn(async () => ({
        status: 'no-legacy-state' as const,
    })),
}))

const configMocks = vi.hoisted(() => ({
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
}))

vi.mock('../lib/config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/config.js')>()
    return {
        ...actual,
        getConfigPath: () => '/tmp/test/outline-cli/config.json',
        getConfig: configMocks.getConfig,
        updateConfig: configMocks.updateConfig,
    }
})

describe('exchangeCode persists the full bundle (refresh + expiry)', () => {
    beforeEach(() => {
        configMocks.getConfig.mockReset().mockResolvedValue({})
        configMocks.updateConfig.mockReset().mockResolvedValue(undefined)
        vi.resetModules()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('returns accessToken + refreshToken + accessTokenExpiresAt when the token endpoint includes them', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        vi.mocked(fetchWithRetry).mockResolvedValueOnce(
            okResponse({
                access_token: 'at-1',
                refresh_token: 'rt-1',
                expires_in: 3600,
            }),
        )

        const before = Date.now()
        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const result = await createOutlineAuthProvider().exchangeCode({
            code: 'c',
            state: 's',
            redirectUri: 'http://localhost:54969/callback',
            handshake: {
                baseUrl: 'https://wiki.example.com',
                clientId: 'cid-xyz',
                codeVerifier: 'v',
            },
        })

        expect(result.accessToken).toBe('at-1')
        expect(result.refreshToken).toBe('rt-1')
        // expires_in=3600 → 1 hour into the future, with a few ms slop.
        expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000)
        expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000 + 1000)
    })

    it('returns just accessToken when the token endpoint omits refresh + expiry (server config)', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        vi.mocked(fetchWithRetry).mockResolvedValueOnce(okResponse({ access_token: 'at-1' }))

        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const result = await createOutlineAuthProvider().exchangeCode({
            code: 'c',
            state: 's',
            redirectUri: 'http://localhost:54969/callback',
            handshake: {
                baseUrl: 'https://wiki.example.com',
                clientId: 'cid-xyz',
                codeVerifier: 'v',
            },
        })

        expect(result.accessToken).toBe('at-1')
        expect(result.refreshToken).toBeUndefined()
        expect(result.expiresAt).toBeUndefined()
    })
})

describe('refreshToken on the Outline provider', () => {
    beforeEach(() => {
        configMocks.getConfig.mockReset().mockResolvedValue({})
        configMocks.updateConfig.mockReset().mockResolvedValue(undefined)
        vi.resetModules()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('POSTs grant_type=refresh_token with stored refresh + clientId, no PKCE verifier', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        vi.mocked(fetchWithRetry).mockResolvedValueOnce(
            okResponse({
                access_token: 'new-at',
                refresh_token: 'new-rt',
                expires_in: 1800,
            }),
        )

        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const result = await createOutlineAuthProvider().refreshToken!({
            refreshToken: 'old-rt',
            account: STORED_ACCOUNT,
            handshake: {},
        })

        expect(result.accessToken).toBe('new-at')
        expect(result.refreshToken).toBe('new-rt')
        expect(result.account).toEqual(STORED_ACCOUNT)

        const call = vi.mocked(fetchWithRetry).mock.calls[0][0]
        expect(call.url).toBe('https://wiki.example.com/oauth/token')
        const body = new URLSearchParams(call.options.body as string)
        expect(body.get('grant_type')).toBe('refresh_token')
        expect(body.get('refresh_token')).toBe('old-rt')
        expect(body.get('client_id')).toBe('cid-xyz')
        expect(body.has('code_verifier')).toBe(false)
        expect(body.has('client_secret')).toBe(false)
    })

    it('throws when the stored account has no baseUrl or oauthClientId (corrupt record)', async () => {
        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        await expect(
            createOutlineAuthProvider().refreshToken!({
                refreshToken: 'rt',
                account: { ...STORED_ACCOUNT, oauthClientId: undefined },
                handshake: {},
            }),
        ).rejects.toThrow(/baseUrl or oauthClientId/)
    })

    it('surfaces the server error_description on non-2xx', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        vi.mocked(fetchWithRetry).mockResolvedValueOnce({
            ok: false,
            statusText: 'Bad Request',
            json: async () => ({ error: 'invalid_grant', error_description: 'token revoked' }),
        } as Response)

        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        await expect(
            createOutlineAuthProvider().refreshToken!({
                refreshToken: 'rt',
                account: STORED_ACCOUNT,
                handshake: {},
            }),
        ).rejects.toThrow(/OAuth refresh failed: token revoked/)
    })
})

describe('getApiToken integration with refreshAccessToken', () => {
    const TEMP_ENV: Record<string, string | undefined> = {}

    beforeEach(() => {
        configMocks.getConfig.mockReset().mockResolvedValue({})
        configMocks.updateConfig.mockReset().mockResolvedValue(undefined)
        TEMP_ENV.OUTLINE_API_TOKEN = process.env.OUTLINE_API_TOKEN
        delete process.env.OUTLINE_API_TOKEN
        vi.resetModules()
    })

    afterEach(() => {
        if (TEMP_ENV.OUTLINE_API_TOKEN !== undefined) {
            process.env.OUTLINE_API_TOKEN = TEMP_ENV.OUTLINE_API_TOKEN
        }
        vi.clearAllMocks()
    })

    it('env-var token short-circuits and never consults refreshAccessToken', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-tok'
        const { getApiToken } = await import('../lib/auth.js')
        await expect(getApiToken()).resolves.toBe('env-tok')
    })

    it('maps NOT_AUTHENTICATED from cli-core into NoTokenError (matches the existing UX)', async () => {
        // No env var, no stored credentials, no legacy snapshot — refresh
        // helper throws NOT_AUTHENTICATED which our adapter collapses to the
        // existing "No API token found" error so the user sees a single
        // recovery hint instead of two competing codes.
        const { getApiToken } = await import('../lib/auth.js')
        await expect(getApiToken()).rejects.toThrow('No API token found')
    })
})
