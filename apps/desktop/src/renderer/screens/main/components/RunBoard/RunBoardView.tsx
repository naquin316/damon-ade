import { useState } from "react";
import { useWatchRun } from "renderer/react-query/orchestrator/hooks";
import { DagView } from "./DagView";
import { GoalInput } from "./GoalInput";
import { PlanReview } from "./PlanReview";
import { ResultsPanel } from "./ResultsPanel";

export function RunBoardView() {
	const [runId, setRunId] = useState<string | undefined>(undefined);
	const { run, error } = useWatchRun(runId);

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			<div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
				<span className="text-sm font-medium text-foreground">Run Board</span>
				{run && (
					<span className="text-xs text-foreground/40">{run.run_id}</span>
				)}
			</div>

			<GoalInput onSubmitted={setRunId} />

			{error && (
				<div className="px-3 py-2 text-xs text-destructive border-b border-border/50">
					{error}
				</div>
			)}

			{run?.status === "awaiting-approval" && (
				<PlanReview
					run={run}
					onApproved={() => {}}
					onCancelled={() => setRunId(undefined)}
				/>
			)}

			{run && run.status !== "awaiting-approval" ? (
				<>
					<DagView run={run} />
					<ResultsPanel run={run} />
				</>
			) : (
				!run && (
					<div className="flex-1 flex items-center justify-center text-foreground/40 text-sm">
						Submit a goal to have the Conductor plan a run.
					</div>
				)
			)}
		</div>
	);
}
