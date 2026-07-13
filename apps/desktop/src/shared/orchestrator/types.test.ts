import { expect, test } from "bun:test";
import { runManifestSchema, capabilityManifestSchema } from "./types";

test("capability manifest parses a full manifest", () => {
	const m = capabilityManifestSchema.parse({
		team: "Social Media",
		agent: "sm-manager",
		handles: ["draft brand-voiced posts"],
		needs: ["product-facts", "angle"],
		emits: ["drafted-posts"],
		gate: "publish-approval",
	});
	expect(m.agent).toBe("sm-manager");
	expect(m.emits).toEqual(["drafted-posts"]);
});

test("capability manifest defaults optional arrays to empty", () => {
	const m = capabilityManifestSchema.parse({ team: "X", agent: "y", handles: ["z"] });
	expect(m.needs).toEqual([]);
	expect(m.emits).toEqual([]);
});

test("run manifest parses with a node and back-fills defaults", () => {
	const r = runManifestSchema.parse({
		run_id: "2026-07-13-x",
		goal: "g",
		status: "planning",
		created: "2026-07-13",
		nodes: [{ id: "n1", agent: "foreman", task: "t", needs: [] }],
	});
	expect(r.nodes[0].status).toBe("pending");
	expect(r.nodes[0].result).toBeNull();
});
