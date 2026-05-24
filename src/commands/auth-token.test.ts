import { captureConsole, captureStream, createTestProgram } from '@doist/cli-core/testing'
import type { Command } from 'commander'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_INFO, STORED_ACCOUNT, STORED_ACCOUNT_BOB } from '../_fixtures/auth.js'
import type { CliError } from '../lib/errors.js'

// `auth token` save drives the raw store's `set` + `getLastStorageResult`;
// `auth token view` (real cli-core attacher) reads through the ref-aware store's
// `active` / `activeAccount`. Stub the store so neither path touches a keyring.
const storeMocks = vi.hoisted(() => ({
    set: vi.fn(),
    getLastStorageResult: vi.fn(() => undefined),
    active: vi.fn(),
    activeAccount: vi.fn(async () => ({ account: STORED_ACCOUNT, isDefault: true })),
}))

// Stub the shared masked prompt so the interactive (no-argument) save path is
// testable without a real TTY. `identifyAccount` / `resolveBaseUrl` stay real.
const promptMock = vi.hoisted(() =>
    vi.fn<(q: string, o?: { hidden?: boolean }) => Promise<string>>(),
)

vi.mock('../lib/auth-provider.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/auth-provider.js')>()
    return { ...actual, createOutlineTokenStore: () => storeMocks, prompt: promptMock }
})

vi.mock('../lib/api.js', () => ({ apiRequest: vi.fn() }))

function lines(spy: MockInstance): string {
    return spy.mock.calls.map((args) => args.join(' ')).join('\n')
}

async function buildProgram(): Promise<Command> {
    const { registerAuthCommand } = await import('./auth.js')
    return createTestProgram(registerAuthCommand)
}

async function importApiMock() {
    const { apiRequest } = await import('../lib/api.js')
    return vi.mocked(apiRequest)
}

// `process.stdin` is a shared global; mutating `isTTY` would bleed across tests
// (resetModules doesn't isolate it), so snapshot and restore it every test.
const ORIGINAL_STDIN_ISTTY = process.stdin.isTTY
function setStdinIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
}

beforeEach(() => {
    vi.resetModules()
    delete process.env.OUTLINE_API_TOKEN
    delete process.env.OUTLINE_URL
})

afterEach(() => {
    vi.clearAllMocks()
    delete process.env.OUTLINE_API_TOKEN
    delete process.env.OUTLINE_URL
    process.argv = ['node', 'ol']
    setStdinIsTTY(ORIGINAL_STDIN_ISTTY)
})

