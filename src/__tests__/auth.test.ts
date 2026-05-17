import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SKIPPED_RESULT } from './_fixtures/auth.js'

const TEST_XDG = join(tmpdir(), `outline-cli-test-${process.pid}-auth`)
const TEST_CONFIG_DIR = join(TEST_XDG, 'outline-cli')
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json')

// Force a `skipped` migration so the runtime falls back to the legacy
// plaintext snapshot — the v1 token in these fixtures has no live API
// behind it. Mocking `runMigrateLegacyAuth` directly is more robust than
// stubbing transitive network deps: tests don't have to know how
// migration internally decides to skip.
vi.mock('../lib/migrate-auth.js', () => ({
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
    })

    it('getApiToken reads from env var first', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const { getApiToken } = await import('../lib/auth.js')
        await expect(getApiToken()).resolves.toBe('env-token')
    })

    it('getApiToken falls back to the legacy plaintext config token', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ api_token: 'file-token' }))
        const { getApiToken } = await import('../lib/auth.js')
        await expect(getApiToken()).resolves.toBe('file-token')
    })

    it('getApiToken throws when no token available', async () => {
        const { getApiToken } = await import('../lib/auth.js')
        await expect(getApiToken()).rejects.toThrow('No API token found')
    })

    it('getBaseUrl returns env var first', async () => {
        process.env.OUTLINE_URL = 'https://custom.example.com'
        const { getBaseUrl } = await import('../lib/auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://custom.example.com')
    })

    it('getBaseUrl strips trailing slash', async () => {
        process.env.OUTLINE_URL = 'https://custom.example.com/'
        const { getBaseUrl } = await import('../lib/auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://custom.example.com')
    })

    it('getBaseUrl returns default when nothing configured', async () => {
        const { getBaseUrl } = await import('../lib/auth.js')
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
        const { getBaseUrl } = await import('../lib/auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://wiki.example.com')
    })

    it('getBaseUrl reads from the legacy v1 base_url slot', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ base_url: 'https://legacy.example.com' }))
        const { getBaseUrl } = await import('../lib/auth.js')
        await expect(getBaseUrl()).resolves.toBe('https://legacy.example.com')
    })

    it('getOAuthClientId returns env var first', async () => {
        process.env.OUTLINE_OAUTH_CLIENT_ID = 'env-client-id'
        const { getOAuthClientId } = await import('../lib/auth.js')
        await expect(getOAuthClientId()).resolves.toBe('env-client-id')
    })

    it('getOAuthClientId reads from the legacy v1 config slot', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ oauth_client_id: 'file-client-id' }))
        const { getOAuthClientId } = await import('../lib/auth.js')
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
        const { getOAuthClientId } = await import('../lib/auth.js')
        await expect(getOAuthClientId()).resolves.toBe('cid-record')
    })
})
