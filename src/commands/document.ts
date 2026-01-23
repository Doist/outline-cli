import { exec } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import chalk from "chalk";
import { apiRequest } from "../lib/api.js";
import { getBaseUrl } from "../lib/auth.js";
import { renderMarkdown } from "../lib/markdown.js";
import { getOutputOptions, outputItem, outputList } from "../lib/output.js";

interface Document {
	id: string;
	title: string;
	url: string;
	urlId: string;
	text: string;
	collectionId: string;
	createdAt: string;
	updatedAt: string;
	publishedAt: string | null;
	archivedAt: string | null;
	parentDocumentId: string | null;
	revision: number;
}

const essentialKeys: (keyof Document)[] = [
	"id",
	"title",
	"urlId",
	"collectionId",
	"updatedAt",
];

function resolveId(input: string): string {
	// If it looks like a URL, extract the slug suffix
	const parts = input.replace(/\/$/, "").split("/");
	const last = parts[parts.length - 1];
	// Outline URL IDs are the part after the last hyphen in the slug
	const match = last.match(/-([a-zA-Z0-9]+)$/);
	if (match) return match[1];
	return input;
}

function formatDoc(doc: Document): string {
	const title = chalk.bold(doc.title);
	const id = chalk.dim(doc.urlId);
	const date = chalk.dim(new Date(doc.updatedAt).toLocaleDateString());
	return `${title} ${id} ${date}`;
}

function formatDocFull(doc: Document): string {
	return `# ${doc.title}\n\n${doc.text}`;
}

function readTextInput(opts: { text?: string; file?: string }): string | undefined {
	if (opts.file) return readFileSync(opts.file, "utf-8");
	return opts.text;
}

function openInBrowser(url: string): void {
	const cmd =
		process.platform === "win32"
			? `start "" "${url}"`
			: process.platform === "darwin"
				? `open "${url}"`
				: `xdg-open "${url}"`;
	exec(cmd);
}

function extractTitleFromText(text: string): { title?: string; body: string } {
	const lines = text.split("\n");
	const firstLine = lines[0]?.trim();
	if (firstLine?.startsWith("# ")) {
		return {
			title: firstLine.slice(2).trim(),
			body: lines.slice(1).join("\n").replace(/^\n+/, ""),
		};
	}
	return { body: text };
}

export function registerDocumentCommand(program: Command): void {
	const doc = program.command("document").alias("doc").description("Manage documents");

	doc
		.command("list")
		.description("List documents")
		.option("--collection <id>", "Filter by collection ID")
		.option("--limit <n>", "Max results", "25")
		.option("--offset <n>", "Pagination offset", "0")
		.option("--sort <field>", "Sort by field (title|updatedAt|createdAt)", "updatedAt")
		.option("--direction <dir>", "Sort direction (ASC|DESC)", "DESC")
		.option("--json", "Output JSON")
		.option("--ndjson", "Output NDJSON")
		.option("--full", "Include all fields in JSON output")
		.action(async (opts) => {
			const body: Record<string, unknown> = {
				limit: Number(opts.limit),
				offset: Number(opts.offset),
				sort: opts.sort,
				direction: opts.direction,
			};
			if (opts.collection) body.collectionId = opts.collection;

			const { data, pagination } = await apiRequest<Document[]>(
				"documents.list",
				body,
			);

			outputList(data, formatDoc, essentialKeys, getOutputOptions(opts), pagination);
		});

	doc
		.command("get <id>")
		.description("Get a document by URL ID or ID")
		.option("--raw", "Output raw markdown without terminal formatting")
		.option("--json", "Output JSON")
		.option("--full", "Include all fields in JSON output")
		.action(async (id: string, opts) => {
			const { data } = await apiRequest<Document>("documents.info", {
				id: resolveId(id),
			});

			const outputOpts = getOutputOptions(opts);
			if (outputOpts.json) {
				outputItem(data, formatDocFull, essentialKeys, outputOpts);
			} else {
				const content = formatDocFull(data);
				console.log(opts.raw ? content : renderMarkdown(content));
			}
		});

	doc
		.command("open <id>")
		.description("Open a document in the browser")
		.action(async (id: string) => {
			const { data } = await apiRequest<Document>("documents.info", {
				id: resolveId(id),
			});
			const fullUrl = `${getBaseUrl()}${data.url}`;
			openInBrowser(fullUrl);
			console.log(chalk.dim(`Opened: ${fullUrl}`));
		});

	doc
		.command("create")
		.description("Create a document")
		.requiredOption("--title <title>", "Document title")
		.requiredOption("--collection <id>", "Collection ID")
		.option("--text <text>", "Document body (markdown)")
		.option("--file <path>", "Read markdown from file")
		.option("--publish", "Publish immediately")
		.option("--json", "Output JSON")
		.action(async (opts) => {
			const body: Record<string, unknown> = {
				title: opts.title,
				collectionId: opts.collection,
			};

			const text = readTextInput(opts);
			if (text) body.text = text;
			if (opts.publish) body.publish = true;

			const { data } = await apiRequest<Document>("documents.create", body);

			if (opts.json) {
				outputItem(data, formatDoc, essentialKeys, { json: true });
			} else {
				console.log(chalk.green(`Created: ${data.title}`), chalk.dim(data.urlId));
			}
		});

	doc
		.command("update <id>")
		.description("Update a document")
		.option("--title <title>", "New title")
		.option("--text <text>", "New body (markdown)")
		.option("--file <path>", "Read markdown from file")
		.option("--json", "Output JSON")
		.action(async (id: string, opts) => {
			const body: Record<string, unknown> = { id: resolveId(id) };

			const rawText = readTextInput(opts);
			if (rawText && !opts.title) {
				const { title, body: textBody } = extractTitleFromText(rawText);
				if (title) body.title = title;
				body.text = textBody;
			} else {
				if (rawText) body.text = rawText;
				if (opts.title) body.title = opts.title;
			}

			const { data } = await apiRequest<Document>("documents.update", body);

			if (opts.json) {
				outputItem(data, formatDoc, essentialKeys, { json: true });
			} else {
				console.log(chalk.green(`Updated: ${data.title}`), chalk.dim(data.urlId));
			}
		});

	doc
		.command("delete <id>")
		.description("Delete a document")
		.option("--confirm", "Skip confirmation")
		.action(async (id: string, opts) => {
			if (!opts.confirm) {
				console.error(chalk.red("Use --confirm to delete."));
				process.exit(1);
			}
			await apiRequest("documents.delete", { id: resolveId(id) });
			console.log("Deleted.");
		});

	doc
		.command("move <id>")
		.description("Move a document to another collection")
		.requiredOption("--collection <id>", "Target collection ID")
		.action(async (id: string, opts) => {
			await apiRequest("documents.move", {
				id: resolveId(id),
				collectionId: opts.collection,
			});
			console.log("Moved.");
		});

	doc
		.command("archive <id>")
		.description("Archive a document")
		.action(async (id: string) => {
			await apiRequest("documents.archive", { id: resolveId(id) });
			console.log("Archived.");
		});

	doc
		.command("unarchive <id>")
		.description("Unarchive a document")
		.action(async (id: string) => {
			await apiRequest("documents.unarchive", { id: resolveId(id) });
			console.log("Unarchived.");
		});
}
