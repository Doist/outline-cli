import chalk from "chalk";
import type { Command } from "commander";
import { apiRequest } from "../lib/api.js";
import { getBaseUrl } from "../lib/auth.js";
import { getOutputOptions, outputList } from "../lib/output.js";

interface SearchResult {
	document: {
		id: string;
		title: string;
		url: string;
		urlId: string;
		collectionId: string;
	};
	context: string;
	ranking: number;
}

const essentialKeys: (keyof SearchResult)[] = ["document", "context"];

function formatResult(result: SearchResult): string {
	const { document, context } = result;
	const title = chalk.bold(document.title);
	const id = chalk.dim(document.urlId);
	const link = chalk.dim(`${getBaseUrl()}${document.url}`);
	const snippet = context
		.replace(/<b>(.*?)<\/b>/g, (_, m) => chalk.bold(m))
		.replace(/<\/?b>/g, "")
		.trim()
		.slice(0, 120);
	return `${title} ${id}\n  ${link}\n  ${chalk.dim(snippet)}\n`;
}

export function registerSearchCommand(program: Command): void {
	program
		.command("search <query>")
		.description("Search documents")
		.option("--limit <n>", "Max results", "25")
		.option("--collection <id>", "Filter by collection ID")
		.option("--status <status>", "Filter by status (published|draft|archived)")
		.option("--json", "Output JSON")
		.option("--ndjson", "Output NDJSON")
		.option("--full", "Include all fields in JSON output")
		.action(async (query: string, opts) => {
			const body: Record<string, unknown> = {
				query,
				limit: Number(opts.limit),
			};
			if (opts.collection) body.collectionId = opts.collection;
			if (opts.status) body.statusFilter = [opts.status];

			const { data, pagination } = await apiRequest<SearchResult[]>(
				"documents.search",
				body,
			);

			const outputOpts = getOutputOptions(opts);
			outputList(data, formatResult, essentialKeys, outputOpts, pagination);
		});
}
