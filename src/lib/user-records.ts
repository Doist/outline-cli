import type { AccountRef, UserRecord, UserRecordStore } from '@doist/cli-core/auth'
import { type Config, getConfig, type StoredUser, updateConfig } from './config.js'
import { makeOutlineAccount, matchOutlineAccount, type OutlineAccount } from './outline-account.js'

/**
 * `UserRecordStore` adapter over `config.users[]`. `StoredUser.token` is
 * surfaced as `fallbackToken` — cli-core's name for the plaintext copy
 * persisted only when the keyring is unreachable.
 */
export function createOutlineUserRecordStore(): UserRecordStore<OutlineAccount> {
    return {
        async list() {
            const config = await getConfig()
            return (config.users ?? []).map(toRecord)
        },
        async upsert(record) {
            const config = await getConfig()
            const existing = config.users ?? []
            const next = fromRecord(record)
            const index = existing.findIndex((u) => u.id === record.account.id)
            const users =
                index >= 0
                    ? [...existing.slice(0, index), next, ...existing.slice(index + 1)]
                    : [...existing, next]
            await updateConfig({ users })
        },
        async remove(id) {
            const config = await getConfig()
            const existing = config.users ?? []
            const index = existing.findIndex((u) => u.id === id)
            if (index < 0) return
            const users = [...existing.slice(0, index), ...existing.slice(index + 1)]
            const updates: { users: StoredUser[]; default_user_id?: undefined } = { users }
            if (config.default_user_id === id) updates.default_user_id = undefined
            await updateConfig(updates)
        },
        async getDefaultId() {
            const config = await getConfig()
            return config.default_user_id ?? null
        },
        async setDefaultId(id) {
            await updateConfig({ default_user_id: id ?? undefined })
        },
    }
}

/**
 * Resolve the default-or-first `UserRecord` from an already-loaded config.
 * Returns `null` when no users are stored.
 */
export function getDefaultUserRecord(config: Partial<Config>): UserRecord<OutlineAccount> | null {
    const users = config.users ?? []
    if (users.length === 0) return null
    const defaultId = config.default_user_id
    const user = (defaultId && users.find((u) => u.id === defaultId)) || users[0]
    return toRecord(user)
}

/**
 * Resolve a `UserRecord` by `--user` ref (UUID or display name). Falls back to
 * the default-or-first record when `ref` is absent, so callers can pass the
 * global selector straight through. Returns `null` when no users are stored or
 * an explicit ref matches nothing.
 */
export function recordForRef(
    config: Partial<Config>,
    ref?: AccountRef,
): UserRecord<OutlineAccount> | null {
    if (ref === undefined) return getDefaultUserRecord(config)
    const user = (config.users ?? []).find((u) => matchOutlineAccount(toRecord(u).account, ref))
    return user ? toRecord(user) : null
}

function toRecord(user: StoredUser): UserRecord<OutlineAccount> {
    const account = makeOutlineAccount({
        id: user.id,
        label: user.name,
        baseUrl: user.base_url,
        oauthClientId: user.oauth_client_id,
        teamName: user.team_name,
    })
    const record: UserRecord<OutlineAccount> = { account }
    const token = user.token?.trim()
    if (token) record.fallbackToken = token
    if (user.access_token_expires_at !== undefined) {
        record.accessTokenExpiresAt = user.access_token_expires_at
    }
    if (user.refresh_token_expires_at !== undefined) {
        record.refreshTokenExpiresAt = user.refresh_token_expires_at
    }
    if (user.has_refresh_token !== undefined) record.hasRefreshToken = user.has_refresh_token
    return record
}

function fromRecord(record: UserRecord<OutlineAccount>): StoredUser {
    // Replace, don't merge: absent fields strip the corresponding slots so a
    // stale value can't shadow a fresh keyring-backed write. cli-core contract.
    const next: StoredUser = {
        id: record.account.id,
        name: record.account.label,
    }
    if (record.account.baseUrl) next.base_url = record.account.baseUrl
    if (record.account.oauthClientId) next.oauth_client_id = record.account.oauthClientId
    if (record.account.teamName) next.team_name = record.account.teamName
    const token = record.fallbackToken?.trim()
    if (token) next.token = token
    // Deliberately NOT persisting `fallbackRefreshToken`: the refresh token is
    // a long-lived credential and must stay in the secure store only. If the
    // keyring is offline at write time, the refresh token isn't persisted, so
    // that account fails closed (re-auth on next expiry) rather than leaving a
    // long-lived secret in plaintext config. (Doist secrets-management standard.)
    if (record.accessTokenExpiresAt !== undefined) {
        next.access_token_expires_at = record.accessTokenExpiresAt
    }
    if (record.refreshTokenExpiresAt !== undefined) {
        next.refresh_token_expires_at = record.refreshTokenExpiresAt
    }
    if (record.hasRefreshToken !== undefined) next.has_refresh_token = record.hasRefreshToken
    return next
}
