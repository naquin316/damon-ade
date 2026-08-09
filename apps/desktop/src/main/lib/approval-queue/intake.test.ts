import { describe, expect, test } from "bun:test";
import type { BlotatoAccount } from "./blotato";
import {
	buildDraftNote,
	cleanCopy,
	createDraft,
	type IntakeDeps,
	lintVoice,
	MAX_MEDIA_BYTES,
	mediaKindFrom,
	mediaTypeFor,
} from "./intake";
import { classify, extractCopy, readNote } from "./queue";

/** A caption that satisfies every HARD RULE, so a test can vary exactly one thing. */
const CLEAN =
	"Hand-engraved in New Braunfels, TX for the teacher who shows up early.\n\n#handengraved #teachergift #newbraunfels";

describe("cleanCopy", () => {
	test("strips quotes wrapping the whole caption", () => {
		expect(cleanCopy('"A caption."')).toBe("A caption.");
	});
	test("closes a hashtag the model split with a space (observed live)", () => {
		expect(cleanCopy("Nice.\n\n#handengraved #gifts fordad #yeti")).toBe(
			"Nice.\n\n#handengraved #giftsfordad #yeti",
		);
	});
	test("leaves ordinary prose (no hashtags nearby) untouched", () => {
		expect(cleanCopy("Shop the link. it ships fast.")).toBe(
			"Shop the link. it ships fast.",
		);
	});
});

describe("mediaTypeFor — the one table every door filters on", () => {
	test("photos and video both resolve, case-insensitively", () => {
		expect(mediaTypeFor("IMG_1.JPG")).toEqual({
			contentType: "image/jpeg",
			kind: "photo",
		});
		expect(mediaTypeFor("reel.MOV")).toEqual({
			contentType: "video/quicktime",
			kind: "video",
		});
		expect(mediaTypeFor("clip.mp4")?.kind).toBe("video");
	});

	test("non-media is null, so a sidecar or a stray file is skipped not uploaded", () => {
		expect(mediaTypeFor("note.txt")).toBeNull();
		expect(mediaTypeFor(".DS_Store")).toBeNull();
		expect(mediaTypeFor("README")).toBeNull();
	});

	test("kind from a content type the door already has", () => {
		expect(mediaKindFrom("video/mp4")).toBe("video");
		expect(mediaKindFrom("image/png")).toBe("photo");
	});
});

describe("lintVoice — the HARD RULES, checked instead of merely requested", () => {
	test("a compliant caption is clean", () => {
		expect(lintVoice(CLEAN, ["instagram"])).toEqual([]);
	});

	// The two that actually got through on 2026-08-09 and reached a campaign.
	test("catches the em dash and the invented dishwasher claim", () => {
		const errs = lintVoice(
			`${CLEAN.replace("early.", "early — every day. Dishwasher safe.")}`,
			[],
		);
		expect(errs).toContain("em/en dash (HARD RULE: none)");
		expect(errs).toContain("invented claim: dishwasher");
	});

	test("catches filler words, the wrong town, and a missing brand fact", () => {
		const errs = lintVoice(
			"It's really nice. Made in Round Rock. #a #b #c",
			[],
		);
		expect(errs).toContain("filler word: really");
		expect(errs).toContain("wrong town: Round Rock");
		expect(errs).toContain('missing "New Braunfels, TX"');
		expect(errs).toContain('missing "hand-engrave"');
	});

	test("counts hashtags against the 3-to-5 rule", () => {
		expect(lintVoice(`${CLEAN} #four #five #six`, [])).toContain(
			"6 hashtags (need 3 to 5)",
		);
	});

	// The caps come from queue.ts. If this ever drifts, a caption could pass intake
	// and then be blocked by the ship gate for a limit intake measured differently.
	test("uses the same length caps the ship gate enforces", () => {
		const long = `${"x".repeat(600)}\n${CLEAN}`;
		expect(lintVoice(long, ["threads"]).join()).toContain("threads:");
		expect(lintVoice(long, ["instagram"])).toEqual([]);
	});
});

