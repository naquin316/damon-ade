import { projects, workspaces, worktrees } from "@superset/local-db";
import type { beginAgentInit } from "main/lib/agent-init";
import { getAgentWorktreePath } from "main/lib/agent-home";
import { localDb } from "main/lib/local-db";
import { v4 as uuidv4 } from "uuid";

/** Context shape beginAgentInit expects for its second arg. */
type SeedCtx = Parameters<typeof beginAgentInit>[1];

export interface SeededAgent {
	agentId: string;
	ctx: SeedCtx;
}

/** Ryan's default cockpit: five teams and their agents. All Claude runtime. */
const SEED_TEAMS: Array<{ name: string; color: string; agents: string[] }> = [
	{
		name: "HLD Ops",
		color: "#E11D48",
		agents: ["Shopify / Store Cockpit", "RubyPulse / Laser", "Storefront Support"],
	},
	{ name: "Hand Lane AI", color: "#7C3AED", agents: ["Consulting", "SaaS Build"] },
	{ name: "Content / YouTube", color: "#EA580C", agents: ["Script Writer", "Clip Scout"] },
	{ name: "Trading", color: "#16A34A", agents: ["Kalshi BTC / Tessa"] },
	{ name: "Personal / RLOS", color: "#2563EB", agents: ["Daily Planner", "Code HQ / Portfolio"] },
];

/**
 * Seed the default teams/agents if the DB has no Categories yet. Pure DB work —
 * inserts rows and returns each agent's init context. The caller triggers the
 * repo/memory build by passing each ctx to beginAgentInit (kept out of here so
 * this stays fast and unit-testable). Idempotent: returns [] when non-empty.
 */
export function seedDefaultCockpit(): SeededAgent[] {
	const existing = localDb.select().from(projects).all();
	if (existing.length > 0) return [];

	const seeded: SeededAgent[] = [];

	SEED_TEAMS.forEach((team, teamIndex) => {
		const category = localDb
			.insert(projects)
			.values({
				mainRepoPath: "",
				name: team.name,
				color: team.color,
				tabOrder: teamIndex,
			})
			.returning()
			.get();

		team.agents.forEach((agentName, agentIndex) => {
			const agentId = uuidv4();
			const worktree = localDb
				.insert(worktrees)
				.values({
					projectId: category.id,
					path: getAgentWorktreePath(agentId),
					branch: "main",
					baseBranch: "main",
					gitStatus: null,
				})
				.returning()
				.get();

			localDb
				.insert(workspaces)
				.values({
					id: agentId,
					projectId: category.id,
					worktreeId: worktree.id,
					type: "worktree",
					branch: "main",
					name: agentName,
					runtime: "claude",
					isUnnamed: false,
					tabOrder: agentIndex,
				})
				.run();

			seeded.push({
				agentId,
				ctx: {
					categoryId: category.id,
					worktreeId: worktree.id,
					agentName,
					runtime: "claude",
					source: { type: "init" },
				},
			});
		});
	});

	return seeded;
}
