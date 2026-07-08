# RyanOS Phase 2A Implementation Plan — Working-Tree Strategy + Launch-Time Injection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each agent work in a **branch-isolated `git worktree` of its real repo** (or a direct dir / isolated repo), with its brain (`context/`, `persona.txt`, `settings.json`, `mcp.json`, `memory/`, `skills/`) living **externally under `~/.ade/agents/<id>/`** and injected at launch via Claude Code flags — **zero ADE files written into your real repos**.

**Architecture:** Add `linked-worktree` and `direct` repo-source modes alongside the existing `init`/`clone`. Relocate the agent "bridge" from the repo worktree to the external agent-home, and build the runtime launch command **per-agent** in the main process (where `~/.ade` paths live) from those external paths. The brain *content* is generic here; Phase 2B fills it via the brain-author skill.

**Tech Stack:** Electron (main + renderer), tRPC IPC (observables only), Drizzle/better-sqlite3, `simple-git`, `bun:test`.

## Global Constraints

- **Zero repo-file writes for real-repo agents.** For `linked-worktree`/`direct` modes, never write `CLAUDE.md`/`.claude/` into the target repo. All brain files live under `~/.ade/agents/<id>/`.
- **Verified launch recipe** (Claude Code v2.1.x): `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --model 'claude-opus-4-8[1m]' --settings <ext> --append-system-prompt-file <ext> --add-dir <ext-context> --mcp-config <ext> --strict-mcp-config --dangerously-skip-permissions`.
- **Memory-safe:** `memory/{AGENT,USER,MEMORY}.md` use `writeIfEmpty` (never clobber learned state). Only the refreshable brain layers (`context/`, `persona.txt`, `mcp.json`) may be overwritten (by 2B).
- **Merge flow:** linked agents work on their own branch; changes reach main only when Ryan reviews & merges. Never auto-merge.
- Bun; macOS arm64; path aliases (`main/…`, `renderer/…`, `@superset/…`); observables-only IPC.
- Commit to `main` (prefix git commits with `BRAYNEE_ALLOW_MAIN_COMMITS=1`).
- Do NOT launch the Electron GUI in a subagent (hangs headless); unit tests are the automated gate, GUI smoke-tests are Ryan's.

## File Structure

- `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent-input.ts` — add source variants.
- `apps/desktop/src/main/lib/agent-repo.ts` — add `linked-worktree` + `direct` handling.
- `apps/desktop/src/main/lib/agent-home.ts` — add external-brain path helpers.
- `apps/desktop/src/main/lib/agent-scaffold.ts` — relocate bridge → external; skills symlink.
- `apps/desktop/src/main/lib/agent-launch.ts` *(new)* — per-agent launch-command builder.
- `apps/desktop/src/lib/trpc/routers/workspaces/…` — tRPC procedure returning the per-agent launch.
- `apps/desktop/src/renderer/stores/tabs/useAgentSession.ts` — consume the per-agent launch.
- `apps/desktop/src/main/lib/seed-cockpit.ts` — workspace modes + Foreman.

---

### Task 1: Add `linked-worktree` and `direct` repo-source variants

**Files:**
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent-input.ts:21-26`
- Modify: `apps/desktop/src/main/lib/agent-repo.ts:15-17,35-96`
- Test: `apps/desktop/src/main/lib/agent-repo.test.ts`

**Interfaces:**
- Produces: `AgentRepoSource = {type:"init"} | {type:"clone";url} | {type:"linked-worktree";repoPath;branch} | {type:"direct";path}`. `setupAgentRepo` returns `{agentHome, worktreePath, memoryDir, branch}` where for `direct` the `worktreePath` is the external target dir (no git).

- [ ] **Step 1: Write failing tests**

Create `apps/desktop/src/main/lib/agent-repo.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd apps/desktop && bun test src/main/lib/agent-repo.test.ts`
Expected: FAIL — `setupAgentRepo` rejects the new `type` values (TS/union error or runtime).

- [ ] **Step 3: Extend the source type + input schema**

In `agent-repo.ts:15-17` replace the `AgentRepoSource` type:

```typescript
export type AgentRepoSource =
	| { type: "init" }
	| { type: "clone"; url: string }
	| { type: "linked-worktree"; repoPath: string; branch: string }
	| { type: "direct"; path: string };
