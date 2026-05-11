import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth.js', () => ({
    getApiToken: async () => 'test-token',
    getBaseUrl: async () => 'https://test.outline.com',
    getOAuthClientId: async () => undefined,
    getTokenSource: async () => 'config' as const,
    clearConfig: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({ apiRequest: vi.fn() }))

// Stub cli-core's `attachLoginCommand` so we can inspect the surface contract
// (chained flags, env-driven port, success hook) without running the flow.
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
    return { options: vi.mocked(attachLoginCommand).mock.calls[0][1], login }
}

afterEach(() => {
    vi.clearAllMocks()
    delete process.env.OUTLINE_OAUTH_CALLBACK_PORT
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
