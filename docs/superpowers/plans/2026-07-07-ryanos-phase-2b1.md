# RyanOS Phase 2B-1 Implementation Plan — Import-Safe Brain Composition

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make agent launches fully non-interactive (kill the external-import prompt) and lock the file contract the brains are authored into — by giving each brain layer its own native launch channel with **no cross-directory `@`-import**.

**Architecture:** In `agent-scaffold.ts`: make `context/CLAUDE.md` self-contained (drop the `@`-imports of `memory/AGENT.md`/`USER.md`), expand `persona.txt` into a Profile+Contract doc (loaded via `--append-system-prompt-file`), retarget the write-back protocol + reflection hook to `MEMORY.md` + `skills/` only, and fix `direct` (vault) agents so their skills don't pollute the vault root. Brain *content* stays generic; Phase 2B-2 authors it.

**Tech Stack:** Electron main, `bun:test`.

## Global Constraints

- **No cross-dir `@`-import** in any file an external agent loads → the workspace-trust prompt must not fire.
- **Authored vs learned split:** the loaded brain = `persona.txt` (Profile+Contract) + `context/CLAUDE.md` (Knowledge) + `MEMORY.md` (learned, auto-memory). Write-back targets ONLY `MEMORY.md` + `skills/`.
- **Preserve the legacy `!external` path** (isolated init/clone agents keep their in-worktree bridge) so pre-existing scaffold tests pass.
- **Memory-safe:** never clobber a non-empty `MEMORY.md`.
- `persona.txt` stays under ~1K chars (the `--append-system-prompt-file` practical limit).
- Bun; commit to `main` (prefix `BRAYNEE_ALLOW_MAIN_COMMITS=1`); no GUI launch in subagents.

---

### Task 1: Import-safe `context/CLAUDE.md` + Profile/Contract `persona.txt`

Drop the cross-dir `@`-imports and move the Profile into `persona.txt`. Remove the misleading `permissions.additionalDirectories` block (it never suppressed the prompt).

**Files:**
- Modify: `apps/desktop/src/main/lib/agent-scaffold.ts` (`CONTEXT_CLAUDE_MD` :340-346, `PERSONA_TXT` :348, external `settings.json` :483-510)
- Test: extend `apps/desktop/src/main/lib/agent-scaffold.test.ts`

- [ ] **Step 1: Write failing tests** (append to the external-brain describe block)

```typescript
describe("scaffoldAgentMemory — import-safe composition (2B-1)", () => {
	it("context/CLAUDE.md has NO cross-dir @-import", async () => {
		const home = await import("./agent-home");
		const { scaffoldAgentMemory } = await import("./agent-scaffold");
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const agentId = "agent-nocdimport";
		const wt = join(process.env.ADE_HOME_DIR as string, "wt-nocd");
		(await import("node:fs")).mkdirSync(wt, { recursive: true });
		scaffoldAgentMemory({ agentId, agentName: "NoCD", runtime: "claude", userName: "Pat", worktreePath: wt, external: true });
		const ctx = readFileSync(join(home.getAgentContextDir(agentId), "CLAUDE.md"), "utf8");
		expect(ctx).not.toContain("@"); // no @-imports at all
	});
	it("persona.txt carries a Profile and a Contract section", async () => {
		const home = await import("./agent-home");
		const { readFileSync } = await import("node:fs");
		const persona = readFileSync(home.getAgentPersonaPath("agent-nocdimport"), "utf8");
		expect(persona).toContain("Profile");
		expect(persona).toContain("Contract");
		expect(persona.length).toBeLessThan(1024); // --append-system-prompt-file limit
	});
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts -t "import-safe"`
Expected: FAIL — current `CONTEXT_CLAUDE_MD` starts with `@...`, persona.txt is a one-liner.

- [ ] **Step 3: Rewrite the two templates**

In `agent-scaffold.ts`, replace `CONTEXT_CLAUDE_MD` (:340-346) with:

```typescript
// Knowledge doc, loaded via --add-dir. SELF-CONTAINED — no cross-dir @-import
// (those trip Claude Code's external-import trust prompt). The brain-author skill
// (Phase 2B-2) fills these with POINTERS to the vault SSOT + repo docs, not copies.
const CONTEXT_CLAUDE_MD = `# {{agent_name}} — Knowledge

## Domain
- (What this agent must know about its domain. Filled by the brain-author skill;
  point at the single source of truth, do not copy it.)

## Sources of truth
- (e.g. vault notes, repo docs — filled by the brain-author skill.)
`;
```

Replace `PERSONA_TXT` (:348) with a Profile+Contract default (loaded via `--append-system-prompt-file`):

```typescript
// Profile + Contract, injected via --append-system-prompt-file (a system-prompt
// append, NOT an import — never prompts). Kept under ~1K chars. The brain-author
// skill (2B-2) replaces this with an agent-specific persona; this is the default.
const PERSONA_TXT = `You are {{agent_name}}, a specialist agent for {{user_name}}.

