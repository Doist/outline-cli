import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_INFO } from './_fixtures/auth.js'

vi.mock('../lib/auth.js', () => ({
    getApiToken: async () => 'test-token',
    getBaseUrl: async () => 'https://test.outline.com',
    getOAuthClientId: async () => undefined,
    getActiveTokenSource: async () =>
        process.env.OUTLINE_API_TOKEN ? ('env' as const) : ('secure-store' as const),
    // status resolves the live token for the selected account via this; echo
    // the snapshot token back (no refresh in these command-surface tests).
    refreshedTokenForStatus: async (_account: unknown, fallback: string) => fallback,
}))

vi.mock('../lib/api.js', () => ({ apiRequest: vi.fn() }))

vi.mock('../lib/config.js', () => ({
    getConfig: vi.fn(async () => ({})),
    setConfig: vi.fn(),
    updateConfig: vi.fn(),
    getConfigPath: () => '/tmp/outline-cli-test-config.json',
}))

// Stub cli-core's `attachLoginCommand` so we can inspect the surface contract
// (chained flags, env-driven port, success hook) without running the flow.
// `attachStatusCommand` and `attachLogoutCommand` fall through to the real
// cli-core implementations so the integration is exercised end-to-end.
vi.mock('@doist/cli-core/auth', async () => ({
    ...(await vi.importActual<typeof import('@doist/cli-core/auth')>('@doist/cli-core/auth')),
    attachLoginCommand: vi.fn(),
}))

/**
 * Replace `console.log` with a recorder. Tests read `logs` to assert on
 * stdout-bound output. Lines are joined with spaces, matching how chalk's
 * styled fragments arrive at the spy.
 */
function captureLogs(): { logs: string[] } {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '))
    })
    return { logs }
}

async function captureAttachOptions() {
    const { attachLoginCommand } = await import('@doist/cli-core/auth')
    const login = new Command('login')
    vi.mocked(attachLoginCommand).mockReturnValue(login)
    const { registerAuthCommand } = await import('../commands/auth.js')
    const program = new Command()
    program.exitOverride()
    registerAuthCommand(program)
    return { options: vi.mocked(attachLoginCommand).mock.calls[0][1], login, program }
}

async function buildProgram(): Promise<Command> {
    const { program } = await captureAttachOptions()
    return program
}

beforeEach(() => {
    vi.resetModules()
    delete process.env.OUTLINE_API_TOKEN
    delete process.env.OUTLINE_URL
})

afterEach(() => {
    vi.clearAllMocks()
    delete process.env.OUTLINE_OAUTH_CALLBACK_PORT
    delete process.env.OUTLINE_API_TOKEN
    delete process.env.OUTLINE_URL
})

describe('registerAuthCommand', () => {
    it('wires --base-url / --client-id, env-driven port, and prints success only in human output mode', async () => {
        process.env.OUTLINE_OAUTH_CALLBACK_PORT = '7000'
        const { logs } = captureLogs()

        const { options, login } = await captureAttachOptions()

        expect(options.preferredPort).toBe(7000)
        const flags = login.options.map((o) => o.flags)
        expect(flags).toContain('--base-url <url>')
        expect(flags).toContain('--client-id <clientId>')

        const account = {
            id: 'u',
            label: 'Ada',
            baseUrl: 'https://x',
            oauthClientId: 'c',
            teamName: 'Analytics',
        }
        await options.onSuccess({ view: { json: false, ndjson: false }, flags: {}, account })
        await options.onSuccess({ view: { json: true, ndjson: false }, flags: {}, account })

        expect(logs.length).toBe(1)
        expect(logs[0]).toContain('Authenticated to Analytics as Ada')
    })

    it('falls back to the default callback port when the env var is unparseable', async () => {
        process.env.OUTLINE_OAUTH_CALLBACK_PORT = 'not-a-number'
        const { options } = await captureAttachOptions()
        expect(options.preferredPort).toBe(54969)
    })
})

