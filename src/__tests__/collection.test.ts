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

const COL_ID = "660e8400-e29b-41d4-a716-446655440001";

const mockCollection = {
	id: COL_ID,
	name: "Engineering",
	description: "Engineering docs",
	color: "#4A90E2",
	permission: "read_write",
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-15T12:00:00Z",
	documentCount: 42,
};

describe("collection commands", () => {
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

	describe("collection list", () => {
		it("lists collections with default options", async () => {
			apiRequest.mockResolvedValue({
				data: [mockCollection],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync(["node", "ol", "collection", "list"]);

			expect(apiRequest).toHaveBeenCalledWith("collections.list", {
				limit: 25,
				offset: 0,
			});
		});

		it("passes pagination options", async () => {
			apiRequest.mockResolvedValue({
				data: [],
				pagination: { offset: 10, limit: 5 },
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"list",
				"--limit",
				"5",
				"--offset",
				"10",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.list", {
				limit: 5,
				offset: 10,
			});
		});

		it("outputs JSON when --json flag used", async () => {
			apiRequest.mockResolvedValue({
				data: [mockCollection],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync(["node", "ol", "collection", "list", "--json"]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed[0].name).toBe("Engineering");
			expect(parsed[0].documentCount).toBe(42);
		});

		it("outputs NDJSON when --ndjson flag used", async () => {
			apiRequest.mockResolvedValue({
				data: [
					mockCollection,
					{ ...mockCollection, id: "col-456", name: "Design" },
				],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"list",
				"--ndjson",
			]);

			expect(logs.length).toBe(2);
			expect(JSON.parse(logs[0]).name).toBe("Engineering");
			expect(JSON.parse(logs[1]).name).toBe("Design");
		});

		it("includes all fields with --full flag", async () => {
			apiRequest.mockResolvedValue({
				data: [mockCollection],
				pagination: { offset: 0, limit: 25 },
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"list",
				"--json",
				"--full",
			]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed[0]).toHaveProperty("createdAt");
			expect(parsed[0]).toHaveProperty("updatedAt");
			expect(parsed[0]).toHaveProperty("permission");
		});
	});

	describe("collection get", () => {
		it("gets collection by ID", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync(["node", "ol", "collection", "get", COL_ID]);

			expect(apiRequest).toHaveBeenCalledWith("collections.info", {
				id: COL_ID,
			});
		});

		it("outputs JSON when --json flag used", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"get",
				COL_ID,
				"--json",
			]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed.id).toBe(COL_ID);
			expect(parsed.name).toBe("Engineering");
		});
	});

	describe("collection create", () => {
		it("creates collection with name", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"create",
				"--name",
				"New Collection",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.create", {
				name: "New Collection",
			});
			expect(logs[0]).toContain("Created:");
		});

		it("creates collection with description", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"create",
				"--name",
				"New Collection",
				"--description",
				"A great collection",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.create", {
				name: "New Collection",
				description: "A great collection",
			});
		});

		it("creates collection with color", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"create",
				"--name",
				"New Collection",
				"--color",
				"#FF5733",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.create", {
				name: "New Collection",
				color: "#FF5733",
			});
		});

		it("creates private collection with --private flag", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"create",
				"--name",
				"Private Collection",
				"--private",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.create", {
				name: "Private Collection",
				permission: "",
			});
		});

		it("outputs JSON when --json flag used", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"create",
				"--name",
				"New Collection",
				"--json",
			]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed.name).toBe("Engineering");
		});
	});

	describe("collection update", () => {
		it("updates collection name", async () => {
			apiRequest.mockResolvedValue({
				data: { ...mockCollection, name: "Updated Name" },
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"update",
				COL_ID,
				"--name",
				"Updated Name",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.update", {
				id: COL_ID,
				name: "Updated Name",
			});
			expect(logs[0]).toContain("Updated:");
		});

		it("updates collection description", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"update",
				COL_ID,
				"--description",
				"New description",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.update", {
				id: COL_ID,
				description: "New description",
			});
		});

		it("updates collection color", async () => {
			apiRequest.mockResolvedValue({
				data: mockCollection,
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"update",
				COL_ID,
				"--color",
				"#00FF00",
			]);

			expect(apiRequest).toHaveBeenCalledWith("collections.update", {
				id: COL_ID,
				color: "#00FF00",
			});
		});

		it("outputs JSON when --json flag used", async () => {
			apiRequest.mockResolvedValue({
				data: { ...mockCollection, name: "Updated" },
			});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"update",
				COL_ID,
				"--name",
				"Updated",
				"--json",
			]);

			const parsed = JSON.parse(logs[0]);
			expect(parsed.name).toBe("Updated");
		});
	});

	describe("collection delete", () => {
		it("requires --confirm flag", async () => {
			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("process.exit");
			});

			await expect(
				program.parseAsync(["node", "ol", "collection", "delete", COL_ID]),
			).rejects.toThrow("process.exit");

			expect(errors[0]).toContain("CONFIRMATION_REQUIRED");
			exitSpy.mockRestore();
		});

		it("deletes collection with --confirm flag", async () => {
			// First call: resolveCollectionId verifies collection exists
			// Second call: collections.delete
			apiRequest
				.mockResolvedValueOnce({ data: mockCollection })
				.mockResolvedValueOnce({});

			const { registerCollectionCommand } = await import(
				"../commands/collection.js"
			);
			const program = new Command();
			program.exitOverride();
			registerCollectionCommand(program);

			await program.parseAsync([
				"node",
				"ol",
				"collection",
				"delete",
				COL_ID,
				"--confirm",
			]);

			expect(apiRequest).toHaveBeenLastCalledWith("collections.delete", {
				id: COL_ID,
			});
			expect(logs[0]).toBe("Deleted.");
		});
	});
});
