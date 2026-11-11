import { spawn } from 'node:child_process'
import { emitView, type UpdateChannel } from '@doist/cli-core'
import {
    fetchLatestVersion,
    getConfiguredUpdateChannel,
    getInstallTag,
    registerUpdateCommand as registerCoreUpdateCommand,
} from '@doist/cli-core/commands'
import chalk from 'chalk'
import type { Command } from 'commander'
import packageJson from '../../../package.json' with { type: 'json' }
import { getConfigPath } from '../../lib/config.js'
import { CliError, getErrorMessage } from '../../lib/errors.js'
import { NEW_PACKAGE_NAME, OLD_PACKAGE_NAME } from '../../lib/moved.js'
import { withSpinner } from '../../lib/spinner.js'

type PackageManager = 'npm' | 'pnpm'

type UpdateFlags = {
    check?: boolean
    channel?: boolean
    json?: boolean
    ndjson?: boolean
}

/**
 * `ol update` moves the install from `@doist/outline-cli` to
 * `@todoist/outline-cli` instead of looking for newer releases of this package
 * (there are none). cli-core still registers the command, its flags and
 * `update switch`; only the `update` action is replaced.
 */
export function registerUpdateCommand(program: Command): void {
    registerCoreUpdateCommand(program, {
        packageName: packageJson.name,
        currentVersion: packageJson.version,
        configPath: getConfigPath(),
        changelogCommandName: 'ol changelog',
        withSpinner,
    })

    const update = program.commands.find((c) => c.name() === 'update')
    if (!update) {
        throw new Error('cli-core did not register the update command')
    }
    update
        .description(`Switch to ${NEW_PACKAGE_NAME}, where ol is published now`)
        .action(async function (this: Command) {
            await runMove(this.opts<UpdateFlags>())
        })
}

/**
 * Same detection cli-core uses for `update`: pnpm when it shows up in the
 * package-manager env, the running script's path or the node binary's path.
 */
export function detectPackageManager(): PackageManager {
    const haystack = [process.env.npm_execpath, process.argv[1], process.execPath]
        .filter(Boolean)
        .join(' ')
    return haystack.includes('pnpm') ? 'pnpm' : 'npm'
}

function uninstallArgs(pm: PackageManager): string[] {
    return [pm === 'pnpm' ? 'remove' : 'uninstall', '-g', OLD_PACKAGE_NAME]
}

function installArgs(pm: PackageManager, spec: string): string[] {
    return [pm === 'pnpm' ? 'add' : 'install', '-g', spec]
}

function manualCommands(pm: PackageManager, tag: string): string[] {
    return [
        `${pm} ${uninstallArgs(pm).join(' ')}`,
        `${pm} ${installArgs(pm, `${NEW_PACKAGE_NAME}@${tag}`).join(' ')}`,
    ]
}

/**
 * Run a package-manager command with its output streamed to the user.
 * Resolves to `undefined` on success, or a short reason on failure.
 */
function runPackageManager(pm: PackageManager, args: string[]): Promise<string | undefined> {
    console.log(chalk.dim(`$ ${pm} ${args.join(' ')}`))
    return new Promise((resolve) => {
        const child = spawn(pm, args, {
            stdio: 'inherit',
            // npm/pnpm on Windows are `.cmd` shims that spawn() can't resolve
            // without the shell. Every argv element here is a fixed literal.
            shell: process.platform === 'win32',
        })
        child.on('error', (error) => resolve(getErrorMessage(error)))
        child.on('close', (code) =>
            resolve(code === 0 ? undefined : `${pm} exited with code ${code ?? 'unknown'}`),
        )
    })
}

/**
 * Confirm the new package can be fetched before anything is uninstalled. The
 * pre-release channel asks for `next`, falling back to `latest` when the new
 * package has no pre-release.
 */
