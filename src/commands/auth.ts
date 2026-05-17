import { attachLoginCommand, attachLogoutCommand, attachStatusCommand } from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { apiRequest } from '../lib/api.js'
import { renderError, renderSuccess } from '../lib/auth-pages.js'
import {
    type AuthInfoResponse,
    createOutlineAuthProvider,
    createOutlineTokenStore,
    type OutlineAccount,
} from '../lib/auth-provider.js'
import { CliError } from '../lib/errors.js'

const DEFAULT_OAUTH_CALLBACK_PORT = 54969

type StatusData = {
    email: string
    source: 'env' | 'config'
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

export function registerAuthCommand(program: Command): void {
    const auth = program.command('auth').description('Manage authentication')

    const provider = createOutlineAuthProvider()
    const store = createOutlineTokenStore()

    attachLoginCommand(auth, {
        provider,
        store,
        preferredPort: resolvePreferredCallbackPort(),
        resolveScopes: () => [],
        renderSuccess,
        renderError,
        onSuccess({ view, account }) {
            if (view.json || view.ndjson) return
            console.log(chalk.green(`Authenticated to ${account.teamName} as ${account.label}`))
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
        async fetchLive({ token, account }) {
            try {
                const { data: info } = await apiRequest<AuthInfoResponse>(
                    'auth.info',
                    {},
                    { token, baseUrl: account.baseUrl },
                )
                statusData = {
                    email: info.user.email,
                    source: process.env.OUTLINE_API_TOKEN ? 'env' : 'config',
                }
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
    })
}
