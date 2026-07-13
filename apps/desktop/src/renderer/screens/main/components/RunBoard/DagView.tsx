import { Button } from "@superset/ui/button";
import { useRetryNode } from "renderer/react-query/orchestrator/hooks";
import type {
	NodeStatus,
	RunManifest,
	RunNode,
} from "shared/orchestrator/types";

const STATUS_ORDER: NodeStatus[] = [
	"running",
	"failed",
	"pending",
	"done",
	"skipped",
];

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

interface DagViewProps {
	/** Latest manifest for the run being watched, from `useWatchRun(runId)`. */
	run: RunManifest;
}

/** Renders the run's nodes grouped by status, with a Retry affordance on failed nodes. */
export function DagView({ run }: DagViewProps) {
	const retryNode = useRetryNode();

	const groups = STATUS_ORDER.map((status) => ({
		status,
		nodes: run.nodes.filter((n) => n.status === status),
	})).filter((group) => group.nodes.length > 0);

	return (
		<div className="flex-1 overflow-auto p-3">
			<div className="flex items-center justify-between mb-3">
				<span className="text-sm font-medium text-foreground truncate">
					{run.goal}
				</span>
				<span className="text-xs text-foreground/40 shrink-0">
					{run.status}
				</span>
			</div>

			<div className="flex flex-col gap-3">
				{groups.map(({ status, nodes }) => (
					<div key={status} className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
							{STATUS_LABEL[status]} ({nodes.length})
						</span>
						<div className="flex flex-col gap-1">
							{nodes.map((node) => (
								<DagNodeRow
									key={node.id}
									node={node}
									onRetry={() =>
										retryNode.mutate({ runId: run.run_id, nodeId: node.id })
									}
									isRetrying={
										retryNode.isPending &&
										retryNode.variables?.nodeId === node.id
									}
								/>
							))}
						</div>
					</div>
				))}

				{run.nodes.length === 0 && (
					<span className="text-xs text-foreground/40">
						No nodes in this run.
					</span>
				)}
			</div>
		</div>
	);
}

function DagNodeRow({
	node,
	onRetry,
	isRetrying,
}: {
	node: RunNode;
	onRetry: () => void;
	isRetrying: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5">
			<div className="flex items-center gap-2 min-w-0">
				<span
					className={`size-2 rounded-full shrink-0 ${STATUS_DOT[node.status]}`}
				/>
				<span className="font-mono text-xs text-foreground/60 shrink-0">
					{node.id}
				</span>
				<span className="rounded bg-accent/50 px-1.5 py-0.5 text-xs shrink-0">
					{node.agent}
				</span>
				<span className="text-xs text-foreground/80 truncate">{node.task}</span>
			</div>
			{node.status === "failed" && (
				<Button
					variant="outline"
					size="xs"
					onClick={onRetry}
					disabled={isRetrying}
					className="shrink-0"
				>
					{isRetrying ? "Retrying…" : "Retry"}
				</Button>
			)}
		</div>
	);
}
