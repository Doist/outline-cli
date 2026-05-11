import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_XDG = join(tmpdir(), `outline-cli-test-${process.pid}-auth-provider`)
const TEST_CONFIG_DIR = join(TEST_XDG, 'outline-cli')
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json')

vi.mock('../transport/fetch-with-retry.js', () => ({
    fetchWithRetry: vi.fn(),
}))

describe('OutlineAuthProvider', () => {
    beforeEach(() => {
        process.env.XDG_CONFIG_HOME = TEST_XDG
        mkdirSync(TEST_CONFIG_DIR, { recursive: true })
        delete process.env.OUTLINE_API_TOKEN
        delete process.env.OUTLINE_URL
        delete process.env.OUTLINE_OAUTH_CLIENT_ID
        vi.resetModules()
        vi.clearAllMocks()
    })

    afterEach(() => {
        if (existsSync(TEST_XDG)) {
            rmSync(TEST_XDG, { recursive: true })
        }
        delete process.env.XDG_CONFIG_HOME
        vi.unstubAllGlobals()
    })

    describe('authorize', () => {
        it('builds an outline authorize URL with PKCE params from explicit flags', async () => {
            const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
            const provider = createOutlineAuthProvider()

            const result = await provider.authorize({
                redirectUri: 'http://localhost:54969/callback',
                state: 'state-123',
                scopes: [],
                readOnly: false,
                flags: { baseUrl: 'https://wiki.example.com/', clientId: 'cid-xyz' },
                handshake: {},
            })

            const url = new URL(result.authorizeUrl)
            expect(url.origin + url.pathname).toBe('https://wiki.example.com/oauth/authorize')
            expect(url.searchParams.get('client_id')).toBe('cid-xyz')
            expect(url.searchParams.get('response_type')).toBe('code')
            expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:54969/callback')
            expect(url.searchParams.get('state')).toBe('state-123')
            expect(url.searchParams.get('code_challenge_method')).toBe('S256')
            expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)

            const handshake = result.handshake as Record<string, string>
            expect(handshake.baseUrl).toBe('https://wiki.example.com')
            expect(handshake.clientId).toBe('cid-xyz')
            expect(typeof handshake.codeVerifier).toBe('string')
            expect(handshake.codeVerifier.length).toBeGreaterThan(40)
        })

        it('reads base URL and client ID from environment when flags absent', async () => {
            process.env.OUTLINE_URL = 'https://env.example.com/'
            // OUTLINE_OAUTH_CLIENT_ID is read via getOAuthClientId
            process.env.OUTLINE_OAUTH_CLIENT_ID = 'env-cid'

            const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
            const provider = createOutlineAuthProvider()

            const result = await provider.authorize({
                redirectUri: 'http://localhost:54969/callback',
                state: 's',
                scopes: [],
                readOnly: false,
                flags: {},
                handshake: {},
            })
            const url = new URL(result.authorizeUrl)
            expect(url.origin).toBe('https://env.example.com')
            expect(url.searchParams.get('client_id')).toBe('env-cid')
        })
    })

    describe('exchangeCode', () => {
        it('posts form-encoded token exchange and returns access token', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ access_token: 'tok-abc' }),
            })
            vi.stubGlobal('fetch', fetchMock)

            const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
            const provider = createOutlineAuthProvider()

            const result = await provider.exchangeCode({
                code: 'auth-code',
                state: 'state-x',
                redirectUri: 'http://localhost:54969/callback',
                handshake: {
                    baseUrl: 'https://wiki.example.com',
                    clientId: 'cid-xyz',
                    codeVerifier: 'verifier-1',
                },
            })

            expect(result.accessToken).toBe('tok-abc')
            expect(fetchMock).toHaveBeenCalledTimes(1)
            const [tokenUrl, init] = fetchMock.mock.calls[0]
            expect(tokenUrl).toBe('https://wiki.example.com/oauth/token')
            expect(init.method).toBe('POST')
            expect(init.headers).toMatchObject({
                'Content-Type': 'application/x-www-form-urlencoded',
            })
            const body = new URLSearchParams(init.body as string)
            expect(body.get('grant_type')).toBe('authorization_code')
            expect(body.get('client_id')).toBe('cid-xyz')
            expect(body.get('redirect_uri')).toBe('http://localhost:54969/callback')
            expect(body.get('code_verifier')).toBe('verifier-1')
            expect(body.get('code')).toBe('auth-code')
        })

        it('surfaces provider error description on failed exchange', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: false,
                    statusText: 'Bad Request',
                    json: async () => ({
                        error: 'invalid_grant',
                        error_description: 'Authorization code expired',
                    }),
                }),
            )

            const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
            const provider = createOutlineAuthProvider()

            await expect(
                provider.exchangeCode({
                    code: 'c',
                    state: 's',
                    redirectUri: 'http://localhost:54969/callback',
                    handshake: {
                        baseUrl: 'https://wiki.example.com',
                        clientId: 'cid-xyz',
                        codeVerifier: 'verifier-1',
                    },
                }),
            ).rejects.toThrow('OAuth token exchange failed: Authorization code expired')
        })
    })

    describe('validateToken', () => {
        it('calls auth.info with handshake base URL + token and returns an OutlineAccount', async () => {
            const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
            ;(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: {
                        user: { id: 'user-uuid', name: 'Ada Lovelace', email: 'ada@example.com' },
                        team: { name: 'Analytics', subdomain: 'analytics' },
                    },
                }),
            })

            const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
            const provider = createOutlineAuthProvider()

            const account = await provider.validateToken({
                token: 'tok-abc',
                handshake: {
                    baseUrl: 'https://wiki.example.com',
                    clientId: 'cid-xyz',
                },
            })

            expect(account).toEqual({
                id: 'user-uuid',
                label: 'Ada Lovelace',
                baseUrl: 'https://wiki.example.com',
                oauthClientId: 'cid-xyz',
                teamName: 'Analytics',
            })

            expect(fetchWithRetry).toHaveBeenCalledTimes(1)
            const args = (fetchWithRetry as ReturnType<typeof vi.fn>).mock.calls[0][0]
            expect(args.url).toBe('https://wiki.example.com/api/auth.info')
            expect(args.options.headers.Authorization).toBe('Bearer tok-abc')
        })
    })
})

