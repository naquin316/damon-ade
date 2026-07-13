import type { RunManifest } from "shared/orchestrator/types";
import { type EngineDeps, finalize, isTerminal, stepRun } from "./engine";

/**
 * Drive a run to a terminal state by repeatedly calling `stepRun` and ticking
 * between iterations until every node is done/failed/skipped (or the
 * iteration bound is hit, which only matters for a stuck fake in tests —
 * `stepRun`'s own per-node timeout is what bounds a real run in production).
 */
export async function runToCompletion(
	start: RunManifest,
	deps: EngineDeps & { timeoutMs: number; tick: () => Promise<void> },
): Promise<RunManifest> {
	let run = start;
	const dispatchedAt = new Map<string, number>();
	// Bound iterations to (2 * nodes + 2) so a stuck fake can't loop forever.
	const maxIters = run.nodes.length * 2 + 2;
	for (let i = 0; i < maxIters && !isTerminal(run); i++) {
		run = stepRun(run, deps, deps.timeoutMs, dispatchedAt);
		if (!isTerminal(run)) await deps.tick();
	}
	const done = finalize(run);
	deps.onUpdate(done);
	return done;
}
