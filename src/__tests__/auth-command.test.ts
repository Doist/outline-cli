import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth.js', () => ({
    getApiToken: async () => 'test-token',
    getBaseUrl: async () => 'https://test.outline.com',
    getOAuthClientId: async () => undefined,
    getTokenSource: async () => 'config' as const,
    clearConfig: vi.fn(),
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
        const logs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })

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
    const AUTH_INFO = {
        user: { id: 'user-uuid', name: 'Ada Lovelace', email: 'ada@example.com' },
        team: { name: 'Analytics', subdomain: 'analytics' },
    }

    async function importApiMock() {
        const { apiRequest } = await import('../lib/api.js')
        return vi.mocked(apiRequest)
    }

    it('renders the human status from the env-token snapshot path', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const logs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValue({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'status'])

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
        const logs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
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
        const logs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
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
    it('clears the token and prints the registrar success line', async () => {
        const logs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
        const { clearConfig } = await import('../lib/auth.js')

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout'])

        expect(clearConfig).toHaveBeenCalledTimes(1)
        expect(logs).toContain('✓ Logged out')
    })

    it('emits {"ok": true} under --json and skips the human success line', async () => {
        const logs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout', '--json'])

        expect(logs).toHaveLength(1)
        expect(JSON.parse(logs[0])).toEqual({ ok: true })
    })

    it('stays silent on stdout under --ndjson', async () => {
        const logs: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'logout', '--ndjson'])

        expect(logs).toEqual([])
    })
})
