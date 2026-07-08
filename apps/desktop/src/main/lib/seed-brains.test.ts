import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	AGENT_BRAIN_SLUGS,
	getAuthoredBrainDir,
	resolveSeedBrainsRoot,
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

	it("dev fallback (no override) resolves to repo-root assets, not apps/desktop's own assets", () => {
		// No ADE_SEED_BRAINS_ROOT set → must fall through to the Electron
		// app.getAppPath() branch. test-setup.ts mocks app.getAppPath() to
		// return join(tmpdir(), "superset-test") and app.isPackaged to false —
		// standing in for apps/desktop's directory the way local-db/index.ts's
		// own app.getAppPath() convention does.
		delete process.env.ADE_SEED_BRAINS_ROOT;
		const mockedAppPath = join(tmpdir(), "superset-test");

		const root = resolveSeedBrainsRoot();

		// Must land on an assets/seed-brains directory...
		expect(root.endsWith(join("assets", "seed-brains"))).toBe(true);
		// ...but NOT one directly under the mocked app path (that would be the
		// apps/desktop/assets/seed-brains bug — getAppPath() is apps/desktop,
		// not the repo root).
		expect(root.startsWith(mockedAppPath)).toBe(false);
		// It must be exactly two directories above the mocked app path (the
		// repo-root convention used by local-db/index.ts's
		// `join(app.getAppPath(), "../../packages/local-db/drizzle")`).
		const expectedRoot = join(
			dirname(dirname(mockedAppPath)),
			"assets",
			"seed-brains",
		);
		expect(root).toBe(expectedRoot);
	});
});
