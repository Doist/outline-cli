import { CliError as CoreCliError, type CliErrorCode, type ErrorType } from '@doist/cli-core'

export { CoreCliError as BaseCliError }
export type { ErrorType } from '@doist/cli-core'

export type ErrorCode =
    | 'ACCOUNT_NOT_FOUND'
    | 'AUTH_VERIFICATION_FAILED'
    | 'CONFIRMATION_REQUIRED'
    | 'CONFLICTING_OPTIONS'
    | 'INVALID_PARENT'
    | 'MISSING_OPTION'
    | 'NO_TOKEN'
    | 'OAUTH_CALLBACK_PORT_INVALID'
    | 'OAUTH_CALLBACK_SERVER_FAILED'
    | 'OAUTH_CLIENT_ID_REQUIRED'
    | 'OAUTH_LOGIN_FAILED'
    | 'UNKNOWN_AGENT'

export class CliError extends CoreCliError<ErrorCode> {
    constructor(
        code: ErrorCode | CliErrorCode,
        message: string,
        hints?: string[],
        type: ErrorType = 'error',
    ) {
        super(code, message, { hints, type })
    }
}

export { getErrorMessage } from '@doist/cli-core'
