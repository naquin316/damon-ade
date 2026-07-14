import { readySet, applyFailureSkips } from "./dag";
import type { RunManifest, RunNode } from "shared/orchestrator/types";

export type EngineDeps = {
	dispatch: (node: RunNode) => { ok: boolean; error?: string };
	pollStatus: (node: RunNode) => { status: string; result: string | null } | null;
	now: () => number;
	onUpdate: (run: RunManifest) => void;
};

const DONE_STATUSES = new Set(["done"]);
const FAIL_STATUSES = new Set(["rejected"]);

export function stepRun(
	run: RunManifest, deps: EngineDeps, timeoutMs: number, dispatchedAt: Map<string, number>,
): RunManifest {
	let nodes = run.nodes.map((n) => ({ ...n }));

	// 1) Collect running nodes (done / failed / timeout).
	for (const id of nodes.map((x) => x.id)) {
		const n = nodes.find((x) => x.id === id);
		if (!n || n.status !== "running") continue;
		const s = deps.pollStatus(n);
		if (s && DONE_STATUSES.has(s.status)) {
			n.status = "done";
			n.result = s.result;
		} else if (s && FAIL_STATUSES.has(s.status)) {
			n.status = "failed";
			nodes = applyFailureSkips(nodes, n.id);
		} else if (!s || s.status === "pending") {
			// Never picked up (no note yet, or the note is still "pending"): this
			// is the only case the per-node timeout applies to. Any other
			// non-terminal status (e.g. "drafted") means the agent has picked up
			// its dispatch note and is working / awaiting its own human gate — the
			// run BLOCKS on that gate rather than timing it out (see the `else`
			// below).
			let started = dispatchedAt.get(n.id);
			if (started === undefined) {
				started = deps.now();
				dispatchedAt.set(n.id, started);
			}
			if (deps.now() - started >= timeoutMs) {
				n.status = "failed";
				nodes = applyFailureSkips(nodes, n.id);
			}
		}
		// else: some other non-terminal status (e.g. "drafted") — leave the node
		// "running" and exempt it from the timeout; it stays running until the
		// note flips to "done" (-> done) or "rejected" (-> failed).
	}

	// 2) Dispatch the ready set.
	for (const n of readySet(nodes)) {
		const handoffId = n.handoff_id ?? `${run.run_id}-${n.id}`;
		const target = nodes.find((x) => x.id === n.id)!;
		target.handoff_id = handoffId;
		const r = deps.dispatch({ ...target });
		if (r.ok) {
			target.status = "running";
			dispatchedAt.set(n.id, deps.now());
		} else {
			target.status = "failed";
			nodes = applyFailureSkips(nodes, n.id);
		}
	}

	const next = { ...run, nodes };
	deps.onUpdate(next);
	return next;
}

export function isTerminal(run: RunManifest): boolean {
	return run.nodes.every((n) => ["done", "failed", "skipped"].includes(n.status));
}

export function finalize(run: RunManifest): RunManifest {
	const anyFailed = run.nodes.some((n) => n.status === "failed");
	return { ...run, status: anyFailed ? "partial" : "done" };
}
