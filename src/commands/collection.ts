import type { Command } from "commander";
import chalk from "chalk";
import { apiRequest } from "../lib/api.js";
import { getOutputOptions, outputItem, outputList } from "../lib/output.js";

interface Collection {
	id: string;
	name: string;
	description: string;
	color: string;
	permission: string;
	createdAt: string;
	updatedAt: string;
	documentCount: number;
}

const essentialKeys: (keyof Collection)[] = [
	"id",
	"name",
	"description",
	"color",
	"documentCount",
];

function formatCollection(col: Collection): string {
	const name = chalk.bold(col.name);
	const id = chalk.dim(col.id);
	const count = chalk.dim(`${col.documentCount} docs`);
	return `${name} ${id} ${count}`;
}

export function registerCollectionCommand(program: Command): void {
	const col = program.command("collection").alias("col").description("Manage collections");

	col
		.command("list")
		.description("List collections")
		.option("--limit <n>", "Max results", "25")
		.option("--offset <n>", "Pagination offset", "0")
		.option("--json", "Output JSON")
		.option("--ndjson", "Output NDJSON")
		.option("--full", "Include all fields in JSON output")
		.action(async (opts) => {
			const { data, pagination } = await apiRequest<Collection[]>(
				"collections.list",
				{
					limit: Number(opts.limit),
					offset: Number(opts.offset),
				},
			);

			outputList(data, formatCollection, essentialKeys, getOutputOptions(opts), pagination);
		});

	col
		.command("get <id>")
		.description("Get collection details")
		.option("--json", "Output JSON")
		.option("--full", "Include all fields in JSON output")
		.action(async (id: string, opts) => {
			const { data } = await apiRequest<Collection>("collections.info", { id });
			outputItem(data, formatCollection, essentialKeys, getOutputOptions(opts));
		});

	col
		.command("create")
		.description("Create a collection")
		.requiredOption("--name <name>", "Collection name")
		.option("--description <text>", "Description")
		.option("--color <hex>", "Color hex code")
		.option("--private", "Make private")
		.option("--json", "Output JSON")
		.action(async (opts) => {
			const body: Record<string, unknown> = { name: opts.name };
			if (opts.description) body.description = opts.description;
			if (opts.color) body.color = opts.color;
			if (opts.private) body.permission = "";

			const { data } = await apiRequest<Collection>("collections.create", body);

			if (opts.json) {
				outputItem(data, formatCollection, essentialKeys, { json: true });
			} else {
				console.log(chalk.green(`Created: ${data.name}`), chalk.dim(data.id));
			}
		});

	col
		.command("update <id>")
		.description("Update a collection")
		.option("--name <name>", "New name")
		.option("--description <text>", "New description")
		.option("--color <hex>", "New color")
		.option("--json", "Output JSON")
		.action(async (id: string, opts) => {
			const body: Record<string, unknown> = { id };
			if (opts.name) body.name = opts.name;
			if (opts.description) body.description = opts.description;
			if (opts.color) body.color = opts.color;

			const { data } = await apiRequest<Collection>("collections.update", body);

			if (opts.json) {
				outputItem(data, formatCollection, essentialKeys, { json: true });
			} else {
				console.log(chalk.green(`Updated: ${data.name}`), chalk.dim(data.id));
			}
		});

	col
		.command("delete <id>")
		.description("Delete a collection")
		.option("--confirm", "Skip confirmation")
		.action(async (id: string, opts) => {
			if (!opts.confirm) {
				console.error(chalk.red("Use --confirm to delete."));
				process.exit(1);
			}
			await apiRequest("collections.delete", { id });
			console.log("Deleted.");
		});
}
