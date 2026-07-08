import { beforeAll, describe, expect, it } from "bun:test";
process.env.ADE_HOME_DIR = "/tmp/ade-launch-test";

let buildAgentLaunchCommand: typeof import("./agent-launch").buildAgentLaunchCommand;
beforeAll(async () => {
	buildAgentLaunchCommand = (await import("./agent-launch")).buildAgentLaunchCommand;
});

describe("buildAgentLaunchCommand — claude", () => {
	it("wires the external-brain flags + env + Opus 1M", () => {
		const [cmd] = buildAgentLaunchCommand("a1", "claude");
		expect(cmd).toContain("CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1");
		expect(cmd).toContain("--settings");
		expect(cmd).toContain("--append-system-prompt-file");
		expect(cmd).toContain("--add-dir");
		expect(cmd).toContain("--mcp-config");
		expect(cmd).toContain("--strict-mcp-config");
		expect(cmd).toContain("claude-opus-4-8[1m]");
		expect(cmd).toContain("--dangerously-skip-permissions");
		expect(cmd).toContain("/a1/"); // agent-specific paths
	});
	it("leaves non-claude runtimes on their preset", () => {
		expect(buildAgentLaunchCommand("a1", "codex")[0]).toContain("codex");
	});
});
