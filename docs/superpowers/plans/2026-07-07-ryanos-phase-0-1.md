# RyanOS Phase 0+1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this ADE fork into a de-bloated, personalized "RyanOS" desktop app that builds/runs locally and auto-seeds Ryan's five teams and ten agents on first launch.

**Architecture:** Electron main + renderer (TanStack Router), IPC over tRPC (`trpc-electron`, observables only). Local state in SQLite via Drizzle (`packages/local-db`, DB at `~/.ade/local.db`). "Team" = a `projects` row (`mainRepoPath: ""`); "Agent" = a `workspaces` row + its `worktrees` row. Seeding is a main-process routine that runs before the window is created, so the renderer's onboarding-redirect gate sees a populated DB.

**Tech Stack:** Bun, Turbo, TypeScript, Electron, Drizzle/better-sqlite3, TanStack Router, zustand, `bun:test`.

## Global Constraints

- Package manager **Bun** (repo pins `bun@1.3.6`; local 1.3.10 is fine). Orchestrated by Turbo.
- Platform target **macOS arm64**. Unsigned local builds only (no Apple cert).
- **Surface rename only.** Change user-visible product name to "RyanOS". DO NOT change: `~/.ade/` data dir, `superset-icon://` protocol, deep-link scheme `ade`, `appId` `studio.persimmons.ade`, or `@superset/*` / `@ade/*` package names.
- Electron IPC: **observables only** (never async generators) — see `apps/desktop/AGENTS.md`.
- Use path aliases from `tsconfig.json` (`main/...`, `renderer/...`, `shared/...`) as the surrounding code does.
- Dev launch always via `SKIP_ENV_VALIDATION` (already hardcoded `true` in `apps/desktop/src/renderer/env.renderer.ts:50`).
- Auth is already stubbed for local use (`_authenticated/layout.tsx:31-32`, `MOCK_ORG_ID`) — no auth work needed, only verification.
- Commit after every task. Solo repo, commit directly to `main`.

---

### Task 1: De-bloat — delete the Superset SaaS apps

Remove the six unused SaaS apps and stop the root `dev` script from launching them. No `packages/*` depends on these apps (verified: `rg "@superset/(admin|api|web|marketing|mobile|streams)" packages -g package.json` returns nothing), and `apps/*` is a workspace glob so deleting the dirs de-registers them. `turbo.jsonc` tasks are generic (no per-app names) — no change needed there.

**Files:**
- Delete: `apps/admin/`, `apps/api/`, `apps/web/`, `apps/marketing/`, `apps/mobile/`, `apps/streams/`
- Modify: `package.json` (root) — `scripts.dev`

- [ ] **Step 1: Delete the six app directories**

```bash
cd ~/Code/damon-ade
git rm -r apps/admin apps/api apps/web apps/marketing apps/mobile apps/streams
```

- [ ] **Step 2: Point the root `dev` script at desktop only**

In root `package.json`, replace the `dev` script (currently):

```json
"dev": "turbo run dev dev:caddy --filter=@superset/api --filter=@superset/web --filter=@ade/desktop --filter=//",
```

with:

```json
"dev": "turbo run dev --filter=@ade/desktop",
```

Also delete the now-dangling `dev:marketing` script (it filters the deleted `@superset/marketing`):

```json
"dev:marketing": "turbo dev --filter=@superset/marketing --filter=@superset/docs",
```

Leave `dev:docs` (docs still exists) and the `db:*` scripts (harmless) in place.

- [ ] **Step 3: Reinstall to refresh the workspace graph**

Run: `bun install`
Expected: resolves with no errors; lockfile updates to drop the deleted apps. If the `postinstall` step (`./scripts/postinstall.sh`) errors referencing a removed app, open that script and delete the offending line, then re-run `bun install`.

- [ ] **Step 4: Verify the desktop app still launches**