async function resolveTarget(channel: UpdateChannel): Promise<{ tag: string; version: string }> {
    const preferred = getInstallTag(channel)
    const tags = preferred === 'latest' ? ['latest'] : [preferred, 'latest']
    let lastError: unknown
    for (const tag of tags) {
        try {
            const version = await withSpinner(
                { text: `Checking ${NEW_PACKAGE_NAME}@${tag}...`, color: 'blue' },
                () => fetchLatestVersion({ packageName: NEW_PACKAGE_NAME, distTag: tag }),
            )
            return { tag, version }
        } catch (error) {
            lastError = error
        }
    }
    throw new CliError(
        'UPDATE_CHECK_FAILED',
        `Could not look up ${NEW_PACKAGE_NAME}: ${getErrorMessage(lastError)}. Nothing was changed.`,
    )
}

async function runMove(flags: UpdateFlags): Promise<void> {
    if (flags.check && flags.channel) {
        throw new CliError('INVALID_FLAGS', 'Specify either --check or --channel, not both.')
    }
    const view = { json: flags.json, ndjson: flags.ndjson }
    const channel = await getConfiguredUpdateChannel(getConfigPath())

    if (flags.channel) {
        emitView(view, { channel }, () => [
            `Update channel: ${channel === 'pre-release' ? chalk.magenta('pre-release') : chalk.green('stable')}`,
        ])
        return
    }

    const pm = detectPackageManager()
    const currentVersion = packageJson.version

    // `--check` and machine-readable output only report the move.
    if (flags.check || view.json || view.ndjson) {
        const commands = manualCommands(pm, getInstallTag(channel))
        const payload = {
            currentVersion,
            packageName: OLD_PACKAGE_NAME,
            newPackageName: NEW_PACKAGE_NAME,
            channel,
            moved: true,
            ...(flags.check ? { updateAvailable: true } : { installed: false }),
            command: 'ol update',
            manualCommands: commands,
        }
        emitView(view, payload, () => [
            `${chalk.yellow(`ol has moved to ${NEW_PACKAGE_NAME}.`)} ${OLD_PACKAGE_NAME} v${currentVersion} gets no further updates.`,
            `Run ${chalk.cyan('ol update')} to switch, or by hand:`,
            ...commands.map((command) => chalk.dim(`  ${command}`)),
        ])
        return
    }

    const { tag, version } = await resolveTarget(channel)
    const hints = manualCommands(pm, tag)
    console.log(
        `${chalk.yellow(`ol has moved to ${NEW_PACKAGE_NAME}.`)} Replacing ${OLD_PACKAGE_NAME} v${currentVersion} with ${NEW_PACKAGE_NAME} v${version}.`,
    )

    // Both packages ship the `ol` binary, so the old one has to go first.
    const uninstallFailure = await runPackageManager(pm, uninstallArgs(pm))
    if (uninstallFailure) {
        throw new CliError(
            'UPDATE_INSTALL_FAILED',
            `Could not remove ${OLD_PACKAGE_NAME} (${uninstallFailure}). To switch by hand, run:`,
            hints,
        )
    }

    const installFailure = await runPackageManager(
        pm,
        installArgs(pm, `${NEW_PACKAGE_NAME}@${tag}`),
    )
    if (installFailure) {
        const restoreFailure = await runPackageManager(
            pm,
            installArgs(pm, `${OLD_PACKAGE_NAME}@${currentVersion}`),
        )
        const restored = restoreFailure
            ? `Restoring ${OLD_PACKAGE_NAME}@${currentVersion} also failed (${restoreFailure}).`
            : `Restored ${OLD_PACKAGE_NAME}@${currentVersion}.`
        throw new CliError(
            'UPDATE_INSTALL_FAILED',
            `Installing ${NEW_PACKAGE_NAME} failed (${installFailure}). ${restored} To switch by hand, run:`,
            hints,
        )
    }

    console.log(
        `${chalk.green('✓')} Installed ${NEW_PACKAGE_NAME} v${version}. ${chalk.cyan('ol')} keeps working with the same config and login.`,
    )
}
