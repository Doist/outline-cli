#!/usr/bin/env node
import { stripUserFlag } from '@doist/cli-core'
import { Command } from 'commander'
import packageJson from '../package.json' with { type: 'json' }
import { registerAuthCommand } from './commands/auth.js'
import { registerChangelogCommand } from './commands/changelog.js'
import { registerCollectionCommand } from './commands/collection.js'
import { registerDocumentCommand } from './commands/document.js'
import { registerSearchCommand } from './commands/search.js'
import { registerSkillCommand } from './commands/skill.js'
import { registerUpdateCommand } from './commands/update/index.js'
import { BaseCliError } from './lib/errors.js'
import { getRequestedUserRef, isJsonMode, validateRootUserFlag } from './lib/global-args.js'
import { formatError, formatErrorJson } from './lib/output.js'

const program = new Command()

program
    .name('ol')
    .version(packageJson.version)
    .description('CLI for the Outline wiki/knowledge base API')
    .option('--no-spinner', 'Disable loading animations')
    .option('--accessible', 'Render output in screen-reader-friendly mode')
    .addHelpText(
        'after',
        `
Note for AI/LLM agents:
  Use --json or --ndjson flags for unambiguous, parseable output.
  Default JSON shows essential fields; use --full for all fields.`,
    )

registerAuthCommand(program)
registerSearchCommand(program)
registerDocumentCommand(program)
registerCollectionCommand(program)
registerSkillCommand(program)
registerChangelogCommand(program)
registerUpdateCommand(program)

function reportError(err: unknown): never {
    if (err instanceof BaseCliError) {
        console.error(isJsonMode() ? formatErrorJson(err) : formatError(err))
    } else {
        console.error(err instanceof Error ? err.message : String(err))
    }
    process.exit(1)
}

// Commander has no root `--user` option, so validate and strip it from argv
// before parsing. Warm the global-args cache off the *original* argv first —
// `parseGlobalArgs` would otherwise run on the stripped argv and lose the ref.
const originalArgs = process.argv.slice(2)
try {
    validateRootUserFlag(originalArgs, new Set(program.commands.map((c) => c.name())))
} catch (err) {
    reportError(err)
}
getRequestedUserRef()
process.argv = [process.argv[0], process.argv[1], ...stripUserFlag(originalArgs)]

program.parseAsync().catch(reportError)