```

In `create-agent-input.ts:21-26` extend the union:

```typescript
	repo: z
		.discriminatedUnion("type", [
			z.object({ type: z.literal("init") }),
			z.object({ type: z.literal("clone"), url: z.string().min(1) }),
			z.object({
				type: z.literal("linked-worktree"),
				repoPath: z.string().min(1),
				branch: z.string().min(1),
			}),
			z.object({ type: z.literal("direct"), path: z.string().min(1) }),
		])
		.default({ type: "init" }),
```

- [ ] **Step 4: Handle the new modes in `setupAgentRepo`**

In `agent-repo.ts`, inside `setupAgentRepo`, BEFORE the existing retry-safety block (currently line 53), add early handling for the two new modes. Insert right after `const memoryDir = getAgentMemoryDir(agentId);` + the `mkdirSync(memoryDir…)` (line 48):

```typescript
	// direct: the agent operates in-place in an existing non-git (or whole-tree)
	// directory. No worktree/branch — just record the target as the cwd.
	if (source.type === "direct") {
		return { agentHome, worktreePath: source.path, memoryDir, branch: "" };
	}

	// linked-worktree: a branch-isolated `git worktree` off the user's REAL repo.
	// The agent gets a real checkout on its own branch under <agent-home>/worktree;
	// changes reach the real main only when the user reviews & merges the branch.
	if (source.type === "linked-worktree") {
		if (existsSync(join(worktreePath, ".git"))) {
			return { agentHome, worktreePath, memoryDir, branch: source.branch };
		}
		if (existsSync(worktreePath)) {
			rmSync(worktreePath, { recursive: true, force: true });
		}
		const repo = simpleGit(source.repoPath);
		// -B: create or reset the agent's branch; add the worktree at our path.
		await repo.raw(["worktree", "add", "-B", source.branch, worktreePath]);
		return { agentHome, worktreePath, memoryDir, branch: source.branch };
	}
```

(The existing `init`/`clone` code below is unchanged.)

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd apps/desktop && bun test src/main/lib/agent-repo.test.ts`
Expected: PASS — both linked-worktree and direct tests green.

- [ ] **Step 6: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/agent-repo.ts apps/desktop/src/main/lib/agent-repo.test.ts apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent-input.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2A): linked-worktree + direct agent repo sources"
```

---

### Task 2: External-brain path helpers

**Files:**
- Modify: `apps/desktop/src/main/lib/agent-home.ts`
- Test: `apps/desktop/src/main/lib/agent-home.test.ts`

**Interfaces:**
- Produces: `getAgentContextDir(id)` → `<home>/context`, `getAgentPersonaPath(id)` → `<home>/persona.txt`, `getAgentSettingsPath(id)` → `<home>/settings.json`, `getAgentMcpPath(id)` → `<home>/mcp.json`, `getAgentSkillsDir(id)` → `<home>/skills`.

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/main/lib/agent-home.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — verify fail**

Run: `cd apps/desktop && bun test src/main/lib/agent-home.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Add the helpers**

Append to `apps/desktop/src/main/lib/agent-home.ts`:

```typescript
/** External brain: the dir loaded via `--add-dir` (holds context/CLAUDE.md). */
export function getAgentContextDir(agentId: string): string {
	return join(getAgentHome(agentId), "context");
}
/** External brain: short identity injected via `--append-system-prompt-file`. */
export function getAgentPersonaPath(agentId: string): string {
	return join(getAgentHome(agentId), "persona.txt");
}
/** External brain: settings passed via `--settings` (autoMemoryDirectory + hooks). */
export function getAgentSettingsPath(agentId: string): string {
	return join(getAgentHome(agentId), "settings.json");
}
/** External brain: curated MCP servers passed via `--mcp-config`. */
export function getAgentMcpPath(agentId: string): string {
	return join(getAgentHome(agentId), "mcp.json");
}
/** External brain: per-agent skills (symlinked into the worktree's .claude/skills). */
export function getAgentSkillsDir(agentId: string): string {
	return join(getAgentHome(agentId), "skills");
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd apps/desktop && bun test src/main/lib/agent-home.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/agent-home.ts apps/desktop/src/main/lib/agent-home.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2A): external-brain path helpers on agent-home"
```

---

### Task 3: Relocate the bridge to the external brain + skills symlink

