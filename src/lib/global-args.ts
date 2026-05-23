import {
    createAccessibleGate,
    createGlobalArgsStore,
    createSpinnerGate,
    parseGlobalArgs,
} from '@doist/cli-core'
import { CliError } from './errors.js'

const store = createGlobalArgsStore()

export const getGlobalArgs = store.get
export const resetGlobalArgs = store.reset

export const isAccessible = createAccessibleGate({
    envVar: 'OL_ACCESSIBLE',
    getArgs: store.get,
})

export const shouldDisableSpinner = createSpinnerGate({
    envVar: 'OL_SPINNER',
    getArgs: store.get,
})

export function isJsonMode(): boolean {
    const args = store.get()
    return args.json || args.ndjson
}

/**
 * Pre-subcommand `ol --user <ref>` selector. cli-core's `parseGlobalArgs`
 * already extracts it from argv; `index.ts` strips the flag before Commander
 * parses (see `stripUserFlag`), so this reads the value off the warmed cache.
 */
export function getRequestedUserRef(): string | undefined {
    return store.get().user
}

/**
 * Guard a root `--user` against the two common footguns before it's stripped:
 * a value-less flag (`--user`, `--user=`) and a forgotten value where the next
 * token is actually a command (`ol --user document list`). Pure — pass the
 * pre-strip argv and the set of registered command names. Silent when `--user`
 * is absent.
 */
export function validateRootUserFlag(argv: string[], knownCommands: ReadonlySet<string>): void {
    const sawUser = argv.some((a) => a === '--user' || a.startsWith('--user='))
    if (!sawUser) return

    const ref = parseGlobalArgs(argv).user
    if (!ref) {
        throw new CliError('INVALID_USER_FLAG', '--user requires a value: <id|name>.', [
            'Example: ol --user scott@example.com document list',
        ])
    }
    if (knownCommands.has(ref)) {
        throw new CliError(
            'INVALID_USER_FLAG',
            `--user requires a value: got "${ref}", which looks like a command — did you forget the value?`,
            [`Example: ol --user scott@example.com ${ref}`],
        )
    }
}
