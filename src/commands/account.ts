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
import { logClearResult } from '../lib/auth-output.js'
import {
    createOutlineTokenStore,
    type OutlineAccount,
    type OutlineTokenStore,
    resolveActiveAccountSource,
} from '../lib/auth-provider.js'
import { CliError } from '../lib/errors.js'
import { getRequestedUserRef, isAccessible } from '../lib/global-args.js'

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
 * Adapt the authoritative `resolveActiveAccountSource` to the `activeAccount`
 * contract cli-core's `current` attacher consumes: a stored account resolves
 * normally; the out-of-store env/legacy sources resolve to `null` (their source
 * stashed for `onNotAuthenticated` to render) so they aren't shown as accounts.
 * A `--user`/positional ref that matches nothing surfaces as `ACCOUNT_NOT_FOUND`,
 * matching the global `--user` selector elsewhere.
 */
function currentResolverStore(store: OutlineTokenStore): {
    store: OutlineTokenStore
    getSource: () => 'env' | 'legacy' | undefined
} {
    let source: 'env' | 'legacy' | undefined
    const wrapped: OutlineTokenStore = {
        ...store,
        activeAccount: async (ref?: AccountRef) => {
            source = undefined
            const requested = ref ?? getRequestedUserRef()
            const resolution = await resolveActiveAccountSource(requested)
            if (resolution?.source === 'stored') {
                return { account: resolution.account, isDefault: resolution.isDefault }
            }
            if (resolution) {
                source = resolution.source
                return null
            }
            if (requested !== undefined) {
                throw new CliError(
                    'ACCOUNT_NOT_FOUND',
                    `No stored account matches "${requested}".`,
                    ['Check the account id or display name, or run `ol auth login` to add it.'],
                )
            }
            return null
        },
    }
    return { store: wrapped, getSource: () => source }
}

export function registerAccountCommand(program: Command): void {
    const account = program.command('account').description('Manage stored CLI accounts')
    const store = createOutlineTokenStore()

    const list = attachAccountListCommand<OutlineAccount>(account, {
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

    const { store: currentStore, getSource } = currentResolverStore(store)
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

    // Make bare `ol account` list. A parent action runs only when no subcommand
    // matches, so `ol account list` still routes to the subcommand directly —
    // this just delegates the no-subcommand case via the public API (no reliance
    // on commander internals).
    account.action(async () => {
        await list.parseAsync([], { from: 'user' })
    })

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
