import { describe, expect, test } from "bun:test";
import type { BlotatoAccount } from "./blotato";
import {
	classify,
	extractCopy,
	parsePlatforms,
	readNote,
	resolveScheduledTime,
	STALE_CLAIM_MS,
	withStatus,
} from "./queue";

const NOW = Date.parse("2026-07-14T12:00:00Z");

/** Ryan's real Blotato account set (measured 2026-07-14): no x, no linkedin. */
const CONNECTED = new Map<string, BlotatoAccount>([
	["facebook", { id: "5179", platform: "facebook", pageId: "fbpage1" }],
	["instagram", { id: "6789", platform: "instagram", name: "handlanedesigns" }],
	["threads", { id: "2846", platform: "threads" }],
]);

function note(fm: Record<string, string>, copy = "hello world") {
	return `---\n${Object.entries(fm)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n")}\n---\n\n## Final copy (verbatim)\n\n${copy}\n`;
}

describe("parsePlatforms", () => {
	test("single platform", () => {
		expect(parsePlatforms("instagram")).toEqual(["instagram"]);
	});

	// The live queue really contains `platform: instagram + facebook`.
	test("splits the space-plus-separated multi form", () => {
		expect(parsePlatforms("instagram + facebook")).toEqual([
			"instagram",
			"facebook",
		]);
	});

	test("normalises case and whitespace", () => {
		expect(parsePlatforms("  Instagram  +  FACEBOOK ")).toEqual([
			"instagram",
			"facebook",
		]);
	});

	test("empty / missing yields no targets", () => {
		expect(parsePlatforms(undefined)).toEqual([]);
		expect(parsePlatforms("")).toEqual([]);
	});
});

describe("extractCopy", () => {
	test("lifts the verbatim copy section", () => {
		expect(
			extractCopy(note({ status: "approved" }, "line one\n\nline two")),
		).toBe("line one\n\nline two");
	});

	test("stops at the next heading", () => {
		const raw = `---\nstatus: approved\n---\n\n## Final copy (verbatim)\n\nthe post\n\n## Grade notes\n\n9/10 blah\n`;
		expect(extractCopy(raw)).toBe("the post");
	});

	// A REAL note ends its copy section with "**Facebook version:** same copy, drop
	// all 4 hashtags." That is editorial scaffolding addressed to a human. Posting
	// it would publish process notes to a live brand account.
	test("strips a trailing platform-version annotation", () => {
		const raw = note(
			{ status: "approved" },
			"the real post\n\n#tag\n\n**Facebook version:** same copy, drop all 4 hashtags.",
		);
		expect(extractCopy(raw)).toBe("the real post\n\n#tag");
	});

	test("a note with no copy section yields null", () => {
		expect(
			extractCopy("---\nstatus: approved\n---\n\n## Grade\n\n9/10\n"),
		).toBeNull();
	});
});

describe("readNote — tolerant parse (the 4f17f3f lesson)", () => {
	test("reads a well-formed note", () => {
		const n = readNote(
			"a.md",
			note({
				status: "approved",
				platform: "instagram",
				media: "https://x/y.png",
				accountId: "6789",
			}),
		);
		expect(n.status).toBe("approved");
		expect(n.platforms).toEqual(["instagram"]);
		expect(n.media).toBe("https://x/y.png");
		expect(n.accountId).toBe("6789");
	});

	// Agent-written frontmatter with an unquoted ": " is invalid YAML; strict parsing
	// returns {} and the note reads as `pending`, stranding an approved post.
	test("recovers status by line scan when the YAML does not parse", () => {
		const raw = [
			"---",
			"status: approved",
			"platform: threads",
			"grade: 9.0/10 (HLD rubric) Note: the shared dir is fine",
			'unbalanced: "quote',
			"---",
			"",
			"## Final copy (verbatim)",
			"",
			"body",
		].join("\n");
		const n = readNote("a.md", raw);
		expect(n.status).toBe("approved");
		expect(n.platforms).toEqual(["threads"]);
		expect(n.copy).toBe("body");
	});

	test("a note with no frontmatter is untouched, not approved", () => {
		expect(readNote("a.md", "just a body").status).toBe("pending");
	});
});

