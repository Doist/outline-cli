import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
	getApiToken: () => "test-token",
	getBaseUrl: () => "https://test.outline.com",
}));

describe("apiRequest", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("makes POST request with correct headers", async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({ data: { id: "123" } }),
		};
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiRequest } = await import("../lib/api.js");
		await apiRequest("documents.info", { id: "abc" });

		expect(fetch).toHaveBeenCalledWith(
			"https://test.outline.com/api/documents.info",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
				},
				body: JSON.stringify({ id: "abc" }),
			},
		);
	});

	it("returns data and pagination", async () => {
		const mockResponse = {
			ok: true,
			json: async () => ({
				data: [{ id: "1" }],
				pagination: { offset: 0, limit: 25 },
			}),
		};
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiRequest } = await import("../lib/api.js");
		const result = await apiRequest("documents.list");

		expect(result.data).toEqual([{ id: "1" }]);
		expect(result.pagination).toEqual({ offset: 0, limit: 25 });
	});

	it("throws on non-ok response with API message", async () => {
		const mockResponse = {
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			json: async () => ({
				error: "auth_required",
				message: "Authentication required",
			}),
		};
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiRequest } = await import("../lib/api.js");
		await expect(apiRequest("auth.info")).rejects.toThrow(
			"Authentication required",
		);
	});

	it("throws generic message when no API error body", async () => {
		const mockResponse = {
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			json: async () => {
				throw new Error("not json");
			},
		};
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiRequest } = await import("../lib/api.js");
		await expect(apiRequest("documents.list")).rejects.toThrow(
			"API error: 500 Internal Server Error",
		);
	});
});
