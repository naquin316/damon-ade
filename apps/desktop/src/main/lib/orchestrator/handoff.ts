import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";
import { handoffInbox } from "./paths";

export function writeDispatchNote(
	vault: string,
	args: { slug: string; handoffId: string; runId: string; task: string; facts?: string },
): void {
	const inbox = handoffInbox(vault, args.slug);
	const doneDir = join(inbox, "done");
	const filename = `${args.handoffId}.md`;
	if (existsSync(join(inbox, filename)) || existsSync(join(doneDir, filename))) return; // dedup
	mkdirSync(inbox, { recursive: true });
	const data = {
		handoff_id: args.handoffId,
		from: "conductor",
		to: args.slug,
		status: "pending",
		run_id: args.runId,
		created: args.handoffId.slice(0, 10),
	};
	const body = `## Task\n${args.task}\n${args.facts ? `\n## Facts\n${args.facts}\n` : ""}`;
	writeFileSync(join(inbox, filename), joinFrontmatter(data, body), "utf8");
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
