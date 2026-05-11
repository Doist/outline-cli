import { type Config, getConfig, setConfig } from './config.js'

const DEFAULT_BASE_URL = 'https://app.getoutline.com'

export async function getApiToken(): Promise<string> {
    const envToken = process.env.OUTLINE_API_TOKEN
    if (envToken) return envToken

    const config = await getConfig()
    if (config.api_token) return config.api_token

    throw new Error('No API token found. Set OUTLINE_API_TOKEN env var or run: ol auth login')
}

export async function getBaseUrl(): Promise<string> {
    const envUrl = process.env.OUTLINE_URL
    if (envUrl) return envUrl.replace(/\/$/, '')

    const config = await getConfig()
    if (config.base_url) return config.base_url.replace(/\/$/, '')

    return DEFAULT_BASE_URL
}

export async function getOAuthClientId(): Promise<string | undefined> {
    const envClientId = process.env.OUTLINE_OAUTH_CLIENT_ID
    if (envClientId) return envClientId

    const config = await getConfig()
    return config.oauth_client_id
}

export async function getTokenSource(): Promise<'env' | 'config' | null> {
    if (process.env.OUTLINE_API_TOKEN) return 'env'
    const config = await getConfig()
    if (config.api_token) return 'config'
    return null
}

/**
 * Clear the auth-related keys without deleting the file. The config is now
 * shared with non-auth settings (notably `update_channel`); a blanket unlink
 * would silently reset the user's update-channel preference too.
 */
export async function clearConfig(): Promise<void> {
    const existing = await getConfig()
    const {
        api_token,
        base_url,
        oauth_client_id,
        auth_user_id,
        auth_user_name,
        auth_team_name,
        ...rest
    } = existing
    void api_token
    void base_url
    void oauth_client_id
    void auth_user_id
    void auth_user_name
    void auth_team_name
    await setConfig(rest as Config)
}
