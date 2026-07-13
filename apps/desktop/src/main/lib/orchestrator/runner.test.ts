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

test("runToCompletion does not falsely finish a slow-but-healthy run when the old tick-count cap would have fired", async () => {
	// 3-node chain, each dependent on the previous. The old cap was
	// `nodes.length * 2 + 2` = 8 iterations. Each node here only reports
	// "done" on its 5th poll, so a correct loop needs well over 8 ticks to
	// drain all 3 nodes -- against the old count-cap code this test fails
	// (the run finalizes "done" at iteration 8 with nodes still
	// pending/running); against the isTerminal-driven fix it passes.
	const run: RunManifest = {
		run_id: "r-slow",
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
			{
				id: "n3",
				agent: "artisan",
				task: "t3",
				needs: ["n2"],
				status: "pending",
				handoff_id: null,
				result: null,
			},
		],
	};
	const pollCount = new Map<string, number>();
	const final = await runToCompletion(run, {
		dispatch: () => ({ ok: true }),
		pollStatus: (n) => {
			const count = (pollCount.get(n.id) ?? 0) + 1;
			pollCount.set(n.id, count);
			return count >= 5
				? { status: "done", result: `out-${n.id}` }
				: { status: "pending", result: null };
		},
		// Constant clock -- no node ever times out, so the ONLY thing that can
		// end this loop is every node reaching a terminal status.
		now: () => 0,
		onUpdate: () => {},
		timeoutMs: 1000,
		tick: async () => {},
	});
	expect(final.status).toBe("done");
	expect(final.nodes.every((n) => n.status === "done")).toBe(true);
});

test("runToCompletion still terminates (as partial) via per-node timeout, without relying on a node-count cap", async () => {
	// 2-node chain where the dispatched node never reports done/failed --
	// only the per-node timeout (driven by an advancing `now()`) can end
	// this loop. Proves termination doesn't depend on the removed
	// node-count cap.
	const run: RunManifest = {
		run_id: "r-timeout",
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
	let elapsed = 0;
	const timeoutMs = 1000;
	const final = await runToCompletion(run, {
		dispatch: () => ({ ok: true }),
		pollStatus: () => ({ status: "pending", result: null }),
		now: () => {
			elapsed += 200;
			return elapsed;
		},
		onUpdate: () => {},
		timeoutMs,
		tick: async () => {},
	});
	expect(final.status).toBe("partial");
	expect(final.nodes.find((n) => n.id === "n1")?.status).toBe("failed");
	expect(final.nodes.find((n) => n.id === "n2")?.status).toBe("skipped");
});
