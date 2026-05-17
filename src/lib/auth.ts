import { SecureStoreUnavailableError } from '@doist/cli-core/auth'
import { createOutlineTokenStore, getActiveTokenSource } from './auth-provider.js'
import { getConfig } from './config.js'
import { CliError } from './errors.js'
import { getDefaultUserRecord } from './user-records.js'

export { SecureStoreUnavailableError, getActiveTokenSource }

export const TOKEN_ENV_VAR = 'OUTLINE_API_TOKEN'

const DEFAULT_BASE_URL = 'https://app.getoutline.com'

export class NoTokenError extends CliError {
    constructor() {
        super(
            'NO_TOKEN',
            `No API token found. Set ${TOKEN_ENV_VAR} env var or run: ol auth login`,
            ['Set OUTLINE_API_TOKEN or run: ol auth login'],
            'info',
        )
        this.name = 'NoTokenError'
    }
}

/**
 * Read the active token. The keyring-backed store wraps env-var precedence
 * internally and falls back to the legacy plaintext snapshot when migration
 * hasn't completed.
 */
export async function getApiToken(): Promise<string> {
    const snapshot = await createOutlineTokenStore().active()
    if (!snapshot || !snapshot.token) throw new NoTokenError()
    return snapshot.token
}

/**
 * Base URL cascade: env var → default user record (v2) → legacy
 * `base_url` config (v1) → built-in default. The record takes priority
 * over the legacy slot so post-migration logins keep defaulting to the
 * same Outline instance.
 */
export async function getBaseUrl(): Promise<string> {
    const envUrl = process.env.OUTLINE_URL
    if (envUrl) return envUrl.replace(/\/$/, '')

    const config = await getConfig()
    const record = getDefaultUserRecord(config)
    if (record?.account.baseUrl) return record.account.baseUrl.replace(/\/$/, '')
    if (config.base_url) return config.base_url.replace(/\/$/, '')
    return DEFAULT_BASE_URL
}

/**
 * OAuth client id cascade: env var → default user record (v2) → legacy
 * `oauth_client_id` config (v1) → undefined (caller prompts).
 */
export async function getOAuthClientId(): Promise<string | undefined> {
    const envClientId = process.env.OUTLINE_OAUTH_CLIENT_ID
    if (envClientId) return envClientId

    const config = await getConfig()
    const record = getDefaultUserRecord(config)
    if (record?.account.oauthClientId) return record.account.oauthClientId
    return config.oauth_client_id
}
