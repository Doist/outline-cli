import { SecureStoreUnavailableError } from '@doist/cli-core/auth'
import { TOKEN_ENV_VAR } from './auth-constants.js'
import {
    createOutlineTokenStore,
    getActiveTokenSource,
    type OutlineTokenStore,
} from './auth-provider.js'
import { getConfig } from './config.js'
import { CliError } from './errors.js'
import { DEFAULT_BASE_URL } from './outline-account.js'
import { getDefaultUserRecord } from './user-records.js'

export { SecureStoreUnavailableError, getActiveTokenSource, TOKEN_ENV_VAR }

export class NoTokenError extends CliError {
    constructor() {
        super(
            'NO_TOKEN',
            `No API token found. Set ${TOKEN_ENV_VAR} env var or run: ol auth login`,
            [`Set ${TOKEN_ENV_VAR} or run: ol auth login`],
            'info',
        )
        this.name = 'NoTokenError'
    }
}

/**
 * Module-level token-store singleton. Built lazily on first call; reused
 * across every `apiRequest` so the request hot path doesn't reconstruct
 * the keyring + user-record adapters per POST.
 */
let storeSingleton: OutlineTokenStore | undefined
function tokenStore(): OutlineTokenStore {
    if (!storeSingleton) storeSingleton = createOutlineTokenStore()
    return storeSingleton
}

/**
 * Read the active token. Hot path: when `OUTLINE_API_TOKEN` is set we
 * return it directly without consulting the token store, since
 * `apiRequest` already resolves the base URL separately — going through
 * `store.active()` here would trigger a redundant `getBaseUrl()` lookup
 * per request just to synthesise an account we don't need.
 */
export async function getApiToken(): Promise<string> {
    const envToken = process.env[TOKEN_ENV_VAR]?.trim()
    if (envToken) return envToken
    const snapshot = await tokenStore().active()
    if (!snapshot?.token) throw new NoTokenError()
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
