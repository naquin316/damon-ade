import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";

const TEST_HOME = join(tmpdir(), `ade-repo-test-${process.pid}-${Date.now()}`);
process.env.ADE_HOME_DIR = TEST_HOME;

let setupAgentRepo: typeof import("./agent-repo").setupAgentRepo;

beforeAll(async () => {
	setupAgentRepo = (await import("./agent-repo")).setupAgentRepo;
});
afterAll(() => rmSync(TEST_HOME, { recursive: true, force: true }));

describe("setupAgentRepo — linked-worktree", () => {
	it("creates a branch-isolated worktree off a real repo", async () => {
		// Arrange: a real source repo with one commit on main.
		const realRepo = join(TEST_HOME, "real-repo");
		mkdirSync(realRepo, { recursive: true });
		const git = simpleGit(realRepo);
		await git.init(["--initial-branch=main"]);
		await git.addConfig("user.name", "T", false, "local");
		await git.addConfig("user.email", "t@t", false, "local");
		await git.raw(["commit", "--allow-empty", "-m", "init"]);

		const res = await setupAgentRepo({
			agentId: "agent-linked",
			source: { type: "linked-worktree", repoPath: realRepo, branch: "ade/agent-linked" },
		});

		expect(existsSync(join(res.worktreePath, ".git"))).toBe(true); // worktree has a .git file
		// Branch is unique per agent (base name + agentId suffix), not the raw
		// source.branch verbatim — avoids collisions on re-seed.
		expect(res.branch.startsWith("ade/agent-linked-")).toBe(true);
		// The worktree is registered on the real repo.
		const list = await simpleGit(realRepo).raw(["worktree", "list"]);
		expect(list).toContain(res.worktreePath);
	});

	it("does not collide when re-seeding creates a new agent with the same source.branch", async () => {
		// Arrange: a single real source repo shared by two different agents.
		const realRepo = join(TEST_HOME, "real-repo-dup");
		mkdirSync(realRepo, { recursive: true });
		const git = simpleGit(realRepo);
		await git.init(["--initial-branch=main"]);
		await git.addConfig("user.name", "T", false, "local");
		await git.addConfig("user.email", "t@t", false, "local");
		await git.raw(["commit", "--allow-empty", "-m", "init"]);

		const source = { type: "linked-worktree" as const, repoPath: realRepo, branch: "ade/dup" };

		// Two agents, same fixed source.branch, different agentIds (so their
		// worktree paths differ under the temp home) — this reproduces the
		// re-seed scenario where a fixed branch name per role is reused.
		// agentIds must differ within their first 8 chars (the derived branch
		// suffix is `agentId.slice(0, 8)`) so the two branches are distinct.
		const res1 = await setupAgentRepo({ agentId: "one-dup-agent", source });
		const res2 = await setupAgentRepo({ agentId: "two-dup-agent", source });

		expect(existsSync(join(res1.worktreePath, ".git"))).toBe(true);
		expect(existsSync(join(res2.worktreePath, ".git"))).toBe(true);
		expect(res1.branch).not.toBe(res2.branch);

		const list = await simpleGit(realRepo).raw(["worktree", "list"]);
		expect(list).toContain(res1.worktreePath);
		expect(list).toContain(res2.worktreePath);
	});
});

describe("setupAgentRepo — direct", () => {
	it("returns the external target path without creating a repo", async () => {
		const target = join(TEST_HOME, "some-dir");
		mkdirSync(target, { recursive: true });
		const res = await setupAgentRepo({
			agentId: "agent-direct",
			source: { type: "direct", path: target },
		});
		expect(res.worktreePath).toBe(target);
		expect(existsSync(join(res.worktreePath, ".git"))).toBe(false);
	});

	it("throws a clear error when the direct path does not exist", async () => {
		await expect(
			setupAgentRepo({ agentId: "agent-missing", source: { type: "direct", path: join(TEST_HOME, "nope-does-not-exist") } }),
		).rejects.toThrow(/does not exist/);
	});
});
