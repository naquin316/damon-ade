# RyanOS Versioning + Git-Native Self-Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give RyanOS a real semver+commit version, show it in the TopBar, and add an in-app "check for updates → pull → rebuild → reinstall → relaunch" flow driven by a detached updater script.

**Architecture:** Build-time git stamping writes `BUILD_INFO` into a committed generated module. A main-process controller (`self-update.ts`) checks the local repo against `origin/main` and, on request, spawns a detached bash updater that rebuilds and reinstalls to `/Applications`. The renderer shows a `VersionBadge` in the TopBar and subscribes to update status over tRPC. Single-machine, git-native — no signing, no CI, no electron-updater.

**Tech Stack:** Electron + electron-vite, TypeScript, tRPC (`trpc-electron`, observable subscriptions), React (TanStack Router), bun (runtime + `bun:test` + electron-builder), bash.

## Global Constraints

- Runtime/tooling: `bun` (packageManager `bun@1.3.6`). Tests use `bun:test` (`import { describe, expect, test } from "bun:test"`).
- tRPC over Electron IPC MUST use the **observable** pattern, never async generators (see `apps/desktop/AGENTS.md`).
- Use tsconfig path aliases (`main/…`, `shared/…`, `renderer/…`, `lib/…`) — not deep relative paths — matching existing files.
- App home dir is `~/.ade` via `getSupersetHomeDir()` from `main/lib/app-environment` (honors `$ADE_HOME_DIR`). All markers/logs/config live there.
- Installed app path: `/Applications/RyanOS.app`. Built artifact: `apps/desktop/release/mac-arm64/RyanOS.app`. Product name `RyanOS`, appId `studio.persimmons.ade`.
- Build chain (from `apps/desktop`): `bun run clean:dev` → `bun run compile:app` → `CSC_IDENTITY_AUTO_DISCOVERY=false bun run package`.
- Repo default path: `~/Code/damon-ade`. Release repo (for compare links): `naquin316/damon-ade`.
- Never clobber uncommitted work: the updater refuses on a dirty tree or non-`main` branch.
- Leave `apps/desktop/src/main/lib/auto-updater.ts` (electron-updater) untouched and dormant.
- All new work in `apps/desktop`. Commit after each task.

---

## File Structure

**New**
- `apps/desktop/scripts/gen-build-info.ts` — collect git facts, render + write the generated module.
- `apps/desktop/src/shared/build-info.generated.ts` — committed, machine-generated `BUILD_INFO`.
- `apps/desktop/src/shared/self-update.ts` — status enum, event type, pure `deriveUpdateState`.
- `apps/desktop/src/shared/self-update.test.ts` — tests for `deriveUpdateState`.
- `apps/desktop/scripts/gen-build-info.test.ts` — test for `renderBuildInfoModule`.
- `apps/desktop/src/main/lib/self-update.ts` — controller: repo resolution, check, update spawn, markers, emitter.
- `apps/desktop/src/main/lib/self-update.test.ts` — tests for `resolveRepoPath` + marker read/write.
- `apps/desktop/scripts/self-update.sh` — the detached updater (with `--dry-run`).
- `apps/desktop/scripts/tag-release.sh` — local semver bump + annotated tag + push.
- `apps/desktop/src/lib/trpc/routers/app-info.ts` — `appInfo` router.
- `apps/desktop/src/lib/trpc/routers/self-update.ts` — `selfUpdate` router.
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge/VersionBadge.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge/format.ts` — pure badge formatting.
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge/format.test.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge/index.ts`

**Modified**
- `apps/desktop/package.json` — add `gen:build-info` script; prepend it in `predev`/`prebuild`/`pretypecheck`; bump `version` → `0.2.0`.
- `apps/desktop/src/lib/trpc/routers/index.ts` — register `appInfo` + `selfUpdate`.
- `apps/desktop/src/main/index.ts` — call `setupSelfUpdate()` after `setupAutoUpdater()`.
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/TopBar.tsx` — mount `<VersionBadge />`.

---

## Task 1: Build-info generation

**Files:**
- Create: `apps/desktop/scripts/gen-build-info.ts`
- Create: `apps/desktop/scripts/gen-build-info.test.ts`
- Create: `apps/desktop/src/shared/build-info.generated.ts`
- Modify: `apps/desktop/package.json` (scripts: `gen:build-info`, `predev`, `prebuild`, `pretypecheck`)

**Interfaces:**
- Produces: `BUILD_INFO: { version: string; commit: string; commitFull: string; branch: string; buildDate: string; tag: string }` exported from `shared/build-info.generated`.
- Produces (script internals, exported for test): `renderBuildInfoModule(info: BuildInfo): string`, `collectBuildInfo(): BuildInfo`, `type BuildInfo`.

- [ ] **Step 1: Write the committed generated module with dev defaults**

Create `apps/desktop/src/shared/build-info.generated.ts`:
```ts
// machine-generated by scripts/gen-build-info.ts — safe dev defaults committed;
// overwritten with real git values before every dev/build/typecheck.
export const BUILD_INFO = {
	version: "0.2.0",
	commit: "dev",
	commitFull: "dev",
	branch: "dev",
	buildDate: "",
	tag: "",
} as const;

export type BuildInfo = {
	version: string;
	commit: string;
	commitFull: string;
	branch: string;
	buildDate: string;
	tag: string;
};
```

- [ ] **Step 2: Write the failing test for `renderBuildInfoModule`**

Create `apps/desktop/scripts/gen-build-info.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { renderBuildInfoModule } from "./gen-build-info";

