import { getConfig, updateConfig } from './config.js'

export type UpdateChannel = 'stable' | 'pre-release'

export async function getUpdateChannel(): Promise<UpdateChannel> {
    const config = await getConfig()
    return config.update_channel ?? 'stable'
}

export async function setUpdateChannel(channel: UpdateChannel): Promise<void> {
    await updateConfig({ update_channel: channel })
}
