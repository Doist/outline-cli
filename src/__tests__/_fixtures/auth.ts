import type { MigrateAuthResult } from '@doist/cli-core/auth'
import type { OutlineAccount } from '../../lib/outline-account.js'

/** Canonical persisted `OutlineAccount` used across auth tests. */
export const STORED_ACCOUNT: OutlineAccount = {
    id: 'user-uuid',
    label: 'Ada',
    baseUrl: 'https://wiki.example.com',
    oauthClientId: 'cid-xyz',
    teamName: 'Analytics',
}

/** v1 plaintext config snapshot that round-trips to `STORED_ACCOUNT`. */
export const LEGACY_CONFIG = {
    api_token: 'tk_legacy_plaintext',
    base_url: 'https://wiki.example.com',
    oauth_client_id: 'cid-xyz',
    auth_user_id: 'user-uuid',
    auth_user_name: 'Ada',
    auth_team_name: 'Analytics',
} as const

/** `updateConfig` payload that wipes every v1 auth key. */
export const LEGACY_CLEAR_PAYLOAD = {
    api_token: undefined,
    base_url: undefined,
    oauth_client_id: undefined,
    auth_user_id: undefined,
    auth_user_name: undefined,
    auth_team_name: undefined,
} as const

/** Outline `auth.info` response body. Richer than `STORED_ACCOUNT` (carries email). */
export const AUTH_INFO = {
    user: { id: 'user-uuid', name: 'Ada Lovelace', email: 'ada@example.com' },
    team: { name: 'Analytics', subdomain: 'analytics' },
} as const

/** Stand-in for a cli-core `migrateLegacyAuth` skip result. */
export const SKIPPED_RESULT: MigrateAuthResult<OutlineAccount> = {
    status: 'skipped',
    reason: 'identify-failed',
    detail: 'offline',
}

/** Build a `Response`-shaped object whose `json()` resolves to `body`. */
export function okResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
    } as Response
}

/** Build an error `Response` with the given status (default 500). */
export function errResponse(status: number, statusText = 'Error', body?: unknown): Response {
    return {
        ok: false,
        status,
        statusText,
        json: async () => body ?? {},
    } as Response
}
