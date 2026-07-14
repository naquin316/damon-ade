import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { LuCheck, LuClock, LuLoaderCircle, LuX } from "react-icons/lu";
import { useRetryNode } from "renderer/react-query/orchestrator/hooks";
import type {
	NodeStatus,
	RunManifest,
	RunNode,
} from "shared/orchestrator/types";

interface DagViewProps {
	/** Latest manifest for the run being watched, from `useWatchRun(runId)`. */
	run: RunManifest;
}

// ---- Layout constants -----------------------------------------------------
// Fixed card size + fixed gaps means every node's (x, y) is derived purely
// from (layer, indexInLayer) — no DOM measurement, so edges are pixel-exact
// on the very first paint (important since this graph updates live, node by
// node, as a headless run progresses).
const CARD_W = 200;
const CARD_H = 72;
const COL_GAP = 72;
const ROW_GAP = 16;
const PADDING = 24;

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

const STATUS_CARD: Record<NodeStatus, string> = {
	pending: "border-border/60 bg-card/50 opacity-70",
	running: "border-amber-500/80 bg-amber-500/[0.06]",
	done: "border-green-500/60 bg-green-500/[0.06]",
	failed: "border-red-500/60 bg-red-500/[0.06]",
	skipped: "border-dashed border-border/40 bg-card/20 opacity-50",
};

interface Point {
	x: number;
	y: number;
}

// ---- Layered DAG layout ----------------------------------------------------

/**
 * layer(n) = 0 if `needs` is empty, else 1 + max(layer(d) for d in needs).
 * Memoized via `layer` map; defensive against cycles and dangling refs even
 * though the engine guarantees an acyclic, fully-resolved plan — a node
 * referencing itself or a missing upstream id degrades to layer 0 instead of
 * infinite-looping.
 */
function computeLayers(nodes: RunNode[]): Map<string, number> {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const layer = new Map<string, number>();
	const visiting = new Set<string>();

	function resolve(id: string): number {
		const cached = layer.get(id);
		if (cached !== undefined) return cached;

		const node = byId.get(id);
		if (!node || node.needs.length === 0 || visiting.has(id)) {
			layer.set(id, 0);
			return 0;
		}

		visiting.add(id);
		let max = -1;
		for (const dep of node.needs) {
			if (dep === id || !byId.has(dep)) continue; // self-dep / missing dep guard
			max = Math.max(max, resolve(dep));
		}
		visiting.delete(id);

		const result = max === -1 ? 0 : max + 1;
		layer.set(id, result);
		return result;
	}

	for (const n of nodes) resolve(n.id);
	return layer;
}

interface Layout {
	positions: Map<string, Point>;
	width: number;
	height: number;
}

/** Groups nodes into layer columns, stacks each column, and vertically
 * centers every column within the tallest one so the board reads balanced. */
function computeLayout(nodes: RunNode[]): Layout {
	if (nodes.length === 0) {
		return { positions: new Map(), width: 0, height: 0 };
	}

	const layers = computeLayers(nodes);
	const columns = new Map<number, RunNode[]>();
	for (const node of nodes) {
		const l = layers.get(node.id) ?? 0;
		const arr = columns.get(l);
		if (arr) arr.push(node);
		else columns.set(l, [node]);
	}
	for (const arr of columns.values()) {
		arr.sort((a, b) => a.id.localeCompare(b.id));
	}

	const numLayers = Math.max(...columns.keys()) + 1;
	let tallestHeight = 0;
	for (const arr of columns.values()) {
		const h = arr.length * CARD_H + (arr.length - 1) * ROW_GAP;
		tallestHeight = Math.max(tallestHeight, h);
	}

	const positions = new Map<string, Point>();
	for (let l = 0; l < numLayers; l++) {
		const arr = columns.get(l) ?? [];
		const colHeight = arr.length * CARD_H + Math.max(0, arr.length - 1) * ROW_GAP;
		const offsetY = (tallestHeight - colHeight) / 2;
		const x = PADDING + l * (CARD_W + COL_GAP) + CARD_W / 2;
		arr.forEach((node, i) => {
			const y = PADDING + offsetY + i * (CARD_H + ROW_GAP) + CARD_H / 2;
			positions.set(node.id, { x, y });
		});
	}

	return {
		positions,
		width: numLayers * CARD_W + (numLayers - 1) * COL_GAP + PADDING * 2,
		height: tallestHeight + PADDING * 2,
	};
}

/** Renders the run's dependency graph as a live, animated mission-control
 * board — columns flow left→right by dependency depth, edges light up as
 * upstream nodes complete, and this is the only visual feedback while
 * headless agents work (no terminal panes). */
