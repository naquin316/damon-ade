import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_BRAIN_SLUGS,
	getAuthoredBrainDir,
	slugForAgent,
} from "./seed-brains";

const sandbox = join(tmpdir(), "ade-seed-brains-test");
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true });
	delete process.env.ADE_SEED_BRAINS_ROOT;
});

describe("seed-brains", () => {
	it("maps every HLD Ops agent name to a slug", () => {
		expect(slugForAgent("Shopify / Store Cockpit")).toBe(
			"shopify-store-cockpit",
		);
		expect(slugForAgent("Storefront Support")).toBe("storefront-support");
		expect(slugForAgent("RubyPulse / Laser")).toBe("rubypulse-laser");
		expect(slugForAgent("Foreman / Listings")).toBe("foreman-listings");
	});

	it("returns undefined for a deferred greenfield agent", () => {
		expect(slugForAgent("Consulting")).toBeUndefined();
		expect(slugForAgent("SaaS Build")).toBeUndefined();
	});

	it("finds an authored brain only when persona.txt is present and non-empty", () => {
		process.env.ADE_SEED_BRAINS_ROOT = sandbox;
		const brainDir = join(sandbox, "shopify-store-cockpit", "brain");
		// no dir yet → undefined
		expect(getAuthoredBrainDir("Shopify / Store Cockpit")).toBeUndefined();
		// empty persona → still undefined
		mkdirSync(brainDir, { recursive: true });
		writeFileSync(join(brainDir, "persona.txt"), "   ");
		expect(getAuthoredBrainDir("Shopify / Store Cockpit")).toBeUndefined();
		// populated → returns the dir
		writeFileSync(join(brainDir, "persona.txt"), "You are Store Cockpit.");
		expect(getAuthoredBrainDir("Shopify / Store Cockpit")).toBe(brainDir);
	});

	it("has no slug entries for deferred agents (only the 9 sourced)", () => {
		expect(Object.keys(AGENT_BRAIN_SLUGS)).toHaveLength(9);
	});
});
