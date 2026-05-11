import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registerCoreUpdateCommandMock = vi.fn()

vi.mock('@doist/cli-core/commands', () => ({
    registerUpdateCommand: registerCoreUpdateCommandMock,
}))

vi.mock('../lib/config.js', () => ({
    getConfigPath: () => '/tmp/outline-cli-test/config.json',
}))

vi.mock('../lib/spinner.js', () => ({
    withSpinner: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
}))

describe('ol update wiring', () => {
    beforeEach(() => {
        registerCoreUpdateCommandMock.mockClear()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('forwards packageName, currentVersion, configPath, changelogCommandName, withSpinner', async () => {
        const { registerUpdateCommand } = await import('../commands/update/index.js')
        const program = new Command()
        registerUpdateCommand(program)

        expect(registerCoreUpdateCommandMock).toHaveBeenCalledTimes(1)
        const [passedProgram, options] = registerCoreUpdateCommandMock.mock.calls[0]!
        expect(passedProgram).toBe(program)
        expect(options).toMatchObject({
            packageName: '@doist/outline-cli',
            configPath: '/tmp/outline-cli-test/config.json',
            changelogCommandName: 'ol changelog',
        })
        expect(typeof options.currentVersion).toBe('string')
        expect(typeof options.withSpinner).toBe('function')
    })
})
