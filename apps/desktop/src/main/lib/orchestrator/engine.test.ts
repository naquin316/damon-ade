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

test("stepRun does NOT time out a node whose note is drafted (blocks on the agent's own gate)", () => {
	const running: RunManifest = {
		...base,
		nodes: base.nodes.map((n) => n.id === "n1" ? { ...n, status: "running", handoff_id: "h1" } : n),
	};
	const deps: EngineDeps = {
		dispatch: () => ({ ok: true }),
		// The agent picked up its note and is working / awaiting its own
		// human gate -- "drafted" is non-terminal but NOT "pending".
		pollStatus: () => ({ status: "drafted", result: null }),
		now: () => 1_000_000_000, // far past any timeoutMs
		onUpdate: () => {},
	};
	const out = stepRun(running, deps, 60_000, new Map([["n1", 0]]));
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("running");
	expect(out.nodes.find((n) => n.id === "n2")!.status).toBe("pending");
});

test("stepRun fails a rejected running node and skips its dependent", () => {
	const running: RunManifest = {
		...base,
		nodes: base.nodes.map((n) => n.id === "n1" ? { ...n, status: "running", handoff_id: "h1" } : n),
	};
	const deps: EngineDeps = {
		dispatch: () => ({ ok: true }),
		pollStatus: (n) => n.id === "n1" ? { status: "rejected", result: null } : null,
		now: () => 0,
		onUpdate: () => {},
	};
	const out = stepRun(running, deps, 60_000, new Map([["n1", 0]]));
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("failed");
	expect(out.nodes.find((n) => n.id === "n2")!.status).toBe("skipped");
});

test("stepRun backfills a missing dispatchedAt entry instead of resetting the clock every tick", () => {
	const running: RunManifest = {
		...base,
		nodes: base.nodes.map((n) => n.id === "n1" ? { ...n, status: "running", handoff_id: "h1" } : n),
	};
	const dispatchedAt = new Map<string, number>(); // simulates a restart: no in-memory entry for the running node
	let currentTime = 0;
	const deps: EngineDeps = {
		dispatch: () => ({ ok: true }),
		pollStatus: () => ({ status: "pending", result: null }), // never done
		now: () => currentTime,
		onUpdate: () => {},
	};

	// First tick: clock just started (backfilled), so it must NOT fail yet.
	const first = stepRun(running, deps, 60_000, dispatchedAt);
	expect(first.nodes.find((n) => n.id === "n1")!.status).toBe("running");
	expect(dispatchedAt.get("n1")).toBe(0);

	// Advance time past the timeout and step again, reusing the same dispatchedAt map
	// so the backfilled entry persists (proving the node can no longer hang forever).
	currentTime = 60_000;
	const second = stepRun(first, deps, 60_000, dispatchedAt);
	expect(second.nodes.find((n) => n.id === "n1")!.status).toBe("failed");
	expect(second.nodes.find((n) => n.id === "n2")!.status).toBe("skipped");
});

test("stepRun caps concurrent dispatch at maxConcurrent, running in waves", () => {
	const three: RunManifest = {
		...base,
		nodes: [
			{ id: "a", agent: "foreman", task: "ta", needs: [], status: "pending", handoff_id: null, result: null },
			{ id: "b", agent: "foreman", task: "tb", needs: [], status: "pending", handoff_id: null, result: null },
			{ id: "c", agent: "foreman", task: "tc", needs: [], status: "pending", handoff_id: null, result: null },
		],
	};
	const dispatched: string[] = [];
	const statuses = new Map<string, string>();
	const deps: EngineDeps = {
		dispatch: (n) => { dispatched.push(n.id); return { ok: true }; },
		pollStatus: (n) => statuses.has(n.id) ? { status: statuses.get(n.id)!, result: null } : null,
		now: () => 0,
		onUpdate: () => {},
		maxConcurrent: 1,
	};
	const dispatchedAt = new Map<string, number>();

	// First tick: only one of the three ready nodes dispatches.
	const first = stepRun(three, deps, 60_000, dispatchedAt);
	expect(dispatched).toEqual(["a"]);
	expect(first.nodes.find((n) => n.id === "a")!.status).toBe("running");
	expect(first.nodes.find((n) => n.id === "b")!.status).toBe("pending");
	expect(first.nodes.find((n) => n.id === "c")!.status).toBe("pending");

	// Simulate "a" completing, then step again: the next pending node dispatches.
	statuses.set("a", "done");
	const second = stepRun(first, deps, 60_000, dispatchedAt);
	expect(dispatched).toEqual(["a", "b"]);
	expect(second.nodes.find((n) => n.id === "a")!.status).toBe("done");
	expect(second.nodes.find((n) => n.id === "b")!.status).toBe("running");
	expect(second.nodes.find((n) => n.id === "c")!.status).toBe("pending");
});

test("finalize marks partial when any node failed, done otherwise", () => {
	const failed = { ...base, nodes: base.nodes.map((n) => ({ ...n, status: "failed" as const })) };
	expect(finalize(failed).status).toBe("partial");
	const alldone = { ...base, nodes: base.nodes.map((n) => ({ ...n, status: "done" as const })) };
	expect(finalize(alldone).status).toBe("done");
	expect(isTerminal(alldone)).toBe(true);
});