Move the Claude bridge out of the repo worktree and into the external agent-home so real repos are never written to. `context/CLAUDE.md` `@`-imports the canonical `memory/AGENT.md` + `USER.md` by absolute path and holds the Knowledge section; `settings.json` (external) carries `autoMemoryDirectory` + the Stop hook + the trust/permission keys that suppress the "allow external imports?" prompt; a short `persona.txt` is written for `--append-system-prompt-file`; `mcp.json` is a valid empty config (2B fills it). Per-agent `skills/` is symlinked into `<worktree>/.claude/skills` (git-excluded) since Claude Code can't load skills by flag.

**Files:**
- Modify: `apps/desktop/src/main/lib/agent-scaffold.ts:354-472` (and add the external writers)
- Test: extend `apps/desktop/src/main/lib/agent-scaffold.test.ts`

**Interfaces:**
- `scaffoldAgentMemory(params)` now also writes `context/CLAUDE.md`, `persona.txt`, `settings.json`, `mcp.json` under the agent home and symlinks `skills/` into `<worktree>/.claude/skills`. For `linked-worktree`/`direct` agents it must NOT write `CLAUDE.md`/`.claude/settings.json`/`opencode.json` into the (real) worktree.

- [ ] **Step 1: Write failing tests** (append to `agent-scaffold.test.ts`)

```typescript
describe("scaffoldAgentMemory — external brain (no repo writes)", () => {
	it("writes the brain under agent-home and not into a real worktree", async () => {
		const home = await import("./agent-home");
		const { scaffoldAgentMemory } = await import("./agent-scaffold");
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");

		const agentId = "agent-ext";
		// Simulate a real repo worktree we must NOT write into.
		const realWorktree = join(process.env.ADE_HOME_DIR as string, "real-wt");
		(await import("node:fs")).mkdirSync(realWorktree, { recursive: true });

		scaffoldAgentMemory({
			agentId, agentName: "Ext", runtime: "claude", userName: "Pat",
			worktreePath: realWorktree, external: true,
		});

		// External brain exists…
		expect(existsSync(join(home.getAgentContextDir(agentId), "CLAUDE.md"))).toBe(true);
		expect(existsSync(home.getAgentPersonaPath(agentId))).toBe(true);
		expect(existsSync(home.getAgentSettingsPath(agentId))).toBe(true);
		expect(existsSync(home.getAgentMcpPath(agentId))).toBe(true);
		// …and nothing ADE-specific was written into the real worktree.
		expect(existsSync(join(realWorktree, "CLAUDE.md"))).toBe(false);
		expect(existsSync(join(realWorktree, ".claude", "settings.json"))).toBe(false);
	});
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts -t "external brain"`
Expected: FAIL — `external` param unknown; external files not written.

- [ ] **Step 3: Add external-brain constants + writers**

Near the other templates in `agent-scaffold.ts`, add:

```typescript
// External-brain bridge: lives under <agent-home>/context (loaded via --add-dir),
// NOT in the repo worktree. @-imports the canonical memory by absolute path so the
// real repo is never written to. Knowledge pointers (vault SSOT) are filled by 2B.
const CONTEXT_CLAUDE_MD = `@{{agent_home}}/memory/AGENT.md
@{{agent_home}}/memory/USER.md

# Knowledge
<!-- Pointers to the single source of truth (vault notes, repo docs). Filled by
     the brain-author skill; do not duplicate knowledge here — point at it. -->
`;

const PERSONA_TXT = `You are {{agent_name}}. Read and follow your operating brief and knowledge in the added context directory, and keep your persistent memory current per your write-back protocol.\n`;
```

- [ ] **Step 4: Rewrite the bridge section of `scaffoldAgentMemory`**

Add `external?: boolean` to `ScaffoldParams` (its interface, near the top of the file). Then replace the worktree-bridge block (`agent-scaffold.ts:397-471`, from the `// Per-runtime bridge files` comment through the codex block) with:

