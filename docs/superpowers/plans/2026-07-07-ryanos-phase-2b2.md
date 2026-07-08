# RyanOS Phase 2B-2 — Superagent Brains + Brain-Author Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 9 sourced RyanOS agents into domain-expert superagents by building a repeatable `brain-author` skill + per-agent manifests, wiring the scaffold to install authored brains from seed assets, then authoring + installing each brain seeded from Ryan's vault/repos/Hermes.

**Architecture:** Each agent's brain is four authored files under `assets/seed-brains/<slug>/brain/` (`persona.txt` = Profile+Contract, `context/CLAUDE.md` = Knowledge pointers, `mcp.json` = curated tools, `skills/` = starter skills). A new Electron-aware resolver maps the agent name → slug → authored-brain dir and passes it into the (still Electron-free) `scaffoldAgentMemory`, which installs authored content in place of the generic templates via the existing `writeIfEmpty` path. The `brain-author` in-repo skill drafts those files from QMD/vault/repo/Hermes sources. Greenfield agents (Consulting, SaaS Build) are deferred this pass.

**Tech Stack:** TypeScript (Electron main process, Bun test runtime), `better-sqlite3` (mocked in tests via `bunfig.toml`), Claude Code skills (agentskills.io SKILL.md format), YAML manifests, QMD vault search.

## Global Constraints

- **Commit discipline:** commit direct to `main`, every commit prefixed `BRAYNEE_ALLOW_MAIN_COMMITS=1`; push to `origin` (Ryan's fork `naquin316/damon-ade`). Actions are disabled on the fork.
- **Authored vs learned invariant (never violate):** the scaffold + brain-author install overwrite ONLY `persona.txt` / `context/CLAUDE.md` / `mcp.json` (and *add* to `skills/`). They MUST NEVER write, truncate, or delete `MEMORY.md` or existing `skills/` entries. Re-authoring is always memory-safe.
- **Point, don't copy:** `context/CLAUDE.md` holds POINTERS to the vault SSOT + repo docs — never copied prose that rots. The brain-author skill must verify each cited vault note exists (QMD) before citing it; a dead pointer is worse than none.
- **persona.txt budget:** keep Profile+Contract under ~1,000 chars (practical `--append-system-prompt-file` limit). Overflow domain detail into `context/CLAUDE.md`.
- **No cross-dir `@`-imports** anywhere in `context/CLAUDE.md` (they trip Claude Code's external-import trust prompt — the exact thing 2B-1 engineered out).
- **Scaffold stays Electron-free:** `agent-scaffold.ts` must not import `electron`. Any app-path resolution happens in the caller (`agent-init.ts` / `seed-brains.ts`) and is passed in as a param.
- **Vault searches use QMD**, never filesystem grep/find (a hook blocks vault-path shell search). `node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "terms"`.
- **Deferred greenfield:** do NOT author Consulting or SaaS Build this pass. They keep the generic template brain (no seed asset → resolver returns null → template path). No faked depth.

## File Structure

**New files:**
- `apps/desktop/src/main/lib/seed-brains.ts` — name→slug map, seed-brains root resolver, authored-brain-dir lookup. Electron-aware (may read `app.getAppPath()`); called by `agent-init.ts`.
- `apps/desktop/src/main/lib/seed-brains.test.ts` — unit tests for the map + resolver + lookup.
- `.claude/skills/brain-author/SKILL.md` — the in-repo authoring skill (agentskills.io format).
- `.claude/skills/brain-author/references/manifest-schema.md` — manifest field reference.
- `.claude/skills/brain-author/references/acceptance-checklist.md` — per-brain review gate.
- `assets/seed-brains/<slug>/manifest.yaml` — one per authored agent (9 total).
- `assets/seed-brains/<slug>/brain/{persona.txt, context/CLAUDE.md, mcp.json, skills/...}` — authored brain (produced by the skill, committed as assets).

**Modified files:**
- `apps/desktop/src/main/lib/agent-scaffold.ts` — add `authoredBrainDir?` to `ScaffoldParams`; when set + populated, source `persona.txt` / `context/CLAUDE.md` / `mcp.json` / `skills/*` from it instead of the in-code templates (still `writeIfEmpty`).
- `apps/desktop/src/main/lib/agent-scaffold.test.ts` — cover the authored-brain install path + the MEMORY.md-safety assertion.
- `apps/desktop/src/main/lib/agent-init.ts:128` — derive slug from `ctx.agentName`, resolve `authoredBrainDir`, pass it through.
- `apps/desktop/src/main/lib/agent-memory-backfill.ts:67` — pass `authoredBrainDir` through too (so a fresh-home relaunch also brains; a non-empty existing file is preserved by `writeIfEmpty`).
- `apps/desktop/electron-builder` config (locate: `apps/desktop/package.json` `build` block or `electron-builder.*`) — include `assets/seed-brains/**` in the packaged app so the built DMG can resolve authored brains.

---

## Task 0: Pre-flight — finish 2B-1 (clean stale pollution + human smoke gate)

**Files:** none committed (cleanup + human verification).

- [ ] **Step 1: Remove the stale pre-patch vault-root skills symlink**

A direct-vault agent set up *before* the 2B-1 namespacing fix left a symlink polluting the vault root. Its target agent id (`0792bbb4…`) is NOT in the current roster. It is a symlink (safe to remove).

Run:
```bash
ls -l "/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/.claude/skills"
# confirm it is a symlink into ~/.ade/agents/0792bbb4.../skills, then:
rm "/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/.claude/skills"
```
Expected: `.claude/skills` gone from the vault root; `.claude/commands` and `.claude/settings.local.json` (Ryan's, unrelated) untouched.

- [ ] **Step 2: Human smoke gate for 2B-1 (Ryan runs the dev app)**

The running app is the pre-patch build. Ryan quits it, then:
```bash
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```
Click **Retry** on any failed agent. Confirm all three:
1. Opening Shopify shows **no "Allow external imports?" prompt**.
2. The agent boots as a specialist on branch **`ade/shopify-<id8>`** (the patched unique-branch format, NOT bare `ade/shopify`).
3. Daily Planner adds **no `.claude/skills`** to the vault root (only namespaced `~/.claude/skills/ryanos-<id>`).

Automated cross-checks (run after the app is up):
```bash
git -C ~/Code/ShopifyStore worktree list        # expect branch ade/shopify-<id8>
git -C ~/Code/ShopifyStore status --short        # expect clean
ls -d ~/.claude/skills/ryanos-* 2>/dev/null      # expect one per booted direct agent
```
Expected: all three pass. **This is a gate — do not start Task 1 until Ryan confirms.** (No commit; if any check fails, stop and fix 2B-1 first.)

---

## Task 1: Seed-brains resolver (`seed-brains.ts`)

**Files:**
- Create: `apps/desktop/src/main/lib/seed-brains.ts`
- Test: `apps/desktop/src/main/lib/seed-brains.test.ts`

**Interfaces:**
- Produces:
  - `AGENT_BRAIN_SLUGS: Record<string, string>` — agent display name → slug.
  - `slugForAgent(agentName: string): string | undefined` — map lookup (exact, then trimmed).
  - `resolveSeedBrainsRoot(): string` — `process.env.ADE_SEED_BRAINS_ROOT` → packaged resources path → repo-relative `assets/seed-brains` (dev).
  - `getAuthoredBrainDir(agentName: string): string | undefined` — returns `<root>/<slug>/brain` iff it exists AND contains a non-empty `persona.txt`, else `undefined`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/desktop/src/main/lib/seed-brains.test.ts
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AGENT_BRAIN_SLUGS, getAuthoredBrainDir, slugForAgent } from "./seed-brains";

const sandbox = join(tmpdir(), "ade-seed-brains-test");
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  delete process.env.ADE_SEED_BRAINS_ROOT;
});

