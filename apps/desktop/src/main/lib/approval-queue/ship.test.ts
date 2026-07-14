import { describe, expect, test } from "bun:test";
import { STALE_CLAIM_MS } from "./queue";
import { type DrainDeps, type ShipTarget, drain } from "./ship";

const NOW = Date.parse("2026-07-14T12:00:00Z");

function note(fm: Record<string, string>) {
	return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\nbody\n`;
}

/** In-memory vault + a log of every effect, so ordering is assertable. */
function harness(files: Record<string, string>, now = NOW) {
	const fs = { ...files };
	const dispatched: ShipTarget[] = [];
	const effects: string[] = [];
	const deps: DrainDeps = {
		listNotes: () => Object.keys(fs),
		read: (p) => {
			const v = fs[p];
			if (v === undefined) throw new Error(`ENOENT ${p}`);
			return v;
		},
		write: (p, c) => {
			effects.push(`write:${p}`);
			fs[p] = c;
		},
		dispatch: (t) => {
			effects.push(`dispatch:${t.file}`);
			dispatched.push(t);
		},
		now: () => now,
	};
	return { fs, deps, dispatched, effects };
}

describe("drain — dry run is inert", () => {
	test("reports candidates but writes nothing and dispatches nothing", () => {
		const h = harness({ "/q/a.md": note({ status: "approved", platform: "x" }) });
		const r = drain(h.deps, { ship: false });

		expect(r.shippable).toEqual(["/q/a.md"]);
		expect(r.shipped).toEqual([]);
		expect(h.effects).toEqual([]);
		expect(h.fs["/q/a.md"]).toBe(note({ status: "approved", platform: "x" }));
	});
});

describe("drain — the never-approve invariant", () => {
	test("nothing a human did not approve is ever dispatched", () => {
		const h = harness({
			"/q/pending.md": note({ status: "pending", platform: "x" }),
			"/q/skipped.md": note({ status: "skipped", platform: "x" }),
			"/q/scheduled.md": note({ status: "scheduled", platform: "x" }),
			"/q/none.md": "no frontmatter at all",
		});
		const r = drain(h.deps, { ship: true });

		expect(h.dispatched).toEqual([]);
		expect(r.shipped).toEqual([]);
		expect(r.untouched).toHaveLength(4);
	});

	test("no code path ever writes status: approved", () => {
		const h = harness({
			"/q/a.md": note({ status: "pending", platform: "x" }),
			"/q/b.md": note({ status: "approved", platform: "x" }),
		});
		drain(h.deps, { ship: true });
		// b was already approved by a human; a must not have become approved.
		expect(h.fs["/q/a.md"]).toContain("status: pending");
	});
});

describe("drain — the double-post invariant", () => {
	// The bug this whole design exists to prevent: cron tick 2 firing while
	// tick 1's shipper is still in flight.
	test("a second tick during an in-flight ship does not dispatch again", () => {
		const h = harness({ "/q/a.md": note({ status: "approved", platform: "x" }) });

		const first = drain(h.deps, { ship: true });
		expect(first.shipped).toEqual(["/q/a.md"]);
		expect(h.dispatched).toHaveLength(1);

		const second = drain(h.deps, { ship: true });
		expect(second.shipped).toEqual([]);
		expect(second.claimed).toEqual(["/q/a.md"]);
		expect(h.dispatched).toHaveLength(1); // still one
	});

	test("the claim is written BEFORE the dispatch", () => {
		const h = harness({ "/q/a.md": note({ status: "approved", platform: "x" }) });
		drain(h.deps, { ship: true });
		expect(h.effects).toEqual(["write:/q/a.md", "dispatch:/q/a.md"]);
	});

	test("a claim that fails to persist aborts the dispatch", () => {
		const h = harness({ "/q/a.md": note({ status: "approved", platform: "x" }) });
		h.deps.write = () => {
			throw new Error("disk full");
		};
		const r = drain(h.deps, { ship: true });

		// Dispatching anyway would post while the note still reads `approved`,
		// so the next tick posts it a second time.
		expect(h.dispatched).toEqual([]);
		expect(r.shipped).toEqual([]);
		expect(r.errors).toHaveLength(1);
	});
});

describe("drain — stale claims escalate, never retry", () => {
	test("a stale claim is parked as needs-review and not dispatched", () => {
		const started = new Date(NOW - STALE_CLAIM_MS - 1).toISOString();
		const h = harness({ "/q/a.md": note({ status: "scheduling", platform: "x", scheduling_started: started }) });

		const r = drain(h.deps, { ship: true });
		expect(h.dispatched).toEqual([]);
		expect(r.needsReview).toHaveLength(1);
		expect(h.fs["/q/a.md"]).toContain("status: needs-review");
	});

	test("parking is terminal — a later tick leaves it alone", () => {
		const started = new Date(NOW - STALE_CLAIM_MS - 1).toISOString();
		const h = harness({ "/q/a.md": note({ status: "scheduling", platform: "x", scheduling_started: started }) });

		drain(h.deps, { ship: true });
		const second = drain(h.deps, { ship: true });

		expect(second.needsReview).toEqual([]);
		expect(second.untouched).toHaveLength(1);
		expect(h.dispatched).toEqual([]);
	});
});

describe("drain — blocked notes", () => {
	test("instagram without media is reported and left approved for a re-run", () => {
		const h = harness({ "/q/a.md": note({ status: "approved", platform: "instagram" }) });
		const r = drain(h.deps, { ship: true });

		expect(r.blocked).toEqual([{ file: "/q/a.md", reason: "no-media" }]);
		expect(h.dispatched).toEqual([]);
		// untouched, so attaching media and re-running needs no second approval
		expect(h.fs["/q/a.md"]).toContain("status: approved");
	});
});

describe("drain — resilience", () => {
	test("one unreadable note does not stop the rest of the queue", () => {
		const h = harness({ "/q/bad.md": "", "/q/good.md": note({ status: "approved", platform: "x" }) });
		h.deps.read = (p) => {
			if (p === "/q/bad.md") throw new Error("EACCES");
			return h.fs[p] as string;
		};
		const r = drain(h.deps, { ship: true });

		expect(r.errors).toHaveLength(1);
		expect(r.shipped).toEqual(["/q/good.md"]);
	});

	test("a multi-target note passes every platform through", () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "instagram + facebook", media: "https://x/y.png" }),
		});
		drain(h.deps, { ship: true });
		expect(h.dispatched[0]?.targets).toEqual(["instagram", "facebook"]);
	});
});
