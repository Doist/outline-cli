import { createInterface } from 'node:readline/promises'
import {
    type AccountRef,
    type AuthProvider,
    createKeyringTokenStore,
    deriveChallenge,
    generateVerifier,
    type KeyringTokenStore,
    type MigrateAuthResult,
} from '@doist/cli-core/auth'
import { fetchWithRetry } from '../transport/fetch-with-retry.js'
import { apiRequest } from './api.js'
import { SECURE_STORE_SERVICE } from './auth-constants.js'
import { getBaseUrl, getOAuthClientId } from './auth.js'
import { getConfig, getConfigPath, updateConfig } from './config.js'
import { runMigrateLegacyAuth } from './migrate-auth.js'
import { makeOutlineAccount, type OutlineAccount } from './outline-account.js'
import { createOutlineUserRecordStore, getDefaultUserRecord } from './user-records.js'

export type { OutlineAccount } from './outline-account.js'

const TOKEN_ENV_VAR = 'OUTLINE_API_TOKEN'

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

            return { accessToken: json.access_token }
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
    account: OutlineAccount
} | null> {
    const config = await getConfig()
    const token = config.api_token?.trim() || null
    if (!token) return null
    return {
        token,
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
 * Best-effort discharge of v1 plaintext state. Runs before a write/clear
 * when migration is inconclusive so v2 writes aren't shadowed by a stale
 * legacy token. Failures are swallowed — the marker is what gates
 * re-migration, not the absence of these fields.
 */
async function dischargeLegacyState(): Promise<void> {
    await updateConfig({
        api_token: undefined,
        base_url: undefined,
        oauth_client_id: undefined,
        auth_user_id: undefined,
        auth_user_name: undefined,
        auth_team_name: undefined,
    }).catch(() => undefined)
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
 * `ensureMigrated()` runs on every stored-state op so the lazy migration
 * fires on first command. When migration isn't conclusive:
 *  - `active()` falls back to the legacy snapshot, honouring `ref` so it
 *    can't resolve to a different account than the caller asked for.
 *  - `set()` / `clear()` discharge legacy state on disk first so v2 writes
 *    aren't shadowed by a stale v1 token on the next read.
 */
export function createOutlineTokenStore(): OutlineTokenStore {
    const inner = createKeyringTokenStore<OutlineAccount>({
        serviceName: SECURE_STORE_SERVICE,
        userRecords: createOutlineUserRecordStore(),
        recordsLocation: getConfigPath(),
        matchAccount: matchOutlineAccount,
    })
    async function maybeDischargeLegacy(): Promise<void> {
        const result = await ensureMigrated()
        if (result === null || !migrationIsConclusive(result)) {
            await dischargeLegacyState()
        }
    }
    return Object.assign(Object.create(inner) as OutlineTokenStore, {
        async active(ref?: AccountRef) {
            if (ref === undefined) {
                const envToken = process.env[TOKEN_ENV_VAR]?.trim()
                if (envToken) {
                    return {
                        token: envToken,
                        account: makeOutlineAccount({
                            id: '',
                            label: '',
                            baseUrl: await getBaseUrl(),
                        }),
                    }
                }
            }
            const result = await ensureMigrated()
            if (result === null || !migrationIsConclusive(result)) {
                const legacy = await readLegacyTokenSnapshot()
                if (legacy && (ref === undefined || matchOutlineAccount(legacy.account, ref))) {
                    return legacy
                }
            }
            return inner.active(ref)
        },
        async set(account: OutlineAccount, token: string) {
            await maybeDischargeLegacy()
            return inner.set(account, token)
        },
        async clear(ref?: AccountRef) {
            await maybeDischargeLegacy()
            return inner.clear(ref)
        },
        async list() {
            await ensureMigrated()
            return inner.list()
        },
        async setDefault(ref: AccountRef) {
            await ensureMigrated()
            return inner.setDefault(ref)
        },
    })
}

/**
 * Where the currently-active token lives. Returns `'config-file'` whenever
 * a plaintext token is on disk — the v2 `fallbackToken` field or the v1
 * `api_token` slot — so diagnostics report the security-relevant state
 * accurately.
 */
export async function getActiveTokenSource(): Promise<'env' | 'secure-store' | 'config-file'> {
    if (process.env[TOKEN_ENV_VAR]?.trim()) return 'env'
    const config = await getConfig()
    if (config.api_token?.trim()) return 'config-file'
    const record = getDefaultUserRecord(config)
    if (!record) return 'secure-store'
    return record.fallbackToken ? 'config-file' : 'secure-store'
}
