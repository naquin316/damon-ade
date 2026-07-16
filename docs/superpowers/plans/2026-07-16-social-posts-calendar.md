# Social Posts Calendar (RYA-200) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a calendar view to the social-media approvals viewer so Ryan can see what's scheduled on which day/time, browse publishing history with live links, and edit a post directly from the calendar.

**Architecture:** The heavy logic — mapping notes to calendar events and bucketing them into a month/week grid in Central time — lives in a NEW pure, unit-tested module `calendar.ts` (matching the `approval-queue/` "pure tested core" discipline). A thin new `/api/calendar` endpoint in `queue-server.ts` reuses the existing `buildCard` pass, maps cards to calendar events, and calls the lib. The browser renders the returned grid with vanilla inline JS/CSS (no libraries, no build step — same as the rest of the page) and reuses the EXISTING edit modal (`openEdit` + `/api/edit`) for inline editing. The card grid stays exactly as-is behind a Grid/Calendar view toggle.

**Tech Stack:** Bun (runtime for the server script), TypeScript (pure lib + endpoint), `bun:test`, vanilla browser JS/CSS inlined in `queue-server.ts`'s `PAGE` template string. No new dependencies.

## Global Constraints

- **No new dependencies / no build step.** The viewer is a single self-contained `bun` script serving one inline HTML page; the calendar is hand-rolled vanilla JS/CSS, not a calendar library.
- **Central time (`America/Chicago`) for all bucketing and display**, matching the existing `fmtWhen`. Compute tz-local dates with `Intl.DateTimeFormat`, never naive `Date` slicing.
- **Reuse, don't duplicate.** Inline edit reuses the existing `openEdit(file)` modal and `/api/edit` (already byte-surgical via `upsertFrontmatter` + `replaceCopySection`). Do NOT add a second edit path or yaml-roundtrip.
- **Don't break the existing grid.** The card grid, filters, approve/skip/edit, and intake modal must keep working unchanged; the calendar is additive behind a view toggle.
- **One surface (The Conn v2).** Everything stays inside `queue-server.ts`; no second page/dashboard (2026-07-12 consolidation decision).
- **Pure lib stays pure:** `calendar.ts` must not import Electron, do I/O, or call `Date.now()`/argless `new Date()` inside its exported functions — the caller injects `today`. This keeps it deterministically testable.
- **Never commit `apps/desktop/src/shared/build-info.generated.ts`** (regenerated on every typecheck/dev run).
- **Direct-to-main:** commit with `BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit`, push with `BRAYNEE_ALLOW_MAIN_PUSH=1 git push`.
- Run all commands from `apps/desktop/` unless noted. Typecheck with `npx tsc --noEmit` (expect clean apart from the ignored `build-info.generated.ts`). The viewer restarts with `pkill -f queue-server.ts` then `nohup ./scripts/queue-server.sh > /tmp/queue-server.log 2>&1 &` from the repo root.

---

## File Structure

- **Create** `apps/desktop/src/main/lib/approval-queue/calendar.ts` — pure calendar model: `centralDate`, `buildMonthGrid`, `buildWeekGrid`, and the `CalEvent`/`CalDay`/`CalGrid` types. One responsibility: turn a flat list of dated events into a rendered-ready grid.
- **Create** `apps/desktop/src/main/lib/approval-queue/calendar.test.ts` — unit tests for the above.
- **Modify** `apps/desktop/scripts/queue-server.ts`:
  - Add the `/api/calendar` route (near the `/api/queue` route at ~line 331).
  - Add calendar CSS (in the `<style>` block).
  - Add the Grid/Calendar view toggle to `<header>` and a `<main>`-level calendar container.
  - Add client JS: `loadCalendar`, calendar render, nav, event interactions, and a `refresh()` dispatcher; wire the existing `submitEdit`/`act` success paths to `refresh()`.

---

## Task 1: Pure calendar model — `centralDate` + `buildMonthGrid`

**Files:**
- Create: `apps/desktop/src/main/lib/approval-queue/calendar.ts`
- Test: `apps/desktop/src/main/lib/approval-queue/calendar.test.ts`

**Interfaces:**
- Produces (later tasks + the endpoint rely on these EXACT names/types):
  - `type CalKind = "scheduled" | "published"`
  - `interface CalEvent { file: string; slug: string; whenISO: string; kind: CalKind; platforms: string[]; media: string | null; copy: string | null; urls: string[] }`
  - `interface CalDay { date: string; inRange: boolean; isToday: boolean; events: CalEvent[] }`
  - `interface CalGrid { view: "month" | "week"; anchor: string; title: string; weeks: CalDay[][] }`
  - `function centralDate(iso: string, tz?: string): string | null`
  - `function buildMonthGrid(events: CalEvent[], anchor: string, today: string, tz?: string): CalGrid`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/main/lib/approval-queue/calendar.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
	buildMonthGrid,
	type CalEvent,
	centralDate,
} from "./calendar";

