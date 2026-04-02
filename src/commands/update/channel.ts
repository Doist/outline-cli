import chalk from 'chalk'
import { getUpdateChannel } from '../../lib/update-config.js'

export function showChannel(): void {
    const channel = getUpdateChannel()

    if (channel === 'pre-release') {
        console.log(`Update channel: ${chalk.magenta('pre-release')}`)
    } else {
        console.log(`Update channel: ${chalk.green('stable')}`)
    }
}
