import { createInterface } from 'node:readline/promises'
import {
    type AccountRef,
    type AuthProvider,
    createKeyringTokenStore,
    createPkceProvider,
    type KeyringTokenStore,
    type MigrateAuthResult,
    type TokenBundle,
} from '@doist/cli-core/auth'
import { fetchWithRetry } from '../transport/fetch-with-retry.js'
import { apiRequest } from './api.js'
import { LEGACY_CLEAR_PAYLOAD, SECURE_STORE_SERVICE, TOKEN_ENV_VAR } from './auth-constants.js'
import { getBaseUrl, getOAuthClientId } from './auth.js'
import { getConfig, getConfigPath, updateConfig } from './config.js'
import { runMigrateLegacyAuth } from './migrate-auth.js'
import { makeOutlineAccount, matchOutlineAccount, type OutlineAccount } from './outline-account.js'
import { createOutlineUserRecordStore, getDefaultUserRecord, recordForRef } from './user-records.js'

export type { OutlineAccount } from './outline-account.js'
export { matchOutlineAccount } from './outline-account.js'

export type AuthInfoResponse = {
    user: { id: string; name: string; email: string }
    team: { name: string; subdomain: string }
}

export type OutlineTokenStore = KeyringTokenStore<OutlineAccount>

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

/**
 * Routes cli-core's OAuth HTTP through outline's transport so the proxy /
 * decompression dispatcher applies — to the token exchange AND the
 * oauth4webapi refresh grant (cli-core threads this into oauth4webapi's
 * `customFetch`), which would otherwise capture the bare global `fetch`.
 */
const outlineFetch: typeof fetch = (input, init) =>
    fetchWithRetry({ url: input as RequestInfo | URL, options: init ?? {} })

