import { CliError as CoreCliError, type CliErrorCode, type ErrorType } from '@todoist/cli-core'

export { CoreCliError as BaseCliError }
export type { ErrorType } from '@todoist/cli-core'

export type ErrorCode =
    | 'ACCOUNT_NOT_FOUND'
    | 'AUTH_VERIFICATION_FAILED'
    | 'CONFIRMATION_REQUIRED'
    | 'CONFLICTING_OPTIONS'
    | 'DOCUMENT_CHANGED'
    | 'DOWNLOAD_FAILED'
    | 'FILE_EXISTS'
    | 'FILE_NOT_FOUND'
    | 'INVALID_ATTACHMENT'
    | 'INVALID_PARENT'
    | 'INVALID_TIMESTAMP'
    | 'INVALID_USER_FLAG'
    | 'MISSING_OPTION'
    | 'NO_TOKEN'
    | 'OAUTH_CALLBACK_PORT_INVALID'
    | 'OAUTH_CALLBACK_SERVER_FAILED'
    | 'OAUTH_CLIENT_ID_REQUIRED'
    | 'OAUTH_LOGIN_FAILED'
    | 'UNKNOWN_AGENT'
    | 'UPLOAD_FAILED'

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

export { getErrorMessage } from '@todoist/cli-core'
