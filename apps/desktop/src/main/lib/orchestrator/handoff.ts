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

export function readHandoffStatus(
	vault: string, slug: string, handoffId: string,
): { status: string; result: string | null } | null {
	const inbox = handoffInbox(vault, slug);
	const filename = `${handoffId}.md`;
	const candidate = [join(inbox, filename), join(inbox, "done", filename)].find(existsSync);
	if (!candidate) return null;
	const { data } = splitFrontmatter(readFileSync(candidate, "utf8"));
	const d = (data ?? {}) as { status?: string; result?: string };
	return { status: d.status ?? "pending", result: d.result ?? null };
}
