import { expect, test } from "bun:test";
import { wireDependencies, detectCycle, readySet, applyFailureSkips } from "./dag";
import type { RunNode } from "shared/orchestrator/types";
import type { Roster } from "shared/orchestrator/types";

const roster: Roster = [
	{ team: "L", agent: "foreman", handles: ["mockups"], needs: [], emits: ["mockups"] },
	{ team: "S", agent: "store", handles: ["stage"], needs: ["mockups"], emits: ["collection"] },
	{ team: "M", agent: "sm", handles: ["posts"], needs: ["collection"], emits: ["posts"] },
];
const node = (id: string, agent: string): RunNode => ({
	id, agent, task: id, needs: [], status: "pending", handoff_id: null, result: null,
});

test("wireDependencies links store->foreman and sm->store by emits/needs", () => {
	const wired = wireDependencies([node("n1", "foreman"), node("n2", "store"), node("n3", "sm")], roster);
	expect(wired.find((n) => n.id === "n2")!.needs).toEqual(["n1"]);
	expect(wired.find((n) => n.id === "n3")!.needs).toEqual(["n2"]);
	expect(wired.find((n) => n.id === "n1")!.needs).toEqual([]);
});

test("detectCycle returns null for a DAG and a path for a cycle", () => {
	const a = { ...node("a", "x"), needs: ["b"] };
	const b = { ...node("b", "y"), needs: ["a"] };
	expect(detectCycle([a, b])).not.toBeNull();
	expect(detectCycle([node("a", "x"), { ...node("b", "y"), needs: ["a"] }])).toBeNull();
});

test("readySet returns pending nodes whose needs are all done", () => {
	const n1 = { ...node("n1", "foreman"), status: "done" as const };
	const n2 = { ...node("n2", "store"), needs: ["n1"] };
	const n3 = { ...node("n3", "sm"), needs: ["n2"] };
	const ready = readySet([n1, n2, n3]);
	expect(ready.map((n) => n.id)).toEqual(["n2"]);
});

test("applyFailureSkips marks transitive dependents as skipped", () => {
	const n1 = { ...node("n1", "foreman"), status: "failed" as const };
	const n2 = { ...node("n2", "store"), needs: ["n1"] };
	const n3 = { ...node("n3", "sm"), needs: ["n2"] };
	const out = applyFailureSkips([n1, n2, n3], "n1");
	expect(out.find((n) => n.id === "n2")!.status).toBe("skipped");
	expect(out.find((n) => n.id === "n3")!.status).toBe("skipped");
});
