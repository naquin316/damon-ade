/**
 * Pure calendar model for the social-posts calendar (RYA-200).
 *
 * Turns a flat list of dated events into a render-ready month/week grid, bucketed by
 * Central-time calendar day. No I/O, no Electron, no ambient clock — the caller injects
 * `today` — so the whole thing is deterministically unit-testable, matching the rest of
 * approval-queue/.
 */

const TZ = "America/Chicago";

export type CalKind = "scheduled" | "published" | "planned";

export interface CalEvent {
	file: string;
	slug: string;
	/** The ISO instant this event sits at (a note's scheduled_time), or null when
	 *  the note has no usable time — those can't be placed on a day and belong in
	 *  the caller's unscheduled backlog instead. */
	whenISO: string | null;
	kind: CalKind;
	/** The raw queue status, so the UI colours and gates by it rather than
	 *  re-deriving from `kind`. */
	status: string;
	/** Whether `/api/edit` will accept a reschedule. Computed here, next to the
	 *  rule it mirrors, so the calendar's drag affordance and the server's 409
	 *  can never disagree. */
	movable: boolean;
	platforms: string[];
	media: string | null;
	copy: string | null;
	/** Live post URLs, for published events. */
	urls: string[];
}

/* The booking line. Past it the post lives on Blotato's scheduler, and moving the
 * vault note would desync the two — which is exactly why `/api/edit` refuses
 * `scheduling`/`scheduled`. `published` is simply gone. */
const BOOKED = new Set(["scheduling", "scheduled", "published"]);

/** Can this note's time still be changed from the calendar? */
export function isMovable(status: string): boolean {
	return !BOOKED.has(status);
}

/** Colour bucket for a raw queue status. `scheduling` reads as scheduled: it is
 *  mid-handoff to Blotato, not still plannable. */
export function calKind(status: string): CalKind {
	if (status === "published") return "published";
	if (status === "scheduled" || status === "scheduling") return "scheduled";
	return "planned";
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
		const d = e.whenISO ? centralDate(e.whenISO, tz) : null;
		if (!d) continue;
		const list = m.get(d) ?? [];
		list.push(e);
		m.set(d, list);
	}
	// Non-null is safe: only events that produced a Central day were pushed.
	for (const list of m.values())
		list.sort(
			(a, b) => Date.parse(a.whenISO as string) - Date.parse(b.whenISO as string),
		);
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

const MON_SHORT = MONTHS.map((m) => m.slice(0, 3));

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