describe("renderBuildInfoModule", () => {
	test("emits a valid module with all fields", () => {
		const out = renderBuildInfoModule({
			version: "0.2.0",
			commit: "535fa20",
			commitFull: "535fa20abc",
			branch: "main",
			buildDate: "2026-07-10",
			tag: "v0.2.0",
		});
		expect(out).toContain('version: "0.2.0"');
		expect(out).toContain('commit: "535fa20"');
		expect(out).toContain('commitFull: "535fa20abc"');
		expect(out).toContain('branch: "main"');
		expect(out).toContain('buildDate: "2026-07-10"');
		expect(out).toContain('tag: "v0.2.0"');
		expect(out).toContain("export const BUILD_INFO");
		expect(out).toContain("machine-generated");
	});

	test("escapes are unnecessary but quotes are balanced", () => {
		const out = renderBuildInfoModule({
			version: "0.2.0", commit: "a", commitFull: "a", branch: "b", buildDate: "", tag: "",
		});
		expect((out.match(/"/g) ?? []).length % 2).toBe(0);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/desktop && bun test scripts/gen-build-info.test.ts`
Expected: FAIL — cannot find module `./gen-build-info` / `renderBuildInfoModule` is not a function.

- [ ] **Step 4: Implement `gen-build-info.ts`**

Create `apps/desktop/scripts/gen-build-info.ts`:
```ts
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type BuildInfo = {
	version: string;
	commit: string;
	commitFull: string;
	branch: string;
	buildDate: string;
	tag: string;
};

const DESKTOP_DIR = join(import.meta.dir, "..");
const OUT_PATH = join(DESKTOP_DIR, "src/shared/build-info.generated.ts");

function git(args: string[]): string {
	try {
		return execFileSync("git", args, { cwd: DESKTOP_DIR, encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

export function collectBuildInfo(): BuildInfo {
	const pkg = require(join(DESKTOP_DIR, "package.json")) as { version: string };
	const commitFull = git(["rev-parse", "HEAD"]) || "dev";
	const commit = git(["rev-parse", "--short", "HEAD"]) || "dev";
	const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "dev";
	const tag = git(["describe", "--tags", "--exact-match"]); // "" when not exactly on a tag
	const buildDate = new Date().toISOString().slice(0, 10);
	return { version: pkg.version, commit, commitFull, branch, buildDate, tag };
}

export function renderBuildInfoModule(info: BuildInfo): string {
	return `// machine-generated by scripts/gen-build-info.ts — do not edit by hand.
export const BUILD_INFO = {
	version: ${JSON.stringify(info.version)},
	commit: ${JSON.stringify(info.commit)},
	commitFull: ${JSON.stringify(info.commitFull)},
	branch: ${JSON.stringify(info.branch)},
	buildDate: ${JSON.stringify(info.buildDate)},
	tag: ${JSON.stringify(info.tag)},
} as const;

export type BuildInfo = {
	version: string;
	commit: string;
	commitFull: string;
	branch: string;
	buildDate: string;
	tag: string;
};
`;
}

// Run directly (bun scripts/gen-build-info.ts) → write the module.
if (import.meta.main) {
	const info = collectBuildInfo();
	writeFileSync(OUT_PATH, renderBuildInfoModule(info), "utf8");
	console.info(`[gen-build-info] ${info.version} ${info.commit} (${info.branch}) ${info.buildDate}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/desktop && bun test scripts/gen-build-info.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the generator and confirm it stamps real values**

Run: `cd apps/desktop && bun run scripts/gen-build-info.ts && head -8 src/shared/build-info.generated.ts`
Expected: prints a log line; the file now shows the real short commit (e.g. `commit: "cd738ef"`) and today's `buildDate`.

- [ ] **Step 7: Wire the generator into package.json**

In `apps/desktop/package.json` add to `scripts`:
```json
"gen:build-info": "bun run scripts/gen-build-info.ts",
```
Then prepend it to the three pre-hooks (keep existing bodies):
- `predev`: prepend `bun run gen:build-info && ` before the existing `cross-env NODE_ENV=development bun run clean:dev …`.
- `prebuild`: prepend `bun run gen:build-info && ` before `bun run clean:dev && bun run compile:app && …`.
- `pretypecheck`: change `"bun run generate:routes"` → `"bun run gen:build-info && bun run generate:routes"`.

- [ ] **Step 8: Verify typecheck still resolves the module**

Run: `cd apps/desktop && bun run gen:build-info && echo OK`
Expected: `[gen-build-info] …` then `OK`.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/scripts/gen-build-info.ts apps/desktop/scripts/gen-build-info.test.ts \
  apps/desktop/src/shared/build-info.generated.ts apps/desktop/package.json
git commit -m "feat(desktop): build-time git version stamping (BUILD_INFO)"
```

---

## Task 2: Self-update shared contract + pure logic

**Files:**
- Create: `apps/desktop/src/shared/self-update.ts`
- Create: `apps/desktop/src/shared/self-update.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SELF_UPDATE_STATUS = { IDLE:"idle", CHECKING:"checking", BEHIND:"behind", UPDATING:"updating", ERROR:"error" } as const`
  - `type SelfUpdateStatus`
  - `type SelfUpdateEvent = { status: SelfUpdateStatus; behindCount?: number; compareUrl?: string; error?: string }`
  - `deriveUpdateState(installedCommit: string, originCommit: string, behindCount: number): SelfUpdateEvent`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/shared/self-update.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { SELF_UPDATE_STATUS, deriveUpdateState } from "./self-update";

describe("deriveUpdateState", () => {
	test("idle when commits match", () => {
		const e = deriveUpdateState("abc123", "abc123", 0);
		expect(e.status).toBe(SELF_UPDATE_STATUS.IDLE);
		expect(e.behindCount).toBe(0);
	});

	test("behind when origin is ahead", () => {
		const e = deriveUpdateState("abc123", "def456", 3);
		expect(e.status).toBe(SELF_UPDATE_STATUS.BEHIND);
		expect(e.behindCount).toBe(3);
	});

	test("behind with unknown count when installed commit is dev", () => {
		const e = deriveUpdateState("dev", "def456", 0);
		expect(e.status).toBe(SELF_UPDATE_STATUS.BEHIND);
		expect(e.behindCount).toBeUndefined();
	});

	test("idle when different commits but zero behind (already ahead/local)", () => {
		const e = deriveUpdateState("abc123", "def456", 0);
		expect(e.status).toBe(SELF_UPDATE_STATUS.IDLE);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/shared/self-update.test.ts`
Expected: FAIL — cannot find module `./self-update`.

- [ ] **Step 3: Implement `self-update.ts`**

Create `apps/desktop/src/shared/self-update.ts`:
```ts
export const SELF_UPDATE_STATUS = {
	IDLE: "idle",
	CHECKING: "checking",
	BEHIND: "behind",
	UPDATING: "updating",
	ERROR: "error",
} as const;

export type SelfUpdateStatus =
	(typeof SELF_UPDATE_STATUS)[keyof typeof SELF_UPDATE_STATUS];

export type SelfUpdateEvent = {
	status: SelfUpdateStatus;
	behindCount?: number;
	compareUrl?: string;
	error?: string;
};

/**
 * Pure classification of update state from git facts.
 * - installedCommit "dev"/"" → we can't count; if origin differs, treat as BEHIND (unknown count).
 * - behindCount > 0 → BEHIND with the count.
 * - otherwise IDLE (up to date, or local is ahead).
 */
export function deriveUpdateState(
	installedCommit: string,
	originCommit: string,
	behindCount: number,
): SelfUpdateEvent {
	if (!installedCommit || installedCommit === "dev") {
		return installedCommit && originCommit && installedCommit === originCommit
			? { status: SELF_UPDATE_STATUS.IDLE, behindCount: 0 }
			: { status: SELF_UPDATE_STATUS.BEHIND };
	}
	if (behindCount > 0) {
		return { status: SELF_UPDATE_STATUS.BEHIND, behindCount };
	}
	return { status: SELF_UPDATE_STATUS.IDLE, behindCount: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/shared/self-update.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/self-update.ts apps/desktop/src/shared/self-update.test.ts
git commit -m "feat(desktop): self-update shared status contract + deriveUpdateState"
```

---

## Task 3: Self-update controller (main process)

**Files:**
- Create: `apps/desktop/src/main/lib/self-update.ts`
- Create: `apps/desktop/src/main/lib/self-update.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (call `setupSelfUpdate()`)

**Interfaces:**
- Consumes: `getSupersetHomeDir` (`main/lib/app-environment`), `BUILD_INFO` (`shared/build-info.generated`), `SELF_UPDATE_STATUS`, `SelfUpdateEvent`, `deriveUpdateState` (`shared/self-update`).
- Produces:
  - `selfUpdateEmitter: EventEmitter` (emits `"status-changed"` with `SelfUpdateEvent`)
  - `getSelfUpdateStatus(): SelfUpdateEvent`
  - `resolveRepoPath(): string` (exported for test)
  - `readConfiguredRepoPath(raw: string | undefined): string` (pure, exported for test)
  - `checkForUpdates(): Promise<void>`
  - `startUpdate(): void`
  - `consumeFailureMarker(): string | null` (exported for test)
  - `setupSelfUpdate(): void`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/lib/self-update.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfiguredRepoPath } from "./self-update";

describe("readConfiguredRepoPath", () => {
	test("defaults to ~/Code/damon-ade when config missing/blank", () => {
		expect(readConfiguredRepoPath(undefined)).toBe(join(homedir(), "Code", "damon-ade"));
		expect(readConfiguredRepoPath("   ")).toBe(join(homedir(), "Code", "damon-ade"));
	});

	test("expands a leading ~", () => {
		expect(readConfiguredRepoPath("~/Code/damon-ade")).toBe(
			join(homedir(), "Code", "damon-ade"),
		);
	});

	test("passes absolute paths through", () => {
		expect(readConfiguredRepoPath("/Users/x/Code/damon-ade")).toBe(
			"/Users/x/Code/damon-ade",
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/self-update.test.ts`
Expected: FAIL — cannot find module `./self-update`.

- [ ] **Step 3: Implement `self-update.ts`**

Create `apps/desktop/src/main/lib/self-update.ts`:
```ts
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getSupersetHomeDir } from "main/lib/app-environment";
import { BUILD_INFO } from "shared/build-info.generated";
import {
	SELF_UPDATE_STATUS,
	type SelfUpdateEvent,
	deriveUpdateState,
} from "shared/self-update";

const execFileP = promisify(execFile);
const COMPARE_REPO = "naquin316/damon-ade";
const DEFAULT_REPO = join(homedir(), "Code", "damon-ade");

export const selfUpdateEmitter = new EventEmitter();

let current: SelfUpdateEvent = { status: SELF_UPDATE_STATUS.IDLE };

function emit(event: SelfUpdateEvent): void {
	current = event;
	selfUpdateEmitter.emit("status-changed", event);
}

export function getSelfUpdateStatus(): SelfUpdateEvent {
	return current;
}

/** Pure: resolve the configured repo path string (expand ~, default). */
export function readConfiguredRepoPath(raw: string | undefined): string {
	const v = (raw ?? "").trim();
	if (!v) return DEFAULT_REPO;
	if (v === "~") return homedir();
	if (v.startsWith("~/")) return join(homedir(), v.slice(2));
	return v;
}

function configPath(): string {
	return join(getSupersetHomeDir(), "self-update.json");
}

export function resolveRepoPath(): string {
	try {
		const p = configPath();
		if (!existsSync(p)) return DEFAULT_REPO;
		const parsed = JSON.parse(readFileSync(p, "utf8")) as { repoPath?: string };
		return readConfiguredRepoPath(parsed.repoPath);
	} catch {
		return DEFAULT_REPO;
	}
}

function failureMarkerPath(): string {
	return join(getSupersetHomeDir(), "update.failed");
}

/** Read + delete the failure marker (one-shot). Returns the reason or null. */
export function consumeFailureMarker(): string | null {
	const p = failureMarkerPath();
	if (!existsSync(p)) return null;
	try {
		const reason = readFileSync(p, "utf8").trim();
		rmSync(p, { force: true });
		return reason || "Update failed.";
	} catch {
		return null;
	}
}

async function git(repo: string, args: string[]): Promise<string> {
	const { stdout } = await execFileP("git", ["-C", repo, ...args]);
	return stdout.trim();
}

export async function checkForUpdates(): Promise<void> {
	const repo = resolveRepoPath();
	if (!existsSync(join(repo, ".git"))) {
		emit({ status: SELF_UPDATE_STATUS.ERROR, error: `Repo not found at ${repo}` });
		return;
	}
	emit({ status: SELF_UPDATE_STATUS.CHECKING });
	try {
		await git(repo, ["fetch", "origin", "main"]);
		const origin = await git(repo, ["rev-parse", "origin/main"]);
		const installed = BUILD_INFO.commitFull;
		let behind = 0;
		if (installed && installed !== "dev") {
			const out = await git(repo, ["rev-list", "--count", `${installed}..origin/main`]);
			behind = Number.parseInt(out, 10) || 0;
		}
		const state = deriveUpdateState(installed, origin, behind);
		if (state.status === SELF_UPDATE_STATUS.BEHIND) {
			state.compareUrl = `https://github.com/${COMPARE_REPO}/compare/${
				installed && installed !== "dev" ? installed : "main"
			}...main`;
		}
		emit(state);
	} catch (error) {
		// Network/transient: fall back to idle rather than alarming the user.
		const message = error instanceof Error ? error.message : String(error);
		if (/could not resolve host|network|timed out|ENOTFOUND|ETIMEDOUT/i.test(message)) {
			emit({ status: SELF_UPDATE_STATUS.IDLE });
			return;
		}
		emit({ status: SELF_UPDATE_STATUS.ERROR, error: message });
	}
}

export function startUpdate(): void {
	const repo = resolveRepoPath();
	const script = join(repo, "apps/desktop/scripts/self-update.sh");
	if (!existsSync(script)) {
		emit({ status: SELF_UPDATE_STATUS.ERROR, error: `Updater script missing: ${script}` });
		return;
	}
	const home = getSupersetHomeDir();
	mkdirSync(home, { recursive: true });
	// Intent marker (informational; script also writes its own log).
	writeFileSync(join(home, "update.intent"), new Date().toISOString(), "utf8");
	emit({ status: SELF_UPDATE_STATUS.UPDATING });

	const child = spawn(
		"/bin/bash",
		[script, "--repo", repo, "--app", "/Applications/RyanOS.app", "--pid", String(process.pid)],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();

	// Give the detached child a beat to start, then quit so it can swap our bundle.
	setTimeout(() => app.quit(), 600);
}

export function setupSelfUpdate(): void {
	// Surface a prior failed update once.
	const failure = consumeFailureMarker();
	if (failure) {
		emit({ status: SELF_UPDATE_STATUS.ERROR, error: failure });
	}
	// Check on launch (best-effort; never throws into boot).
	void checkForUpdates().catch(() => {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/self-update.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `setupSelfUpdate()` into boot**

In `apps/desktop/src/main/index.ts`:
- Add import near the `setupAutoUpdater` import (line ~26):
  ```ts
  import { setupSelfUpdate } from "./lib/self-update";
  ```
- After the existing `setupAutoUpdater();` call (line ~321), add:
  ```ts
  setupSelfUpdate();
  ```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/lib/self-update.ts apps/desktop/src/main/lib/self-update.test.ts \
  apps/desktop/src/main/index.ts
git commit -m "feat(desktop): git-native self-update controller (check + spawn)"
```

---

## Task 4: Detached updater script

**Files:**
- Create: `apps/desktop/scripts/self-update.sh`

**Interfaces:**
- Consumes: CLI flags `--repo <path> --app <path> --pid <n>` and optional `--dry-run`.
- Produces: writes `~/.ade/update.log`; on failure writes `~/.ade/update.failed`; clears `~/.ade/update.intent` on success. Exit 0 on success/dry-run, non-zero on failure.

- [ ] **Step 1: Write the script**

Create `apps/desktop/scripts/self-update.sh`:
```bash
#!/usr/bin/env bash
# RyanOS git-native self-updater. Runs DETACHED after the app quits:
#   git pull --ff-only origin main -> rebuild -> install to /Applications -> relaunch.
# Refuses on a dirty tree or non-main branch. Never touches /Applications until a
# successful build. All output tee'd to ~/.ade/update.log.
set -uo pipefail

REPO="" ; APP="/Applications/RyanOS.app" ; WAIT_PID="" ; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --app) APP="$2"; shift 2;;
    --pid) WAIT_PID="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

ADE_HOME="${ADE_HOME_DIR:-$HOME/.ade}"
mkdir -p "$ADE_HOME"
LOG="$ADE_HOME/update.log"
INTENT="$ADE_HOME/update.intent"
FAILED="$ADE_HOME/update.failed"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; echo "$*" > "$FAILED"; exit 1; }

[ -n "$REPO" ] || { echo "--repo required" >&2; exit 2; }
DESKTOP="$REPO/apps/desktop"

log "=== self-update start (dry_run=$DRY_RUN, repo=$REPO) ==="

# 1. Wait for the app to exit so we can replace its bundle.
if [ -n "$WAIT_PID" ] && [ "$DRY_RUN" -eq 0 ]; then
  log "waiting for app pid $WAIT_PID to exit…"
  for _ in $(seq 1 60); do kill -0 "$WAIT_PID" 2>/dev/null || break; sleep 0.5; done
fi

# 2. Preconditions.
command -v git >/dev/null 2>&1 || fail "git not found on PATH"
command -v bun >/dev/null 2>&1 || fail "bun not found on PATH"
[ -d "$REPO/.git" ] || fail "not a git repo: $REPO"

BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || fail "refusing to update: on branch '$BRANCH', not main"
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
  fail "refusing to update: working tree is dirty (commit/stash first)"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN plan:"
  log "  git -C $REPO pull --ff-only origin main"
  log "  (bun install if lockfile changed)"
  log "  cd $DESKTOP && bun run clean:dev && bun run compile:app && CSC_IDENTITY_AUTO_DISCOVERY=false bun run package"
  log "  rm -rf $APP && cp -R $DESKTOP/release/mac-arm64/RyanOS.app $APP"
  log "  open -a $APP"
  log "=== dry run complete (no changes made) ==="
  exit 0
fi

# 3. Pull.
LOCK_BEFORE="$(md5 -q "$REPO/bun.lock" 2>/dev/null || echo none)"
log "pulling origin/main…"
git -C "$REPO" pull --ff-only origin main >>"$LOG" 2>&1 || fail "git pull --ff-only failed"
LOCK_AFTER="$(md5 -q "$REPO/bun.lock" 2>/dev/null || echo none)"

# 4. Install deps only if the lockfile changed.
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  log "lockfile changed → bun install…"
  ( cd "$REPO" && bun install ) >>"$LOG" 2>&1 || fail "bun install failed"
fi

# 5. Build (into release/; /Applications untouched until success).
log "building…"
( cd "$DESKTOP" && bun run clean:dev && bun run compile:app && CSC_IDENTITY_AUTO_DISCOVERY=false bun run package ) >>"$LOG" 2>&1 \
  || fail "build failed"

BUILT="$DESKTOP/release/mac-arm64/RyanOS.app"
[ -d "$BUILT" ] || fail "built app not found at $BUILT"

# 6. Swap into /Applications.
log "installing to $APP…"
rm -rf "$APP" || fail "could not remove old app at $APP"
cp -R "$BUILT" "$APP" || fail "could not copy new app to $APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# 7. Relaunch + clear intent.
rm -f "$INTENT" "$FAILED"
log "relaunching…"
open -a "$APP" || fail "relaunch failed"
log "=== self-update complete ==="
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x apps/desktop/scripts/self-update.sh`

- [ ] **Step 3: Verify the dry-run makes no changes**

Run:
```bash
cd /Users/ryannaquin/Code/damon-ade
APP_BEFORE=$(stat -f %m /Applications/RyanOS.app)
bash apps/desktop/scripts/self-update.sh --repo "$PWD" --app /Applications/RyanOS.app --pid $$ --dry-run
APP_AFTER=$(stat -f %m /Applications/RyanOS.app)
[ "$APP_BEFORE" = "$APP_AFTER" ] && echo "OK: /Applications untouched"
tail -8 ~/.ade/update.log
```
Expected: prints the DRY RUN plan, `=== dry run complete (no changes made) ===`, `OK: /Applications untouched`. (Note: if the working tree is dirty at this point because of in-progress plan work, the guard will `FAIL: … dirty` — that is correct behavior; re-run after committing, or temporarily test on a clean checkout. The dry-run still exits before any mutation.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/scripts/self-update.sh
git commit -m "feat(desktop): detached git-native updater script (self-update.sh)"
```

---

## Task 5: tRPC routers (appInfo + selfUpdate)

**Files:**
- Create: `apps/desktop/src/lib/trpc/routers/app-info.ts`
- Create: `apps/desktop/src/lib/trpc/routers/self-update.ts`
- Modify: `apps/desktop/src/lib/trpc/routers/index.ts`

**Interfaces:**
- Consumes: `BUILD_INFO` (`shared/build-info.generated`); `selfUpdateEmitter`, `getSelfUpdateStatus`, `checkForUpdates`, `startUpdate` (`main/lib/self-update`); `SelfUpdateEvent` (`shared/self-update`); `publicProcedure, router` from `../..`; `observable` from `@trpc/server/observable`.
- Produces (renderer-visible): `appInfo.get` → `BuildInfo`; `selfUpdate.subscribe` → `SelfUpdateEvent`; `selfUpdate.getStatus`; `selfUpdate.check` (mutation); `selfUpdate.update` (mutation).

- [ ] **Step 1: Implement `app-info.ts`**

Create `apps/desktop/src/lib/trpc/routers/app-info.ts`:
```ts
import { BUILD_INFO } from "shared/build-info.generated";
import { publicProcedure, router } from "../..";

export const createAppInfoRouter = () => {
	return router({
		get: publicProcedure.query(() => BUILD_INFO),
	});
};
```

- [ ] **Step 2: Implement `self-update.ts` router**

Create `apps/desktop/src/lib/trpc/routers/self-update.ts`:
```ts
import { observable } from "@trpc/server/observable";
import {
	checkForUpdates,
	getSelfUpdateStatus,
	selfUpdateEmitter,
	startUpdate,
} from "main/lib/self-update";
import type { SelfUpdateEvent } from "shared/self-update";
import { publicProcedure, router } from "../..";

export const createSelfUpdateRouter = () => {
	return router({
		subscribe: publicProcedure.subscription(() => {
			return observable<SelfUpdateEvent>((emit) => {
				emit.next(getSelfUpdateStatus());
				const onChange = (event: SelfUpdateEvent) => emit.next(event);
				selfUpdateEmitter.on("status-changed", onChange);
				return () => selfUpdateEmitter.off("status-changed", onChange);
			});
		}),
		getStatus: publicProcedure.query(() => getSelfUpdateStatus()),
		check: publicProcedure.mutation(async () => {
			await checkForUpdates();
		}),
		update: publicProcedure.mutation(() => {
			startUpdate();
		}),
	});
};
```

- [ ] **Step 3: Register both routers**

In `apps/desktop/src/lib/trpc/routers/index.ts`:
- Add imports (alphabetical-ish, near the others):
  ```ts
  import { createAppInfoRouter } from "./app-info";
  import { createSelfUpdateRouter } from "./self-update";
  ```
- Inside `router({ … })` add:
  ```ts
  appInfo: createAppInfoRouter(),
  selfUpdate: createSelfUpdateRouter(),
  ```

- [ ] **Step 4: Typecheck the desktop app**

Run: `cd apps/desktop && bun run gen:build-info && bun run typecheck 2>&1 | tail -20`
Expected: no errors referencing `app-info`, `self-update`, `appInfo`, or `selfUpdate`. (Pre-existing unrelated errors, if any, are out of scope — confirm none are in the new files.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/trpc/routers/app-info.ts \
  apps/desktop/src/lib/trpc/routers/self-update.ts \
  apps/desktop/src/lib/trpc/routers/index.ts
git commit -m "feat(desktop): appInfo + selfUpdate tRPC routers"
```

---

## Task 6: VersionBadge (renderer) + TopBar mount

**Files:**
- Create: `.../TopBar/components/VersionBadge/format.ts`
- Create: `.../TopBar/components/VersionBadge/format.test.ts`
- Create: `.../TopBar/components/VersionBadge/VersionBadge.tsx`
- Create: `.../TopBar/components/VersionBadge/index.ts`
- Modify: `.../TopBar/TopBar.tsx`

(Base path: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge/`)

**Interfaces:**
- Consumes: `electronTrpc` (`renderer/lib/electron-trpc`); `appInfo.get`, `selfUpdate.subscribe`, `selfUpdate.check`, `selfUpdate.update`; `SELF_UPDATE_STATUS`, `SelfUpdateEvent` (`shared/self-update`); `BuildInfo` (`shared/build-info.generated`).
- Produces: `formatBadgeLabel(info, event)`; `<VersionBadge />` React component.

- [ ] **Step 1: Write the failing test for `formatBadgeLabel`**

Create `.../VersionBadge/format.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { SELF_UPDATE_STATUS } from "shared/self-update";
import { formatBadgeLabel } from "./format";

const info = { version: "0.2.0", commit: "535fa20", commitFull: "535fa20", branch: "main", buildDate: "2026-07-10", tag: "v0.2.0" };

describe("formatBadgeLabel", () => {
	test("idle shows version + commit", () => {
		expect(formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.IDLE })).toBe("v0.2.0 · 535fa20");
	});
	test("behind with count", () => {
		expect(formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.BEHIND, behindCount: 3 })).toBe("v0.2.0 · 535fa20 · ↑ 3 behind");
	});
	test("behind with unknown count", () => {
		expect(formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.BEHIND })).toBe("v0.2.0 · 535fa20 · ↑ update");
	});
	test("checking", () => {
		expect(formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.CHECKING })).toBe("v0.2.0 · 535fa20 · checking…");
	});
	test("updating", () => {
		expect(formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.UPDATING })).toBe("v0.2.0 · updating…");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge/format.test.ts`
Expected: FAIL — cannot find `./format`.

- [ ] **Step 3: Implement `format.ts`**

Create `.../VersionBadge/format.ts`:
```ts
import type { BuildInfo } from "shared/build-info.generated";
import { SELF_UPDATE_STATUS, type SelfUpdateEvent } from "shared/self-update";

export function formatBadgeLabel(info: BuildInfo, event: SelfUpdateEvent): string {
	const base = `v${info.version} · ${info.commit}`;
	switch (event.status) {
		case SELF_UPDATE_STATUS.UPDATING:
			return `v${info.version} · updating…`;
		case SELF_UPDATE_STATUS.CHECKING:
			return `${base} · checking…`;
		case SELF_UPDATE_STATUS.BEHIND:
			return event.behindCount && event.behindCount > 0
				? `${base} · ↑ ${event.behindCount} behind`
				: `${base} · ↑ update`;
		default:
			return base;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge/format.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement the component**

Create `.../VersionBadge/VersionBadge.tsx`:
```tsx
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { SELF_UPDATE_STATUS, type SelfUpdateEvent } from "shared/self-update";
import { formatBadgeLabel } from "./format";

export function VersionBadge() {
	const { data: info } = electronTrpc.appInfo.get.useQuery();
	const [event, setEvent] = useState<SelfUpdateEvent>({
		status: SELF_UPDATE_STATUS.IDLE,
	});
	const [open, setOpen] = useState(false);

	electronTrpc.selfUpdate.subscribe.useSubscription(undefined, {
		onData: (e) => setEvent(e),
	});
	const check = electronTrpc.selfUpdate.check.useMutation();
	const update = electronTrpc.selfUpdate.update.useMutation();

	if (!info) return null;

	const behind =
		event.status === SELF_UPDATE_STATUS.BEHIND;
	const busy =
		event.status === SELF_UPDATE_STATUS.CHECKING ||
		event.status === SELF_UPDATE_STATUS.UPDATING;

	return (
		<div className="no-drag relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
					behind
						? "text-amber-600 dark:text-amber-400 hover:bg-muted"
						: "text-muted-foreground hover:bg-muted"
				}`}
				title="Version & updates"
			>
				{formatBadgeLabel(info, event)}
			</button>

			{open && (
				<div className="absolute right-0 top-full mt-1 w-64 rounded-md border border-border bg-popover p-3 shadow-md z-50 text-xs">
					<div className="font-medium text-sm">RyanOS v{info.version}</div>
					<div className="text-muted-foreground mt-0.5">
						{info.branch} · {info.commit}
						{info.buildDate ? ` · ${info.buildDate}` : ""}
					</div>
					{event.status === SELF_UPDATE_STATUS.ERROR && event.error && (
						<div className="mt-2 text-red-500 break-words">{event.error}</div>
					)}
					<div className="mt-3 flex items-center gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => check.mutate()}
							className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50"
						>
							{event.status === SELF_UPDATE_STATUS.CHECKING ? "Checking…" : "Check for updates"}
						</button>
						{behind && (
							<button
								type="button"
								disabled={busy}
								onClick={() => update.mutate()}
								className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
							>
								Update & relaunch
							</button>
						)}
					</div>
					{behind && event.compareUrl && (
						<a
							href={event.compareUrl}
							target="_blank"
							rel="noreferrer"
							className="mt-2 block text-muted-foreground underline"
						>
							{event.behindCount ? `View ${event.behindCount} commits` : "View changes"}
						</a>
					)}
				</div>
			)}
		</div>
	);
}
```

Create `.../VersionBadge/index.ts`:
```ts
export { VersionBadge } from "./VersionBadge";
```

- [ ] **Step 6: Mount in TopBar**

In `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/TopBar.tsx`:
- Add import with the other component imports:
  ```ts
  import { VersionBadge } from "./components/VersionBadge";
  ```
- In the right-side cluster (`<div className="flex items-center gap-3 h-full pr-4 shrink-0">`), add `<VersionBadge />` immediately before `<OrganizationDropdown />`:
  ```tsx
  <VersionBadge />
  <OrganizationDropdown />
  ```

- [ ] **Step 7: Commit**

```bash
git add "apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/VersionBadge" \
  apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/TopBar.tsx
git commit -m "feat(desktop): VersionBadge in TopBar (version + update control)"
```

---

## Task 7: Version bump + tag-release helper

**Files:**
- Create: `apps/desktop/scripts/tag-release.sh`
- Modify: `apps/desktop/package.json` (version → 0.2.0)

**Interfaces:**
- Consumes: none.
- Produces: `tag-release.sh [patch|minor|major|<x.y.z>] [--dry-run]` — bump `apps/desktop/package.json`, commit, annotated tag `v<version>`, push tag.

- [ ] **Step 1: Bump version to 0.2.0**

In `apps/desktop/package.json` set `"version": "0.2.0"` (was `0.1.0`).

- [ ] **Step 2: Write `tag-release.sh`**

Create `apps/desktop/scripts/tag-release.sh`:
```bash
#!/usr/bin/env bash
# Local semver release: bump apps/desktop/package.json, commit, annotated tag, push tag.
# No GitHub Actions / Release object — tags only. Usage:
#   tag-release.sh patch|minor|major|<x.y.z> [--dry-run]
set -euo pipefail

BUMP="${1:-}"; DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1
[ -n "$BUMP" ] || { echo "usage: tag-release.sh patch|minor|major|<x.y.z> [--dry-run]"; exit 2; }

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="$ROOT/apps/desktop/package.json"
CUR="$(node -p "require('$PKG').version")"
IFS='.' read -r MA MI PA <<< "$CUR"
case "$BUMP" in
  patch) NEW="$MA.$MI.$((PA+1))";;
  minor) NEW="$MA.$((MI+1)).0";;
  major) NEW="$((MA+1)).0.0";;
  *) [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad version: $BUMP"; exit 2; }; NEW="$BUMP";;
esac
TAG="v$NEW"
echo "current: $CUR  →  new: $NEW  (tag $TAG)"

if [ "$DRY" -eq 1 ]; then echo "(dry run — no changes)"; exit 0; fi
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo "working tree dirty — commit first"; exit 1; }

