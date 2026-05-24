import type { TokenStorageResult } from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { OutlineTokenStore } from './auth-provider.js'

/**
 * Surface a `TokenStorageResult` from a save/clear: the human-readable
 * confirmation goes to stdout, any keyring-fallback warning goes to stderr.
 * Pass `isMachineOutput: true` to suppress the stdout confirmation in
 * `--json` / `--ndjson` mode while still routing the warning to stderr.
 */
export function logTokenStorageResult(
    result: TokenStorageResult,
    secureStoreMessage: string,
    isMachineOutput = false,
): void {
    if (!isMachineOutput && result.storage === 'secure-store') {
        console.log(chalk.dim(secureStoreMessage))
    }
    if (result.warning) {
        console.error(chalk.yellow('Warning:'), result.warning)
    }
}

/**
 * Surface the result of a token clear (`auth logout` / `account remove`): the
 * confirmation goes to stdout, any keyring-fallback warning to stderr. Shared so
 * both call sites stay in lockstep.
 */
export function logClearResult(store: OutlineTokenStore, isMachineOutput: boolean): void {
    const result = store.getLastClearResult()
    if (!result) return
    logTokenStorageResult(
        result,
        'Stored token removed from the system credential manager',
        isMachineOutput,
    )
}
