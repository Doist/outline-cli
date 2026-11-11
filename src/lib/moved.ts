import { findCommandToken } from '@doist/cli-core'
import { chalkStderr } from 'chalk'

/** This package. It gets no further releases once users have been moved off it. */
export const OLD_PACKAGE_NAME = '@doist/outline-cli'

/** Where `ol` is published now. Same binary, config file and keyring entries. */
export const NEW_PACKAGE_NAME = '@todoist/outline-cli'

export const MOVED_NOTICE = `ol has moved to ${NEW_PACKAGE_NAME}. Run "ol update" to switch.`

type NoticeStream = { isTTY?: boolean; write(chunk: string): unknown }

/**
 * Print a one-line notice that `ol` is now published as `@todoist/outline-cli`.
 * Goes to stderr and only when that is an interactive terminal, so piped,
 * JSON/NDJSON and agent output is untouched. Skipped for `ol update`, which
 * explains the move itself.
 */
export function printMovedNotice(
    argv: string[] = process.argv.slice(2),
    stream: NoticeStream = process.stderr,
): void {
    if (!stream.isTTY) return
    if (findCommandToken(argv).token === 'update') return
    stream.write(`${chalkStderr.yellow(MOVED_NOTICE)}\n`)
}
