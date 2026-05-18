import { createInterface } from 'node:readline/promises'
import {
    type AccountRef,
    type AuthProvider,
    createKeyringTokenStore,
    deriveChallenge,
    type ExchangeResult,
    generateVerifier,
    type KeyringTokenStore,
    type MigrateAuthResult,
    type RefreshInput,
    type TokenBundle,
} from '@doist/cli-core/auth'
import { fetchWithRetry } from '../transport/fetch-with-retry.js'
import { apiRequest } from './api.js'
import { LEGACY_CLEAR_PAYLOAD, SECURE_STORE_SERVICE, TOKEN_ENV_VAR } from './auth-constants.js'
import { getBaseUrl, getOAuthClientId } from './auth.js'
import { getConfig, getConfigPath, updateConfig } from './config.js'
import { runMigrateLegacyAuth } from './migrate-auth.js'
import { makeOutlineAccount, type OutlineAccount } from './outline-account.js'
import { createOutlineUserRecordStore, getDefaultUserRecord } from './user-records.js'

export type { OutlineAccount } from './outline-account.js'

export type AuthInfoResponse = {
    user: { id: string; name: string; email: string }
    team: { name: string; subdomain: string }
}

export type OutlineTokenStore = KeyringTokenStore<OutlineAccount>

type OutlineHandshake = Record<string, unknown> & {
    baseUrl: string
    clientId: string
    codeVerifier?: string
}

function asHandshake(value: Record<string, unknown>): OutlineHandshake {
    return value as OutlineHandshake
}

function stringFlag(flags: Record<string, unknown>, key: string): string | undefined {
    const value = flags[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function prompt(question: string): Promise<string> {
    // Output to stderr so `--json` / `--ndjson` envelopes on stdout stay clean.
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
        return (await rl.question(question)).trim()
    } finally {
        rl.close()
    }
}

async function resolveBaseUrl(flags: Record<string, unknown>): Promise<string> {
    const fromFlag = stringFlag(flags, 'baseUrl')
    if (fromFlag) return fromFlag.replace(/\/$/, '')
    const fromEnv = process.env.OUTLINE_URL?.trim()
    if (fromEnv) return fromEnv.replace(/\/$/, '')
    const configured = await getBaseUrl()
    const answered = await prompt(`Base URL (default: ${configured}): `)
    return (answered || configured).replace(/\/$/, '')
}

async function resolveClientId(flags: Record<string, unknown>): Promise<string> {
    const fromFlag = stringFlag(flags, 'clientId')
    if (fromFlag) return fromFlag
    const existing = await getOAuthClientId()
    if (existing) return existing
    const answered = await prompt('OAuth Client ID: ')
    if (!answered) {
        throw new Error(
            'OAuth client ID is required. Create a public OAuth app in Outline settings, then pass --client-id <id> or set OUTLINE_OAUTH_CLIENT_ID.',
        )
    }
    return answered
}

export function createOutlineAuthProvider(): AuthProvider<OutlineAccount> {
    return {
        async authorize({ redirectUri, state, flags }) {
            const baseUrl = await resolveBaseUrl(flags)
            const clientId = await resolveClientId(flags)
            const codeVerifier = generateVerifier()
            const codeChallenge = deriveChallenge(codeVerifier)

            const url = new URL(`${baseUrl}/oauth/authorize`)
            url.searchParams.set('client_id', clientId)
            url.searchParams.set('response_type', 'code')
            url.searchParams.set('code_challenge', codeChallenge)
            url.searchParams.set('code_challenge_method', 'S256')
            url.searchParams.set('redirect_uri', redirectUri)
            url.searchParams.set('state', state)

            const handshake: OutlineHandshake = { baseUrl, clientId, codeVerifier }
            return { authorizeUrl: url.toString(), handshake }
        },

        async exchangeCode({ code, redirectUri, handshake }) {
            const hs = asHandshake(handshake)
            if (!hs.codeVerifier) {
                throw new Error('Missing PKCE code verifier from authorize step.')
            }

            const params = new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: hs.clientId,
                redirect_uri: redirectUri,
                code_verifier: hs.codeVerifier,
                code,
            })

            const res = await fetchWithRetry({
                url: `${hs.baseUrl}/oauth/token`,
                options: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString(),
                },
            })

            const json = (await res.json().catch(() => ({}))) as {
                access_token?: string
                refresh_token?: string
                expires_in?: number
                error?: string
                error_description?: string
                message?: string
            }

            if (!res.ok) {
                const message =
                    json.error_description || json.message || json.error || res.statusText
                throw new Error(`OAuth token exchange failed: ${message}`)
            }

            if (!json.access_token) {
                throw new Error('OAuth token exchange did not return an access token.')
            }

            return {
                accessToken: json.access_token,
                refreshToken: json.refresh_token,
                accessTokenExpiresAt:
                    typeof json.expires_in === 'number'
                        ? Date.now() + json.expires_in * 1000
                        : undefined,
            }
        },

        async refreshToken(
            input: RefreshInput<OutlineAccount>,
        ): Promise<ExchangeResult<OutlineAccount>> {
            // At refresh time the user is long past the authorize step, so
            // there is no PKCE handshake. We rebuild what we need from the
            // stored account: Outline OAuth refresh on a public client takes
            // `grant_type=refresh_token` + `refresh_token` + `client_id`,
            // no client_secret, no code_verifier.
            const baseUrl = input.account.baseUrl?.replace(/\/$/, '')
            const clientId = input.account.oauthClientId
            if (!baseUrl || !clientId) {
                throw new Error(
                    'Cannot refresh: stored account is missing baseUrl or oauthClientId. Run: ol auth login',
                )
            }

            const params = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: input.refreshToken,
                client_id: clientId,
            })

            const res = await fetchWithRetry({
                url: `${baseUrl}/oauth/token`,
                options: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString(),
                },
            })

            const json = (await res.json().catch(() => ({}))) as {
                access_token?: string
                refresh_token?: string
                expires_in?: number
                error?: string
                error_description?: string
                message?: string
            }

            if (!res.ok) {
                const message =
                    json.error_description || json.message || json.error || res.statusText
                throw new Error(`OAuth refresh failed: ${message}`)
            }
            if (!json.access_token) {
                throw new Error('OAuth refresh did not return an access token.')
            }

            return {
                accessToken: json.access_token,
                // Some OAuth servers rotate the refresh token on each refresh,
                // others reuse it. Persist whatever comes back; the caller's
                // `refreshAccessToken` helper preserves the existing refresh
                // when the server doesn't return one.
                refreshToken: json.refresh_token,
                accessTokenExpiresAt:
                    typeof json.expires_in === 'number'
                        ? Date.now() + json.expires_in * 1000
                        : undefined,
                // Pass the account through so the helper doesn't have to
                // re-derive it (PKCE provider does the same).
                account: input.account,
            }
        },

        async validateToken({ token, handshake }) {
            const hs = asHandshake(handshake)
            const { data } = await apiRequest<AuthInfoResponse>(
                'auth.info',
                {},
                {
                    token,
                    baseUrl: hs.baseUrl,
                },
            )
            return makeOutlineAccount({
                id: data.user.id,
                label: data.user.name,
                baseUrl: hs.baseUrl,
                oauthClientId: hs.clientId,
                teamName: data.team.name,
            })
        },
    }
}

