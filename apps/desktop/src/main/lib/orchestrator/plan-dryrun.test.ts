import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadRosterFrom } from "./capabilities";
import { wireDependencies, detectCycle } from "./dag";
import type { RunNode } from "shared/orchestrator/types";

test("real roster wires the Father's Day plan into an acyclic chain", () => {
	const roster = loadRosterFrom(
		join(import.meta.dir, "../../../../../..", "assets", "seed-brains"),
	);
	const node = (id: string, agent: string): RunNode => ({
		id,
		agent,
		task: id,
		needs: [],
		status: "pending",
		handoff_id: null,
		result: null,
	});
	const wired = wireDependencies(
		[
			node("n1", "foreman-listings"),
			node("n2", "shopify-store-cockpit"),
			node("n3", "sm-manager"),
		],
		roster,
	);
	expect(detectCycle(wired)).toBeNull();
	// store depends on foreman, sm depends on store (via emits→needs vocab):
	expect(wired.find((n) => n.id === "n2")!.needs).toContain("n1");
	expect(wired.find((n) => n.id === "n3")!.needs).toContain("n2");
});
