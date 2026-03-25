interface AuthorizationUrlOptions {
    baseUrl: string
    clientId: string
    redirectUri: string
    codeChallenge: string
    state: string
}

interface TokenExchangeOptions {
    baseUrl: string
    clientId: string
    redirectUri: string
    codeVerifier: string
    code: string
}

interface TokenResponse {
    access_token?: string
    error?: string
    error_description?: string
    message?: string
}

export function buildAuthorizationUrl(options: AuthorizationUrlOptions): string {
    const { baseUrl, clientId, redirectUri, codeChallenge, state } = options
    const url = new URL(`${baseUrl}/oauth/authorize`)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    return url.toString()
}

export async function exchangeCodeForToken(options: TokenExchangeOptions): Promise<string> {
    const { baseUrl, clientId, redirectUri, codeVerifier, code } = options
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        code,
    })

    const res = await fetch(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    })

    const json = (await res.json()) as TokenResponse
    if (!res.ok) {
        const message = json.error_description || json.message || json.error || res.statusText
        throw new Error(`OAuth token exchange failed: ${message}`)
    }

    if (!json.access_token) {
        throw new Error('OAuth token exchange did not return an access token.')
    }

    return json.access_token
}
