import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runManifestSchema, type RunManifest } from "shared/orchestrator/types";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";
import { runPath } from "./paths";

function body(run: RunManifest): string {
	const lines = run.nodes.map(
		(n) => `- **${n.id}** \`${n.agent}\` — ${n.task} _(${n.status})_`,
	);
	return `# ${run.goal}\n\n${lines.join("\n")}\n`;
}

export function writeManifest(vault: string, run: RunManifest): void {
	const p = runPath(vault, run.run_id);
	mkdirSync(dirname(p), { recursive: true });
	const { nodes, ...front } = run;
	writeFileSync(p, joinFrontmatter({ ...front, nodes }, body(run)), "utf8");
}

export function readManifest(vault: string, runId: string): RunManifest | null {
	const p = runPath(vault, runId);
	if (!existsSync(p)) return null;
	const { data } = splitFrontmatter(readFileSync(p, "utf8"));
	const parsed = runManifestSchema.safeParse(data);
	return parsed.success ? parsed.data : null;
}
