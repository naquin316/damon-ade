import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
process.env.ADE_HOME_DIR = "/tmp/ade-home-test";

let h: typeof import("./agent-home");
beforeAll(async () => { h = await import("./agent-home"); });

describe("agent-home external brain paths", () => {
	it("derives context/persona/settings/mcp/skills under the agent home", () => {
		const home = h.getAgentHome("a1");
		expect(h.getAgentContextDir("a1")).toBe(join(home, "context"));
		expect(h.getAgentPersonaPath("a1")).toBe(join(home, "persona.txt"));
		expect(h.getAgentSettingsPath("a1")).toBe(join(home, "settings.json"));
		expect(h.getAgentMcpPath("a1")).toBe(join(home, "mcp.json"));
		expect(h.getAgentSkillsDir("a1")).toBe(join(home, "skills"));
	});
});
