import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { Textarea } from "@superset/ui/textarea";
import { cn } from "@superset/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { LuArrowDown, LuX } from "react-icons/lu";
import {
	useApprovePlan,
	useCancelRun,
} from "renderer/react-query/orchestrator/hooks";
import type { RunManifest, RunNode } from "shared/orchestrator/types";
import { computeLayers, RunGraph } from "./RunGraph";

interface PlanReviewProps {
	run: RunManifest;
	onApproved: () => void;
	onCancelled: () => void;
}

interface Step {
	layer: number;
	nodes: RunNode[];
}

/**
 * Group the plan into dependency steps, reusing the SAME layering the graph and
 * the engine's ready-set use — so the order you read here is the order the work
 * actually unblocks in, not a second opinion about it.
 */
function groupIntoSteps(nodes: RunNode[]): Step[] {
	const layers = computeLayers(nodes);
	const byLayer = new Map<number, RunNode[]>();
	for (const node of nodes) {
		const l = layers.get(node.id) ?? 0;
		const arr = byLayer.get(l);
		if (arr) arr.push(node);
		else byLayer.set(l, [node]);
	}
	return [...byLayer.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([layer, ns]) => ({
			layer,
			nodes: [...ns].sort((a, b) => a.id.localeCompare(b.id)),
		}));
}

export function PlanReview({ run, onApproved, onCancelled }: PlanReviewProps) {
	const [nodes, setNodes] = useState<RunNode[]>(run.nodes);
	const approvePlan = useApprovePlan();
	const cancelRun = useCancelRun();

	// Re-sync local edit buffer whenever a fresh plan comes in for this run.
	useEffect(() => {
		setNodes(run.nodes);
	}, [run.nodes]);

	const steps = useMemo(() => groupIntoSteps(nodes), [nodes]);

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

	const agentWord = nodes.length === 1 ? "agent" : "agents";

	return (
		<div className="flex-1 flex flex-col overflow-y-auto border-b border-border/50">
			{/* Always-reachable action bar — pinned above the scrolling briefing so
			 * Approve/Cancel never end up buried below a long plan. */}
			<header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border/50 bg-card/95 px-5 pt-4 pb-3 backdrop-blur-sm">
				<div className="flex flex-col gap-1.5">
					<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/40">
						Review plan
					</span>
					{/* The goal is the thing being authorised — it wraps in full rather
					 * than truncating. You cannot consent to text you cannot read. */}
					<h2 className="max-w-[85ch] text-pretty text-sm leading-relaxed font-medium text-foreground">
						{run.goal}
					</h2>
				</div>

				<div className="flex items-center gap-2">
					<Button
						onClick={handleApprove}
						disabled={approvePlan.isPending || nodes.length === 0}
						className="gap-1.5"
					>
						{approvePlan.isPending
							? "Approving…"
							: `Approve & dispatch ${nodes.length} ${agentWord}`}
					</Button>
					<Button
						variant="outline"
						onClick={handleCancel}
						disabled={cancelRun.isPending}
					>
						Cancel
					</Button>
					<span className="ml-auto text-[11px] tabular-nums text-foreground/40">
						{steps.length} {steps.length === 1 ? "step" : "steps"}
					</span>
				</div>

				{approvePlan.isError && (
					<span className="text-xs text-destructive">
						{approvePlan.error instanceof Error
							? approvePlan.error.message
							: "Failed to approve plan"}
					</span>
				)}
			</header>

			{/* Shape preview — read-only (no retry affordance makes sense
			 * pre-approval; every node is still "pending"), driven by the same edit
			 * buffer as the briefing below, so removing a node updates both.
			 *
			 * Collapsed by default, and deliberately: pre-approval every node is
			 * grey, so the graph's real payload (live status colour) isn't there
			 * yet, and the briefing below states the same dependencies in prose
			 * ("Step 2 · waits for step 1", "needs n1"). Left open it just pushes
			 * the text you must actually read off the fold — a 12-node plan lays
			 * out 824px tall. It stays one click away for shape-checking a fan-out.
			 *
			 * `shrink-0` on the scroll box is load-bearing: a flex item that is
			 * also a scroll container has an automatic minimum size of 0, so flex
			 * crushed it to its padding (33px) and the graph vanished. Small plans
			 * masked it by never triggering a shrink. */}
			<details className="shrink-0 border-b border-border/50 bg-background/40">
				<summary className="cursor-pointer select-none px-5 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/40 transition-colors hover:text-foreground/70 marker:text-foreground/30">
					Plan shape
				</summary>
				<div className="max-h-64 shrink-0 overflow-auto px-5 pb-4">
					<RunGraph nodes={nodes} />
				</div>
			</details>

			<div className="flex flex-col gap-3 px-5 py-4">
				{steps.map((step, stepIndex) => (
					<div key={step.layer} className="flex flex-col gap-3">
						<StepHeading step={step} />

						{step.nodes.map((node) => (
							<TaskCard
								key={node.id}
								node={node}
								onChange={(task) => updateTask(node.id, task)}
								onRemove={() => removeNode(node.id)}
							/>
						))}

						{/* Only draw the flow connector between real steps — a run whose
						 * nodes are all independent has no "feeds" relationship to imply. */}
						{stepIndex < steps.length - 1 && (
							<div
								className="flex items-center gap-2 pl-1 text-[10px] uppercase tracking-wider text-foreground/25"
								aria-hidden
							>
								<LuArrowDown className="size-3" />
								feeds
							</div>
						)}
					</div>
				))}

				{nodes.length === 0 && (
					<p className="rounded-md border border-dashed border-border/50 px-4 py-8 text-center text-xs text-foreground/40">
						No nodes remain in the plan. Nothing will run.
					</p>
				)}
			</div>
		</div>
	);
}

