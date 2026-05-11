import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_XDG = join(tmpdir(), `outline-cli-test-${process.pid}-auth-provider`)
const TEST_CONFIG_DIR = join(TEST_XDG, 'outline-cli')
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json')

vi.mock('../transport/fetch-with-retry.js', () => ({ fetchWithRetry: vi.fn() }))
vi.mock('../lib/api.js', () => ({ apiRequest: vi.fn() }))

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
    if (existsSync(TEST_XDG)) rmSync(TEST_XDG, { recursive: true })
    delete process.env.XDG_CONFIG_HOME
})

describe('OutlineAuthProvider', () => {
    it('authorize builds an outline /oauth/authorize URL with PKCE params from flags', async () => {
        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const result = await createOutlineAuthProvider().authorize({
            redirectUri: 'http://localhost:54969/callback',
            state: 'state-123',
            scopes: [],
            readOnly: false,
            flags: { baseUrl: 'https://wiki.example.com/', clientId: 'cid-xyz' },
            handshake: {},
        })

        const url = new URL(result.authorizeUrl)
        expect(url.origin + url.pathname).toBe('https://wiki.example.com/oauth/authorize')
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            client_id: 'cid-xyz',
            response_type: 'code',
            redirect_uri: 'http://localhost:54969/callback',
            state: 'state-123',
            code_challenge_method: 'S256',
        })
        expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)

        const handshake = result.handshake as Record<string, string>
        expect(handshake).toMatchObject({
            baseUrl: 'https://wiki.example.com',
            clientId: 'cid-xyz',
        })
        expect(handshake.codeVerifier?.length).toBeGreaterThan(40)
    })

    it('exchangeCode posts via fetchWithRetry and surfaces provider errors', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        vi.mocked(fetchWithRetry).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: 'tok-abc' }),
        } as Response)

        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const provider = createOutlineAuthProvider()
        const handshake = {
            baseUrl: 'https://wiki.example.com',
            clientId: 'cid-xyz',
            codeVerifier: 'verifier-1',
        }

        const result = await provider.exchangeCode({
            code: 'auth-code',
            state: 's',
            redirectUri: 'http://localhost:54969/callback',
            handshake,
        })
        expect(result.accessToken).toBe('tok-abc')

        const args = vi.mocked(fetchWithRetry).mock.calls[0][0]
        expect(args.url).toBe('https://wiki.example.com/oauth/token')
        const body = new URLSearchParams(args.options.body as string)
        expect(Object.fromEntries(body)).toEqual({
            grant_type: 'authorization_code',
            client_id: 'cid-xyz',
            redirect_uri: 'http://localhost:54969/callback',
            code_verifier: 'verifier-1',
            code: 'auth-code',
        })

        vi.mocked(fetchWithRetry).mockResolvedValueOnce({
            ok: false,
            statusText: 'Bad Request',
            json: async () => ({ error_description: 'Authorization code expired' }),
        } as Response)
        await expect(
            provider.exchangeCode({
                code: 'c',
                state: 's',
                redirectUri: 'http://localhost:54969/callback',
                handshake,
            }),
        ).rejects.toThrow('OAuth token exchange failed: Authorization code expired')
    })

    it('validateToken calls auth.info with the unsaved token and builds an OutlineAccount', async () => {
        const { apiRequest } = await import('../lib/api.js')
        vi.mocked(apiRequest).mockResolvedValue({
            data: {
                user: { id: 'user-uuid', name: 'Ada Lovelace', email: 'ada@example.com' },
                team: { name: 'Analytics', subdomain: 'analytics' },
            },
        })

        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const account = await createOutlineAuthProvider().validateToken({
            token: 'tok-abc',
            handshake: { baseUrl: 'https://wiki.example.com', clientId: 'cid-xyz' },
        })

        expect(account).toEqual({
            id: 'user-uuid',
            label: 'Ada Lovelace',
            baseUrl: 'https://wiki.example.com',
            oauthClientId: 'cid-xyz',
            teamName: 'Analytics',
        })
        expect(apiRequest).toHaveBeenCalledWith(
            'auth.info',
            {},
            { token: 'tok-abc', baseUrl: 'https://wiki.example.com' },
        )
    })
})

describe('OutlineTokenStore', () => {
    const sampleAccount = {
        id: 'user-uuid',
        label: 'Ada',
        baseUrl: 'https://wiki.example.com',
        oauthClientId: 'cid-xyz',
        teamName: 'Analytics',
    }

    it('round-trips token + account through the config file', async () => {
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        const store = createOutlineTokenStore()
        await store.set(sampleAccount, 'tok-persisted')
        const got = await store.active()
        expect(got).toEqual({ token: 'tok-persisted', account: sampleAccount })
    })

    it('active returns null when the saved token predates the persisted-identity fields', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ api_token: 'legacy-tok' }))
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        await expect(createOutlineTokenStore().active()).resolves.toBeNull()
    })

    it('clear strips every auth field but preserves unrelated config keys', async () => {
        writeFileSync(
            TEST_CONFIG_PATH,
            JSON.stringify({
                api_token: 'tok',
                base_url: 'https://x',
                oauth_client_id: 'c',
                auth_user_id: 'u',
                auth_user_name: 'l',
                auth_team_name: 't',
                update_channel: 'pre-release',
            }),
        )
        const { createOutlineTokenStore } = await import('../lib/auth-provider.js')
        await createOutlineTokenStore().clear()
        const after = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf8'))
        expect(after).toEqual({ update_channel: 'pre-release' })
    })
})
