import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeManifest, readManifest } from "./manifest";
import type { RunManifest } from "shared/orchestrator/types";

const run: RunManifest = {
	run_id: "2026-07-13-fd", goal: "Father's Day push", status: "running",
	created: "2026-07-13", summary: null,
	nodes: [{ id: "n1", agent: "foreman", task: "3 mockups", needs: [], status: "done", handoff_id: "h1", result: "vault/x.png" }],
};

test("writeManifest then readManifest round-trips", () => {
	const vault = mkdtempSync(join(tmpdir(), "orch-"));
	writeManifest(vault, run);
	const back = readManifest(vault, "2026-07-13-fd");
	expect(back).not.toBeNull();
	expect(back!.goal).toBe("Father's Day push");
	expect(back!.nodes[0].result).toBe("vault/x.png");
});

test("readManifest returns null for an unknown run", () => {
	const vault = mkdtempSync(join(tmpdir(), "orch-"));
	expect(readManifest(vault, "nope")).toBeNull();
});
