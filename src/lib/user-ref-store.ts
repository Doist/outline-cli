import type { AccountRef } from '@doist/cli-core/auth'
import type { OutlineTokenStore } from './auth-provider.js'
import { CliError } from './errors.js'
import { getRequestedUserRef } from './global-args.js'

/**
 * Bridge the global `ol --user <ref>` selector — stripped from argv before
 * Commander parses (see `applyUserSelector`) — into store reads that make no
 * explicit ref. An explicit `ref` argument always wins; only a missing one
 * falls back to the global selector. Used by both the request path
 * (`auth.ts` `tokenStore()`) and cli-core's auth attachers (`auth status` /
 * `auth logout`), so a `--user` placed before any command is honoured
 * everywhere.
 *
 * Existence is checked via `activeAccount(ref)` rather than `list()` so the
 * check is both token-free (a keyring-offline account can still be cleared by
 * `auth logout`) and legacy-aware (`list()` only exposes v2 records, but a
 * pending v1→v2 migration can still resolve its single legacy account).
 */
export function withUserRefAware(store: OutlineTokenStore): OutlineTokenStore {
    async function resolveRef(ref?: AccountRef): Promise<AccountRef | undefined> {
        const target = ref ?? getRequestedUserRef()
        if (target === undefined) return undefined
        if (!(await store.activeAccount(target))) {
            throw new CliError('ACCOUNT_NOT_FOUND', `No stored account matches "${target}".`, [
                'Check the account id or display name, or run `ol auth login` to add it.',
            ])
        }
        return target
    }

    return {
        ...store,
        active: async (ref?: AccountRef) => store.active(await resolveRef(ref)),
        activeBundle: async (ref?: AccountRef) => store.activeBundle(await resolveRef(ref)),
        activeAccount: async (ref?: AccountRef) => store.activeAccount(await resolveRef(ref)),
        clear: async (ref?: AccountRef) => store.clear(await resolveRef(ref)),
    }
}
