import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useEffect, useState } from "react";
import {
	useApprovePlan,
	useCancelRun,
} from "renderer/react-query/orchestrator/hooks";
import type { RunManifest, RunNode } from "shared/orchestrator/types";
import { RunGraph } from "./RunGraph";

interface PlanReviewProps {
	run: RunManifest;
	onApproved: () => void;
	onCancelled: () => void;
}

export function PlanReview({ run, onApproved, onCancelled }: PlanReviewProps) {
	const [nodes, setNodes] = useState<RunNode[]>(run.nodes);
	const approvePlan = useApprovePlan();
	const cancelRun = useCancelRun();

	// Re-sync local edit buffer whenever a fresh plan comes in for this run.
	useEffect(() => {
		setNodes(run.nodes);
	}, [run.nodes]);

	if (run.status !== "awaiting-approval") return null;

	const updateTask = (id: string, task: string) => {
		setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, task } : n)));
	};

	const removeNode = (id: string) => {
		setNodes((prev) =>
			prev
				.filter((n) => n.id !== id)
				.map((n) => ({
					...n,
					needs: n.needs.filter((needId) => needId !== id),
				})),
		);
	};

	const handleApprove = () => {
		approvePlan.mutate({ runId: run.run_id, nodes }, { onSuccess: onApproved });
	};

	const handleCancel = () => {
		cancelRun.mutate({ runId: run.run_id }, { onSuccess: onCancelled });
	};

	return (
		<div className="flex-1 flex flex-col overflow-y-auto border-b border-border/50">
			{/* Always-reachable action bar — pinned above the scrolling preview
			 * and edit list so Approve/Cancel never end up buried below a long
			 * plan (the whole point of this layout). */}
			<div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border/50 bg-card/95 px-3 pt-3 pb-2 backdrop-blur-sm">
				<div className="flex items-center justify-between gap-3">
					<span className="text-sm font-medium text-foreground truncate">
						Review plan for: {run.goal}
					</span>
					<span className="text-xs text-foreground/40 shrink-0">
						{nodes.length} nodes
					</span>
				</div>

				<div className="flex items-center gap-2">
					<Button
						onClick={handleApprove}
						disabled={approvePlan.isPending || nodes.length === 0}
					>
						{approvePlan.isPending ? "Approving…" : "Approve"}
					</Button>
					<Button
						variant="outline"
						onClick={handleCancel}
						disabled={cancelRun.isPending}
					>
						Cancel
					</Button>
				</div>

				{approvePlan.isError && (
					<span className="text-xs text-destructive">
						{approvePlan.error instanceof Error
							? approvePlan.error.message
							: "Failed to approve plan"}
					</span>
				)}
			</div>

			{/* Live shape preview — read-only (no retry affordance makes sense
			 * pre-approval; every node is still "pending"), driven by the same
			 * edit buffer as the list below so removing a node updates both. */}
			<div className="overflow-x-auto p-4">
				<RunGraph nodes={nodes} />
			</div>

			<div className="flex flex-col gap-2 px-3 pb-3">
				<span className="text-[10px] font-medium uppercase tracking-wide text-foreground/40">
					Edit tasks
				</span>
				{nodes.map((node) => (
					<div
						key={node.id}
						className="flex flex-col gap-1.5 rounded-md border border-border/50 p-2"
					>
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-2 text-xs text-foreground/60">
								<span className="font-mono">{node.id}</span>
								<span className="rounded bg-accent/50 px-1.5 py-0.5">
									{node.agent}
								</span>
								{node.needs.length > 0 && (
									<span className="text-foreground/40">
										needs: {node.needs.join(", ")}
									</span>
								)}
							</div>
							<Button
								variant="ghost"
								size="xs"
								onClick={() => removeNode(node.id)}
							>
								Remove
							</Button>
						</div>
						<Input
							value={node.task}
							onChange={(e) => updateTask(node.id, e.target.value)}
							className="text-sm"
						/>
					</div>
				))}
				{nodes.length === 0 && (
					<span className="text-xs text-foreground/40">
						No nodes remain in the plan.
					</span>
				)}
			</div>
		</div>
	);
}
