import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRosterFrom } from "./capabilities";

function seed(root: string, slug: string, yaml: string) {
	mkdirSync(join(root, slug), { recursive: true });
	writeFileSync(join(root, slug, "capabilities.yaml"), yaml, "utf8");
}

test("loadRosterFrom reads valid manifests and skips malformed", () => {
	const root = mkdtempSync(join(tmpdir(), "sb-"));
	seed(root, "foreman", "team: L\nagent: foreman\nhandles: [mockups]\nemits: [mockups]\n");
	seed(root, "broken", "team: X\n"); // missing agent+handles → skipped
	const roster = loadRosterFrom(root);
	expect(roster.map((c) => c.agent)).toEqual(["foreman"]);
});
