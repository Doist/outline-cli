import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SKIPPED_RESULT } from '../_fixtures/auth.js'

const TEST_XDG = join(tmpdir(), `outline-cli-test-${process.pid}-auth`)
const TEST_CONFIG_DIR = join(TEST_XDG, 'outline-cli')
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json')

// Force a `skipped` migration so the runtime falls back to the legacy
// plaintext snapshot — the v1 token in these fixtures has no live API
// behind it. Mocking `runMigrateLegacyAuth` directly is more robust than
// stubbing transitive network deps: tests don't have to know how
// migration internally decides to skip.
vi.mock('./migrate-auth.js', () => ({
    runMigrateLegacyAuth: vi.fn(async () => SKIPPED_RESULT),
}))

describe('auth', () => {
    beforeEach(() => {
        process.env.XDG_CONFIG_HOME = TEST_XDG
        mkdirSync(TEST_CONFIG_DIR, { recursive: true })
        delete process.env.OUTLINE_API_TOKEN
        delete process.env.OUTLINE_URL
        delete process.env.OUTLINE_OAUTH_CLIENT_ID
        vi.resetModules()
    })

    afterEach(() => {
        if (existsSync(TEST_XDG)) {
            rmSync(TEST_XDG, { recursive: true })
        }
        delete process.env.XDG_CONFIG_HOME
        process.argv = ['node', 'ol']
    })

    it('getApiToken reads from env var first', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const { getApiToken } = await import('./auth.js')
        await expect(getApiToken()).resolves.toBe('env-token')
    })

    it('getApiToken falls back to the legacy plaintext config token', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ api_token: 'file-token' }))
        const { getApiToken } = await import('./auth.js')
        await expect(getApiToken()).resolves.toBe('file-token')
    })

    it('getApiToken throws when no token available', async () => {
        const { getApiToken } = await import('./auth.js')
        await expect(getApiToken()).rejects.toThrow('No API token found')
    })

    it('getBaseUrl returns env var first', async () => {
        process.env.OUTLINE_URL = 'https://custom.example.com'
        const { getBaseUrl } = await import('./auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://custom.example.com')
    })

    it('getBaseUrl strips trailing slash', async () => {
        process.env.OUTLINE_URL = 'https://custom.example.com/'
        const { getBaseUrl } = await import('./auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://custom.example.com')
    })

    it('getBaseUrl returns default when nothing configured', async () => {
        const { getBaseUrl } = await import('./auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://app.getoutline.com')
    })

    it('getBaseUrl reads from the default user record (v2)', async () => {
        writeFileSync(
            TEST_CONFIG_PATH,
            JSON.stringify({
                config_version: 2,
                users: [
                    {
                        id: 'u',
                        name: 'Ada',
                        base_url: 'https://wiki.example.com',
                        token: 'tok',
                    },
                ],
            }),
        )
        const { getBaseUrl } = await import('./auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://wiki.example.com')
    })

    it('getBaseUrl reads from the legacy v1 base_url slot', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ base_url: 'https://legacy.example.com' }))
        const { getBaseUrl } = await import('./auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://legacy.example.com')
    })

    it('getOAuthClientId returns env var first', async () => {
        process.env.OUTLINE_OAUTH_CLIENT_ID = 'env-client-id'
        const { getOAuthClientId } = await import('./auth.js')
        await expect(getOAuthClientId()).resolves.toBe('env-client-id')
    })

    it('getOAuthClientId reads from the legacy v1 config slot', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ oauth_client_id: 'file-client-id' }))
        const { getOAuthClientId } = await import('./auth.js')
        await expect(getOAuthClientId()).resolves.toBe('file-client-id')
    })

    it('getOAuthClientId reads from the default user record (v2)', async () => {
        writeFileSync(
            TEST_CONFIG_PATH,
            JSON.stringify({
                config_version: 2,
                users: [
                    {
                        id: 'u',
                        name: 'Ada',
                        oauth_client_id: 'cid-record',
                        token: 'tok',
                    },
                ],
            }),
        )
        const { getOAuthClientId } = await import('./auth.js')
        await expect(getOAuthClientId()).resolves.toBe('cid-record')
    })

    describe('global --user selection', () => {
        const TWO_USERS = JSON.stringify({
            config_version: 2,
            users: [
                {
                    id: 'id-ada',
                    name: 'Ada',
                    base_url: 'https://ada.example.com',
                    oauth_client_id: 'cid-ada',
                    token: 'tok-ada',
                },
                {
                    id: 'id-bob',
                    name: 'Bob',
                    base_url: 'https://bob.example.com',
                    oauth_client_id: 'cid-bob',
                    token: 'tok-bob',
                },
            ],
            default_user_id: 'id-ada',
        })

        function withUser(ref: string) {
            writeFileSync(TEST_CONFIG_PATH, TWO_USERS)
            process.argv = ['node', 'ol', '--user', ref, 'document', 'list']
        }

        it('getRequestContext resolves the --user account instance + handshake', async () => {
            withUser('Bob')
            const { getRequestContext } = await import('./auth.js')
            await expect(getRequestContext()).resolves.toEqual({
                baseUrl: 'https://bob.example.com',
                handshake: { baseUrl: 'https://bob.example.com', clientId: 'cid-bob' },
            })
        })

        it('getRequestContext falls back to the default account without --user', async () => {
            writeFileSync(TEST_CONFIG_PATH, TWO_USERS)
            const { getRequestContext } = await import('./auth.js')
            await expect(getRequestContext()).resolves.toEqual({
                baseUrl: 'https://ada.example.com',
            })
        })

        it('getBaseUrl / getOAuthClientId stay account-agnostic under --user (login unaffected)', async () => {
            withUser('Bob')
            const { getBaseUrl, getOAuthClientId } = await import('./auth.js')
            await expect(getBaseUrl()).resolves.toBe('https://ada.example.com')
            await expect(getOAuthClientId()).resolves.toBe('cid-ada')
        })

        it('getApiToken returns the --user account token', async () => {
            withUser('Bob')
            const { getApiToken } = await import('./auth.js')
            await expect(getApiToken()).resolves.toBe('tok-bob')
        })

        it('getApiToken rejects with ACCOUNT_NOT_FOUND for an unknown --user', async () => {
            withUser('Nobody')
            const { getApiToken } = await import('./auth.js')
            await expect(getApiToken()).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' })
        })

        it('env token wins: --user is ignored on the request path', async () => {
            withUser('Bob')
            process.env.OUTLINE_API_TOKEN = 'env-token'
            const { getApiToken, getRequestContext } = await import('./auth.js')
            await expect(getApiToken()).resolves.toBe('env-token')
            await expect(getRequestContext()).resolves.toEqual({
                baseUrl: 'https://ada.example.com',
            })
        })
    })

    it('reactiveRefresh maps an unrefreshable token to NoTokenError (prompts re-login)', async () => {
        // A stored access token with no refresh token can't be rotated, so the
        // real refreshAccessToken throws AUTH_REFRESH_UNAVAILABLE — which the
        // helper surfaces as a re-login prompt rather than a raw refresh error.
        writeFileSync(
            TEST_CONFIG_PATH,
            JSON.stringify({
                config_version: 2,
                users: [
                    {
                        id: 'u',
                        name: 'Ada',
                        base_url: 'https://wiki.example.com',
                        oauth_client_id: 'cid',
                        token: 'plain-access',
                    },
                ],
                default_user_id: 'u',
            }),
        )
        const { reactiveRefresh } = await import('./auth.js')

        let caught: unknown
        try {
            await reactiveRefresh()
        } catch (e) {
            caught = e
        }
        expect((caught as { code?: string }).code).toBe('NO_TOKEN')
    })
})
