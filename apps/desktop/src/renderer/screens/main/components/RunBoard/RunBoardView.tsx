import { Button } from "@superset/ui/button";
import { useState } from "react";
import {
	useCancelRun,
	useWatchRun,
} from "renderer/react-query/orchestrator/hooks";
import { DagView } from "./DagView";
import { GoalInput } from "./GoalInput";
import { PlanReview } from "./PlanReview";
import { ResultsPanel } from "./ResultsPanel";

const TERMINAL_LABEL: Record<string, string> = {
	done: "Run complete.",
	partial: "Run finished with failures.",
	cancelled: "Run cancelled.",
	failed: "Run failed.",
};

export function RunBoardView() {
	const [runId, setRunId] = useState<string | undefined>(undefined);
	const { run, error } = useWatchRun(runId);
	const cancelRun = useCancelRun();

	// The one guaranteed way out of any state: drop the watched run and go
	// back to a blank GoalInput. Nothing below this ever disables it.
	const resetToGoalInput = () => setRunId(undefined);

	const handleCancel = () => {
		if (!runId) return;
		cancelRun.mutate({ runId });
	};

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			<div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
				<span className="text-sm font-medium text-foreground">Run Board</span>
				{run && (
					<span className="text-xs text-foreground/40">{run.run_id}</span>
				)}
				<div className="flex-1" />
				{runId && (
					<Button variant="ghost" size="xs" onClick={resetToGoalInput}>
						New goal ✕
					</Button>
				)}
			</div>

			{!runId && <GoalInput onSubmitted={setRunId} />}

			{error && (
				<div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-destructive border-b border-border/50">
					<span>{error}</span>
					<Button variant="outline" size="xs" onClick={resetToGoalInput}>
						New goal
					</Button>
				</div>
			)}

			{runId && !run && !error && (
				<div className="flex-1 flex flex-col items-center justify-center gap-3 text-foreground/40 text-sm">
					<span>Loading run…</span>
					<Button variant="outline" size="xs" onClick={resetToGoalInput}>
						New goal
					</Button>
				</div>
			)}

			{run?.status === "planning" && (
				<div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm">
					<span className="text-foreground/60">
						Planning… (the Conductor is decomposing your goal)
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={handleCancel}
						disabled={cancelRun.isPending}
					>
						{cancelRun.isPending ? "Cancelling…" : "Cancel"}
					</Button>
				</div>
			)}

			{run?.status === "awaiting-approval" && (
				<PlanReview
					run={run}
					onApproved={() => {}}
					onCancelled={resetToGoalInput}
				/>
			)}

			{run?.status === "running" && (
				<>
					<div className="flex items-center justify-end px-3 py-2 border-b border-border/50">
						<Button
							variant="outline"
							size="xs"
							onClick={handleCancel}
							disabled={cancelRun.isPending}
						>
							{cancelRun.isPending ? "Cancelling…" : "Cancel run"}
						</Button>
					</div>
					<DagView run={run} />
					<ResultsPanel run={run} />
				</>
			)}

			{run &&
				(["done", "partial", "cancelled", "failed"] as const).includes(
					run.status as "done" | "partial" | "cancelled" | "failed",
				) && (
					<>
						<div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
							<span className="text-xs text-foreground/60">
								{TERMINAL_LABEL[run.status] ?? `Run ${run.status}.`}
							</span>
							<Button variant="outline" size="xs" onClick={resetToGoalInput}>
								New goal
							</Button>
						</div>
						<DagView run={run} />
						<ResultsPanel run={run} />
					</>
				)}

			{!runId && !run && (
				<div className="flex-1 flex items-center justify-center text-foreground/40 text-sm">
					Submit a goal to have the Conductor plan a run.
				</div>
			)}
		</div>
	);
}
