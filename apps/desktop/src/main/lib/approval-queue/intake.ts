import { charLimits, parsePlatforms } from "./queue";

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

/** Filler words HLD_VOICE bans outright. */
const FILLER = ["really", "very", "just", "basically", "literally", "actually"];

/** Claims the brand rubric treats as HARD FAILS because nobody has verified them.
 *  Kept to the ones observed live rather than guessed — a false positive here
 *  burns a second `claude -p` call on copy that was fine. */
const BANNED_CLAIMS = [
	"dishwasher",
	"best-seller",
	"best seller",
	"bestseller",
];

/**
 * Check a caption against the HARD RULES in HLD_VOICE. PURE, so it is testable and
 * so every door gets the same verdict.
 *
 * WHY THIS EXISTS: on 2026-08-09 a hand-written caption reached a campaign with an
 * em dash and an invented dishwasher claim, and nothing in the pipeline noticed —
 * the rules lived only in the prompt, which is a request, not a check. The model
 * follows HLD_VOICE most of the time; "most of the time" is exactly the failure
 * mode a linter exists for.
 *
 * Length is NOT re-implemented here — `charLimits()` is the same table the ship
 * gate enforces, so a caption that passes this cannot be blocked later for a cap
 * this file guessed differently.
 */
export function lintVoice(copy: string, platforms: string[] = []): string[] {
	const errs: string[] = [];
	if (/[—–]/.test(copy)) errs.push("em/en dash (HARD RULE: none)");
	for (const w of FILLER) {
		if (new RegExp(`\\b${w}\\b`, "i").test(copy))
			errs.push(`filler word: ${w}`);
	}
	for (const w of BANNED_CLAIMS) {
		if (copy.toLowerCase().includes(w)) errs.push(`invented claim: ${w}`);
	}
	if (copy.includes("Round Rock")) errs.push("wrong town: Round Rock");
	if (!copy.includes("New Braunfels, TX"))
		errs.push('missing "New Braunfels, TX"');
	if (!copy.toLowerCase().includes("hand-engrave"))
		errs.push('missing "hand-engrave"');
	const tags = copy.match(/#\w+/g) ?? [];
	if (tags.length < 3 || tags.length > 5)
		errs.push(`${tags.length} hashtags (need 3 to 5)`);
	const caps = charLimits();
	for (const p of platforms) {
		const cap = caps[p.toLowerCase()];
		if (cap && copy.length > cap)
			errs.push(`${p}: ${copy.length}/${cap} over by ${copy.length - cap}`);
	}
	return errs;
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
	/** Optional ISO instant to pre-book the draft at — what "click a day on the
	 *  calendar to create a post" writes. Absent leaves the field off entirely, so
	 *  the drain falls back to its own default delay. */
	scheduledTime?: string;
	/** Voice-check failures that survived a regeneration. Rendered onto the note so
	 *  the thing Ryan approves carries its own warning — the caption is still here
	 *  and still editable, because a flawed draft he can fix beats no draft. */
	voiceIssues?: string[];
}): Draft {
	const platform = (args.platform ?? "instagram").toLowerCase();
	const slugBase =
		args.hint
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "post";
	const slug = `${args.date}-intake-${slugBase}`;
	// The title is the card's headline on Ryan's phone, so a hard 80-char cut mid-word
	// ("...Top reads \"For all that yo") reads as a broken note rather than a long one.
	// Trim back to the last word boundary when the cut lands inside a word.
	const flat = args.hint.trim().replace(/\s+/g, " ");
	const title =
		(flat.length <= 80 ? flat : flat.slice(0, 80).replace(/\s+\S*$/, "")) ||
		"Intake draft";
	const issues = args.voiceIssues ?? [];

	const fm = [
		"---",
		"brand: Hand Lane Designs (store)",
		`platform: ${platform}`,
		"status: pending",
		"approved: false",
		`media: ${args.mediaUrl}`,
		`product: ${title}`,
		// `grade` is free text the cockpit already renders, so a failed voice check
		// rides an existing field instead of a new key nothing downstream reads.
		issues.length
			? `grade: voice check FAILED (${issues.length} issue${issues.length === 1 ? "" : "s"})`
			: "grade: voice check passed (intake draft)",
		`source: intake (${args.door})`,
		`queued: ${args.date}`,
		...(args.scheduledTime ? [`scheduled_time: ${args.scheduledTime}`] : []),
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
		...(issues.length
			? [
					"## Voice check",
					"",
					"Regenerated once and these survived. Fix the copy above before approving:",
					"",
					...issues.map((e) => `- ${e}`),
					"",
				]
			: []),
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

/** Prompt for the copy generator, given the operator's hint. `kind` describes the
 *  attached media so the prompt doesn't tell the model a video is a photo. */
export function buildCopyPrompt(
	hint: string,
	kind: MediaKind = "photo",
): string {
	const noun = kind === "video" ? "video" : "photo";
	return `Write ONE Instagram caption for this Hand Lane Designs product:\n\n${hint}\n\nThe product ${noun} is already attached, so describe the piece from the hint, don't describe the ${noun}.`;
}

/** What the operator dropped. Only affects wording — Blotato stores either. */
export type MediaKind = "photo" | "video";

/**
 * Extension -> content type + kind. ONE table, imported by all three doors.
 *
 * It lived in three places (folder, Telegram, and the web form's `accept`), all
 * image-only, which is why a Reel could be produced by the pipeline and then had no
 * way back INTO it. Blotato's upload is content-type agnostic — it presigns on the
 * filename and PUTs whatever bytes it's given — so accepting video was never a
 * transport problem, only a filter three copies wide.
 *
 * What a platform ultimately accepts stays a downstream concern, visible on the card.
 */
const MEDIA_TYPES: Record<string, { contentType: string; kind: MediaKind }> = {
	".jpg": { contentType: "image/jpeg", kind: "photo" },
	".jpeg": { contentType: "image/jpeg", kind: "photo" },
	".png": { contentType: "image/png", kind: "photo" },
	".webp": { contentType: "image/webp", kind: "photo" },
	".heic": { contentType: "image/heic", kind: "photo" },
	".heif": { contentType: "image/heif", kind: "photo" },
	".mp4": { contentType: "video/mp4", kind: "video" },
	".m4v": { contentType: "video/mp4", kind: "video" },
	".mov": { contentType: "video/quicktime", kind: "video" },
	".webm": { contentType: "video/webm", kind: "video" },
};

/** Look up a droppable file by name. Null means "not media" — the door skips it,
 *  which is how a stray .txt sidecar or a .DS_Store stays harmless. */
export function mediaTypeFor(
	filename: string,
): { contentType: string; kind: MediaKind } | null {
	const dot = filename.lastIndexOf(".");
	if (dot < 0) return null;
	return MEDIA_TYPES[filename.slice(dot).toLowerCase()] ?? null;
}

/** Kind from a content type the caller already has (browser upload, Telegram mime). */
export function mediaKindFrom(contentType: string): MediaKind {
	return contentType.toLowerCase().startsWith("video/") ? "video" : "photo";
}

/**
 * Largest file a door will take. Blotato's PUT streams from a Uint8Array, so the
 * whole file is resident; an accidental 4K master dropped in the folder would sit
 * in memory and time out rather than fail with a reason. A phone Reel is ~20-60 MB,
 * so 200 MB is generous and still bounded.
 */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

/** Ask again, naming what was wrong. Feeding the failures back is the whole reason
 *  a retry is worth a second `claude -p` call: a blind re-roll fixes nothing. */
export function buildRetryPrompt(
	hint: string,
	issues: string[],
	kind: MediaKind = "photo",
): string {
	return `${buildCopyPrompt(hint, kind)}\n\nYour previous attempt broke these HARD RULES. Fix every one and keep the rest of the caption's tone:\n${issues.map((e) => `- ${e}`).join("\n")}`;
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
		scheduledTime?: string;
		kind?: MediaKind;
	},
): Promise<{ draft: Draft; path: string }> {
	if (!input.hint.trim())
		throw new Error("intake: a hint (what the product is) is required");
	if (input.bytes.byteLength > MAX_MEDIA_BYTES) {
		throw new Error(
			`intake: ${input.filename} is ${Math.round(input.bytes.byteLength / 1e6)} MB, over the ${Math.round(MAX_MEDIA_BYTES / 1e6)} MB limit`,
		);
	}

	const { publicUrl } = await deps.upload({
		bytes: input.bytes,
		filename: input.filename,
		contentType: input.contentType,
	});

	const kind = input.kind ?? "photo";
	// `+`-separated, per the note format — parsed by the same function readNote uses,
	// so the linter checks the caps of exactly the platforms the gate will check.
	const platforms = parsePlatforms(input.platform ?? "instagram");

	let copy = cleanCopy(
		await deps.generateCopy(HLD_VOICE, buildCopyPrompt(input.hint, kind)),
	);
	if (!copy) throw new Error("intake: copy generation returned nothing");

	// Lint, and on failure spend ONE more call with the failures named. Exactly one:
	// a loop-until-clean can't terminate against a model that keeps missing the same
	// rule, and the note is gated behind a human anyway, so a flagged draft is a
	// perfectly safe resting place. Keep the retry only if it's actually better.
	let issues = lintVoice(copy, platforms);
	if (issues.length) {
		const retry = cleanCopy(
			await deps.generateCopy(
				HLD_VOICE,
				buildRetryPrompt(input.hint, issues, kind),
			),
		);
		const retryIssues = retry ? lintVoice(retry, platforms) : issues;
		if (retry && retryIssues.length < issues.length) {
			copy = retry;
			issues = retryIssues;
		}
	}

	const draft = buildDraftNote({
		hint: input.hint,
		copy,
		mediaUrl: publicUrl,
		platform: input.platform,
		door: input.door,
		date: deps.today(),
		scheduledTime: input.scheduledTime,
		voiceIssues: issues,
	});
	const path = deps.writeNote(draft);
	return { draft, path };
}