describe("buildDraftNote — the note the drain must be able to read", () => {
	const draft = buildDraftNote({
		hint: "30oz teacher tumbler, $48",
		copy: "Bright minds, big hearts.\n\n#teachergift #newbraunfels #handengraved",
		mediaUrl: "https://database.blotato.com/x/photo.jpg",
		door: "web",
		date: "2026-07-15",
	});

	test("produces a pending, unapproved note", () => {
		const n = readNote(draft.filename, draft.content);
		expect(n.status).toBe("pending");
		expect(n.approved).toBe(false);
		expect(n.platforms).toEqual(["instagram"]);
		expect(n.media).toBe("https://database.blotato.com/x/photo.jpg");
	});

	test("the copy round-trips through extractCopy verbatim", () => {
		const n = readNote(draft.filename, draft.content);
		expect(n.copy).toBe(
			"Bright minds, big hearts.\n\n#teachergift #newbraunfels #handengraved",
		);
	});

	// The whole point: an intake draft must be a first-class queue citizen the drain
	// treats identically. With a connected IG account + media, it classifies shippable.
	test("classifies exactly like a normal note", () => {
		const connected = new Map<string, BlotatoAccount>([
			["instagram", { id: "6789", platform: "instagram" }],
		]);
		const n = readNote(draft.filename, draft.content);
		// pending + unapproved -> untouched (the gate holds; it doesn't auto-ship)
		expect(classify(n, Date.now(), connected).kind).toBe("untouched");
		// once approved, it's shippable (has media + connected account)
		expect(classify({ ...n, approved: true }, Date.now(), connected).kind).toBe(
			"shippable",
		);
	});

	test("filename is date-prefixed and slugged from the hint", () => {
		expect(draft.filename).toBe("2026-07-15-intake-30oz-teacher-tumbler-48.md");
	});

	// "Click a day on the calendar to create a post" is the only reason this exists.
	// It has to round-trip through readNote, because a scheduled_time the drain
	// can't read would silently fall back to now+10min — the post would appear on
	// the calendar on the day you picked and then fire today.
	test("an optional scheduledTime is written and reads back", () => {
		const d = buildDraftNote({
			hint: "yeti tumbler",
			copy: "x",
			mediaUrl: "u",
			door: "web",
			date: "2026-07-15",
			scheduledTime: "2026-07-20T15:00:00.000Z",
		});
		expect(readNote(d.filename, d.content).scheduledTime).toBe(
			"2026-07-20T15:00:00.000Z",
		);
	});

	test("no scheduledTime leaves the field off entirely (drain default applies)", () => {
		expect(draft.content).not.toContain("scheduled_time");
		expect(readNote(draft.filename, draft.content).scheduledTime).toBeNull();
	});

	test("a hint of only punctuation still yields a usable slug", () => {
		const d = buildDraftNote({
			hint: "!!!",
			copy: "x",
			mediaUrl: "u",
			door: "web",
			date: "2026-07-15",
		});
		expect(d.filename).toBe("2026-07-15-intake-post.md");
	});
});