## Profile
- Direct, precise, proactive. You prize being genuinely useful over being verbose,
  and you admit uncertainty. (The brain-author skill refines this per agent.)

## Contract
- Work only within your assigned workspace. Prefer small, verifiable changes and
  run the project's checks before declaring done.
- Drive: propose next actions rather than waiting to be told.
- Never write secrets. Never take irreversible or production-affecting actions
  without explicit confirmation. (Per-agent always/never rules filled by 2B-2.)

## Memory
- Keep your persistent memory (MEMORY.md, loaded automatically) current — save
  learned preferences, facts, and lessons there, and turn reusable procedures into
  skills. Do this proactively, not only when asked.
`;
```

In the external `settings.json` object (:483-510), REMOVE the `permissions` block (the comment + `permissions: { additionalDirectories: [agentHome] }`) — it never suppressed the prompt and is now unnecessary (no cross-dir import remains). Keep `autoMemoryDirectory`, `autoMemoryEnabled`, and the `Stop` hook.

- [ ] **Step 4: Run — verify pass** (new tests + full pre-existing suite)

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts`
Expected: PASS. If a pre-existing test asserted the old `@`-import content of `context/CLAUDE.md`, update it to the new self-contained shape (that assertion is now wrong by design — document it).

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/agent-scaffold.ts apps/desktop/src/main/lib/agent-scaffold.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-1): import-safe brain composition (persona Profile+Contract, self-contained context)"
```

---

### Task 2: Retarget the write-back protocol to MEMORY.md + skills

The Profile now lives in `persona.txt` and User facts collapse into `MEMORY.md`, so the write-back protocol and the reflection hook must stop naming `USER.md`/`AGENT.md` as edit targets and point learning at `MEMORY.md` + `skills/`.

**Files:**
- Modify: `apps/desktop/src/main/lib/agent-scaffold.ts` (`WRITEBACK_PROTOCOL` :206-329, `reflectHookScript` reason :357+)
- Test: extend `agent-scaffold.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("scaffoldAgentMemory — write-back retarget (2B-1)", () => {
	it("write-back protocol targets MEMORY.md + skills, not USER.md/AGENT.md", async () => {
		const home = await import("./agent-home");
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const p = readFileSync(join(home.getAgentMemoryDir("agent-nocdimport"), ".writeback-protocol.md"), "utf8");
		expect(p).toContain("MEMORY.md");
		expect(p).toContain("skills");
		expect(p).not.toContain("USER.md");
	});
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts -t "write-back retarget"`
Expected: FAIL — current protocol names USER.md.

- [ ] **Step 3: Edit `WRITEBACK_PROTOCOL`**

In `agent-scaffold.ts` `WRITEBACK_PROTOCOL` (:206-329): replace the "three memory files" framing and the per-file routing so that:
- Learned preferences about {{user_name}}, stable environment/stack/convention facts, and lessons → **`MEMORY.md`** (one learned file; keep the WHEN/SKIP/consolidation rules and the target size guidance for MEMORY.md).
- Reusable procedures / class-of-task corrections → **`skills/`**.
- Remove the bullets that route to `USER.md` and describe editing `AGENT.md` (Profile is now authored in `persona.txt`, which the agent does not self-edit).

Keep everything else (the SKILL section, session-end reflection, the "do NOT capture" list). Ensure the file still references `{{agent_home}}/memory/MEMORY.md` and `{{agent_home}}/skills/`.

- [ ] **Step 4: Edit the reflection hook reason**

In `reflectHookScript` (:357+), update the `reason` string: drop "Save durable preferences/facts about {{user}} to USER.md"; make it "Save durable preferences, facts, and lessons to MEMORY.md, and embed any reusable procedure or style/format/workflow correction as a skill under {{agentHome}}/skills/." Keep the "do NOT capture environment-dependent failures…" guidance and the `stop_hook_active` guard.

- [ ] **Step 5: Run — verify pass**

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts`
Expected: PASS (new retarget test + full suite; update any pre-existing assertion that checked the old USER.md wording, documenting why).

- [ ] **Step 6: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/agent-scaffold.ts apps/desktop/src/main/lib/agent-scaffold.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-1): retarget write-back to MEMORY.md + skills"
```

---

### Task 3: direct-vault skills fix (no vault-root pollution)

`direct` agents (Daily Planner, Clip Scout, Script Writer) share the vault as cwd, so the current `worktree/.claude/skills` symlink lands in the vault root and the three collide on one link. For `direct` agents, put per-agent skills under `~/.claude/skills/ryanos-<agentId>/` instead, and skip the cwd symlink.

**Files:**
- Modify: `apps/desktop/src/main/lib/agent-scaffold.ts` (`ScaffoldParams` + the skills-symlink block :513-534)
- Modify: `apps/desktop/src/main/lib/agent-init.ts` (pass the flag)
- Test: extend `agent-scaffold.test.ts`

