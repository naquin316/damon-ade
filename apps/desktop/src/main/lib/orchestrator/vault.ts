import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root of Ryan's Obsidian vault, where run manifests and handoff inboxes
 * live (see paths.ts). Overridable via ADE_SEED_VAULT for tests — mirrors
 * the private `vaultRoot()` in seed-cockpit.ts, which uses the SAME env var
 * so a test that points seeding at a sandbox vault also points the
 * orchestrator at it.
 */
export function vaultRoot(): string {
	return (
		process.env.ADE_SEED_VAULT ||
		join(
			homedir(),
			"Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026",
		)
	);
}
