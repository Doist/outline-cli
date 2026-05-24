import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import type { Command } from 'commander'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORED_ACCOUNT, STORED_ACCOUNT_BOB } from '../_fixtures/auth.js'
import { CliError } from '../lib/errors.js'

// `account` consumes two auth-provider exports: the token store (list/use/remove
// drive its `list`/`setDefault`/`clear`) and `resolveActiveAccountSource` (which
// `current` uses to classify the active credential). Both are stubbed per-test —
// the source-precedence logic itself is covered in auth-provider.test.ts.
const storeMocks = vi.hoisted(() => ({
    list: vi.fn(),
    setDefault: vi.fn(),
    clear: vi.fn(),
    getLastClearResult: vi.fn(() => undefined),
}))
const resolveMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/auth-provider.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/auth-provider.js')>()
    return {
        ...actual,
        createOutlineTokenStore: () => storeMocks,
        resolveActiveAccountSource: resolveMock,
    }
})

function lines(spy: MockInstance): string {
    return spy.mock.calls.map((args) => args.join(' ')).join('\n')
}

async function buildProgram(): Promise<Command> {
    const { registerAccountCommand } = await import('./account.js')
    return createTestProgram(registerAccountCommand)
}

let logSpy: MockInstance
let errSpy: MockInstance

beforeEach(() => {
    vi.resetModules()
    delete process.env.OUTLINE_API_TOKEN
    logSpy = captureConsole('log')
    errSpy = captureConsole('error')
})

afterEach(() => {
    vi.clearAllMocks()
    delete process.env.OUTLINE_API_TOKEN
    // Reset argv so a `--user` set by one test can't leak into the next via the
    // (real) global-args parser.
    process.argv = ['node', 'ol']
})

