import type { MigrateAuthResult } from '@doist/cli-core/auth'
import type { Config } from '../lib/config.js'
import type { OutlineAccount } from '../lib/outline-account.js'

/** Canonical persisted `OutlineAccount` used across auth tests. */
export const STORED_ACCOUNT: OutlineAccount = {
    id: 'user-uuid',
    label: 'Ada',
    baseUrl: 'https://wiki.example.com',
    oauthClientId: 'cid-xyz',
    teamName: 'Analytics',
}

/** Secondary persisted `OutlineAccount` on a different instance — for multi-account tests. */
export const STORED_ACCOUNT_BOB: OutlineAccount = {
    id: 'bob-uuid',
    label: 'Bob',
    baseUrl: 'https://bob.example.com',
    oauthClientId: 'cid-bob',
    teamName: 'Engineering',
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

/**
 * Two v2 accounts on different Outline instances — Ada is the default, Bob the
 * secondary — for exercising the `--user` selector. Tokens are plaintext
 * fallbacks so the store resolves them without a live keyring.
 */
export const TWO_USER_CONFIG: Config = {
    config_version: 2,
    users: [
        {
            id: 'id-ada',
            name: 'Ada',
            base_url: 'https://ada.example.com',
            oauth_client_id: 'cid-ada',
            token: 'tok-ada',
        },
        {
            id: 'id-bob',
            name: 'Bob',
            base_url: 'https://bob.example.com',
            oauth_client_id: 'cid-bob',
            token: 'tok-bob',
        },
    ],
    default_user_id: 'id-ada',
}

/** Stand-in for a cli-core `migrateLegacyAuth` skip result. */
export const SKIPPED_RESULT: MigrateAuthResult<OutlineAccount> = {
    status: 'skipped',
    reason: 'identify-failed',
    detail: 'offline',
}

/** 200 `Response` with `body` as JSON, using the native static helper. */
export function okResponse(body: unknown): Response {
    return Response.json(body)
}

/** Error `Response` with the given status (default 500). */
export function errResponse(status: number, statusText = 'Error', body?: unknown): Response {
    return Response.json(body ?? {}, { status, statusText })
}
