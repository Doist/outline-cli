import { mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInstaller } from '../lib/skills/create-installer.js'
import { getInstaller, listAgents, skillInstallers } from '../lib/skills/index.js'

const AGENTS = [
    {
        agent: 'claude-code',
        description: 'Claude Code skill for Outline CLI',
        dirName: '.claude',
    },
    {
        agent: 'codex',
        description: 'Codex skill for Outline CLI',
        dirName: '.codex',
    },
    {
        agent: 'cursor',
        description: 'Cursor skill for Outline CLI',
        dirName: '.cursor',
    },
    {
        agent: 'gemini',
        description: 'Gemini CLI skill for Outline CLI',
        dirName: '.gemini',
    },
    {
        agent: 'pi',
        description: 'Pi skill for Outline CLI',
        dirName: '.pi',
    },
    {
        agent: 'universal',
        description: 'Universal agent skill for Outline CLI',
        dirName: '.agents',
    },
]

describe('skill registry', () => {
    it.each(AGENTS)('returns an installer for $agent', ({ agent }) => {
        expect(getInstaller(agent)).toBeDefined()
    })

    it('returns undefined for an unknown agent', () => {
        expect(getInstaller('unknown-agent')).toBeUndefined()
    })

    it('lists all registered agent names', () => {
        expect(listAgents()).toEqual(AGENTS.map((a) => a.agent))
    })
})

describe('installer paths', () => {
    it.each(AGENTS)(
        '$agent has correct name, description, and paths',
        ({ agent, description, dirName }) => {
            const installer = skillInstallers[agent]

            expect(installer.name).toBe(agent)
            expect(installer.description).toBe(description)

            const globalPath = installer.getInstallPath(false)
            expect(globalPath).toBe(join(homedir(), dirName, 'skills', 'outline-cli', 'SKILL.md'))

            const localPath = installer.getInstallPath(true)
            expect(localPath).toBe(
                join(process.cwd(), dirName, 'skills', 'outline-cli', 'SKILL.md'),
            )
        },
    )
})

describe('install detection', () => {
    it('throws when agent directory does not exist', async () => {
        const installer = createInstaller({
            name: 'fake-agent',
            description: 'Fake agent',
            dirName: '.nonexistent-agent-dir-xyz',
        })

        await expect(installer.install(false, false)).rejects.toThrow(
            'does not appear to be installed',
        )
    })

    it('skips agent directory check for universal (.agents)', async () => {
        const testDir = join(tmpdir(), `outline-cli-test-${Date.now()}`)
        await mkdir(testDir, { recursive: true })
        const originalCwd = process.cwd()
        process.chdir(testDir)
        try {
            const installer = createInstaller({
                name: 'universal',
                description: 'Universal agent',
                dirName: '.agents',
            })
            await expect(installer.install(true, false)).resolves.not.toThrow()
        } finally {
            process.chdir(originalCwd)
            await rm(testDir, { recursive: true, force: true })
        }
    })
})
