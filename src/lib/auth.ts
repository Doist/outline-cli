import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Config {
	api_token?: string;
	base_url?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "outline-cli");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_BASE_URL = "https://app.getoutline.com";

function readConfig(): Config {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
	} catch {
		return {};
	}
}

export function getApiToken(): string {
	const envToken = process.env.OUTLINE_API_TOKEN;
	if (envToken) return envToken;

	const config = readConfig();
	if (config.api_token) return config.api_token;

	throw new Error(
		"No API token found. Set OUTLINE_API_TOKEN env var or run: ol auth login",
	);
}

export function getBaseUrl(): string {
	const envUrl = process.env.OUTLINE_URL;
	if (envUrl) return envUrl.replace(/\/$/, "");

	const config = readConfig();
	if (config.base_url) return config.base_url.replace(/\/$/, "");

	return DEFAULT_BASE_URL;
}

export function getTokenSource(): "env" | "config" | null {
	if (process.env.OUTLINE_API_TOKEN) return "env";
	const config = readConfig();
	if (config.api_token) return "config";
	return null;
}

export function saveConfig(token: string, baseUrl?: string): void {
	mkdirSync(CONFIG_DIR, { recursive: true });
	const existing = readConfig();
	const config: Config = {
		...existing,
		api_token: token,
	};
	if (baseUrl) {
		config.base_url = baseUrl.replace(/\/$/, "");
	}
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export function clearConfig(): void {
	if (existsSync(CONFIG_PATH)) {
		rmSync(CONFIG_PATH);
	}
}