describe('account command', () => {
    describe('list', () => {
        it('renders all stored accounts with the default marker', async () => {
            storeMocks.list.mockResolvedValue([
                { account: STORED_ACCOUNT, isDefault: true },
                { account: STORED_ACCOUNT_BOB, isDefault: false },
            ])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'list'])
            const out = lines(logSpy)
            expect(out).toContain('Ada')
            expect(out).toContain('Bob')
            expect(out).toContain(`id:${STORED_ACCOUNT.id}`)
            expect(out).toMatch(/default/)
        })

        it('prints the empty-state message when nothing is stored', async () => {
            storeMocks.list.mockResolvedValue([])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'list'])
            expect(lines(logSpy)).toMatch(/No stored accounts/)
        })

        it('runs by default when no subcommand is given (ol account)', async () => {
            storeMocks.list.mockResolvedValue([{ account: STORED_ACCOUNT, isDefault: true }])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account'])
            expect(lines(logSpy)).toContain('Ada')
        })

        it('emits a {accounts, default} envelope under --json', async () => {
            storeMocks.list.mockResolvedValue([
                { account: STORED_ACCOUNT, isDefault: true },
                { account: STORED_ACCOUNT_BOB, isDefault: false },
            ])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'list', '--json'])
            const payload = JSON.parse(lines(logSpy))
            expect(payload.default).toBe(STORED_ACCOUNT.id)
            expect(payload.accounts).toHaveLength(2)
            expect(payload.accounts[0]).toMatchObject({ id: STORED_ACCOUNT.id, isDefault: true })
            // The OAuth client id is intentionally dropped from machine output.
            expect(payload.accounts[0]).not.toHaveProperty('oauthClientId')
        })
    })

    describe('use', () => {
        it('sets the default account and echoes the ref', async () => {
            storeMocks.setDefault.mockResolvedValue(undefined)
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'use', STORED_ACCOUNT_BOB.id])
            expect(storeMocks.setDefault).toHaveBeenCalledWith(STORED_ACCOUNT_BOB.id)
            expect(lines(logSpy)).toContain(`Default account set to ${STORED_ACCOUNT_BOB.id}`)
        })

        it('propagates ACCOUNT_NOT_FOUND from setDefault for an unknown ref', async () => {
            storeMocks.setDefault.mockRejectedValue(
                new CliError('ACCOUNT_NOT_FOUND', 'No stored account matches "nobody".'),
            )
            const program = await buildProgram()
            await expect(
                program.parseAsync(['node', 'ol', 'account', 'use', 'nobody']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')
            expect(storeMocks.setDefault).toHaveBeenCalledWith('nobody')
        })
    })

    describe('remove', () => {
        it('clears the account by the raw ref and prints the removed label', async () => {
            storeMocks.clear.mockResolvedValue({ account: STORED_ACCOUNT_BOB, wasDefault: false })
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'remove', 'bob'])
            expect(storeMocks.clear).toHaveBeenCalledWith('bob')
            expect(lines(logSpy)).toContain('Removed Bob')
        })

        it('notes a cleared default when removing the default account', async () => {
            storeMocks.clear.mockResolvedValue({ account: STORED_ACCOUNT, wasDefault: true })
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'remove', STORED_ACCOUNT.id])
            const out = lines(logSpy)
            expect(out).toContain('Removed Ada')
            expect(out).toMatch(/Cleared default account/)
        })

        it('throws ACCOUNT_NOT_FOUND when clear matches nothing', async () => {
            storeMocks.clear.mockResolvedValue(null)
            const program = await buildProgram()
            await expect(
                program.parseAsync(['node', 'ol', 'account', 'remove', 'ghost']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')
        })

        it('surfaces a keyring-fallback warning on stderr', async () => {
            storeMocks.clear.mockResolvedValue({ account: STORED_ACCOUNT, wasDefault: true })
            storeMocks.getLastClearResult.mockReturnValue({
                storage: 'config-file',
                warning: 'OS keyring unavailable; cleared the config-file token instead.',
            })
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'remove', STORED_ACCOUNT.id])
            expect(lines(errSpy)).toContain('OS keyring unavailable')
        })
    })

    describe('current', () => {
        it('renders the active stored account', async () => {
            resolveMock.mockResolvedValue({
                source: 'stored',
                account: STORED_ACCOUNT,
                isDefault: true,
            })
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current'])
            const out = lines(logSpy)
            expect(out).toContain('Ada')
            expect(out).toContain(STORED_ACCOUNT.baseUrl)
        })

        it('emits a {source:"stored", account} envelope under --json', async () => {
            resolveMock.mockResolvedValue({
                source: 'stored',
                account: STORED_ACCOUNT,
                isDefault: true,
            })
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current', '--json'])
            const payload = JSON.parse(lines(logSpy))
            expect(payload.source).toBe('stored')
            expect(payload.account).toMatchObject({ id: STORED_ACCOUNT.id, isDefault: true })
            expect(payload.account).not.toHaveProperty('oauthClientId')
        })

        it('threads --user through to the source resolver, bypassing an env token', async () => {
            process.env.OUTLINE_API_TOKEN = 'tok-env'
            // The root `--user` is stripped from argv before commander in the real
            // flow; the global-args parser still reads it off the original argv.
            process.argv = ['node', 'ol', '--user', 'Bob', 'account', 'current']
            resolveMock.mockImplementation(async (ref?: string) =>
                ref === 'Bob'
                    ? { source: 'stored', account: STORED_ACCOUNT_BOB, isDefault: false }
                    : { source: 'env' },
            )
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current'])
            expect(resolveMock).toHaveBeenCalledWith('Bob')
            const out = lines(logSpy)
            expect(out).toContain('Bob')
            expect(out).not.toContain('OUTLINE_API_TOKEN')
        })

        it('reports the env-token source (human + --json)', async () => {
            resolveMock.mockResolvedValue({ source: 'env' })
            await (await buildProgram()).parseAsync(['node', 'ol', 'account', 'current'])
            expect(lines(logSpy)).toContain('OUTLINE_API_TOKEN')

            logSpy.mockClear()
            resolveMock.mockResolvedValue({ source: 'env' })
            await (await buildProgram()).parseAsync(['node', 'ol', 'account', 'current', '--json'])
            expect(JSON.parse(lines(logSpy))).toEqual({ source: 'env' })
        })

        it('reports the legacy source (human + --json)', async () => {
            resolveMock.mockResolvedValue({ source: 'legacy' })
            await (await buildProgram()).parseAsync(['node', 'ol', 'account', 'current'])
            expect(lines(logSpy)).toMatch(/legacy single-user credentials/)

            logSpy.mockClear()
            resolveMock.mockResolvedValue({ source: 'legacy' })
            await (
                await buildProgram()
            ).parseAsync(['node', 'ol', 'account', 'current', '--ndjson'])
            expect(JSON.parse(lines(logSpy))).toEqual({ source: 'legacy' })
        })

        it('throws NOT_AUTHENTICATED when nothing is active', async () => {
            resolveMock.mockResolvedValue(null)
            const program = await buildProgram()
            await expect(
                program.parseAsync(['node', 'ol', 'account', 'current']),
            ).rejects.toHaveProperty('code', 'NOT_AUTHENTICATED')
        })

        it('throws ACCOUNT_NOT_FOUND when an explicit --user matches nothing', async () => {
            process.argv = ['node', 'ol', '--user', 'Ghost', 'account', 'current']
            resolveMock.mockResolvedValue(null)
            const program = await buildProgram()
            await expect(
                program.parseAsync(['node', 'ol', 'account', 'current']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')
        })
    })
})
