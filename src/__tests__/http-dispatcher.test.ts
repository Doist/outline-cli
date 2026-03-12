import { Agent, EnvHttpProxyAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROXY_ENV_KEYS = [
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"NO_PROXY",
	"no_proxy",
] as const;

const originalProxyEnv = new Map(
	PROXY_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearProxyEnv(): void {
	for (const key of PROXY_ENV_KEYS) {
		delete process.env[key];
	}
}

function restoreProxyEnv(): void {
	for (const key of PROXY_ENV_KEYS) {
		const value = originalProxyEnv.get(key);
		if (value === undefined) {
			delete process.env[key];
			continue;
		}

		process.env[key] = value;
	}
}

describe("http-dispatcher", () => {
	beforeEach(() => {
		clearProxyEnv();
		vi.spyOn(process, "emitWarning").mockImplementation(() => {});
	});

	afterEach(async () => {
		const { resetDefaultDispatcherForTests } = await import(
			"../transport/http-dispatcher.js"
		);
		await resetDefaultDispatcherForTests();
		restoreProxyEnv();
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("returns a direct Agent when no proxy env vars are set", async () => {
		const { getDefaultDispatcher } = await import(
			"../transport/http-dispatcher.js"
		);

		expect(getDefaultDispatcher()).toBeInstanceOf(Agent);
	});

	it("returns an EnvHttpProxyAgent when proxy env vars are set", async () => {
		process.env.HTTPS_PROXY = "http://proxy.local:8080";
		const { getDefaultDispatcher } = await import(
			"../transport/http-dispatcher.js"
		);

		expect(getDefaultDispatcher()).toBeInstanceOf(EnvHttpProxyAgent);
	});

	it("caches the dispatcher instance", async () => {
		const { getDefaultDispatcher } = await import(
			"../transport/http-dispatcher.js"
		);

		expect(getDefaultDispatcher()).toBe(getDefaultDispatcher());
	});

	it("reset lets tests re-evaluate env-dependent transport selection", async () => {
		const { getDefaultDispatcher, resetDefaultDispatcherForTests } =
			await import("../transport/http-dispatcher.js");
		const directDispatcher = getDefaultDispatcher();

		process.env.HTTPS_PROXY = "http://proxy.local:8080";
		await resetDefaultDispatcherForTests();
		const proxiedDispatcher = getDefaultDispatcher();

		expect(directDispatcher).toBeInstanceOf(Agent);
		expect(proxiedDispatcher).toBeInstanceOf(EnvHttpProxyAgent);
		expect(proxiedDispatcher).not.toBe(directDispatcher);
	});
});
