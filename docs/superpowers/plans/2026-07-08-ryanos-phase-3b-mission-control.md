# RyanOS Phase 3B — Mission Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated top-level **Mission Control** screen that tiles Ryan's 5 dashboards as a responsive grid of webviews, each with per-tile reachability status + retry, driven by an editable `~/.ade/mission-control.json` roster.

**Architecture:** A small main-process config accessor (tRPC `missionControl.getDashboards`) reads/seeds the roster JSON. A new TanStack route under `_authenticated/_dashboard/mission-control/` renders a `MissionControlView` grid of `DashboardTile`s. Each tile is a raw Electron `<webview src>` (webviewTag is already enabled — `BrowserPane` uses it) with status from the webview's `did-start-loading`/`did-finish-load`/`did-fail-load` events. Deliberately does NOT reuse `usePersistentWebview` (it's coupled to the tabs/pane store — wrong abstraction for tiles).

**Tech Stack:** TypeScript, Electron (`<webview>` tag), React + TanStack Router, trpc-electron (tRPC for IPC — see `apps/desktop/AGENTS.md`), Bun test.

## Global Constraints

- **Commit discipline:** direct to `main`, every commit prefixed `BRAYNEE_ALLOW_MAIN_COMMITS=1`; push to `origin`. Stage specific paths (`git add <path>`), **never `git add -A`** — a concurrent session (SM Team Phase B) shares this checkout's git history.
- **Disjoint from other workstreams:** touch ONLY the Mission Control files below + the tRPC app-router registration. Do NOT touch `assets/seed-brains/**`, `agent-scaffold.ts`, `seed-*.ts` (3A / SM Team territory).
- **Config path via helper:** the roster JSON lives at `join(getSupersetHomeDir(), "mission-control.json")` (`getSupersetHomeDir` from `main/lib/app-environment.ts`) — never a hardcoded `~`, so an `ADE_HOME_DIR` override still works.
- **tRPC for IPC, observable pattern for any subscription** (per `apps/desktop/AGENTS.md`); `getDashboards` is a plain query, no subscription.
- **UI reality:** Tasks 2–3 are UI — not unit-TDD'd; they're verified by the fresh-reviewer read + the live check (Task 4). Task 1 (config logic) IS unit-tested.
- **The 5-dashboard roster (verbatim seed values):**
  | id | name | url | kind |
  |---|---|---|---|
  | `ops-deck` | Ops Deck | `http://192.168.86.43:8787` | `lan` |
  | `rubypulse` | RubyPulse | `http://192.168.86.28:7420` | `lan` |
  | `mypka` | myPKA Cockpit | `http://localhost:4317` | `localhost` |
  | `catchpad` | CatchPad | `https://catchpad-dash.pages.dev` | `web` |
  | `codehq` | Code HQ | `file:///Users/ryannaquin/Code/dashboard.html` | `file` |

## File Structure

**New:**
- `apps/desktop/src/shared/mission-control-types.ts` — `Dashboard` type + `DashboardKind`.
- `apps/desktop/src/main/lib/mission-control/config.ts` — `DEFAULT_DASHBOARDS` + `readDashboards()` (read-or-seed the JSON).
- `apps/desktop/src/main/lib/mission-control/config.test.ts` — unit tests for read-or-seed.
- `apps/desktop/src/main/lib/mission-control/router.ts` (or beside the other tRPC routers) — the `missionControl` router with `getDashboards`.
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/mission-control/page.tsx` — the route.
- `apps/desktop/src/renderer/screens/main/components/MissionControlView/MissionControlView.tsx` — the grid screen.
- `apps/desktop/src/renderer/screens/main/components/MissionControlView/DashboardTile.tsx` — the tile.
- `apps/desktop/src/renderer/screens/main/components/MissionControlView/index.ts` — barrel export.

**Modified:**
- The tRPC app router (register `missionControl` beside `browser`/`browserHistory`).
- `apps/desktop/src/renderer/screens/main/components/WorkspaceSidebar/WorkspaceSidebar.tsx` (or `TopBar`) — add a "Mission Control" nav entry that routes to `/mission-control`.

---

## Task 1: Roster config + tRPC accessor

**Files:**
- Create: `apps/desktop/src/shared/mission-control-types.ts`
- Create: `apps/desktop/src/main/lib/mission-control/config.ts`
- Create: `apps/desktop/src/main/lib/mission-control/config.test.ts`
- Create/modify: the `missionControl` tRPC router + its registration in the app router.

**Interfaces:**
- Produces: type `Dashboard = { id: string; name: string; url: string; kind: DashboardKind }`, `DashboardKind = "lan" | "localhost" | "web" | "file"`; `readDashboards(): Dashboard[]`; tRPC `missionControl.getDashboards` query returning `Dashboard[]`.
- Consumed by: `MissionControlView` (Task 2) via `electronTrpc.missionControl.getDashboards.useQuery()`.

- [ ] **Step 1: Write the shared type**

```typescript
// apps/desktop/src/shared/mission-control-types.ts
export type DashboardKind = "lan" | "localhost" | "web" | "file";
export interface Dashboard {
	id: string;
	name: string;
	url: string;
	kind: DashboardKind;
}
```

- [ ] **Step 2: Write the failing config test**

```typescript
// apps/desktop/src/main/lib/mission-control/config.test.ts
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_DASHBOARDS, readDashboards } from "./config";

