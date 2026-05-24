import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { Command } from 'commander'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_INFO, TWO_USER_CONFIG } from '../_fixtures/auth.js'

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
 * Read a `captureConsole` spy's recorded calls as joined lines, matching how
 * chalk's styled fragments arrive (one console call → one space-joined line).
 */
function lines(spy: MockInstance): string[] {
    return spy.mock.calls.map((args) => args.join(' '))
}

async function captureAttachOptions() {
    const { attachLoginCommand } = await import('@doist/cli-core/auth')
    const login = new Command('login')
    vi.mocked(attachLoginCommand).mockReturnValue(login)
    const { registerAuthCommand } = await import('./auth.js')
    const program = createTestProgram(registerAuthCommand)
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
    // Reset argv so a `--user` set by one test can't leak into the next via
    // the (real) global-args parser.
    process.argv = ['node', 'ol']
})

describe('registerAuthCommand', () => {
    it('wires --base-url / --client-id, env-driven port, and prints success only in human output mode', async () => {
        process.env.OUTLINE_OAUTH_CALLBACK_PORT = '7000'
        const log = captureConsole()

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

        expect(lines(log).length).toBe(1)
        expect(lines(log)[0]).toContain('Authenticated to Analytics as Ada')
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
        const log = captureConsole()
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
        expect(lines(log).some((l) => l.includes('Authenticated'))).toBe(true)
        expect(lines(log).some((l) => l.includes('Team:') && l.includes('Analytics'))).toBe(true)
        expect(
            lines(log).some((l) => l.includes('Ada Lovelace') && l.includes('ada@example.com')),
        ).toBe(true)
        expect(lines(log).some((l) => l.includes('Token source: env'))).toBe(true)
    })

    it('emits a PII-free JSON envelope under --json', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const log = captureConsole()
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValue({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'status', '--json'])

        expect(lines(log)).toHaveLength(1)
        const payload = JSON.parse(lines(log)[0])
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
        const log = captureConsole()
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValue({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'status', '--ndjson'])

        expect(lines(log)).toHaveLength(1)
        expect(lines(log)[0]).not.toContain('\n')
        expect(JSON.parse(lines(log)[0])).toEqual({
            id: 'user-uuid',
            team: 'Analytics',
            baseUrl: 'https://test.outline.com',
            source: 'env',
        })
    })

    it('honors a global --user via the wrapped store (routes to that account instance)', async () => {
        // Exercises the real ref-aware store wiring (not a fake): a global
        // `--user` before the command must reach `attachStatusCommand`'s store
        // and resolve the named account, not the default. Guards against a
        // regression where `registerAuthCommand` passes the raw store.
        const { getConfig } = await import('../lib/config.js')
        vi.mocked(getConfig).mockResolvedValue(TWO_USER_CONFIG)
        const { resetGlobalArgs } = await import('../lib/global-args.js')
        process.argv = ['node', 'ol', '--user', 'Bob', 'auth', 'status']
        resetGlobalArgs()

        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValue({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'status'])

        // The probe used Bob's token + instance — proof the global --user flowed
        // through the wrapped store rather than defaulting to Ada.
        expect(apiRequest).toHaveBeenCalledWith(
            'auth.info',
            {},
            { token: 'tok-bob', baseUrl: 'https://bob.example.com' },
        )

        // `vi.clearAllMocks()` only clears calls, not implementations, so restore
        // the config default to keep this override from leaking into later tests.
        vi.mocked(getConfig).mockResolvedValue({})
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
        const log = captureConsole()

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout'])

        expect(lines(log)).toContain('✓ Logged out')
    })

    it('emits {"ok": true} under --json and skips the human success line', async () => {
        const log = captureConsole()

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout', '--json'])

        expect(lines(log)).toHaveLength(1)
        expect(JSON.parse(lines(log)[0])).toEqual({ ok: true })
    })

    it('stays silent on stdout under --ndjson (no human storage-result line leaks)', async () => {
        // Critical: logout now surfaces a storage-result confirmation via
        // `logTokenStorageResult` on success. NDJSON consumers expect a
        // clean stdout — any human-readable line here would corrupt the
        // stream. Guards the `isMachineOutput` branch in
        // `logTokenStorageResult`.
        const log = captureConsole()

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout', '--ndjson'])

        expect(lines(log)).toEqual([])
    })
})

describe('logTokenStorageResult', () => {
    it('prints the secure-store confirmation to stdout in human mode', async () => {
        const log = captureConsole()
        const errorSpy = captureConsole('error')
        const { logTokenStorageResult } = await import('../lib/auth-output.js')

        logTokenStorageResult({ storage: 'secure-store' }, 'Token stored securely', false)

        expect(lines(log).some((l) => l.includes('Token stored securely'))).toBe(true)
        expect(lines(errorSpy)).toEqual([])
    })

    it('suppresses the stdout confirmation in machine-output mode', async () => {
        const log = captureConsole()
        const { logTokenStorageResult } = await import('../lib/auth-output.js')

        logTokenStorageResult({ storage: 'secure-store' }, 'Token stored securely', true)

        expect(lines(log)).toEqual([])
    })

    it('routes the keyring-fallback warning to stderr (in both human and machine modes)', async () => {
        const log = captureConsole()
        const errorSpy = captureConsole('error')
        const { logTokenStorageResult } = await import('../lib/auth-output.js')

        logTokenStorageResult(
            { storage: 'config-file', warning: 'system credential manager unavailable' },
            'Token stored securely',
            true,
        )

        // No stdout in machine mode, but warning still reaches operator on stderr.
        expect(lines(log)).toEqual([])
        expect(
            lines(errorSpy).some((e) => e.includes('system credential manager unavailable')),
        ).toBe(true)
    })
})
