import { describe, expect, test } from "bun:test";
import { classify, parsePlatforms, readNote, STALE_CLAIM_MS, withStatus } from "./queue";

const NOW = Date.parse("2026-07-14T12:00:00Z");

/** Minimal note builder — frontmatter shape mirrors the real queue. */
function note(fm: Record<string, string>, body = "## Final copy (verbatim)\n\nhello\n") {
	const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
	return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

describe("parsePlatforms", () => {
	test("single platform", () => {
		expect(parsePlatforms("instagram")).toEqual(["instagram"]);
	});

	// The live queue really contains `platform: instagram + facebook`.
	test("splits the space-plus-separated multi form", () => {
		expect(parsePlatforms("instagram + facebook")).toEqual(["instagram", "facebook"]);
	});

	test("normalises case and whitespace", () => {
		expect(parsePlatforms("  Instagram  +  FACEBOOK ")).toEqual(["instagram", "facebook"]);
	});

	test("empty / missing yields no targets", () => {
		expect(parsePlatforms(undefined)).toEqual([]);
		expect(parsePlatforms("")).toEqual([]);
	});
});

describe("readNote — tolerant parse (the 4f17f3f lesson)", () => {
	test("reads a well-formed note", () => {
		const n = readNote("a.md", note({ status: "approved", platform: "instagram", media: "https://x/y.png" }));
		expect(n.status).toBe("approved");
		expect(n.platforms).toEqual(["instagram"]);
		expect(n.media).toBe("https://x/y.png");
	});

	// A queue note is AGENT-written. An unquoted value containing ": " is invalid
	// YAML; strict parsing returns {} and the note reads as `pending` — silently
	// stranding an approved post. handoff.ts learned this the expensive way.
	test("recovers status by line scan when the YAML does not parse", () => {
		const raw = [
			"---",
			"status: approved",
			"platform: instagram",
			"media: https://x/y.png",
			"grade: 9.0/10 (HLD rubric) Note: the shared dir is fine",
			'unbalanced: "quote',
			"---",
			"",
			"body",
		].join("\n");
		const n = readNote("a.md", raw);
		expect(n.status).toBe("approved");
		expect(n.platforms).toEqual(["instagram"]);
	});

	test("a note with no frontmatter is untouched, not approved", () => {
		expect(readNote("a.md", "just a body").status).toBe("pending");
	});
});

describe("classify — the never-approve invariant", () => {
	// The consumer ships ONLY what a human already marked approved. Any other
	// status must be inert. This is the invariant the whole gate rests on.
	for (const status of ["pending", "skipped", "scheduled", "draft", "", "APPROVED_LOOKALIKE"]) {
		test(`status "${status}" is never shipped`, () => {
			const n = readNote("a.md", note({ status, platform: "instagram", media: "https://x/y.png" }));
			const c = classify(n, NOW);
			expect(c.kind).not.toBe("shippable");
		});
	}

	test("approved + media is shippable", () => {
		const n = readNote("a.md", note({ status: "approved", platform: "instagram", media: "https://x/y.png" }));
		const c = classify(n, NOW);
		expect(c.kind).toBe("shippable");
		if (c.kind === "shippable") expect(c.targets).toEqual(["instagram"]);
	});

	test("case and surrounding whitespace do not defeat the approved check", () => {
		const n = readNote("a.md", note({ status: "  Approved ", platform: "x" }));
		expect(classify(n, NOW).kind).toBe("shippable");
	});
});

describe("classify — media gate", () => {
	test("instagram without media is blocked, not failed", () => {
		const n = readNote("a.md", note({ status: "approved", platform: "instagram" }));
		const c = classify(n, NOW);
		expect(c.kind).toBe("blocked");
		if (c.kind === "blocked") expect(c.reason).toBe("no-media");
	});

	test("a text-only platform without media is shippable", () => {
		const n = readNote("a.md", note({ status: "approved", platform: "x" }));
		expect(classify(n, NOW).kind).toBe("shippable");
	});

	// instagram + facebook: instagram's requirement governs the whole note.
	test("a multi-target note including instagram is blocked without media", () => {
		const n = readNote("a.md", note({ status: "approved", platform: "instagram + facebook" }));
		expect(classify(n, NOW).kind).toBe("blocked");
	});

	test("approved with no platform at all is blocked, not shipped", () => {
		const n = readNote("a.md", note({ status: "approved" }));
		const c = classify(n, NOW);
		expect(c.kind).toBe("blocked");
		if (c.kind === "blocked") expect(c.reason).toBe("no-platform");
	});
});

describe("classify — claiming (the double-post invariant)", () => {
	// Cron ticks while an async shipper is still running. Without a claim, tick 2
	// re-ships what tick 1 is mid-way through: a duplicate public post.
	test("a fresh claim is invisible to a concurrent tick", () => {
		const n = readNote(
			"a.md",
			note({
				status: "scheduling",
				platform: "instagram",
				media: "https://x/y.png",
				scheduling_started: "2026-07-14T11:59:00Z",
			}),
		);
		expect(classify(n, NOW).kind).toBe("claimed");
	});

	// A stuck claim is ambiguous: died BEFORE Blotato (retry ok) or AFTER
	// (retry double-posts). Nothing on disk distinguishes them, and the side
	// effect is public and irreversible — so it escalates, never auto-retries.
	test("a stale claim becomes needs-review and is never re-shipped", () => {
		const started = new Date(NOW - STALE_CLAIM_MS - 1000).toISOString();
		const n = readNote(
			"a.md",
			note({ status: "scheduling", platform: "x", scheduling_started: started }),
		);
		const c = classify(n, NOW);
		expect(c.kind).toBe("needs-review");
		if (c.kind === "needs-review") expect(c.reason).toBe("stale-claim");
	});

	test("a claim with no timestamp is treated as stale, not as shippable", () => {
		const n = readNote("a.md", note({ status: "scheduling", platform: "x" }));
		expect(classify(n, NOW).kind).toBe("needs-review");
	});

	test("needs-review is terminal — a later tick does not resurrect it", () => {
		const n = readNote("a.md", note({ status: "needs-review", platform: "x" }));
		expect(classify(n, NOW).kind).toBe("untouched");
	});
});

describe("withStatus — surgical, non-destructive mutation", () => {
	test("rewrites status and leaves every other line byte-identical", () => {
		const raw = note({ status: "approved", platform: "instagram", media: "https://x/y.png" });
		const out = withStatus(raw, "scheduling");
		expect(readNote("a.md", out).status).toBe("scheduling");
		expect(out).toContain("platform: instagram");
		expect(out).toContain("media: https://x/y.png");
		// body survives untouched
		expect(out).toContain("## Final copy (verbatim)");
	});

	// The whole point of not round-tripping through yaml.stringify: these notes
	// are the ones the tolerant reader exists to rescue, and a reformat would
	// destroy them.
	test("preserves a note whose YAML does not parse", () => {
		const raw = [
			"---",
			"status: approved",
			"platform: x",
			"grade: 9.0/10 Note: still fine",
			"---",
			"",
			"body",
		].join("\n");
		const out = withStatus(raw, "scheduling");
		expect(out).toContain("grade: 9.0/10 Note: still fine");
		expect(readNote("a.md", out).status).toBe("scheduling");
	});

	test("upserts extra fields", () => {
		const raw = note({ status: "approved", platform: "x" });
		const out = withStatus(raw, "scheduling", { scheduling_started: "2026-07-14T12:00:00Z" });
		expect(readNote("a.md", out).schedulingStarted).toBe("2026-07-14T12:00:00Z");
	});

	test("overwrites an existing extra field rather than duplicating it", () => {
		const raw = note({ status: "scheduling", scheduling_started: "2026-01-01T00:00:00Z", platform: "x" });
		const out = withStatus(raw, "scheduling", { scheduling_started: "2026-07-14T12:00:00Z" });
		expect(out.match(/scheduling_started:/g)).toHaveLength(1);
		expect(readNote("a.md", out).schedulingStarted).toBe("2026-07-14T12:00:00Z");
	});

	// Values arriving from note text can contain `$&`/`$1`, which are replacement
	// specials — a naive String.replace would corrupt the file.
	test("a value containing regex replacement specials survives intact", () => {
		const raw = note({ status: "approved", platform: "x" });
		const out = withStatus(raw, "scheduled", { blotato_post_id: "id-$&-$1-$'" });
		expect(out).toContain("blotato_post_id: id-$&-$1-$'");
	});

	test("body text that looks like frontmatter is not touched", () => {
		const raw = `${note({ status: "approved", platform: "x" })}\nstatus: pending\n`;
		const out = withStatus(raw, "scheduling");
		expect(out.match(/^status: scheduling$/m)).toHaveLength(1);
		// the decoy line in the body is still there
		expect(out).toContain("\nstatus: pending\n");
	});

	test("refuses to invent frontmatter on a note that has none", () => {
		expect(withStatus("just a body", "scheduling")).toBe("just a body");
	});
});
