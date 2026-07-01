import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	skillInstallers,
	listAgents,
	getInstaller,
	codexInstaller,
	cursorInstaller,
} = vi.hoisted(() => {
	const codexInstaller = {
		name: "codex",
		description: "Codex skill for Outline CLI",
		getInstallPath: vi.fn(() => "/mock/codex/SKILL.md"),
		generateContent: vi.fn(() => "content"),
		isInstalled: vi.fn(),
		install: vi.fn(),
		uninstall: vi.fn(),
	};
	const cursorInstaller = {
		name: "cursor",
		description: "Cursor skill for Outline CLI",
		getInstallPath: vi.fn(() => "/mock/cursor/SKILL.md"),
		generateContent: vi.fn(() => "content"),
		isInstalled: vi.fn(),
		install: vi.fn(),
		uninstall: vi.fn(),
	};
	const skillInstallers = {
		codex: codexInstaller,
		cursor: cursorInstaller,
	};
	const listAgents = vi.fn(() => Object.keys(skillInstallers));
	const getInstaller = vi.fn(
		(agent: string) => skillInstallers[agent as keyof typeof skillInstallers],
	);
	return {
		skillInstallers,
		listAgents,
		getInstaller,
		codexInstaller,
		cursorInstaller,
	};
});

vi.mock("../lib/skills/index.js", () => ({
	skillInstallers,
	listAgents,
	getInstaller,
}));

describe("skill command", () => {
	let logs: string[];
	let errors: string[];

	beforeEach(() => {
		logs = [];
		errors = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.join(" "));
		});

		listAgents.mockImplementation(() => Object.keys(skillInstallers));
		getInstaller.mockImplementation(
			(agent: string) => skillInstallers[agent as keyof typeof skillInstallers],
		);

		codexInstaller.install.mockResolvedValue(undefined);
		codexInstaller.uninstall.mockResolvedValue(undefined);
		codexInstaller.isInstalled.mockResolvedValue(false);
		cursorInstaller.isInstalled.mockResolvedValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lists install status for agents", async () => {
		codexInstaller.isInstalled
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		cursorInstaller.isInstalled
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);

		const { registerSkillCommand } = await import("../commands/skill.js");
		const program = new Command();
		program.exitOverride();
		registerSkillCommand(program);

		await program.parseAsync(["node", "ol", "skill", "list"]);

		const output = logs.join("\n");
		expect(output).toContain("codex");
		expect(output).toContain("[global]");
		expect(output).toContain("cursor");
		expect(output).toContain("not installed");
	});

	it("installs a skill with default options", async () => {
		const { registerSkillCommand } = await import("../commands/skill.js");
		const program = new Command();
		program.exitOverride();
		registerSkillCommand(program);

		await program.parseAsync(["node", "ol", "skill", "install", "codex"]);

		expect(codexInstaller.install).toHaveBeenCalledWith(false, false);
		expect(logs.join("\n")).toContain("Installed codex skill");
		expect(logs.join("\n")).toContain("/mock/codex/SKILL.md");
	});

	it("passes local and force options to install", async () => {
		const { registerSkillCommand } = await import("../commands/skill.js");
		const program = new Command();
		program.exitOverride();
		registerSkillCommand(program);

		await program.parseAsync([
			"node",
			"ol",
			"skill",
			"install",
			"codex",
			"--local",
			"--force",
		]);

		expect(codexInstaller.install).toHaveBeenCalledWith(true, true);
	});

	it("uninstalls a skill", async () => {
		const { registerSkillCommand } = await import("../commands/skill.js");
		const program = new Command();
		program.exitOverride();
		registerSkillCommand(program);

		await program.parseAsync([
			"node",
			"ol",
			"skill",
			"uninstall",
			"codex",
			"--local",
		]);

		expect(codexInstaller.uninstall).toHaveBeenCalledWith(true);
		expect(logs.join("\n")).toContain("Uninstalled codex skill");
	});

	it("errors when agent is unknown", async () => {
		getInstaller.mockReturnValue(undefined);
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`process.exit:${code}`);
		}) as never);

		const { registerSkillCommand } = await import("../commands/skill.js");
		const program = new Command();
		program.exitOverride();
		registerSkillCommand(program);

		await expect(
			program.parseAsync(["node", "ol", "skill", "install", "unknown"]),
		).rejects.toThrow("process.exit:1");

		expect(errors.join("\n")).toContain("Unknown agent");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
