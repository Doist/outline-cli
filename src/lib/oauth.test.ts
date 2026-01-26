import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizationUrl, exchangeCodeForToken } from "./oauth.js";

describe("OAuth utilities", () => {
	describe("buildAuthorizationUrl", () => {
		const baseOptions = {
			baseUrl: "https://app.getoutline.com",
			clientId: "test-client-id",
			redirectUri: "http://localhost:8080/callback",
			codeChallenge: "test-code-challenge",
			state: "test-state",
		};

		it("builds URL with correct base path", () => {
			const url = buildAuthorizationUrl(baseOptions);
			expect(url).toContain("https://app.getoutline.com/oauth/authorize?");
		});

		it("includes client_id parameter", () => {
			const url = new URL(buildAuthorizationUrl(baseOptions));
			expect(url.searchParams.get("client_id")).toBe("test-client-id");
		});

		it("sets response_type to code", () => {
			const url = new URL(buildAuthorizationUrl(baseOptions));
			expect(url.searchParams.get("response_type")).toBe("code");
		});

		it("includes code_challenge parameter", () => {
			const url = new URL(buildAuthorizationUrl(baseOptions));
			expect(url.searchParams.get("code_challenge")).toBe(
				"test-code-challenge",
			);
		});

		it("sets code_challenge_method to S256", () => {
			const url = new URL(buildAuthorizationUrl(baseOptions));
			expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		});

		it("includes redirect_uri parameter", () => {
			const url = new URL(buildAuthorizationUrl(baseOptions));
			expect(url.searchParams.get("redirect_uri")).toBe(
				"http://localhost:8080/callback",
			);
		});

		it("includes state parameter", () => {
			const url = new URL(buildAuthorizationUrl(baseOptions));
			expect(url.searchParams.get("state")).toBe("test-state");
		});

		it("handles base URLs without trailing slash", () => {
			const url = buildAuthorizationUrl({
				...baseOptions,
				baseUrl: "https://outline.example.com",
			});
			expect(url).toContain("https://outline.example.com/oauth/authorize?");
		});

		it("properly encodes special characters in parameters", () => {
			const url = buildAuthorizationUrl({
				...baseOptions,
				clientId: "client+id&special=chars",
			});
			expect(url).toContain("client%2Bid%26special%3Dchars");
		});
	});

	describe("exchangeCodeForToken", () => {
		const baseOptions = {
			baseUrl: "https://app.getoutline.com",
			clientId: "test-client-id",
			redirectUri: "http://localhost:8080/callback",
			codeVerifier: "test-code-verifier",
			code: "test-auth-code",
		};

		beforeEach(() => {
			vi.stubGlobal("fetch", vi.fn());
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("sends POST request to token endpoint", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: "test-token" }),
			} as Response);

			await exchangeCodeForToken(baseOptions);

			expect(fetch).toHaveBeenCalledWith(
				"https://app.getoutline.com/oauth/token",
				expect.objectContaining({ method: "POST" }),
			);
		});

		it("sends correct content-type header", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: "test-token" }),
			} as Response);

			await exchangeCodeForToken(baseOptions);

			expect(fetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
				}),
			);
		});

		it("sends all required parameters in body", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: "test-token" }),
			} as Response);

			await exchangeCodeForToken(baseOptions);

			const [, options] = vi.mocked(fetch).mock.calls[0];
			const body = new URLSearchParams(options?.body as string);

			expect(body.get("grant_type")).toBe("authorization_code");
			expect(body.get("client_id")).toBe("test-client-id");
			expect(body.get("redirect_uri")).toBe("http://localhost:8080/callback");
			expect(body.get("code_verifier")).toBe("test-code-verifier");
			expect(body.get("code")).toBe("test-auth-code");
		});

		it("returns access token on success", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: "my-access-token" }),
			} as Response);

			const token = await exchangeCodeForToken(baseOptions);
			expect(token).toBe("my-access-token");
		});

		it("throws on HTTP error with error_description", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				statusText: "Bad Request",
				json: async () => ({
					error: "invalid_grant",
					error_description: "Authorization code expired",
				}),
			} as Response);

			await expect(exchangeCodeForToken(baseOptions)).rejects.toThrow(
				"OAuth token exchange failed: Authorization code expired",
			);
		});

		it("throws on HTTP error with message field", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				statusText: "Bad Request",
				json: async () => ({ message: "Invalid client" }),
			} as Response);

			await expect(exchangeCodeForToken(baseOptions)).rejects.toThrow(
				"OAuth token exchange failed: Invalid client",
			);
		});

		it("throws on HTTP error with error field only", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				statusText: "Bad Request",
				json: async () => ({ error: "server_error" }),
			} as Response);

			await expect(exchangeCodeForToken(baseOptions)).rejects.toThrow(
				"OAuth token exchange failed: server_error",
			);
		});

		it("throws on HTTP error with statusText fallback", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				statusText: "Internal Server Error",
				json: async () => ({}),
			} as Response);

			await expect(exchangeCodeForToken(baseOptions)).rejects.toThrow(
				"OAuth token exchange failed: Internal Server Error",
			);
		});

		it("throws when response has no access_token", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ token_type: "Bearer" }),
			} as Response);

			await expect(exchangeCodeForToken(baseOptions)).rejects.toThrow(
				"OAuth token exchange did not return an access token",
			);
		});
	});
});
