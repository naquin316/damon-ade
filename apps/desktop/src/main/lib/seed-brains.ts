import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Agent display name → seed-brain slug. ONLY the 10 sourced agents appear here.
 * Consulting + SaaS Build (greenfield) are deliberately absent → no authored
 * brain → the scaffold falls back to the generic template. Keep in sync with
 * seed-cockpit.ts agent names and assets/seed-brains/<slug>/.
 */
export const AGENT_BRAIN_SLUGS: Record<string, string> = {
	"Shopify / Store Cockpit": "shopify-store-cockpit",
	"Storefront Support": "storefront-support",
	"RubyPulse / Laser": "rubypulse-laser",
	"Foreman / Listings": "foreman-listings",
	"Script Writer": "script-writer",
	"Clip Scout": "clip-scout",
	"Kalshi BTC / Tessa": "kalshi-tessa",
	"Daily Planner": "daily-planner",
	"Code HQ / Portfolio": "codehq-portfolio",
	"SM Manager": "sm-manager",
	Conductor: "conductor",
};

export function slugForAgent(agentName: string): string | undefined {
	return AGENT_BRAIN_SLUGS[agentName] ?? AGENT_BRAIN_SLUGS[agentName.trim()];
}

/**
 * Root of the committed seed-brain assets. Order:
 *   1. ADE_SEED_BRAINS_ROOT (tests + explicit override)
 *   2. packaged app resources (<resourcesPath>/assets/seed-brains) when packaged
 *   3. repo-root assets/seed-brains (dev: `bun run dev` from source)
 * `app` may be undefined in a non-Electron unit-test context; optional
 * chaining already guards every access, so no try/catch is needed.
 */
export function resolveSeedBrainsRoot(): string {
	const override = process.env.ADE_SEED_BRAINS_ROOT;
	if (override) return override;
	if (app?.isPackaged)
		return join(process.resourcesPath, "assets", "seed-brains");
	if (app?.getAppPath) {
		// app.getAppPath() resolves to apps/desktop (not the monorepo root) —
		// same convention local-db/index.ts relies on for its drizzle path
		// (`join(app.getAppPath(), "../../packages/local-db/drizzle")`). Ascend
		// two levels to reach the repo root, where assets/ actually lives.
		return join(app.getAppPath(), "..", "..", "assets", "seed-brains");
	}
	// Non-Electron fallback: this file is apps/desktop/src/main/lib/seed-brains.ts →
	// repo root is five levels up; assets/ lives at the repo root.
	return join(__dirname, "..", "..", "..", "..", "..", "assets", "seed-brains");
}

/**
 * The authored brain dir for an agent, or undefined if none is installed.
 * "Installed" means the dir exists AND persona.txt is present and non-empty —
 * a half-written asset must not shadow the generic template.
 */
export function getAuthoredBrainDir(agentName: string): string | undefined {
	const slug = slugForAgent(agentName);
	if (!slug) return undefined;
	const brainDir = join(resolveSeedBrainsRoot(), slug, "brain");
	const persona = join(brainDir, "persona.txt");
	if (!existsSync(persona)) return undefined;
	if (readFileSync(persona, "utf8").trim().length === 0) return undefined;
	return brainDir;
}
