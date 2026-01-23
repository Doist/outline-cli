import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { Command } from "commander";
import chalk from "chalk";
import { saveConfig, clearConfig, getTokenSource, getBaseUrl } from "../lib/auth.js";
import { apiRequest } from "../lib/api.js";

interface TeamInfo {
	name: string;
	subdomain: string;
}

interface AuthInfoResponse {
	user: { name: string; email: string };
	team: TeamInfo;
}

async function prompt(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await rl.question(question);
	} finally {
		rl.close();
	}
}

async function promptSecret(question: string): Promise<string> {
	process.stdout.write(question);
	const mutedOutput = new Writable({ write(_, __, cb) { cb(); } });
	const rl = createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
	try {
		const answer = await rl.question("");
		process.stdout.write("\n");
		return answer;
	} finally {
		rl.close();
	}
}

export function registerAuthCommand(program: Command): void {
	const auth = program.command("auth").description("Manage authentication");

	auth
		.command("login")
		.description("Authenticate with an Outline instance")
		.action(async () => {
			const token = await promptSecret("API token: ");
			if (!token.trim()) {
				console.error(chalk.red("Token is required."));
				process.exit(1);
			}

			const baseUrl = await prompt(
				`Base URL (default: https://app.getoutline.com): `,
			);
			const url = baseUrl.trim() || undefined;

			saveConfig(token.trim(), url);

			try {
				const { data } = await apiRequest<AuthInfoResponse>("auth.info");
				console.log(
					chalk.green(`Authenticated to ${data.team.name} as ${data.user.name}`),
				);
			} catch (err) {
				console.log(chalk.yellow("Token saved, but could not verify:"), (err as Error).message);
			}
		});

	auth
		.command("status")
		.description("Show current authentication state")
		.action(async () => {
			const source = getTokenSource();
			if (!source) {
				console.log(chalk.yellow("Not authenticated. Run: ol auth login"));
				return;
			}

			console.log(chalk.dim(`Token source: ${source}`));
			console.log(chalk.dim(`Base URL: ${getBaseUrl()}`));

			try {
				const { data } = await apiRequest<AuthInfoResponse>("auth.info");
				console.log(`Team: ${chalk.bold(data.team.name)}`);
				console.log(`User: ${data.user.name} (${data.user.email})`);
			} catch (err) {
				console.error(chalk.red("Could not fetch auth info:"), (err as Error).message);
				process.exit(1);
			}
		});

	auth
		.command("logout")
		.description("Clear saved authentication")
		.action(() => {
			clearConfig();
			console.log("Logged out.");
		});
}
