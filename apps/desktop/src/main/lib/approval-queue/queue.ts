import { splitFrontmatter } from "../orchestrator/frontmatter";

/**
 * Pure scan/classify half of the Approval Queue consumer (RYA-166).
 *
 * Deliberately free of I/O and of Electron: the drain has to run from launchd
 * with the app closed (that is the whole point — approving from a phone while
 * the Mac sits shut), and it has to be unit-testable without a vault.
 */

/** How long a `scheduling` claim may sit before it stops being "in progress".
 *  Comfortably past the orchestrator's 15-minute node timeout so a slow-but-live
 *  ship is never mistaken for a dead one. */
export const STALE_CLAIM_MS = 20 * 60 * 1000;

/** Platforms that cannot be posted without a media URL. Instagram is the only
 *  one `post-scheduler` declares as hard-required (its Step 2 check), so it is
 *  the only one enforced here — guessing at others would block real posts. */
const MEDIA_REQUIRED = new Set(["instagram"]);

export interface QueueNote {
	file: string;
	/** Lower-cased and trimmed. `pending` when absent — never `approved`. */
	status: string;
	platforms: string[];
	media: string | null;
	schedulingStarted: string | null;
}

export type Classification =
	| { kind: "shippable"; targets: string[]; media: string | null }
	| { kind: "blocked"; reason: "no-media" | "no-platform"; targets: string[] }
	| { kind: "needs-review"; reason: "stale-claim"; since: string | null }
	| { kind: "claimed" }
	| { kind: "untouched"; status: string };

/** Pull one `key: value` line straight out of the raw frontmatter block.
 *
 *  The fallback for when the YAML does not parse. Queue notes are AGENT-written,
 *  so an unquoted value holding ": " (e.g. `grade: 9.0/10 Note: fine`) or a
 *  stray quote is entirely ordinary — and `splitFrontmatter` swallows the error
 *  and returns `{}`. Read strictly, that reads back as `pending` and silently
 *  strands a post a human already approved. handoff.ts learned this the
 *  expensive way (4f17f3f: a finished node destroyed by a quoting slip); the
 *  same contract applies here for the same reason. Strictness buys nothing
 *  (there is no second reader of these notes) and costs real work. */
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

/** `instagram + facebook` is a real value in the live queue, so a platform field
 *  is a list, not a scalar. */
export function parsePlatforms(raw: string | undefined | null): string[] {
	if (!raw) return [];
	return raw
		.split("+")
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean);
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

	return {
		file,
		// Absent status means "not approved". Defaulting the other way would let a
		// malformed note publish itself.
		status: (pick("status") ?? "pending").toLowerCase(),
		platforms: parsePlatforms(pick("platform")),
		media: pick("media") ?? null,
		schedulingStarted: pick("scheduling_started") ?? null,
	};
}

/**
 * Decide what, if anything, this note warrants. The consumer acts on the return
 * value and nothing else.
 *
 * Note what is absent: there is no branch that produces `approved`. This process
 * ships what a human already approved and can never approve on their behalf.
 */
export function classify(note: QueueNote, now: number): Classification {
	// A claim taken by an in-flight drain.
	if (note.status === "scheduling") {
		const started = note.schedulingStarted
			? Date.parse(note.schedulingStarted)
			: Number.NaN;
		if (Number.isFinite(started) && now - started < STALE_CLAIM_MS) {
			// Someone is shipping this right now. Hands off — re-dispatching here is
			// precisely the duplicate public post the claim exists to prevent.
			return { kind: "claimed" };
		}
		// Stale claim: the shipper died, or the Mac slept. This is AMBIGUOUS and
		// deliberately not resumed. Either it died before calling Blotato (retry
		// would be right) or after (retry double-posts on a live brand account).
		// Nothing on disk distinguishes the two. The orchestrator gambles on resume
		// because its side effects are private vault writes; a public post is
		// irreversible, so this escalates to a human instead of guessing.
		return {
			kind: "needs-review",
			reason: "stale-claim",
			since: note.schedulingStarted,
		};
	}

	if (note.status !== "approved")
		return { kind: "untouched", status: note.status };

	if (note.platforms.length === 0) {
		return { kind: "blocked", reason: "no-platform", targets: [] };
	}

	// Report, don't fail: the note stays `approved` and untouched, so attaching
	// media and re-running ships it with no second approval.
	if (note.platforms.some((p) => MEDIA_REQUIRED.has(p)) && !note.media) {
		return { kind: "blocked", reason: "no-media", targets: note.platforms };
	}

	return { kind: "shippable", targets: note.platforms, media: note.media };
}

/** Matches the FIRST frontmatter block only, so a `status:` line in the body
 *  (these notes quote their own frontmatter in prose) is never mistaken for the
 *  real field. */
const FM_BLOCK = /^(---\n)([\s\S]*?)(\n---)/;

/**
 * Return `raw` with its frontmatter `status` set, plus any extra fields upserted.
 *
 * Deliberately a surgical line edit rather than a
 * `splitFrontmatter` -> mutate -> `joinFrontmatter` round-trip. That round-trip
 * runs the whole block through `yaml.stringify`, which (a) reformats every note
 * it touches and (b) silently DESTROYS exactly the notes `readNote`'s line-scan
 * fallback exists to rescue — a note whose YAML doesn't parse comes back from
 * `splitFrontmatter` as `{}`, and writing that out would erase the post. Editing
 * one line leaves the other bytes alone, so a note we can only partly understand
 * survives being claimed.
 */
export function withStatus(
	raw: string,
	status: string,
	extra: Record<string, string> = {},
): string {
	const m = raw.match(FM_BLOCK);
	// No frontmatter: refuse to invent one. A note we can't read is a note we
	// don't touch.
	if (!m) return raw;

	let fm = m[2];
	const upsert = (key: string, value: string) => {
		const line = `${key}: ${value}`;
		const re = new RegExp(`^${key}:.*$`, "m");
		// Function replacers throughout: these values come out of note text and can
		// contain `$&` / `$1`, which are replacement-string specials.
		fm = re.test(fm) ? fm.replace(re, () => line) : `${fm}\n${line}`;
	};

	upsert("status", status);
	for (const [k, v] of Object.entries(extra)) upsert(k, v);

	return raw.replace(
		FM_BLOCK,
		(_all, open: string, _body: string, close: string) =>
			`${open}${fm}${close}`,
	);
}
