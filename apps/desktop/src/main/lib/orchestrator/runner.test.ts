import { expect, test } from "bun:test";
import type { RunManifest } from "shared/orchestrator/types";
import { runToCompletion } from "./runner";

test("runToCompletion drives a 2-node run to done via fake deps", async () => {
	const run: RunManifest = {
		run_id: "r1",
		goal: "g",
		status: "running",
		created: "2026-07-13",
		summary: null,
		nodes: [
			{
				id: "n1",
				agent: "foreman",
				task: "t1",
				needs: [],
				status: "pending",
				handoff_id: null,
				result: null,
			},
			{
				id: "n2",
				agent: "store",
				task: "t2",
				needs: ["n1"],
				status: "pending",
				handoff_id: null,
				result: null,
			},
		],
	};
	const doneAfter = new Set<string>();
	const final = await runToCompletion(run, {
		dispatch: (n) => {
			doneAfter.add(n.id);
			return { ok: true };
		},
		pollStatus: (n) =>
			doneAfter.has(n.id) ? { status: "done", result: `out-${n.id}` } : null,
		now: () => 0,
		onUpdate: () => {},
		timeoutMs: 1000,
		tick: async () => {},
	});
	expect(final.status).toBe("done");
	expect(final.nodes.every((n) => n.status === "done")).toBe(true);
});
