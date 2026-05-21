import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    AUTH_INFO,
    errResponse,
    LEGACY_CLEAR_PAYLOAD,
    LEGACY_CONFIG,
    okResponse,
    SKIPPED_RESULT,
    STORED_ACCOUNT,
} from './_fixtures/auth.js'

vi.mock('../transport/fetch-with-retry.js', () => ({ fetchWithRetry: vi.fn() }))
vi.mock('../lib/api.js', () => ({ apiRequest: vi.fn() }))

const migrateMocks = vi.hoisted(() => ({
    runMigrateLegacyAuth: vi.fn(),
}))

vi.mock('../lib/migrate-auth.js', () => migrateMocks)

const keyringMocks = vi.hoisted(() => ({
    createKeyringTokenStore: vi.fn(),
    inner: {
        active: vi.fn(),
        activeBundle: vi.fn(),
        set: vi.fn(),
        setBundle: vi.fn(),
        clear: vi.fn(),
        list: vi.fn(),
        setDefault: vi.fn(),
        getLastStorageResult: vi.fn(),
        getLastClearResult: vi.fn(),
    },
}))

vi.mock('@doist/cli-core/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@doist/cli-core/auth')>()
    keyringMocks.createKeyringTokenStore.mockImplementation(() => keyringMocks.inner)
    return {
        ...actual,
        createKeyringTokenStore: keyringMocks.createKeyringTokenStore,
    }
})

const configMocks = vi.hoisted(() => ({
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
}))

vi.mock('../lib/config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/config.js')>()
    return {
        ...actual,
        getConfigPath: () => '/home/user/.config/outline-cli/config.json',
        getConfig: configMocks.getConfig,
        updateConfig: configMocks.updateConfig,
    }
})

const TOKEN_ENV_VAR = 'OUTLINE_API_TOKEN'

/** Reset the module-level migration memo for each test by re-importing. */
async function loadCreateOutlineTokenStore(): Promise<
    typeof import('../lib/auth-provider.js').createOutlineTokenStore
> {
    vi.resetModules()
    const mod = await import('../lib/auth-provider.js')
    return mod.createOutlineTokenStore
}