const sandbox = join(tmpdir(), "ade-mc-test");
afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); delete process.env.ADE_HOME_DIR; });

describe("mission-control config", () => {
	it("seeds mission-control.json with the 5 defaults when absent", () => {
		process.env.ADE_HOME_DIR = sandbox;
		mkdirSync(sandbox, { recursive: true });
		const got = readDashboards();
		expect(got).toHaveLength(5);
		expect(got.map((d) => d.id)).toEqual(["ops-deck","rubypulse","mypka","catchpad","codehq"]);
		expect(existsSync(join(sandbox, "mission-control.json"))).toBe(true); // seeded to disk
	});
	it("reads an existing roster and preserves user edits/order", () => {
		process.env.ADE_HOME_DIR = sandbox;
		mkdirSync(sandbox, { recursive: true });
		const custom = [{ id: "x", name: "X", url: "http://x", kind: "web" }];
		writeFileSync(join(sandbox, "mission-control.json"), JSON.stringify(custom));
		expect(readDashboards()).toEqual(custom);
	});
	it("falls back to defaults (does not throw) on malformed JSON", () => {
		process.env.ADE_HOME_DIR = sandbox;
		mkdirSync(sandbox, { recursive: true });
		writeFileSync(join(sandbox, "mission-control.json"), "{ not json");
		expect(readDashboards()).toEqual(DEFAULT_DASHBOARDS);
	});
});
```

Note: confirm `getSupersetHomeDir()` honors `ADE_HOME_DIR` (read `app-environment.ts:16`); if the override env var has a different name, use that name in the test + below.

- [ ] **Step 3: Run test — verify it fails**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/mission-control/config.test.ts`
Expected: FAIL — `Cannot find module "./config"`.

- [ ] **Step 4: Implement the config**

```typescript
// apps/desktop/src/main/lib/mission-control/config.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dashboard } from "../../../shared/mission-control-types";
import { getSupersetHomeDir } from "../app-environment";

export const DEFAULT_DASHBOARDS: Dashboard[] = [
	{ id: "ops-deck", name: "Ops Deck", url: "http://192.168.86.43:8787", kind: "lan" },
	{ id: "rubypulse", name: "RubyPulse", url: "http://192.168.86.28:7420", kind: "lan" },
	{ id: "mypka", name: "myPKA Cockpit", url: "http://localhost:4317", kind: "localhost" },
	{ id: "catchpad", name: "CatchPad", url: "https://catchpad-dash.pages.dev", kind: "web" },
	{ id: "codehq", name: "Code HQ", url: "file:///Users/ryannaquin/Code/dashboard.html", kind: "file" },
];

function configPath(): string {
	return join(getSupersetHomeDir(), "mission-control.json");
}

/** Read the roster; seed the file with defaults if absent; fall back to defaults on any error. */
export function readDashboards(): Dashboard[] {
	const p = configPath();
	try {
		if (!existsSync(p)) {
			writeFileSync(p, `${JSON.stringify(DEFAULT_DASHBOARDS, null, 2)}\n`, "utf8");
			return DEFAULT_DASHBOARDS;
		}
		const parsed = JSON.parse(readFileSync(p, "utf8"));
		return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Dashboard[]) : DEFAULT_DASHBOARDS;
	} catch {
		return DEFAULT_DASHBOARDS;
	}
}
```