describe("createDraft — orchestration", () => {
	function deps(over: Partial<IntakeDeps> = {}): {
		deps: IntakeDeps;
		calls: Record<string, unknown>;
	} {
		const calls: Record<string, unknown> = {};
		return {
			calls,
			deps: {
				upload: async (f) => {
					calls.uploaded = f.filename;
					return { publicUrl: "https://database.blotato.com/x/p.jpg" };
				},
				generateCopy: async (sys, prompt) => {
					calls.copySystem = sys;
					calls.copyPrompt = prompt;
					return "A warm caption.\n\n#handengraved";
				},
				writeNote: (d) => {
					calls.wrote = d.filename;
					return `/vault/${d.filename}`;
				},
				today: () => "2026-07-15",
				...over,
			},
		};
	}

	test("uploads, generates, and writes — in that order", async () => {
		const { deps: d, calls } = deps();
		const { draft, path } = await createDraft(d, {
			bytes: new Uint8Array([1, 2]),
			filename: "IMG_001.jpg",
			contentType: "image/jpeg",
			hint: "ammo can gift",
			door: "web",
		});
		expect(calls.uploaded).toBe("IMG_001.jpg");
		expect(calls.copyPrompt).toContain("ammo can gift");
		expect(calls.wrote).toBe(draft.filename);
		expect(path).toBe(`/vault/${draft.filename}`);
		expect(readNote(draft.filename, draft.content).media).toBe(
			"https://database.blotato.com/x/p.jpg",
		);
	});

	test("a missing hint is refused before any upload (no half-made drafts)", async () => {
		const { deps: d, calls } = deps();
		await expect(
			createDraft(d, {
				bytes: new Uint8Array([1]),
				filename: "a.jpg",
				contentType: "image/jpeg",
				hint: "  ",
				door: "web",
			}),
		).rejects.toThrow(/hint/);
		expect(calls.uploaded).toBeUndefined();
	});

	// A note-to-a-human sitting inside the note is exactly the shape that got two
	// `video-script` notes one field-edit away from being published as captions. The
	// `## Voice check` heading is what stops the copy section, so this is load-bearing.
	test("a Voice check block never leaks into what ships", () => {
		const d = buildDraftNote({
			hint: "yeti tumbler",
			copy: CLEAN,
			mediaUrl: "u",
			door: "web",
			date: "2026-07-15",
			voiceIssues: ["filler word: just", "2 hashtags (need 3 to 5)"],
		});
		expect(d.content).toContain("## Voice check");
		expect(extractCopy(d.content)).toBe(CLEAN);
		expect(readNote(d.filename, d.content).copy).toBe(CLEAN);
	});

	test("a failed voice check is visible on the card, not only in the body", () => {
		const d = buildDraftNote({
			hint: "yeti tumbler",
			copy: "x",
			mediaUrl: "u",
			door: "web",
			date: "2026-07-15",
			voiceIssues: ["filler word: just"],
		});
		expect(d.content).toContain("grade: voice check FAILED (1 issue)");
	});

	test("regenerates once when the copy fails, and keeps the better attempt", async () => {
		let n = 0;
		const { deps: d } = deps({
			generateCopy: async () => {
				n += 1;
				return n === 1 ? "Nope — just bad. #one" : CLEAN;
			},
		});
		const { draft } = await createDraft(d, {
			bytes: new Uint8Array([1]),
			filename: "a.jpg",
			contentType: "image/jpeg",
			hint: "teacher tumbler",
			door: "web",
		});
		expect(n).toBe(2);
		expect(extractCopy(draft.content)).toBe(CLEAN);
		expect(draft.content).not.toContain("## Voice check");
	});

	test("stops at one retry and flags what survived — never loops", async () => {
		let n = 0;
		const { deps: d } = deps({
			generateCopy: async () => {
				n += 1;
				return "Still just bad. #one";
			},
		});
		const { draft } = await createDraft(d, {
			bytes: new Uint8Array([1]),
			filename: "a.jpg",
			contentType: "image/jpeg",
			hint: "teacher tumbler",
			door: "web",
		});
		expect(n).toBe(2);
		expect(draft.content).toContain("## Voice check");
		expect(draft.content).toContain("filler word: just");
		// Still a pending, editable draft — a flagged caption beats no caption.
		expect(readNote(draft.filename, draft.content).status).toBe("pending");
	});

	// A drop folder is a trust boundary: whatever syncs into it gets read whole into
	// memory. Refuse before the upload rather than hang on a 4K master.
	test("an oversized file is refused before any upload", async () => {
		const { deps: d, calls } = deps();
		await expect(
			createDraft(d, {
				bytes: new Uint8Array(MAX_MEDIA_BYTES + 1),
				filename: "master.mov",
				contentType: "video/quicktime",
				hint: "big",
				door: "folder",
			}),
		).rejects.toThrow(/over the/);
		expect(calls.uploaded).toBeUndefined();
	});

	test("a video's prompt says video, not photo", async () => {
		const { deps: d, calls } = deps({
			generateCopy: async (_sys, prompt) => {
				calls.copyPrompt = prompt;
				return CLEAN;
			},
		});
		await createDraft(d, {
			bytes: new Uint8Array([1]),
			filename: "reel.mp4",
			contentType: "video/mp4",
			kind: "video",
			hint: "engraving in progress",
			door: "folder",
		});
		expect(calls.copyPrompt).toContain("video is already attached");
		expect(calls.copyPrompt).not.toContain("photo");
	});

	test("empty generated copy is an error, not a blank post", async () => {
		const { deps: d } = deps({ generateCopy: async () => "   " });
		await expect(
			createDraft(d, {
				bytes: new Uint8Array([1]),
				filename: "a.jpg",
				contentType: "image/jpeg",
				hint: "x",
				door: "web",
			}),
		).rejects.toThrow(/copy/);
	});
});
