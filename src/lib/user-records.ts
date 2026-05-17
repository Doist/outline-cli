import type { UserRecord, UserRecordStore } from '@doist/cli-core/auth'
import { type Config, getConfig, type StoredUser, updateConfig } from './config.js'
import { makeOutlineAccount, type OutlineAccount } from './outline-account.js'

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

function toRecord(user: StoredUser): UserRecord<OutlineAccount> {
    const account = makeOutlineAccount({
        id: user.id,
        label: user.name,
        baseUrl: user.base_url,
        oauthClientId: user.oauth_client_id,
        teamName: user.team_name,
    })
    const trimmed = user.token?.trim()
    const record: UserRecord<OutlineAccount> = { account }
    if (trimmed) record.fallbackToken = trimmed
    return record
}

function fromRecord(record: UserRecord<OutlineAccount>): StoredUser {
    // Replace, don't merge: an absent `fallbackToken` strips the plaintext
    // slot so it can't shadow a fresh keyring-backed write. cli-core contract.
    const trimmed = record.fallbackToken?.trim()
    const next: StoredUser = {
        id: record.account.id,
        name: record.account.label,
    }
    if (record.account.baseUrl) next.base_url = record.account.baseUrl
    if (record.account.oauthClientId) next.oauth_client_id = record.account.oauthClientId
    if (record.account.teamName) next.team_name = record.account.teamName
    if (trimmed && trimmed.length > 0) next.token = trimmed
    return next
}
