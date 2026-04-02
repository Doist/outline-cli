import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type UpdateChannel = 'stable' | 'pre-release'

interface UpdateConfig {
    update_channel?: UpdateChannel
    [key: string]: unknown
}

const CONFIG_DIR = join(homedir(), '.config', 'outline-cli')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export function getUpdateChannel(): UpdateChannel {
    if (!existsSync(CONFIG_PATH)) return 'stable'
    try {
        const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as UpdateConfig
        return config.update_channel ?? 'stable'
    } catch {
        return 'stable'
    }
}

export function setUpdateChannel(channel: UpdateChannel): void {
    let existing: Record<string, unknown> = {}
    if (existsSync(CONFIG_PATH)) {
        try {
            existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
        } catch {
            // ignore
        }
    }
    existing.update_channel = channel
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_PATH, `${JSON.stringify(existing, null, 2)}\n`)
}