describe('auth status subcommand', () => {
    async function importApiMock() {
        const { apiRequest } = await import('../lib/api.js')
        return vi.mocked(apiRequest)
    }

    it('renders the human status from the env-token snapshot path', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const { logs } = captureLogs()
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValue({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'status'])

        // status probes auth.info with the (account-scoped) live token resolved
        // for the selected account.
        expect(apiRequest).toHaveBeenCalledWith(
            'auth.info',
            {},
            { token: 'env-token', baseUrl: 'https://test.outline.com' },
        )
        expect(logs.some((l) => l.includes('Authenticated'))).toBe(true)
        expect(logs.some((l) => l.includes('Team:') && l.includes('Analytics'))).toBe(true)
        expect(logs.some((l) => l.includes('Ada Lovelace') && l.includes('ada@example.com'))).toBe(
            true,
        )
        expect(logs.some((l) => l.includes('Token source: env'))).toBe(true)
    })

    it('emits a PII-free JSON envelope under --json', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const { logs } = captureLogs()
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValue({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'status', '--json'])

        expect(logs).toHaveLength(1)
        const payload = JSON.parse(logs[0])
        expect(payload).toEqual({
            id: 'user-uuid',
            team: 'Analytics',
            baseUrl: 'https://test.outline.com',
            source: 'env',
        })
        expect(payload).not.toHaveProperty('name')
        expect(payload).not.toHaveProperty('email')
    })

    it('emits a single newline-free NDJSON line under --ndjson', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const { logs } = captureLogs()
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValue({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'status', '--ndjson'])

        expect(logs).toHaveLength(1)
        expect(logs[0]).not.toContain('\n')
        expect(JSON.parse(logs[0])).toEqual({
            id: 'user-uuid',
            team: 'Analytics',
            baseUrl: 'https://test.outline.com',
            source: 'env',
        })
    })

    it('translates a 401 from auth.info into a NO_TOKEN CliError', async () => {
        process.env.OUTLINE_API_TOKEN = 'expired-token'
        const apiRequest = await importApiMock()
        apiRequest.mockRejectedValue(new Error('API error: 401 Unauthorized'))

        const program = await buildProgram()
        await expect(program.parseAsync(['node', 'ol', 'auth', 'status'])).rejects.toMatchObject({
            code: 'NO_TOKEN',
        })
    })

    it('throws NOT_AUTHENTICATED when no token is stored at all', async () => {
        const program = await buildProgram()
        await expect(program.parseAsync(['node', 'ol', 'auth', 'status'])).rejects.toMatchObject({
            code: 'NOT_AUTHENTICATED',
        })
    })
})

describe('auth logout subcommand', () => {
    it('prints the registrar success line in human mode', async () => {
        const { logs } = captureLogs()

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout'])

        expect(logs).toContain('✓ Logged out')
    })

    it('emits {"ok": true} under --json and skips the human success line', async () => {
        const { logs } = captureLogs()

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout', '--json'])

        expect(logs).toHaveLength(1)
        expect(JSON.parse(logs[0])).toEqual({ ok: true })
    })

    it('stays silent on stdout under --ndjson (no human storage-result line leaks)', async () => {
        // Critical: logout now surfaces a storage-result confirmation via
        // `logTokenStorageResult` on success. NDJSON consumers expect a
        // clean stdout — any human-readable line here would corrupt the
        // stream. Guards the `isMachineOutput` branch in
        // `logTokenStorageResult`.
        const { logs } = captureLogs()

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout', '--ndjson'])

        expect(logs).toEqual([])
    })
})

describe('logTokenStorageResult', () => {
    function captureStreams() {
        const logs: string[] = []
        const errs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
            logs.push(a.join(' '))
        })
        vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
            errs.push(a.join(' '))
        })
        return { logs, errs }
    }

    it('prints the secure-store confirmation to stdout in human mode', async () => {
        const { logs, errs } = captureStreams()
        const { logTokenStorageResult } = await import('../commands/auth.js')

        logTokenStorageResult({ storage: 'secure-store' }, 'Token stored securely', false)

        expect(logs.some((l) => l.includes('Token stored securely'))).toBe(true)
        expect(errs).toEqual([])
    })

    it('suppresses the stdout confirmation in machine-output mode', async () => {
        const { logs } = captureStreams()
        const { logTokenStorageResult } = await import('../commands/auth.js')

        logTokenStorageResult({ storage: 'secure-store' }, 'Token stored securely', true)

        expect(logs).toEqual([])
    })

    it('routes the keyring-fallback warning to stderr (in both human and machine modes)', async () => {
        const { logs, errs } = captureStreams()
        const { logTokenStorageResult } = await import('../commands/auth.js')

        logTokenStorageResult(
            { storage: 'config-file', warning: 'system credential manager unavailable' },
            'Token stored securely',
            true,
        )

        // No stdout in machine mode, but warning still reaches operator on stderr.
        expect(logs).toEqual([])
        expect(errs.some((e) => e.includes('system credential manager unavailable'))).toBe(true)
    })
})
