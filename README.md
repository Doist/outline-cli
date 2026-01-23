# outline-cli

CLI for the [Outline](https://www.getoutline.com) wiki/knowledge base API.

## Install

```sh
npm install -g outline-cli
```

## Auth

```sh
ol auth login     # prompts for API token and base URL
ol auth status    # show current auth state
ol auth logout    # clear saved credentials
```

Token resolution: `OUTLINE_API_TOKEN` env var → `~/.config/outline-cli/config.json`.

Base URL resolution: `OUTLINE_URL` env var → config file → `https://app.getoutline.com`.

Self-hosted instances: provide your instance URL during `ol auth login` or set `OUTLINE_URL`.

## Commands

```sh
# Search
ol search "query" --limit 10 --collection <id>

# Documents
ol document list --collection <id> --sort updatedAt --direction DESC
ol document get <urlId>
ol document create --title "Title" --collection <id> --file doc.md --publish
ol document update <urlId> --file updated.md
ol document delete <urlId> --confirm
ol document move <urlId> --collection <target-id>
ol document archive <urlId>
ol document unarchive <urlId>

# Collections
ol collection list
ol collection get <id>
ol collection create --name "Engineering" --color "#4CAF50"
ol collection update <id> --name "New Name"
ol collection delete <id> --confirm
```

## Output modes

All commands support:

- Default: colored human-readable output
- `--json`: pretty-printed JSON (essential fields)
- `--json --full`: all fields
- `--ndjson`: one JSON object per line (for piping)

## Development

```sh
npm install
npm run dev          # watch mode
npm run type-check   # typecheck without emitting
npm run test         # run tests
npm run build        # compile to dist/
```
