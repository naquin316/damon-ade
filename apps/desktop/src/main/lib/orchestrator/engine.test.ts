import { expect, test } from "bun:test";
import { stepRun, isTerminal, finalize, type EngineDeps } from "./engine";
import type { RunManifest } from "shared/orchestrator/types";

const base: RunManifest = {
	run_id: "r1", goal: "g", status: "running", created: "2026-07-13", summary: null,
	nodes: [
		{ id: "n1", agent: "foreman", task: "t1", needs: [], status: "pending", handoff_id: null, result: null },
		{ id: "n2", agent: "store", task: "t2", needs: ["n1"], status: "pending", handoff_id: null, result: null },
	],
};

test("stepRun dispatches the ready node and marks it running", () => {
	const dispatched: string[] = [];
	const deps: EngineDeps = {
		dispatch: (n) => { dispatched.push(n.id); return { ok: true }; },
		pollStatus: () => null,
		now: () => 0,
		onUpdate: () => {},
	};
	const out = stepRun(base, deps, 60_000, new Map());
	expect(dispatched).toEqual(["n1"]);
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("running");
	expect(out.nodes.find((n) => n.id === "n2")!.status).toBe("pending");
});

test("stepRun collects a done node and unlocks its dependent", () => {
	const running: RunManifest = {
		...base,
		nodes: base.nodes.map((n) => n.id === "n1" ? { ...n, status: "running", handoff_id: "h1" } : n),
	};
	const deps: EngineDeps = {
		dispatch: () => ({ ok: true }),
		pollStatus: (n) => n.id === "n1" ? { status: "done", result: "out1" } : null,
		now: () => 0,
		onUpdate: () => {},
	};
	const out = stepRun(running, deps, 60_000, new Map([["n1", 0]]));
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("done");
	expect(out.nodes.find((n) => n.id === "n1")!.result).toBe("out1");
});

test("stepRun times out a stuck running node and skips its dependents", () => {
	const running: RunManifest = {
		...base,
		nodes: base.nodes.map((n) => n.id === "n1" ? { ...n, status: "running", handoff_id: "h1" } : n),
	};
	const deps: EngineDeps = {
		dispatch: () => ({ ok: true }),
		pollStatus: () => ({ status: "pending", result: null }), // never done
		now: () => 100_000,
		onUpdate: () => {},
	};
	const out = stepRun(running, deps, 60_000, new Map([["n1", 0]]));
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("failed");
	expect(out.nodes.find((n) => n.id === "n2")!.status).toBe("skipped");
});

test("finalize marks partial when any node failed, done otherwise", () => {
	const failed = { ...base, nodes: base.nodes.map((n) => ({ ...n, status: "failed" as const })) };
	expect(finalize(failed).status).toBe("partial");
	const alldone = { ...base, nodes: base.nodes.map((n) => ({ ...n, status: "done" as const })) };
	expect(finalize(alldone).status).toBe("done");
	expect(isTerminal(alldone)).toBe(true);
});