Run: `cd apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev`
Expected: Electron window opens (Welcome/"Create a team" screen — DB still empty at this point). If native modules fail to load, run `bun run install:deps` from `apps/desktop` first, then retry.

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
git add -A
git commit -m "chore: remove Superset SaaS apps; dev runs desktop only"
```

---

### Task 2: Surface-rename ADE → RyanOS

`productName` flows to the window title (`windows/main.ts:103-105`), the Electron `app.name`, the macOS `CFBundleName`/`CFBundleDisplayName` (`electron-builder.ts:180-181`), and the DMG name. Changing it in `apps/desktop/package.json` is the whole surface rename.

**Files:**
- Modify: `apps/desktop/package.json` (`productName`, `author.name`)

- [ ] **Step 1: Rename productName and author**

In `apps/desktop/package.json`, change:

```json
	"productName": "ADE",
```
to:
```json
	"productName": "RyanOS",
```

and change:

```json
	"author": {
		"name": "ADE"
	},
```
to:
```json
	"author": {
		"name": "RyanOS"
	},
```

Leave `"name": "@ade/desktop"`, the repo URL, and everything else unchanged.

- [ ] **Step 2: Verify the running window shows the new name**

Run: `cd apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev`
Expected: window title reads "RyanOS" (dev builds append the workspace name, e.g. "RyanOS — default"); the app menu / About shows RyanOS.

- [ ] **Step 3: Commit**

```bash
cd ~/Code/damon-ade
git add apps/desktop/package.json
git commit -m "feat: surface-rename product to RyanOS"
```

---

### Task 3: Default the Claude runtime to Opus 4.8 (1M context)

The Claude launch preset is a single string. Quote the bracketed model id so the terminal shell (may be zsh) does not glob-expand `[1m]`.

**Files:**
- Modify: `packages/shared/src/agent-command.ts:28`

- [ ] **Step 1: Change the claude preset command**

In `packages/shared/src/agent-command.ts`, change:

```typescript
	claude: ["claude --dangerously-skip-permissions"],
```
to:
```typescript
	claude: ["claude --model 'claude-opus-4-8[1m]' --dangerously-skip-permissions"],
```

- [ ] **Step 2: Verify a Claude session launches on Opus 1M**

Run: `cd apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev`, create/open a Claude agent, and in its terminal run `/status` (or `/model`).
Expected: model reports Opus 4.8 with 1M context.
Fallback if the CLI rejects the bracketed id (session errors on launch): change the flag to `--model opus` and document that 1M context is set via the user's Claude Code config instead. Re-verify before committing.

- [ ] **Step 3: Commit**

```bash
cd ~/Code/damon-ade
git add packages/shared/src/agent-command.ts
git commit -m "feat: default Claude runtime to Opus 4.8 (1M context)"
```

---

### Task 4: Seed roster + `seedDefaultCockpit()` (TDD)

Create a pure DB-seeding routine that inserts the five teams and ten agents when the DB is empty, and returns the per-agent init contexts for the caller to hand to `beginAgentInit`. Keeping git/init out of this function makes it fast and unit-testable. Insert shapes are copied verbatim from `create-agent.ts:44-71` (agent) and `projects.ts:1199-1208` (category).

**Files:**
- Create: `apps/desktop/src/main/lib/seed-cockpit.ts`
- Test: `apps/desktop/src/main/lib/seed-cockpit.test.ts`

**Interfaces:**
- Consumes: `localDb` (`main/lib/local-db`); `projects, workspaces, worktrees` (`@superset/local-db`); `getAgentWorktreePath` (`main/lib/agent-home`); the type of `beginAgentInit` (`main/lib/agent-init`, for its ctx param shape).
- Produces: `seedDefaultCockpit(): SeededAgent[]` where `SeededAgent = { agentId: string; ctx: Parameters<typeof beginAgentInit>[1] }`. Returns `[]` when `projects` is non-empty (idempotent).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/lib/seed-cockpit.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, workspaces, worktrees } from "@superset/local-db";

// Route the local SQLite DB under a throwaway home BEFORE importing localDb.
const TEST_HOME = join(tmpdir(), `ade-seed-test-${process.pid}-${Date.now()}`);
process.env.ADE_HOME_DIR = TEST_HOME;

let seedDefaultCockpit: typeof import("./seed-cockpit").seedDefaultCockpit;
let localDb: typeof import("./local-db").localDb;

beforeAll(async () => {
	localDb = (await import("./local-db")).localDb;
	seedDefaultCockpit = (await import("./seed-cockpit")).seedDefaultCockpit;
});

afterAll(() => rmSync(TEST_HOME, { recursive: true, force: true }));

describe("seedDefaultCockpit", () => {
	it("seeds 5 teams and 10 agents into an empty DB", () => {
		const seeded = seedDefaultCockpit();
		expect(seeded.length).toBe(10);
		expect(localDb.select().from(projects).all().length).toBe(5);
		expect(localDb.select().from(workspaces).all().length).toBe(10);
		expect(localDb.select().from(worktrees).all().length).toBe(10);
	});

	it("gives every seeded agent the claude runtime and a worktree", () => {
		const rows = localDb.select().from(workspaces).all();
		expect(rows.every((w) => w.runtime === "claude")).toBe(true);
		expect(rows.every((w) => w.worktreeId != null)).toBe(true);
	});

	it("is idempotent — re-seeding a populated DB is a no-op", () => {
		const again = seedDefaultCockpit();
		expect(again.length).toBe(0);
		expect(localDb.select().from(projects).all().length).toBe(5);
		expect(localDb.select().from(workspaces).all().length).toBe(10);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/seed-cockpit.test.ts`
