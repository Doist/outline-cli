import { refreshAccessToken, SecureStoreUnavailableError } from '@doist/cli-core/auth'
import { TOKEN_ENV_VAR } from './auth-constants.js'
import {
    createOutlineAuthProvider,
    createOutlineTokenStore,
    getActiveTokenSource,
    type OutlineTokenStore,
} from './auth-provider.js'
import { getConfig, getConfigPath } from './config.js'
import { BaseCliError, CliError } from './errors.js'
import { DEFAULT_BASE_URL, type OutlineAccount } from './outline-account.js'
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
 * Module-level token-store + provider singletons. Built lazily on first
 * call; reused across every `apiRequest` so the request hot path doesn't
 * reconstruct the keyring + user-record adapters (or the provider's resolver
 * closures) per POST.
 */
let storeSingleton: OutlineTokenStore | undefined
function tokenStore(): OutlineTokenStore {
    if (!storeSingleton) storeSingleton = createOutlineTokenStore()
    return storeSingleton
}

let providerSingleton: ReturnType<typeof createOutlineAuthProvider> | undefined
function authProvider(): ReturnType<typeof createOutlineAuthProvider> {
    if (!providerSingleton) providerSingleton = createOutlineAuthProvider()
    return providerSingleton
}

/**
 * Read the active token, refreshing it silently when the stored access
 * token has expired (or is within the 60s skew window). The OAuth refresh
 * grant runs against Outline's `/oauth/token` endpoint and the new bundle
 * is persisted back to the keyring + user record.
 *
 * Env-token short-circuit: when `OUTLINE_API_TOKEN` is set we return it
 * directly without consulting the token store. The env token is
 * user-managed; refresh is meaningless and would burn a request.
 *
 * `AUTH_REFRESH_UNAVAILABLE` (e.g. v1.7.0 record with no refresh token
 * stored) and `AUTH_REFRESH_EXPIRED` (refresh token itself expired/revoked)
 * are translated to `NoTokenError` so the user sees the existing
 * "run: ol auth login" hint instead of an unfamiliar code.
 */
export async function getApiToken(): Promise<string> {
    const envToken = process.env[TOKEN_ENV_VAR]?.trim()
    if (envToken) return envToken
    return getApiTokenForceRefresh(false)
}

/**
 * Internal: shared between proactive `getApiToken()` and the reactive
 * 401-retry path. `force` skips the expiry-window check and refreshes
 * immediately (used after the server has rejected the current token).
 */
export async function getApiTokenForceRefresh(force: boolean): Promise<string> {
    try {
        const refreshed = await refreshAccessToken<OutlineAccount>({
            store: tokenStore(),
            provider: authProvider(),
            force,
            // Sidecar O_EXCL lock so two parallel `ol` invocations don't
            // both POST refresh and race Outline's refresh-token rotation.
            // `getConfigPath()` is already an absolute, expanded path
            // (cli-core does not interpret `~`).
            lockPath: `${getConfigPath()}.refresh.lock`,
        })
        return refreshed.token
    } catch (error) {
        // Refresh helper surfaces typed codes we want to collapse to the
        // existing "no token" UX. Anything else (network errors during
        // refresh, store write failures) propagates with its original code.
        // `BaseCliError` catches both cli-core-thrown errors (the refresh
        // path) and ol-cli's own `CliError` subclass.
        if (error instanceof BaseCliError) {
            if (
                error.code === 'NOT_AUTHENTICATED' ||
                error.code === 'AUTH_REFRESH_UNAVAILABLE' ||
                error.code === 'AUTH_REFRESH_EXPIRED'
            ) {
                throw new NoTokenError()
            }
        }
        throw error
    }
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