describe("classify — the never-approve invariant", () => {
	for (const status of [
		"pending",
		"skipped",
		"scheduled",
		"draft",
		"",
		"APPROVED_LOOKALIKE",
	]) {
		test(`status "${status}" is never shipped`, () => {
			const n = readNote("a.md", note({ status, platform: "threads" }));
			expect(classify(n, NOW, CONNECTED).kind).not.toBe("shippable");
		});
	}

	test("approved + connected account is shippable", () => {
		const n = readNote(
			"a.md",
			note({ status: "approved", platform: "threads" }),
		);
		const c = classify(n, NOW, CONNECTED);
		expect(c.kind).toBe("shippable");
		if (c.kind === "shippable") {
			expect(c.posts).toHaveLength(1);
			expect(c.posts[0]?.accountId).toBe("2846");
			expect(c.posts[0]?.text).toBe("hello world");
		}
	});

	test("case and whitespace do not defeat the approved check", () => {
		const n = readNote(
			"a.md",
			note({ status: "  Approved ", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("shippable");
	});
});

describe("classify — the approved CHECKBOX gate", () => {
	// Obsidian has no enum/select property type (1.8.10: text|multitext|number|
	// checkbox|date|datetime). A checkbox is native and cannot be typo'd, which is
	// the whole point: `status: aproved` silently ships nothing.
	test("approved: true ships even while status is still pending", () => {
		const n = readNote(
			"a.md",
			note({ status: "pending", approved: "true", platform: "threads" }),
		);
		expect(n.approved).toBe(true);
		expect(classify(n, NOW, CONNECTED).kind).toBe("shippable");
	});

	test("approved: false never ships", () => {
		const n = readNote(
			"a.md",
			note({ status: "pending", approved: "false", platform: "threads" }),
		);
		expect(n.approved).toBe(false);
		expect(classify(n, NOW, CONNECTED).kind).toBe("untouched");
	});

	test("an absent checkbox is null, not false, and never ships", () => {
		const n = readNote(
			"a.md",
			note({ status: "pending", platform: "threads" }),
		);
		expect(n.approved).toBeNull();
		expect(classify(n, NOW, CONNECTED).kind).toBe("untouched");
	});

	// The gate must not be liberal. A string is not a ticked box.
	test('approved: "yes" / "TRUE" (strings) do NOT count as approval', () => {
		for (const v of ['"yes"', '"TRUE"', '"approved"', "1"]) {
			const n = readNote(
				"a.md",
				note({ status: "pending", approved: v, platform: "threads" }),
			);
			expect(classify(n, NOW, CONNECTED).kind).not.toBe("shippable");
		}
	});

	// A ticked box must never resurrect a note the machine already finished.
	test("approved: true does NOT re-send an already-scheduled note", () => {
		const n = readNote(
			"a.md",
			note({ status: "scheduled", approved: "true", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("untouched");
	});

	test("skipped beats a ticked checkbox", () => {
		const n = readNote(
			"a.md",
			note({ status: "skipped", approved: "true", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("untouched");
	});

	test("needs-review beats a ticked checkbox — a human must look first", () => {
		const n = readNote(
			"a.md",
			note({ status: "needs-review", approved: "true", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("untouched");
	});
});

describe("classify — a typo is LOUD, not silent", () => {
	// The worst failure mode: Ryan types `aproved`, believes he shipped a post, and
	// nothing ever happens with no signal anywhere.
	for (const typo of ["aproved", "approve", "Approved!", "aproved "]) {
		test(`"${typo}" is reported as unknown-status, not silently ignored`, () => {
			const n = readNote("a.md", note({ status: typo, platform: "threads" }));
			const c = classify(n, NOW, CONNECTED);
			expect(c.kind).toBe("blocked");
			if (c.kind === "blocked") expect(c.reason).toBe("unknown-status");
		});
	}

	test("but a typo still never ships", () => {
		const n = readNote(
			"a.md",
			note({ status: "aproved", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).not.toBe("shippable");
	});

	test("every known status stays quiet", () => {
		for (const s of ["pending", "skipped", "scheduled", "needs-review"]) {
			const n = readNote("a.md", note({ status: s, platform: "threads" }));
			expect(classify(n, NOW, CONNECTED).kind).toBe("untouched");
		}
	});
});

describe("classify — account resolution", () => {
	// Measured: Ryan has no x/linkedin account. 8 pending notes target them.
	test("a platform with no connected account is blocked, not sent", () => {
		const n = readNote("a.md", note({ status: "approved", platform: "x" }));
		const c = classify(n, NOW, CONNECTED);
		expect(c.kind).toBe("blocked");
		if (c.kind === "blocked") expect(c.reason).toBe("no-connected-account");
	});

	test("the note's explicit accountId wins over the platform default", () => {
		const n = readNote(
			"a.md",
			note({ status: "approved", platform: "threads", accountId: "9999" }),
		);
		const c = classify(n, NOW, CONNECTED);
		if (c.kind === "shippable") expect(c.posts[0]?.accountId).toBe("9999");
	});

	test("facebook picks up its pageId from the account", () => {
		const n = readNote(
			"a.md",
			note({ status: "approved", platform: "facebook" }),
		);
		const c = classify(n, NOW, CONNECTED);
		if (c.kind === "shippable") expect(c.posts[0]?.pageId).toBe("fbpage1");
	});

	test("facebook with no pageId anywhere is blocked", () => {
		const conn = new Map<string, BlotatoAccount>([
			["facebook", { id: "5179", platform: "facebook" }],
		]);
		const n = readNote(
			"a.md",
			note({ status: "approved", platform: "facebook" }),
		);
		const c = classify(n, NOW, conn);
		expect(c.kind).toBe("blocked");
		if (c.kind === "blocked") expect(c.reason).toBe("no-page-id");
	});

	test("a multi-target note yields one post per platform", () => {
		const n = readNote(
			"a.md",
			note({
				status: "approved",
				platform: "instagram + facebook",
				media: "https://x/y.png",
			}),
		);
		const c = classify(n, NOW, CONNECTED);
		expect(c.kind).toBe("shippable");
		if (c.kind === "shippable") {
			expect(c.posts.map((p) => p.platform)).toEqual(["instagram", "facebook"]);
		}
	});
});

describe("classify — content gates", () => {
	test("instagram without media is blocked, not failed", () => {
		const n = readNote(
			"a.md",
			note({ status: "approved", platform: "instagram" }),
		);
		const c = classify(n, NOW, CONNECTED);
		expect(c.kind).toBe("blocked");
		if (c.kind === "blocked") expect(c.reason).toBe("no-media");
	});

	test("a text-only platform without media is shippable", () => {
		const n = readNote(
			"a.md",
			note({ status: "approved", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("shippable");
	});

	test("approved with no platform is blocked", () => {
		const n = readNote("a.md", note({ status: "approved" }));
		const c = classify(n, NOW, CONNECTED);
		if (c.kind === "blocked") expect(c.reason).toBe("no-platform");
	});

	test("approved with no copy section is blocked, never posts an empty string", () => {
		const raw =
			"---\nstatus: approved\nplatform: threads\n---\n\n## Grade\n\n9/10\n";
		const c = classify(readNote("a.md", raw), NOW, CONNECTED);
		expect(c.kind).toBe("blocked");
		if (c.kind === "blocked") expect(c.reason).toBe("no-copy");
	});
});

describe("classify — claiming (the double-post invariant)", () => {
	test("a fresh claim is invisible to a concurrent tick", () => {
		const n = readNote(
			"a.md",
			note({
				status: "scheduling",
				platform: "threads",
				scheduling_started: "2026-07-14T11:59:00Z",
			}),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("claimed");
	});

	test("a stale claim becomes needs-review and is never re-sent", () => {
		const started = new Date(NOW - STALE_CLAIM_MS - 1000).toISOString();
		const n = readNote(
			"a.md",
			note({
				status: "scheduling",
				platform: "threads",
				scheduling_started: started,
			}),
		);
		const c = classify(n, NOW, CONNECTED);
		expect(c.kind).toBe("needs-review");
	});

	test("a claim with no timestamp is treated as stale, not as shippable", () => {
		const n = readNote(
			"a.md",
			note({ status: "scheduling", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("needs-review");
	});

	test("needs-review is terminal — a later tick does not resurrect it", () => {
		const n = readNote(
			"a.md",
			note({ status: "needs-review", platform: "threads" }),
		);
		expect(classify(n, NOW, CONNECTED).kind).toBe("untouched");
	});
});

describe("resolveScheduledTime — never publish-now", () => {
	test("defaults to a short delay so there is a window to cancel", () => {
		const n = readNote(
			"a.md",
			note({ status: "approved", platform: "threads" }),
		);
		expect(resolveScheduledTime(n, NOW)).toBe(
			new Date(NOW + 10 * 60 * 1000).toISOString(),
		);
	});

	test("an explicit future ISO time wins", () => {
		const n = readNote(
			"a.md",
			note({
				status: "approved",
				platform: "threads",
				scheduled_time: "2026-07-20T15:30:00Z",
			}),
		);
		expect(resolveScheduledTime(n, NOW)).toBe("2026-07-20T15:30:00.000Z");
	});

	// The live notes really say `schedule: pending approval (do not schedule)`.
	test("prose in the time field falls back to the default, never NaN", () => {
		const n = readNote(
			"a.md",
			note({
				status: "approved",
				platform: "threads",
				scheduled_time: "pending approval",
			}),
		);
		expect(resolveScheduledTime(n, NOW)).toBe(
			new Date(NOW + 10 * 60 * 1000).toISOString(),
		);
	});

	test("a past explicit time falls back rather than scheduling in the past", () => {
		const n = readNote(
			"a.md",
			note({
				status: "approved",
				platform: "threads",
				scheduled_time: "2020-01-01T00:00:00Z",
			}),
		);
		expect(resolveScheduledTime(n, NOW)).toBe(
			new Date(NOW + 10 * 60 * 1000).toISOString(),
		);
	});
});

describe("withStatus — surgical, non-destructive mutation", () => {
	test("rewrites status and leaves every other line byte-identical", () => {
		const raw = note({
			status: "approved",
			platform: "instagram",
			media: "https://x/y.png",
		});
		const out = withStatus(raw, "scheduling");
		expect(readNote("a.md", out).status).toBe("scheduling");
		expect(out).toContain("platform: instagram");
		expect(out).toContain("media: https://x/y.png");
		expect(out).toContain("## Final copy (verbatim)");
	});

	test("preserves a note whose YAML does not parse", () => {
		const raw = [
			"---",
			"status: approved",
			"platform: threads",
			"grade: 9.0/10 Note: still fine",
			"---",
			"",
			"body",
		].join("\n");
		const out = withStatus(raw, "scheduling");
		expect(out).toContain("grade: 9.0/10 Note: still fine");
		expect(readNote("a.md", out).status).toBe("scheduling");
	});

	test("overwrites an existing extra field rather than duplicating it", () => {
		const raw = note({
			status: "scheduling",
			scheduling_started: "2026-01-01T00:00:00Z",
			platform: "threads",
		});
		const out = withStatus(raw, "scheduling", {
			scheduling_started: "2026-07-14T12:00:00Z",
		});
		expect(out.match(/scheduling_started:/g)).toHaveLength(1);
	});

	// Values from note text can contain `$&`/`$1`, which are replacement specials.
	test("a value containing regex replacement specials survives intact", () => {
		const raw = note({ status: "approved", platform: "threads" });
		const out = withStatus(raw, "scheduled", {
			blotato_post_ids: "id-$&-$1-$'",
		});
		expect(out).toContain("blotato_post_ids: id-$&-$1-$'");
	});

	test("refuses to invent frontmatter on a note that has none", () => {
		expect(withStatus("just a body", "scheduling")).toBe("just a body");
	});
});