describe('auth token (save)', () => {
    it('validates via auth.info, stores the resolved account, and confirms', async () => {
        const log = captureConsole()
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValueOnce({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync([
            'node',
            'ol',
            'auth',
            'token',
            'tok-paste',
            '--base-url',
            'https://wiki.test',
        ])

        expect(apiRequest).toHaveBeenCalledWith(
            'auth.info',
            {},
            { token: 'tok-paste', baseUrl: 'https://wiki.test' },
        )
        expect(storeMocks.set).toHaveBeenCalledWith(
            {
                id: 'user-uuid',
                label: 'Ada Lovelace',
                baseUrl: 'https://wiki.test',
                oauthClientId: '',
                teamName: 'Analytics',
            },
            'tok-paste',
        )
        expect(lines(log)).toContain('Saved token for Ada Lovelace (Analytics)')
    })

    it('collapses any auth.info failure into a leak-free AUTH_VERIFICATION_FAILED', async () => {
        const apiRequest = await importApiMock()
        // Outline's real invalid-token error carries no status code (api.ts drops
        // it when the body has a message); the wrapper must hide it entirely.
        apiRequest.mockRejectedValueOnce(new Error('API error: Unable to decode token'))

        const program = await buildProgram()
        const err = (await program
            .parseAsync([
                'node',
                'ol',
                'auth',
                'token',
                'bad-token',
                '--base-url',
                'https://wiki.test',
            ])
            .catch((e: unknown) => e)) as CliError

        expect(err.code).toBe('AUTH_VERIFICATION_FAILED')
        expect(err.message).toBe('Could not verify the token with Outline')
        expect(err.message).not.toContain('Unable to decode token')
        expect(err.hints).toEqual(expect.arrayContaining([expect.stringContaining('--base-url')]))
        expect(storeMocks.set).not.toHaveBeenCalled()
    })

    it('throws NO_TOKEN when no token is given in a non-interactive shell', async () => {
        setStdinIsTTY(false)
        const program = await buildProgram()
        await expect(program.parseAsync(['node', 'ol', 'auth', 'token'])).rejects.toHaveProperty(
            'code',
            'NO_TOKEN',
        )
        expect(promptMock).not.toHaveBeenCalled()
    })

    it('reads the token from a masked prompt when no argument is given in a TTY', async () => {
        setStdinIsTTY(true)
        promptMock.mockResolvedValueOnce('tok-prompt')
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValueOnce({ data: AUTH_INFO })

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'token', '--base-url', 'https://wiki.test'])

        expect(promptMock).toHaveBeenCalledWith('API token: ', { hidden: true })
        expect(storeMocks.set).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-uuid', label: 'Ada Lovelace' }),
            'tok-prompt',
        )
    })

    it('suppresses the human confirmation in machine-output mode', async () => {
        const log = captureConsole()
        const apiRequest = await importApiMock()
        apiRequest.mockResolvedValueOnce({ data: AUTH_INFO })

        // `--json` is a root selector read off argv by global-args, not a
        // commander option on `auth token`, so warm the cache rather than
        // passing it through parseAsync.
        const { resetGlobalArgs } = await import('../lib/global-args.js')
        process.argv = ['node', 'ol', '--json', 'auth', 'token']
        resetGlobalArgs()

        const program = await buildProgram()
        await program.parseAsync([
            'node',
            'ol',
            'auth',
            'token',
            'tok-paste',
            '--base-url',
            'https://wiki.test',
        ])

        expect(storeMocks.set).toHaveBeenCalled()
        expect(lines(log)).toEqual('')
    })
})

describe('auth token view', () => {
    it('writes the bare stored token to stdout with no envelope or newline', async () => {
        storeMocks.active.mockResolvedValueOnce({ token: 'stored-tok', account: STORED_ACCOUNT })
        const out = captureStream('stdout')

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'token', 'view'])

        expect(out.mock.calls).toEqual([['stored-tok']])
    })

    it('refuses to print when OUTLINE_API_TOKEN is set', async () => {
        process.env.OUTLINE_API_TOKEN = 'env-token'
        const program = await buildProgram()
        await expect(
            program.parseAsync(['node', 'ol', 'auth', 'token', 'view']),
        ).rejects.toHaveProperty('code', 'TOKEN_FROM_ENV')
    })

    it('routes a global --user through the ref-aware store', async () => {
        storeMocks.active.mockImplementationOnce(async (ref?: string) =>
            ref === 'Bob'
                ? { token: 'tok-bob', account: STORED_ACCOUNT_BOB }
                : { token: 'tok-ada', account: STORED_ACCOUNT },
        )
        storeMocks.activeAccount.mockResolvedValueOnce({
            account: STORED_ACCOUNT_BOB,
            isDefault: false,
        })
        const out = captureStream('stdout')

        const { resetGlobalArgs } = await import('../lib/global-args.js')
        process.argv = ['node', 'ol', '--user', 'Bob', 'auth', 'token', 'view']
        resetGlobalArgs()

        const program = await buildProgram()
        await program.parseAsync(['node', 'ol', 'auth', 'token', 'view'])

        expect(storeMocks.active).toHaveBeenCalledWith('Bob')
        expect(out.mock.calls).toEqual([['tok-bob']])
    })
})
