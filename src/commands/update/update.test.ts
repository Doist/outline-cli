import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../../../package.json' with { type: 'json' }
import { linesText } from '../../_fixtures/testing.js'

const mocks = vi.hoisted(() => ({
    configPath: '',
    spawn: vi.fn(),
    // Exit codes handed out to successive spawned commands; missing entries exit 0.
    exitCodes: [] as number[],
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

vi.mock('../../lib/config.js', () => ({
    getConfigPath: () => mocks.configPath,
}))

vi.mock('../../lib/spinner.js', () => ({
    withSpinner: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
}))

import { registerUpdateCommand } from './index.js'

const CURRENT = packageJson.version
const testDir = join(tmpdir(), `outline-cli-update-test-${process.pid}`)
const originalArgv1 = process.argv[1]
const originalExecPath = process.execPath

function fakeChild(): EventEmitter {
    const child = new EventEmitter()
    const code = mocks.exitCodes.shift() ?? 0
    setImmediate(() => child.emit('close', code))
    return child
}

/** `[command, ...args]` for every spawned process, in order. */
function spawned(): string[] {
    return mocks.spawn.mock.calls.map(([cmd, args]) => [cmd, ...(args as string[])].join(' '))
}

function registry(versions: Record<string, string>) {
    const fetchMock = vi.fn(async (url: string) => {
        const tag = url.split('/').pop() ?? ''
        const version = versions[tag]
        return version
            ? new Response(JSON.stringify({ version }), { status: 200 })
            : new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

function usePackageManager(pm: 'npm' | 'pnpm') {
    const root = pm === 'pnpm' ? '/home/u/.local/share/pnpm/global/5' : '/usr/local/lib'
    vi.stubEnv('npm_execpath', '')
    process.argv[1] = `${root}/node_modules/@doist/outline-cli/dist/index.js`
    process.execPath = '/usr/local/bin/node'
}

async function runUpdate(...args: string[]): Promise<void> {
    const program = createTestProgram(registerUpdateCommand)
    await program.parseAsync(['node', 'ol', 'update', ...args])
}

beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    mocks.configPath = join(testDir, 'config.json')
    mocks.exitCodes = []
    mocks.spawn.mockReset().mockImplementation(fakeChild)
    usePackageManager('npm')
})

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    process.argv[1] = originalArgv1
    process.execPath = originalExecPath
})

describe('ol update (move to @todoist/outline-cli)', () => {
    it('uninstalls the old package, then installs the new one with npm', async () => {
        registry({ latest: '3.0.0' })
        const log = captureConsole('log')

        await runUpdate()

        expect(spawned()).toEqual([
            'npm uninstall -g @doist/outline-cli',
            'npm install -g @todoist/outline-cli@latest',
        ])
        // Package-manager output goes straight to the user.
        expect(mocks.spawn.mock.calls[0]![2]).toMatchObject({ stdio: 'inherit' })
        const out = linesText(log)
        expect(out).toContain('ol has moved to @todoist/outline-cli')
        expect(out).toContain('Installed @todoist/outline-cli v3.0.0')
        expect(out).toContain('same config and login')
    })

    it('uses pnpm remove / pnpm add for a pnpm install', async () => {
        registry({ latest: '3.0.0' })
        usePackageManager('pnpm')
        captureConsole('log')

        await runUpdate()

        expect(spawned()).toEqual([
            'pnpm remove -g @doist/outline-cli',
            'pnpm add -g @todoist/outline-cli@latest',
        ])
    })

    it('installs @next on the pre-release channel', async () => {
        writeFileSync(mocks.configPath, JSON.stringify({ update_channel: 'pre-release' }))
        registry({ latest: '3.0.0', next: '3.1.0-next.1' })
        captureConsole('log')

        await runUpdate()

        expect(spawned()[1]).toBe('npm install -g @todoist/outline-cli@next')
    })

    it('falls back to @latest on the pre-release channel when there is no @next', async () => {
        writeFileSync(mocks.configPath, JSON.stringify({ update_channel: 'pre-release' }))
        registry({ latest: '3.0.0' })
        captureConsole('log')

        await runUpdate()

        expect(spawned()[1]).toBe('npm install -g @todoist/outline-cli@latest')
    })

    it('restores the old package when the new install fails', async () => {
        registry({ latest: '3.0.0' })
        mocks.exitCodes = [0, 1, 0]
        captureConsole('log')

        const error = await runUpdate().catch((e: unknown) => e)

        expect(spawned()).toEqual([
            'npm uninstall -g @doist/outline-cli',
            'npm install -g @todoist/outline-cli@latest',
            `npm install -g @doist/outline-cli@${CURRENT}`,
        ])
        expect(error).toMatchObject({
            code: 'UPDATE_INSTALL_FAILED',
            hints: [
                'npm uninstall -g @doist/outline-cli',
                'npm install -g @todoist/outline-cli@latest',
            ],
        })
        expect((error as Error).message).toContain(`Restored @doist/outline-cli@${CURRENT}`)
    })

    it('says so when restoring the old package also fails', async () => {
        registry({ latest: '3.0.0' })
        mocks.exitCodes = [0, 1, 1]
        captureConsole('log')

        const error = await runUpdate().catch((e: unknown) => e)

        expect(error).toMatchObject({ code: 'UPDATE_INSTALL_FAILED' })
        expect((error as Error).message).toContain('also failed')
    })

    it('stops before installing when the uninstall fails', async () => {
        registry({ latest: '3.0.0' })
        mocks.exitCodes = [1]
        captureConsole('log')

        await expect(runUpdate()).rejects.toMatchObject({ code: 'UPDATE_INSTALL_FAILED' })
        expect(spawned()).toEqual(['npm uninstall -g @doist/outline-cli'])
    })

    it('changes nothing when the registry cannot be reached', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
            }),
        )

        await expect(runUpdate()).rejects.toMatchObject({ code: 'UPDATE_CHECK_FAILED' })
        expect(mocks.spawn).not.toHaveBeenCalled()
    })

    it('--check reports the move without changing anything', async () => {
        const fetchMock = registry({ latest: '3.0.0' })
        const log = captureConsole('log')

        await runUpdate('--check')

        expect(mocks.spawn).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        const out = linesText(log)
        expect(out).toContain('ol has moved to @todoist/outline-cli')
        expect(out).toContain('ol update')
        expect(out).toContain('npm install -g @todoist/outline-cli@latest')
    })

    it('--check --json emits a record describing the move', async () => {
        const log = captureConsole('log')

        await runUpdate('--check', '--json')

        expect(mocks.spawn).not.toHaveBeenCalled()
        expect(JSON.parse(linesText(log))).toEqual({
            currentVersion: CURRENT,
            packageName: '@doist/outline-cli',
            newPackageName: '@todoist/outline-cli',
            channel: 'stable',
            moved: true,
            updateAvailable: true,
            command: 'ol update',
            manualCommands: [
                'npm uninstall -g @doist/outline-cli',
                'npm install -g @todoist/outline-cli@latest',
            ],
        })
    })

    it('--ndjson without --check reports the move and installs nothing', async () => {
        const log = captureConsole('log')

        await runUpdate('--ndjson')

        expect(mocks.spawn).not.toHaveBeenCalled()
        expect(JSON.parse(linesText(log))).toMatchObject({ moved: true, installed: false })
    })

    it('--channel still shows the configured channel', async () => {
        writeFileSync(mocks.configPath, JSON.stringify({ update_channel: 'pre-release' }))
        const log = captureConsole('log')

        await runUpdate('--channel', '--json')

        expect(JSON.parse(linesText(log))).toEqual({ channel: 'pre-release' })
        expect(mocks.spawn).not.toHaveBeenCalled()
    })

    it('update switch still writes the channel to config', async () => {
        captureConsole('log')

        await runUpdate('switch', '--pre-release')

        expect(JSON.parse(readFileSync(mocks.configPath, 'utf8'))).toMatchObject({
            update_channel: 'pre-release',
        })
    })
})
