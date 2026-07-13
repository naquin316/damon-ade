import type { Roster, RunNode } from "shared/orchestrator/types";

/** Fill node.needs (node-id edges) by matching a consumer agent's `needs`
 *  capability keys to the emits of earlier producer nodes. First producer wins. */
export function wireDependencies(nodes: RunNode[], roster: Roster): RunNode[] {
	const cap = new Map(roster.map((c) => [c.agent, c]));
	return nodes.map((n) => {
		const needsKeys = cap.get(n.agent)?.needs ?? [];
		const edges = new Set<string>();
		for (const key of needsKeys) {
			for (const other of nodes) {
				if (other.id === n.id) continue;
				if ((cap.get(other.agent)?.emits ?? []).includes(key)) {
					edges.add(other.id);
					break;
				}
			}
		}
		return { ...n, needs: [...edges] };
	});
}

export function detectCycle(nodes: RunNode[]): string[] | null {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const state = new Map<string, 0 | 1 | 2>(); // 0 unseen,1 in-stack,2 done
	const stack: string[] = [];
	let found: string[] | null = null;
	const visit = (id: string): boolean => {
		if (found) return true;
		state.set(id, 1);
		stack.push(id);
		for (const dep of byId.get(id)?.needs ?? []) {
			const s = state.get(dep) ?? 0;
			if (s === 1) { found = [...stack.slice(stack.indexOf(dep)), dep]; return true; }
			if (s === 0 && visit(dep)) return true;
		}
		stack.pop();
		state.set(id, 2);
		return false;
	};
	for (const n of nodes) if ((state.get(n.id) ?? 0) === 0) if (visit(n.id)) break;
	return found;
}

export function readySet(nodes: RunNode[]): RunNode[] {
	const done = new Set(nodes.filter((n) => n.status === "done").map((n) => n.id));
	return nodes.filter((n) => n.status === "pending" && n.needs.every((d) => done.has(d)));
}

export function applyFailureSkips(nodes: RunNode[], failedId: string): RunNode[] {
	const dependents = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const n of nodes) {
			if (dependents.has(n.id)) continue;
			if (n.needs.some((d) => d === failedId || dependents.has(d))) {
				dependents.add(n.id);
				changed = true;
			}
		}
	}
	return nodes.map((n) =>
		dependents.has(n.id) && (n.status === "pending" || n.status === "running")
			? { ...n, status: "skipped" as const }
			: n,
	);
}
