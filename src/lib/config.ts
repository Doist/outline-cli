import {
    type CoreConfig,
    getConfigPath as coreGetConfigPath,
    readConfig as coreReadConfig,
    updateConfig as coreUpdateConfig,
    writeConfig as coreWriteConfig,
} from '@doist/cli-core'

const APP_NAME = 'outline-cli'

/**
 * One row of the `users[]` array. `id` is the Outline user UUID. `token` is
 * a plaintext fallback persisted only when the OS keyring is unavailable at
 * write time (WSL, headless Linux, missing native binary).
 */
export type StoredUser = {
    id: string
    name: string
    base_url?: string
    oauth_client_id?: string
    team_name?: string
    /** Plaintext access-token fallback, present only when the keyring was unavailable at write time. */
    token?: string
    /** Access-token expiry (unix-epoch ms); drives proactive refresh. */
    access_token_expires_at?: number
    /** Refresh-token expiry (unix-epoch ms), when the server returns one. */
    refresh_token_expires_at?: number
    /** Whether a refresh token is stored (keyring slot or `refresh_token`). */
    has_refresh_token?: boolean
}

export type Config = CoreConfig & {
    config_version?: number
    users?: StoredUser[]
    default_user_id?: string

    /**
     * Legacy v1 single-user fields. Read by the migration helper; removed
     * from disk by `cleanupLegacyConfig` after the v2 record write succeeds.
     */
    api_token?: string
    base_url?: string
    oauth_client_id?: string
    auth_user_id?: string
    auth_user_name?: string
    auth_team_name?: string
}

/**
 * Resolve the canonical config path on every call. Caching at module load
 * would pin the path to the unmocked `node:os.homedir` before vitest's
 * `vi.mock('node:os', …)` hoist takes effect in a fresh test file.
 */
export function getConfigPath(): string {
    return coreGetConfigPath(APP_NAME)
}

export async function getConfig(): Promise<Partial<Config>> {
    return coreReadConfig<Config>(getConfigPath())
}

export async function setConfig(config: Config): Promise<void> {
    return coreWriteConfig(getConfigPath(), config)
}

export async function updateConfig(updates: Partial<Config>): Promise<void> {
    return coreUpdateConfig<Config>(getConfigPath(), updates)
}