node -e "const f='$PKG';const p=require(f);p.version='$NEW';require('fs').writeFileSync(f, JSON.stringify(p,null,'\t')+'\n')"
git -C "$ROOT" add "$PKG"
git -C "$ROOT" commit -m "chore(desktop): release $TAG"
git -C "$ROOT" tag -a "$TAG" -m "RyanOS $TAG"
git -C "$ROOT" push origin HEAD "$TAG"
echo "pushed $TAG"
```

- [ ] **Step 3: Make executable + verify dry-run**

Run:
```bash
chmod +x apps/desktop/scripts/tag-release.sh
apps/desktop/scripts/tag-release.sh minor --dry-run
```
Expected: `current: 0.2.0  →  new: 0.3.0  (tag v0.3.0)` then `(dry run — no changes)`. (Confirms parsing; does NOT tag.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json apps/desktop/scripts/tag-release.sh
git commit -m "chore(desktop): bump to 0.2.0 + local tag-release helper"
```

---

## Task 8: Integration — build, install, tag, live-verify

This task has no unit test; it is the real end-to-end proof (the `verify` ethos). It must run on a **clean working tree** (all prior tasks committed).

- [ ] **Step 1: Regenerate build-info at current HEAD**

Run: `cd apps/desktop && bun run gen:build-info && grep commit src/shared/build-info.generated.ts`
Expected: `commit:`/`commitFull:` show the real current short/long sha (not `dev`).

