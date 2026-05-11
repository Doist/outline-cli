import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_XDG = join(tmpdir(), `outline-cli-test-${process.pid}`)
const TEST_CONFIG_DIR = join(TEST_XDG, 'outline-cli')
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json')

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

    it('getApiToken reads from config file', async () => {
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

    it('saveConfig and clearConfig work', async () => {
        const { saveConfig, clearConfig, getApiToken, getOAuthClientId } =
            await import('../lib/auth.js')
        await saveConfig('test-token', 'https://wiki.test.com', 'client-id')
        await expect(getApiToken()).resolves.toBe('test-token')
        await expect(getOAuthClientId()).resolves.toBe('client-id')
        await clearConfig()
        await expect(getApiToken()).rejects.toThrow()
    })

    it('getOAuthClientId returns env var first', async () => {
        process.env.OUTLINE_OAUTH_CLIENT_ID = 'env-client-id'
        const { getOAuthClientId } = await import('../lib/auth.js')
        await expect(getOAuthClientId()).resolves.toBe('env-client-id')
    })

    it('getOAuthClientId reads from config file', async () => {
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ oauth_client_id: 'file-client-id' }))
        const { getOAuthClientId } = await import('../lib/auth.js')
        await expect(getOAuthClientId()).resolves.toBe('file-client-id')
    })
})
