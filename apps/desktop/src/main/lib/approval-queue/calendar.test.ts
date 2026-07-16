import { describe, expect, test } from "bun:test";
import {
	buildMonthGrid,
	buildWeekGrid,
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

	test("a cross-month week names both months in the title", () => {
		// 2026-07-01 is a Wednesday; its week is Sun Jun 28 .. Sat Jul 4.
		const g = buildWeekGrid([], "2026-07-01", "2026-07-01");
		expect(g.weeks[0][0].date).toBe("2026-06-28");
		expect(g.weeks[0][6].date).toBe("2026-07-04");
		expect(g.title).toBe("Jun 28 – Jul 4, 2026");
	});
});
