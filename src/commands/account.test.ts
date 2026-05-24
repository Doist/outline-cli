import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import type { Command } from 'commander'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORED_ACCOUNT, STORED_ACCOUNT_BOB } from '../_fixtures/auth.js'
import type { OutlineAccount } from '../lib/outline-account.js'
import { matchOutlineAccount } from '../lib/outline-account.js'

// In-memory stand-in for the keyring store. `setDefault` / `clear` resolve the
// raw `<ref>` through the real `matchOutlineAccount` (id or display name), so
// the cli-core attachers run against a realistic store and exercise the actual
// ref-matching + default-resolution wiring this command adds — not just a stub.
const storeMocks = vi.hoisted(() => ({
    list: vi.fn(),
    setDefault: vi.fn(),
    clear: vi.fn(),
    active: vi.fn(),
    activeBundle: vi.fn(),
    activeAccount: vi.fn(),
    set: vi.fn(),
    setBundle: vi.fn(),
    getLastStorageResult: vi.fn(),
    getLastClearResult: vi.fn(() => undefined),
}))

vi.mock('../lib/auth-provider.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/auth-provider.js')>()
    return { ...actual, createOutlineTokenStore: () => storeMocks }
})

function lines(spy: MockInstance): string {
    return spy.mock.calls.map((args) => args.join(' ')).join('\n')
}