```typescript
	// External brain (loaded at launch via flags — never written into the repo).
	const contextDir = getAgentContextDir(agentId);
	mkdirSync(contextDir, { recursive: true });
	const reflectHookPath = join(agentHome, "reflect-on-stop.mjs");
	writeIfEmpty(reflectHookPath, reflectHookScript(agentHome, resolvedUserName));
	writeIfEmpty(join(contextDir, "CLAUDE.md"), sub(CONTEXT_CLAUDE_MD, vars));
	writeIfEmpty(getAgentPersonaPath(agentId), sub(PERSONA_TXT, vars));
	writeIfEmpty(
		getAgentSettingsPath(agentId),
		`${JSON.stringify(
			{
				autoMemoryDirectory: memoryDir,
				autoMemoryEnabled: true,
				// Pre-authorize the external @imports so the "allow external
				// CLAUDE.md imports?" prompt never fires for a launched agent.
				permissions: { additionalDirectories: [agentHome] },
				hooks: {
					Stop: [
						{
							matcher: "*",
							hooks: [
								{ type: "command", command: `node ${JSON.stringify(reflectHookPath)}`, timeout: 120 },
							],
						},
					],
				},
			},
			null,
			2,
		)}\n`,
	);
	writeIfEmpty(getAgentMcpPath(agentId), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);

	// Per-agent skills must be discoverable by Claude Code (it can't load skills by
	// flag): symlink <agent-home>/skills into <worktree>/.claude/skills. Skipped for
	// `external` agents whose worktree is a real repo AND we must not write into it —
	// instead, for those, the symlink lives under a git-excluded .claude/skills that
	// we add to .git/info/exclude (below).
	const claudeDir = join(worktreePath, ".claude");
	mkdirSync(claudeDir, { recursive: true });
	const skillsLink = join(claudeDir, "skills");
	if (!existsSync(skillsLink)) {
		try { symlinkSync(skillsDir, skillsLink, "dir"); } catch { /* best-effort */ }
	}

	// For real-repo (external) agents, keep the ONE thing we add (.claude/skills
	// symlink) out of the repo via .git/info/exclude — never a tracked file.
	if (existsSync(join(worktreePath, ".git"))) {
		const infoDir = join(worktreePath, ".git", "info");
		mkdirSync(infoDir, { recursive: true });
		const excludePath = join(infoDir, "exclude");
		const marker = "# ADE agent skills symlink (generated, not committed)";
		const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
		if (!existing.includes(marker)) {
			appendFileSync(excludePath, `\n${marker}\n.claude/skills\n`, "utf8");
		}
	}

	// Non-external (isolated init/clone) agents keep the legacy in-worktree bridge
	// for parity with the old behavior.
	if (!external) {
		writeIfEmpty(join(worktreePath, "CLAUDE.md"), sub(CLAUDE_BRIDGE, vars));
		writeIfEmpty(join(claudeDir, "reflect-on-stop.mjs"), reflectHookScript(agentHome, resolvedUserName));
		writeIfEmpty(join(claudeDir, "settings.json"), readFileSync(getAgentSettingsPath(agentId), "utf8"));
		if (runtime === "codex") regenerateCodexAgentsMd(agentId);
	}
```

Add `symlinkSync` to the `node:fs` import at the top of the file.

- [ ] **Step 5: Run — verify pass** (external test + the existing scaffold suite)

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts`
Expected: PASS — the new external test passes and pre-existing scaffold tests still pass (adjust any pre-existing assertion that expected an in-worktree `CLAUDE.md` for a default/non-external agent — those still get it).

- [ ] **Step 6: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/agent-scaffold.ts apps/desktop/src/main/lib/agent-scaffold.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2A): relocate agent bridge to external brain; skills symlink"
```

---

### Task 4: Per-agent launch-command builder (main process)

Build the runtime launch command per-agent from the external brain paths, in the main process (where `~/.ade` resolves). For `claude`, emit the verified flag recipe; other runtimes keep their preset for now.

**Files:**
- Create: `apps/desktop/src/main/lib/agent-launch.ts`
- Test: `apps/desktop/src/main/lib/agent-launch.test.ts`

**Interfaces:**
- Produces: `buildAgentLaunchCommand(agentId: string, runtime: AgentRuntime): string[]`. For `claude`: one command string wiring `--settings`/`--append-system-prompt-file`/`--add-dir`/`--mcp-config --strict-mcp-config` + the env var + the Opus-1M model + `--dangerously-skip-permissions`. Non-claude runtimes return `AGENT_PRESET_COMMANDS[runtime]` unchanged.

- [ ] **Step 1: Write failing test**

Create `apps/desktop/src/main/lib/agent-launch.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — verify fail**

Run: `cd apps/desktop && bun test src/main/lib/agent-launch.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `agent-launch.ts`**

```typescript
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
```

- [ ] **Step 4: Run — verify pass**

Run: `cd apps/desktop && bun test src/main/lib/agent-launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/agent-launch.ts apps/desktop/src/main/lib/agent-launch.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2A): per-agent launch-command builder"
```

---

