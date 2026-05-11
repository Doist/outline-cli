import { createInterface } from 'node:readline/promises'
import {
    type AuthAccount,
    type AuthProvider,
    deriveChallenge,
    generateVerifier,
    type TokenStore,
} from '@doist/cli-core/auth'
import { apiRequest } from './api.js'
import { clearConfig, getBaseUrl, getOAuthClientId } from './auth.js'
import { getConfig, updateConfig } from './config.js'

const DEFAULT_BASE_URL = 'https://app.getoutline.com'

interface AuthInfoResponse {
    user: { id: string; name: string; email: string }
    team: { name: string; subdomain: string }
}

export type OutlineAccount = AuthAccount & {
    id: string
    label: string
    baseUrl: string
    oauthClientId: string
    teamName: string
}

type OutlineHandshake = Record<string, unknown> & {
    baseUrl: string
    clientId: string
    codeVerifier?: string
}

function asHandshake(value: Record<string, unknown>): OutlineHandshake {
    return value as OutlineHandshake
}

function stringFlag(flags: Record<string, unknown>, key: string): string | undefined {
    const value = flags[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function prompt(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        return (await rl.question(question)).trim()
    } finally {
        rl.close()
    }
}

async function resolveBaseUrl(flags: Record<string, unknown>): Promise<string> {
    const fromFlag = stringFlag(flags, 'baseUrl')
    if (fromFlag) return fromFlag.replace(/\/$/, '')
    const fromEnv = process.env.OUTLINE_URL?.trim()
    if (fromEnv) return fromEnv.replace(/\/$/, '')
    const configured = await getBaseUrl()
    const answered = await prompt(`Base URL (default: ${configured}): `)
    return (answered || configured).replace(/\/$/, '')
}

async function resolveClientId(flags: Record<string, unknown>): Promise<string> {
    const fromFlag = stringFlag(flags, 'clientId')
    if (fromFlag) return fromFlag
    const existing = await getOAuthClientId()
    if (existing) return existing
    const answered = await prompt('OAuth Client ID: ')
    if (!answered) {
        throw new Error(
            'OAuth client ID is required. Create a public OAuth app in Outline settings, then pass --client-id <id> or set OUTLINE_OAUTH_CLIENT_ID.',
        )
    }
    return answered
}

export function createOutlineAuthProvider(): AuthProvider<OutlineAccount> {
    return {
        async authorize({ redirectUri, state, flags }) {
            const baseUrl = await resolveBaseUrl(flags)
            const clientId = await resolveClientId(flags)
            const codeVerifier = generateVerifier()
            const codeChallenge = deriveChallenge(codeVerifier)

            const url = new URL(`${baseUrl}/oauth/authorize`)
            url.searchParams.set('client_id', clientId)
            url.searchParams.set('response_type', 'code')
            url.searchParams.set('code_challenge', codeChallenge)
            url.searchParams.set('code_challenge_method', 'S256')
            url.searchParams.set('redirect_uri', redirectUri)
            url.searchParams.set('state', state)

            const handshake: OutlineHandshake = { baseUrl, clientId, codeVerifier }
            return { authorizeUrl: url.toString(), handshake }
        },

        async exchangeCode({ code, redirectUri, handshake }) {
            const hs = asHandshake(handshake)
            if (!hs.codeVerifier) {
                throw new Error('Missing PKCE code verifier from authorize step.')
            }

            const params = new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: hs.clientId,
                redirect_uri: redirectUri,
                code_verifier: hs.codeVerifier,
                code,
            })

            const res = await fetch(`${hs.baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            })

            const json = (await res.json().catch(() => ({}))) as {
                access_token?: string
                error?: string
                error_description?: string
                message?: string
            }

            if (!res.ok) {
                const message =
                    json.error_description || json.message || json.error || res.statusText
                throw new Error(`OAuth token exchange failed: ${message}`)
            }

            if (!json.access_token) {
                throw new Error('OAuth token exchange did not return an access token.')
            }

            return { accessToken: json.access_token }
        },

        async validateToken({ token, handshake }) {
            const hs = asHandshake(handshake)
            const { data } = await apiRequest<AuthInfoResponse>(
                'auth.info',
                {},
                {
                    token,
                    baseUrl: hs.baseUrl,
                },
            )
            return {
                id: data.user.id,
                label: data.user.name,
                baseUrl: hs.baseUrl,
                oauthClientId: hs.clientId,
                teamName: data.team.name,
            }
        },
    }
}

export function createOutlineTokenStore(): TokenStore<OutlineAccount> {
    return {
        async active() {
            const config = await getConfig()
            if (!config.api_token) return null
            const baseUrl = config.base_url ?? DEFAULT_BASE_URL
            const oauthClientId = config.oauth_client_id ?? ''
            const id = config.auth_user_id
            const label = config.auth_user_name
            if (!id || !label) {
                // Stored token predates this adapter (env var, pre-upgrade
                // config). No persisted identity to round-trip.
                return null
            }
            return {
                token: config.api_token,
                account: { id, label, baseUrl, oauthClientId, teamName: '' },
            }
        },
        async set(account, token) {
            await updateConfig({
                api_token: token,
                base_url: account.baseUrl,
                oauth_client_id: account.oauthClientId,
                auth_user_id: account.id,
                auth_user_name: account.label,
            })
        },
        async clear() {
            await clearConfig()
        },
    }
}