Expected: FAIL — cannot resolve `./seed-cockpit` (module does not exist yet).

- [ ] **Step 3: Implement `seed-cockpit.ts`**

Create `apps/desktop/src/main/lib/seed-cockpit.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/seed-cockpit.test.ts`
Expected: PASS — all three tests green (5 teams, 10 agents, idempotent).

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
git add apps/desktop/src/main/lib/seed-cockpit.ts apps/desktop/src/main/lib/seed-cockpit.test.ts
git commit -m "feat: seedDefaultCockpit — five teams, ten agents (idempotent)"
```

---

### Task 5: Wire seeding into main-process boot

Call the seed before the window is created (DB is ready after `reconcileDaemonSessions()` at `index.ts:292`; the window is created at `index.ts:302`). Seeding here means the renderer's onboarding gate (`workspace/page.tsx`, redirects to `/welcome` when 0 categories) sees the populated cockpit instead. Then trigger each agent's repo/memory build via the existing `beginAgentInit`.

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (imports; boot block before `makeAppSetup`)

**Interfaces:**
- Consumes: `seedDefaultCockpit` (Task 4); `beginAgentInit(agentId, ctx)` (`main/lib/agent-init:41`).

- [ ] **Step 1: Add imports**

At the top of `apps/desktop/src/main/index.ts`, alongside the existing imports, add:

```typescript
import { beginAgentInit } from "./lib/agent-init";
import { seedDefaultCockpit } from "./lib/seed-cockpit";
```

- [ ] **Step 2: Insert the seed block before window creation**

In `apps/desktop/src/main/index.ts`, immediately BEFORE this existing line (currently line 301):

```typescript
		console.log("[main] boot: makeAppSetup (create window)…");
```

insert:

```typescript
		// First-run seed: populate Ryan's default teams/agents while the DB is
		// ready but the window (and its onboarding-redirect gate) is not up yet.
		// Idempotent — a no-op on every launch after the first.
		try {
			const seeded = seedDefaultCockpit();
			for (const { agentId, ctx } of seeded) {
				beginAgentInit(agentId, ctx);
			}
			if (seeded.length > 0) {
				console.log(`[main] boot: seeded cockpit (${seeded.length} agents)`);
			}
		} catch (error) {
			console.error("[main] Cockpit seed failed:", error);
		}

