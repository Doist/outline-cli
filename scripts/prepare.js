#!/usr/bin/env node

/**
 * Safe prepare script that only runs lefthook for local development.
 * Skips when installing globally or in CI environments.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Skip if not in a git repo (e.g., npm global install)
const isGitRepo = existsSync(join(projectRoot, ".git"));

// Skip in CI environments
const isCI = process.env.CI === "true";

if (!isGitRepo) {
	console.log("Skipping git hooks setup (not a git repository)");
	process.exit(0);
}

if (isCI) {
	console.log("Skipping git hooks setup (CI environment)");
	process.exit(0);
}

try {
	execSync("lefthook install", { stdio: "inherit", cwd: projectRoot });
} catch (error) {
	console.warn("Warning: Failed to install git hooks (lefthook)");
	console.warn(
		'This is optional for development. You can run "npm run prepare" manually later.',
	);
	// Don't fail the install
	process.exit(0);
}
