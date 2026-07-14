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
	deps: EngineDeps & {
		timeoutMs: number;
		tick: () => Promise<void>;
		/**
		 * Consulted at the TOP of every iteration, before `stepRun` runs. When
		 * it returns true the loop breaks immediately without calling
		 * `stepRun`/`onUpdate` for that iteration — this closes the race where a
		 * cancel flag flips mid-`tick`-sleep and the loop would otherwise run
		 * one more full `stepRun` (dispatching new panes, writing a "running"
		 * manifest) before noticing. The caller owns writing/asserting the
		 * run's terminal (e.g. "cancelled") status on disk; this function
		 * neither finalizes nor persists anything for a cancelled run.
		 */
		shouldCancel?: () => boolean;
	},
): Promise<RunManifest> {
	let run = start;
	const dispatchedAt = new Map<string, number>();
	let cancelled = false;
	for (let i = 0; i < MAX_ITERS && !isTerminal(run); i++) {
		if (deps.shouldCancel?.()) {
			cancelled = true;
			break;
		}
		run = stepRun(run, deps, deps.timeoutMs, dispatchedAt);
		if (!isTerminal(run)) await deps.tick();
	}
	if (cancelled) {
		// Broke early on a cancel signal, not on reaching a terminal state or
		// the MAX_ITERS backstop. Return the run as-is -- do NOT finalize (that
		// would falsely mark it "done"/"partial") and do NOT call onUpdate (the
		// caller re-asserts the cancelled status on disk itself).
		return run;
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