```

- [ ] **Step 3: Verify a fresh launch shows the seeded cockpit**

```bash
# Back up then clear the default local DB so this run is a "first run".
mv ~/.ade-default ~/.ade-default.bak 2>/dev/null || mv ~/.ade ~/.ade.bak 2>/dev/null || true
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```
Expected: app opens directly to the cockpit (NOT the "Create a team" welcome). Left rail shows five teams (HLD Ops, Hand Lane AI, Content / YouTube, Trading, Personal / RLOS); each expands to its agents (ten total). Each agent shows the init checklist then goes "ready." Opening an agent launches a Claude terminal session. (Dev home may be `~/.ade-default`; adjust the backup path if your run uses `~/.ade`.)

- [ ] **Step 4: Verify idempotency across restart**

Quit and relaunch the app (same command). Expected: still exactly five teams / ten agents — no duplicates. Log shows no new "seeded cockpit" line.

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
git add apps/desktop/src/main/index.ts
git commit -m "feat: seed default cockpit on first boot"
```

---

### Task 6: Verify quality-of-life defaults + build an unsigned DMG

Confirm the already-correct defaults (dark theme, stubbed auth) and produce an installable local build. No code changes expected; if a check fails, fix minimally and note it.

**Files:**
- None expected (verification task). Possible touch: `apps/desktop/src/renderer/stores/theme/store.ts` only if dark is NOT the effective default.

- [ ] **Step 1: Verify dark-by-default and no sign-in**

Run: `cd apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev`
Expected: UI is dark on first load (`DEFAULT_THEME_ID = "dark"`, `shared/themes/built-in/index.ts:20`); the app never shows a cloud sign-in screen (`_authenticated/layout.tsx` uses `MOCK_ORG_ID`); seeded agents display initials/photos, not emoji avatars (the seed inserts no `iconUrl`, so there is no default-emoji noise). If the app opens in light mode, change `activeThemeId: DEFAULT_THEME_ID` at `theme/store.ts:138` to `activeThemeId: "dark"` and re-verify.

- [ ] **Step 2: Build the unsigned DMG**

```bash
cd ~/Code/damon-ade/apps/desktop
bun run install:deps   # rebuild better-sqlite3 / node-pty for this arch
bun run build          # electron-builder; signing auto-discovery already disabled
```
Expected: a `.dmg` appears under `apps/desktop/release/`. `CSC_IDENTITY_AUTO_DISCOVERY=false` in the `build` script prevents a signing failure.

- [ ] **Step 3: Install and smoke-test the packaged app**

Open the DMG, drag "RyanOS" to /Applications, launch it (right-click → Open the first time, since it is unsigned).
Expected: window titled "RyanOS", opens to the seeded five-team cockpit, an agent session launches Claude. (A packaged launch uses `~/.ade`, so it seeds independently of your dev home.)

- [ ] **Step 4: Commit any fix + tag the milestone**

```bash
cd ~/Code/damon-ade
git add -A
git commit -m "chore: verify RyanOS Phase 0+1 defaults and local build" --allow-empty
```

---

## Out of scope (Phase 2+)

Vault-backed agent memory (`RLOS_2026` as source of truth), attaching agents in-place to real `~/Code` repos + the vault (needs a local-path repo variant and `CLAUDE.md`/`.claude` collision handling), Ryan's Hermes memory structure replacing the generic templates, dashboards-as-panels, and any deep rename (data dir, protocol, package names). Seeded agents intentionally use fresh `init` repos here.

## Optional polish (not required)

- Hide "system"/light options from the theme picker to hard-lock dark.
- Ship seed team/agent icons under `assets/seed-icons/` and copy them into `~/.ade/project-icons` / `~/.ade/workspace-icons` during seeding.
- Trim cloud-only entries from `turbo.jsonc` `globalEnv` and the root `db:*` scripts.
