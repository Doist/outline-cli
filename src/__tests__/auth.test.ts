import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_HOME = join(tmpdir(), `outline-cli-test-${process.pid}`);
const TEST_CONFIG_DIR = join(TEST_HOME, ".config", "outline-cli");
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return {
		...actual,
		homedir: () => join(tmpdir(), `outline-cli-test-${process.pid}`),
	};
});

describe("auth", () => {
	beforeEach(() => {
		mkdirSync(TEST_CONFIG_DIR, { recursive: true });
		delete process.env.OUTLINE_API_TOKEN;
		delete process.env.OUTLINE_URL;
		delete process.env.OUTLINE_OAUTH_CLIENT_ID;
	});

	afterEach(() => {
		if (existsSync(TEST_HOME)) {
			rmSync(TEST_HOME, { recursive: true });
		}
		vi.resetModules();
	});

	it("getApiToken reads from env var first", async () => {
		process.env.OUTLINE_API_TOKEN = "env-token";
		const { getApiToken } = await import("../lib/auth.js");
		expect(getApiToken()).toBe("env-token");
	});

	it("getApiToken reads from config file", async () => {
		writeFileSync(
			TEST_CONFIG_PATH,
			JSON.stringify({ api_token: "file-token" }),
		);
		const { getApiToken } = await import("../lib/auth.js");
		expect(getApiToken()).toBe("file-token");
	});

	it("getApiToken throws when no token available", async () => {
		const { getApiToken } = await import("../lib/auth.js");
		expect(() => getApiToken()).toThrow("No API token found");
	});

	it("getBaseUrl returns env var first", async () => {
		process.env.OUTLINE_URL = "https://custom.example.com";
		const { getBaseUrl } = await import("../lib/auth.js");
		expect(getBaseUrl()).toBe("https://custom.example.com");
	});

	it("getBaseUrl strips trailing slash", async () => {
		process.env.OUTLINE_URL = "https://custom.example.com/";
		const { getBaseUrl } = await import("../lib/auth.js");
		expect(getBaseUrl()).toBe("https://custom.example.com");
	});

	it("getBaseUrl returns default when nothing configured", async () => {
		const { getBaseUrl } = await import("../lib/auth.js");
		expect(getBaseUrl()).toBe("https://app.getoutline.com");
	});

	it("saveConfig and clearConfig work", async () => {
		const { saveConfig, clearConfig, getApiToken, getOAuthClientId } =
			await import("../lib/auth.js");
		saveConfig("test-token", "https://wiki.test.com", "client-id");
		expect(getApiToken()).toBe("test-token");
		expect(getOAuthClientId()).toBe("client-id");
		clearConfig();
		expect(() => getApiToken()).toThrow();
	});

	it("getOAuthClientId returns env var first", async () => {
		process.env.OUTLINE_OAUTH_CLIENT_ID = "env-client-id";
		const { getOAuthClientId } = await import("../lib/auth.js");
		expect(getOAuthClientId()).toBe("env-client-id");
	});

	it("getOAuthClientId reads from config file", async () => {
		writeFileSync(
			TEST_CONFIG_PATH,
			JSON.stringify({ oauth_client_id: "file-client-id" }),
		);
		const { getOAuthClientId } = await import("../lib/auth.js");
		expect(getOAuthClientId()).toBe("file-client-id");
	});
});
