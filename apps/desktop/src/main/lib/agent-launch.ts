import { AGENT_PRESET_COMMANDS } from "@superset/shared/agent-command";
import type { AgentRuntime } from "@superset/local-db";
import {
	getAgentContextDir,
	getAgentMcpPath,
	getAgentPersonaPath,
	getAgentSettingsPath,
} from "./agent-home";

/**
 * Build the runtime launch command for an agent. For Claude we inject the agent's
 * EXTERNAL brain (settings/persona/context/mcp) via flags so the target repo is
 * never written to (see Phase 2A design). Other runtimes keep their preset.
 */
export function buildAgentLaunchCommand(
	agentId: string,
	runtime: AgentRuntime,
): string[] {
	if (runtime !== "claude") return AGENT_PRESET_COMMANDS[runtime];

	const q = (p: string) => JSON.stringify(p); // shell-safe quoting
	const settings = getAgentSettingsPath(agentId);
	const persona = getAgentPersonaPath(agentId);
	const context = getAgentContextDir(agentId);
	const mcp = getAgentMcpPath(agentId);

	return [
		`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude ` +
			`--model 'claude-opus-4-8[1m]' ` +
			`--settings ${q(settings)} ` +
			`--append-system-prompt-file ${q(persona)} ` +
			`--add-dir ${q(context)} ` +
			`--mcp-config ${q(mcp)} --strict-mcp-config ` +
			`--dangerously-skip-permissions`,
	];
}
