import { type MigrateAuthResult, migrateLegacyAuth } from '@doist/cli-core/auth'
import { fetchWithRetry } from '../transport/fetch-with-retry.js'
import { LEGACY_KEYRING_ACCOUNT, SECURE_STORE_SERVICE } from './auth-constants.js'
import { getConfig, updateConfig } from './config.js'
import { makeOutlineAccount, type OutlineAccount } from './outline-account.js'
import { createOutlineUserRecordStore } from './user-records.js'

/**
 * Pinned to this migration's target schema. Decoupled from any future
 * `config_version` bump so this helper doesn't re-run for users already
 * on v2 or beyond.
 */
const V2_SCHEMA_VERSION = 2

const DEFAULT_BASE_URL = 'https://app.getoutline.com'

type AuthInfoResponse = {
    data: {
        user: { id: string; name: string }
        team: { name: string }
    }
}

/**
 * Direct `auth.info` call used only by the migration path. We bypass
 * `apiRequest` (and its spinner + `getApiToken`/`getBaseUrl` cascade) so
 * this module stays out of the runtime auth/token-store import graph and
 * so the silent migration doesn't render a spinner during postinstall-style
 * invocations.
 */
async function identifyOutlineAccount(token: string): Promise<OutlineAccount> {
    const config = await getConfig()
    const baseUrl = (config.base_url ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    const res = await fetchWithRetry({
        url: `${baseUrl}/api/auth.info`,
        options: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({}),
        },
    })
    if (!res.ok) {
        throw new Error(`auth.info failed: ${res.status} ${res.statusText}`)
    }
    const json = (await res.json()) as AuthInfoResponse
    return makeOutlineAccount({
        id: json.data.user.id,
        label: json.data.user.name,
        baseUrl,
        oauthClientId: config.oauth_client_id ?? '',
        teamName: json.data.team.name,
    })
}

/**
 * One-time migration of v1 plaintext auth state into the v2 `users[]`
 * shape. Called lazily by `createOutlineTokenStore` on first store access.
 * Idempotent via the `config_version` marker — once set to `>= 2`, this
 * helper short-circuits with `already-migrated`.
 */
export async function runMigrateLegacyAuth(
    options: { silent: boolean } = { silent: true },
): Promise<MigrateAuthResult<OutlineAccount>> {
    return migrateLegacyAuth<OutlineAccount>({
        serviceName: SECURE_STORE_SERVICE,
        legacyAccount: LEGACY_KEYRING_ACCOUNT,
        userRecords: createOutlineUserRecordStore(),
        hasMigrated: async () => {
            const config = await getConfig()
            return (config.config_version ?? 0) >= V2_SCHEMA_VERSION
        },
        markMigrated: async () => {
            await updateConfig({ config_version: V2_SCHEMA_VERSION })
        },
        loadLegacyPlaintextToken: async () => {
            const config = await getConfig()
            return config.api_token?.trim() || null
        },
        identifyAccount: identifyOutlineAccount,
        cleanupLegacyConfig: async () => {
            await updateConfig({
                api_token: undefined,
                base_url: undefined,
                oauth_client_id: undefined,
                auth_user_id: undefined,
                auth_user_name: undefined,
                auth_team_name: undefined,
            })
        },
        silent: options.silent,
        logPrefix: 'outline-cli',
    })
}
