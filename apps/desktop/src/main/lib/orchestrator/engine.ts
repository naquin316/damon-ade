import { readySet, applyFailureSkips } from "./dag";
import type { RunManifest, RunNode } from "shared/orchestrator/types";

export type EngineDeps = {
	/** Dispatch a ready node. `upstream` carries that node's already-"done"
	 *  dependencies (resolved from its `needs` edges), so the caller can hand
	 *  their `result`s to the agent as context. Ordering alone isn't enough —
	 *  a node that needs an upstream's output has to RECEIVE it rather than
	 *  re-derive it from live sources. Empty for root nodes. */
	dispatch: (node: RunNode, upstream: RunNode[]) => { ok: boolean; error?: string };
	pollStatus: (node: RunNode) => { status: string; result: string | null } | null;
	now: () => number;
	onUpdate: (run: RunManifest) => void;
	/** Cap on simultaneously "running" nodes. Undefined => no limit
	 *  (Infinity), so callers/tests that don't set it are unaffected. Heavy
	 *  headless agent sessions (e.g. Opus 1M `claude -p`) starve the machine
	 *  if every ready node dispatches at once; this makes stepRun dispatch in
	 *  waves instead. */
	maxConcurrent?: number;
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

	// 2) Dispatch the ready set, capped at `maxConcurrent` simultaneously
	// "running" nodes so heavy headless agent sessions launch in waves rather
	// than all at once. Nodes left undispatched this tick simply stay
	// "pending" -- they're only queued, and the collect loop above only
	// applies the pickup timeout to "running" nodes, so queuing is safe.
	const runningCount = nodes.filter((n) => n.status === "running").length;
	let slots = (deps.maxConcurrent ?? Infinity) - runningCount;
	for (const n of readySet(nodes)) {
		if (slots <= 0) break;
		const handoffId = n.handoff_id ?? `${run.run_id}-${n.id}`;
		const target = nodes.find((x) => x.id === n.id)!;
		target.handoff_id = handoffId;
		// `readySet` only yields nodes whose `needs` are all "done", so these
		// lookups resolve to finished producers; the filter is belt-and-braces
		// against a malformed manifest whose `needs` names an unknown node id.
		const upstream = target.needs
			.map((id) => nodes.find((x) => x.id === id))
			.filter((x): x is RunNode => !!x && x.status === "done");
		const r = deps.dispatch({ ...target }, upstream);
		if (r.ok) {
			target.status = "running";
			dispatchedAt.set(n.id, deps.now());
		} else {
			target.status = "failed";
			nodes = applyFailureSkips(nodes, n.id);
		}
		slots--;
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
