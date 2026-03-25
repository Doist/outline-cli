#!/usr/bin/env node
import { Command } from 'commander'
import { registerAuthCommand } from './commands/auth.js'
import { registerCollectionCommand } from './commands/collection.js'
import { registerDocumentCommand } from './commands/document.js'
import { registerSearchCommand } from './commands/search.js'
import { registerSkillCommand } from './commands/skill.js'

const program = new Command()

program
    .name('ol')
    .version('0.1.0')
    .description('CLI for the Outline wiki/knowledge base API')
    .option('--no-spinner', 'Disable loading animations')
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

program.parseAsync().catch((err: Error) => {
    console.error(err.message)
    process.exit(1)
})