- [ ] **Step 5: Run test — verify it passes**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/mission-control/config.test.ts`
Expected: PASS (3 tests). If `electron` import issues arise transitively, they won't here (config.ts imports no electron).

- [ ] **Step 6: Add the tRPC router + register it**

Locate the tRPC app router: the renderer calls `electronTrpc.browser.*` and `electronTrpc.browserHistory.*`, so a `browser`/`browserHistory` router pair is registered in the app router. Find it (`grep -rn "browserHistory" apps/desktop/src/main`) and read one of those routers to copy the exact `publicProcedure` / `router()` factory imports used in this codebase. Then create `missionControl` mirroring that pattern:

```typescript
// apps/desktop/src/main/lib/mission-control/router.ts  (adapt imports to match the existing routers)
import { /* router, publicProcedure — copy from an existing router file */ } from "<the trpc factory used here>";
import { readDashboards } from "./config";

export const missionControlRouter = router({
	getDashboards: publicProcedure.query(() => readDashboards()),
});
```

Register it in the app router alongside `browser`/`browserHistory` (same file that lists them): add `missionControl: missionControlRouter,`.

If the app-router structure is unclear after reading the existing routers, STOP and report NEEDS_CONTEXT with what you found — do not guess at the tRPC factory.

- [ ] **Step 7: Typecheck + commit**

Run: `cd ~/Code/damon-ade/apps/desktop && bunx tsc --noEmit 2>&1 | grep -i "mission-control" || echo "no mission-control type errors"`
```bash
cd ~/Code/damon-ade
git add apps/desktop/src/shared/mission-control-types.ts apps/desktop/src/main/lib/mission-control/
# also stage the app-router file you edited:
git add <the app-router file>
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(3B): mission-control roster config + tRPC getDashboards"
```

---

## Task 2: Mission Control route + grid screen + nav entry

**Files:**
- Create: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/mission-control/page.tsx`
- Create: `apps/desktop/src/renderer/screens/main/components/MissionControlView/MissionControlView.tsx`
- Create: `apps/desktop/src/renderer/screens/main/components/MissionControlView/index.ts`
- Modify: `WorkspaceSidebar.tsx` (or `TopBar`) — add the nav entry.

**Interfaces:**
- Consumes: `electronTrpc.missionControl.getDashboards.useQuery()` (Task 1).
- Produces: a reachable `/mission-control` route rendering a responsive grid; renders one `<DashboardTile dashboard={d}/>` per roster entry (Task 3 supplies the tile — in this task, render a simple placeholder box per dashboard so the grid + routing are verifiable independently).

- [ ] **Step 1: Create the route**

Mirror an existing `_dashboard` page route (read `renderer/routes/_authenticated/_dashboard/workspace/page.tsx` for the exact `createFileRoute` path string + export shape). Create:
```tsx
// apps/desktop/src/renderer/routes/_authenticated/_dashboard/mission-control/page.tsx
import { createFileRoute } from "@tanstack/react-router";
import { MissionControlView } from "renderer/screens/main/components/MissionControlView";

export const Route = createFileRoute("/_authenticated/_dashboard/mission-control/")({
	component: MissionControlView,
});
```
(Adjust the route path string to match the file-route convention the sibling `workspace`/`tasks` pages use.)

- [ ] **Step 2: Create the grid screen (placeholder tiles for now)**

```tsx
// apps/desktop/src/renderer/screens/main/components/MissionControlView/MissionControlView.tsx
import { electronTrpc } from "renderer/lib/electron-trpc";

export function MissionControlView() {
	const { data: dashboards = [] } = electronTrpc.missionControl.getDashboards.useQuery();
	return (
		<div className="h-full w-full overflow-auto p-3">
			<div
				className="grid gap-3"
				style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gridAutoRows: "minmax(320px, 1fr)" }}
			>
				{dashboards.map((d) => (
					// Task 3 replaces this placeholder with <DashboardTile dashboard={d} />
					<div key={d.id} className="rounded-lg border border-white/10 bg-black/20 p-2 text-sm">
						{d.name} — {d.url}
					</div>
				))}
			</div>
		</div>
	);
}
```
Add `index.ts` re-exporting `MissionControlView`. Follow the codebase's styling convention (Tailwind classes are used elsewhere — match the surrounding components; adjust class names to the real design tokens).

- [ ] **Step 3: Add the nav entry**

