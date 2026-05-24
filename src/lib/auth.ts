import { refreshAccessToken, SecureStoreUnavailableError } from '@doist/cli-core/auth'
import { TOKEN_ENV_VAR } from './auth-constants.js'
import {
    createOutlineAuthProvider,
    createOutlineTokenStore,
    getActiveTokenSource,
    type OutlineTokenStore,
} from './auth-provider.js'
import { getConfig, getConfigPath } from './config.js'
import { CliError } from './errors.js'
import { getRequestedUserRef } from './global-args.js'
import { DEFAULT_BASE_URL, type OutlineAccount } from './outline-account.js'
import { getDefaultUserRecord, recordForRef } from './user-records.js'
import { withUserRefAware } from './user-ref-store.js'

/** Base URL + optional refresh handshake for a single request. */
type RequestContext = {
    baseUrl: string
    handshake?: { baseUrl: string; clientId: string }
}

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
    // Wrapped so a global `--user <ref>` flows into every no-ref store read on
    // the request hot path (token lookup + refresh). Without `--user`,
    // `getRequestedUserRef()` is undefined and the wrap is a pass-through.
    if (!storeSingleton) storeSingleton = withUserRefAware(createOutlineTokenStore())
    return storeSingleton
}

/**
 * The `--user` ref to apply on the request path, or `undefined` when an
 * `OUTLINE_API_TOKEN` is set — an env token wins outright, so base URL and
 * client id resolve from the default account rather than the named one,
 * keeping token / base URL / client id pinned to the same source.
 */
function requestPathUserRef(): string | undefined {
    if (process.env[TOKEN_ENV_VAR]?.trim()) return undefined
    return getRequestedUserRef()
}

let providerSingleton: ReturnType<typeof createOutlineAuthProvider> | undefined
function authProvider(): ReturnType<typeof createOutlineAuthProvider> {
    if (!providerSingleton) providerSingleton = createOutlineAuthProvider()
    return providerSingleton
}

// Caller-provided O_EXCL lock so concurrent `ol` invocations don't issue
// parallel refresh grants. Resolved per-call (not cached) to honour test
// config-path mocking, mirroring `getConfigPath`.
function refreshLockPath(): string {
    return `${getConfigPath()}.refresh.lock`
}

/**
 * Best-effort proactive rotation before a request. Returns the token to use
 * (the rotated one, or the current one if no rotation was needed) so the
 * caller doesn't re-read the store; `undefined` when the account isn't
 * refreshable (no refresh token / env / failure) — the caller then falls back
 * to `getApiToken()` and the 401 path stays authoritative. The wrapped store
 * scopes the bundle to any global `--user`; `handshake` pins the token
 * endpoint to that account's instance + client id.
 */
export async function proactiveRefresh(
    handshake?: RequestContext['handshake'],
): Promise<string | undefined> {
    try {
        const { bundle } = await refreshAccessToken({
            store: tokenStore(),
            provider: authProvider(),
            lockPath: refreshLockPath(),
            handshake,
        })
        return bundle.accessToken
    } catch {
        return undefined
    }
}

/**
 * Refresh the *selected* account (not the default) for `auth status`, returning
 * its current-or-rotated token. Scoped via the account's id + base URL/client
 * id through the refresh handshake, so `--user <other>` checks and rotates the
 * right account at the right instance. Env / legacy / record-less accounts
 * aren't refreshable — the snapshot `fallback` token is returned as-is.
 */
export async function refreshedTokenForStatus(
    account: OutlineAccount,
    fallback: string,
): Promise<string> {
    if (process.env[TOKEN_ENV_VAR]?.trim() || !account.id) return fallback
    try {
        const { bundle } = await refreshAccessToken({
            store: tokenStore(),
            provider: authProvider(),
            lockPath: refreshLockPath(),
            ref: account.id,
            handshake: { baseUrl: account.baseUrl, clientId: account.oauthClientId },
        })
        return bundle.accessToken
    } catch {
        return fallback
    }
}

/**
 * Reactive rotation after a 401. Returns `true` when the token rotated (the
 * caller retries once). A rejected/absent refresh token surfaces as
 * `NoTokenError` (re-login); a transient failure propagates unchanged.
 */
export async function reactiveRefresh(handshake?: RequestContext['handshake']): Promise<boolean> {
    try {
        const result = await refreshAccessToken({
            store: tokenStore(),
            provider: authProvider(),
            lockPath: refreshLockPath(),
            force: true,
            handshake,
        })
        return result.rotated
    } catch (err) {
        // Match on the structural `.code` rather than `instanceof`: cli-core
        // throws its own CliError, and class identity isn't reliable across
        // package boundaries (duplicate module instances under linking).
        const code = (err as { code?: unknown } | null)?.code
        if (code === 'AUTH_REFRESH_EXPIRED' || code === 'AUTH_REFRESH_UNAVAILABLE') {
            throw new NoTokenError()
        }
        throw err
    }
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
 * Account-agnostic base URL cascade: env var → default user record (v2) →
 * legacy `base_url` config (v1) → built-in default. Deliberately ignores the
 * global `--user` selector so the login flow (which resolves its default
 * prompt through here) isn't skewed by account selection; the request path
 * applies `--user` separately via {@link getRequestContext}.
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
 * Account-agnostic OAuth client id cascade: env var → default user record
 * (v2) → legacy `oauth_client_id` config (v1) → undefined (caller prompts).
 * Like {@link getBaseUrl}, ignores `--user` so login stays default-driven.
 */
export async function getOAuthClientId(): Promise<string | undefined> {
    const envClientId = process.env.OUTLINE_OAUTH_CLIENT_ID
    if (envClientId) return envClientId

    const config = await getConfig()
    const record = getDefaultUserRecord(config)
    if (record?.account.oauthClientId) return record.account.oauthClientId
    return config.oauth_client_id
}

/**
 * Resolve the base URL — and, when a `--user` account is selected, the refresh
 * handshake (its instance + client id) — for a single managed request. Falls
 * back to the account-agnostic {@link getBaseUrl} cascade without `--user`.
 * An unknown ref resolves no handshake and the default base URL; the wrapped
 * token store then raises `ACCOUNT_NOT_FOUND` when the token is read, so the
 * request never fires.
 */
export async function getRequestContext(): Promise<RequestContext> {
    const ref = requestPathUserRef()
    if (ref !== undefined) {
        const record = recordForRef(await getConfig(), ref)
        if (record) {
            const baseUrl = record.account.baseUrl.replace(/\/$/, '')
            return { baseUrl, handshake: { baseUrl, clientId: record.account.oauthClientId } }
        }
    }
    return { baseUrl: await getBaseUrl() }
}