describe('OutlineTokenStore', () => {
    beforeEach(() => {
        process.env.XDG_CONFIG_HOME = TEST_XDG
        mkdirSync(TEST_CONFIG_DIR, { recursive: true })
        delete process.env.OUTLINE_API_TOKEN
        vi.resetModules()
    })

    afterEach(() => {
        if (existsSync(TEST_XDG)) {
            rmSync(TEST_XDG, { recursive: true })
        }
        delete process.env.XDG_CONFIG_HOME
    })

    it('set persists token + account fields and active reads them back', async () => {
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        const store = createOutlineTokenStore()

        await store.set(
            {
                id: 'user-uuid',
                label: 'Ada',
                baseUrl: 'https://wiki.example.com',
                oauthClientId: 'cid-xyz',
                teamName: 'Analytics',
            },
            'tok-persisted',
        )

        const got = await store.active()
        expect(got).not.toBeNull()
        expect(got?.token).toBe('tok-persisted')
        expect(got?.account.id).toBe('user-uuid')
        expect(got?.account.label).toBe('Ada')
        expect(got?.account.baseUrl).toBe('https://wiki.example.com')
        expect(got?.account.oauthClientId).toBe('cid-xyz')
    })

    it('active returns null when config has a token but no persisted identity', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ api_token: 'legacy-tok' }))
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        const store = createOutlineTokenStore()
        await expect(store.active()).resolves.toBeNull()
    })

    it('active returns null when no token saved', async () => {
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        const store = createOutlineTokenStore()
        await expect(store.active()).resolves.toBeNull()
    })

    it('clear removes auth fields', async () => {
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        const store = createOutlineTokenStore()
        await store.set(
            {
                id: 'u',
                label: 'l',
                baseUrl: 'https://x',
                oauthClientId: 'c',
                teamName: 't',
            },
            'tok',
        )
        await store.clear()
        await expect(store.active()).resolves.toBeNull()
    })
})