Read `WorkspaceSidebar.tsx` to see how it renders nav/route links (it lists workspaces; there may be a fixed section above/below for non-workspace destinations). Add a "Mission Control" entry (icon + label) that navigates to the `/mission-control` route via TanStack `<Link>`/`navigate`. If the sidebar has no natural spot for a global destination, add it to `TopBar` instead (read `_dashboard/components/TopBar`). Keep it minimal and consistent with existing entries.

- [ ] **Step 4: Verify routing renders**

Run the app (`cd apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev`) OR, if not running it here, report that Step 4 is verified in Task 4's live check. Expected when run: clicking the nav entry shows the grid with 5 placeholder boxes (names + URLs).

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | grep -iE "MissionControl|mission-control" || echo "clean"`
```bash
cd ~/Code/damon-ade
git add apps/desktop/src/renderer/routes/_authenticated/_dashboard/mission-control apps/desktop/src/renderer/screens/main/components/MissionControlView
git add <the sidebar/topbar file you edited>
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(3B): Mission Control route + grid screen + nav entry"
```

---

## Task 3: DashboardTile (webview + status + retry + pop-out)

**Files:**
- Create: `apps/desktop/src/renderer/screens/main/components/MissionControlView/DashboardTile.tsx`
- Modify: `MissionControlView.tsx` (swap the placeholder for `<DashboardTile dashboard={d}/>`)

**Interfaces:**
- Consumes: `Dashboard` (shared type).
- Produces: `DashboardTile` — a titled tile embedding the dashboard as a `<webview>`, with a status dot (loading/live/unreachable) from webview load events, a Retry (reload) on failure, and a pop-out (open URL externally).

- [ ] **Step 1: Implement the tile**

The webview tag is already enabled in this renderer (`BrowserPane` uses `Electron.WebviewTag`). Read `BrowserPane`'s JSX once to copy the exact `<webview>` attributes this app requires (e.g. `partition`, `allowpopups`, `webpreferences` for `file://`). Then:

```tsx
// apps/desktop/src/renderer/screens/main/components/MissionControlView/DashboardTile.tsx
import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "shared/mission-control-types";

type Status = "loading" | "live" | "unreachable";

const STATUS_DOT: Record<Status, string> = {
	loading: "bg-yellow-400",
	live: "bg-green-500",
	unreachable: "bg-red-500",
};
const UNREACHABLE_HINT: Record<Dashboard["kind"], string> = {
	lan: "On the home network?",
	localhost: "Local server running?",
	web: "Check the URL / login.",
	file: "File not found.",
};

export function DashboardTile({ dashboard }: { dashboard: Dashboard }) {
	const ref = useRef<Electron.WebviewTag | null>(null);
	const [status, setStatus] = useState<Status>("loading");
	const [nonce, setNonce] = useState(0); // bump to force reload

	useEffect(() => {
		const wv = ref.current;
		if (!wv) return;
		const onStart = () => setStatus("loading");
		const onFinish = () => setStatus("live");
		const onFail = (e: Electron.DidFailLoadEvent) => {
			// errorCode -3 = ERR_ABORTED (normal on in-page nav) — ignore
			if (e.errorCode !== -3) setStatus("unreachable");
		};
		wv.addEventListener("did-start-loading", onStart);
		wv.addEventListener("did-finish-load", onFinish);
		wv.addEventListener("did-fail-load", onFail);
		return () => {
			wv.removeEventListener("did-start-loading", onStart);
			wv.removeEventListener("did-finish-load", onFinish);
			wv.removeEventListener("did-fail-load", onFail);
		};
	}, [nonce]);

	const retry = () => { setStatus("loading"); setNonce((n) => n + 1); };
	const popOut = () => window.open(dashboard.url, "_blank");

	return (
		<div className="flex h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black/20">
			<div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-sm">
				<span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
				<span className="font-medium">{dashboard.name}</span>
				<span className="ml-auto flex gap-2">
					<button type="button" onClick={retry} title="Reload">↻</button>
					<button type="button" onClick={popOut} title="Open externally">⇱</button>
				</span>
			</div>
			<div className="relative flex-1">
				{status === "unreachable" && (
					<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/40 text-center text-sm">
						<div className="opacity-70">Unreachable — {UNREACHABLE_HINT[dashboard.kind]}</div>
						<div className="text-xs opacity-50">{dashboard.url}</div>
						<button type="button" onClick={retry} className="rounded border border-white/20 px-3 py-1">Retry</button>
					</div>
				)}
				{/* @ts-expect-error — Electron <webview> is not in React's JSX types */}
				<webview
					key={nonce}
					ref={ref as never}
					src={dashboard.url}
					style={{ width: "100%", height: "100%" }}
					/* copy any required attrs (partition/allowpopups/webpreferences) from BrowserPane */
				/>
			</div>
		</div>
	);
}
```

