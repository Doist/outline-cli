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

program.parseAsync().catch((err: Error) => {
    console.error(err.message)
    process.exit(1)
})