**Interfaces:**
- `ScaffoldParams` gains `directCwd?: boolean`. When true, the scaffold symlinks `skills/` into `~/.claude/skills/ryanos-<agentId>` and does NOT create `<cwd>/.claude/skills` or touch the cwd's `.git`.

- [ ] **Step 1: Write failing test**

```typescript
describe("scaffoldAgentMemory — direct agent skills (2B-1)", () => {
	it("does not write .claude/skills into a direct agent's cwd", async () => {
		const { scaffoldAgentMemory } = await import("./agent-scaffold");
		const { existsSync, mkdirSync } = await import("node:fs");
		const { join } = await import("node:path");
		const cwd = join(process.env.ADE_HOME_DIR as string, "fake-vault");
		mkdirSync(cwd, { recursive: true });
		scaffoldAgentMemory({ agentId: "agent-direct-skills", agentName: "Planner", runtime: "claude", userName: "Pat", worktreePath: cwd, external: true, directCwd: true });
		expect(existsSync(join(cwd, ".claude", "skills"))).toBe(false); // vault root not polluted
	});
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts -t "direct agent skills"`
Expected: FAIL — the current code plants `<cwd>/.claude/skills`.

- [ ] **Step 3: Add `directCwd` handling**

Add `directCwd?: boolean` to `ScaffoldParams`. Import `homedir` from `node:os`. In the skills block (`agent-scaffold.ts:513-534`), branch:

```typescript
	if (directCwd) {
		// Direct agents share a real dir (e.g. the vault) as cwd — never write
		// .claude/skills into it. Give them a namespaced global skills dir instead.
		const globalSkills = join(homedir(), ".claude", "skills", `ryanos-${agentId}`);
		mkdirSync(join(homedir(), ".claude", "skills"), { recursive: true });
		if (!existsSync(globalSkills)) {
			try { symlinkSync(skillsDir, globalSkills, "dir"); } catch { /* best-effort */ }
		}
	} else {
		// Linked/isolated worktree: git-excluded .claude/skills symlink (as today).
		const skillsMarker = "# ADE agent skills symlink (generated, not committed)";
		writeGitExclude(worktreePath, skillsMarker, ".claude/skills");
		const claudeDir = join(worktreePath, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		const skillsLink = join(claudeDir, "skills");
		if (!existsSync(skillsLink)) {
			try { symlinkSync(skillsDir, skillsLink, "dir"); } catch { /* best-effort */ }
		}
	}
```

Note: the `claudeDir` used later by the legacy `!external` block must still be defined for that path — keep a `const claudeDir = join(worktreePath, ".claude")` available to the `!external` block (it only runs for non-external agents, which are never `directCwd`).

- [ ] **Step 4: Pass the flag from init**

In `agent-init.ts` where `scaffoldAgentMemory(...)` is called, add `directCwd: ctx.source.type === "direct"`.

- [ ] **Step 5: Run — verify pass** + typecheck

Run: `cd apps/desktop && bun test src/main/lib/agent-scaffold.test.ts && bun run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
cd ~/Code/damon-ade
BRAYNEE_ALLOW_MAIN_COMMITS=1 git add apps/desktop/src/main/lib/agent-scaffold.ts apps/desktop/src/main/lib/agent-init.ts apps/desktop/src/main/lib/agent-scaffold.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-1): direct-vault agents use namespaced global skills (no vault pollution)"
```

---

### Task 4: Human verification — non-interactive launch

**Files:** none.

- [ ] **Step 1: Re-seed and launch**

```bash
mv ~/.ade ~/.ade.bak 2>/dev/null; mv ~/.ade-default ~/.ade-default.bak 2>/dev/null
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```

- [ ] **Step 2: Confirm no import prompt**

Open "Shopify / Store Cockpit". Expected: the Claude session starts **without** the "Allow external CLAUDE.md file imports?" prompt (the cross-dir import is gone). The agent boots with the Profile+Contract from `persona.txt` (it should introduce itself as a specialist, per the default persona) on a branch worktree of `~/Code/ShopifyStore`.

- [ ] **Step 3: Confirm no vault pollution**

Open "Daily Planner" (direct/vault). Expected: session opens with cwd = the vault; **no `.claude/skills` appears in the vault root** (`ls "<vault>/.claude" 2>/dev/null` — should not exist or not contain a ryanos skills link); per-agent skills live under `~/.claude/skills/ryanos-<id>`.

- [ ] **Step 4: Roll back if needed** — `mv ~/.ade.bak ~/.ade` and report which step failed.

---

## Out of scope (2B-2)
Authoring the actual brain content (the brain-author skill + 11 manifests + per-agent `persona.txt`/`context/CLAUDE.md`/`mcp.json`/`skills`). This plan only makes the composition import-safe and sets the file contract.
