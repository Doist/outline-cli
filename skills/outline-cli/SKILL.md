---
name: outline-cli
description: "Search and manage Outline wiki documents, collections and attachments via the ol CLI"
---

# Outline CLI (ol)

Use this skill when the user wants to interact with their Outline wiki/knowledge base.

## Quick Reference

- `ol search "query"` - Search documents
- `ol doc list` - List documents
- `ol doc get <id>` - Read a document
- `ol doc open <id>` - Open document in browser
- `ol doc create --title "Title" --collection <id>` - Create document
- `ol col list` - List collections
- `ol attachment upload <file> --doc <ref>` - Upload a file to a document
- `ol attachment download <id>` - Download an attachment
- `ol account` - List stored accounts; `ol account use <id|name>` sets the default

## Output Formats

All list commands support:
- `--json` - JSON output (essential fields)
- `--ndjson` - Newline-delimited JSON (streaming)
- `--full` - Include all fields in JSON

## Global Options

- `--user <id|name>` - Act as a specific stored account, matched by Outline user ID or display name. Each `ol auth login` stores an account (accounts can live on different Outline instances), and `--user` selects which one a command runs as; the token, base URL, and OAuth client ID all resolve from that account. Must be placed **before** the command, e.g. `ol --user scott@example.com doc list`. Omitted, commands use the default account. Overridden by `OUTLINE_API_TOKEN` when set.

## Document References

Documents can be referenced by:
- URL ID (the slug suffix after the last hyphen)
- Full Outline URL (auto-extracted)
- Document ID

## Commands

### Search
```bash
ol search "query"
ol search "query" --limit 10
ol search "query" --offset 25          # next page of results
ol search "query" --collection <id>
ol search "query" --status published
ol search "query" --json
```

### Documents
```bash
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
generate-notes | ol doc update <id> --stdin    # Read markdown from stdin (create and update)
ol doc update <id> --publish              # Publish a draft (create makes drafts unless --publish)
ol doc update <id> --publish --collection <ref>     # Publish a draft that has no collection (web UI drafts)
ol doc update <id> --file ./doc.md --if-updated-at <updatedAt>  # Fail if the doc was saved since <updatedAt> (see Examples)
ol doc move <id> --collection <target-id>           # Move to collection root
ol doc move <id> --parent <ref>                    # Nest under parent (collection inferred)
ol doc archive <id>
ol doc unarchive <id>
ol doc delete <id> --confirm
ol doc restore <id>                       # Restore from trash (ID or URL; trashed docs aren't found by title)
ol doc restore <id> --collection <ref>    # Restore into another collection (required if the original is gone)
```

### Collections
```bash
ol col list
ol col get <id>
ol col create --name "Name" --description "Desc" --color "#hex"
ol col create --name "Private" --private
ol col update <id> --name "New Name"
ol col delete <id> --confirm
```

### Attachments (alias: attach)
```bash
ol attachment upload ./plan.pdf --doc <ref>            # Upload; prints the markdown link to paste into the doc
ol attachment upload ./plan.pdf --doc <ref> --append   # Upload and append the link to the end of the doc
ol attachment upload ./photo.jpg --doc <ref> --name "Site photo.jpg" --content-type image/jpeg
ol attachment upload ./plan.pdf --doc <ref> --json     # {id, name, contentType, size, documentId, url, markdown}
ol attachment list --doc <ref>                         # Attachments and images linked in the doc (id, name, size, type)
ol attachment list --doc <ref> --json
ol attachment download <id|link>                       # Save under the original file name in the current directory
ol attachment download <id|link> --output ./files/     # Into a folder (created when the path ends in /), or --output <path>
ol attachment download <id|link> --output -            # Write the file to stdout
ol attachment download <id|link> --force               # Overwrite an existing file (refused otherwise)
ol attachment delete <id|link> --confirm               # Delete the file; links to it in documents stay
```
An attachment is referenced by its ID or any link containing `/api/attachments.redirect?id=<id>`. Images are linked as `![alt](/api/attachments.redirect?id=<id>)`, other files as `[<name> <bytes>](/api/attachments.redirect?id=<id>)`; keep that form when writing it into a document yourself.
`attachment list` reads those links from the document text, so a plain link whose text ends in a number (`[report 2024](…attachments.redirect?id=…)`) lists as name `report`, size 2024, and links to another Outline instance's attachments are listed but cannot be downloaded from this one.

