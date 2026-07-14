import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { LuCheck, LuClock, LuLoaderCircle, LuX } from "react-icons/lu";
import type { NodeStatus, RunNode } from "shared/orchestrator/types";

export interface RunGraphProps {
	nodes: RunNode[];
	/** Provide to enable the per-node Retry button on failed nodes (e.g. the
	 * live Run Board). Omit for read-only previews (e.g. Plan Review). */
	onRetry?: (nodeId: string) => void;
	/** Node id currently being retried, so its button can show "Retrying…"
	 * and disable while the mutation is in flight. */
	retryingNodeId?: string | null;
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
export function computeLayers(nodes: RunNode[]): Map<string, number> {
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

/** Renders a run's dependency graph as a live, animated mission-control
 * board — columns flow left→right by dependency depth, edges light up as
 * upstream nodes complete. Used both as the live progress view during a run
 * (Run Board's DagView) and as a read-only shape preview while a plan is
 * still being edited (Plan Review). */
export function RunGraph({ nodes, onRetry, retryingNodeId }: RunGraphProps) {
	const { positions, width, height } = useMemo(
		() => computeLayout(nodes),
		[nodes],
	);
	const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

	if (nodes.length === 0) {
		return (
			<div className="flex flex-1 h-full items-center justify-center text-xs text-foreground/40 italic py-10">
				Waiting for the plan…
			</div>
		);
	}

	return (
		<div className="relative" style={{ width, height }}>
			<svg
				className="absolute inset-0 pointer-events-none"
				width={width}
				height={height}
				aria-hidden
			>
				{nodes.map((node) =>
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

			{nodes.map((node) => {
				const pos = positions.get(node.id);
				if (!pos) return null;
				return (
					<NodeCard
						key={node.id}
						node={node}
						pos={pos}
						onRetry={onRetry ? () => onRetry(node.id) : undefined}
						isRetrying={retryingNodeId === node.id}
					/>
				);
			})}
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
	onRetry?: () => void;
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

				{status === "failed" && onRetry && (
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
