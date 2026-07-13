import { useEffect, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { RunManifest } from "shared/orchestrator/types";

/** Submit a goal to the Conductor; resolves with the plan (status: awaiting-approval). */
export function useSubmitGoal() {
	return electronTrpc.orchestrator.submitGoal.useMutation();
}

/** Approve (optionally edited) plan nodes and start the run. */
export function useApprovePlan() {
	return electronTrpc.orchestrator.approvePlan.useMutation();
}

/** Cancel an in-flight run. */
export function useCancelRun() {
	return electronTrpc.orchestrator.cancelRun.useMutation();
}

/** Retry a single failed node within a run. */
export function useRetryNode() {
	return electronTrpc.orchestrator.retryNode.useMutation();
}

/**
 * Subscribes to `orchestrator.watchRun` for `runId` and keeps the latest
 * `RunManifest` in state. Mirrors the observable-subscription pattern used by
 * `useUpdateListener` / `usePersistentWebview`'s `onNewWindow` subscription
 * (trpc-electron only supports observables, not async generators).
 */
export function useWatchRun(runId: string | undefined) {
	const [run, setRun] = useState<RunManifest | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Reset local state whenever the watched run changes (identity, not value,
	// triggers the reset) so stale data from a previous run never bleeds into
	// the newly selected one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runId drives the reset by identity, not by being read in the body
	useEffect(() => {
		setRun(null);
		setError(null);
	}, [runId]);

	electronTrpc.orchestrator.watchRun.useSubscription(
		{ runId: runId ?? "" },
		{
			enabled: !!runId,
			onData: (event) => {
				if (event.type === "run-updated") {
					setRun(event.run);
					setError(null);
				} else if (event.type === "run-error") {
					setError(event.message);
				}
			},
		},
	);

	return { run, error };
}
