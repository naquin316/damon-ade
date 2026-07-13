import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { capabilityManifestSchema, type Roster } from "shared/orchestrator/types";
import { resolveSeedBrainsRoot } from "../seed-brains";

export function loadRosterFrom(root: string): Roster {
	if (!existsSync(root)) return [];
	const roster: Roster = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const p = join(root, entry.name, "capabilities.yaml");
		if (!existsSync(p)) continue;
		try {
			const parsed = capabilityManifestSchema.safeParse(parse(readFileSync(p, "utf8")));
			if (parsed.success) roster.push(parsed.data);
			else console.warn(`[orchestrator] skipping malformed capabilities.yaml: ${p}`);
		} catch {
			console.warn(`[orchestrator] unreadable capabilities.yaml: ${p}`);
		}
	}
	return roster;
}

export function loadRoster(): Roster {
	return loadRosterFrom(resolveSeedBrainsRoot());
}
