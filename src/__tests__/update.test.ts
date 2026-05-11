import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }

const registerCoreUpdateCommandMock = vi.fn()
const withSpinnerMock = vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn())

vi.mock('@doist/cli-core/commands', () => ({
    registerUpdateCommand: registerCoreUpdateCommandMock,
}))

vi.mock('../lib/config.js', () => ({
    getConfigPath: () => '/tmp/outline-cli-test/config.json',
}))

vi.mock('../lib/spinner.js', () => ({
    withSpinner: withSpinnerMock,
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
        expect(options.currentVersion).toBe(packageJson.version)
        expect(options.withSpinner).toBe(withSpinnerMock)
    })
})
