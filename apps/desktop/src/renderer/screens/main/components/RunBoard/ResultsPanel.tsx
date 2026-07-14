import type { RunManifest, RunStatus } from "shared/orchestrator/types";

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
	"done",
	"partial",
	"cancelled",
	"failed",
]);

interface ResultsPanelProps {
	/** Latest manifest for the run being watched, from `useWatchRun(runId)`. */
	run: RunManifest;
}

/** Lists each completed node's result pointer, plus the run summary once terminal. */
export function ResultsPanel({ run }: ResultsPanelProps) {
	const doneNodes = run.nodes.filter((n) => n.status === "done" && n.result);
	const isTerminal = TERMINAL_STATUSES.has(run.status);

	if (doneNodes.length === 0 && !isTerminal) return null;

	return (
		<div className="flex flex-col gap-2 p-3 border-t border-border/50">
			<span className="text-sm font-medium text-foreground">Results</span>

			{doneNodes.length > 0 ? (
				<ul className="flex flex-col gap-1">
					{doneNodes.map((node) => (
						<li key={node.id} className="flex items-center gap-2 text-xs">
							<span className="font-mono text-foreground/60 shrink-0">
								{node.id}
							</span>
							<span className="text-foreground/40 shrink-0">→</span>
							<span className="text-foreground/80 truncate">{node.result}</span>
						</li>
					))}
				</ul>
			) : (
				<span className="text-xs text-foreground/40">
					No completed nodes yet.
				</span>
			)}

			{isTerminal && (
				<div className="mt-1 rounded-md bg-accent/30 p-2 text-xs text-foreground/80">
					{run.summary ?? `Run ${run.status}.`}
				</div>
			)}
		</div>
	);
}
