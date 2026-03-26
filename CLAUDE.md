# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install           # install dependencies
npm run build         # compile TypeScript to dist/
npm run dev           # watch mode (rebuild on changes)
npm run type-check    # typecheck without emitting
npm run test          # run all tests
npx vitest run src/__tests__/output.test.ts  # run a single test file
npm run format        # biome lint + format (auto-fix)
```

After building, `npm link` makes the `ol` binary available globally.

## Architecture

ESM-only TypeScript CLI using Commander.js. Entry point: `src/index.ts` creates the program and registers four command modules.

### Command pattern

Each file in `src/commands/` exports a `registerXxxCommand(program)` function that defines subcommands with Commander's chaining API. Commands use async action handlers.

### Lib modules

- **api.ts**: Single `apiRequest<T>(path, body)` function. All Outline API calls are POST with Bearer auth. Wraps requests in spinner with per-endpoint messages (SPINNER_MESSAGES map).
- **auth.ts**: Config stored at `~/.config/outline-cli/config.json`. Token/URL resolution: env var → config file → default.
- **output.ts**: `outputItem()` and `outputList()` handle three output modes (human/json/ndjson). Commands define a `humanFormatter` function and an `essentialKeys` array for JSON field filtering.
- **spinner.ts**: `withSpinner(opts, fn)` wrapper using yocto-spinner. Auto-disables on non-TTY, JSON output, CI, `--no-spinner` flag.
- **markdown.ts**: Terminal markdown rendering via marked + marked-terminal.

### Key patterns

- Document IDs are resolved from full URLs or slugs via regex extraction in `resolveId()`.
- Text input for create/update supports `--text` inline or `--file` path, with auto title extraction from markdown headings.
- Delete operations require `--confirm` flag.

## Testing

Vitest with module mocking. Tests live in `src/__tests__/`. Common patterns:

- Mock `apiRequest` with `vi.mock()`
- Stub `fetch` globally for API tests
- Capture `console.log` calls in an array for output assertions
- Use `program.exitOverride()` + `program.parseAsync()` to test command parsing
- Auth tests use tmpdir with `process.pid` for filesystem isolation

## Skill Content (Agent Command Reference)

The file `src/lib/skills/content.ts` exports `SKILL_CONTENT` — a comprehensive command reference that gets installed into AI agent skill directories via `ol skill install`. This is the source of truth that agents use to understand available CLI commands.

**Whenever commands, subcommands, flags, or options are added, updated, or removed in `src/commands/`, the `SKILL_CONTENT` in `src/lib/skills/content.ts` must be updated to match.**

After updating `SKILL_CONTENT`:

1. Run `npm run build && npm run sync:skill` to regenerate `skills/outline-cli/SKILL.md` (the standalone skill file used by `npx skills add`)
2. Run `ol skill update claude-code` (and any other installed agents) to propagate changes to installed skill files

A CI check (`npm run check:skill-sync`) runs on pull requests and will fail if `skills/outline-cli/SKILL.md` is out of sync with `content.ts`.

## Style

- Biome: tabs for indentation, auto-sorted imports
- TypeScript strict mode, target ES2022, NodeNext modules
- Avoid `any` types and forced typecasts
- Prefer `for` loops over `.forEach()`
