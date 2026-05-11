import { createSpinner } from '@doist/cli-core'

export type { SpinnerColor, SpinnerOptions } from '@doist/cli-core'

function shouldDisableSpinner(): boolean {
    if (process.env.OL_SPINNER === 'false') return true
    if (process.env.CI && process.env.CI !== 'false') return true

    const args = process.argv
    if (args.includes('--json') || args.includes('--ndjson') || args.includes('--no-spinner')) {
        return true
    }

    return false
}

const spinner = createSpinner({ isDisabled: shouldDisableSpinner })

export const { LoadingSpinner, withSpinner, startEarlySpinner, stopEarlySpinner } = spinner