function ev(over: Partial<CalEvent> = {}): CalEvent {
	return {
		file: "/q/a.md",
		slug: "a",
		whenISO: "2026-07-15T14:00:00.000Z",
		kind: "scheduled",
		platforms: ["instagram"],
		media: null,
		copy: null,
		urls: [],
		...over,
	};
}

describe("centralDate — tz-correct calendar day", () => {
	test("an ISO instant maps to its America/Chicago date", () => {
		// 2026-07-16T00:19:52Z is 2026-07-15 19:19 Central (CDT, -5) — the real yeti post.
		expect(centralDate("2026-07-16T00:19:52.758Z")).toBe("2026-07-15");
	});
	test("a daytime UTC instant stays the same Central day", () => {
		expect(centralDate("2026-07-15T14:00:00.000Z")).toBe("2026-07-15");
	});
	test("unparseable -> null", () => {
		expect(centralDate("not a date")).toBeNull();
	});
});

describe("buildMonthGrid", () => {
	test("July 2026 is a 6x7 grid starting on the Sunday on/before the 1st", () => {
		const g = buildMonthGrid([], "2026-07-10", "2026-07-16");
		expect(g.view).toBe("month");
		expect(g.title).toBe("July 2026");
		expect(g.weeks.length).toBe(6);
		expect(g.weeks.every((w) => w.length === 7)).toBe(true);
		// July 1 2026 is a Wednesday, so the first cell is Sunday June 28.
		expect(g.weeks[0][0].date).toBe("2026-06-28");
		expect(g.weeks[0][0].inRange).toBe(false);
		// July 1 sits at column index 3 (Wed) of week 0.
		expect(g.weeks[0][3].date).toBe("2026-07-01");
		expect(g.weeks[0][3].inRange).toBe(true);
	});

	test("today is flagged", () => {
		const g = buildMonthGrid([], "2026-07-10", "2026-07-16");
		const days = g.weeks.flat();
		expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual([
			"2026-07-16",
		]);
	});

	test("an event lands on its CENTRAL day, not its UTC day", () => {
		const g = buildMonthGrid(
			[ev({ whenISO: "2026-07-16T00:19:52.758Z" })],
			"2026-07-10",
			"2026-07-16",
		);
		const july15 = g.weeks.flat().find((d) => d.date === "2026-07-15")!;
		const july16 = g.weeks.flat().find((d) => d.date === "2026-07-16")!;
		expect(july15.events.map((e) => e.file)).toEqual(["/q/a.md"]);
		expect(july16.events).toEqual([]);
	});

	test("multiple events on a day are sorted by time ascending", () => {
		const g = buildMonthGrid(
			[
				ev({ file: "/q/late.md", whenISO: "2026-07-15T20:00:00.000Z" }),
				ev({ file: "/q/early.md", whenISO: "2026-07-15T14:00:00.000Z" }),
			],
			"2026-07-10",
			"2026-07-16",
		);
		const day = g.weeks.flat().find((d) => d.date === "2026-07-15")!;
		expect(day.events.map((e) => e.file)).toEqual(["/q/early.md", "/q/late.md"]);
	});

	test("an event outside the visible grid is dropped, not thrown", () => {
		const g = buildMonthGrid(
			[ev({ whenISO: "2026-01-01T14:00:00.000Z" })],
			"2026-07-10",
			"2026-07-16",
		);
		expect(g.weeks.flat().every((d) => d.events.length === 0)).toBe(true);
	});

	test("an event with an unparseable whenISO is dropped, not thrown", () => {
		const g = buildMonthGrid([ev({ whenISO: "nope" })], "2026-07-10", "2026-07-16");
		expect(g.weeks.flat().every((d) => d.events.length === 0)).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/main/lib/approval-queue/calendar.test.ts`
Expected: FAIL — `Cannot find module './calendar'`.

- [ ] **Step 3: Write the implementation**

Create `apps/desktop/src/main/lib/approval-queue/calendar.ts`:

```typescript
/**
 * Pure calendar model for the social-posts calendar (RYA-200).
 *
 * Turns a flat list of dated events into a render-ready month/week grid, bucketed by
 * Central-time calendar day. No I/O, no Electron, no ambient clock — the caller injects
 * `today` — so the whole thing is deterministically unit-testable, matching the rest of
 * approval-queue/.
 */

const TZ = "America/Chicago";

export type CalKind = "scheduled" | "published";

export interface CalEvent {
	file: string;
	slug: string;
	/** The ISO instant this event sits at (a note's scheduled_time). */
	whenISO: string;
	kind: CalKind;
	platforms: string[];
	media: string | null;
	copy: string | null;
	/** Live post URLs, for published events. */
	urls: string[];
}

export interface CalDay {
	/** YYYY-MM-DD in the display tz. */
	date: string;
	/** Part of the focused month (month view). Always true in week view. */
	inRange: boolean;
	isToday: boolean;
	/** Events on this day, sorted by whenISO ascending. */
	events: CalEvent[];
}

export interface CalGrid {
	view: "month" | "week";
	/** The YYYY-MM-DD the grid was built around. */
	anchor: string;
	/** Human title, e.g. "July 2026" or "Jul 13 – 19, 2026". */
	title: string;
	weeks: CalDay[][];
}

/** The tz-local YYYY-MM-DD for an ISO instant, or null if it doesn't parse. */
export function centralDate(iso: string, tz: string = TZ): string | null {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return null;
	// en-CA formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(t));
}

/** Add `days` to a YYYY-MM-DD, returning YYYY-MM-DD. Uses UTC-noon arithmetic so DST
 *  never shifts the calendar date. */
function addDays(ymd: string, days: number): string {
	const d = new Date(`${ymd}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Day-of-week 0..6 (Sun..Sat) for a YYYY-MM-DD. */
function weekday(ymd: string): number {
	return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** Bucket events by their Central day into a lookup. */
function bucket(events: CalEvent[], tz: string): Map<string, CalEvent[]> {
	const m = new Map<string, CalEvent[]>();
	for (const e of events) {
		const d = centralDate(e.whenISO, tz);
		if (!d) continue;
		const list = m.get(d) ?? [];
		list.push(e);
		m.set(d, list);
	}
	for (const list of m.values())
		list.sort((a, b) => Date.parse(a.whenISO) - Date.parse(b.whenISO));
	return m;
}

function makeDay(
	date: string,
	inRange: boolean,
	today: string,
	byDay: Map<string, CalEvent[]>,
): CalDay {
	return {
		date,
		inRange,
		isToday: date === today,
		events: byDay.get(date) ?? [],
	};
}

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

export function buildMonthGrid(
	events: CalEvent[],
	anchor: string,
	today: string,
	tz: string = TZ,
): CalGrid {
	const byDay = bucket(events, tz);
	const year = Number(anchor.slice(0, 4));
	const month = Number(anchor.slice(5, 7)); // 1..12
	const first = `${anchor.slice(0, 7)}-01`;
	// First visible cell = the Sunday on/before the 1st.
	const start = addDays(first, -weekday(first));

	const weeks: CalDay[][] = [];
	let cursor = start;
	for (let w = 0; w < 6; w += 1) {
		const week: CalDay[] = [];
		for (let d = 0; d < 7; d += 1) {
			const inRange = Number(cursor.slice(5, 7)) === month;
			week.push(makeDay(cursor, inRange, today, byDay));
			cursor = addDays(cursor, 1);
		}
		weeks.push(week);
	}

	return {
		view: "month",
		anchor,
		title: `${MONTHS[month - 1]} ${year}`,
		weeks,
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/main/lib/approval-queue/calendar.test.ts`
Expected: PASS (all `centralDate` + `buildMonthGrid` tests green).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v build-info; echo done`
Expected: no errors (only `done`).

- [ ] **Step 6: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add apps/desktop/src/main/lib/approval-queue/calendar.ts apps/desktop/src/main/lib/approval-queue/calendar.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(calendar): pure month-grid model (RYA-200), tz-correct bucketing"
```

---

## Task 2: Pure calendar model — `buildWeekGrid`

**Files:**
- Modify: `apps/desktop/src/main/lib/approval-queue/calendar.ts`
- Test: `apps/desktop/src/main/lib/approval-queue/calendar.test.ts`

**Interfaces:**
- Consumes: everything from Task 1 (`CalEvent`, `CalGrid`, `centralDate`, the private `addDays`/`weekday`/`bucket`/`makeDay` already in the file).
- Produces: `function buildWeekGrid(events: CalEvent[], anchor: string, today: string, tz?: string): CalGrid`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/main/lib/approval-queue/calendar.test.ts`:

```typescript
import { buildWeekGrid } from "./calendar";

describe("buildWeekGrid", () => {
	test("one Sun..Sat week containing the anchor, all days inRange", () => {
		// 2026-07-16 is a Thursday; its week is Sun Jul 12 .. Sat Jul 18.
		const g = buildWeekGrid([], "2026-07-16", "2026-07-16");
		expect(g.view).toBe("week");
		expect(g.weeks.length).toBe(1);
		expect(g.weeks[0].length).toBe(7);
		expect(g.weeks[0][0].date).toBe("2026-07-12");
		expect(g.weeks[0][6].date).toBe("2026-07-18");
		expect(g.weeks[0].every((d) => d.inRange)).toBe(true);
		expect(g.title).toBe("Jul 12 – 18, 2026");
	});

	test("places an event on its Central day within the week", () => {
		const g = buildWeekGrid(
			[ev({ whenISO: "2026-07-16T00:19:52.758Z" })],
			"2026-07-16",
			"2026-07-16",
		);
		const day = g.weeks[0].find((d) => d.date === "2026-07-15")!;
		expect(day.events.length).toBe(1);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/main/lib/approval-queue/calendar.test.ts`
Expected: FAIL — `buildWeekGrid` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `apps/desktop/src/main/lib/approval-queue/calendar.ts`:

```typescript
const MON_SHORT = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function buildWeekGrid(
	events: CalEvent[],
	anchor: string,
	today: string,
	tz: string = TZ,
): CalGrid {
	const byDay = bucket(events, tz);
	const start = addDays(anchor, -weekday(anchor)); // Sunday of the anchor's week
	const week: CalDay[] = [];
	let cursor = start;
	for (let d = 0; d < 7; d += 1) {
		week.push(makeDay(cursor, true, today, byDay));
		cursor = addDays(cursor, 1);
	}
	const end = addDays(start, 6);
	const sM = MON_SHORT[Number(start.slice(5, 7)) - 1];
	const eM = MON_SHORT[Number(end.slice(5, 7)) - 1];
	const sD = Number(start.slice(8, 10));
	const eD = Number(end.slice(8, 10));
	const year = end.slice(0, 4);
	const title =
		sM === eM
			? `${sM} ${sD} – ${eD}, ${year}`
			: `${sM} ${sD} – ${eM} ${eD}, ${year}`;

	return { view: "week", anchor, title, weeks: [week] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/main/lib/approval-queue/calendar.test.ts`
Expected: PASS (month + week suites green).

- [ ] **Step 5: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add apps/desktop/src/main/lib/approval-queue/calendar.ts apps/desktop/src/main/lib/approval-queue/calendar.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(calendar): pure week-grid model (RYA-200)"
```

---

## Task 3: `/api/calendar` endpoint

**Files:**
- Modify: `apps/desktop/scripts/queue-server.ts` (add import; add route after the `/api/queue` block ~line 349)

**Interfaces:**
- Consumes: `buildMonthGrid`, `buildWeekGrid`, `centralDate`, `type CalEvent` from `calendar.ts`; the existing `buildCard`, `listNotes`, `loadConnected` in `queue-server.ts`.
- Produces: `GET /api/calendar?view=month|week&anchor=YYYY-MM-DD` → a `CalGrid` JSON.

- [ ] **Step 1: Add the import**

At the top of `queue-server.ts`, alongside the other `approval-queue` imports (near line 32), add:

```typescript
import {
	buildMonthGrid,
	buildWeekGrid,
	type CalEvent,
	centralDate,
} from "../src/main/lib/approval-queue/calendar";
```

- [ ] **Step 2: Add the route**

Immediately after the closing `}` of the `if (url.pathname === "/api/queue") { ... }` block (~line 349), insert:

```typescript
			// Calendar model: scheduled + published notes bucketed into a month/week
			// grid (Central time). Reuses buildCard so the calendar shows exactly what
			// the grid does, then maps to the pure calendar lib.
			if (url.pathname === "/api/calendar") {
				const connected = await loadConnected();
				const view = url.searchParams.get("view") === "week" ? "week" : "month";
				const today =
					centralDate(new Date().toISOString()) ?? "1970-01-01";
				const anchor = /^\d{4}-\d{2}-\d{2}$/.test(
					url.searchParams.get("anchor") ?? "",
				)
					? (url.searchParams.get("anchor") as string)
					: today;

				const events: CalEvent[] = listNotes()
					.map((f) => buildCard(f, readFileSync(f, "utf8"), connected))
					.filter(
						(c) =>
							(c.status === "scheduled" || c.status === "published") &&
							!!c.scheduledTime,
					)
					.map((c) => ({
						file: c.file,
						slug: c.slug,
						whenISO: c.scheduledTime as string,
						kind: c.status === "published" ? "published" : "scheduled",
						platforms: c.platforms,
						media: c.media,
						copy: c.copy,
						urls: c.publishedUrls,
					}));

				const grid =
					view === "week"
						? buildWeekGrid(events, anchor, today)
						: buildMonthGrid(events, anchor, today);
				return Response.json(grid);
			}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v build-info; echo done`
Expected: no errors (only `done`).

- [ ] **Step 4: Restart the viewer and verify the endpoint**

```bash
cd /Users/ryannaquin/Code/damon-ade
pkill -f queue-server.ts 2>/dev/null; sleep 1
nohup ./scripts/queue-server.sh > /tmp/queue-server.log 2>&1 &
sleep 3
curl -s "http://localhost:4319/api/calendar?view=month&anchor=2026-07-16" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const g=JSON.parse(s);console.log("view",g.view,"title",g.title,"weeks",g.weeks.length);const evs=g.weeks.flat().flatMap(d=>d.events.map(e=>d.date+" "+e.kind+" "+e.slug));console.log(evs.join("\n")||"(no events)");})'
```
Expected: `view month title July 2026 weeks 6`, and the published yeti note listed on `2026-07-15` as `published` (plus any other scheduled/published notes).

- [ ] **Step 5: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add apps/desktop/scripts/queue-server.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(calendar): /api/calendar endpoint over the pure grid model"
```

---

## Task 4: Calendar view — toggle, CSS, read-only month render

**Files:**
- Modify: `apps/desktop/scripts/queue-server.ts` (the `PAGE` template: `<style>`, `<header>`, `<main>`, and the client `<script>`)

**Interfaces:**
- Consumes: `/api/calendar` (Task 3); the existing client globals `esc`, `fmtLocal`.
- Produces: client globals `viewMode` (`"grid" | "calendar"`), `calView` (`"month" | "week"`), `calAnchor` (YYYY-MM-DD string), and functions `setViewMode(m)`, `loadCalendar()`, `renderCalendar(grid)`.

- [ ] **Step 1: Add calendar CSS**

In the `<style>` block (before `</style>`, ~line 656), add:

```css
  .viewtoggle{display:inline-flex;gap:.3rem;margin-left:.6rem}
  .viewtoggle button{font-family:var(--sans);font-size:.78rem;color:var(--muted);background:transparent;
    border:1px solid var(--border);border-radius:999px;padding:.2rem .7rem;cursor:pointer}
  .viewtoggle button.on{color:var(--ink);border-color:var(--primary);background:rgba(74,144,226,.12)}
  #calendar{max-width:1180px;margin:0 auto;padding:1.25rem;display:none}
  #calendar.on{display:block}
  .calbar{display:flex;align-items:center;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap}
  .calbar .caltitle{font-size:1rem;font-weight:700;min-width:11rem}
  .calbar button{font-family:var(--sans);font-size:.8rem;color:var(--ink);background:var(--card);
    border:1px solid var(--border);border-radius:var(--r);padding:.3rem .6rem;cursor:pointer}
  .calbar .spacer{flex:1}
  .calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);
    border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
  .caldow{background:var(--ground);color:var(--muted);font-family:var(--mono);font-size:.68rem;
    text-align:center;padding:.35rem 0}
  .calday{background:var(--card);min-height:6.5rem;padding:.3rem;display:flex;flex-direction:column;gap:.25rem}
  .calday.out{background:#1e1e1e}
  .calday .dnum{font-size:.72rem;color:var(--muted);font-family:var(--mono)}
  .calday.out .dnum{opacity:.5}
  .calday.today .dnum{color:var(--primary);font-weight:700}
  .calweek .calday{min-height:12rem}
  .calev{border-left:3px solid var(--muted);background:var(--ground);border-radius:.2rem;
    padding:.2rem .35rem;font-size:.7rem;color:var(--ink);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .calev.scheduled{border-left-color:var(--primary)} .calev.published{border-left-color:var(--ok)}
  .calev .evtime{font-family:var(--mono);color:var(--muted);margin-right:.3rem}
  .calpop{position:fixed;z-index:30;background:var(--card);border:1px solid var(--border);border-radius:var(--r);
    padding:.7rem;max-width:280px;display:none;flex-direction:column;gap:.35rem;box-shadow:0 8px 24px rgba(0,0,0,.5)}
  .calpop.on{display:flex}
  .calpop .pcopy{font-family:var(--serif);font-size:.82rem;color:#e6e6e6;max-height:6rem;overflow:hidden}
  .calpop a{font-size:.76rem;color:var(--muted);text-decoration:none} .calpop a:hover{color:var(--ink)}
```

- [ ] **Step 2: Add the view toggle + calendar container to the HTML**

In `<header>` (~line 661), change the `<h1>` line to include a toggle. Find:

```html
  <h1>Approvals <span style="color:var(--muted);font-weight:400">· The Conn</span></h1>
```

Replace with:

```html
  <h1>Approvals <span style="color:var(--muted);font-weight:400">· The Conn</span>
    <span class="viewtoggle"><button id="vt-grid" class="on" onclick="setViewMode('grid')">Grid</button><button id="vt-cal" onclick="setViewMode('calendar')">Calendar</button></span>
  </h1>
```

Immediately after the `<main id="grid">...</main>` line (~line 667), add the calendar container:

```html
<section id="calendar">
  <div class="calbar">
    <button onclick="calNav(-1)">‹</button>
    <button onclick="calToday()">Today</button>
    <button onclick="calNav(1)">›</button>
    <span class="caltitle" id="calTitle">…</span>
    <span class="spacer"></span>
    <span class="viewtoggle"><button id="cv-month" class="on" onclick="setCalView('month')">Month</button><button id="cv-week" onclick="setCalView('week')">Week</button></span>
  </div>
  <div id="calBody"></div>
</section>
<div class="calpop" id="calPop"></div>
```

- [ ] **Step 3: Add the client JS (state, toggle, load, render)**

Just before the `function setFilter(k){...}` line (~line 950), add:

```javascript
// ── calendar view ──
let viewMode="grid", calView="month", calAnchor=null;
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function todayYMD(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function setViewMode(m){
  viewMode=m;
  document.getElementById("vt-grid").classList.toggle("on",m==="grid");
  document.getElementById("vt-cal").classList.toggle("on",m==="calendar");
  document.getElementById("grid").style.display=m==="grid"?"":"none";
  document.getElementById("filters").style.display=m==="grid"?"":"none";
  document.getElementById("calendar").classList.toggle("on",m==="calendar");
  if(m==="calendar"){ if(!calAnchor) calAnchor=todayYMD(); loadCalendar(); }
}
function setCalView(v){calView=v;document.getElementById("cv-month").classList.toggle("on",v==="month");document.getElementById("cv-week").classList.toggle("on",v==="week");loadCalendar();}
function calToday(){calAnchor=todayYMD();loadCalendar();}
function calNav(dir){
  const d=new Date(calAnchor+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+dir*(calView==="week"?7:0));
  if(calView==="month") d.setUTCMonth(d.getUTCMonth()+dir);
  calAnchor=d.toISOString().slice(0,10);
  loadCalendar();
}
async function loadCalendar(){
  const r=await fetch("/api/calendar?view="+calView+"&anchor="+calAnchor);
  renderCalendar(await r.json());
}
function renderCalendar(g){
  document.getElementById("calTitle").textContent=g.title;
  const body=document.getElementById("calBody");
  const dow=DOW.map(d=>\`<div class="caldow">\${d}</div>\`).join("");
  const cells=g.weeks.flat().map(day=>{
    const evs=day.events.map(e=>{
      const t=fmtLocal(e.whenISO).split(", ").pop();
      return \`<div class="calev \${e.kind}" onclick="calEvClick(event,'\${esc(e.file)}','\${e.kind}')"><span class="evtime">\${esc(t)}</span>\${esc((e.platforms||[]).join("/"))}</div>\`;
    }).join("");
    return \`<div class="calday \${day.inRange?'':'out'} \${day.isToday?'today':''}"><div class="dnum">\${Number(day.date.slice(8,10))}</div>\${evs}</div>\`;
  }).join("");
  body.innerHTML=\`<div class="calgrid \${g.view==='week'?'calweek':''}">\${dow}\${cells}</div>\`;
}
```

- [ ] **Step 4: Restart the viewer and verify the read-only calendar renders**

```bash
cd /Users/ryannaquin/Code/damon-ade
pkill -f queue-server.ts 2>/dev/null; sleep 1
nohup ./scripts/queue-server.sh > /tmp/queue-server.log 2>&1 &
sleep 3
```
Then load `http://localhost:4319`, click **Calendar** in the header. Verify (screenshot): a July 2026 month grid renders, today is highlighted, and the published yeti post appears as a green event on July 15 with its time + platforms. Click **Grid** — the card grid returns unchanged.

Driver: use the `claude-in-chrome` tools (`tabs_context_mcp` → `navigate` to localhost:4319 → `computer` click the Calendar toggle → `screenshot`).

- [ ] **Step 5: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add apps/desktop/scripts/queue-server.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(calendar): Grid/Calendar toggle + read-only month render (RYA-200)"
```

---

## Task 5: Navigation + week view

**Files:**
- Modify: `apps/desktop/scripts/queue-server.ts` (verify Task 4's `calNav`/`setCalView`/`calToday` behave; week view already covered by the shared render)

Task 4 already wired `calNav`, `calToday`, and `setCalView`. This task is the verification gate for navigation + the week layout (they're one reviewable deliverable).

- [ ] **Step 1: Verify month navigation**

With the viewer running and Calendar open: click `›` and `‹` — the title advances/retreats by one month and events re-bucket. Click **Today** — returns to the current month. Screenshot the previous and next month.

- [ ] **Step 2: Verify week view**

Click **Week**. Verify (screenshot): a single Sun–Sat row with taller day cells and the correct `Jul 13 – 19, 2026`-style title; `›`/`‹` move by one week; the yeti post shows in its week.

- [ ] **Step 3: Fix any layout issues found**

If the week cells are too short or the title is wrong, adjust the `.calweek .calday` min-height or the `buildWeekGrid` title (Task 2) — re-run `bun test src/main/lib/approval-queue/calendar.test.ts` after any lib change.

- [ ] **Step 4: Commit (only if changes were needed)**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add apps/desktop/scripts/queue-server.ts apps/desktop/src/main/lib/approval-queue/calendar.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "fix(calendar): navigation + week-view layout polish (RYA-200)"
```

---

## Task 6: Event interactions — inline edit (scheduled) + links popover (published)

**Files:**
- Modify: `apps/desktop/scripts/queue-server.ts` (client `<script>`: add `calEvClick`, a `refresh()` dispatcher; wire `submitEdit` + `act` to `refresh`)

**Interfaces:**
- Consumes: the existing `openEdit(file)`, `cardByFile(file)`, `esc`, and the `cards`/`load` globals; the calendar globals from Task 4.
- Produces: `calEvClick(event, file, kind)`, `refresh()`.

- [ ] **Step 1: Add `calEvClick` + `refresh`**

Before `function setFilter(k){...}` (~same region as Task 4's additions), add:

```javascript
// A scheduled event opens the existing edit modal; a published event shows a
// read-only popover with its live links. Reuses openEdit + the card data already
// loaded by load(), so there's one edit path, not two.
function calEvClick(evt, file, kind){
  evt.stopPropagation();
  const pop=document.getElementById("calPop");
  pop.classList.remove("on");
  if(kind==="scheduled"){ openEdit(file); return; }
  const c=cardByFile(file);
  const urls=(c&&c.publishedUrls)||[];
  const label=u=>{try{return new URL(u).hostname.replace(/^www\\./,"").replace(/\\.com$/,"");}catch{return u;}};
  pop.innerHTML=\`<div class="pcopy">\${esc((c&&c.copy)||"")}</div>\`+urls.map(u=>\`<a href="\${esc(u)}" target="_blank" rel="noopener">\${esc(label(u))} ↗</a>\`).join("");
  pop.style.left=Math.min(evt.clientX, window.innerWidth-300)+"px";
  pop.style.top=Math.min(evt.clientY, window.innerHeight-200)+"px";
  pop.classList.add("on");
}
document.addEventListener("click",e=>{const p=document.getElementById("calPop");if(p&&!p.contains(e.target))p.classList.remove("on");});
// Refresh whichever view is active (grid always needs its data; calendar re-fetches).
function refresh(){ load(); if(viewMode==="calendar") loadCalendar(); }
```

Note: `calEvClick` relies on `cardByFile`, which needs the `cards` array populated. `load()` runs on startup and every 5s, so `cards` is always current; the published popover reads copy/urls from it.

- [ ] **Step 2: Route edits/actions through `refresh`**

In `submitEdit` (~line 940), find the success line:

```javascript
    if(d.ok){closeEdit();await load();render(true);}
```

Replace with:

```javascript
    if(d.ok){closeEdit();await load();render(true);if(viewMode==="calendar")loadCalendar();}
```

In `act(kind,file)` (the approve/skip/requeue helper, ~line 900), find:

```javascript
async function act(kind,file){
  await fetch('/api/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file})});
  await load();
}
```

Replace the body's `await load();` with `await refresh();`.

- [ ] **Step 3: Restart and verify the interactions**

```bash
cd /Users/ryannaquin/Code/damon-ade
pkill -f queue-server.ts 2>/dev/null; sleep 1
nohup ./scripts/queue-server.sh > /tmp/queue-server.log 2>&1 &
sleep 3
```
Then, in the browser on the Calendar view:
- Click the **published** yeti event → a popover shows its copy + `facebook`/`instagram`/`threads` links. Click a link opens the live post (or verify the href). Click elsewhere → popover closes.
- If there is a **scheduled** event, click it → the existing edit modal opens; change the time via the WHEN picker, Save → the event moves to the new day/time on the calendar without a manual reload. (If no scheduled note exists, create one: approve a pending card with a WHEN = specific future time via the Grid view, then switch to Calendar.)

Screenshot the published popover and the post-edit calendar.

- [ ] **Step 4: Full test + typecheck sweep**

```bash
cd /Users/ryannaquin/Code/damon-ade/apps/desktop
bun test src/main/lib/approval-queue/ 2>&1 | tail -4
npx tsc --noEmit 2>&1 | grep -v build-info; echo done
```
Expected: all tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add apps/desktop/scripts/queue-server.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(calendar): inline edit for scheduled + links popover for published (RYA-200)"
```

---

## Task 7 (OPTIONAL / stretch): drag-to-reschedule

Only build this if the picker-based reschedule (Task 6) feels insufficient. It moves a scheduled event to another day by dragging, writing the new `scheduled_time` via the existing `/api/edit`.

**Files:**
- Modify: `apps/desktop/scripts/queue-server.ts` (client `<script>`; make `.calev` draggable, make `.calday` a drop target)

**Interfaces:**
- Consumes: `/api/edit` (`{file, platforms, scheduledTime, clearScheduled}` — already exists), `cardByFile`, `loadCalendar`.

- [ ] **Step 1: Make scheduled events draggable and days droppable**

In `renderCalendar`, add `draggable="true" ondragstart="calDragStart(event,'FILE')"` to scheduled `.calev` elements only, and `ondragover="event.preventDefault()" ondrop="calDrop(event,'DATE')"` to each `.calday`. (Published events are not draggable.)

- [ ] **Step 2: Implement drag handlers**

```javascript
let calDragFile=null;
function calDragStart(e,file){calDragFile=file;}
async function calDrop(e,date){
  e.preventDefault();
  if(!calDragFile) return;
  const c=cardByFile(calDragFile);
  if(!c||!c.scheduledTime){calDragFile=null;return;}
  // Keep the same clock time, move to the dropped day. Build a local-time ISO.
  const oldLocal=new Date(c.scheduledTime);
  const hh=String(oldLocal.getHours()).padStart(2,"0"), mm=String(oldLocal.getMinutes()).padStart(2,"0");
  const iso=new Date(date+"T"+hh+":"+mm).toISOString();
  const platforms=(c.platforms||[]);
  await fetch("/api/edit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({file:calDragFile,platforms,scheduledTime:iso})});
  calDragFile=null;
  await load(); loadCalendar();
}
```

- [ ] **Step 3: Verify**

Restart the viewer; drag a scheduled event to another day; confirm it re-buckets and the note's `scheduled_time` updated (check via `curl /api/calendar` or the note frontmatter). Guard: dropping onto a past day should be rejected — `/api/edit`'s `futureIso` already drops a past time, so the note keeps its old time; verify the event snaps back.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add apps/desktop/scripts/queue-server.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(calendar): drag-to-reschedule scheduled posts (RYA-200)"
```

---

## Final: push + close out

- [ ] **Push**

```bash
cd /Users/ryannaquin/Code/damon-ade
BRAYNEE_ALLOW_MAIN_PUSH=1 git push origin main
```

- [ ] **Update the handoff** (`.claude/HANDOFF.md`) noting the calendar shipped and which tasks (esp. whether Task 7 was done).
- [ ] **RYA-200 in Linear:** it's a native issue (no `src:status` label) — mark it Done via `mcp__linear__save_issue` `state: "Done"` once merged, OR reflect it in `STATUS.md` and let the sync close it. (Do NOT hand-complete a mirrored `src:status` issue — RYA-200 is native, so completing it directly is fine.)

---

## Self-Review notes (author check)

- **Spec coverage:** scheduled view (Tasks 3–4), publishing history (Task 3 `published` events + Task 6 links popover), inline edit (Task 6, reuses `/api/edit`), month+week (Tasks 1–2, 4–5), reschedule (Task 6 via picker; Task 7 via drag). All RYA-200 scope bullets map to a task.
- **No schema work:** confirmed — `/api/queue`'s card already carries `scheduledTime`, `status`, `platforms`, `media`, `copy`, `publishedUrls`; the endpoint reuses `buildCard`.
- **Type consistency:** `CalEvent`/`CalGrid`/`CalDay` defined in Task 1 and consumed unchanged in Tasks 2–4; `buildMonthGrid`/`buildWeekGrid`/`centralDate` signatures identical across the endpoint and tests.
- **tz correctness** is pinned by the yeti-boundary test (`2026-07-16T00:19:52Z → 2026-07-15` Central) in Tasks 1 and 2 — the single most likely bug.
