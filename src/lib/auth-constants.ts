import type { Config } from './config.js'

/** OS keyring `service` identifier for every outline-cli secret. */
export const SECURE_STORE_SERVICE = 'outline-cli'

/** Env var that short-circuits the token store with a manually-supplied token. */
export const TOKEN_ENV_VAR = 'OUTLINE_API_TOKEN'

/**
 * Legacy single-user keyring slot. Outline never wrote a token to the
 * keyring before this migration, so there is no real legacy slot to read —
 * `migrateLegacyAuth` still expects the option, and its best-effort delete
 * after migration is a harmless no-op on an empty entry.
 */
export const LEGACY_KEYRING_ACCOUNT = 'api-token'

/**
 * `updateConfig` payload that wipes every v1 auth key. Used by both the
 * one-shot migration `cleanupLegacyConfig` and the runtime
 * `dischargeLegacyState` so both paths stay in lockstep.
 */
export const LEGACY_CLEAR_PAYLOAD: Partial<Config> = {
    api_token: undefined,
    base_url: undefined,
    oauth_client_id: undefined,
    auth_user_id: undefined,
    auth_user_name: undefined,
    auth_team_name: undefined,
}
