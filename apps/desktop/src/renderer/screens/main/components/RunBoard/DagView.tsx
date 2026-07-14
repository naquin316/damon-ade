import { cn } from "@superset/ui/utils";
import { useRetryNode } from "renderer/react-query/orchestrator/hooks";
import type { NodeStatus, RunManifest } from "shared/orchestrator/types";
import { RunGraph } from "./RunGraph";

interface DagViewProps {
	/** Latest manifest for the run being watched, from `useWatchRun(runId)`. */
	run: RunManifest;
}

const STATUS_LABEL: Record<NodeStatus, string> = {
	pending: "Pending",
	running: "Running",
	done: "Done",
	failed: "Failed",
	skipped: "Skipped",
};

const STATUS_DOT: Record<NodeStatus, string> = {
	pending: "bg-foreground/30",
	running: "bg-amber-500",
	done: "bg-green-500",
	failed: "bg-red-500",
	skipped: "bg-foreground/20",
};

/** Progress header + legend around the live, animated dependency graph —
 * the only visual feedback while headless agents work (no terminal panes).
 * The graph itself lives in `RunGraph`, shared with Plan Review's preview. */
export function DagView({ run }: DagViewProps) {
	const retryNode = useRetryNode();

	const total = run.nodes.length;
	const doneCount = run.nodes.filter((n) => n.status === "done").length;
	const runningCount = run.nodes.filter((n) => n.status === "running").length;
	const failedCount = run.nodes.filter((n) => n.status === "failed").length;
	const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="flex flex-col gap-2 px-3 pt-3 pb-2 border-b border-border/50 shrink-0">
				<div className="flex items-center justify-between gap-3">
					<span className="text-sm font-medium text-foreground truncate">
						{run.goal}
					</span>
					<span className="text-xs text-foreground/40 shrink-0 uppercase tracking-wide">
						{run.status}
					</span>
				</div>

				{total > 0 && (
					<div className="flex items-center gap-2">
						<div className="flex-1 h-1.5 rounded-full bg-accent/40 overflow-hidden">
							<div
								className="h-full rounded-full bg-green-500 transition-[width] duration-500 ease-out"
								style={{ width: `${pct}%` }}
							/>
						</div>
						<span className="text-xs text-foreground/50 shrink-0 tabular-nums">
							{doneCount}/{total} done
							{runningCount > 0 ? ` · ${runningCount} running` : ""}
							{failedCount > 0 ? ` · ${failedCount} failed` : ""}
						</span>
					</div>
				)}

				<div className="flex items-center gap-3 flex-wrap">
					{(Object.keys(STATUS_LABEL) as NodeStatus[]).map((status) => (
						<span
							key={status}
							className="flex items-center gap-1 text-[10px] text-foreground/40"
						>
							<span
								className={cn("size-1.5 rounded-full", STATUS_DOT[status])}
							/>
							{STATUS_LABEL[status]}
						</span>
					))}
				</div>
			</div>

			<div className="flex-1 overflow-auto p-4">
				<RunGraph
					nodes={run.nodes}
					onRetry={(id) => retryNode.mutate({ runId: run.run_id, nodeId: id })}
					retryingNodeId={
						retryNode.isPending ? (retryNode.variables?.nodeId ?? null) : null
					}
				/>
			</div>
		</div>
	);
}