describe('createOutlineAuthProvider', () => {
    beforeEach(() => {
        delete process.env.OUTLINE_URL
        delete process.env.OUTLINE_OAUTH_CLIENT_ID
        configMocks.getConfig.mockReset().mockResolvedValue({})
        configMocks.updateConfig.mockReset().mockResolvedValue(undefined)
    })

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

        // createPkceProvider carries the verifier + resolved client id through
        // the handshake (base URL rides the provider closure, not the handshake).
        const handshake = result.handshake as Record<string, string>
        expect(handshake.clientId).toBe('cid-xyz')
        expect(handshake.codeVerifier?.length).toBeGreaterThan(40)
    })

    it('exchangeCode posts to the token endpoint via outline transport; maps failures to the typed code', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        vi.mocked(fetchWithRetry).mockResolvedValueOnce(okResponse({ access_token: 'tok-abc' }))

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
        const body = new URLSearchParams(args.options?.body as string)
        expect(Object.fromEntries(body)).toEqual({
            grant_type: 'authorization_code',
            client_id: 'cid-xyz',
            redirect_uri: 'http://localhost:54969/callback',
            code_verifier: 'verifier-1',
            code: 'auth-code',
        })

        vi.mocked(fetchWithRetry).mockResolvedValueOnce(
            errResponse(400, 'Bad Request', { error_description: 'Authorization code expired' }),
        )
        await expect(
            provider.exchangeCode({
                code: 'c',
                state: 's',
                redirectUri: 'http://localhost:54969/callback',
                handshake,
            }),
        ).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXCHANGE_FAILED' })
    })

    it('validateToken builds an OutlineAccount using the base URL captured at authorize', async () => {
        const { apiRequest } = await import('../lib/api.js')
        vi.mocked(apiRequest).mockResolvedValue({ data: AUTH_INFO })

        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const provider = createOutlineAuthProvider()
        // authorize seeds the provider's base-URL closure (from the flag),
        // which validate then reuses instead of a handshake field.
        await provider.authorize({
            redirectUri: 'http://localhost:54969/callback',
            state: 's',
            scopes: [],
            readOnly: false,
            flags: { baseUrl: 'https://wiki.example.com/', clientId: 'cid-xyz' },
            handshake: {},
        })

        const account = await provider.validateToken({
            token: 'tok-abc',
            handshake: { clientId: 'cid-xyz' },
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

    it('refreshToken rotates the bundle, resolving base URL + client id from stored config (no prompt)', async () => {
        // A fresh provider used only for silent refresh never runs authorize,
        // so the resolvers fall back to the logged-in record — never prompting.
        configMocks.getConfig.mockResolvedValue({
            users: [
                {
                    id: 'user-uuid',
                    name: 'Ada',
                    base_url: 'https://wiki.example.com',
                    oauth_client_id: 'cid-xyz',
                },
            ],
            default_user_id: 'user-uuid',
        })
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        vi.mocked(fetchWithRetry).mockResolvedValue(
            Response.json({
                access_token: 'tok-new',
                refresh_token: 'r-new',
                expires_in: 3600,
                token_type: 'bearer',
            }),
        )

        const { createOutlineAuthProvider } = await import('../lib/auth-provider.js')
        const result = await createOutlineAuthProvider().refreshToken?.({
            refreshToken: 'r-old',
            handshake: {},
        })

        expect(result?.accessToken).toBe('tok-new')
        expect(result?.refreshToken).toBe('r-new')
        const called = vi.mocked(fetchWithRetry).mock.calls[0][0]
        const calledUrl = called.url instanceof Request ? called.url.url : String(called.url)
        expect(calledUrl).toBe('https://wiki.example.com/oauth/token')
    })
})

describe('createOutlineTokenStore', () => {
    beforeEach(() => {
        delete process.env[TOKEN_ENV_VAR]
        delete process.env.OUTLINE_URL
        keyringMocks.createKeyringTokenStore.mockClear()
        keyringMocks.inner.active.mockReset().mockResolvedValue(null)
        keyringMocks.inner.activeBundle.mockReset().mockResolvedValue(null)
        keyringMocks.inner.set.mockReset().mockResolvedValue(undefined)
        keyringMocks.inner.setBundle.mockReset().mockResolvedValue(undefined)
        keyringMocks.inner.clear.mockReset().mockResolvedValue(undefined)
        keyringMocks.inner.list.mockReset().mockResolvedValue([])
        keyringMocks.inner.setDefault.mockReset().mockResolvedValue(undefined)
        migrateMocks.runMigrateLegacyAuth
            .mockReset()
            .mockResolvedValue({ status: 'no-legacy-state' })
        configMocks.getConfig.mockReset().mockResolvedValue({})
        configMocks.updateConfig.mockReset().mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('passes outline-cli wiring to cli-core: serviceName, records location, and the id-or-label matcher', async () => {
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()
        createOutlineTokenStore()

        const options = keyringMocks.createKeyringTokenStore.mock.calls[0][0]
        expect(options.serviceName).toBe('outline-cli')
        expect(options.recordsLocation).toBe('/home/user/.config/outline-cli/config.json')
        const { matchOutlineAccount } = await import('../lib/auth-provider.js')
        expect(options.matchAccount).toBe(matchOutlineAccount)
    })

    it('active() env-token short-circuit: returns env token, honours OUTLINE_URL, bypasses migration + inner.active', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        const defaultBase = await createOutlineTokenStore().active()
        expect(defaultBase?.token).toBe('env_token_value')
        expect(defaultBase?.account.id).toBe('')
        expect(defaultBase?.account.baseUrl).toBe('https://app.getoutline.com')
        expect(keyringMocks.inner.active).not.toHaveBeenCalled()
        expect(migrateMocks.runMigrateLegacyAuth).not.toHaveBeenCalled()

        vi.stubEnv('OUTLINE_URL', 'https://custom.example.com/')
        const customBase = await createOutlineTokenStore().active()
        expect(customBase?.account.baseUrl).toBe('https://custom.example.com')
    })

    it('active() ignores OUTLINE_API_TOKEN when an explicit ref targets a stored account', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')
        keyringMocks.inner.active.mockResolvedValue({
            token: 'tk_stored',
            account: STORED_ACCOUNT,
        })
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        await createOutlineTokenStore().active('user-uuid')

        expect(keyringMocks.inner.active).toHaveBeenCalledWith('user-uuid')
    })

    it('runs runMigrateLegacyAuth on the first store access and memoises across subsequent calls', async () => {
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()
        const store = createOutlineTokenStore()

        await store.active('user-uuid')
        await store.list()
        await store.clear('user-uuid')
        await store.set(STORED_ACCOUNT, 'tk')
        await store.setDefault('user-uuid')

        expect(migrateMocks.runMigrateLegacyAuth).toHaveBeenCalledTimes(1)
        expect(migrateMocks.runMigrateLegacyAuth).toHaveBeenCalledWith({ silent: true })
    })

    it('falls back to the legacy plaintext snapshot only when the v2 store is empty', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        configMocks.getConfig.mockResolvedValue(LEGACY_CONFIG)
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        const snapshot = await createOutlineTokenStore().active()

        expect(snapshot).toEqual({
            token: LEGACY_CONFIG.api_token,
            account: STORED_ACCOUNT,
        })
        // v2 consulted first (returned null per the beforeEach default),
        // then the legacy snapshot served the answer.
        expect(keyringMocks.inner.active).toHaveBeenCalledTimes(1)
    })

    it('delegates to the v2 store when migration is conclusive (no-legacy-state) — no legacy read attempt', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue({ status: 'no-legacy-state' })
        keyringMocks.inner.active.mockResolvedValue({ token: 'tk_v2', account: STORED_ACCOUNT })
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        const snapshot = await createOutlineTokenStore().active()

        expect(snapshot).toEqual({ token: 'tk_v2', account: STORED_ACCOUNT })
        expect(configMocks.getConfig).not.toHaveBeenCalled()
    })

    it('falls back to legacy when runMigrateLegacyAuth rejects (catch branch of ensureMigrated)', async () => {
        migrateMocks.runMigrateLegacyAuth.mockRejectedValue(new Error('boom'))
        configMocks.getConfig.mockResolvedValue(LEGACY_CONFIG)
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        const snapshot = await createOutlineTokenStore().active()

        expect(snapshot?.token).toBe(LEGACY_CONFIG.api_token)
        expect(snapshot?.account.id).toBe('user-uuid')
    })

    it('legacy snapshot synthesises empty id/label when the v1 config never carried persisted identity fields', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        configMocks.getConfig.mockResolvedValue({ api_token: 'tk_old' })
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        const snapshot = await createOutlineTokenStore().active()

        expect(snapshot?.token).toBe('tk_old')
        expect(snapshot?.account.id).toBe('')
        expect(snapshot?.account.label).toBe('')
        expect(snapshot?.account.baseUrl).toBe('https://app.getoutline.com')
    })

    it('active(ref) returns the legacy snapshot when ref matches, falls through to v2 when it does not', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        configMocks.getConfig.mockResolvedValue(LEGACY_CONFIG)
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()
        const store = createOutlineTokenStore()

        const matched = await store.active('user-uuid')
        expect(matched?.token).toBe(LEGACY_CONFIG.api_token)

        const mismatched = await store.active('other-user')
        expect(mismatched).toBeNull()
        expect(keyringMocks.inner.active).toHaveBeenCalledWith('other-user')
    })

    it('set() / clear() discharge legacy state on disk when migration is inconclusive', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()
        const store = createOutlineTokenStore()

        await store.set(STORED_ACCOUNT, 'tk_new')
        await store.clear('user-uuid')

        expect(configMocks.updateConfig).toHaveBeenCalledWith(LEGACY_CLEAR_PAYLOAD)
        expect(keyringMocks.inner.set).toHaveBeenCalledWith(STORED_ACCOUNT, 'tk_new')
        expect(keyringMocks.inner.clear).toHaveBeenCalledWith('user-uuid')
    })

    it('set() / clear() do NOT touch legacy state when migration is conclusive', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue({ status: 'no-legacy-state' })
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()
        const store = createOutlineTokenStore()

        await store.set(STORED_ACCOUNT, 'tk_new')
        await store.clear('user-uuid')

        expect(configMocks.updateConfig).not.toHaveBeenCalled()
    })

    it('set() does NOT discharge legacy state when the v2 write fails (atomicity)', async () => {
        // Regression test for the pre-fix order where legacy fields were
        // erased before the v2 write — a failing keyring call would leave
        // the user with no recoverable credentials.
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        keyringMocks.inner.set.mockRejectedValue(new Error('keyring boom'))
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        await expect(createOutlineTokenStore().set(STORED_ACCOUNT, 'tk_new')).rejects.toThrow(
            'keyring boom',
        )
        expect(configMocks.updateConfig).not.toHaveBeenCalled()
    })

    it('clear() does NOT discharge legacy state when the v2 clear fails (atomicity)', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        keyringMocks.inner.clear.mockRejectedValue(new Error('keyring boom'))
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        await expect(createOutlineTokenStore().clear('user-uuid')).rejects.toThrow('keyring boom')
        expect(configMocks.updateConfig).not.toHaveBeenCalled()
    })

    it('clear() PROPAGATES updateConfig failures (logout must be atomic, not silently partial)', async () => {
        // If the v2 clear succeeded but the legacy discharge silently
        // failed, the next `active()` call would fall back to the
        // surviving plaintext `api_token` — i.e. "logout" leaves the
        // user authenticated. Logout has to fail loudly instead.
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        configMocks.updateConfig.mockRejectedValue(new Error('disk full'))
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        await expect(createOutlineTokenStore().clear('user-uuid')).rejects.toThrow('disk full')
        expect(keyringMocks.inner.clear).toHaveBeenCalledWith('user-uuid')
    })

    it('set() runs migration BEFORE the v2 write (no post-write race that re-grabs the legacy token)', async () => {
        // Regression test for the race where ensureMigrated only fired
        // after inner.set/clear: migration would then see the stale
        // api_token still on disk and migrate it on top of the fresh
        // login, either duplicating accounts or reviving auth after logout.
        const callOrder: string[] = []
        migrateMocks.runMigrateLegacyAuth.mockImplementation(async () => {
            callOrder.push('migrate')
            return { status: 'no-legacy-state' }
        })
        keyringMocks.inner.set.mockImplementation(async () => {
            callOrder.push('set')
        })
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        await createOutlineTokenStore().set(STORED_ACCOUNT, 'tk_new')

        expect(callOrder).toEqual(['migrate', 'set'])
    })

    it('activeBundle env short-circuit returns an access-only bundle and bypasses inner', async () => {
        vi.stubEnv(TOKEN_ENV_VAR, 'env_token_value')
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        const snapshot = await createOutlineTokenStore().activeBundle()

        expect(snapshot?.bundle).toEqual({ accessToken: 'env_token_value' })
        expect(keyringMocks.inner.activeBundle).not.toHaveBeenCalled()
    })

    it('activeBundle forwards to the v2 store, preserving refresh state', async () => {
        keyringMocks.inner.activeBundle.mockResolvedValue({
            account: STORED_ACCOUNT,
            bundle: { accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: 123 },
        })
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        const snapshot = await createOutlineTokenStore().activeBundle()

        expect(snapshot?.bundle).toEqual({
            accessToken: 'a',
            refreshToken: 'r',
            accessTokenExpiresAt: 123,
        })
        expect(keyringMocks.inner.activeBundle).toHaveBeenCalledTimes(1)
    })

    it('setBundle forwards to inner and discharges legacy state when migration is inconclusive', async () => {
        migrateMocks.runMigrateLegacyAuth.mockResolvedValue(SKIPPED_RESULT)
        const bundle = { accessToken: 'a', refreshToken: 'r' }
        const createOutlineTokenStore = await loadCreateOutlineTokenStore()

        await createOutlineTokenStore().setBundle(STORED_ACCOUNT, bundle, { promoteDefault: true })

        expect(keyringMocks.inner.setBundle).toHaveBeenCalledWith(STORED_ACCOUNT, bundle, {
            promoteDefault: true,
        })
        expect(configMocks.updateConfig).toHaveBeenCalledWith(LEGACY_CLEAR_PAYLOAD)
    })
})

