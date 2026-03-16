import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
	getApiToken: () => "test-token",
	getBaseUrl: () => "https://test.outline.com",
	getTokenSource: () => "config" as const,
}));

vi.mock("../lib/api.js", () => ({
	apiRequest: vi.fn(),
}));

const DOC_ID = "550e8400-e29b-41d4-a716-446655440000";
const COL_ID = "660e8400-e29b-41d4-a716-446655440001";

const mockResult = {
	document: {
		id: DOC_ID,
		title: "Search Doc",
		url: "/doc/search-doc-abc123",
		urlId: "search-doc-abc123",
		collectionId: COL_ID,
	},
	context: "Match <b>text</b> here",
	ranking: 0.9,
};

describe("search command", () => {
	let logs: string[];
	let errors: string[];
	let apiRequest: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		logs = [];
		errors = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.join(" "));
		});
		const api = await import("../lib/api.js");
		apiRequest = api.apiRequest as ReturnType<typeof vi.fn>;
		apiRequest.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls documents.search with default limit and filters", async () => {
		apiRequest.mockResolvedValue({
			data: [mockResult],
			pagination: { offset: 0, limit: 25 },
		});

		const { registerSearchCommand } = await import("../commands/search.js");
		const program = new Command();
		program.exitOverride();
		registerSearchCommand(program);

		await program.parseAsync([
			"node",
			"ol",
			"search",
			"urgent query",
			"--collection",
			COL_ID,
			"--status",
			"published",
		]);

		expect(apiRequest).toHaveBeenCalledWith("documents.search", {
			query: "urgent query",
			limit: 25,
			collectionId: COL_ID,
			statusFilter: ["published"],
		});
	});

	it("outputs JSON with essential keys", async () => {
		apiRequest.mockResolvedValue({
			data: [mockResult],
		});

		const { registerSearchCommand } = await import("../commands/search.js");
		const program = new Command();
		program.exitOverride();
		registerSearchCommand(program);

		await program.parseAsync(["node", "ol", "search", "test", "--json"]);

		const parsed = JSON.parse(logs[0]);
		expect(parsed[0]).toHaveProperty("document");
		expect(parsed[0]).toHaveProperty("context");
		expect(parsed[0]).not.toHaveProperty("ranking");
	});

	it("outputs NDJSON with full fields", async () => {
		apiRequest.mockResolvedValue({
			data: [mockResult, { ...mockResult, ranking: 0.4 }],
		});

		const { registerSearchCommand } = await import("../commands/search.js");
		const program = new Command();
		program.exitOverride();
		registerSearchCommand(program);

		await program.parseAsync([
			"node",
			"ol",
			"search",
			"test",
			"--ndjson",
			"--full",
		]);

		expect(logs.length).toBe(2);
		const parsed = JSON.parse(logs[0]);
		expect(parsed.ranking).toBe(0.9);
	});

	it("prints formatted output and pagination hints", async () => {
		apiRequest.mockResolvedValue({
			data: [mockResult],
			pagination: {
				offset: 0,
				limit: 25,
				nextPath: "/api/documents.search?offset=25",
			},
		});

		const { registerSearchCommand } = await import("../commands/search.js");
		const program = new Command();
		program.exitOverride();
		registerSearchCommand(program);

		await program.parseAsync(["node", "ol", "search", "test"]);

		expect(logs[0]).toContain("https://test.outline.com/doc/search-doc-abc123");
		expect(logs.some((log) => log.includes("more results available"))).toBe(
			true,
		);
	});
});
