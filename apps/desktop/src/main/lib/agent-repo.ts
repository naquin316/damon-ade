import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
	getAgentHome,
	getAgentMemoryDir,
	getAgentWorktreePath,
} from "./agent-home";

/**
 * How an agent's repo is populated at creation time.
 * - init:            a fresh empty git repo (`git init` + empty initial commit)
 * - clone:           clone a remote URL or a local path into the worktree
 * - linked-worktree: a branch-isolated `git worktree` off a REAL repo the user
 *                     already has on disk
 * - direct:          operate in-place inside an existing directory, no git
 */
export type AgentRepoSource =
	| { type: "init" }
	| { type: "clone"; url: string }
	| { type: "linked-worktree"; repoPath: string; branch: string }
	| { type: "direct"; path: string };

export interface AgentRepoResult {
	agentHome: string;
	worktreePath: string;
	memoryDir: string;
	branch: string;
}

/**
 * Build an Agent's standalone repo + home layout on disk (ADE Phase B, risk #1).
 *
 * Unlike the shared-repo model (`git worktree add` off a project's
 * mainRepoPath), each ADE agent owns its OWN git repo at
 * <agent-home>/worktree. The canonical `memory/` dir is created as a sibling
 * (templates are written later, in the Phase E scaffolder). Returns the paths
 * and the checked-out branch so the caller can persist a `worktrees` row.
 */
export async function setupAgentRepo({
	agentId,
	source,
}: {
	agentId: string;
	source: AgentRepoSource;
}): Promise<AgentRepoResult> {
	const agentHome = getAgentHome(agentId);
	const worktreePath = getAgentWorktreePath(agentId);
	const memoryDir = getAgentMemoryDir(agentId);

	// Create the memory dir (this also creates <agent-home>). worktree/ is
	// created below by init/clone.
	mkdirSync(memoryDir, { recursive: true });

	// direct: the agent operates in-place in an existing non-git (or whole-tree)
	// directory. No worktree/branch — just record the target as the cwd.
	if (source.type === "direct") {
		if (!existsSync(source.path)) {
			throw new Error(`Direct agent path does not exist: ${source.path}`);
		}
		return { agentHome, worktreePath: source.path, memoryDir, branch: "" };
	}

	// linked-worktree: a branch-isolated `git worktree` off the user's REAL repo.
	// The agent gets a real checkout on its own branch under <agent-home>/worktree;
	// changes reach the real main only when the user reviews & merges the branch.
	if (source.type === "linked-worktree") {
		// Derive a per-agent unique branch name. `source.branch` alone is a fixed
		// name per role (e.g. "ade/shopify"); if a prior agent's worktree
		// registration for that branch still lingers on the real repo (e.g.
		// ~/.ade was moved/re-seeded), `git worktree add -B <branch>` collides
		// with "already used by worktree at ...". Suffixing with the agentId
		// guarantees re-seeds and parallel agents on the same repo never clash.
		const uniqueBranch = `${source.branch}-${agentId.slice(0, 8)}`;

		if (existsSync(join(worktreePath, ".git"))) {
			// Retry-safety: report the ACTUAL checked-out branch of the existing
			// worktree (not just the derived name) so a retry reflects reality.
			const branch =
				(
					await simpleGit(worktreePath)
						.revparse(["--abbrev-ref", "HEAD"])
						.catch(() => uniqueBranch)
				).trim() || uniqueBranch;
			return { agentHome, worktreePath, memoryDir, branch };
		}
		if (existsSync(worktreePath)) {
			rmSync(worktreePath, { recursive: true, force: true });
		}
		const repo = simpleGit(source.repoPath);
		// Prune stale worktree registrations whose directory is gone (the
		// re-seed case) before adding a new one, so `worktree add` doesn't trip
		// over a lingering registration for a branch we're about to reuse.
		await repo.raw(["worktree", "prune"]);
		// -B: create or reset the agent's branch; add the worktree at our path.
		await repo.raw(["worktree", "add", "-B", uniqueBranch, worktreePath]);
		return { agentHome, worktreePath, memoryDir, branch: uniqueBranch };
	}

	// Retry-safety: if a valid repo already exists (previous attempt got this
	// far), reuse it. If a partial/non-repo dir exists, clear it so init/clone
	// starts clean.
	if (existsSync(join(worktreePath, ".git"))) {
		const branch =
			(
				await simpleGit(worktreePath)
					.revparse(["--abbrev-ref", "HEAD"])
					.catch(() => "main")
			).trim() || "main";
		return { agentHome, worktreePath, memoryDir, branch };
	}
	if (existsSync(worktreePath)) {
		rmSync(worktreePath, { recursive: true, force: true });
	}

	let branch: string;
	if (source.type === "clone") {
		await simpleGit().clone(source.url, worktreePath);
		branch =
			(await simpleGit(worktreePath)
				.revparse(["--abbrev-ref", "HEAD"])
				.catch(() => "main")) || "main";
		branch = branch.trim();
	} else {
		mkdirSync(worktreePath, { recursive: true });
		const git = simpleGit(worktreePath);
		try {
			await git.init(["--initial-branch=main"]);
		} catch {
			await git.init();
		}
		// Set a local identity so the empty initial commit works even when the
		// machine has no global git user configured. Fresh agent repos are
		// standalone, so a local identity is appropriate.
		await git.addConfig("user.name", "ADE Agent", false, "local");
		await git.addConfig("user.email", "agent@ade.local", false, "local");
		await git.raw(["commit", "--allow-empty", "-m", "Initial commit"]);
		branch =
			(await git
				.revparse(["--abbrev-ref", "HEAD"])
				.catch(() => "main")) || "main";
		branch = branch.trim();
	}

	return { agentHome, worktreePath, memoryDir, branch };
}
