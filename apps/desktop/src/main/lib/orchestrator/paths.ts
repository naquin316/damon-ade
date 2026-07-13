import { join } from "node:path";

export function runsDir(vault: string): string {
	return join(vault, "2. Areas", "Orchestrator", "runs");
}

export function runPath(vault: string, runId: string): string {
	return join(runsDir(vault), `${runId}.md`);
}

export function handoffInbox(vault: string, slug: string): string {
	return join(vault, "2. Areas", "Handoffs", slug);
}
