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
    isLegacyAuthActive,
    type OutlineAccount,
    type OutlineTokenStore,
} from '../lib/auth-provider.js'
import { CliError } from '../lib/errors.js'
import { getRequestedUserRef, isAccessible } from '../lib/global-args.js'
import { withUserRefAware } from '../lib/user-ref-store.js'
import { logTokenStorageResult } from './auth.js'

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
 * `current` resolves whatever the runtime would actually use, but the env-token
 * and legacy single-user sources aren't stored accounts — outline's store
 * surfaces them as synthetic snapshots. Short-circuit those (when no explicit
 * `--user` is in play) to `null` so they route to `onNotAuthenticated` and get
 * their own messaging instead of rendering as a blank stored account. An
 * explicit `--user <ref>` always targets a stored account, so it skips the
 * short-circuit and resolves through the ref-aware store.
 */
function currentStore(refAware: OutlineTokenStore): OutlineTokenStore {
    return {
        ...refAware,
        activeAccount: async (ref?: AccountRef) => {
            const requested = ref ?? getRequestedUserRef()
            if (requested === undefined) {
                if (process.env[TOKEN_ENV_VAR]?.trim()) return null
                if (await isLegacyAuthActive()) return null
            }
            return refAware.activeAccount(ref)
        },
    }
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

    attachAccountCurrentCommand<OutlineAccount>(account, {
        store: currentStore(refAware),
        description: 'Show the active account (honours --user and OUTLINE_API_TOKEN)',
        renderText: ({ account, isDefault }) => {
            const lines = [accountLine(account, isDefault), `  Base URL: ${account.baseUrl}`]
            if (account.teamName) lines.push(`  Team: ${account.teamName}`)
            return lines
        },
        renderJson: ({ account, isDefault }) => projectAccount(account, isDefault),
        async onNotAuthenticated({ view }) {
            if (process.env[TOKEN_ENV_VAR]?.trim()) {
                emitView(view, { source: 'env' }, () => [
                    `Using ${TOKEN_ENV_VAR} environment variable (no stored account).`,
                ])
                return
            }
            if (await isLegacyAuthActive()) {
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
            const lines = [`${chalk.green('✓')} Removed ${account.label ?? account.id}`]
            if (wasDefault) {
                lines.push(
                    chalk.dim(
                        'Cleared default account. Set a new one with `ol account use <id|name>`.',
                    ),
                )
            }
            return lines
        },
        onRemoved: ({ view }) => {
            const result = store.getLastClearResult()
            if (!result) return
            logTokenStorageResult(
                result,
                'Stored token removed from the system credential manager',
                view.json || view.ndjson,
            )
        },
    })

    // `attachAccountListCommand` registers `list` without commander's default
    // flag, so wire the parent default explicitly to keep bare `ol account`
    // listing stored accounts.
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
