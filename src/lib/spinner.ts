import { createSpinner } from '@doist/cli-core'
import { shouldDisableSpinner } from './global-args.js'

export type { SpinnerColor, SpinnerOptions } from '@doist/cli-core'

const spinner = createSpinner({ isDisabled: shouldDisableSpinner })

export const { LoadingSpinner, withSpinner, startEarlySpinner, stopEarlySpinner } = spinner
