import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../transport/fetch-with-retry.js", () => ({
	fetchWithRetry: vi.fn(),
}));

describe("exchangeCodeForToken", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses fetchWithRetry for token exchange", async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({ access_token: "test-access-token" }),
		};
		const { fetchWithRetry } = await import("../transport/fetch-with-retry.js");
		(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue(
			mockResponse,
		);

		const { exchangeCodeForToken } = await import("../lib/oauth.js");
		const token = await exchangeCodeForToken({
			baseUrl: "https://test.outline.com",
			clientId: "client-id",
			redirectUri: "http://localhost:3000/callback",
			codeVerifier: "code-verifier",
			code: "auth-code",
		});

		expect(token).toBe("test-access-token");
		expect(fetchWithRetry).toHaveBeenCalledWith({
			url: "https://test.outline.com/oauth/token",
			options: {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "authorization_code",
					client_id: "client-id",
					redirect_uri: "http://localhost:3000/callback",
					code_verifier: "code-verifier",
					code: "auth-code",
				}).toString(),
			},
		});
	});

	it("throws the provider error message on failed exchange", async () => {
		const mockResponse = {
			ok: false,
			statusText: "Bad Request",
			json: async () => ({
				error: "invalid_grant",
				error_description: "Authorization code expired",
			}),
		};
		const { fetchWithRetry } = await import("../transport/fetch-with-retry.js");
		(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue(
			mockResponse,
		);

		const { exchangeCodeForToken } = await import("../lib/oauth.js");
		await expect(
			exchangeCodeForToken({
				baseUrl: "https://test.outline.com",
				clientId: "client-id",
				redirectUri: "http://localhost:3000/callback",
				codeVerifier: "code-verifier",
				code: "auth-code",
			}),
		).rejects.toThrow(
			"OAuth token exchange failed: Authorization code expired",
		);
	});
});
