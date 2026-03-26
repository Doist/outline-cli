#!/usr/bin/env node

/**
 * Regenerates skills/outline-cli/SKILL.md from the built skill content.
 *
 * Requires `npm run build` to have been run first.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

try {
    const modulePath = pathToFileURL(join(root, 'dist/lib/skills/create-installer.js')).href
    const { generateSkillFile } = await import(modulePath)
    const content = generateSkillFile()
    const skillPath = join(root, 'skills/outline-cli/SKILL.md')
    await mkdir(dirname(skillPath), { recursive: true })
    await writeFile(skillPath, content, 'utf-8')
    console.log('skills/outline-cli/SKILL.md has been regenerated')
} catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('ERROR: dist/ not found. Run `npm run build` first.')
    } else {
        console.error(err)
    }
    process.exit(1)
}
