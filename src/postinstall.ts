import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { updateAllInstalledSkills } from './lib/skills/update-installed.js'

const AGENT_DIRS = ['.claude', '.codex', '.cursor', '.gemini', '.pi', '.agents']

async function removeOldSkillDirs() {
    const home = homedir()
    await Promise.all(
        AGENT_DIRS.map((dir) =>
            rm(join(home, dir, 'skills', 'outline'), { recursive: true, force: true }),
        ),
    )
}

// TODO: Remove after a few releases once all users have upgraded.
// The skill was previously installed under "outline" but was renamed to "outline-cli"
// to match the convention used by the other Doist CLIs. This cleans up the old
// directories so users don't end up with duplicate skills.
removeOldSkillDirs().catch(() => {})

updateAllInstalledSkills(false).catch(() => {})