export function DagView({ run }: DagViewProps) {
	const retryNode = useRetryNode();

	const { positions, width, height } = useMemo(
		() => computeLayout(run.nodes),
		[run.nodes],
	);
	const byId = useMemo(
		() => new Map(run.nodes.map((n) => [n.id, n])),
		[run.nodes],
	);

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
				{total === 0 ? (
					<div className="flex flex-1 h-full items-center justify-center text-xs text-foreground/40 italic py-10">
						Waiting for the plan…
					</div>
				) : (
					<div className="relative" style={{ width, height }}>
						<svg
							className="absolute inset-0 pointer-events-none"
							width={width}
							height={height}
							aria-hidden
						>
							{run.nodes.map((node) =>
								node.needs.map((depId) => {
									const from = positions.get(depId);
									const to = positions.get(node.id);
									const upstream = byId.get(depId);
									if (!from || !to || !upstream) return null;
									return (
										<Edge
											key={`${depId}->${node.id}`}
											from={from}
											to={to}
											upstreamDone={upstream.status === "done"}
										/>
									);
								}),
							)}
						</svg>

						{run.nodes.map((node) => {
							const pos = positions.get(node.id);
							if (!pos) return null;
							return (
								<NodeCard
									key={node.id}
									node={node}
									pos={pos}
									onRetry={() =>
										retryNode.mutate({ runId: run.run_id, nodeId: node.id })
									}
									isRetrying={
										retryNode.isPending &&
										retryNode.variables?.nodeId === node.id
									}
								/>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function Edge({
	from,
	to,
	upstreamDone,
}: {
	from: Point;
	to: Point;
	upstreamDone: boolean;
}) {
	const startX = from.x + CARD_W / 2;
	const startY = from.y;
	const endX = to.x - CARD_W / 2;
	const endY = to.y;
	const midX = (startX + endX) / 2;

	return (
		<path
			d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
			fill="none"
			stroke={upstreamDone ? "var(--chart-2)" : "var(--border)"}
			strokeWidth={1.5}
			strokeDasharray={upstreamDone ? undefined : "4 4"}
			style={{
				opacity: upstreamDone ? 0.6 : 0.2,
				transition: "opacity 400ms ease, stroke 400ms ease",
			}}
		/>
	);
}

function NodeCard({
	node,
	pos,
	onRetry,
	isRetrying,
}: {
	node: RunNode;
	pos: Point;
	onRetry: () => void;
	isRetrying: boolean;
}) {
	const { status } = node;

	return (
		<div
			className="absolute"
			style={{
				left: pos.x - CARD_W / 2,
				top: pos.y - CARD_H / 2,
				width: CARD_W,
				height: CARD_H,
			}}
		>
			{status === "running" && (
				<span
					className="absolute -inset-1 rounded-lg border-2 border-amber-400/50 animate-pulse pointer-events-none"
					aria-hidden
				/>
			)}
			<div
				role="group"
				aria-label={`${node.agent} (${node.id}): ${STATUS_LABEL[status]}`}
				title={[
					`${node.id} · ${node.agent}`,
					STATUS_LABEL[status],
					node.result ?? undefined,
				]
					.filter(Boolean)
					.join("\n")}
				className={cn(
					"relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-lg border-2 px-2.5 py-1.5 transition-colors duration-300",
					STATUS_CARD[status],
				)}
			>
				<div className="flex items-center justify-between gap-1.5 min-w-0">
					<span className="text-[11px] font-semibold text-foreground truncate">
						{node.agent}
					</span>
					<StatusGlyph status={status} />
				</div>

				<p
					className="text-[10px] leading-snug text-foreground/60 flex-1 overflow-hidden"
					style={{
						display: "-webkit-box",
						WebkitLineClamp: 2,
						WebkitBoxOrient: "vertical",
					}}
				>
					{node.task}
				</p>

				{status === "done" && node.result && (
					<div
						className="rounded bg-green-500/10 px-1 py-0.5 text-[9px] text-green-600 dark:text-green-400 truncate transition-opacity duration-500"
						title={node.result}
					>
						{node.result}
					</div>
				)}

				{status === "failed" && (
					<Button
						variant="outline"
						size="xs"
						onClick={onRetry}
						disabled={isRetrying}
						className="h-5 w-fit self-start px-1.5 text-[9px]"
					>
						{isRetrying ? "Retrying…" : "Retry"}
					</Button>
				)}

				{status === "skipped" && (
					<span className="text-[9px] text-foreground/40 italic">
						skipped
					</span>
				)}
			</div>
		</div>
	);
}

function StatusGlyph({ status }: { status: NodeStatus }) {
	switch (status) {
		case "pending":
			return (
				<LuClock
					className="size-3 text-foreground/30 shrink-0"
					aria-hidden
				/>
			);
		case "running":
			return (
				<LuLoaderCircle
					className="size-3 text-amber-500 shrink-0 animate-spin"
					aria-hidden
				/>
			);
		case "done":
			return (
				<LuCheck className="size-3 text-green-500 shrink-0" aria-hidden />
			);
		case "failed":
			return <LuX className="size-3 text-red-500 shrink-0" aria-hidden />;
		case "skipped":
			return (
				<span className="size-3 shrink-0 rounded-sm border border-dashed border-foreground/30" />
			);
		default:
			return null;
	}
}
