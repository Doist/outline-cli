import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { Command } from "commander";
import open from "open";
import { apiRequest } from "../lib/api.js";
import {
	clearConfig,
	getBaseUrl,
	getOAuthClientId,
	getTokenSource,
	saveConfig,
} from "../lib/auth.js";
import { buildAuthorizationUrl, exchangeCodeForToken } from "../lib/oauth.js";
import {
	DEFAULT_OAUTH_CALLBACK_PORT,
	startOAuthCallbackServer,
} from "../lib/oauth-server.js";
import { formatError } from "../lib/output.js";
import {
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
} from "../lib/pkce.js";

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

function parseCallbackPort(rawPort: string): number | null {
	const parsed = Number(rawPort);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
		return null;
	}
	return parsed;
}

export function registerAuthCommand(program: Command): void {
	const auth = program.command("auth").description("Manage authentication");

	auth
		.command("login")
		.description("Authenticate with an Outline instance")
		.option("--token <token>", "Authenticate using a personal API token")
		.option(
			"--base-url <url>",
			"Outline base URL to use for this login (saved for future logins)",
		)
		.option(
			"--client-id <clientId>",
			"OAuth client ID to use for this login (saved for future logins)",
		)
		.option(
			"--callback-port <port>",
			`Local OAuth callback port (default: ${DEFAULT_OAUTH_CALLBACK_PORT})`,
		)
		.action(
			async (options: {
				token?: string;
				clientId?: string;
				baseUrl?: string;
				callbackPort?: string;
			}) => {
				const configuredBaseUrl = getBaseUrl();
				const optionBaseUrl = options.baseUrl?.trim();
				const envBaseUrl = process.env.OUTLINE_URL?.trim();
				let url = optionBaseUrl || envBaseUrl;
				if (!url) {
					const baseUrlInput = await prompt(
						`Base URL (default: ${configuredBaseUrl}): `,
					);
					url = baseUrlInput.trim() || configuredBaseUrl;
				}
				url = url.replace(/\/$/, "");
				const optionClientId = options.clientId?.trim();
				const optionCallbackPort = options.callbackPort?.trim();
				const envCallbackPort = process.env.OUTLINE_OAUTH_CALLBACK_PORT?.trim();
				const rawCallbackPort = optionCallbackPort || envCallbackPort;
				let callbackPort = DEFAULT_OAUTH_CALLBACK_PORT;

				if (rawCallbackPort) {
					const parsedPort = parseCallbackPort(rawCallbackPort);
					if (!parsedPort) {
						console.error(
							formatError(
								"OAUTH_CALLBACK_PORT_INVALID",
								`Invalid callback port: ${rawCallbackPort}`,
								[
									"Use an integer between 1 and 65535",
									"Set via --callback-port or OUTLINE_OAUTH_CALLBACK_PORT",
								],
							),
						);
						process.exit(1);
					}
					callbackPort = parsedPort;
				}

				if (options.token) {
					saveConfig(options.token.trim(), url, optionClientId);
					try {
						const { data } = await apiRequest<AuthInfoResponse>("auth.info");
						console.log(
							chalk.green(
								`Authenticated to ${data.team.name} as ${data.user.name}`,
							),
						);
					} catch (err) {
						console.log(
							chalk.yellow("Token saved, but could not verify:"),
							(err as Error).message,
						);
					}
					return;
				}

				const existingClientId = getOAuthClientId();
				let clientId = optionClientId || existingClientId;

				if (!clientId) {
					const clientIdInput = await prompt("OAuth Client ID: ");
					clientId = clientIdInput.trim();
				}

				if (!clientId) {
					console.error(
						formatError(
							"OAUTH_CLIENT_ID_REQUIRED",
							"OAuth client ID is required.",
							[
								"Create a public OAuth app in Outline settings",
								"Use --client-id <id> for this login",
								"Set OUTLINE_OAUTH_CLIENT_ID or enter it here",
							],
						),
					);
					process.exit(1);
				}

				const codeVerifier = generateCodeVerifier();
				const codeChallenge = generateCodeChallenge(codeVerifier);
				const state = generateState();

				let callbackServer: Awaited<
					ReturnType<typeof startOAuthCallbackServer>
				>;
				try {
					callbackServer = await startOAuthCallbackServer({
						state,
						port: callbackPort,
					});
				} catch (err) {
					const error = err as NodeJS.ErrnoException;
					const hints = [
						`Ensure http://localhost:${callbackPort}/callback is reachable from your browser`,
						"Re-run with 'ol auth login --token <token>' for manual auth",
					];
					if (error.code === "EADDRINUSE") {
						hints.unshift(
							`Port ${callbackPort} is already in use. Close the other process using it.`,
						);
					}

					console.error(
						formatError(
							"OAUTH_CALLBACK_SERVER_FAILED",
							`Could not start local OAuth callback server: ${error.message}`,
							hints,
						),
					);
					process.exit(1);
				}
				const authorizationUrl = buildAuthorizationUrl({
					baseUrl: url,
					clientId,
					redirectUri: callbackServer.redirectUri,
					codeChallenge,
					state,
				});

				try {
					await open(authorizationUrl);
				} catch (err) {
					console.log(
						chalk.yellow("Could not open browser automatically."),
						chalk.dim(authorizationUrl),
					);
					console.log(chalk.dim((err as Error).message));
				}

				console.log(chalk.dim("Waiting for OAuth authorization..."));

				try {
					const code = await callbackServer.waitForCode;
					const token = await exchangeCodeForToken({
						baseUrl: url,
						clientId,
						redirectUri: callbackServer.redirectUri,
						codeVerifier,
						code,
					});

					saveConfig(token, url, clientId);

					const { data } = await apiRequest<AuthInfoResponse>("auth.info");
					console.log(
						chalk.green(
							`Authenticated to ${data.team.name} as ${data.user.name}`,
						),
					);
				} catch (err) {
					callbackServer.close();
					console.error(
						formatError(
							"OAUTH_LOGIN_FAILED",
							`OAuth login failed: ${(err as Error).message}`,
							[
								"Confirm the OAuth app redirect URI matches the CLI callback",
								"Verify --base-url or OUTLINE_URL points to your Outline instance",
								"Re-run with 'ol auth login --token' for manual auth",
							],
						),
					);
					process.exit(1);
				}
			},
		);

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
				console.error(
					formatError(
						"AUTH_VERIFICATION_FAILED",
						`Could not fetch auth info: ${(err as Error).message}`,
						[
							"Check that your API token is valid",
							"Verify the base URL is correct",
							"Run 'ol auth login' to re-authenticate",
						],
					),
				);
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
