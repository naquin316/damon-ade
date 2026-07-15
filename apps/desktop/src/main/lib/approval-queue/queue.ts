import { splitFrontmatter } from "../orchestrator/frontmatter";
import type { BlotatoAccount } from "./blotato";

/**
 * Pure scan/classify half of the Approval Queue consumer (RYA-166).
 *
 * Deliberately free of I/O and of Electron: the drain has to run from launchd
 * with the app closed (that is the whole point — approving from a phone while
 * the Mac sits shut), and it has to be unit-testable without a vault or a network.
 */

/** How long a `scheduling` claim may sit before it stops being "in progress". */
export const STALE_CLAIM_MS = 20 * 60 * 1000;

/**
 * Platforms that cannot carry a text-only post.
 *
 * Instagram was the only entry until a live check found the hole: a note reading
 * `platform: tiktok` with no `media:` would have sailed through the gate and posted
 * its TEXT to TikTok — a platform where a post without a video does not exist. The
 * near-miss was real: two `type: video-script` notes (shooting scripts full of
 * `[b-roll: …]` directions) were one field-edit away from being published as TikTok
 * captions.
 *
 * These are media-or-nothing platforms. Being wrong in the permissive direction here
 * publishes garbage to a live account; being wrong in the strict direction just
 * reports `no-media` and waits.
 */
const MEDIA_REQUIRED = new Set(["instagram", "tiktok", "youtube", "pinterest"]);

/** Facebook's API requires a page id on `target`. */
const PAGE_ID_REQUIRED = new Set(["facebook"]);

export interface QueueNote {
	file: string;
	/** Lower-cased and trimmed. `pending` when absent — never `approved`. */
	status: string;
	/** The `approved` CHECKBOX — the human gate. `true` only for a literal YAML
	 *  boolean true, never for a string. Null when the property is absent. */
	approved: boolean | null;
	platforms: string[];
	media: string | null;
	accountId: string | null;
	pageId: string | null;
	scheduledTime: string | null;
	schedulingStarted: string | null;
	/** The verbatim copy to publish, lifted from `## Final copy (verbatim)`. */
	copy: string | null;
	/** The note's declared `type:` — some types are human deliverables, not posts. */
	type: string | null;
}

/** Statuses this system understands. Anything else in the field is a typo, and a
 *  typo must be LOUD: silently treating `aproved` as "not approved" means Ryan
 *  thinks he shipped a post and nothing ever happens. */
const KNOWN_STATUSES = new Set([
	"pending",
	"approved",
	"scheduling",
	"scheduled",
	"needs-review",
	"skipped",
]);

/** Statuses owned by the machine — the note is past the human gate, so the
 *  `approved` checkbox is irrelevant and must not re-trigger a send. */
const MACHINE_STATUSES = new Set(["scheduled", "needs-review", "skipped"]);

/** One concrete post to send. A note targeting `instagram + facebook` yields two. */
export interface PlannedPost {
	platform: string;
	accountId: string;
	pageId?: string;
	text: string;
	mediaUrls: string[];
}

export type BlockedReason =
	| "no-media"
	| "no-platform"
	| "no-copy"
	| "no-connected-account"
	| "no-page-id"
	| "unknown-status"
	| "not-a-post";

/**
 * `type:` values that are DELIVERABLES FOR A HUMAN, not publishable copy.
 *
 * A `video-script` note's "Final copy" is a shooting script — `**HOOK (first 1.7s)**`,
 * `[b-roll: laser engraver running]`, on-screen text cues. It describes a video that
 * does not exist yet. Publishing it would post stage directions to a live account.
 *
 * This exists because that nearly happened: two reel scripts were labelled
 * `platform: short-form-video` (correctly — "a video, once filmed"), and the obvious
 * "fix" was to change it to `tiktok`. That one edit would have published the script
 * text itself. The media gate would NOT have caught it before tiktok was added to
 * MEDIA_REQUIRED, and even now a script with a video attached would still be wrong
 * copy. So refuse on the note's own declared type, not on a downstream symptom.
 */
