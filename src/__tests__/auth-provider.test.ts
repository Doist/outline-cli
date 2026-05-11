import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_XDG = join(tmpdir(), `outline-cli-test-${process.pid}-auth-provider`)
const TEST_CONFIG_DIR = join(TEST_XDG, 'outline-cli')
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json')

vi.mock('../transport/fetch-with-retry.js', () => ({
    fetchWithRetry: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    apiRequest: vi.fn(),
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
        it('posts form-encoded token exchange via fetchWithRetry and returns access token', async () => {
            const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
            vi.mocked(fetchWithRetry).mockResolvedValue({
                ok: true,
                json: async () => ({ access_token: 'tok-abc' }),
            } as Response)

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
            expect(fetchWithRetry).toHaveBeenCalledTimes(1)
            const args = vi.mocked(fetchWithRetry).mock.calls[0][0]
            expect(args.url).toBe('https://wiki.example.com/oauth/token')
            expect(args.options.method).toBe('POST')
            expect(args.options.headers).toMatchObject({
                'Content-Type': 'application/x-www-form-urlencoded',
            })
            const body = new URLSearchParams(args.options.body as string)
            expect(body.get('grant_type')).toBe('authorization_code')
            expect(body.get('client_id')).toBe('cid-xyz')
            expect(body.get('redirect_uri')).toBe('http://localhost:54969/callback')
            expect(body.get('code_verifier')).toBe('verifier-1')
            expect(body.get('code')).toBe('auth-code')
        })

        it('surfaces provider error description on failed exchange', async () => {
            const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
            vi.mocked(fetchWithRetry).mockResolvedValue({
                ok: false,
                statusText: 'Bad Request',
                json: async () => ({
                    error: 'invalid_grant',
                    error_description: 'Authorization code expired',
                }),
            } as Response)

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
        it('calls auth.info with the unsaved token + handshake base URL and returns an OutlineAccount', async () => {
            const { apiRequest } = await import('../lib/api.js')
            vi.mocked(apiRequest).mockResolvedValue({
                data: {
                    user: { id: 'user-uuid', name: 'Ada Lovelace', email: 'ada@example.com' },
                    team: { name: 'Analytics', subdomain: 'analytics' },
                },
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

            expect(apiRequest).toHaveBeenCalledTimes(1)
            expect(apiRequest).toHaveBeenCalledWith(
                'auth.info',
                {},
                { token: 'tok-abc', baseUrl: 'https://wiki.example.com' },
            )
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
        expect(got?.token).toBe('tok-persisted')
        expect(got?.account).toEqual({
            id: 'user-uuid',
            label: 'Ada',
            baseUrl: 'https://wiki.example.com',
            oauthClientId: 'cid-xyz',
            teamName: 'Analytics',
        })
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

    it('clear removes all auth fields from the saved config', async () => {
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

        // Sanity: the file is populated with every auth key before clear.
        const before = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf8'))
        expect(before).toMatchObject({
            api_token: 'tok',
            base_url: 'https://x',
            oauth_client_id: 'c',
            auth_user_id: 'u',
            auth_user_name: 'l',
            auth_team_name: 't',
        })

        await store.clear()

        // Every auth-related key must be gone from the on-disk config.
        const after = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf8'))
        expect(after).not.toHaveProperty('api_token')
        expect(after).not.toHaveProperty('base_url')
        expect(after).not.toHaveProperty('oauth_client_id')
        expect(after).not.toHaveProperty('auth_user_id')
        expect(after).not.toHaveProperty('auth_user_name')
        expect(after).not.toHaveProperty('auth_team_name')
    })

    it('clear preserves non-auth config keys', async () => {
        writeFileSync(
            TEST_CONFIG_PATH,
            JSON.stringify({ api_token: 'tok', auth_user_id: 'u', update_channel: 'pre-release' }),
        )
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        const store = createOutlineTokenStore()
        await store.clear()
        const after = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf8'))
        expect(after).toEqual({ update_channel: 'pre-release' })
    })
})
