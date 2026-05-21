import { basename } from 'node:path'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registerCoreChangelogCommand } = vi.hoisted(() => ({
    registerCoreChangelogCommand: vi.fn(),
}))

vi.mock('@doist/cli-core/commands', () => ({
    registerChangelogCommand: registerCoreChangelogCommand,
}))

import packageJson from '../../package.json' with { type: 'json' }
import { registerChangelogCommand } from './changelog.js'

describe('changelog wrapper', () => {
    beforeEach(() => {
        registerCoreChangelogCommand.mockReset()
    })

    it('delegates to @doist/cli-core/commands with the expected config', () => {
        const program = new Command()
        registerChangelogCommand(program)

        expect(registerCoreChangelogCommand).toHaveBeenCalledTimes(1)
        const [passedProgram, config] = registerCoreChangelogCommand.mock.calls[0]
        expect(passedProgram).toBe(program)
        expect(basename(config.path)).toBe('CHANGELOG.md')
        expect(config.repoUrl).toBe('https://github.com/Doist/outline-cli')
        expect(config.version).toBe(packageJson.version)
        expect(config.bulletMarkers).toEqual(['*', '-'])
    })

    it('derives repoUrl from package.json (strips .git / git+ prefix)', () => {
        const program = new Command()
        registerChangelogCommand(program)

        const [, config] = registerCoreChangelogCommand.mock.calls[0]
        expect(config.repoUrl).not.toMatch(/\.git$/)
        expect(config.repoUrl).not.toMatch(/^git\+/)
    })
})
