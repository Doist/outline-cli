import {
    createAccessibleGate,
    createGlobalArgsStore,
    createSpinnerGate,
    parseGlobalArgs,
    stripUserFlag,
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
 * already extracts it from argv; `applyUserSelector` strips the flag before
 * Commander parses, so this reads the value off the warmed cache.
 */
export function getRequestedUserRef(): string | undefined {
    return store.get().user
}

/**
 * Guard a root `--user` against the two common footguns before it's stripped:
 * a value-less flag (`--user`, `--user=`) and a forgotten value where the next
 * token is actually a command (`ol --user document list`). Pure — pass the
 * pre-strip argv and the set of registered command names. Silent when `--user`
 * is absent, or when it appears *after* a command (a late flag is left for
 * Commander to reject as an unknown option, matching what `stripUserFlag`
 * leaves in argv).
 */
export function validateRootUserFlag(argv: string[], knownCommands: ReadonlySet<string>): void {
    const userIdx = argv.findIndex((a) => a === '--user' || a.startsWith('--user='))
    if (userIdx === -1) return
    const firstCmdIdx = argv.findIndex((a) => knownCommands.has(a))
    if (firstCmdIdx !== -1 && userIdx > firstCmdIdx) return

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

/**
 * Entrypoint wiring for the global `--user` selector, kept here so the
 * validate → warm-cache → strip order is exercised by tests rather than living
 * untested in `src/index.ts`. Validates the root flag, warms the global-args
 * cache off the *original* argv (so the ref survives), then rewrites
 * `process.argv` with the flag stripped for Commander. Throws `INVALID_USER_FLAG`
 * on a malformed root flag.
 */
export function applyUserSelector(knownCommands: ReadonlySet<string>): void {
    const original = process.argv.slice(2)
    validateRootUserFlag(original, knownCommands)
    getRequestedUserRef()
    process.argv = [process.argv[0], process.argv[1], ...stripUserFlag(original)]
}
