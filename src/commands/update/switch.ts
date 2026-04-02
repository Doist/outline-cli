import chalk from 'chalk'
import { setUpdateChannel, type UpdateChannel } from '../../lib/update-config.js'

export function switchChannel(options: { stable?: boolean; preRelease?: boolean }): void {
    if (options.stable && options.preRelease) {
        console.error(chalk.red('Error:'), 'Specify either --stable or --pre-release, not both.')
        process.exitCode = 1
        return
    }

    if (!options.stable && !options.preRelease) {
        console.error(chalk.red('Error:'), 'Specify --stable or --pre-release.')
        process.exitCode = 1
        return
    }

    const channel: UpdateChannel = options.preRelease ? 'pre-release' : 'stable'

    setUpdateChannel(channel)

    if (channel === 'pre-release') {
        console.log(chalk.green('✓'), `Update channel set to ${chalk.magenta('pre-release')}`)
        console.log()
        console.log(
            chalk.yellow('Note:'),
            'Pre-release updates follow the',
            chalk.cyan('next'),
            'branch.',
        )
        console.log('When pre-release changes are merged into a stable release, no further')
        console.log('pre-release updates will be published until a new pre-release cycle begins.')
        console.log('Remember to switch back to stable when done:')
        console.log(chalk.dim('  ol update switch --stable'))
    } else {
        console.log(chalk.green('✓'), 'Update channel set to stable')
    }
}
