import {
    attachLoginCommand,
    attachLogoutCommand,
    attachStatusCommand,
    type TokenStorageResult,
} from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { apiRequest } from '../lib/api.js'
import { renderError, renderSuccess } from '../lib/auth-pages.js'
import {
    type AuthInfoResponse,
    createOutlineAuthProvider,
    createOutlineTokenStore,
    getActiveTokenSource,
    type OutlineAccount,
    type OutlineTokenStore,
} from '../lib/auth-provider.js'
import { refreshedTokenForStatus } from '../lib/auth.js'
import { CliError } from '../lib/errors.js'

const DEFAULT_OAUTH_CALLBACK_PORT = 54969

type StatusData = {
    email: string
    source: 'env' | 'secure-store' | 'config-file'
}

function resolvePreferredCallbackPort(): number {
    const raw = process.env.OUTLINE_OAUTH_CALLBACK_PORT?.trim()
    if (!raw) return DEFAULT_OAUTH_CALLBACK_PORT
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        return DEFAULT_OAUTH_CALLBACK_PORT
    }
    return parsed
}

/**
 * Surface a `TokenStorageResult` from a save/clear: the human-readable
 * confirmation goes to stdout, any keyring-fallback warning goes to stderr.
 * Pass `isMachineOutput: true` to suppress the stdout confirmation in
 * `--json` / `--ndjson` mode while still routing the warning to stderr.
 *
 * Exported for direct unit testing — the alternative (driving this via
 * mocked cli-core login/logout hooks) would require stubbing the entire
 * store contract just to assert two console calls.
 */
export function logTokenStorageResult(
    result: TokenStorageResult,
    secureStoreMessage: string,
    isMachineOutput = false,
): void {
    if (!isMachineOutput && result.storage === 'secure-store') {
        console.log(chalk.dim(secureStoreMessage))
    }
    if (result.warning) {
        console.error(chalk.yellow('Warning:'), result.warning)
    }
}

export function registerAuthCommand(program: Command): void {
    const auth = program.command('auth').description('Manage authentication')

    const provider = createOutlineAuthProvider()
    const store: OutlineTokenStore = createOutlineTokenStore()

    attachLoginCommand(auth, {
        provider,
        store,
        preferredPort: resolvePreferredCallbackPort(),
        resolveScopes: () => [],
        renderSuccess,
        renderError,
        onSuccess({ view, account }) {
            const isMachineOutput = view.json || view.ndjson
            if (!isMachineOutput) {
                console.log(chalk.green(`Authenticated to ${account.teamName} as ${account.label}`))
            }
            const result = store.getLastStorageResult()
            if (result) {
                logTokenStorageResult(
                    result,
                    'Token stored securely in the system credential manager',
                    isMachineOutput,
                )
            }
        },
    })
        .description('Authenticate with an Outline instance via OAuth')
        .option(
            '--base-url <url>',
            'Outline base URL to use for this login (saved for future logins)',
        )
        .option(
            '--client-id <clientId>',
            'OAuth client ID to use for this login (saved for future logins)',
        )

    // `attachStatusCommand` guarantees `fetchLive` runs before `renderText` /
    // `renderJson` within a single invocation, so the stash is always
    // populated by the time the render hooks read it.
    let statusData: StatusData | null = null

    attachStatusCommand<OutlineAccount>(auth, {
        store,
        description: 'Show current authentication state',
        async fetchLive({ account, token }) {
            try {
                // Refresh the *selected* account before the check (scoped via
                // its id + base URL/client id), then probe with the rotated
                // token. Outline access tokens last ~an hour; without this
                // `auth status` can't self-heal even though normal commands
                // do. Passing the resolved token keeps the check tied to the
                // requested account rather than the default.
                const liveToken = await refreshedTokenForStatus(account, token)
                const [{ data: info }, source] = await Promise.all([
                    apiRequest<AuthInfoResponse>(
                        'auth.info',
                        {},
                        { token: liveToken, baseUrl: account.baseUrl },
                    ),
                    getActiveTokenSource(),
                ])
                statusData = { email: info.user.email, source }
                return {
                    ...account,
                    id: info.user.id,
                    label: info.user.name,
                    teamName: info.team.name,
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : ''
                if (/\b401\b/.test(message) || /Authentication required/i.test(message)) {
                    throw new CliError('NO_TOKEN', 'Not authenticated (token expired or invalid)', [
                        'Run `ol auth login` to re-authenticate',
                    ])
                }
                throw err
            }
        },
        renderText({ account }) {
            if (!statusData) throw new Error('status renderText called before fetchLive')
            return [
                `${chalk.green('✓')} Authenticated`,
                `  Team: ${chalk.bold(account.teamName ?? '')}`,
                `  User: ${account.label} (${statusData.email})`,
                `  Base URL: ${account.baseUrl}`,
                `  Token source: ${statusData.source}`,
            ]
        },
        renderJson({ account }) {
            if (!statusData) throw new Error('status renderJson called before fetchLive')
            return {
                id: account.id,
                team: account.teamName,
                baseUrl: account.baseUrl,
                source: statusData.source,
            }
        },
        onNotAuthenticated() {
            throw new CliError('NOT_AUTHENTICATED', 'Not authenticated. Run: ol auth login')
        },
    })

    attachLogoutCommand<OutlineAccount>(auth, {
        store,
        description: 'Clear saved authentication',
        onCleared({ view }) {
            const result = store.getLastClearResult()
            if (!result) return
            logTokenStorageResult(
                result,
                'Stored token removed from the system credential manager',
                view.json || view.ndjson,
            )
        },
    })
}