- [ ] **Step 2: Full local build**

Run (from repo root): `cd apps/desktop && bun run clean:dev && bun run compile:app && CSC_IDENTITY_AUTO_DISCOVERY=false bun run package 2>&1 | tail -5`
Expected: ends with the DMG + zip block-map lines; `release/RyanOS-0.2.0-arm64.dmg` and `release/mac-arm64/RyanOS.app` exist.

- [ ] **Step 3: Install to /Applications**

Run:
```bash
pkill -f "/Applications/RyanOS.app" 2>/dev/null; sleep 1
rm -rf /Applications/RyanOS.app
cp -R apps/desktop/release/mac-arm64/RyanOS.app /Applications/RyanOS.app
xattr -dr com.apple.quarantine /Applications/RyanOS.app 2>/dev/null || true
```

- [ ] **Step 4: Launch and verify the badge**

Run: `open -a /Applications/RyanOS.app` then use the `verify`/`run` skill (or agent-browser desktop automation) to confirm the TopBar shows `v0.2.0 · <sha>`. Confirm the process runs from `/Applications` (`pgrep -lf "/Applications/RyanOS.app/Contents/MacOS/RyanOS"`).

- [ ] **Step 5: Verify "up to date" then "behind" detection**

With local `main` == `origin/main`, open the badge popover → **Check for updates** → expect it stays `v0.2.0 · <sha>` (idle). This proves the check path end-to-end. (A full behind→update→relaunch cycle is validated opportunistically on the next real commit; forcing a synthetic origin commit is optional and out of scope for this step.)

