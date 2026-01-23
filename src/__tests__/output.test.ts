import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOutputOptions, outputItem, outputList } from "../lib/output.js";

describe("output", () => {
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

	const item = { id: "1", name: "Test", extra: "hidden" };
	const formatter = (i: typeof item) => `${i.name} (${i.id})`;
	const keys: (keyof typeof item)[] = ["id", "name"];

	it("outputItem human mode", () => {
		outputItem(item, formatter, keys);
		expect(logs[0]).toBe("Test (1)");
	});

	it("outputItem json mode shows essential keys only", () => {
		outputItem(item, formatter, keys, { json: true });
		const parsed = JSON.parse(logs[0]);
		expect(parsed).toEqual({ id: "1", name: "Test" });
	});

	it("outputItem json full mode shows all keys", () => {
		outputItem(item, formatter, keys, { json: true, full: true });
		const parsed = JSON.parse(logs[0]);
		expect(parsed).toEqual({ id: "1", name: "Test", extra: "hidden" });
	});

	it("outputList ndjson mode", () => {
		outputList([item, { ...item, id: "2" }], formatter, keys, { ndjson: true });
		expect(logs).toHaveLength(2);
		expect(JSON.parse(logs[0])).toEqual({ id: "1", name: "Test" });
		expect(JSON.parse(logs[1])).toEqual({ id: "2", name: "Test" });
	});

	it("getOutputOptions parses flags", () => {
		expect(getOutputOptions({ json: true, full: true, ndjson: false })).toEqual(
			{
				json: true,
				ndjson: false,
				full: true,
			},
		);
	});
});