Adjust class names / button elements to the app's real design system + icon components (the `↻`/`⇱` glyphs are placeholders — use the icon set the rest of the UI uses). Confirm the `file://` tile (Code HQ) loads; if it needs `webpreferences="allowFileAccess=yes"` or similar on the tag, add it (spec §8).

- [ ] **Step 2: Swap the placeholder in the grid**

In `MissionControlView.tsx`, replace the placeholder `<div>` with `<DashboardTile key={d.id} dashboard={d} />` and import it.

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | grep -iE "DashboardTile|MissionControl" || echo "clean"`
```bash
cd ~/Code/damon-ade
git add apps/desktop/src/renderer/screens/main/components/MissionControlView
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(3B): DashboardTile — webview + reachability status + retry + pop-out"
```

---

## Task 4: Live verification

**Files:** none committed.

- [ ] **Step 1: Launch + open Mission Control**

```bash
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```
(No re-seed needed — 3B doesn't touch agents/seed. If a re-seed happens for other reasons, coordinate first.) Click the Mission Control nav entry.

- [ ] **Step 2: Verify tiles + reachability**

- All 5 tiles render in the grid.
- **RubyPulse** (`192.168.86.28:7420`) + **Code HQ** (`file://…/dashboard.html`) → status **live**, content visible.
- **myPKA** (if `localhost:4317` down) + **Ops Deck** (if off-LAN) → **unreachable** empty state + hint; start the myPKA server (`cd <myPKA>; PORT=4317 … node server/server.js`) and hit **Retry** → flips to **live**.
- **CatchPad** → renders the Cloudflare Access login (or the dashboard if authed). If it hard-blocks embedding, confirm **pop-out** opens it externally (spec §8 fallback).
- **Pop-out** on any tile opens the dashboard externally.
- Confirm `~/.ade/mission-control.json` was seeded with the 5 entries; edit it (reorder) → reload the app → grid reflects the new order.

- [ ] **Step 3: Ryan acceptance + wrap**

Ryan confirms the command-center works. Then invoke `wrap` (STATUS.md), update `[[project_ryanos]]` + `.claude/HANDOFF.md` to mark Phase 3B shipped, and push. Note any build-time findings (Cloudflare-Access-in-webview, `file://` flags) in the handoff.

---

## Self-Review

**Spec coverage (against phase-3b-design.md):**
- §2 roster (5, config-driven) → Task 1 (`DEFAULT_DASHBOARDS` + `readDashboards` + tRPC). ✓
- §3 placement (top-level route + nav) → Task 2. ✓  layout (responsive grid) → Task 2 grid. ✓  per-tile title/status/refresh/pop-out → Task 3. ✓  reachability states from load events → Task 3. ✓  config at `~/.ade/mission-control.json` → Task 1. ✓
- §4 reuse: uses `<webview>` tag directly (NOT the pane-coupled `usePersistentWebview`) — a correction from the spec's wording, same intent (embed via the existing webview capability); noted in Architecture. ✓
- §6 verification → Task 4. ✓  §8 risks (file://, Cloudflare Access, ADE_HOME_DIR helper) → addressed in Tasks 1/3/4. ✓
- **Deferred to v2 (spec §7):** cross-route webview warmth (v1 reloads on return — plain `<webview>`, no persistent registry), drag/resize, in-app CRUD. Called out so it's a conscious scope line, not a silent gap.

**Placeholder scan:** Task 1 Step 6 leaves the tRPC factory import as "copy from the existing router" — that's a locate-and-mirror instruction with an escalation path (NEEDS_CONTEXT), not a plan gap, because the app-router structure wasn't fully traced during planning. Everything else is concrete.

**Type/identifier consistency:** `Dashboard`/`DashboardKind` from `shared/mission-control-types` used in config, router, view, tile. `missionControl.getDashboards` named identically in Task 1 (produce) and Task 2 (consume). Roster ids (`ops-deck`/`rubypulse`/`mypka`/`catchpad`/`codehq`) identical in the constant, the test, and the verification.
