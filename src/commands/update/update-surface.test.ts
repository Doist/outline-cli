import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { registerUpdateCommand } from './index.js'

// Stub out config + spinner — this test only cares about the command surface
// (subcommand names + flags) wired up via the real cli-core, so a bump to
// cli-core can't silently change `ol update`'s public CLI shape.
vi.mock('../../lib/config.js', () => ({
    getConfigPath: () => '/tmp/outline-cli-test/config.json',
}))

vi.mock('../../lib/spinner.js', () => ({
    withSpinner: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
}))

describe('ol update command surface (integration with real cli-core)', () => {
    it('exposes `update` with --check and --channel flags', () => {
        const program = new Command()
        registerUpdateCommand(program)

        const update = program.commands.find((c) => c.name() === 'update')
        expect(update).toBeDefined()

        const longs = update?.options.map((o) => o.long) ?? []
        expect(longs).toContain('--check')
        expect(longs).toContain('--channel')
    })

    it('exposes `update switch` with --stable and --pre-release flags', () => {
        const program = new Command()
        registerUpdateCommand(program)

        const update = program.commands.find((c) => c.name() === 'update')
        const switchCmd = update?.commands.find((c) => c.name() === 'switch')
        expect(switchCmd).toBeDefined()

        const longs = switchCmd?.options.map((o) => o.long) ?? []
        expect(longs).toContain('--stable')
        expect(longs).toContain('--pre-release')
    })
})
