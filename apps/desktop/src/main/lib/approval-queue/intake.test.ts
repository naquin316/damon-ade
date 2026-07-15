import { describe, expect, test } from "bun:test";
import type { BlotatoAccount } from "./blotato";
import {
	buildDraftNote,
	cleanCopy,
	createDraft,
	type IntakeDeps,
} from "./intake";
import { classify, readNote } from "./queue";

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