function seedStore(...records: Array<OutlineAccount | [OutlineAccount, 'default']>): void {
    const list = records.map((spec) =>
        Array.isArray(spec)
            ? { account: spec[0], isDefault: true }
            : { account: spec, isDefault: false },
    )
    storeMocks.list.mockResolvedValue(list)
    storeMocks.activeAccount.mockImplementation(async (ref?: string) => {
        if (ref === undefined) return list.find((entry) => entry.isDefault) ?? null
        return list.find((entry) => matchOutlineAccount(entry.account, ref)) ?? null
    })
    storeMocks.setDefault.mockImplementation(async (ref: string) => {
        const match = list.find((entry) => matchOutlineAccount(entry.account, ref))
        if (!match) {
            const { CliError } = await import('../lib/errors.js')
            throw new CliError('ACCOUNT_NOT_FOUND', `No stored account matches "${ref}".`)
        }
        for (const entry of list) entry.isDefault = entry === match
    })
    storeMocks.clear.mockImplementation(async (ref: string) => {
        const index = list.findIndex((entry) => matchOutlineAccount(entry.account, ref))
        if (index < 0) return null
        const [removed] = list.splice(index, 1)
        return { account: removed.account, wasDefault: removed.isDefault }
    })
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
            seedStore([STORED_ACCOUNT, 'default'], STORED_ACCOUNT_BOB)
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'list'])
            const out = lines(logSpy)
            expect(out).toContain('Ada')
            expect(out).toContain('Bob')
            expect(out).toContain(`id:${STORED_ACCOUNT.id}`)
            expect(out).toMatch(/default/)
        })

        it('prints the empty-state message when nothing is stored', async () => {
            seedStore()
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'list'])
            expect(lines(logSpy)).toMatch(/No stored accounts/)
        })

        it('runs by default when no subcommand is given (ol account)', async () => {
            seedStore([STORED_ACCOUNT, 'default'])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account'])
            expect(lines(logSpy)).toContain('Ada')
        })

        it('emits a {accounts, default} envelope under --json', async () => {
            seedStore([STORED_ACCOUNT, 'default'], STORED_ACCOUNT_BOB)
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
            seedStore([STORED_ACCOUNT, 'default'], STORED_ACCOUNT_BOB)
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'use', STORED_ACCOUNT_BOB.id])
            expect(storeMocks.setDefault).toHaveBeenCalledWith(STORED_ACCOUNT_BOB.id)
            expect(lines(logSpy)).toContain(`Default account set to ${STORED_ACCOUNT_BOB.id}`)
        })

        it('propagates ACCOUNT_NOT_FOUND for an unknown ref', async () => {
            seedStore([STORED_ACCOUNT, 'default'])
            const program = await buildProgram()
            await expect(
                program.parseAsync(['node', 'ol', 'account', 'use', 'nobody']),
            ).rejects.toHaveProperty('code', 'ACCOUNT_NOT_FOUND')
        })
    })

    describe('remove', () => {
        it('clears the account by display name and prints the removed label', async () => {
            seedStore([STORED_ACCOUNT, 'default'], STORED_ACCOUNT_BOB)
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'remove', 'bob'])
            expect(storeMocks.clear).toHaveBeenCalledWith('bob')
            expect(lines(logSpy)).toContain('Removed Bob')
        })

        it('notes a cleared default when removing the default account', async () => {
            seedStore([STORED_ACCOUNT, 'default'])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'remove', STORED_ACCOUNT.id])
            const out = lines(logSpy)
            expect(out).toContain('Removed Ada')
            expect(out).toMatch(/Cleared default account/)
        })

        it('surfaces a keyring-fallback warning on stderr', async () => {
            seedStore([STORED_ACCOUNT, 'default'])
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
            seedStore([STORED_ACCOUNT, 'default'], STORED_ACCOUNT_BOB)
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current'])
            const out = lines(logSpy)
            expect(out).toContain('Ada')
            expect(out).toContain(STORED_ACCOUNT.baseUrl)
        })

        it('emits a {source:"stored", account} envelope under --json', async () => {
            seedStore([STORED_ACCOUNT, 'default'])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current', '--json'])
            const payload = JSON.parse(lines(logSpy))
            expect(payload.source).toBe('stored')
            expect(payload.account).toMatchObject({ id: STORED_ACCOUNT.id, isDefault: true })
            expect(payload.account).not.toHaveProperty('oauthClientId')
        })

        it('honours --user, bypassing an env token to show the requested account', async () => {
            seedStore([STORED_ACCOUNT, 'default'], STORED_ACCOUNT_BOB)
            process.env.OUTLINE_API_TOKEN = 'tok-env'
            // The root `--user` is stripped from argv before commander in the real
            // flow; the global-args parser still reads it off the original argv.
            process.argv = ['node', 'ol', '--user', 'Bob', 'account', 'current']
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current'])
            const out = lines(logSpy)
            expect(out).toContain('Bob')
            expect(out).not.toContain('OUTLINE_API_TOKEN')
        })

        it('reports the env-token source when OUTLINE_API_TOKEN is set', async () => {
            seedStore([STORED_ACCOUNT, 'default'])
            process.env.OUTLINE_API_TOKEN = 'tok-env'
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current'])
            expect(lines(logSpy)).toContain('OUTLINE_API_TOKEN')
            // Env wins before any stored-account resolution is attempted.
            expect(storeMocks.activeAccount).not.toHaveBeenCalled()
        })

        it('prefers a stored default over a lingering legacy token', async () => {
            // Store resolves a v2 default; a legacy snapshot also exists (its
            // account is absent from list()). The stored account must win.
            seedStore([STORED_ACCOUNT, 'default'])
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current'])
            expect(lines(logSpy)).toContain('Ada')
            expect(lines(logSpy)).not.toMatch(/legacy/)
        })

        it('reports the legacy source when only a legacy snapshot resolves', async () => {
            // No v2 records, but the store still resolves a legacy single-user
            // snapshot (not present in list()).
            storeMocks.list.mockResolvedValue([])
            storeMocks.activeAccount.mockResolvedValue({
                account: STORED_ACCOUNT,
                isDefault: true,
            })
            const program = await buildProgram()
            await program.parseAsync(['node', 'ol', 'account', 'current'])
            expect(lines(logSpy)).toMatch(/legacy single-user credentials/)
        })

        it('throws NOT_AUTHENTICATED when nothing is active', async () => {
            seedStore()
            const program = await buildProgram()
            await expect(
                program.parseAsync(['node', 'ol', 'account', 'current']),
            ).rejects.toHaveProperty('code', 'NOT_AUTHENTICATED')
        })
    })
})
