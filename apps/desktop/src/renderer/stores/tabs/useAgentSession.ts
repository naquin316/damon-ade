import { AGENT_LABELS } from "@superset/shared/agent-command";
import type { AgentRuntime, TerminalPreset } from "@superset/local-db";
import { useCallback } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useTabsWithPresets } from "./useTabsWithPresets";

/** Minimal shape needed to spawn an agent's runtime CLI session. */
export interface AgentSessionWorkspace {
	id: string;
	runtime?: AgentRuntime | null;
	worktreePath?: string | null;
}

/**
 * Spawns an agent's runtime CLI in a new terminal session tab.
 *
 * A "session" is just a normal terminal tab. Given an agent (workspace) with a
 * runtime, we fetch the resolved launch (cwd + commands — the runtime CLI's
 * brain paths are main-process paths, see agent-launch.ts) over tRPC and open
 * it as a new tab. When the agent has no runtime we fall back to a plain
 * shell tab.
 */
export function useAgentSession() {
	const { openPreset, addTab } = useTabsWithPresets();
	const utils = electronTrpc.useUtils();

	const spawnAgentSession = useCallback(
		async (workspace: AgentSessionWorkspace) => {
			const { id, runtime, worktreePath } = workspace;
			const cwd = worktreePath || undefined;

			if (!runtime) {
				// No runtime configured — open a plain shell in the worktree.
				return addTab(id, { initialCwd: cwd });
			}

			const launch = await utils.workspaces.getAgentLaunch.fetch({ id });
			const preset: TerminalPreset = {
				id: `agent-${runtime}`,
				name: AGENT_LABELS[runtime] ?? runtime,
				cwd: launch.cwd,
				commands: launch.commands,
				executionMode: "new-tab",
			};

			return openPreset(id, preset, { target: "new-tab" });
		},
		[openPreset, addTab, utils],
	);

	return { spawnAgentSession };
}
