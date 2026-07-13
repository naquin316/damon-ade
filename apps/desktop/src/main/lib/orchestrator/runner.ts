import type { RunManifest } from "shared/orchestrator/types";
import { type EngineDeps, finalize, isTerminal, stepRun } from "./engine";

/**
 * Pathological-loop backstop only. `stepRun`'s own per-node timeout is what
 * bounds a real run: a running node that never reports done/failed is
 * force-failed once `timeoutMs` elapses, which is what actually guarantees
 * `isTerminal(run)` becomes true. A node-count-based cap (e.g. `2*nodes+2`)
 * is WRONG here — each tick only advances `TICK_INTERVAL_MS` (3s in
 * production) of real time while `NODE_TIMEOUT_MS` is 15min, so a real N-node
 * run would exhaust a small cap in tens of seconds, long before any node
 * actually finishes. `MAX_ITERS` is fixed and huge so it can never fire
 * during a normal run (15min timeout / 3s tick ≈ 300 ticks/node for small
 * graphs) — it only exists to stop a truly stuck fake (e.g. in tests) from
 * looping forever.
 */
const MAX_ITERS = 1_000_000;

/**
 * Drive a run to a terminal state by repeatedly calling `stepRun` and ticking
 * between iterations until every node is done/failed/skipped. `finalize`
 * (which sets the run's terminal "done"/"partial" status) is ONLY called
 * once `isTerminal(run)` is true — never on the `MAX_ITERS` backstop, so a
 * run with nodes still pending/running can never be falsely reported "done".
 */
export async function runToCompletion(
	start: RunManifest,
	deps: EngineDeps & { timeoutMs: number; tick: () => Promise<void> },
): Promise<RunManifest> {
	let run = start;
	const dispatchedAt = new Map<string, number>();
	for (let i = 0; i < MAX_ITERS && !isTerminal(run); i++) {
		run = stepRun(run, deps, deps.timeoutMs, dispatchedAt);
		if (!isTerminal(run)) await deps.tick();
	}
	if (!isTerminal(run)) {
		// The backstop tripped without the run ever reaching a terminal state.
		// This should never happen in practice (see MAX_ITERS above). Do NOT
		// finalize — that would mark the run falsely "done" while nodes are
		// still pending/running. Throw so the caller's error path (e.g.
		// orchestrator.ts's startRunLoop `.catch`, which emits a "run-error"
		// event) surfaces this instead of reporting completion.
		throw new Error(
			`runToCompletion: exceeded ${MAX_ITERS} iterations without reaching a terminal state (run ${run.run_id})`,
		);
	}
	const done = finalize(run);
	deps.onUpdate(done);
	return done;
}