- [ ] **Step 6: Push commits + cut the tag**

Run:
```bash
git push origin main
git tag -a v0.2.0 -m "RyanOS v0.2.0" && git push origin v0.2.0
```
Expected: `main` pushed; `v0.2.0` now points at the current HEAD on the fork (distinct from the historical `v0.1.0`).

- [ ] **Step 7: Final commit (build-info regeneration, if changed)**

```bash
git add apps/desktop/src/shared/build-info.generated.ts
git commit -m "chore(desktop): stamp build-info for v0.2.0" || echo "nothing to commit"
git push origin main
```

---

## Self-Review (completed by author)

- **Spec coverage:** version stamping (Task 1) ✓; in-app display (Task 6) ✓; check/behind detection (Task 3) ✓; detached updater w/ guards + dry-run (Task 4) ✓; markers/log (Task 3+4) ✓; tagging discipline + 0.2.0 bump + reconcile stale tag (Task 7+8) ✓; electron-updater left dormant (untouched) ✓; verification (Task 8) ✓.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `BUILD_INFO`/`BuildInfo` fields identical across Tasks 1/3/5/6; `SELF_UPDATE_STATUS`/`SelfUpdateEvent`/`deriveUpdateState` consistent across Tasks 2/3/5/6; router names `appInfo`/`selfUpdate` consistent Tasks 5/6; script flags `--repo/--app/--pid/--dry-run` consistent Tasks 3/4.
- **Known constraint:** Task 4 Step 3's dirty-tree guard will fire if run mid-plan with uncommitted changes — documented as expected; the real updater always runs post-commit from a clean tree.
