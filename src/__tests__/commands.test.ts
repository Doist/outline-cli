import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../lib/auth.js", () => ({
	getApiToken: () => "test-token",
	getBaseUrl: () => "https://test.outline.com",
	getTokenSource: () => "config" as const,
	saveConfig: vi.fn(),
	clearConfig: vi.fn(),
}));

vi.mock("../lib/api.js", () => ({
	apiRequest: vi.fn(),
}));

describe("search command", () => {
	let logs: string[];

	beforeEach(() => {
		logs = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls documents.search with query and options", async () => {
		const { apiRequest } = await import("../lib/api.js");
		(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: [
				{
					document: { id: "1", title: "Test Doc", urlId: "test-doc-abc", collectionId: "c1" },
					context: "Some <b>context</b> here",
					ranking: 0.9,
				},
			],
			pagination: { offset: 0, limit: 25 },
		});

		const { registerSearchCommand } = await import("../commands/search.js");
		const program = new Command();
		program.exitOverride();
		registerSearchCommand(program);

		await program.parseAsync(["node", "ol", "search", "test query", "--limit", "10"]);

		expect(apiRequest).toHaveBeenCalledWith("documents.search", {
			query: "test query",
			limit: 10,
		});
	});

	it("outputs JSON when --json flag used", async () => {
		const { apiRequest } = await import("../lib/api.js");
		(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: [
				{
					document: { id: "1", title: "Test", urlId: "test-abc", collectionId: "c1" },
					context: "snippet",
					ranking: 0.9,
				},
			],
		});

		const { registerSearchCommand } = await import("../commands/search.js");
		const program = new Command();
		program.exitOverride();
		registerSearchCommand(program);

		await program.parseAsync(["node", "ol", "search", "test", "--json"]);

		const parsed = JSON.parse(logs[0]);
		expect(parsed[0].document.title).toBe("Test");
	});
});

describe("document commands", () => {
	let logs: string[];

	beforeEach(() => {
		logs = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("document get resolves URL ID", async () => {
		const { apiRequest } = await import("../lib/api.js");
		(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: {
				id: "full-id",
				title: "My Doc",
				urlId: "my-doc-abc123",
				text: "Hello world",
				collectionId: "c1",
				updatedAt: "2024-01-01T00:00:00Z",
			},
		});

		const { registerDocumentCommand } = await import("../commands/document.js");
		const program = new Command();
		program.exitOverride();
		registerDocumentCommand(program);

		await program.parseAsync(["node", "ol", "document", "get", "my-doc-abc123"]);

		expect(apiRequest).toHaveBeenCalledWith("documents.info", { id: "abc123" });
		expect(logs[0]).toContain("# My Doc");
	});

	it("document list passes pagination options", async () => {
		const { apiRequest } = await import("../lib/api.js");
		(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: [],
			pagination: { offset: 0, limit: 10 },
		});

		const { registerDocumentCommand } = await import("../commands/document.js");
		const program = new Command();
		program.exitOverride();
		registerDocumentCommand(program);

		await program.parseAsync(["node", "ol", "document", "list", "--limit", "10", "--offset", "5"]);

		expect(apiRequest).toHaveBeenCalledWith("documents.list", {
			limit: 10,
			offset: 5,
			sort: "updatedAt",
			direction: "DESC",
		});
	});
});

describe("collection commands", () => {
	let logs: string[];

	beforeEach(() => {
		logs = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("collection list calls API correctly", async () => {
		const { apiRequest } = await import("../lib/api.js");
		(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
			data: [{ id: "c1", name: "Engineering", documentCount: 42 }],
		});

		const { registerCollectionCommand } = await import("../commands/collection.js");
		const program = new Command();
		program.exitOverride();
		registerCollectionCommand(program);

		await program.parseAsync(["node", "ol", "collection", "list"]);

		expect(apiRequest).toHaveBeenCalledWith("collections.list", {
			limit: 25,
			offset: 0,
		});
	});
});
