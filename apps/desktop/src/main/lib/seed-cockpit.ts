import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { projects, workspaces, worktrees } from "@superset/local-db";
import type { AgentRepoSource } from "main/lib/agent-repo";
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

interface SeedAgentSpec {
	name: string;
	source: AgentRepoSource;
}

interface SeedTeamSpec {
	name: string;
	color: string;
	agents: SeedAgentSpec[];
}

/**
 * Roster roots, overridable via env so tests can point the seed roster at a
 * throwaway sandbox instead of Ryan's real ~/Code checkouts and vault (the
 * `resolveSource` guard below downgrades any `linked-worktree` whose
 * `repoPath` doesn't exist on disk, so hermetic tests need real dirs to
 * point at). Read lazily inside `buildSeedTeams()` — not at module load —
 * so a test that sets the env vars right before calling `seedDefaultCockpit()`
 * still takes effect.
 */
function codeRoot(): string {
	return process.env.ADE_SEED_CODE_ROOT || join(homedir(), "Code");
}

function vaultRoot(): string {
	return (
		process.env.ADE_SEED_VAULT ||
		join(homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026")
	);
}

/** Ryan's default cockpit: six teams and their agents. All Claude runtime. */
function buildSeedTeams(): SeedTeamSpec[] {
	const CODE = (r: string) => join(codeRoot(), r);
	const VAULT = vaultRoot();

	return [
		{
			name: "HLD Ops",
			color: "#E11D48",
			agents: [
				{
					name: "Shopify / Store Cockpit",
					source: { type: "linked-worktree", repoPath: CODE("ShopifyStore"), branch: "ade/shopify" },
				},
				{
					name: "Storefront Support",
					source: { type: "linked-worktree", repoPath: CODE("handlaneultimate"), branch: "ade/storefront" },
				},
				{
					name: "RubyPulse / Laser",
					source: { type: "linked-worktree", repoPath: CODE("rubypulse"), branch: "ade/rubypulse" },
				},
				{
					name: "Foreman / Listings",
					source: { type: "linked-worktree", repoPath: CODE("hld-admin"), branch: "ade/foreman" },
				},
			],
		},
		{
			name: "Hand Lane AI",
			color: "#7C3AED",
			agents: [
				{ name: "Consulting", source: { type: "init" } },
				{ name: "SaaS Build", source: { type: "init" } },
			],
		},
		{
			name: "Content / YouTube",
			color: "#EA580C",
			agents: [
				{ name: "Script Writer", source: { type: "direct", path: VAULT } },
				{ name: "Clip Scout", source: { type: "direct", path: VAULT } },
			],
		},
		{
			name: "Trading",
			color: "#16A34A",
			agents: [
				{
					name: "Kalshi BTC / Tessa",
					source: { type: "linked-worktree", repoPath: CODE("kalshi-btc-lab"), branch: "ade/tessa" },
				},
			],
		},
		{
			name: "Personal / RLOS",
			color: "#2563EB",
			agents: [
				{ name: "Daily Planner", source: { type: "direct", path: VAULT } },
				{
					name: "Code HQ / Portfolio",
					source: { type: "linked-worktree", repoPath: CODE(".codehq"), branch: "ade/codehq" },
				},
			],
		},
		{
			name: "Social Media",
			color: "#DB2777",
			agents: [
				{ name: "SM Manager", source: { type: "direct", path: VAULT } },
			],
		},
	];
}

/**
 * Resolve a seed agent's source, guarding against a `linked-worktree` whose
 * real repo doesn't exist on this machine (Ryan's laptop may not have every
 * repo checked out). A missing repo must not brick the whole seed — fall back
 * to a plain `init` agent instead and log so it's visible.
 */
function resolveSource(agentName: string, source: AgentRepoSource): AgentRepoSource {
	if (source.type === "linked-worktree" && !existsSync(source.repoPath)) {
		console.warn(
			`[seed-cockpit] "${agentName}": repo not found at ${source.repoPath}, seeding as init instead`,
		);
		return { type: "init" };
	}
	return source;
}

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
	const SEED_TEAMS = buildSeedTeams();

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

		team.agents.forEach((agent, agentIndex) => {
			const agentId = uuidv4();
			const source = resolveSource(agent.name, agent.source);
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
					name: agent.name,
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
					agentName: agent.name,
					runtime: "claude",
					source,
				},
			});
		});
	});

	return seeded;
}
