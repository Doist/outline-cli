export const SKILL_NAME = 'outline-cli'
export const SKILL_DESCRIPTION =
    'Search and manage Outline wiki documents and collections via the ol CLI'

export const SKILL_CONTENT = `# Outline CLI (ol)

Use this skill when the user wants to interact with their Outline wiki/knowledge base.

## Quick Reference

- \`ol search "query"\` - Search documents
- \`ol doc list\` - List documents
- \`ol doc get <id>\` - Read a document
- \`ol doc open <id>\` - Open document in browser
- \`ol doc create --title "Title" --collection <id>\` - Create document
- \`ol col list\` - List collections

## Output Formats

All list commands support:
- \`--json\` - JSON output (essential fields)
- \`--ndjson\` - Newline-delimited JSON (streaming)
- \`--full\` - Include all fields in JSON

## Document References

Documents can be referenced by:
- URL ID (the slug suffix after the last hyphen)
- Full Outline URL (auto-extracted)
- Document ID

## Commands

### Search
\`\`\`bash
ol search "query"
ol search "query" --limit 10
ol search "query" --collection <id>
ol search "query" --status published
ol search "query" --json
\`\`\`

### Documents
\`\`\`bash
ol doc list --collection <id> --limit 25
ol doc list --sort title --direction ASC
ol doc get <id>                           # Rendered markdown
ol doc get <id> --raw                     # Raw markdown
ol doc get <id> --json
ol doc open <id>                          # Open in browser
ol doc create --title "Title" --collection <id> --text "# Content"
ol doc create --title "Title" --parent <ref> --text "# Content"  # Nest under parent (collection inferred)
ol doc create --title "Title" --collection <id> --file ./doc.md
ol doc update <id> --title "New Title"
ol doc update <id> --file ./updated.md
ol doc move <id> --collection <target-id>           # Move to collection root
ol doc move <id> --parent <ref>                    # Nest under parent (collection inferred)
ol doc archive <id>
ol doc unarchive <id>
ol doc delete <id> --confirm
\`\`\`

### Collections
\`\`\`bash
ol col list
ol col get <id>
ol col create --name "Name" --description "Desc" --color "#hex"
ol col create --name "Private" --private
ol col update <id> --name "New Name"
ol col delete <id> --confirm
\`\`\`

### Authentication
\`\`\`bash
ol auth login                          # OAuth login (opens browser); prompts for base URL + client ID if needed
ol auth login --base-url <url>         # Specify Outline base URL for this login (saved for future use)
ol auth login --client-id <id>         # Specify OAuth client ID for this login (saved for future use)
ol auth login --callback-port <port>   # Override local OAuth callback port
ol auth login --read-only              # Request read-only scopes (where supported by the Outline instance)
ol auth login --json | --ndjson        # Machine-readable success envelope
ol auth status                         # Show current auth state
ol auth status --json | --ndjson       # Machine-readable status envelope ({id, name, email, team, baseUrl, source})
ol auth logout                         # Clear saved credentials
ol auth logout --json | --ndjson       # Machine-readable logout envelope ({ok: true}; --ndjson is silent)
\`\`\`

### Update & Changelog
\`\`\`bash
ol update                        # Update CLI to latest version
ol update --check                # Check for updates without installing, show channel
ol update --check --json         # Check for updates as a JSON envelope
ol update --check --ndjson       # Check for updates as NDJSON output
ol update --channel              # Show current update channel
ol update switch --stable        # Switch to stable release channel
ol update switch --pre-release   # Switch to pre-release (next) channel
ol changelog                     # Show recent changelog entries
ol changelog -n 3                # Show last 3 versions
\`\`\`

## Examples

### Find and read a document
\`\`\`bash
ol search "onboarding" --json | jq '.[0].document.urlId'
ol doc get <urlId>
\`\`\`

### Create a document from a file
\`\`\`bash
ol doc create --title "Meeting Notes" --collection <id> --file ./notes.md --publish
\`\`\`

### List all collections and their documents
\`\`\`bash
ol col list --json
ol doc list --collection <id> --sort title --direction ASC
\`\`\`

### Bulk export with ndjson
\`\`\`bash
ol doc list --ndjson --full | jq -r '.title'
\`\`\`
`