export function createOutlineAuthProvider(): AuthProvider<OutlineAccount> {
    // Captured at `authorize` (which may prompt for it) and reused by
    // `exchangeCode` / `validate` so a single login can't double-prompt. A
    // provider built only for silent refresh never runs `authorize`, so this
    // stays undefined there and `tokenUrl` falls back to stored config — the
    // refresh path must never prompt.
    let baseUrl: string | undefined
    return createPkceProvider<OutlineAccount>({
        authorizeUrl: async ({ flags }) => {
            baseUrl = await resolveBaseUrl(flags)
            return `${baseUrl}/oauth/authorize`
        },
        tokenUrl: async ({ handshake }) => {
            // `handshake.baseUrl` lets a caller scope refresh to a specific
            // account's instance (status --user); otherwise the authorize-time
            // value, then the default config.
            const base =
                baseUrl ?? (handshake.baseUrl as string | undefined) ?? (await getBaseUrl())
            return `${base}/oauth/token`
        },
        // Prefer a handshake-scoped client id (account-aware refresh); else
        // resolve from flag/config (only prompts when neither is set, so it's
        // safe on the refresh path — the logged-in record carries one).
        clientId: ({ handshake, flags }) => {
            const fromHandshake = handshake.clientId
            return typeof fromHandshake === 'string' && fromHandshake
                ? fromHandshake
                : resolveClientId(flags)
        },
        validate: async ({ token, handshake }) => {
            const base = baseUrl ?? (await getBaseUrl())
            const { data } = await apiRequest<AuthInfoResponse>(
                'auth.info',
                {},
                { token, baseUrl: base },
            )
            return makeOutlineAccount({
                id: data.user.id,
                label: data.user.name,
                baseUrl: base,
                oauthClientId: handshake.clientId as string,
                teamName: data.team.name,
            })
        },
        fetchImpl: outlineFetch,
    })
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
    /**
     * Shared env → v2 → legacy resolution for `active` / `activeBundle`.
     * `fromV2` reads the matching cli-core method; `fromEnvOrLegacy` maps an
     * env/legacy token into the caller's shape (env + legacy carry no refresh
     * material, so the bundle form surfaces as access-only).
     */
    async function resolveAuth<T>(
        ref: AccountRef | undefined,
        fromV2: () => Promise<T | null>,
        fromEnvOrLegacy: (token: string, account: OutlineAccount) => T,
    ): Promise<T | null> {
        if (ref === undefined) {
            const envToken = process.env[TOKEN_ENV_VAR]?.trim()
            if (envToken) {
                return fromEnvOrLegacy(
                    envToken,
                    makeOutlineAccount({ id: '', label: '', baseUrl: await getBaseUrl() }),
                )
            }
        }
        await ensureMigrated()
        const fromStore = await fromV2()
        if (fromStore) return fromStore
        const legacy = await readLegacyTokenSnapshot()
        if (legacy && (ref === undefined || matchOutlineAccount(legacy.account, ref))) {
            return fromEnvOrLegacy(legacy.token, legacy.account)
        }
        return null
    }

    // `ensureMigrated` runs before the v2 write so the post-write discharge
    // can't race a pending migration into re-grabbing the legacy token. The
    // discharge is best-effort: a lingering `api_token` is dormant because
    // reads hit v2 first. (`clear` needs the stricter propagating variant.)
    async function writeThenDischargeLegacy(write: () => Promise<void>): Promise<void> {
        await ensureMigrated()
        await write()
        if (await migrationIsInconclusive()) {
            await dischargeLegacyState().catch(() => undefined)
        }
    }

    return {
        active(ref?: AccountRef) {
            return resolveAuth(
                ref,
                () => inner.active(ref),
                (token, account) => ({ token, account }),
            )
        },
        activeAccount(ref?: AccountRef) {
            return resolveAuth(
                ref,
                () => inner.activeAccount(ref),
                (_token, account) => ({ account, isDefault: true }),
            )
        },
        activeBundle(ref?: AccountRef) {
            return resolveAuth(
                ref,
                () => inner.activeBundle(ref),
                (token, account) => ({ account, bundle: { accessToken: token } }),
            )
        },
        set(account: OutlineAccount, token: string) {
            return writeThenDischargeLegacy(() => inner.set(account, token))
        },
        setBundle(account: OutlineAccount, bundle: TokenBundle, options) {
            return writeThenDischargeLegacy(() => inner.setBundle(account, bundle, options))
        },
        async clear(ref?: AccountRef) {
            await ensureMigrated()
            const cleared = await inner.clear(ref)
            if (await migrationIsInconclusive()) {
                // Must succeed: v2 is now empty, so a surviving legacy
                // token would shadow the logout via the fallback.
                await dischargeLegacyState()
            }
            return cleared
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
    }
}

/**
 * Where the currently-active token lives. Mirrors `active()`'s resolution
 * order — env → v2 record → legacy plaintext — so the answer can never
 * contradict the token the runtime is actually using.
 *
 * Pass `ref` to report the source of a specific `--user` account (used by
 * `auth status --user <ref>`): a ref selects the matching record and skips the
 * env short-circuit, so the source reflects the account being shown rather
 * than an ambient env token. Without a ref the default/env cascade applies.
 *
 * The precedence cascade is intentionally duplicated with `active()`:
 * the only true dedupe options either (a) add an extra config read on
 * every `apiRequest` call (regressing the request hot path) or (b)
 * augment cli-core's `TokenStore` contract. The drift the duplication
 * invites is guarded by the `getActiveTokenSource` regression test that
 * asserts v2-record presence wins over a lingering v1 `api_token`.
 */
export async function getActiveTokenSource(
    ref?: AccountRef,
): Promise<'env' | 'secure-store' | 'config-file'> {
    if (ref === undefined && process.env[TOKEN_ENV_VAR]?.trim()) return 'env'
    const config = await getConfig()
    const record = ref !== undefined ? recordForRef(config, ref) : getDefaultUserRecord(config)
    if (record) return record.fallbackToken ? 'config-file' : 'secure-store'
    if (ref === undefined && config.api_token?.trim()) return 'config-file'
    return 'secure-store'
}
