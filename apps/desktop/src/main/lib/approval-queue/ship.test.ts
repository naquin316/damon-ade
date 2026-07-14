import { describe, expect, test } from "bun:test";
import type { BlotatoAccount } from "./blotato";
import { type PlannedPost, STALE_CLAIM_MS } from "./queue";
import { type DrainDeps, drain } from "./ship";

const NOW = Date.parse("2026-07-14T12:00:00Z");

function note(fm: Record<string, string>, copy = "hello world") {
	return `---\n${Object.entries(fm)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n")}\n---\n\n## Final copy (verbatim)\n\n${copy}\n`;
}

/** Ryan's real Blotato account set: no x, no linkedin. */
const CONNECTED = new Map<string, BlotatoAccount>([
	["facebook", { id: "5179", platform: "facebook", pageId: "fbpage1" }],
	["instagram", { id: "6789", platform: "instagram", name: "handlanedesigns" }],
	["pinterest", { id: "1197", platform: "pinterest" }],
	["threads", { id: "2846", platform: "threads" }],
	["tiktok", { id: "15026", platform: "tiktok" }],
]);

function harness(
	files: Record<string, string>,
	opts: { fail?: boolean | number } = {},
) {
	const fs = { ...files };
	const sent: PlannedPost[] = [];
	const effects: string[] = [];
	let n = 0;
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
		connected: CONNECTED,
		send: async (post) => {
			n += 1;
			if (opts.fail === true || opts.fail === n) throw new Error("blotato 500");
			effects.push(`send:${post.platform}`);
			sent.push(post);
			return { id: `post-${n}` };
		},
		now: () => NOW,
	};
	return { fs, deps, sent, effects };
}

describe("drain — dry run is inert", () => {
	test("reports the exact posts but writes nothing and sends nothing", async () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "threads" }),
		});
		const r = await drain(h.deps, { ship: false });

		expect(r.shippable).toHaveLength(1);
		expect(r.shippable[0]?.posts[0]?.text).toBe("hello world");
		expect(r.shipped).toEqual([]);
		expect(h.effects).toEqual([]);
		expect(h.sent).toEqual([]);
	});
});

describe("drain — the never-approve invariant", () => {
	test("nothing a human did not approve is ever sent", async () => {
		const h = harness({
			"/q/pending.md": note({ status: "pending", platform: "threads" }),
			"/q/skipped.md": note({ status: "skipped", platform: "threads" }),
			"/q/scheduled.md": note({ status: "scheduled", platform: "threads" }),
			"/q/none.md": "no frontmatter at all",
		});
		const r = await drain(h.deps, { ship: true });

		expect(h.sent).toEqual([]);
		expect(r.shipped).toEqual([]);
		expect(r.untouched).toHaveLength(4);
	});

	test("no code path ever writes status: approved", async () => {
		const h = harness({
			"/q/a.md": note({ status: "pending", platform: "threads" }),
		});
		await drain(h.deps, { ship: true });
		expect(h.fs["/q/a.md"]).toContain("status: pending");
	});
});

describe("drain — the double-post invariant", () => {
	test("a second tick during an in-flight ship does not send again", async () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "threads" }),
		});

		const first = await drain(h.deps, { ship: true });
		expect(first.shipped).toHaveLength(1);
		expect(h.sent).toHaveLength(1);

		// The note now reads `scheduled`, so it's inert. Simulate the in-flight window
		// too: a note still claimed at `scheduling` must be skipped.
		h.fs["/q/b.md"] = note({
			status: "scheduling",
			platform: "threads",
			scheduling_started: new Date(NOW - 60_000).toISOString(),
		});
		const second = await drain(h.deps, { ship: true });
		expect(second.claimed).toEqual(["/q/b.md"]);
		expect(h.sent).toHaveLength(1);
	});

	test("the claim is written BEFORE the post is sent", async () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "threads" }),
		});
		await drain(h.deps, { ship: true });
		expect(h.effects[0]).toBe("write:/q/a.md"); // claim
		expect(h.effects[1]).toBe("send:threads");
	});

	test("a claim that fails to persist aborts the send", async () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "threads" }),
		});
		h.deps.write = () => {
			throw new Error("disk full");
		};
		const r = await drain(h.deps, { ship: true });

		expect(h.sent).toEqual([]);
		expect(r.shipped).toEqual([]);
		expect(r.errors).toHaveLength(1);
	});

	test("a note lands at scheduled with the blotato id", async () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "threads" }),
		});
		await drain(h.deps, { ship: true });
		expect(h.fs["/q/a.md"]).toContain("status: scheduled");
		expect(h.fs["/q/a.md"]).toContain("blotato_post_ids: post-1");
	});
});

describe("drain — send failures escalate, never retry", () => {
	test("a failed send parks the note at needs-review", async () => {
		const h = harness(
			{ "/q/a.md": note({ status: "approved", platform: "threads" }) },
			{ fail: true },
		);
		const r = await drain(h.deps, { ship: true });

		expect(r.shipped).toEqual([]);
		expect(h.fs["/q/a.md"]).toContain("status: needs-review");
		expect(r.needsReview).toHaveLength(1);
	});

	// instagram + facebook where facebook fails: instagram is ALREADY LIVE.
	// Retrying would double-post instagram. A human checks Blotato.
	test("a partial multi-platform send records the ids that DID go out", async () => {
		const h = harness(
			{
				"/q/a.md": note({
					status: "approved",
					platform: "instagram + facebook",
					media: "https://x/y.png",
				}),
			},
			{ fail: 2 },
		);
		const r = await drain(h.deps, { ship: true });

		expect(h.sent).toHaveLength(1); // instagram went out
		expect(h.fs["/q/a.md"]).toContain("status: needs-review");
		expect(h.fs["/q/a.md"]).toContain("blotato_post_ids: post-1");
		expect(r.shipped).toEqual([]);
	});

	test("a stale claim parks at needs-review and is never sent", async () => {
		const started = new Date(NOW - STALE_CLAIM_MS - 1).toISOString();
		const h = harness({
			"/q/a.md": note({
				status: "scheduling",
				platform: "threads",
				scheduling_started: started,
			}),
		});
		const r = await drain(h.deps, { ship: true });

		expect(h.sent).toEqual([]);
		expect(r.needsReview).toHaveLength(1);
		expect(h.fs["/q/a.md"]).toContain("status: needs-review");
	});

	test("parking is terminal — a later tick leaves it alone", async () => {
		const started = new Date(NOW - STALE_CLAIM_MS - 1).toISOString();
		const h = harness({
			"/q/a.md": note({
				status: "scheduling",
				platform: "threads",
				scheduling_started: started,
			}),
		});
		await drain(h.deps, { ship: true });
		const second = await drain(h.deps, { ship: true });

		expect(second.needsReview).toEqual([]);
		expect(second.untouched).toHaveLength(1);
		expect(h.sent).toEqual([]);
	});
});

describe("drain — blocked notes stay approved for a re-run", () => {
	test("x has no connected account — reported, not sent", async () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "x" }),
		});
		const r = await drain(h.deps, { ship: true });

		expect(r.blocked[0]?.reason).toBe("no-connected-account");
		expect(h.sent).toEqual([]);
		expect(h.fs["/q/a.md"]).toContain("status: approved");
	});

	test("instagram without media — reported, not sent", async () => {
		const h = harness({
			"/q/a.md": note({ status: "approved", platform: "instagram" }),
		});
		const r = await drain(h.deps, { ship: true });

		expect(r.blocked[0]?.reason).toBe("no-media");
		expect(h.fs["/q/a.md"]).toContain("status: approved");
	});
});