### Task 5: Expose the launch via tRPC and consume it in `useAgentSession`

The renderer builds the session preset but the brain paths are main-process paths. Add a tRPC query that returns the per-agent launch (`cwd` + `commands`), and have `useAgentSession` use it.

**Files:**
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/…` (add `getAgentLaunch` query)
- Modify: `apps/desktop/src/renderer/stores/tabs/useAgentSession.ts:37-45`

**Interfaces:**
- Consumes: `buildAgentLaunchCommand` (Task 4), `getAgentWorktreePath`/resolved worktree.
- Produces: tRPC `workspaces.getAgentLaunch({ id }) → { cwd: string; commands: string[] }`.

- [ ] **Step 1: Add the tRPC query**

In the workspaces router (follow the file's existing `publicProcedure.query` pattern; import `buildAgentLaunchCommand` and the worktree resolver):

```typescript
getAgentLaunch: publicProcedure
	.input(z.object({ id: z.string() }))
	.query(({ input }) => {
		const ws = localDb.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
		if (!ws?.runtime) throw new Error(`Agent ${input.id} has no runtime`);
		const worktree = ws.worktreeId
			? localDb.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get()
			: null;
		return {
			cwd: worktree?.path ?? getAgentWorktreePath(input.id),
			commands: buildAgentLaunchCommand(input.id, ws.runtime),
		};
	}),
```

- [ ] **Step 2: Consume it in `useAgentSession`**

Replace the preset construction in `useAgentSession.ts:37-45`. Fetch the launch via the tRPC util before opening the preset:

```typescript
const utils = electronTrpc.useUtils();
// …inside spawnAgentSession, replace the static preset block:
const launch = await utils.workspaces.getAgentLaunch.fetch({ id });
const preset: TerminalPreset = {
	id: `agent-${runtime}`,
	name: AGENT_LABELS[runtime] ?? runtime,
	cwd: launch.cwd,
	commands: launch.commands,
	executionMode: "new-tab",
};
return openPreset(id, preset, { target: "new-tab" });
```

(Make `spawnAgentSession` async; update its callers to await/handle the promise. Keep the no-runtime plain-shell fallback unchanged.)

- [ ] **Step 3: Verify (typecheck + main-process unit coverage)**

Run: `cd apps/desktop && bun run typecheck`
Expected: clean. (The launch string itself is unit-tested in Task 4; the end-to-end "session opens with brain injected" is a human GUI smoke-test — see Task 7.)

- [ ] **Step 4: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/lib/trpc/routers/workspaces apps/desktop/src/renderer/stores/tabs/useAgentSession.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2A): per-agent launch over tRPC; useAgentSession consumes it"
```

---

### Task 6: Seeder — per-agent workspace modes + Foreman (11 agents)

Extend the roster to 11 (add Foreman) and give each agent its workspace `source` (linked-worktree / direct / init). Thread the mode through `beginAgentInit` (already carries `source`).

**Files:**
- Modify: `apps/desktop/src/main/lib/seed-cockpit.ts`
- Test: extend `apps/desktop/src/main/lib/seed-cockpit.test.ts`

**Interfaces:**
- Consumes: `AgentRepoSource` (Task 1). Each seeded agent's `ctx.source` is its mode.

- [ ] **Step 1: Update tests** (expect 11 agents; Foreman present; a linked agent carries a repoPath)

In `seed-cockpit.test.ts`, change the count assertions to `11` agents / `5` teams, and add:

```typescript
	it("adds Foreman under HLD Ops as a linked-worktree agent", () => {
		const rows = localDb.select().from(workspaces).all();
		const foreman = rows.find((w) => w.name.includes("Foreman"));
		expect(foreman).toBeDefined();
	});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd apps/desktop && bun test src/main/lib/seed-cockpit.test.ts`
Expected: FAIL — count is 10, no Foreman.

- [ ] **Step 3: Update `SEED_TEAMS` with modes + Foreman**

Replace the `SEED_TEAMS` data and give each agent a `source`. Example shape (repo paths resolved via `os.homedir()`):

