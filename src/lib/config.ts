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

let cachedPath: string | null = null

export function getConfigPath(): string {
    if (!cachedPath) cachedPath = coreGetConfigPath(APP_NAME)
    return cachedPath
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