const NON_POST_TYPES = new Set(["video-script", "script", "outline", "brief"]);

export type Classification =
	| { kind: "shippable"; posts: PlannedPost[] }
	| { kind: "blocked"; reason: BlockedReason; detail?: string }
	| { kind: "needs-review"; reason: "stale-claim"; since: string | null }
	| { kind: "claimed" }
	| { kind: "untouched"; status: string };

/** Pull one `key: value` line straight out of the raw frontmatter block.
 *
 *  The fallback for when the YAML does not parse. Queue notes are AGENT-written,
 *  so an unquoted value holding ": " (e.g. `grade: 9.0/10 Note: fine`) or a stray
 *  quote is entirely ordinary — and `splitFrontmatter` swallows the error and
 *  returns `{}`. Read strictly, that reads back as `pending` and silently strands a
 *  post a human already approved. handoff.ts learned this the expensive way
 *  (4f17f3f: a finished node destroyed by a quoting slip). Strictness buys nothing
 *  here (no second reader) and costs real work. */
function scanField(fm: string, key: string): string | undefined {
	const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
	if (!m) return undefined;
	return (
		m[1]
			.trim()
			.replace(/^["']|["']$/g, "")
			.trim() || undefined
	);
}

/** `instagram + facebook` is a real value in the live queue, so a platform field is
 *  a list, not a scalar. */
export function parsePlatforms(raw: string | undefined | null): string[] {
	if (!raw) return [];
	return raw
		.split("+")
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean);
}

/**
 * Lift the publishable copy out of `## Final copy (verbatim)`.
 *
 * The trailing-annotation strip is not cosmetic. A real note in the queue ends its
 * copy section with:
 *
 *     **Facebook version:** same copy, drop all 4 hashtags.
 *
 * That is a note to a human, not copy. Posting it verbatim would publish editorial
 * scaffolding to a live brand account, so any trailing `**<Platform> version:**`
 * block is cut. The dry-run prints the exact text that would be sent precisely so
 * this stays reviewable rather than trusted.
 */
export function extractCopy(raw: string): string | null {
	// Deliberately NOT one regex with a `(?=\n##|$)` lookahead: under the `m` flag
	// `$` means end-of-LINE, so a lazy quantifier stops at the first newline and
	// captures nothing. Find the heading, then scan forward for the terminator.
	const head = raw.match(/^##[ \t]+Final copy[^\n]*\n/m);
	if (!head || head.index === undefined) return null;

	const after = raw.slice(head.index + head[0].length);
	// The section ends at the next heading, or at a `---` rule (which precedes the
	// approval footer in these notes), whichever comes first.
	const end = after.search(/^(?:##[ \t]|---[ \t]*$)/m);
	let body = end === -1 ? after : after.slice(0, end);

	const ann = body.search(
		/^\*\*(?:Facebook|Instagram|X|Twitter|LinkedIn|Threads|TikTok|Pinterest)\b[^*\n]*version:?\*\*/im,
	);
	if (ann !== -1) body = body.slice(0, ann);

	return body.trim() || null;
}

export function readNote(file: string, raw: string): QueueNote {
	const { data } = splitFrontmatter(raw);
	const d = (data ?? {}) as Record<string, unknown>;
	const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1];

	// Prefer parsed YAML; fall back to a line scan of the same key.
	const pick = (key: string): string | undefined => {
		const v = d[key];
		if (typeof v === "string" && v.trim()) return v.trim();
		if (typeof v === "number") return String(v);
		return fm ? scanField(fm, key) : undefined;
	};

	// The `approved` checkbox. STRICT on purpose: only a real YAML boolean `true`
	// counts. A string "true" is what a confused agent writes, not what Obsidian's
	// checkbox produces, and this is the gate in front of a live brand account —
	// it does not get to be liberal.
	const approvedRaw = d.approved;
	const approved =
		typeof approvedRaw === "boolean"
			? approvedRaw
			: fm && /^approved:[ \t]*true[ \t]*$/m.test(fm)
				? true
				: fm && /^approved:[ \t]*false[ \t]*$/m.test(fm)
					? false
					: null;

	return {
		file,
		// Absent status means "not approved". Defaulting the other way would let a
		// malformed note publish itself.
		status: (pick("status") ?? "pending").toLowerCase(),
		approved,
		platforms: parsePlatforms(pick("platform")),
		media: pick("media") ?? null,
		accountId: pick("accountId") ?? null,
		pageId: pick("pageId") ?? null,
		scheduledTime: pick("scheduled_time") ?? null,
		schedulingStarted: pick("scheduling_started") ?? null,
		copy: extractCopy(raw),
		type: (pick("type") ?? null)?.toLowerCase() ?? null,
	};
}

/** Is this a usable future timestamp, or prose like "pending approval"? */
function isoOrNull(v: string | null): string | null {
	if (!v) return null;
	const t = Date.parse(v);
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Decide what, if anything, this note warrants. The consumer acts on the return
 * value and nothing else.
 *
 * Note what is absent: there is no branch that produces `approved`. This process
 * ships what a human already approved and can never approve on their behalf.
 *
 * `connected` is the live platform->account index from Blotato. Passing it in
 * (rather than fetching) keeps this pure and makes "you have no X account" a
 * testable classification instead of a runtime surprise.
 */
export function classify(
	note: QueueNote,
	now: number,
	connected: Map<string, BlotatoAccount>,
): Classification {
	if (note.status === "scheduling") {
		const started = note.schedulingStarted
			? Date.parse(note.schedulingStarted)
			: Number.NaN;
		if (Number.isFinite(started) && now - started < STALE_CLAIM_MS) {
			// Someone is shipping this right now. Hands off — re-sending here is
			// precisely the duplicate public post the claim exists to prevent.
			return { kind: "claimed" };
		}
		// Stale claim: the shipper died, or the Mac slept. AMBIGUOUS and deliberately
		// not resumed — it either died before POSTing (retry correct) or after (retry
		// double-posts on a live account), and nothing on disk distinguishes them. The
		// orchestrator gambles on resume because its side effects are private vault
		// writes; a public post is irreversible, so this escalates to a human.
		return {
			kind: "needs-review",
			reason: "stale-claim",
			since: note.schedulingStarted,
		};
	}

	// Past the human gate already — the machine owns this note now. Checked BEFORE
	// the gate below so a lingering `approved: true` can never re-send a post that
	// already went out, and so `skipped` always beats a stray ticked checkbox.
	if (MACHINE_STATUSES.has(note.status))
		return { kind: "untouched", status: note.status };

	// THE GATE. Two equivalent ways a human says yes:
	//   - the `approved` CHECKBOX (preferred — impossible to typo)
	//   - `status: approved` (the original contract; agent-written notes use it)
	const isApproved = note.approved === true || note.status === "approved";

	if (!isApproved) {
		// An unrecognised status is almost certainly a typo of "approved"
		// ("aproved", "approve", "Approved!"). Reading it as "not approved" is SAFE
		// but dishonest: Ryan thinks he shipped a post and nothing happens, with no
		// signal anywhere. Silent no-ops are the worst failure mode this queue has,
		// because the whole point is that a human's one-word edit means something.
		if (!KNOWN_STATUSES.has(note.status)) {
			return {
				kind: "blocked",
				reason: "unknown-status",
				detail: `"${note.status}" is not a known status — did you mean "approved"? (or tick the approved checkbox)`,
			};
		}
		return { kind: "untouched", status: note.status };
	}

	// Checked before everything else about the content: a script is not a post, no
	// matter how well-formed the rest of the note is or what platform it names.
	if (note.type && NON_POST_TYPES.has(note.type)) {
		return {
			kind: "blocked",
			reason: "not-a-post",
			detail: `type: ${note.type} is a deliverable for a human (a script/outline), not publishable copy — film it first, then attach the video`,
		};
	}

	if (note.platforms.length === 0)
		return { kind: "blocked", reason: "no-platform" };
	if (!note.copy) {
		return {
			kind: "blocked",
			reason: "no-copy",
			detail: "no '## Final copy (verbatim)' section",
		};
	}

	const mediaUrls = note.media ? [note.media] : [];
	const posts: PlannedPost[] = [];

	for (const platform of note.platforms) {
		// Report, don't fail: the note stays `approved` and untouched, so fixing the
		// gap and re-running ships it with no second approval.
		const account = connected.get(platform);
		if (!account) {
			return {
				kind: "blocked",
				reason: "no-connected-account",
				detail: `no ${platform} account connected to Blotato`,
			};
		}
		if (MEDIA_REQUIRED.has(platform) && mediaUrls.length === 0) {
			return {
				kind: "blocked",
				reason: "no-media",
				detail: `${platform} requires a media URL`,
			};
		}
		const pageId =
			note.pageId ?? (account.pageId ? String(account.pageId) : undefined);
		if (PAGE_ID_REQUIRED.has(platform) && !pageId) {
			return {
				kind: "blocked",
				reason: "no-page-id",
				detail: `${platform} requires a pageId (set 'pageId:' in the note)`,
			};
		}
		posts.push({
			platform,
			// The note's explicit accountId wins — it pins the exact account a human
			// reviewed. Fall back to the platform's connected account.
			accountId: note.accountId ?? String(account.id),
			...(pageId ? { pageId } : {}),
			text: note.copy,
			mediaUrls,
		});
	}

	return { kind: "shippable", posts };
}

/** When to schedule. An explicit ISO `scheduled_time:` in the note wins; otherwise
 *  a short delay from now, so an approval always leaves a window to cancel in
 *  Blotato rather than firing the instant the cron ticks. Never publish-now. */
export function resolveScheduledTime(
	note: QueueNote,
	now: number,
	defaultDelayMs = 10 * 60 * 1000,
): string {
	const explicit = isoOrNull(note.scheduledTime);
	if (explicit && Date.parse(explicit) > now) return explicit;
	return new Date(now + defaultDelayMs).toISOString();
}

/** Matches the FIRST frontmatter block only, so a `status:` line in the body
 *  (these notes quote their own frontmatter in prose) is never mistaken for the
 *  real field. */
const FM_BLOCK = /^(---\n)([\s\S]*?)(\n---)/;

/**
 * Return `raw` with the given frontmatter fields upserted (set if present, appended
 * if not), preserving every other byte.
 *
 * Deliberately a surgical line edit rather than a
 * `splitFrontmatter` -> mutate -> `joinFrontmatter` round-trip. That round-trip runs
 * the whole block through `yaml.stringify`, which (a) reformats every note it
 * touches and (b) silently DESTROYS exactly the notes `readNote`'s line-scan
 * fallback exists to rescue — a note whose YAML doesn't parse comes back from
 * `splitFrontmatter` as `{}`, and writing that out would erase the post. Editing one
 * line leaves the other bytes alone, so a note we can only partly understand
 * survives being edited.
 *
 * Used by the drain (claim/schedule/park) AND by the web viewer's approve/skip, so a
 * human ticking approve from a phone writes the file identically to the machine.
 */
export function upsertFrontmatter(
	raw: string,
	fields: Record<string, string>,
): string {
	const m = raw.match(FM_BLOCK);
	// No frontmatter: refuse to invent one. A note we can't read is a note we don't
	// touch.
	if (!m) return raw;

	let fm = m[2];
	for (const [key, value] of Object.entries(fields)) {
		const line = `${key}: ${value}`;
		const re = new RegExp(`^${key}:.*$`, "m");
		// Function replacer: these values come out of note text and can contain
		// `$&` / `$1`, which are replacement-string specials.
		fm = re.test(fm) ? fm.replace(re, () => line) : `${fm}\n${line}`;
	}

	return raw.replace(
		FM_BLOCK,
		(_all, open: string, _body: string, close: string) =>
			`${open}${fm}${close}`,
	);
}

/** Set `status` (plus any extra fields), preserving every other byte. Thin wrapper
 *  over upsertFrontmatter — status is always written first. */
export function withStatus(
	raw: string,
	status: string,
	extra: Record<string, string> = {},
): string {
	return upsertFrontmatter(raw, { status, ...extra });
}
