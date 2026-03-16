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

describe("fetchWithRetry", () => {
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
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("uses the default dispatcher for requests", async () => {
		const fetchMock = vi.fn();
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				statusText: "OK",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { getDefaultDispatcher } = await import(
			"../transport/http-dispatcher.js"
		);
		const { fetchWithRetry } = await import("../transport/fetch-with-retry.js");
		const response = await fetchWithRetry({
			url: "https://test.outline.com/api/documents.info",
			options: { method: "POST" },
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://test.outline.com/api/documents.info",
			{
				method: "POST",
				dispatcher: getDefaultDispatcher(),
			},
		);
		expect(response.ok).toBe(true);
	});

	it("retries network errors when configured", async () => {
		const fetchMock = vi.fn();
		fetchMock
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValue(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					statusText: "OK",
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		const { fetchWithRetry } = await import("../transport/fetch-with-retry.js");
		const response = await fetchWithRetry({
			url: "https://test.outline.com/api/documents.info",
			retryConfig: {
				retries: 2,
				retryDelay: () => 0,
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(response.ok).toBe(true);
	});

	it("retries timeout errors when configured", async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn();
		fetchMock
			.mockImplementationOnce(
				(_url: RequestInfo | URL, options?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						options?.signal?.addEventListener(
							"abort",
							() => {
								const reason = options.signal?.reason;
								reject(
									reason instanceof Error
										? reason
										: new Error(String(reason ?? "Request aborted")),
								);
							},
							{ once: true },
						);
					}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					statusText: "OK",
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		const { fetchWithRetry } = await import("../transport/fetch-with-retry.js");
		const requestPromise = fetchWithRetry({
			url: "https://test.outline.com/api/documents.info",
			options: {
				method: "GET",
				timeout: 20,
			},
			retryConfig: {
				retries: 1,
				retryDelay: () => 0,
			},
		});

		await vi.advanceTimersByTimeAsync(20);
		const response = await requestPromise;

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(response.ok).toBe(true);
	});

	it("aborts built-in fetch requests when the timeout is reached", async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn();
		fetchMock.mockImplementation(
			(_url: RequestInfo | URL, options?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					options?.signal?.addEventListener(
						"abort",
						() => {
							const reason = options.signal?.reason;
							reject(
								reason instanceof Error
									? reason
									: new Error(String(reason ?? "Request aborted")),
							);
						},
						{ once: true },
					);
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { getDefaultDispatcher } = await import(
			"../transport/http-dispatcher.js"
		);
		const { fetchWithRetry } = await import("../transport/fetch-with-retry.js");

		const requestPromise = fetchWithRetry({
			url: "https://test.outline.com/api/documents.info",
			options: {
				method: "GET",
				timeout: 20,
			},
			retryConfig: { retries: 0 },
		});
		const requestExpectation = expect(requestPromise).rejects.toThrow(
			"Request timeout after 20ms",
		);

		await vi.advanceTimersByTimeAsync(20);
		await requestExpectation;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://test.outline.com/api/documents.info",
			expect.objectContaining({
				method: "GET",
				dispatcher: getDefaultDispatcher(),
				signal: expect.any(AbortSignal),
			}),
		);
	});
});