```typescript
import { homedir } from "node:os";
const CODE = (r: string) => join(homedir(), "Code", r);
const VAULT = join(homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026");

const SEED_TEAMS = [
	{ name: "HLD Ops", color: "#E11D48", agents: [
		{ name: "Shopify / Store Cockpit", source: { type: "linked-worktree", repoPath: CODE("ShopifyStore"), branch: "ade/shopify" } },
		{ name: "Storefront Support",      source: { type: "linked-worktree", repoPath: CODE("handlaneultimate"), branch: "ade/storefront" } },
		{ name: "RubyPulse / Laser",       source: { type: "linked-worktree", repoPath: CODE("rubypulse"), branch: "ade/rubypulse" } },
		{ name: "Foreman / Listings",      source: { type: "linked-worktree", repoPath: CODE("hld-admin"), branch: "ade/foreman" } },
	]},
	{ name: "Hand Lane AI", color: "#7C3AED", agents: [
		{ name: "Consulting", source: { type: "init" } },
		{ name: "SaaS Build", source: { type: "init" } },
	]},
	{ name: "Content / YouTube", color: "#EA580C", agents: [
		{ name: "Script Writer", source: { type: "direct", path: VAULT } },
		{ name: "Clip Scout",    source: { type: "direct", path: VAULT } },
	]},
	{ name: "Trading", color: "#16A34A", agents: [
		{ name: "Kalshi BTC / Tessa", source: { type: "linked-worktree", repoPath: CODE("kalshi-btc-lab"), branch: "ade/tessa" } },
	]},
	{ name: "Personal / RLOS", color: "#2563EB", agents: [
		{ name: "Daily Planner",       source: { type: "direct", path: VAULT } },
		{ name: "Code HQ / Portfolio", source: { type: "linked-worktree", repoPath: CODE(".codehq"), branch: "ade/codehq" } },
	]},
];
```

Update the seeding loop so each agent's `ctx.source` is its `agent.source` (instead of a hardcoded `{type:"init"}`), and pass `external: true` to scaffolding for `linked-worktree`/`direct` agents (threaded via `agent-init` → `scaffoldAgentMemory`). Guard: if a `linked-worktree` `repoPath` does not exist on disk, fall back to `{type:"init"}` and log — a missing repo must not brick the seed.

- [ ] **Step 4: Run — verify pass**

Run: `cd apps/desktop && bun test src/main/lib/seed-cockpit.test.ts`
Expected: PASS — 11 agents, 5 teams, Foreman present.

- [ ] **Step 5: Thread `external` + `source` through init**

In `agent-init.ts` (`runAgentInit` → `scaffoldAgentMemory` call, ~line 122-136), pass `external: ctx.source.type === "linked-worktree" || ctx.source.type === "direct"` and the resolved worktree path. Confirm `bun run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/seed-cockpit.ts apps/desktop/src/main/lib/seed-cockpit.test.ts apps/desktop/src/main/lib/agent-init.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2A): seed 11 agents with per-agent workspace modes (+Foreman)"
```

---

### Task 7: Integration verification (human-run, re-seed)

**Files:** none (verification).

- [ ] **Step 1: Back up and re-seed**

```bash
mv ~/.ade ~/.ade.bak 2>/dev/null; mv ~/.ade-default ~/.ade-default.bak 2>/dev/null || true
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```
Expected: 5 teams / **11** agents seeded (Foreman under HLD Ops).

- [ ] **Step 2: Verify a linked agent works on the real repo, safely**

Open "Shopify / Store Cockpit". Expected: session opens on Opus 1M in a worktree of `~/Code/ShopifyStore`, on branch `ade/shopify` (`git -C <worktree> branch --show-current`). Confirm **no `CLAUDE.md`/`.claude/settings.json` was written into `~/Code/ShopifyStore`** (`git -C ~/Code/ShopifyStore status` is clean), and the "allow external imports?" prompt does NOT appear.

- [ ] **Step 3: Verify a direct (vault) agent**

Open "Daily Planner". Expected: cwd is the vault; no worktree/branch created; brain injected.

- [ ] **Step 4: Restore if needed**

If anything is off, `mv ~/.ade.bak ~/.ade` to roll back and report which step failed.

---

## Self-review notes
- Memory-safety preserved (`writeIfEmpty` retained for `memory/*`).
- The only file added to a real repo is a git-excluded `.claude/skills` symlink (never tracked); Step 2 of Task 7 verifies the repo stays clean.
- Brain *content* is generic here; Phase 2B (brain-author skill + manifests) fills `context/CLAUDE.md`, `persona.txt`, `mcp.json`, and `skills/`.

## Out of scope (Phase 2B / later)
Authored brain content, the brain-author skill + manifests, curated MCP servers per agent, deep inter-agent collaboration, vault memory mirror.
