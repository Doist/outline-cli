# Outline CLI

CLI for the [Outline](https://www.getoutline.com) wiki/knowledge base API.

## Installation

> ```bash
> npm install -g @doist/outline-cli
> ```

### Agent Skills

Install skills for your coding agent:

```bash
ol skill install claude-code
ol skill install codex
ol skill install cursor
ol skill install gemini
ol skill install pi
ol skill install universal
```

Skills are installed to `~/<agent-dir>/skills/outline-cli/SKILL.md` (e.g. `~/.claude/` for claude-code, `~/.agents/` for universal, etc.). When updating the CLI, installed skills are updated automatically. The `universal` agent is compatible with Amp, OpenCode, and other agents that read from `~/.agents/`.

```bash
ol skill list
ol skill uninstall <agent>
```

## Uninstallation

First, remove any installed agent skills:

```bash
ol skill uninstall <agent>
```

Then uninstall the CLI:

```bash
npm uninstall -g @doist/outline-cli
```

## Local Setup

```bash
git clone https://github.com/Doist/outline-cli.git
cd outline-cli
npm install
npm run build
npm link
```

## Setup

### OAuth login (recommended)

```bash
ol auth login
ol auth login --base-url <your-outline-url>
ol auth login --client-id <your-client-id>
ol auth login --callback-port 54969
ol auth status
ol auth logout
```

**Setup:**

1. Create a public OAuth app in Outline (Settings → Applications)
2. Set the redirect URI to `http://localhost:54969/callback`
3. Run `ol auth login` and enter your OAuth client ID when prompted
   (or pass it directly with `--client-id <your-client-id>`)
4. If needed, pass `--base-url <your-outline-url>` or set `OUTLINE_URL`
   (for self-hosted instances or non-default URLs)
5. If needed, pass `--callback-port <port>` or set `OUTLINE_OAUTH_CALLBACK_PORT`
   and register `http://localhost:<port>/callback` in your OAuth app

The client ID is saved for future logins. You can also set `OUTLINE_OAUTH_CLIENT_ID`
for your local environment.

### Manual token login

If you prefer using an API token directly:

```bash
ol auth login --token <your-api-token>
```

Generate a token in Outline under Settings → API Tokens.

### Configuration

Token resolution: `OUTLINE_API_TOKEN` env var → `~/.config/outline-cli/config.json`.

Base URL resolution: `OUTLINE_URL` env var → config file → `https://app.getoutline.com`.

Callback port resolution for OAuth login:
`--callback-port` → `OUTLINE_OAUTH_CALLBACK_PORT` → `54969`.

Self-hosted instances: pass `--base-url` or set `OUTLINE_URL` (you can still provide it interactively).

## Commands

```bash
# Search
ol search "query" --limit 10 --collection <id> --status published

# Documents (alias: ol doc)
ol document list --collection <id> --sort updatedAt --direction DESC
ol document get <urlId>              # renders markdown for terminal
ol document get <urlId> --raw        # outputs raw markdown
ol document open <urlId>             # opens in browser
ol document create --title "Title" --collection <id> --file doc.md --publish
ol document update <urlId> --file updated.md
ol document delete <urlId> --confirm
ol document move <urlId> --collection <target-id>
ol document archive <urlId>
ol document unarchive <urlId>

# Collections (alias: ol col)
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

```bash
npm install
npm run dev          # watch mode
npm run type-check   # typecheck without emitting
npm run test         # run tests
npm run build        # compile to dist/
```
