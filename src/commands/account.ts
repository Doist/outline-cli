import { emitView } from '@doist/cli-core'
import {
    type AccountRef,
    attachAccountCurrentCommand,
    attachAccountListCommand,
    attachAccountRemoveCommand,
    attachAccountUseCommand,
} from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { TOKEN_ENV_VAR } from '../lib/auth-constants.js'
import {
    createOutlineTokenStore,
    type OutlineAccount,
    type OutlineTokenStore,
} from '../lib/auth-provider.js'
import { CliError } from '../lib/errors.js'
import { getRequestedUserRef, isAccessible } from '../lib/global-args.js'
import { withUserRefAware } from '../lib/user-ref-store.js'
import { logClearResult } from './auth.js'

/** `<label> (id:<id>)` with an accessibility-aware default marker. */
function accountLine(account: OutlineAccount, isDefault: boolean): string {
    const marker = isDefault ? (isAccessible() ? ' [default]' : chalk.green(' (default)')) : ''
    return `${account.label} ${chalk.dim(`(id:${account.id})`)}${marker}`
}

/** Tidy machine projection shared by `list` and `current` — drops the OAuth client id. */
function projectAccount(account: OutlineAccount, isDefault: boolean) {
    return {
        id: account.id,
        label: account.label,
        teamName: account.teamName,
        baseUrl: account.baseUrl,
        isDefault,
    }
}

/**
 * cli-core's `current` attacher calls `store.activeAccount()` once and renders
 * any non-null result as a stored account. But outline's store also synthesises
 * env-token and legacy single-user snapshots, which aren't real stored accounts.
 *
 * Resolve the ambient source once here and stash it so the render path reports a
 * single discriminated shape (`stored` / `env` / `legacy`) without re-probing
 * config. Precedence mirrors `active()`: an env token wins over stored accounts
 * (but only when no explicit account was requested), while a stored v2 account
 * is preferred over a lingering legacy token — so legacy is only surfaced when
 * the store has no v2 record backing the resolved account.
 */
function makeCurrentResolver(store: OutlineTokenStore, refAware: OutlineTokenStore) {
    let source: 'env' | 'legacy' | undefined
    const currentStore: OutlineTokenStore = {
        ...refAware,
        activeAccount: async (ref?: AccountRef) => {
            source = undefined
            const requested = ref ?? getRequestedUserRef()
            if (requested === undefined && process.env[TOKEN_ENV_VAR]?.trim()) {
                source = 'env'
                return null
            }
            const resolved = await refAware.activeAccount(ref)
            if (!resolved) return null
            const isStored = (await store.list()).some(
                (entry) => entry.account.id === resolved.account.id,
            )
            if (isStored) return resolved
            source = 'legacy'
            return null
        },
    }
    return { currentStore, getSource: () => source }
}

export function registerAccountCommand(program: Command): void {
    const account = program.command('account').description('Manage stored CLI accounts')
    const store = createOutlineTokenStore()
    const refAware = withUserRefAware(store)

    attachAccountListCommand<OutlineAccount>(account, {
        store,
        description: 'List stored Outline accounts',
        renderText: ({ accounts }) => {
            if (accounts.length === 0) {
                return 'No stored accounts. Run `ol auth login` to add one.'
            }
            return accounts.map(({ account, isDefault }) => accountLine(account, isDefault))
        },
        renderJson: ({ account, isDefault }) => projectAccount(account, isDefault),
    })

    attachAccountUseCommand<OutlineAccount>(account, {
        store,
        description: 'Set the default account (matched by Outline user id or display name)',
    })

    const { currentStore, getSource } = makeCurrentResolver(store, refAware)
    attachAccountCurrentCommand<OutlineAccount>(account, {
        store: currentStore,
        description: 'Show the active account (honours --user and OUTLINE_API_TOKEN)',
        renderText: ({ account, isDefault }) => {
            const lines = [accountLine(account, isDefault), `  Base URL: ${account.baseUrl}`]
            if (account.teamName) lines.push(`  Team: ${account.teamName}`)
            return lines
        },
        renderJson: ({ account, isDefault }) => ({
            source: 'stored',
            account: projectAccount(account, isDefault),
        }),
        onNotAuthenticated({ view }) {
            const source = getSource()
            if (source === 'env') {
                emitView(view, { source: 'env' }, () => [
                    `Using ${TOKEN_ENV_VAR} environment variable (no stored account).`,
                ])
                return
            }
            if (source === 'legacy') {
                emitView(view, { source: 'legacy' }, () => [
                    'Using legacy single-user credentials. Run `ol auth login` to migrate to a stored account.',
                ])
                return
            }
            throw new CliError('NOT_AUTHENTICATED', 'Not authenticated. Run: ol auth login')
        },
    })

    attachAccountRemoveCommand<OutlineAccount>(account, {
        store,
        description: 'Remove a stored account (clears keyring + config entry)',
        renderText: ({ account, wasDefault }) => {
            const lines = [`${chalk.green('✓')} Removed ${account.label}`]
            if (wasDefault) {
                lines.push(
                    chalk.dim(
                        'Cleared default account. Set a new one with `ol account use <id|name>`.',
                    ),
                )
            }
            return lines
        },
        onRemoved: ({ view }) => logClearResult(store, view.json || view.ndjson),
    })

    // `attachAccountListCommand` registers `list` without commander's default
    // flag, so wire the parent default explicitly to keep bare `ol account`
    // listing stored accounts. Commander exposes no public setter for this in
    // the pinned version (`typeof account.defaultCommand === 'undefined'`), and
    // the attacher owns the `command('list')` call so `{ isDefault: true }` can't
    // be passed at creation — hence the internal-field assignment (mirrors
    // twist-cli).
    ;(account as unknown as { _defaultCommandName: string })._defaultCommandName = 'list'

    account.addHelpText(
        'after',
        `
Examples:
  ol account                     # list stored accounts (default subcommand)
  ol account current             # show the active account
  ol account use "Ada Lovelace"  # set the default account (id or display name)
  ol account remove id-bob       # forget an account (clears keyring + config entry)`,
    )
}