describe("seed-brains", () => {
  it("maps every HLD Ops agent name to a slug", () => {
    expect(slugForAgent("Shopify / Store Cockpit")).toBe("shopify-store-cockpit");
    expect(slugForAgent("Storefront Support")).toBe("storefront-support");
    expect(slugForAgent("RubyPulse / Laser")).toBe("rubypulse-laser");
    expect(slugForAgent("Foreman / Listings")).toBe("foreman-listings");
  });

  it("returns undefined for a deferred greenfield agent", () => {
    expect(slugForAgent("Consulting")).toBeUndefined();
    expect(slugForAgent("SaaS Build")).toBeUndefined();
  });

  it("finds an authored brain only when persona.txt is present and non-empty", () => {
    process.env.ADE_SEED_BRAINS_ROOT = sandbox;
    const brainDir = join(sandbox, "shopify-store-cockpit", "brain");
    // no dir yet → undefined
    expect(getAuthoredBrainDir("Shopify / Store Cockpit")).toBeUndefined();
    // empty persona → still undefined
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, "persona.txt"), "   ");
    expect(getAuthoredBrainDir("Shopify / Store Cockpit")).toBeUndefined();
    // populated → returns the dir
    writeFileSync(join(brainDir, "persona.txt"), "You are Store Cockpit.");
    expect(getAuthoredBrainDir("Shopify / Store Cockpit")).toBe(brainDir);
  });

  it("has no slug entries for deferred agents (only the 9 sourced)", () => {
    expect(Object.keys(AGENT_BRAIN_SLUGS)).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/seed-brains.test.ts`
Expected: FAIL — `Cannot find module "./seed-brains"`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/desktop/src/main/lib/seed-brains.ts
import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Agent display name → seed-brain slug. ONLY the 9 sourced agents appear here.
 * Consulting + SaaS Build (greenfield) are deliberately absent → no authored
 * brain → the scaffold falls back to the generic template. Keep in sync with
 * seed-cockpit.ts agent names and assets/seed-brains/<slug>/.
 */
export const AGENT_BRAIN_SLUGS: Record<string, string> = {
  "Shopify / Store Cockpit": "shopify-store-cockpit",
  "Storefront Support": "storefront-support",
  "RubyPulse / Laser": "rubypulse-laser",
  "Foreman / Listings": "foreman-listings",
  "Script Writer": "script-writer",
  "Clip Scout": "clip-scout",
  "Kalshi BTC / Tessa": "kalshi-tessa",
  "Daily Planner": "daily-planner",
  "Code HQ / Portfolio": "codehq-portfolio",
};

export function slugForAgent(agentName: string): string | undefined {
  return AGENT_BRAIN_SLUGS[agentName] ?? AGENT_BRAIN_SLUGS[agentName.trim()];
}

/**
 * Root of the committed seed-brain assets. Order:
 *   1. ADE_SEED_BRAINS_ROOT (tests + explicit override)
 *   2. packaged app resources (<resourcesPath>/assets/seed-brains) when packaged
 *   3. repo-relative assets/seed-brains (dev: `bun run dev` from source)
 * `app` may be undefined in a non-Electron unit-test context; guard for it.
 */
export function resolveSeedBrainsRoot(): string {
  const override = process.env.ADE_SEED_BRAINS_ROOT;
  if (override) return override;
  try {
    if (app?.isPackaged) return join(process.resourcesPath, "assets", "seed-brains");
    if (app?.getAppPath) return join(app.getAppPath(), "assets", "seed-brains");
  } catch {
    /* not in an Electron context — fall through to repo-relative */
  }
  // Dev fallback: this file is apps/desktop/src/main/lib/seed-brains.ts →
  // repo root is five levels up; assets/ lives at the repo root.
  return join(__dirname, "..", "..", "..", "..", "..", "assets", "seed-brains");
}

/**
 * The authored brain dir for an agent, or undefined if none is installed.
 * "Installed" means the dir exists AND persona.txt is present and non-empty —
 * a half-written asset must not shadow the generic template.
 */
export function getAuthoredBrainDir(agentName: string): string | undefined {
  const slug = slugForAgent(agentName);
  if (!slug) return undefined;
  const brainDir = join(resolveSeedBrainsRoot(), slug, "brain");
  const persona = join(brainDir, "persona.txt");
  if (!existsSync(persona)) return undefined;
  if (readFileSync(persona, "utf8").trim().length === 0) return undefined;
  return brainDir;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/seed-brains.test.ts`
Expected: PASS (4 tests). Note: importing `electron` in a bun unit test is fine because the code only touches `app?.` optionally and the tests set `ADE_SEED_BRAINS_ROOT` so the `app` branch is never taken. If bun cannot resolve `electron` at import, add `mock.module("electron", () => ({ app: undefined }))` at the top of the test file.

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
git add apps/desktop/src/main/lib/seed-brains.ts apps/desktop/src/main/lib/seed-brains.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-2): seed-brains resolver (name→slug, authored-brain lookup)"
```

---

## Task 2: Scaffold installs authored brains

**Files:**
- Modify: `apps/desktop/src/main/lib/agent-scaffold.ts` (`ScaffoldParams` + `scaffoldAgentMemory`)
- Test: `apps/desktop/src/main/lib/agent-scaffold.test.ts`

**Interfaces:**
- Consumes: `authoredBrainDir?: string` (from `getAuthoredBrainDir`, Task 1).
- Produces: when `authoredBrainDir` is set + populated, `persona.txt` / `context/CLAUDE.md` / `mcp.json` are written from it (via `writeIfEmpty`), and every `skills/<name>/` under it is copied into the agent's skills dir (only if that skill name is absent — never overwrite a learned skill). `MEMORY.md` is never read or written by this path.

- [ ] **Step 1: Write the failing test**

Append to `agent-scaffold.test.ts` (reuses the file's existing tmp-home harness; if none, create a tmp `ADE_HOME_DIR` sandbox in the test):

```typescript
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// ... existing imports + tmp-home setup (ADE_HOME_DIR) ...

it("installs an authored brain from authoredBrainDir instead of the template", () => {
  const brainDir = join(sandbox, "authored", "brain");
  mkdirSync(join(brainDir, "context"), { recursive: true });
  mkdirSync(join(brainDir, "skills", "reindex-store"), { recursive: true });
  writeFileSync(join(brainDir, "persona.txt"), "You are Store Cockpit, HLD's operator.");
  writeFileSync(join(brainDir, "context", "CLAUDE.md"), "# Knowledge\n- SSOT: vault:hld-store-cockpit");
  writeFileSync(join(brainDir, "mcp.json"), JSON.stringify({ mcpServers: { shopify: {} } }));
  writeFileSync(join(brainDir, "skills", "reindex-store", "SKILL.md"), "---\nname: reindex-store\n---\n");

  const agentId = "authored-agent-1";
  scaffoldAgentMemory({
    agentId, agentName: "Shopify / Store Cockpit", runtime: "claude",
    userName: "Ryan", external: true, authoredBrainDir: brainDir,
  });

  expect(readFileSync(getAgentPersonaPath(agentId), "utf8")).toContain("HLD's operator");
  expect(readFileSync(join(getAgentContextDir(agentId), "CLAUDE.md"), "utf8")).toContain("vault:hld-store-cockpit");
  expect(JSON.parse(readFileSync(getAgentMcpPath(agentId), "utf8")).mcpServers.shopify).toBeDefined();
  expect(readFileSync(join(getAgentSkillsDir(agentId), "reindex-store", "SKILL.md"), "utf8")).toContain("reindex-store");
});

it("never writes MEMORY.md from the authored-brain path", () => {
  const brainDir = join(sandbox, "authored2", "brain");
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(brainDir, "persona.txt"), "persona");
  // Pre-seed a learned MEMORY.md and assert the scaffold leaves it verbatim.
  const agentId = "authored-agent-2";
  scaffoldAgentMemory({ agentId, agentName: "Shopify / Store Cockpit", runtime: "claude", external: true });
  const memPath = join(getAgentMemoryDir(agentId), "MEMORY.md");
  writeFileSync(memPath, "LEARNED: do not clobber me");
  scaffoldAgentMemory({ agentId, agentName: "Shopify / Store Cockpit", runtime: "claude", external: true, authoredBrainDir: brainDir });
  expect(readFileSync(memPath, "utf8")).toBe("LEARNED: do not clobber me");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/agent-scaffold.test.ts`
Expected: FAIL — `authoredBrainDir` not in `ScaffoldParams` / template content written instead of authored.

- [ ] **Step 3: Implement — add the param and the install branch**

In `ScaffoldParams` (after `directCwd`):
```typescript
	/**
	 * Absolute path to an authored brain dir (assets/seed-brains/<slug>/brain,
	 * resolved by getAuthoredBrainDir). When set + populated, persona.txt /
	 * context/CLAUDE.md / mcp.json are sourced from here instead of the in-code
	 * templates, and skills/* are copied in. NEVER touches MEMORY.md. Undefined
	 * (greenfield / unmapped agents) → the generic templates below are used.
	 */
	authoredBrainDir?: string;
```

Add a helper near `writeIfEmpty`:
```typescript
/** Read an authored brain file if present + non-empty, else undefined. */
function authoredFile(brainDir: string | undefined, rel: string): string | undefined {
	if (!brainDir) return undefined;
	const p = join(brainDir, rel);
	if (!existsSync(p)) return undefined;
	const body = readFileSync(p, "utf8");
	return body.trim().length > 0 ? body : undefined;
}
```

In `scaffoldAgentMemory`, destructure `authoredBrainDir` from params. Replace the three external-brain template writes:
```typescript
	writeIfEmpty(join(contextDir, "CLAUDE.md"),
		authoredFile(authoredBrainDir, "context/CLAUDE.md") ?? sub(CONTEXT_CLAUDE_MD, vars));
	writeIfEmpty(getAgentPersonaPath(agentId),
		authoredFile(authoredBrainDir, "persona.txt") ?? sub(PERSONA_TXT, vars));
	// ... existing settings.json write (unchanged) ...
	writeIfEmpty(getAgentMcpPath(agentId),
		authoredFile(authoredBrainDir, "mcp.json") ?? `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
```

After the skills-dir seed writes (`README.md` / `SKILL.template.md`), copy authored starter skills (add `cpSync` to the `node:fs` import):
```typescript
	// Authored starter skills: copy each skills/<name>/ that isn't already
	// present. `writeIfEmpty` semantics at the folder level — a learned skill of
	// the same name is never overwritten.
	if (authoredBrainDir) {
		const authoredSkills = join(authoredBrainDir, "skills");
		if (existsSync(authoredSkills)) {
			for (const entry of readdirSync(authoredSkills, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const dest = join(skillsDir, entry.name);
				if (existsSync(dest)) continue; // never clobber learned skills
				cpSync(join(authoredSkills, entry.name), dest, { recursive: true });
			}
		}
	}
```
(Add `cpSync` and `readdirSync` to the existing `node:fs` import block.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/agent-scaffold.test.ts`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 5: Wire the caller + backfill**

In `agent-init.ts` add the import and pass the resolved dir into the `scaffoldAgentMemory({...})` call at line ~128:
```typescript
import { getAuthoredBrainDir } from "./seed-brains";
// ...
				authoredBrainDir: getAuthoredBrainDir(ctx.agentName),
```
Mirror the same one-line addition in `agent-memory-backfill.ts` at its `scaffoldAgentMemory({...})` call (line ~67), deriving from the agent name it already has.

- [ ] **Step 6: Run the full main-lib suite**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib`
Expected: PASS (no regressions in seed-cockpit/agent-init/agent-scaffold tests).

- [ ] **Step 7: Commit**

```bash
cd ~/Code/damon-ade
git add apps/desktop/src/main/lib/agent-scaffold.ts apps/desktop/src/main/lib/agent-scaffold.test.ts apps/desktop/src/main/lib/agent-init.ts apps/desktop/src/main/lib/agent-memory-backfill.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-2): scaffold installs authored seed-brains (memory-safe)"
```

---

## Task 3: Package seed-brains into the built app

**Files:**
- Modify: `apps/desktop` electron-builder config (find it: `grep -rn '"build"' apps/desktop/package.json` or `ls apps/desktop/electron-builder.*`).

- [ ] **Step 1: Locate the electron-builder `files`/`extraResources` config**

Run: `cd ~/Code/damon-ade && grep -rn "extraResources\|\"files\"\|electron-builder" apps/desktop/package.json apps/desktop/electron-builder.* 2>/dev/null`
Expected: identifies the build config block.

- [ ] **Step 2: Add `assets/seed-brains` to the packaged resources**

Add an `extraResources` entry copying the repo `assets/seed-brains` to the app's `resources/assets/seed-brains` (matching `resolveSeedBrainsRoot`'s packaged path `join(process.resourcesPath, "assets", "seed-brains")`):
```jsonc
"extraResources": [
  { "from": "../../assets/seed-brains", "to": "assets/seed-brains" }
]
```
(Adjust `from` to the repo-root-relative path from the desktop package; verify with the existing config's other `from` paths.)

- [ ] **Step 3: Verify dev resolution still works (no build needed to test)**

Run:
```bash
cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/seed-brains.test.ts
```
Expected: PASS (dev/env resolution untouched). Packaged-path correctness is verified in Task 9's DMG relaunch, not here.

- [ ] **Step 4: Commit**

```bash
cd ~/Code/damon-ade
git add apps/desktop/package.json apps/desktop/electron-builder.* 2>/dev/null
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "build(2B-2): bundle seed-brains assets into the packaged app"
```

---

## Task 4: The `brain-author` skill

**Files:**
- Create: `.claude/skills/brain-author/SKILL.md`
- Create: `.claude/skills/brain-author/references/manifest-schema.md`
- Create: `.claude/skills/brain-author/references/acceptance-checklist.md`

**Interfaces:**
- Consumes: a manifest at `assets/seed-brains/<slug>/manifest.yaml` (Task 5).
- Produces: `assets/seed-brains/<slug>/brain/{persona.txt, context/CLAUDE.md, mcp.json, skills/}`, and optionally a live refresh of `~/.ade/agents/<id>/` for review.

- [ ] **Step 1: Write `references/manifest-schema.md`**

```markdown
# Brain manifest schema (assets/seed-brains/<slug>/manifest.yaml)

- `agent`            (string)  display name — MUST match seed-cockpit.ts exactly.
- `slug`             (string)  dir slug — MUST match AGENT_BRAIN_SLUGS in seed-brains.ts.
- `persona`          (map)     `name`, `voice`.
- `profile_from`     (list)    source refs → identity/voice. `vault:<slug>` | `repo:<path>` | `hermes:<name>` | `feedback:<slug>`.
- `contract_from`    (list)    source refs → always/never rules, safety boundaries.
- `knowledge_from`   (list)    source refs → the POINTERS in context/CLAUDE.md (never copied prose).
- `tools`            (list)    curated MCP server names for mcp.json.
- `autonomy`         (enum)    high | medium | low.
- `safety`           (list)    hard boundary lines, verbatim into the Contract.
- `starter_skills`   (list)    optional {name, purpose} for 1–2 seed skills.

Ref resolution:
- `vault:<slug>`  → QMD verify it exists, then cite as a pointer. Dead ref → OMIT + note in review.
- `repo:<path>`   → Read the file; cite the path as a pointer.
- `hermes:<name>` → locate the Hermes profile (see SKILL.md); cite as a pointer.
- `feedback:<slug>`/`brand rules` → fold into the Contract as always/never rules.
```

- [ ] **Step 2: Write `references/acceptance-checklist.md`**

```markdown
# Per-brain acceptance checklist (Ryan's review gate)

persona.txt (Profile + Contract):
- [ ] < ~1,000 chars; distinct voice matching manifest.persona.voice.
- [ ] Contract states autonomy level + verbatim safety boundaries.
- [ ] Roster awareness: names the agent's team + that it's one of RyanOS's agents.
- [ ] No secrets, no copied vault prose.

context/CLAUDE.md (Knowledge):
- [ ] POINTERS only (vault slugs / repo paths) — no copied bodies that rot.
- [ ] Every cited vault note verified to exist via QMD (no dead pointers).
- [ ] No cross-dir @-imports.

mcp.json:
- [ ] Only the curated tools from manifest.tools; valid JSON; no stray creds.

skills/:
- [ ] 0–2 starter skills, agentskills.io SKILL.md format, description ≤ 60 chars.

Safety:
- [ ] Nothing writes/deletes MEMORY.md or an existing learned skill.
```

- [ ] **Step 3: Write `SKILL.md`**

```markdown
---
name: brain-author
description: Author a RyanOS superagent brain from a seed-brain manifest.
version: 0.1.0
platforms: [macos]
metadata:
  ade:
    tags: [RyanOS, Authoring]
---

# Brain Author

Authors one RyanOS agent's brain (persona.txt + context/CLAUDE.md + mcp.json +
starter skills) into `assets/seed-brains/<slug>/brain/` from a manifest, seeded
from Ryan's vault (QMD), repo CLAUDE.md/STATUS.md, and Hermes profiles. Does NOT
touch MEMORY.md or learned skills — re-authoring is always memory-safe.

## When to Use
- "author the brain for <agent>", "brain-author <slug>", or a fan-out over the manifests.

## Prerequisites
- Manifest at `assets/seed-brains/<slug>/manifest.yaml` (see references/manifest-schema.md).
- QMD: `node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<terms>"`.

## Procedure
1. Read `assets/seed-brains/<slug>/manifest.yaml`.
2. Gather sources:
   - Each `vault:<slug>` → QMD `search`/`query`; VERIFY it exists. A dead ref is dropped and noted (never cite a note that isn't there).
   - Each `repo:<path>` → Read the file (CLAUDE.md / STATUS.md).
   - Each `hermes:<name>` → locate the profile (search `~/Code` and the vault via QMD for "Hermes <name> profile"); if absent, note it and proceed honestly.
3. Draft the four artifacts into `assets/seed-brains/<slug>/brain/`:
   - `persona.txt` — Profile+Contract, < ~1,000 chars, distinct voice, autonomy + verbatim safety lines, roster awareness. Overflow domain detail to context.
   - `context/CLAUDE.md` — Knowledge as POINTERS to the verified sources. No copied prose. No cross-dir @-imports.
   - `mcp.json` — `{ "mcpServers": { ... } }` for the manifest's curated tools only.
   - `skills/<name>/SKILL.md` — 0–2 starter skills (agentskills.io format).
4. Self-check against references/acceptance-checklist.md.
5. Human review (Ryan). On approval, optionally refresh the LIVE agent for a fast
   boot-test: find the live dir by matching the agent name, then overwrite ONLY
   persona.txt / context/CLAUDE.md / mcp.json and ADD skills — NEVER MEMORY.md:
   ```bash
   # find the live agent home by persona name match
   grep -l "You are <Agent Name>" ~/.ade/agents/*/persona.txt
   ```

## Pitfalls
- persona.txt overflow silently truncates the system prompt — keep it tight.
- Copied vault prose rots; always point at the SSOT slug.
- Never write MEMORY.md or clobber a learned skill dir (violates the core invariant).

## Verification
- `assets/seed-brains/<slug>/brain/persona.txt` exists, non-empty, < ~1,000 chars.
- Every vault pointer in context/CLAUDE.md resolves via QMD.
- `getAuthoredBrainDir("<Agent Name>")` (Task 1) returns the brain dir.
```

- [ ] **Step 4: Commit**

```bash
cd ~/Code/damon-ade
git add .claude/skills/brain-author
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-2): brain-author skill (manifest→brain, memory-safe)"
```

---

## Task 5: HLD Ops manifests (the pilot's 4)

**Files:**
- Create: `assets/seed-brains/shopify-store-cockpit/manifest.yaml`
- Create: `assets/seed-brains/storefront-support/manifest.yaml`
- Create: `assets/seed-brains/rubypulse-laser/manifest.yaml`
- Create: `assets/seed-brains/foreman-listings/manifest.yaml`

- [ ] **Step 1: Write the 4 manifests**

`shopify-store-cockpit/manifest.yaml`:
```yaml
agent: "Shopify / Store Cockpit"
slug: "shopify-store-cockpit"
persona: { name: "Store Cockpit", voice: "operator, terse, proactive" }
profile_from:  ["vault:hld-brand-facts", "vault:hld-store-cockpit"]
contract_from: ["feedback:shopify-admin-api-not-zapier", "brand rules"]
knowledge_from: ["repo:~/Code/ShopifyStore/CLAUDE.md", "vault:hld-store-cockpit"]
tools: ["shopify-admin-api", "supabase"]
autonomy: "high"
safety:
  - "HLD Shopify writes go through the custom Admin API app, NEVER Zapier."
  - "Never touch prod data without explicit confirmation."
starter_skills:
  - { name: "store-health-check", purpose: "read-only storefront + inventory sanity sweep" }
```

`storefront-support/manifest.yaml`:
```yaml
agent: "Storefront Support"
slug: "storefront-support"
persona: { name: "Concierge", voice: "warm, concise, customer-first" }
profile_from:  ["vault:project_storefront-chat-hitl", "vault:hld-brand-facts"]
contract_from: ["vault:handlaneultimate-fb-hitl", "brand rules"]
knowledge_from: ["repo:~/Code/handlaneultimate/CLAUDE.md", "vault:project_storefront-chat-hitl", "vault:handlaneultimate-fb-hitl"]
tools: ["supabase"]
autonomy: "medium"
safety:
  - "Draft→approve(Telegram)→send: never send a customer message unprompted."
  - "Supabase read for triage; never a prod write without confirmation."
  - "DATABASE_URL is PROD; never migrate/seed it."
```

`rubypulse-laser/manifest.yaml`:
```yaml
agent: "RubyPulse / Laser"
slug: "rubypulse-laser"
persona: { name: "RubyPulse", voice: "monitoring engineer, calm, precise" }
profile_from:  ["vault:project_rubypulse"]
contract_from: ["vault:reference_trotec-ruby-internals"]
knowledge_from: ["repo:~/Code/rubypulse/CLAUDE.md", "vault:project_rubypulse", "vault:reference_trotec-ruby-internals"]
tools: ["ssh-trotec-bridge"]
autonomy: "medium"
safety:
  - "Read-only analytics posture; the laser PC is production hardware."
  - "Reach the laser PC only via the ssh trotec bridge (ask-trotec)."
```

`foreman-listings/manifest.yaml`:
```yaml
agent: "Foreman / Listings"
slug: "foreman-listings"
persona: { name: "Foreman", voice: "factory lead, systematic, throughput-minded" }
profile_from:  ["vault:project-foreman-hld-admin", "vault:hld-brand-facts"]
contract_from: ["vault:hld-brand-facts", "brand rules"]
knowledge_from: ["repo:~/Code/hld-admin/CLAUDE.md", "vault:project-foreman-hld-admin"]
tools: ["shopify-admin-api", "cloudflare-d1", "cloudflare-r2"]
autonomy: "high"
safety:
  - "Customer-facing visuals + wording must match HLD brand facts (New Braunfels TX; hand-engraved)."
  - "Shopify writes via the Admin API app, never Zapier."
```

- [ ] **Step 2: Verify the cited vault slugs exist (QMD)**

Run (one per distinct slug):
```bash
Q="/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs"
for s in hld-brand-facts hld-store-cockpit project_storefront-chat-hitl handlaneultimate-fb-hitl project_rubypulse reference_trotec-ruby-internals project-foreman-hld-admin; do
  echo "== $s =="; node "$Q" search "$s" | head -3
done
```
Expected: each returns its note. Any miss → fix the manifest ref (correct slug or drop it) before authoring.

- [ ] **Step 3: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/shopify-store-cockpit assets/seed-brains/storefront-support assets/seed-brains/rubypulse-laser assets/seed-brains/foreman-listings
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-2): HLD Ops seed-brain manifests (pilot)"
```

---

## Task 6: Author the HLD Ops pilot (4 brains, fan-out)

**Files:** Create `assets/seed-brains/<slug>/brain/**` for the 4 HLD Ops slugs.

- [ ] **Step 1: Fan out 4 authoring passes**

Dispatch one `brain-author` invocation per HLD Ops agent (parallel subagents; disjoint output dirs = no collision). Each: read its manifest, gather sources (QMD + repo CLAUDE.md), draft the 4 artifacts into `assets/seed-brains/<slug>/brain/`. Do NOT install live yet.

- [ ] **Step 2: Verify each brain resolves**

Run:
```bash
cd ~/Code/damon-ade/apps/desktop
for name in "Shopify / Store Cockpit" "Storefront Support" "RubyPulse / Laser" "Foreman / Listings"; do
  bun -e "import('./src/main/lib/seed-brains.ts').then(m=>console.log('$name →', m.getAuthoredBrainDir('$name')))"
done
```
Expected: each prints a brain dir (not undefined). persona.txt each < ~1,000 chars (`wc -c`).

- [ ] **Step 3: Live-refresh the 4 for a fast boot test (memory-safe)**

For each, find the live agent home and overwrite ONLY persona/context/mcp, ADD skills, NEVER MEMORY.md:
```bash
for slug_name in "shopify-store-cockpit:Shopify / Store Cockpit" "storefront-support:Storefront Support" "rubypulse-laser:RubyPulse / Laser" "foreman-listings:Foreman / Listings"; do
  slug="${slug_name%%:*}"; nm="${slug_name#*:}"
  home="$(dirname "$(grep -l "You are $nm" ~/.ade/agents/*/persona.txt 2>/dev/null | head -1)")"
  [ -z "$home" ] && { echo "no live agent for $nm (will appear on re-seed)"; continue; }
  cp "assets/seed-brains/$slug/brain/persona.txt" "$home/persona.txt"
  cp "assets/seed-brains/$slug/brain/context/CLAUDE.md" "$home/context/CLAUDE.md"
  cp "assets/seed-brains/$slug/brain/mcp.json" "$home/mcp.json"
  cp -R "assets/seed-brains/$slug/brain/skills/." "$home/skills/" 2>/dev/null || true
  echo "refreshed $nm → $home"
done
```
Expected: 4 live homes refreshed (or noted as not-yet-seeded). `MEMORY.md` mtimes unchanged.

- [ ] **Step 4: Commit the pilot brains**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/shopify-store-cockpit/brain assets/seed-brains/storefront-support/brain assets/seed-brains/rubypulse-laser/brain assets/seed-brains/foreman-listings/brain
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-2): author HLD Ops pilot brains"
```

---

## Task 7: PILOT REVIEW GATE (Ryan)

**Files:** none (human gate).

- [ ] **Step 1: Ryan reviews the 4 pilot brains**

Against `references/acceptance-checklist.md`, and by relaunching the dev app and opening each HLD Ops agent: does it boot as a convincing specialist (right voice, right knowledge pointers, right safety lines, no import prompt)? Spot-check one live conversation per agent.

- [ ] **Step 2: Gate decision**

Ryan approves, or requests changes. **Do not start Task 8 until Ryan approves the pilot.** Fold any cross-cutting feedback (persona length, pointer style, tool curation) back into the `brain-author` skill so the remaining 5 inherit it.

---

## Task 8: Fan out the remaining 5 (manifests + brains)

**Files:** Create `assets/seed-brains/<slug>/{manifest.yaml, brain/**}` for: `script-writer`, `clip-scout`, `kalshi-tessa`, `daily-planner`, `codehq-portfolio`.

**Interfaces:** identical procedure to Tasks 5–6; per-agent manifest content below. Tessa is the sensitive one (paper-only, risk-gated).

- [ ] **Step 1: Write the 5 manifests**

`script-writer/manifest.yaml`:
```yaml
agent: "Script Writer"
slug: "script-writer"
persona: { name: "Scribe", voice: "Ryan's YouTube voice, punchy, story-first" }
profile_from:  ["vault:Obsidian User"]
contract_from: ["brand rules"]
knowledge_from: ["vault:Obsidian User"]  # + QMD: Ryan voice/content/script notes
tools: ["vault"]
autonomy: "high"
safety: ["Match Ryan's established content voice; no invented facts about HLD."]
starter_skills:
  - { name: "script-outline", purpose: "hook→beats→CTA outline from a topic" }
```

`clip-scout/manifest.yaml`:
```yaml
agent: "Clip Scout"
slug: "clip-scout"
persona: { name: "Scout", voice: "sharp editor's eye, fast triage" }
profile_from:  ["vault:clip-scout"]
contract_from: ["vault:clip-scout"]
knowledge_from: ["vault:clip-scout"]  # skill at ~/.claude/skills/clip-scout + vault state
tools: ["vault"]
autonomy: "high"
safety: ["Triage/propose only; no publishing without confirmation."]
```

`kalshi-tessa/manifest.yaml`:
```yaml
agent: "Kalshi BTC / Tessa"
slug: "kalshi-tessa"
persona: { name: "Tessa", voice: "quant trader, disciplined, risk-first" }
profile_from:  ["hermes:Tessa", "vault:project-kalshi-btc-lab"]
contract_from: ["hermes:Tessa", "vault:project-kalshi-btc-lab"]
knowledge_from: ["repo:~/Code/kalshi-btc-lab/CLAUDE.md", "vault:project-kalshi-btc-lab"]
tools: []   # per Tessa contract; paper-only, no live-trade tools
autonomy: "medium"
safety:
  - "PAPER-ONLY. Never place a real-money order. Risk rules are hard gates."
  - "Respect the SSOT risk limits from the Kalshi lab spec."
```

`daily-planner/manifest.yaml`:
```yaml
agent: "Daily Planner"
slug: "daily-planner"
persona: { name: "Planner", voice: "calm chief-of-staff, structured" }
profile_from:  []   # braynee/daily-planner conventions
contract_from: ["brand rules"]
knowledge_from: []  # braynee daily-planner agent conventions (point at the plugin)
tools: ["vault"]
autonomy: "medium"
safety: ["Read the vault; propose the plan. No destructive vault edits unprompted."]
```

`codehq-portfolio/manifest.yaml`:
```yaml
agent: "Code HQ / Portfolio"
slug: "codehq-portfolio"
persona: { name: "Steward", voice: "portfolio steward, big-picture, tidy" }
profile_from:  ["vault:project-codehq-dashboard"]
contract_from: ["vault:project-codehq-dashboard"]
knowledge_from: ["repo:~/Code/.codehq/CLAUDE.md", "vault:project-codehq-dashboard"]
tools: []
autonomy: "medium"
safety: ["Never hand-edit the auto-generated PROJECTS.md/projects.json/dashboard.html."]
```

- [ ] **Step 2: Verify vault slugs + locate the Hermes Tessa profile (QMD)**

```bash
Q="/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs"
for s in "Obsidian User" clip-scout project-kalshi-btc-lab project-codehq-dashboard "Hermes Tessa profile" project_hermes-agent-architecture; do
  echo "== $s =="; node "$Q" search "$s" | head -3
done
```
Expected: vault slugs resolve; the Tessa search surfaces the Hermes Tessa profile location. If Tessa's profile isn't found, author her Contract from `project-kalshi-btc-lab` risk rules + `project_hermes-agent-architecture` and note the honest gap (no faked Hermes depth).

- [ ] **Step 3: Fan out 5 authoring passes**

One `brain-author` invocation per agent (parallel, disjoint dirs), incorporating any pilot-review feedback baked into the skill. Draft into `assets/seed-brains/<slug>/brain/`.

- [ ] **Step 4: Verify each resolves + Tessa safety audit**

```bash
cd ~/Code/damon-ade/apps/desktop
for name in "Script Writer" "Clip Scout" "Kalshi BTC / Tessa" "Daily Planner" "Code HQ / Portfolio"; do
  bun -e "import('./src/main/lib/seed-brains.ts').then(m=>console.log('$name →', m.getAuthoredBrainDir('$name')))"
done
```
Expected: 5 brain dirs. Manually confirm Tessa's persona.txt contains the PAPER-ONLY hard gate and her mcp.json exposes no live-trade tool.

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/script-writer assets/seed-brains/clip-scout assets/seed-brains/kalshi-tessa assets/seed-brains/daily-planner assets/seed-brains/codehq-portfolio
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(2B-2): author remaining 5 superagent brains"
```

---

## Task 9: Full re-seed verification (all 9 boot brained)

**Files:** none committed (end-to-end verification of the scaffold-install path).

- [ ] **Step 1: Memory-safe re-seed**

Back up (never delete) the current data dirs, then relaunch so fresh agents scaffold FROM the authored brains:
```bash
mv ~/.ade ~/.ade.bak.$(date +%s) 2>/dev/null || true
mv ~/.ade-default ~/.ade-default.bak.$(date +%s) 2>/dev/null || true
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```
(Note: `date` is fine here — this is a shell command, not a plan script. If a prior `~/.ade.bak.*` exists, that's the memory to preserve.)

- [ ] **Step 2: Confirm each of the 9 booted brained**

For each sourced agent, open it and verify persona = the authored one (not the generic template). Automated check:
```bash
for nm in "Store Cockpit" "Concierge" "RubyPulse" "Foreman" "Scribe" "Scout" "Tessa" "Planner" "Steward"; do
  echo "== $nm =="; grep -l "$nm" ~/.ade/agents/*/persona.txt 2>/dev/null | head -1
done
```
Expected: each authored persona name appears in exactly one live agent's persona.txt. The 2 greenfield agents (Consulting, SaaS Build) show the generic template — correct.

- [ ] **Step 3: Confirm the core invariants still hold**

```bash
git -C ~/Code/ShopifyStore status --short   # clean
git -C ~/Code/rubypulse status --short       # clean
git -C ~/Code/hld-admin status --short        # clean
ls -d ~/.claude/skills/ryanos-* 2>/dev/null   # namespaced direct-agent skills present
# vault root has NO .claude/skills (structural check; override needed for vault path)
BRAYNEE_ALLOW_VAULT_GREP=1 ls "/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/.claude/skills" 2>/dev/null && echo "POLLUTION" || echo "clean"
```
Expected: all real repos clean; namespaced skills present; vault root reports `clean`.

- [ ] **Step 4: Ryan's final acceptance + wrap**

Ryan confirms the cockpit boots 9 superagents + 2 honest greenfield stubs. Then invoke the `wrap` skill to update RyanOS `STATUS.md`, and update the vault memory `[[project_ryanos]]` + `.claude/HANDOFF.md` to mark Phase 2B-2 shipped. Push:
```bash
cd ~/Code/damon-ade && git push origin main
```

---

## Self-Review

**Spec coverage (against phase-2b-design.md §3–5):**
- §3 brain-author skill → Task 4 (SKILL.md + manifest-schema + acceptance-checklist). ✓
- §3 manifest schema → Task 4 Step 1 + Tasks 5/8 manifests. ✓
- §4 the 11 agents → 9 authored (Tasks 5–8), 2 greenfield deferred by Ryan's decision (documented in Global Constraints). ✓
- §4 Tessa special-casing → Task 8 (paper-only hard gate + no-live-tool audit). ✓
- §5 authoring as fan-out with Ryan review → Tasks 6–8 (pilot gate + fan-out). ✓
- §1/§2 authored-vs-learned invariant → enforced in Task 2 (MEMORY.md-safety test) + Global Constraints. ✓
- **Gap the design missed, now covered:** the scaffold had no authored-brain consumption path → Tasks 1–3 (resolver + scaffold install + packaging). This is the load-bearing addition; without it a re-seed would boot generic brains.
- §6 direct-vault skills fix → already shipped in 2B-1; re-verified in Task 9 Step 3. ✓

**Placeholder scan:** authoring Tasks 6/8 deliver *reviewed brains via the skill* rather than pre-written persona prose (the prose is generated from live QMD/repo sources at execution — pre-writing it here would be fabricated depth, which Ryan explicitly rejected). Each task's distinct input (the manifest) is fully specified; the procedure is fully specified in the skill. No TBD/TODO remain.

**Type consistency:** `AGENT_BRAIN_SLUGS` / `slugForAgent` / `getAuthoredBrainDir` (Task 1) are the exact names consumed in Tasks 2, 6, 8, 9. `authoredBrainDir` param name is consistent across `ScaffoldParams`, `agent-init.ts`, `agent-memory-backfill.ts`. Slugs in `AGENT_BRAIN_SLUGS` match the manifest `slug:` fields and the `assets/seed-brains/<slug>/` dirs.
