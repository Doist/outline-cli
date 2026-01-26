import { afterEach, describe, expect, it } from "vitest";
import {
	type OAuthCallbackServer,
	startOAuthCallbackServer,
} from "./oauth-server.js";

describe("OAuth callback server", () => {
	let server: OAuthCallbackServer | null = null;

	afterEach(() => {
		server?.close();
		server = null;
	});

	it("starts on a random port", async () => {
		server = await startOAuthCallbackServer({ state: "test-state" });
		expect(server.port).toBeGreaterThan(0);
	});

	it("provides correct redirect URI", async () => {
		server = await startOAuthCallbackServer({ state: "test-state" });
		expect(server.redirectUri).toBe(`http://localhost:${server.port}/callback`);
	});

	it("resolves with code on valid callback", async () => {
		server = await startOAuthCallbackServer({ state: "test-state" });

		const fetchPromise = fetch(
			`${server.redirectUri}?code=auth-code-123&state=test-state`,
		);
		const code = await server.waitForCode;

		expect(code).toBe("auth-code-123");
		const response = await fetchPromise;
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("Login complete");
	});

	it("returns 404 for non-callback paths", async () => {
		server = await startOAuthCallbackServer({ state: "test-state" });

		const response = await fetch(
			`http://localhost:${server.port}/other-path?code=x&state=test-state`,
		);
		expect(response.status).toBe(404);
	});

	it("returns 405 for non-GET requests", async () => {
		server = await startOAuthCallbackServer({ state: "test-state" });

		const response = await fetch(server.redirectUri, { method: "POST" });
		expect(response.status).toBe(405);
	});

	it("closes server after successful callback", async () => {
		server = await startOAuthCallbackServer({ state: "test-state" });
		const port = server.port;

		await fetch(`${server.redirectUri}?code=auth-code&state=test-state`);
		await server.waitForCode;

		// Wait for cleanup
		await new Promise((r) => setTimeout(r, 50));

		// Server should be closed
		await expect(fetch(`http://localhost:${port}/callback`)).rejects.toThrow();
		server = null;
	});

	it("can be manually closed", async () => {
		server = await startOAuthCallbackServer({ state: "test-state" });
		const port = server.port;

		server.close();
		server = null;

		await new Promise((r) => setTimeout(r, 50));

		await expect(fetch(`http://localhost:${port}/callback`)).rejects.toThrow();
	});
});
