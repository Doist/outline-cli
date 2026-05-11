import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth.js', () => ({
    getApiToken: async () => 'test-token',
    getBaseUrl: async () => 'https://test.outline.com',
    getOAuthClientId: async () => undefined,
    getTokenSource: async () => 'config' as const,
    clearConfig: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    apiRequest: vi.fn(),
}))

// The cli-core dependency drives the OAuth flow end-to-end; stub it so we can
// assert the command-surface contract (flag wiring, success envelope) without
// reaching out to a real Outline instance.
vi.mock('@doist/cli-core/auth', async () => {
    const actual =
        await vi.importActual<typeof import('@doist/cli-core/auth')>('@doist/cli-core/auth')
    return {
        ...actual,
        attachLoginCommand: vi.fn(),
    }
})

describe('registerAuthCommand', () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('attaches the OAuth login subcommand via cli-core with the expected wiring', async () => {
        const { attachLoginCommand } = await import('@doist/cli-core/auth')
        const fakeLogin = new Command('login')
        vi.mocked(attachLoginCommand).mockReturnValue(fakeLogin)

        const { registerAuthCommand } = await import('../commands/auth.js')
        const program = new Command()
        program.exitOverride()
        registerAuthCommand(program)

        expect(attachLoginCommand).toHaveBeenCalledTimes(1)
        const [parent, options] = vi.mocked(attachLoginCommand).mock.calls[0]
        expect(parent.name()).toBe('auth')
        expect(options.preferredPort).toBe(54969)
        expect(options.resolveScopes({ readOnly: false, flags: {} })).toEqual([])
        expect(typeof options.renderSuccess).toBe('function')
        expect(typeof options.renderError).toBe('function')

        // The returned Command is the consumer's hook for chaining extra
        // flags. Our wrapper must register --base-url and --client-id on it.
        const optionFlags = fakeLogin.options.map((o) => o.flags)
        expect(optionFlags).toContain('--base-url <url>')
        expect(optionFlags).toContain('--client-id <clientId>')
    })

    it('honours OUTLINE_OAUTH_CALLBACK_PORT for the preferred callback port', async () => {
        process.env.OUTLINE_OAUTH_CALLBACK_PORT = '7000'
        try {
            vi.resetModules()
            const { attachLoginCommand } = await import('@doist/cli-core/auth')
            vi.mocked(attachLoginCommand).mockReturnValue(new Command('login'))

            const { registerAuthCommand } = await import('../commands/auth.js')
            const program = new Command()
            program.exitOverride()
            registerAuthCommand(program)

            const [, options] = vi.mocked(attachLoginCommand).mock.calls[0]
            expect(options.preferredPort).toBe(7000)
        } finally {
            delete process.env.OUTLINE_OAUTH_CALLBACK_PORT
        }
    })

    it('falls back to the default callback port when the env var is unparseable', async () => {
        process.env.OUTLINE_OAUTH_CALLBACK_PORT = 'not-a-number'
        try {
            vi.resetModules()
            const { attachLoginCommand } = await import('@doist/cli-core/auth')
            vi.mocked(attachLoginCommand).mockReturnValue(new Command('login'))

            const { registerAuthCommand } = await import('../commands/auth.js')
            const program = new Command()
            program.exitOverride()
            registerAuthCommand(program)

            const [, options] = vi.mocked(attachLoginCommand).mock.calls[0]
            expect(options.preferredPort).toBe(54969)
        } finally {
            delete process.env.OUTLINE_OAUTH_CALLBACK_PORT
        }
    })

    describe('onSuccess hook', () => {
        beforeEach(() => {
            vi.resetModules()
        })

        it('writes the human success line to stdout in default output mode', async () => {
            const logs: string[] = []
            vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
                logs.push(args.join(' '))
            })

            const { attachLoginCommand } = await import('@doist/cli-core/auth')
            vi.mocked(attachLoginCommand).mockReturnValue(new Command('login'))

            const { registerAuthCommand } = await import('../commands/auth.js')
            const program = new Command()
            program.exitOverride()
            registerAuthCommand(program)

            const [, options] = vi.mocked(attachLoginCommand).mock.calls[0]
            options.onSuccess({
                view: { json: false, ndjson: false },
                flags: {},
                account: {
                    id: 'u',
                    label: 'Ada',
                    baseUrl: 'https://x',
                    oauthClientId: 'c',
                    teamName: 'Analytics',
                },
            })

            expect(logs.join('\n')).toContain('Authenticated to Analytics as Ada')
        })

        it('stays silent in --json mode so the machine envelope is not polluted', async () => {
            const logs: string[] = []
            vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
                logs.push(args.join(' '))
            })

            const { attachLoginCommand } = await import('@doist/cli-core/auth')
            vi.mocked(attachLoginCommand).mockReturnValue(new Command('login'))

            const { registerAuthCommand } = await import('../commands/auth.js')
            const program = new Command()
            program.exitOverride()
            registerAuthCommand(program)

            const [, options] = vi.mocked(attachLoginCommand).mock.calls[0]
            options.onSuccess({
                view: { json: true, ndjson: false },
                flags: {},
                account: {
                    id: 'u',
                    label: 'Ada',
                    baseUrl: 'https://x',
                    oauthClientId: 'c',
                    teamName: 'Analytics',
                },
            })

            expect(logs).toHaveLength(0)
        })
    })
})