### Authentication
```bash
ol auth login                          # OAuth login (opens browser); prompts for base URL + client ID if needed
ol auth login --base-url <url>         # Specify Outline base URL for this login (saved for future use)
ol auth login --client-id <id>         # Specify OAuth client ID for this login (saved for future use)
ol auth login --callback-port <port>   # Override local OAuth callback port
ol auth login --read-only              # Request read-only scopes (where supported by the Outline instance)
ol auth login --json | --ndjson        # Machine-readable success envelope
ol auth status                         # Show current auth state
ol auth status --json | --ndjson       # Machine-readable status envelope ({id, team, baseUrl, source})
ol auth logout                         # Clear saved credentials
ol auth logout --json | --ndjson       # Machine-readable logout envelope ({ok: true}; --ndjson is silent)
ol auth token <token>                  # Save a personal API token (validates via auth.info, resolves identity)
ol auth token <token> --base-url <url> # Save a token for a specific Outline instance
ol auth token                          # Prompt for the token (hidden input; errors in non-interactive shells)
ol auth token view                     # Print the bare stored token to stdout for scripts (refreshes an expiring OAuth token first; no newline when piped; refuses when OUTLINE_API_TOKEN is set)
ol --user <id|name> auth token view    # Print a specific stored account's token (--user is a root flag, before the command)
```

### Accounts
```bash
ol account                             # List stored accounts (default subcommand)
ol account list                        # List stored accounts, default marked
ol account list --json | --ndjson      # Machine-readable list ({accounts, default}; --ndjson streams one per line)
ol account current                     # Show the active account (honours --user and OUTLINE_API_TOKEN)
ol account current --json | --ndjson   # Discriminated by source: {source:"stored", account:{id, label, teamName, baseUrl, isDefault}} | {source:"env"} | {source:"legacy"}
ol account use <id|name>               # Set the default account used when --user is omitted
ol account use <id|name> --json        # Machine-readable envelope ({ok: true, default: <id>}; --ndjson is silent)
ol account remove <id|name>            # Remove a stored account (clears keyring + config entry)
ol account remove <id|name> --json     # Machine-readable envelope ({ok: true, removed: <id>}; --ndjson is silent)
```

### Update & Changelog
```bash
ol update                        # Update CLI to latest version
ol update --check                # Check for updates without installing, show channel
ol update --check --json         # Check for updates as a JSON envelope
ol update --check --ndjson       # Check for updates as NDJSON output
ol update --channel              # Show current update channel
ol update switch --stable        # Switch to stable release channel
ol update switch --pre-release   # Switch to pre-release (next) channel
ol changelog                     # Show recent changelog entries
ol changelog -n 3                # Show last 3 versions
```

## Examples

### Find and read a document
```bash
ol search "onboarding" --json | jq '.[0].document.urlId'
ol doc get <urlId>
```

### Create a document from a file
```bash
ol doc create --title "Meeting Notes" --collection <id> --file ./notes.md --publish
```

### Edit a document without overwriting someone else's changes
```bash
ts=$(ol doc get <id> --json | jq -r '.updatedAt')
ol doc get <id> --raw > doc.md            # then edit doc.md
ol doc update <id> --file doc.md --if-updated-at "$ts"
```
If the document was saved after `$ts`, the update fails with `DOCUMENT_CHANGED`, or with Outline's "Document has been modified since the provided revision" when the save lands during the update; re-read and retry. Edits not yet saved from an open editor are not detected.

### Attach a file and download every attachment of a document
```bash
ol attachment upload ./drawing.pdf --doc <ref> --append
ol attachment list --doc <ref> --json | jq -r '.[].id' | while read -r id; do
  ol attachment download "$id" --output "./downloads/$id/"   # one folder each: names often repeat
done
```

### List all collections and their documents
```bash
ol col list --json
ol doc list --collection <id> --sort title --direction ASC
```

### Bulk export with ndjson
```bash
ol doc list --ndjson --full | jq -r '.title'
```
