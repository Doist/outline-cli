/** OS keyring `service` identifier for every outline-cli secret. */
export const SECURE_STORE_SERVICE = 'outline-cli'

/**
 * Legacy single-user keyring slot. Outline never wrote a token to the
 * keyring before this migration, so there is no real legacy slot to read —
 * `migrateLegacyAuth` still expects the option, and its best-effort delete
 * after migration is a harmless no-op on an empty entry.
 */
export const LEGACY_KEYRING_ACCOUNT = 'api-token'
