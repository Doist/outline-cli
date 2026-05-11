import { attachLoginCommand } from '@doist/cli-core/auth'
import chalk from 'chalk'
import type { Command } from 'commander'
import { apiRequest } from '../lib/api.js'
import { renderError, renderSuccess } from '../lib/auth-pages.js'
import { createOutlineAuthProvider, createOutlineTokenStore } from '../lib/auth-provider.js'
import { clearConfig, getBaseUrl, getTokenSource } from '../lib/auth.js'
import { formatError } from '../lib/output.js'

const DEFAULT_OAUTH_CALLBACK_PORT = 54969

type AuthInfoResponse = {
    user: { name: string; email: string }
    team: { name: string; subdomain: string }
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

    auth.command('status')
        .description('Show current authentication state')
        .action(async () => {
            const source = await getTokenSource()
            if (!source) {
                console.log(chalk.yellow('Not authenticated. Run: ol auth login'))
                return
            }

            console.log(chalk.dim(`Token source: ${source}`))
            console.log(chalk.dim(`Base URL: ${await getBaseUrl()}`))

            try {
                const { data } = await apiRequest<AuthInfoResponse>('auth.info')
                console.log(`Team: ${chalk.bold(data.team.name)}`)
                console.log(`User: ${data.user.name} (${data.user.email})`)
            } catch (err) {
                console.error(
                    formatError(
                        'AUTH_VERIFICATION_FAILED',
                        `Could not fetch auth info: ${(err as Error).message}`,
                        [
                            'Check that your API token is valid',
                            'Verify the base URL is correct',
                            "Run 'ol auth login' to re-authenticate",
                        ],
                    ),
                )
                process.exit(1)
            }
        })

    auth.command('logout')
        .description('Clear saved authentication')
        .action(async () => {
            await clearConfig()
            console.log('Logged out.')
        })
}
