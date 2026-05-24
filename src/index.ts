#!/usr/bin/env node
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
import { applyUserSelector, isJsonMode } from './lib/global-args.js'
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
Global options:
  --user <id|name>  Act as a specific stored account (place before the command,
                    e.g. \`ol --user scott@example.com document list\`).

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

// Commander has no root `--user` option, so validate it and strip it from argv
// before parsing (see `applyUserSelector` for the warm-cache-then-strip order).
try {
    applyUserSelector(new Set(program.commands.map((c) => c.name())))
} catch (err) {
    reportError(err)
}

program.parseAsync().catch(reportError)