/**
 * Accepts the Outline user UUID or display name. Id matches are
 * case-sensitive (UUIDs are canonical); label matches are
 * case-insensitive so users can pass the name they see in `auth status`.
 */
export function matchOutlineAccount(account: OutlineAccount, ref: AccountRef): boolean {
    if (account.id === ref) return true
    return account.label.toLowerCase() === ref.toLowerCase()
}

/** True when the v2 store is the authoritative source. */
function migrationIsConclusive(result: MigrateAuthResult<OutlineAccount>): boolean {
    return (
        result.status === 'migrated' ||
        result.status === 'already-migrated' ||
        result.status === 'no-legacy-state'
    )
}

/**
 * Synthesise a snapshot from v1 plaintext state still on disk. Fallback for
 * when migration can't complete (offline `identifyAccount`, WSL
 * `legacy-keyring-unreachable`). Returns `null` when no legacy token is
 * present. The synthesised account uses whatever identity fields the v1
 * config has — for pre-#71 configs the id/label may be empty, but the
 * runtime never renders those (status's `fetchLive` re-derives from the
 * API), so empty placeholders are safe.
 */
async function readLegacyTokenSnapshot(): Promise<{
    token: string
    bundle: TokenBundle
    account: OutlineAccount
} | null> {
    const config = await getConfig()
    const token = config.api_token?.trim() || null
    if (!token) return null
    return {
        token,
        bundle: { accessToken: token },
        account: makeOutlineAccount({
            id: config.auth_user_id ?? '',
            label: config.auth_user_name ?? '',
            baseUrl: config.base_url,
            oauthClientId: config.oauth_client_id,
            teamName: config.auth_team_name,
        }),
    }
}

/**
 * Discharge v1 plaintext state. Runs **after** a successful v2 write/clear
 * — never before — so a v2-op failure doesn't strand the user with no
 * recoverable credentials. Caller decides whether to swallow or propagate
 * the `updateConfig` failure:
 *   - `set()` swallows (v2 record will win in `active()` regardless).
 *   - `clear()` propagates (v2 is empty, so a stale legacy token would
 *     shadow the logout via the fallback).
 */
async function dischargeLegacyState(): Promise<void> {
    await updateConfig(LEGACY_CLEAR_PAYLOAD)
}

/**
 * Memoised one-shot migration trigger. Resolves with `null` on rejection so
 * the CLI never fails to start because of a migration error — the legacy
 * snapshot fallback handles that case. Tests reset the memo with
 * `vi.resetModules()` + a dynamic re-import.
 */
