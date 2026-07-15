/**
 * Intake core — the shared engine behind all three front doors (web GUI, drop
 * folder, Telegram). Given a photo + a short hint about what it is, it:
 *   1. uploads the photo to Blotato -> a public media URL (blotato.uploadMedia)
 *   2. generates HLD-voiced Instagram copy for it (claude -p, injected)
 *   3. writes a well-formed PENDING queue note (approved: false)
 * The note then flows through the exact same approve -> drain -> ship path as every
 * other card. No new surface; the vault stays the bus.
 *
 * Everything with a side effect is injected, so buildDraftNote (the note format —
 * the part that must be exactly right for the drain to read it) is pure and tested.
 */

/** The HLD voice rules, inline so copy-gen doesn't depend on brain files being
 *  present. Mirrors brand-brief-hld: warm maker tone, hard guardrails. */
export const HLD_VOICE = `You write Instagram captions for Hand Lane Designs, a hand-engraving shop in New Braunfels, TX run by Ryan and his wife.

VOICE: warm, real maker. Talk like a person who made the thing, not an ad. Lead with the recipient or the moment, not the product spec.

HARD RULES (breaking any is a fail):
- NO em dashes. Use periods or commas.
- Use contractions. Use digits, not spelled-out numbers.
- Active voice. No filler words (really, very, just, basically, literally, actually) and no filler openers (in today's world, let me tell you).
- Say "hand-engraved". Always "New Braunfels, TX" (never Round Rock).
- NO invented claims: no insulation hour-ratings, no dishwasher claims, no brand names unless given, no fake social proof, no "best-seller".
- 3 to 5 hashtags, on their own line at the end.
- One clear call to action (shop the link in bio, or DM to personalize).

Output ONLY the caption text and its hashtags. No preamble, no "Here's the caption", no quotes around it.`;

export interface Draft {
	slug: string;
	filename: string;
	content: string;
}

/** Build the pending queue note. PURE — this format is the contract the drain reads
 *  (status, approved checkbox, platform, media, `## Final copy (verbatim)`), so it is
 *  fully unit-tested rather than trusted. */
export function buildDraftNote(args: {
	hint: string;
	copy: string;
	mediaUrl: string;
	platform?: string;
	door: string;
	date: string; // YYYY-MM-DD
}): Draft {
	const platform = (args.platform ?? "instagram").toLowerCase();
	const slugBase =
		args.hint
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "post";
	const slug = `${args.date}-intake-${slugBase}`;
	const title =
		args.hint.trim().replace(/\s+/g, " ").slice(0, 80) || "Intake draft";

	const fm = [
		"---",
		"brand: Hand Lane Designs (store)",
		`platform: ${platform}`,
		"status: pending",
		"approved: false",
		`media: ${args.mediaUrl}`,
		`product: ${title}`,
		"grade: ungraded (intake draft)",
		`source: intake (${args.door})`,
		`queued: ${args.date}`,
		"---",
	].join("\n");

	const body = [
		"",
		`# ${title}`,
		"",
		"## Final copy (verbatim)",
		"",
		args.copy.trim(),
		"",
		"---",
		"**Approve by ticking the `approved` checkbox in this note's properties.** Leave it unticked to skip.",
		"",
	].join("\n");

	return { slug, filename: `${slug}.md`, content: fm + body };
}

/** Tidy the model's caption. Trims, strips any wrapping quotes the model added, and
 *  closes a hashtag the model accidentally split with a space (observed live:
 *  `#gifts fordad` -> `#giftsfordad`). Only joins a lowercase run right after a tag. */
export function cleanCopy(raw: string): string {
	let s = raw
		.trim()
		.replace(/^["'`]+|["'`]+$/g, "")
		.trim();
	// A hashtag followed by a space then a lowercase word with no space of its own is
	// almost certainly one tag the model split. Rejoin conservatively.
	s = s.replace(
		/(#[A-Za-z0-9]+) ([a-z][A-Za-z0-9]*)/g,
		(m, tag, tail, off, str) => {
			// only rejoin when we're clearly in a trailing hashtag block (another # nearby)
			return /#/.test(str.slice(Math.max(0, off - 40), off))
				? `${tag}${tail}`
				: m;
		},
	);
	return s;
}

/** Prompt for the copy generator, given the operator's hint. */
export function buildCopyPrompt(hint: string): string {
	return `Write ONE Instagram caption for this Hand Lane Designs product:\n\n${hint}\n\nThe product photo is already attached, so describe the piece from the hint, don't describe the image.`;
}

export interface IntakeDeps {
	/** Upload the photo, return its public URL. */
	upload: (file: {
		bytes: Uint8Array;
		filename: string;
		contentType: string;
	}) => Promise<{ publicUrl: string }>;
	/** Generate caption copy from the voice + prompt. */
	generateCopy: (system: string, prompt: string) => Promise<string>;
	/** Persist the note; return the absolute path written. */
	writeNote: (draft: Draft) => string;
	/** YYYY-MM-DD for the filename/frontmatter. */
	today: () => string;
}

/**
 * Run the full intake: photo + hint -> a pending draft on disk. Returns the draft
 * and the path. Any door (web/folder/Telegram) calls this with the same shape.
 */
export async function createDraft(
	deps: IntakeDeps,
	input: {
		bytes: Uint8Array;
		filename: string;
		contentType: string;
		hint: string;
		door: string;
		platform?: string;
	},
): Promise<{ draft: Draft; path: string }> {
	if (!input.hint.trim())
		throw new Error("intake: a hint (what the product is) is required");

	const { publicUrl } = await deps.upload({
		bytes: input.bytes,
		filename: input.filename,
		contentType: input.contentType,
	});

	const copy = cleanCopy(
		await deps.generateCopy(HLD_VOICE, buildCopyPrompt(input.hint)),
	);
	if (!copy) throw new Error("intake: copy generation returned nothing");

	const draft = buildDraftNote({
		hint: input.hint,
		copy,
		mediaUrl: publicUrl,
		platform: input.platform,
		door: input.door,
		date: deps.today(),
	});
	const path = deps.writeNote(draft);
	return { draft, path };
}
