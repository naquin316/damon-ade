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
		expect(res.branch).toBe("ade/agent-linked");
		// The worktree is registered on the real repo.
		const list = await simpleGit(realRepo).raw(["worktree", "list"]);
		expect(list).toContain(res.worktreePath);
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
