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

vi.mock("open", () => ({
	default: vi.fn(),
}));

const DOC_ID = "550e8400-e29b-41d4-a716-446655440000";
const COL_ID = "660e8400-e29b-41d4-a716-446655440001";

const mockDocument = {
	id: DOC_ID,
	title: "Test Document",
	url: "/doc/test-document-abc123",
	urlId: "test-document-abc123",
	text: "# Test Document\n\nThis is the content.",
	collectionId: COL_ID,
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-15T12:00:00Z",
	publishedAt: "2024-01-01T00:00:00Z",
	archivedAt: null,
	parentDocumentId: null,
	revision: 5,
};

describe("document commands", () => {
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

	describe("document list", () => {
		it("lists documents with default options", async () => {
			apiRequest.mockResolvedValue({
				data: [mockDocument],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync(["node", "ol", "document", "list"]);

			expect(apiRequest).toHaveBeenCalledWith("documents.list", {
				limit: 25,
				offset: 0,
				sort: "updatedAt",
				direction: "DESC",
			});
		});

		it("passes pagination options", async () => {
			apiRequest.mockResolvedValue({
				data: [],
				pagination: { offset: 10, limit: 5 },
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"list",
				"--limit",
				"5",
				"--offset",
				"10",
			]);

			expect(apiRequest).toHaveBeenCalledWith("documents.list", {
				limit: 5,
				offset: 10,
				sort: "updatedAt",
				direction: "DESC",
			});
		});

		it("passes sort options", async () => {
			apiRequest.mockResolvedValue({
				data: [],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"list",
				"--sort",
				"title",
				"--direction",
				"ASC",
			]);

			expect(apiRequest).toHaveBeenCalledWith("documents.list", {
				limit: 25,
				offset: 0,
				sort: "title",
				direction: "ASC",
			});
		});

		it("outputs JSON when --json flag used", async () => {
			apiRequest.mockResolvedValue({
				data: [mockDocument],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync(["node", "ol", "document", "list", "--json"]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed[0].title).toBe("Test Document");
		});

		it("outputs NDJSON when --ndjson flag used", async () => {
			apiRequest.mockResolvedValue({
				data: [
					mockDocument,
					{ ...mockDocument, id: "doc-456", title: "Second" },
				],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync(["node", "ol", "document", "list", "--ndjson"]);

			expect(logs.length).toBe(2);
			expect(JSON.parse(logs[0]).title).toBe("Test Document");
			expect(JSON.parse(logs[1]).title).toBe("Second");
		});
	});

	describe("document get", () => {
		it("gets document by URL ID", async () => {
			apiRequest.mockResolvedValue({
				data: mockDocument,
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"get",
				"test-document-abc123",
			]);

			expect(apiRequest).toHaveBeenCalledWith("documents.info", {
				id: "abc123",
			});
			expect(logs[0]).toContain("Test Document");
		});

		it("outputs raw markdown with --raw flag", async () => {
			apiRequest.mockResolvedValue({
				data: mockDocument,
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"get",
				"test-document-abc123",
				"--raw",
			]);

			expect(logs[0]).toContain("# Test Document");
			expect(logs[0]).toContain("This is the content");
		});

		it("outputs JSON with --json flag", async () => {
			apiRequest.mockResolvedValue({
				data: mockDocument,
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"get",
				"test-document-abc123",
				"--json",
			]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed.id).toBe(DOC_ID);
			expect(parsed.title).toBe("Test Document");
		});
	});

	describe("document open", () => {
		it("opens document in browser", async () => {
			apiRequest.mockResolvedValue({
				data: mockDocument,
			});
			const open = (await import("open")).default as ReturnType<typeof vi.fn>;

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"open",
				"test-document-abc123",
			]);

			expect(open).toHaveBeenCalledWith(
				"https://test.outline.com/doc/test-document-abc123",
			);
			expect(logs[0]).toContain("Opened:");
		});
	});

	describe("document create", () => {
		it("creates document with title and collection ID", async () => {
			// First call: resolveCollectionId verifies collection exists
			// Second call: documents.create
			apiRequest
				.mockResolvedValueOnce({
					data: { id: COL_ID, name: "Test Collection" },
				})
				.mockResolvedValueOnce({ data: mockDocument });

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"create",
				"--title",
				"New Doc",
				"--collection",
				COL_ID,
			]);

			expect(apiRequest).toHaveBeenLastCalledWith("documents.create", {
				title: "New Doc",
				collectionId: COL_ID,
			});
			expect(logs[0]).toContain("Created:");
		});

		it("creates document with text content", async () => {
			apiRequest
				.mockResolvedValueOnce({
					data: { id: COL_ID, name: "Test Collection" },
				})
				.mockResolvedValueOnce({ data: mockDocument });

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"create",
				"--title",
				"New Doc",
				"--collection",
				COL_ID,
				"--text",
				"Hello world",
			]);

			expect(apiRequest).toHaveBeenLastCalledWith("documents.create", {
				title: "New Doc",
				collectionId: COL_ID,
				text: "Hello world",
			});
		});

		it("creates document with --publish flag", async () => {
			apiRequest
				.mockResolvedValueOnce({
					data: { id: COL_ID, name: "Test Collection" },
				})
				.mockResolvedValueOnce({ data: mockDocument });

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"create",
				"--title",
				"New Doc",
				"--collection",
				COL_ID,
				"--publish",
			]);

			expect(apiRequest).toHaveBeenLastCalledWith("documents.create", {
				title: "New Doc",
				collectionId: COL_ID,
				publish: true,
			});
		});

		it("outputs JSON when --json flag used", async () => {
			apiRequest.mockResolvedValue({
				data: mockDocument,
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"create",
				"--title",
				"New Doc",
				"--collection",
				COL_ID,
				"--json",
			]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed.title).toBe("Test Document");
		});
	});

	describe("document update", () => {
		it("updates document title", async () => {
			apiRequest.mockResolvedValue({
				data: { ...mockDocument, title: "Updated Title" },
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"update",
				DOC_ID,
				"--title",
				"Updated Title",
			]);

			expect(apiRequest).toHaveBeenCalledWith("documents.update", {
				id: DOC_ID,
				title: "Updated Title",
			});
			expect(logs[0]).toContain("Updated:");
		});

		it("updates document text", async () => {
			apiRequest.mockResolvedValue({
				data: mockDocument,
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"update",
				DOC_ID,
				"--text",
				"New content",
			]);

			expect(apiRequest).toHaveBeenCalledWith("documents.update", {
				id: DOC_ID,
				text: "New content",
			});
		});

		it("extracts title from markdown heading", async () => {
			apiRequest.mockResolvedValue({
				data: mockDocument,
			});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"update",
				DOC_ID,
				"--text",
				"# My Title\n\nBody content",
			]);

			expect(apiRequest).toHaveBeenCalledWith("documents.update", {
				id: DOC_ID,
				title: "My Title",
				text: "Body content",
			});
		});
	});

	describe("document delete", () => {
		it("requires --confirm flag", async () => {
			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("process.exit");
			});

			await expect(
				program.parseAsync(["node", "ol", "document", "delete", DOC_ID]),
			).rejects.toThrow("process.exit");

			expect(errors[0]).toContain("CONFIRMATION_REQUIRED");
			exitSpy.mockRestore();
		});

		it("deletes document with --confirm flag", async () => {
			// First call: resolveDocumentId verifies doc exists
			// Second call: documents.delete
			apiRequest
				.mockResolvedValueOnce({ data: mockDocument })
				.mockResolvedValueOnce({});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"delete",
				DOC_ID,
				"--confirm",
			]);

			expect(apiRequest).toHaveBeenLastCalledWith("documents.delete", {
				id: DOC_ID,
			});
			expect(logs[0]).toBe("Deleted.");
		});
	});

	describe("document move", () => {
		it("moves document to another collection", async () => {
			const TARGET_COL = "770e8400-e29b-41d4-a716-446655440002";
			// First call: resolveDocumentId
			// Second call: resolveCollectionId
			// Third call: documents.move
			apiRequest
				.mockResolvedValueOnce({ data: mockDocument })
				.mockResolvedValueOnce({ data: { id: TARGET_COL, name: "Target" } })
				.mockResolvedValueOnce({});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"document",
				"move",
				DOC_ID,
				"--collection",
				TARGET_COL,
			]);

			expect(apiRequest).toHaveBeenLastCalledWith("documents.move", {
				id: DOC_ID,
				collectionId: TARGET_COL,
			});
			expect(logs[0]).toBe("Moved.");
		});
	});

	describe("document archive", () => {
		it("archives a document", async () => {
			apiRequest
				.mockResolvedValueOnce({ data: mockDocument })
				.mockResolvedValueOnce({});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync(["node", "ol", "document", "archive", DOC_ID]);

			expect(apiRequest).toHaveBeenLastCalledWith("documents.archive", {
				id: DOC_ID,
			});
			expect(logs[0]).toBe("Archived.");
		});
	});

	describe("document unarchive", () => {
		it("unarchives a document", async () => {
			apiRequest
				.mockResolvedValueOnce({ data: mockDocument })
				.mockResolvedValueOnce({});

			const { registerDocumentCommand } = await import(
				"../commands/document.js"
			);
			const program = new Command();
			program.exitOverride();
			registerDocumentCommand(program);

			await program.parseAsync(["node", "ol", "document", "unarchive", DOC_ID]);

			expect(apiRequest).toHaveBeenLastCalledWith("documents.unarchive", {
				id: DOC_ID,
			});
			expect(logs[0]).toBe("Unarchived.");
		});
	});
});