function StepHeading({ step }: { step: Step }) {
	const count = step.nodes.length;
	const detail =
		step.layer === 0
			? count > 1
				? `${count} agents · start together`
				: "starts immediately"
			: count > 1
				? `${count} agents · wait for step ${step.layer}`
				: `waits for step ${step.layer}`;

	return (
		<div className="flex items-baseline gap-2 pt-1">
			<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/50">
				Step {step.layer + 1}
			</span>
			<span className="h-px flex-1 bg-border/50" />
			<span className="text-[10px] text-foreground/35">{detail}</span>
		</div>
	);
}

function TaskCard({
	node,
	onChange,
	onRemove,
}: {
	node: RunNode;
	onChange: (task: string) => void;
	onRemove: () => void;
}) {
	const taskId = `task-${node.id}`;

	return (
		<article className="group flex flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-3 transition-colors focus-within:border-ring/60">
			<div className="flex items-center gap-2">
				{/* Terracotta dot (--chart-1): the app's accent, used here as the one
				 * spot of colour per card so the eye lands on WHO is acting. */}
				<span
					className="size-1.5 shrink-0 rounded-full bg-[var(--chart-1)]"
					aria-hidden
				/>
				<h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
					{node.agent}
				</h3>
				<Badge variant="box" className="font-mono normal-case tracking-normal">
					{node.id}
				</Badge>
				{node.needs.length > 0 && (
					<Badge
						variant="outline"
						className="gap-1 border-border/60 font-mono text-[10px] text-foreground/50"
					>
						← needs {node.needs.join(", ")}
					</Badge>
				)}
				<Button
					variant="ghost"
					size="xs"
					onClick={onRemove}
					aria-label={`Remove ${node.agent} (${node.id}) from the plan`}
					className="ml-auto size-6 p-0 text-foreground/30 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
				>
					<LuX className="size-3.5" />
				</Button>
			</div>

			{/* The task IS the thing being approved, so it reads as prose and shows
			 * in full: `field-sizing-content` (baked into Textarea) grows the field
			 * to its content, so nothing is ever clipped. Chrome stays invisible
			 * until focus — a document you can edit, not a form you must fight.
			 *
			 * `min-h-0` defeats Textarea's own `min-h-16`, which would otherwise
			 * floor every short task at 64px and break the prose rhythm. The `ch`
			 * cap holds the measure near 85 characters — unbounded, these lines ran
			 * ~150ch on a 1920px window, which is where the eye loses its place on
			 * the carriage return. */}
			<label htmlFor={taskId} className="sr-only">
				Task for {node.agent}
			</label>
			<Textarea
				id={taskId}
				value={node.task}
				onChange={(e) => onChange(e.target.value)}
				spellCheck={false}
				className={cn(
					"min-h-0 w-full max-w-[85ch] resize-none border-transparent bg-transparent px-1 py-0 shadow-none",
					"text-[13px] leading-relaxed text-foreground/85",
					"focus-visible:border-transparent focus-visible:ring-0",
				)}
			/>
		</article>
	);
}
