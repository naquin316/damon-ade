import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";
import { handoffInbox } from "./paths";

// Matches a leading YYYY-MM-DD date prefix (e.g. handoff ids built as
// `<date>-<event>-<handle>` per the handoff SKILL's SEND convention).
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

export function writeDispatchNote(
	vault: string,
	args: {
		slug: string;
		handoffId: string;
		runId: string;
		task: string;
		facts?: string;
		created?: string;
	},
): void {
	const inbox = handoffInbox(vault, args.slug);
	const doneDir = join(inbox, "done");
	const filename = `${args.handoffId}.md`;
	if (existsSync(join(inbox, filename)) || existsSync(join(doneDir, filename))) return; // dedup
	mkdirSync(inbox, { recursive: true });
	// Prefer an explicit `created`; else derive from a date-prefixed handoffId
	// (the SEND convention); else omit rather than write a garbage date sliced
	// out of an id that was never date-prefixed (e.g. `run-<uuid>-n1`).
	const created =
		args.created ?? (DATE_PREFIX.test(args.handoffId) ? args.handoffId.slice(0, 10) : undefined);
	const data = {
		handoff_id: args.handoffId,
		from: "conductor",
		to: args.slug,
		status: "pending",
		run_id: args.runId,
		...(created ? { created } : {}),
	};
	const body = `## Task\n${args.task}\n${args.facts ? `\n## Facts\n${args.facts}\n` : ""}`;
	writeFileSync(join(inbox, filename), joinFrontmatter(data, body), "utf8");
}

/**
 * Delete a stale dispatch note (from either the inbox or its `done/`
 * subfolder) so a subsequent `writeDispatchNote` for the same handoffId
 * isn't defeated by the dedup check. Best-effort: a retry must never be
 * blocked by a filesystem hiccup while clearing the old note, so this never
 * throws.
 */
export function clearDispatchNote(vault: string, slug: string, handoffId: string): void {
	try {
		const inbox = handoffInbox(vault, slug);
		const filename = `${handoffId}.md`;
		for (const p of [join(inbox, filename), join(inbox, "done", filename)]) {
			if (existsSync(p)) unlinkSync(p);
		}
	} catch {
		// best-effort; never throw
	}
}

/**
 * Last-resort line scan for the two contract fields when the YAML parse fails.
 *
 * The run manifest is machine-written (`joinFrontmatter` -> yaml.stringify), so
 * it is always valid YAML. A handoff note is the opposite: the AGENT hand-edits
 * this frontmatter, and an unquoted `result:` holding a colon-space ("Note: the
 * shared dir…"), a `#`, or a stray quote is invalid YAML. `splitFrontmatter`
 * swallows that error and returns `{}`, which used to read back as
 * `status: "pending"` — indistinguishable from "never picked up". The node then
 * sat until the 15-minute timeout and FAILED, silently discarding work the
 * agent had already completed successfully. Observed live: a repurposer node
 * wrote a perfect result containing "Note: " and was thrown away for it.
 *
 * Being strict here buys nothing (there is no second reader of these notes) and
 * costs real work, so accept a quoting slip: `status:` is always its own line,
 * and `result:` runs to the end of the frontmatter block.
 */
function scanContractFields(fm: string): { status: string; result: string | null } {
	const status = fm.match(/^status:[ \t]*["']?(\w+)["']?[ \t]*$/m)?.[1];
	const idx = fm.search(/^result:/m);
	const result = idx === -1
		? null
		: fm.slice(idx).replace(/^result:[ \t]*/, "").trim().replace(/\s*\n\s*/g, " ") || null;
	return { status: status ?? "pending", result };
}

export function readHandoffStatus(
	vault: string, slug: string, handoffId: string,
): { status: string; result: string | null } | null {
	const inbox = handoffInbox(vault, slug);
	const filename = `${handoffId}.md`;
	const candidate = [join(inbox, filename), join(inbox, "done", filename)].find(existsSync);
	if (!candidate) return null;
	const raw = readFileSync(candidate, "utf8");
	const { data } = splitFrontmatter(raw);
	const d = (data ?? {}) as { status?: string; result?: string };
	if (d.status) return { status: d.status, result: d.result ?? null };
	// No status off the parsed YAML: either the frontmatter didn't parse, or the
	// agent hasn't written a status yet. Fall back to the line scan (see above)
	// before reporting the "pending" that would strand a finished node.
	const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
	if (!fm) return { status: "pending", result: null };
	const scanned = scanContractFields(fm);
	if (scanned.status !== "pending") {
		console.warn(
			`[orchestrator] handoff ${handoffId} (${slug}): frontmatter did not parse as YAML; recovered status "${scanned.status}" by line scan. The agent likely wrote an unquoted result: containing ':' or '#'.`,
		);
	}
	return scanned;
}