describe('matchOutlineAccount', () => {
    it('matches the UUID exactly and the label case-insensitively', async () => {
        const { matchOutlineAccount } = await import('../lib/auth-provider.js')
        expect(matchOutlineAccount(STORED_ACCOUNT, 'user-uuid')).toBe(true)
        expect(matchOutlineAccount(STORED_ACCOUNT, 'ADA')).toBe(true)
        expect(matchOutlineAccount(STORED_ACCOUNT, 'ada')).toBe(true)
        expect(matchOutlineAccount(STORED_ACCOUNT, 'other-user')).toBe(false)
        // Case-sensitive on the UUID — would never collide with a label.
        expect(matchOutlineAccount(STORED_ACCOUNT, 'USER-UUID')).toBe(false)
    })
})

describe('getActiveTokenSource', () => {
    beforeEach(() => {
        delete process.env[TOKEN_ENV_VAR]
        configMocks.getConfig.mockReset()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('reports the storage location of the active token, mirroring active()s resolution order', async () => {
        const { getActiveTokenSource } = await import('../lib/auth-provider.js')

        vi.stubEnv(TOKEN_ENV_VAR, 'tk')
        configMocks.getConfig.mockResolvedValue({})
        await expect(getActiveTokenSource()).resolves.toBe('env')
        vi.unstubAllEnvs()

        configMocks.getConfig.mockResolvedValue({
            users: [{ id: 'u', name: 'Ada', token: 'plaintext' }],
        })
        await expect(getActiveTokenSource()).resolves.toBe('config-file')

        configMocks.getConfig.mockResolvedValue({ users: [{ id: 'u', name: 'Ada' }] })
        await expect(getActiveTokenSource()).resolves.toBe('secure-store')

        // v2 record (even without fallbackToken) wins over a lingering v1
        // plaintext slot — `active()` ignores `api_token` once a record
        // exists, so this classifier must too. Regression guard for the
        // pre-fix order where the v1 check ran first.
        configMocks.getConfig.mockResolvedValue({
            api_token: 'stale-v1',
            users: [{ id: 'u', name: 'Ada' }],
        })
        await expect(getActiveTokenSource()).resolves.toBe('secure-store')

        configMocks.getConfig.mockResolvedValue({ api_token: 'tk' })
        await expect(getActiveTokenSource()).resolves.toBe('config-file')

        configMocks.getConfig.mockResolvedValue({})
        await expect(getActiveTokenSource()).resolves.toBe('secure-store')
    })
})
