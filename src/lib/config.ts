import {
    type CoreConfig,
    getConfigPath as coreGetConfigPath,
    readConfig as coreReadConfig,
    updateConfig as coreUpdateConfig,
    writeConfig as coreWriteConfig,
} from '@doist/cli-core'

const APP_NAME = 'outline-cli'

export type Config = CoreConfig & {
    api_token?: string
    base_url?: string
    oauth_client_id?: string
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