let migrationPromise: Promise<MigrateAuthResult<OutlineAccount> | null> | undefined
function ensureMigrated(): Promise<MigrateAuthResult<OutlineAccount> | null> {
    if (!migrationPromise) {
        migrationPromise = runMigrateLegacyAuth({ silent: true }).catch(() => null)
    }
    return migrationPromise
}

/**
 * True when the v2 store is empty but a legacy v1 token snapshot is still
 * the only thing keeping the CLI authenticated — typically because
 * `migrateLegacyAuth` couldn't reach the Outline API to identify the
 * account (`MigrateSkipReason: 'identify-failed'`) or the OS keyring is
 * unreachable (`'legacy-keyring-unreachable'`, although outline has no
 * v1 keyring slot to read from). Useful for downstream diagnostics.
 */
export async function isLegacyAuthActive(): Promise<boolean> {
    const result = await ensureMigrated()
    if (result !== null && migrationIsConclusive(result)) return false
    const legacy = await readLegacyTokenSnapshot()
    return legacy !== null
}

/**
 * `OUTLINE_API_TOKEN` short-circuits `active()` only when no explicit ref
 * is supplied — cli-core's `KeyringTokenStore` doesn't know about the env
 * var, and an explicit ref means the caller targets a specific stored
 * account.
 *
 * `ensureMigrated()` runs **before** every mutating v2 op so the post-op
 * legacy discharge can't race a still-pending migration into re-grabbing
 * the legacy `api_token` we just consumed. `set()` / `clear()` then
 * discharge legacy state **after** the v2 op succeeds. `set()` swallows
 * the cleanup failure (v2 wins in `active()` regardless); `clear()`
 * propagates it so a failed logout fails loudly instead of leaving the
 * user authenticated via the legacy fallback.
 */
export function createOutlineTokenStore(): OutlineTokenStore {
    const inner = createKeyringTokenStore<OutlineAccount>({
        serviceName: SECURE_STORE_SERVICE,
        userRecords: createOutlineUserRecordStore(),
        recordsLocation: getConfigPath(),
        matchAccount: matchOutlineAccount,
    })
    async function migrationIsInconclusive(): Promise<boolean> {
        const result = await ensureMigrated() // memoised
        return result === null || !migrationIsConclusive(result)
    }
    return {
        async active(ref?: AccountRef) {
            if (ref === undefined) {
                const envToken = process.env[TOKEN_ENV_VAR]?.trim()
                if (envToken) {
                    return {
                        token: envToken,
                        bundle: { accessToken: envToken },
                        account: makeOutlineAccount({
                            id: '',
                            label: '',
                            baseUrl: await getBaseUrl(),
                        }),
                    }
                }
            }
            await ensureMigrated()
            const fromStore = await inner.active(ref)
            if (fromStore) return fromStore

            const legacy = await readLegacyTokenSnapshot()
            if (legacy && (ref === undefined || matchOutlineAccount(legacy.account, ref))) {
                return legacy
            }
            return null
        },
        async set(account: OutlineAccount, credentials: string | TokenBundle) {
            await ensureMigrated()
            await inner.set(account, credentials)
            if (await migrationIsInconclusive()) {
                // Best-effort: a lingering `api_token` is dormant because
                // `active()` reads v2 first.
                await dischargeLegacyState().catch(() => undefined)
            }
        },
        async clear(ref?: AccountRef) {
            await ensureMigrated()
            await inner.clear(ref)
            if (await migrationIsInconclusive()) {
                // Must succeed: v2 is now empty, so a surviving legacy
                // token would shadow the logout via the fallback.
                await dischargeLegacyState()
            }
        },
        async list() {
            await ensureMigrated()
            return inner.list()
        },
        async setDefault(ref: AccountRef) {
            await ensureMigrated()
            return inner.setDefault(ref)
        },
        getLastStorageResult: () => inner.getLastStorageResult(),
        getLastClearResult: () => inner.getLastClearResult(),
        getRecordsLocation: () => inner.getRecordsLocation(),
    }
}

/**
 * Where the currently-active token lives. Mirrors `active()`'s resolution
 * order — env → v2 record → legacy plaintext — so the answer can never
 * contradict the token the runtime is actually using.
 *
 * The precedence cascade is intentionally duplicated with `active()`:
 * the only true dedupe options either (a) add an extra config read on
 * every `apiRequest` call (regressing the request hot path) or (b)
 * augment cli-core's `TokenStore` contract. The drift the duplication
 * invites is guarded by the `getActiveTokenSource` regression test that
 * asserts v2-record presence wins over a lingering v1 `api_token`.
 */
export async function getActiveTokenSource(): Promise<'env' | 'secure-store' | 'config-file'> {
    if (process.env[TOKEN_ENV_VAR]?.trim()) return 'env'
    const config = await getConfig()
    const record = getDefaultUserRecord(config)
    if (record) return record.fallbackToken ? 'config-file' : 'secure-store'
    if (config.api_token?.trim()) return 'config-file'
    return 'secure-store'
}
