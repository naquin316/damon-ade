import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Dashboard } from "shared/mission-control-types";
import { DEFAULT_DASHBOARDS, readDashboards } from "./config";

const sandbox = join(tmpdir(), "ade-mc-test");
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true });
	delete process.env.ADE_HOME_DIR;
});

describe("mission-control config", () => {
	it("seeds mission-control.json with the 5 defaults when absent", () => {
		process.env.ADE_HOME_DIR = sandbox;
		mkdirSync(sandbox, { recursive: true });
		const got = readDashboards();
		expect(got).toHaveLength(5);
		expect(got.map((d) => d.id)).toEqual(["ops-deck", "rubypulse", "mypka", "catchpad", "codehq"]);
		expect(existsSync(join(sandbox, "mission-control.json"))).toBe(true); // seeded to disk
	});
	it("reads an existing roster and preserves user edits/order", () => {
		process.env.ADE_HOME_DIR = sandbox;
		mkdirSync(sandbox, { recursive: true });
		const custom: Dashboard[] = [{ id: "x", name: "X", url: "http://x", kind: "web" }];
		writeFileSync(join(sandbox, "mission-control.json"), JSON.stringify(custom));
		expect(readDashboards()).toEqual(custom);
	});
	it("falls back to defaults (does not throw) on malformed JSON", () => {
		process.env.ADE_HOME_DIR = sandbox;
		mkdirSync(sandbox, { recursive: true });
		writeFileSync(join(sandbox, "mission-control.json"), "{ not json");
		expect(readDashboards()).toEqual(DEFAULT_DASHBOARDS);
	});
});
