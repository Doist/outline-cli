import { createSpinner } from '@todoist/cli-core'
import { shouldDisableSpinner } from './global-args.js'

export type { SpinnerColor, SpinnerOptions } from '@todoist/cli-core'

const spinner = createSpinner({ isDisabled: shouldDisableSpinner })

export const { LoadingSpinner, withSpinner, startEarlySpinner, stopEarlySpinner } = spinner
