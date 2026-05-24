import type { AccountRef, AuthAccount } from '@doist/cli-core/auth'

/**
 * Narrow account shape persisted by the keyring-backed token store.
 *
 * `id` is the Outline user UUID; `label` is the user's display name.
 * `baseUrl` and `oauthClientId` ride along on the account because Outline
 * is self-hostable — every persisted token is tied to the instance it was
 * issued for, not to a global default. `teamName` is rendered by
 * `ol auth status`; it's the only field we cache for display.
 */
export type OutlineAccount = AuthAccount & {
    id: string
    label: string
    baseUrl: string
    oauthClientId: string
    teamName?: string
}

export const DEFAULT_BASE_URL = 'https://app.getoutline.com'

/** Canonical `OutlineAccount` factory. Applies the `baseUrl` default. */
export function makeOutlineAccount(input: {
    id: string
    label: string
    baseUrl?: string
    oauthClientId?: string
    teamName?: string
}): OutlineAccount {
    return {
        id: input.id,
        label: input.label,
        baseUrl: input.baseUrl ?? DEFAULT_BASE_URL,
        oauthClientId: input.oauthClientId ?? '',
        teamName: input.teamName,
    }
}

/**
 * Accepts the Outline user UUID or display name. Id matches are
 * case-sensitive (UUIDs are canonical); label matches are case-insensitive
 * so users can pass the name they see in `auth status`.
 */
export function matchOutlineAccount(account: OutlineAccount, ref: AccountRef): boolean {
    if (account.id === ref) return true
    return account.label.toLowerCase() === ref.toLowerCase()
}
