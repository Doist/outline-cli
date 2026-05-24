import { createInterface } from 'node:readline'
import {
    attachLoginCommand,
    attachLogoutCommand,
    attachStatusCommand,
    attachTokenViewCommand,
} from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { apiRequest } from '../lib/api.js'
import { TOKEN_ENV_VAR } from '../lib/auth-constants.js'
import { logClearResult, logTokenStorageResult } from '../lib/auth-output.js'
import { renderError, renderSuccess } from '../lib/auth-pages.js'
import {
    type AuthInfoResponse,
    createOutlineAuthProvider,
    createOutlineTokenStore,
    getActiveTokenSource,
    type OutlineAccount,
    type OutlineTokenStore,
    resolveBaseUrl,
} from '../lib/auth-provider.js'
import { refreshedTokenForStatus } from '../lib/auth.js'
import { CliError } from '../lib/errors.js'
import { isJsonMode } from '../lib/global-args.js'
import { makeOutlineAccount } from '../lib/outline-account.js'
import { withUserRefAware } from '../lib/user-ref-store.js'

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

// Read a secret without echoing it. Node exposes no public masked-prompt API,
// so we override readline's private `_writeToOutput` to suppress keystrokes and
// echo only the prompt label. Output goes to stderr so a `--json` stdout stays clean.
function promptHiddenToken(question: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr })
        const internal = rl as unknown as { _writeToOutput?: (str: string) => void }
        const original = internal._writeToOutput?.bind(rl)
        internal._writeToOutput = (str: string) => {
            if (original && str.includes(question)) original(question)
        }
        rl.question(question, (answer) => {
            rl.close()
            process.stderr.write('\n')
            resolve(answer.trim())
        })
    })
}

async function saveToken(
    store: OutlineTokenStore,
    token: string | undefined,
    options: { baseUrl?: string },
): Promise<void> {
    if (!token) {
        if (!process.stdin.isTTY) {
            throw new CliError('NO_TOKEN', 'No token provided', [
                'Pass it as an argument: ol auth token <token>',
                'Or set the OUTLINE_API_TOKEN environment variable',
                'Or use OAuth: ol auth login',
            ])
        }
        token = await promptHiddenToken('API token: ')
    }
    const trimmed = token.trim()
    if (!trimmed) throw new CliError('NO_TOKEN', 'No token provided')

    const baseUrl = await resolveBaseUrl({ baseUrl: options.baseUrl })

    // A freshly pasted token is verified by probing `auth.info`. Any failure
    // (bad token, wrong instance, unreachable host) means we can't trust it, so
    // surface a single actionable error rather than leaking the raw API string.
    let data: AuthInfoResponse
    try {
        ;({ data } = await apiRequest<AuthInfoResponse>(
            'auth.info',
            {},
            { token: trimmed, baseUrl },
        ))
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new CliError('AUTH_VERIFICATION_FAILED', `Could not verify token (${detail})`, [
            'Check the token value',
            `Check --base-url matches the instance the token came from (used: ${baseUrl})`,
        ])
    }

    const account = makeOutlineAccount({
        id: data.user.id,
        label: data.user.name,
        baseUrl,
        teamName: data.team.name,
    })
    await store.set(account, trimmed)

    const machine = isJsonMode()
    if (!machine) {
        console.log(chalk.green('✓'), `Saved token for ${account.label} (${account.teamName})`)
    }
    const result = store.getLastStorageResult()
    if (result) {
        logTokenStorageResult(
            result,
            'Token stored securely in the system credential manager',
            machine,
        )
    }
}

export function registerAuthCommand(program: Command): void {
    const auth = program.command('auth').description('Manage authentication')

    const provider = createOutlineAuthProvider()
    const store: OutlineTokenStore = createOutlineTokenStore()
    // Honours a global `ol --user <ref>` placed before `auth status` / `auth
    // logout`; login always targets the freshly authenticated account, so it
    // keeps the raw store.
    const refAware = withUserRefAware(store)

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
        store: refAware,
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
                    // Scope the source to the selected account so `auth status
                    // --user <ref>` reports where *that* account's token lives,
                    // not the default/env source. Empty id (env/legacy snapshot)
                    // falls back to the default cascade.
                    getActiveTokenSource(account.id || undefined),
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
        store: refAware,
        description: 'Clear saved authentication',
        onCleared({ view }) {
            logClearResult(store, view.json || view.ndjson)
        },
    })

    const tokenCmd = auth
        .command('token [token]')
        .description('Save an Outline API token for CLI auth (or use the `view` subcommand)')
        .option('--base-url <url>', 'Outline base URL the token belongs to')
        .action((token: string | undefined, options: { baseUrl?: string }) =>
            saveToken(store, token, options),
        )

    attachTokenViewCommand<OutlineAccount>(tokenCmd, {
        name: 'view',
        store: refAware,
        envVarName: TOKEN_ENV_VAR,
        description:
            'Print the stored token for the active user (or --user <ref>) to stdout for scripts',
    })
}
