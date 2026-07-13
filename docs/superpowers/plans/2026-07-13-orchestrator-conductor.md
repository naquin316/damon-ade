# RyanOS Orchestrator ("Conductor") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a goal-dispatcher orchestrator for RyanOS: a Conductor agent turns one natural-language goal into an approved dependency-graph of handoffs, dispatched across existing team agents, watched live by an in-app Run Board — with the vault as the source of truth.

**Architecture:** A deterministic **run engine** in the main process owns dispatch/poll/collect/assemble (fully unit-testable, no live LLM). The **Conductor LLM agent** is invoked once per run to produce the plan (DAG) — and optionally to write the final summary — by writing a run manifest into the vault. The **Run Board** renderer screen reflects vault state over tRPC; it drives nothing. Dispatch reuses the existing agent launch command + handoff queue; results come back through the handoff `status`/`result` contract.

**Tech Stack:** TypeScript, Electron (main + renderer), tRPC (`trpc-electron`, **observables only** — never async generators), Zod v4, the `yaml` package (already a dep), bun test, TanStack Router (file-based routes under `renderer/routes/_authenticated/_dashboard`).

## Global Constraints

- **tRPC subscriptions MUST use `observable` from `@trpc/server/observable`** — `trpc-electron` throws on async generators (see `apps/desktop/AGENTS.md`).
- **IPC always goes through tRPC** as defined in `apps/desktop/src/lib/trpc`; use path aliases from `tsconfig.json`.
- **Test harness is `bun test`** (run from `apps/desktop`). Typecheck: `npm run typecheck` (from `apps/desktop`).
- **Vault path:** `/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026`. Orchestrator runs live under `<VAULT>/2. Areas/Orchestrator/runs/`. The handoff queue lives under `<VAULT>/2. Areas/Handoffs/<recipient-slug>/`.
- **Seed-brains root** resolves via `resolveSeedBrainsRoot()` (`main/lib/seed-brains.ts`); brains live at `assets/seed-brains/<slug>/brain/`, capability manifests at `assets/seed-brains/<slug>/capabilities.yaml`.
- **Handoff back-compat:** a handoff note without `run_id`/`result` MUST still parse and behave as today.
- **Commit after every task.** DRY, YAGNI, TDD.
- **Never write secrets into vault notes** — name the env var / 1Password location instead.

---

## File Structure

**Shared types (main + renderer):**
- Create `apps/desktop/src/shared/orchestrator/types.ts` — `CapabilityManifest`, `Roster`, `RunManifest`, `RunNode`, `NodeStatus`, `RunStatus`, `OrchestratorEvent`, Zod schemas.

**Main-process engine (`apps/desktop/src/main/lib/orchestrator/`):**
- `capabilities.ts` — load + aggregate all `capabilities.yaml` into a `Roster`.
- `dag.ts` — pure graph: `buildDag`, `detectCycle`, `readySet`, `applyFailureSkips`.
- `paths.ts` — vault path helpers for runs + handoff inboxes.
- `frontmatter.ts` — split/join markdown-frontmatter (thin wrapper over `yaml`).
- `manifest.ts` — read/write a `RunManifest` to `runs/<run_id>.md`.
- `handoff.ts` — write a dispatch note (`pending`, `run_id`) + read status/result; back-compat parse.
- `dispatch.ts` — spawn a target agent to process its inbox (wraps `buildAgentLaunchCommand` + terminal-host `createSession`), resolving slug→agentId.
- `engine.ts` — the run loop (dispatch ready set → poll → collect → unlock → assemble), per-node timeout, cancel; emits `OrchestratorEvent`s on an `EventEmitter`.

**tRPC:**
- Create `apps/desktop/src/lib/trpc/routers/orchestrator.ts` — `submitGoal`, `approvePlan`, `watchRun` (observable), `cancelRun`, `listRuns`, `retryNode`.
- Modify `apps/desktop/src/lib/trpc/routers/index.ts` — register `orchestrator`.

**Renderer (Run Board):**
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/run-board/page.tsx` — screen.
- `apps/desktop/src/renderer/screens/main/components/RunBoard/` — `GoalInput.tsx`, `PlanReview.tsx`, `DagView.tsx`, `ResultsPanel.tsx`.
- `apps/desktop/src/renderer/react-query/orchestrator/` — hooks over the tRPC router.

**Seed-brain + manifests:**
- `assets/seed-brains/conductor/brain/{persona.txt,context/CLAUDE.md,mcp.json,skills/conduct/SKILL.md}` + `assets/seed-brains/conductor/README.md`.
- `assets/seed-brains/<slug>/capabilities.yaml` for each existing agent.

---

## Task 1: Shared orchestrator types + schemas

**Files:**
- Create: `apps/desktop/src/shared/orchestrator/types.ts`
- Test: `apps/desktop/src/shared/orchestrator/types.test.ts`

**Interfaces:**
- Produces: `NodeStatus`, `RunStatus`, Zod schemas `runNodeSchema`, `runManifestSchema`, `capabilityManifestSchema`, and inferred types `RunNode`, `RunManifest`, `CapabilityManifest`, `Roster`, `OrchestratorEvent`.

- [ ] **Step 1: Write the failing test**

```ts
// types.test.ts
import { expect, test } from "bun:test";
import { runManifestSchema, capabilityManifestSchema } from "./types";

test("capability manifest parses a full manifest", () => {
	const m = capabilityManifestSchema.parse({
		team: "Social Media",
		agent: "sm-manager",
		handles: ["draft brand-voiced posts"],
		needs: ["product-facts", "angle"],
		emits: ["drafted-posts"],
		gate: "publish-approval",
	});
	expect(m.agent).toBe("sm-manager");
	expect(m.emits).toEqual(["drafted-posts"]);
});

test("capability manifest defaults optional arrays to empty", () => {
	const m = capabilityManifestSchema.parse({ team: "X", agent: "y", handles: ["z"] });
	expect(m.needs).toEqual([]);
	expect(m.emits).toEqual([]);
});

test("run manifest parses with a node and back-fills defaults", () => {
	const r = runManifestSchema.parse({
		run_id: "2026-07-13-x",
		goal: "g",
		status: "planning",
		created: "2026-07-13",
		nodes: [{ id: "n1", agent: "foreman", task: "t", needs: [] }],
	});
	expect(r.nodes[0].status).toBe("pending");
	expect(r.nodes[0].result).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/shared/orchestrator/types.test.ts`
Expected: FAIL — module `./types` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// types.ts
import { z } from "zod";

export const nodeStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export type NodeStatus = z.infer<typeof nodeStatus>;

export const runStatus = z.enum([
	"planning", "awaiting-approval", "running", "done", "partial", "cancelled",
]);
export type RunStatus = z.infer<typeof runStatus>;

export const capabilityManifestSchema = z.object({
	team: z.string(),
	agent: z.string(), // seed-brain slug == handoff recipient-slug
	handles: z.array(z.string()),
	needs: z.array(z.string()).default([]),
	emits: z.array(z.string()).default([]),
	gate: z.string().optional(),
});
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;
export type Roster = CapabilityManifest[];

export const runNodeSchema = z.object({
	id: z.string(),
	agent: z.string(),
	task: z.string(),
	needs: z.array(z.string()).default([]),
	status: nodeStatus.default("pending"),
	handoff_id: z.string().nullable().default(null),
	result: z.string().nullable().default(null),
});
export type RunNode = z.infer<typeof runNodeSchema>;

export const runManifestSchema = z.object({
	run_id: z.string(),
	goal: z.string(),
	status: runStatus,
	created: z.string(),
	nodes: z.array(runNodeSchema),
	summary: z.string().nullable().default(null),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export type OrchestratorEvent =
	| { type: "run-updated"; run: RunManifest }
	| { type: "run-error"; runId: string; message: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/shared/orchestrator/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/orchestrator/types.ts apps/desktop/src/shared/orchestrator/types.test.ts
git commit -m "feat(orchestrator): shared run/capability types + zod schemas"
```

---

## Task 2: DAG builder (wiring, cycles, ready-set, failure-skip)

**Files:**
- Create: `apps/desktop/src/main/lib/orchestrator/dag.ts`
- Test: `apps/desktop/src/main/lib/orchestrator/dag.test.ts`

**Interfaces:**
- Consumes: `RunNode`, `NodeStatus` (Task 1).
- Produces:
  - `wireDependencies(nodes: RunNode[], roster: Roster): RunNode[]` — fills each node's `needs` (node-id edges) by matching the producing node whose agent's `emits` covers a consumer agent's `needs`.
  - `detectCycle(nodes: RunNode[]): string[] | null` — returns a cycle path or null.
  - `readySet(nodes: RunNode[]): RunNode[]` — `pending` nodes whose every `needs` node is `done`.
  - `applyFailureSkips(nodes: RunNode[], failedId: string): RunNode[]` — mark transitive dependents of `failedId` as `skipped`.

- [ ] **Step 1: Write the failing test**

```ts
// dag.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/dag.test.ts`
Expected: FAIL — `./dag` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// dag.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/dag.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lib/orchestrator/dag.ts apps/desktop/src/main/lib/orchestrator/dag.test.ts
git commit -m "feat(orchestrator): pure DAG builder — wire/cycle/ready-set/failure-skip"
```

---

## Task 3: Frontmatter + run-manifest read/write

**Files:**
- Create: `apps/desktop/src/main/lib/orchestrator/frontmatter.ts`
- Create: `apps/desktop/src/main/lib/orchestrator/paths.ts`
- Create: `apps/desktop/src/main/lib/orchestrator/manifest.ts`
- Test: `apps/desktop/src/main/lib/orchestrator/manifest.test.ts`

**Interfaces:**
- Consumes: `RunManifest`, `runManifestSchema` (Task 1).
- Produces:
  - `splitFrontmatter(raw: string): { data: unknown; body: string }`
  - `joinFrontmatter(data: unknown, body: string): string`
  - `runsDir(vault: string): string`, `runPath(vault: string, runId: string): string`, `handoffInbox(vault: string, slug: string): string`
  - `writeManifest(vault: string, run: RunManifest): void`
  - `readManifest(vault: string, runId: string): RunManifest | null`

- [ ] **Step 1: Write the failing test**

```ts
// manifest.test.ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeManifest, readManifest } from "./manifest";
import type { RunManifest } from "shared/orchestrator/types";

const run: RunManifest = {
	run_id: "2026-07-13-fd", goal: "Father's Day push", status: "running",
	created: "2026-07-13", summary: null,
	nodes: [{ id: "n1", agent: "foreman", task: "3 mockups", needs: [], status: "done", handoff_id: "h1", result: "vault/x.png" }],
};

test("writeManifest then readManifest round-trips", () => {
	const vault = mkdtempSync(join(tmpdir(), "orch-"));
	writeManifest(vault, run);
	const back = readManifest(vault, "2026-07-13-fd");
	expect(back).not.toBeNull();
	expect(back!.goal).toBe("Father's Day push");
	expect(back!.nodes[0].result).toBe("vault/x.png");
});

test("readManifest returns null for an unknown run", () => {
	const vault = mkdtempSync(join(tmpdir(), "orch-"));
	expect(readManifest(vault, "nope")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/manifest.test.ts`
Expected: FAIL — `./manifest` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontmatter.ts
import { parse, stringify } from "yaml";

const FM = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function splitFrontmatter(raw: string): { data: unknown; body: string } {
	const m = raw.match(FM);
	if (!m) return { data: {}, body: raw };
	return { data: parse(m[1]) ?? {}, body: m[2] ?? "" };
}

export function joinFrontmatter(data: unknown, body: string): string {
	return `---\n${stringify(data)}---\n\n${body}`;
}
```

```ts
// paths.ts
import { join } from "node:path";

export function runsDir(vault: string): string {
	return join(vault, "2. Areas", "Orchestrator", "runs");
}
export function runPath(vault: string, runId: string): string {
	return join(runsDir(vault), `${runId}.md`);
}
export function handoffInbox(vault: string, slug: string): string {
	return join(vault, "2. Areas", "Handoffs", slug);
}
```

```ts
// manifest.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runManifestSchema, type RunManifest } from "shared/orchestrator/types";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";
import { runPath } from "./paths";

function body(run: RunManifest): string {
	const lines = run.nodes.map(
		(n) => `- **${n.id}** \`${n.agent}\` — ${n.task} _(${n.status})_`,
	);
	return `# ${run.goal}\n\n${lines.join("\n")}\n`;
}

export function writeManifest(vault: string, run: RunManifest): void {
	const p = runPath(vault, run.run_id);
	mkdirSync(dirname(p), { recursive: true });
	const { nodes, ...front } = run;
	writeFileSync(p, joinFrontmatter({ ...front, nodes }, body(run)), "utf8");
}

export function readManifest(vault: string, runId: string): RunManifest | null {
	const p = runPath(vault, runId);
	if (!existsSync(p)) return null;
	const { data } = splitFrontmatter(readFileSync(p, "utf8"));
	const parsed = runManifestSchema.safeParse(data);
	return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/manifest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lib/orchestrator/frontmatter.ts apps/desktop/src/main/lib/orchestrator/paths.ts apps/desktop/src/main/lib/orchestrator/manifest.ts apps/desktop/src/main/lib/orchestrator/manifest.test.ts
git commit -m "feat(orchestrator): run-manifest read/write (markdown+frontmatter)"
```

---

## Task 4: Capability-registry loader

**Files:**
- Create: `apps/desktop/src/main/lib/orchestrator/capabilities.ts`
- Test: `apps/desktop/src/main/lib/orchestrator/capabilities.test.ts`
- Reference: `apps/desktop/src/main/lib/seed-brains.ts` (`resolveSeedBrainsRoot`)

**Interfaces:**
- Consumes: `capabilityManifestSchema`, `Roster` (Task 1).
- Produces:
  - `loadRosterFrom(root: string): Roster` — read every `<root>/<slug>/capabilities.yaml`, validate, skip malformed with a `console.warn` (best-effort, mirrors scaffold idiom).
  - `loadRoster(): Roster` — same over `resolveSeedBrainsRoot()`.

- [ ] **Step 1: Write the failing test**

```ts
// capabilities.test.ts
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRosterFrom } from "./capabilities";

function seed(root: string, slug: string, yaml: string) {
	mkdirSync(join(root, slug), { recursive: true });
	writeFileSync(join(root, slug, "capabilities.yaml"), yaml, "utf8");
}

test("loadRosterFrom reads valid manifests and skips malformed", () => {
	const root = mkdtempSync(join(tmpdir(), "sb-"));
	seed(root, "foreman", "team: L\nagent: foreman\nhandles: [mockups]\nemits: [mockups]\n");
	seed(root, "broken", "team: X\n"); // missing agent+handles → skipped
	const roster = loadRosterFrom(root);
	expect(roster.map((c) => c.agent)).toEqual(["foreman"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/capabilities.test.ts`
Expected: FAIL — `./capabilities` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// capabilities.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { capabilityManifestSchema, type Roster } from "shared/orchestrator/types";
import { resolveSeedBrainsRoot } from "../seed-brains";

export function loadRosterFrom(root: string): Roster {
	if (!existsSync(root)) return [];
	const roster: Roster = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const p = join(root, entry.name, "capabilities.yaml");
		if (!existsSync(p)) continue;
		try {
			const parsed = capabilityManifestSchema.safeParse(parse(readFileSync(p, "utf8")));
			if (parsed.success) roster.push(parsed.data);
			else console.warn(`[orchestrator] skipping malformed capabilities.yaml: ${p}`);
		} catch {
			console.warn(`[orchestrator] unreadable capabilities.yaml: ${p}`);
		}
	}
	return roster;
}

export function loadRoster(): Roster {
	return loadRosterFrom(resolveSeedBrainsRoot());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/capabilities.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lib/orchestrator/capabilities.ts apps/desktop/src/main/lib/orchestrator/capabilities.test.ts
git commit -m "feat(orchestrator): capability-registry loader over seed-brains"
```

---

## Task 5: Handoff dispatch note (write + read, back-compat)

**Files:**
- Create: `apps/desktop/src/main/lib/orchestrator/handoff.ts`
- Test: `apps/desktop/src/main/lib/orchestrator/handoff.test.ts`

**Interfaces:**
- Consumes: `splitFrontmatter`/`joinFrontmatter` (Task 3), `handoffInbox` (Task 3).
- Produces:
  - `writeDispatchNote(vault, { slug, handoffId, runId, task, facts }): void` — writes `<inbox>/<handoffId>.md` with `status: pending`, `run_id`, and the task/facts body; no-op if a note with that `handoffId` already exists in the inbox or its `done/` (dedup).
  - `readHandoffStatus(vault, slug, handoffId): { status: string; result: string | null } | null` — reads the note (checks inbox then `done/`); a note lacking `result` yields `result: null` (back-compat).

- [ ] **Step 1: Write the failing test**

```ts
// handoff.test.ts
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDispatchNote, readHandoffStatus } from "./handoff";
import { handoffInbox } from "./paths";

test("writeDispatchNote creates a pending note carrying run_id", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	writeDispatchNote(vault, { slug: "foreman", handoffId: "h1", runId: "r1", task: "mockups", facts: "FD sale" });
	const s = readHandoffStatus(vault, "foreman", "h1");
	expect(s).toEqual({ status: "pending", result: null });
});

test("readHandoffStatus reads result from a done note and is back-compat", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	const inbox = handoffInbox(vault, "foreman");
	mkdirSync(inbox, { recursive: true });
	// A note written by an agent, flipped to done, with a result:
	writeFileSync(join(inbox, "h2.md"), "---\nhandoff_id: h2\nstatus: done\nresult: vault/x.png\n---\nbody\n", "utf8");
	expect(readHandoffStatus(vault, "foreman", "h2")).toEqual({ status: "done", result: "vault/x.png" });
	// A legacy note with no run_id/result still parses:
	writeFileSync(join(inbox, "h3.md"), "---\nhandoff_id: h3\nstatus: drafted\n---\nbody\n", "utf8");
	expect(readHandoffStatus(vault, "foreman", "h3")).toEqual({ status: "drafted", result: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/handoff.test.ts`
Expected: FAIL — `./handoff` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// handoff.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";
import { handoffInbox } from "./paths";

export function writeDispatchNote(
	vault: string,
	args: { slug: string; handoffId: string; runId: string; task: string; facts?: string },
): void {
	const inbox = handoffInbox(vault, args.slug);
	const doneDir = join(inbox, "done");
	const filename = `${args.handoffId}.md`;
	if (existsSync(join(inbox, filename)) || existsSync(join(doneDir, filename))) return; // dedup
	mkdirSync(inbox, { recursive: true });
	const data = {
		handoff_id: args.handoffId,
		from: "conductor",
		to: args.slug,
		status: "pending",
		run_id: args.runId,
		created: args.handoffId.slice(0, 10),
	};
	const body = `## Task\n${args.task}\n${args.facts ? `\n## Facts\n${args.facts}\n` : ""}`;
	writeFileSync(join(inbox, filename), joinFrontmatter(data, body), "utf8");
}

export function readHandoffStatus(
	vault: string, slug: string, handoffId: string,
): { status: string; result: string | null } | null {
	const inbox = handoffInbox(vault, slug);
	const filename = `${handoffId}.md`;
	const candidate = [join(inbox, filename), join(inbox, "done", filename)].find(existsSync);
	if (!candidate) return null;
	const { data } = splitFrontmatter(readFileSync(candidate, "utf8"));
	const d = (data ?? {}) as { status?: string; result?: string };
	return { status: d.status ?? "pending", result: d.result ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/handoff.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lib/orchestrator/handoff.ts apps/desktop/src/main/lib/orchestrator/handoff.test.ts
git commit -m "feat(orchestrator): dispatch-note write + status read (dedup, back-compat)"
```

---

## Task 6: Dispatch adapter (slug → spawned agent)

**Files:**
- Create: `apps/desktop/src/main/lib/orchestrator/dispatch.ts`
- Test: `apps/desktop/src/main/lib/orchestrator/dispatch.test.ts`
- Reference: `apps/desktop/src/main/lib/agent-launch.ts` (`buildAgentLaunchCommand`), `apps/desktop/src/main/terminal-host/terminal-host.ts` (`createSession`), the agents registry query used by the workspaces router.

**Interfaces:**
- Produces:
  - `type Spawner = (opts: { agentId: string; command: string; label: string }) => void`
  - `type SlugResolver = (slug: string) => string | null`
  - `dispatchAgent(deps: { resolveSlug: SlugResolver; spawn: Spawner; buildCommand: (agentId: string) => string }, slug: string, instruction: string): { ok: true } | { ok: false; error: string }` — resolves the slug to an agentId, builds the launch command, appends the instruction, and spawns. Returns an error result (never throws) when the slug can't be resolved.

**Design note:** `dispatch.ts` takes its side-effecting collaborators (`resolveSlug`, `spawn`, `buildCommand`) as injected functions so it is unit-testable with fakes. The real wiring (registry lookup → `buildAgentLaunchCommand` → `createSession`) is assembled in the tRPC router (Task 8) and exercised in the live-verify (Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// dispatch.test.ts
import { expect, test } from "bun:test";
import { dispatchAgent } from "./dispatch";

test("dispatchAgent resolves slug, appends instruction, and spawns", () => {
	const spawned: string[] = [];
	const res = dispatchAgent(
		{
			resolveSlug: (s) => (s === "foreman" ? "agent-123" : null),
			spawn: ({ command }) => spawned.push(command),
			buildCommand: (id) => `claude --agent ${id}`,
		},
		"foreman",
		"Process your inbox for run r1 now.",
	);
	expect(res).toEqual({ ok: true });
	expect(spawned[0]).toContain("claude --agent agent-123");
	expect(spawned[0]).toContain("Process your inbox for run r1 now.");
});

test("dispatchAgent returns an error when the slug is unknown", () => {
	const res = dispatchAgent(
		{ resolveSlug: () => null, spawn: () => {}, buildCommand: () => "" },
		"ghost",
		"x",
	);
	expect(res).toEqual({ ok: false, error: "No agent registered for slug: ghost" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/dispatch.test.ts`
Expected: FAIL — `./dispatch` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// dispatch.ts
export type Spawner = (opts: { agentId: string; command: string; label: string }) => void;
export type SlugResolver = (slug: string) => string | null;

export function dispatchAgent(
	deps: { resolveSlug: SlugResolver; spawn: Spawner; buildCommand: (agentId: string) => string },
	slug: string,
	instruction: string,
): { ok: true } | { ok: false; error: string } {
	const agentId = deps.resolveSlug(slug);
	if (!agentId) return { ok: false, error: `No agent registered for slug: ${slug}` };
	// The instruction is delivered by appending it after the launch command as an
	// initial prompt argument. buildAgentLaunchCommand already ends with the claude
	// invocation; append a quoted -p/initial-prompt segment.
	const command = `${deps.buildCommand(agentId)} ${JSON.stringify(instruction)}`;
	deps.spawn({ agentId, command, label: `conductor:${slug}` });
	return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/dispatch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lib/orchestrator/dispatch.ts apps/desktop/src/main/lib/orchestrator/dispatch.test.ts
git commit -m "feat(orchestrator): dispatch adapter (injected spawn/resolve, unit-tested)"
```

---

## Task 7: Run engine (dispatch → poll → collect → assemble)

**Files:**
- Create: `apps/desktop/src/main/lib/orchestrator/engine.ts`
- Test: `apps/desktop/src/main/lib/orchestrator/engine.test.ts`

**Interfaces:**
- Consumes: `readySet`, `applyFailureSkips` (Task 2); `RunManifest`, `RunNode` (Task 1).
- Produces:
  - `type EngineDeps = { dispatch: (node: RunNode) => { ok: boolean; error?: string }; pollStatus: (node: RunNode) => { status: string; result: string | null } | null; now: () => number; onUpdate: (run: RunManifest) => void }`
  - `stepRun(run: RunManifest, deps: EngineDeps, timeoutMs: number, dispatchedAt: Map<string,number>): RunManifest` — advances the run one tick: dispatches ready nodes (sets `running`, records dispatch time, assigns `handoff_id`), collects `done`/`failed` (applying timeout + failure-skips), recomputes terminal state. Idempotent and pure w.r.t. its inputs (all effects via `deps`).
  - `isTerminal(run: RunManifest): boolean`
  - `finalize(run: RunManifest): RunManifest` — sets `status` to `done` (all done/skipped, none failed) or `partial` (any failed).

**Design note:** the engine is a *reducer* driven by a caller loop (the tRPC router) that calls `stepRun` on an interval / on queue file-change. This keeps timing/side-effects at the edge and makes the core deterministic under a fake clock.

- [ ] **Step 1: Write the failing test**

```ts
// engine.test.ts
import { expect, test } from "bun:test";
import { stepRun, isTerminal, finalize, type EngineDeps } from "./engine";
import type { RunManifest } from "shared/orchestrator/types";

const base: RunManifest = {
	run_id: "r1", goal: "g", status: "running", created: "2026-07-13", summary: null,
	nodes: [
		{ id: "n1", agent: "foreman", task: "t1", needs: [], status: "pending", handoff_id: null, result: null },
		{ id: "n2", agent: "store", task: "t2", needs: ["n1"], status: "pending", handoff_id: null, result: null },
	],
};

test("stepRun dispatches the ready node and marks it running", () => {
	const dispatched: string[] = [];
	const deps: EngineDeps = {
		dispatch: (n) => { dispatched.push(n.id); return { ok: true }; },
		pollStatus: () => null,
		now: () => 0,
		onUpdate: () => {},
	};
	const out = stepRun(base, deps, 60_000, new Map());
	expect(dispatched).toEqual(["n1"]);
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("running");
	expect(out.nodes.find((n) => n.id === "n2")!.status).toBe("pending");
});

test("stepRun collects a done node and unlocks its dependent", () => {
	const running: RunManifest = {
		...base,
		nodes: base.nodes.map((n) => n.id === "n1" ? { ...n, status: "running", handoff_id: "h1" } : n),
	};
	const deps: EngineDeps = {
		dispatch: () => ({ ok: true }),
		pollStatus: (n) => n.id === "n1" ? { status: "done", result: "out1" } : null,
		now: () => 0,
		onUpdate: () => {},
	};
	const out = stepRun(running, deps, 60_000, new Map([["n1", 0]]));
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("done");
	expect(out.nodes.find((n) => n.id === "n1")!.result).toBe("out1");
});

test("stepRun times out a stuck running node and skips its dependents", () => {
	const running: RunManifest = {
		...base,
		nodes: base.nodes.map((n) => n.id === "n1" ? { ...n, status: "running", handoff_id: "h1" } : n),
	};
	const deps: EngineDeps = {
		dispatch: () => ({ ok: true }),
		pollStatus: () => ({ status: "pending", result: null }), // never done
		now: () => 100_000,
		onUpdate: () => {},
	};
	const out = stepRun(running, deps, 60_000, new Map([["n1", 0]]));
	expect(out.nodes.find((n) => n.id === "n1")!.status).toBe("failed");
	expect(out.nodes.find((n) => n.id === "n2")!.status).toBe("skipped");
});

test("finalize marks partial when any node failed, done otherwise", () => {
	const failed = { ...base, nodes: base.nodes.map((n) => ({ ...n, status: "failed" as const })) };
	expect(finalize(failed).status).toBe("partial");
	const alldone = { ...base, nodes: base.nodes.map((n) => ({ ...n, status: "done" as const })) };
	expect(finalize(alldone).status).toBe("done");
	expect(isTerminal(alldone)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/engine.test.ts`
Expected: FAIL — `./engine` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// engine.ts
import { readySet, applyFailureSkips } from "./dag";
import type { RunManifest, RunNode } from "shared/orchestrator/types";

export type EngineDeps = {
	dispatch: (node: RunNode) => { ok: boolean; error?: string };
	pollStatus: (node: RunNode) => { status: string; result: string | null } | null;
	now: () => number;
	onUpdate: (run: RunManifest) => void;
};

const DONE_STATUSES = new Set(["done"]);
const FAIL_STATUSES = new Set(["rejected"]);

export function stepRun(
	run: RunManifest, deps: EngineDeps, timeoutMs: number, dispatchedAt: Map<string, number>,
): RunManifest {
	let nodes = run.nodes.map((n) => ({ ...n }));

	// 1) Collect running nodes (done / failed / timeout).
	for (const n of nodes) {
		if (n.status !== "running") continue;
		const s = deps.pollStatus(n);
		if (s && DONE_STATUSES.has(s.status)) {
			n.status = "done";
			n.result = s.result;
		} else if (s && FAIL_STATUSES.has(s.status)) {
			n.status = "failed";
			nodes = applyFailureSkips(nodes, n.id);
		} else {
			const started = dispatchedAt.get(n.id) ?? deps.now();
			if (deps.now() - started >= timeoutMs) {
				n.status = "failed";
				nodes = applyFailureSkips(nodes, n.id);
			}
		}
	}

	// 2) Dispatch the ready set.
	for (const n of readySet(nodes)) {
		const handoffId = n.handoff_id ?? `${run.run_id}-${n.id}`;
		const target = nodes.find((x) => x.id === n.id)!;
		target.handoff_id = handoffId;
		const r = deps.dispatch({ ...target });
		if (r.ok) {
			target.status = "running";
			dispatchedAt.set(n.id, deps.now());
		} else {
			target.status = "failed";
			nodes = applyFailureSkips(nodes, n.id);
		}
	}

	const next = { ...run, nodes };
	deps.onUpdate(next);
	return next;
}

export function isTerminal(run: RunManifest): boolean {
	return run.nodes.every((n) => ["done", "failed", "skipped"].includes(n.status));
}

export function finalize(run: RunManifest): RunManifest {
	const anyFailed = run.nodes.some((n) => n.status === "failed");
	return { ...run, status: anyFailed ? "partial" : "done" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/engine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lib/orchestrator/engine.ts apps/desktop/src/main/lib/orchestrator/engine.test.ts
git commit -m "feat(orchestrator): deterministic run engine (dispatch/poll/collect/timeout)"
```

---

## Task 8: Orchestrator tRPC router

**Files:**
- Create: `apps/desktop/src/lib/trpc/routers/orchestrator.ts`
- Modify: `apps/desktop/src/lib/trpc/routers/index.ts` (register `orchestrator`)
- Create: `apps/desktop/src/main/lib/orchestrator/runner.ts` — the interval loop that drives `stepRun`, persists via `writeManifest`, and emits `OrchestratorEvent` on an `EventEmitter`.
- Reference: `apps/desktop/src/lib/trpc/routers/self-update.ts` (observable subscription pattern), `agent-launch.ts`, `terminal-host.ts`.

**Interfaces:**
- Consumes: everything above + `loadRoster`, `wireDependencies`, `detectCycle`, `readManifest`/`writeManifest`, `writeDispatchNote`/`readHandoffStatus`, `dispatchAgent`, `stepRun`/`isTerminal`/`finalize`.
- Produces tRPC procedures:
  - `submitGoal({ goal }): Promise<RunManifest>` — create `run_id`, spawn the Conductor agent (headless) told to write the plan into `runs/<run_id>.md` with `status: awaiting-approval`; poll the manifest until it appears (bounded), validate (cycle-check → error if cyclic), return it.
  - `approvePlan({ runId, nodes? }): Promise<RunManifest>` — accept optional edited `nodes`, set `status: running`, start the runner loop.
  - `watchRun({ runId }).subscription` → `observable<OrchestratorEvent>` — emit the current manifest immediately, then on every runner update.
  - `cancelRun({ runId })` — set `status: cancelled`, stop the loop.
  - `listRuns()` / `retryNode({ runId, nodeId })`.

**Design note (Conductor invocation):** `submitGoal` spawns the Conductor seed-brain agent with a print-mode prompt containing the goal + the serialized roster (`loadRoster()`), instructing it to WRITE the run manifest file (plan only, `status: awaiting-approval`). The engine never asks an LLM to run the loop. If the Conductor writes a cyclic plan, `submitGoal` rejects with a clear error rather than starting.

- [ ] **Step 1: Write the runner loop test (fake deps, no Electron)**

```ts
// apps/desktop/src/main/lib/orchestrator/runner.test.ts
import { expect, test } from "bun:test";
import { runToCompletion } from "./runner";
import type { RunManifest } from "shared/orchestrator/types";

test("runToCompletion drives a 2-node run to done via fake deps", async () => {
	const run: RunManifest = {
		run_id: "r1", goal: "g", status: "running", created: "2026-07-13", summary: null,
		nodes: [
			{ id: "n1", agent: "foreman", task: "t1", needs: [], status: "pending", handoff_id: null, result: null },
			{ id: "n2", agent: "store", task: "t2", needs: ["n1"], status: "pending", handoff_id: null, result: null },
		],
	};
	const doneAfter = new Set<string>();
	const final = await runToCompletion(run, {
		dispatch: (n) => { doneAfter.add(n.id); return { ok: true }; },
		pollStatus: (n) => doneAfter.has(n.id) ? { status: "done", result: `out-${n.id}` } : null,
		now: () => 0,
		onUpdate: () => {},
		timeoutMs: 1000,
		tick: async () => {},
	});
	expect(final.status).toBe("done");
	expect(final.nodes.every((n) => n.status === "done")).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/runner.test.ts`
Expected: FAIL — `./runner` not found.

- [ ] **Step 3: Implement `runner.ts` (loop) then the router**

```ts
// runner.ts
import { stepRun, isTerminal, finalize, type EngineDeps } from "./engine";
import type { RunManifest } from "shared/orchestrator/types";

export async function runToCompletion(
	start: RunManifest,
	deps: EngineDeps & { timeoutMs: number; tick: () => Promise<void> },
): Promise<RunManifest> {
	let run = start;
	const dispatchedAt = new Map<string, number>();
	// Bound iterations to (2 * nodes + 2) so a stuck fake can't loop forever.
	const maxIters = run.nodes.length * 2 + 2;
	for (let i = 0; i < maxIters && !isTerminal(run); i++) {
		run = stepRun(run, deps, deps.timeoutMs, dispatchedAt);
		if (!isTerminal(run)) await deps.tick();
	}
	const done = finalize(run);
	deps.onUpdate(done);
	return done;
}
```

Then create `orchestrator.ts` mirroring the `self-update.ts` observable pattern:

```ts
// orchestrator.ts (shape — real wiring assembled here)
import { EventEmitter } from "node:events";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { publicProcedure, router } from "..";
import { VAULT_ROOT } from "shared/constants"; // add if not present; else inline the constant
import { loadRoster } from "main/lib/orchestrator/capabilities";
import { wireDependencies, detectCycle } from "main/lib/orchestrator/dag";
import { readManifest, writeManifest } from "main/lib/orchestrator/manifest";
import { writeDispatchNote, readHandoffStatus } from "main/lib/orchestrator/handoff";
import { dispatchAgent } from "main/lib/orchestrator/dispatch";
import { runToCompletion } from "main/lib/orchestrator/runner";
import type { OrchestratorEvent, RunManifest } from "shared/orchestrator/types";

const bus = new EventEmitter();
const emit = (e: OrchestratorEvent) => bus.emit("event", e);

export const createOrchestratorRouter = () =>
	router({
		submitGoal: publicProcedure.input(z.object({ goal: z.string() })).mutation(async ({ input }) => {
			// 1. runId, 2. spawn Conductor (print mode) to write plan, 3. poll manifest,
			// 4. cycle-check, 5. return. (Spawn wiring uses buildAgentLaunchCommand + createSession.)
			// ... see Design note; returns RunManifest with status: "awaiting-approval".
		}),
		approvePlan: publicProcedure
			.input(z.object({ runId: z.string(), nodes: z.any().optional() }))
			.mutation(async ({ input }) => {
				const run = readManifest(VAULT_ROOT, input.runId);
				if (!run) throw new Error(`unknown run ${input.runId}`);
				const running: RunManifest = { ...run, status: "running", ...(input.nodes ? { nodes: input.nodes } : {}) };
				writeManifest(VAULT_ROOT, running);
				// Fire the loop (do not await in the mutation; drive via runner + emit updates).
				void runToCompletion(running, {
					dispatch: (n) => {
						writeDispatchNote(VAULT_ROOT, { slug: n.agent, handoffId: n.handoff_id!, runId: running.run_id, task: n.task });
						return dispatchAgent(realDispatchDeps, n.agent, `Process your inbox for run ${running.run_id} now.`);
					},
					pollStatus: (n) => (n.handoff_id ? readHandoffStatus(VAULT_ROOT, n.agent, n.handoff_id) : null),
					now: () => Date.now(),
					onUpdate: (r) => { writeManifest(VAULT_ROOT, r); emit({ type: "run-updated", run: r }); },
					timeoutMs: 15 * 60 * 1000,
					tick: () => new Promise((r) => setTimeout(r, 3000)),
				});
				return running;
			}),
		watchRun: publicProcedure.input(z.object({ runId: z.string() })).subscription(({ input }) =>
			observable<OrchestratorEvent>((e) => {
				const current = readManifest(VAULT_ROOT, input.runId);
				if (current) e.next({ type: "run-updated", run: current });
				const on = (ev: OrchestratorEvent) => { if (ev.type !== "run-updated" || ev.run.run_id === input.runId) e.next(ev); };
				bus.on("event", on);
				return () => bus.off("event", on);
			}),
		),
		cancelRun: publicProcedure.input(z.object({ runId: z.string() })).mutation(({ input }) => {
			const run = readManifest(VAULT_ROOT, input.runId);
			if (run) { writeManifest(VAULT_ROOT, { ...run, status: "cancelled" }); emit({ type: "run-updated", run: { ...run, status: "cancelled" } }); }
			return { ok: true };
		}),
	});
```

> Note: `realDispatchDeps` (registry `resolveSlug`, `buildAgentLaunchCommand`, `createSession` spawn) and `VAULT_ROOT` are assembled here. `Date.now()` is allowed in production main-process code; it is NOT used in any unit test (tests inject `now`). Replace `Date.now()` with an injected clock only if the repo bans it in main — check `git grep "Date.now" apps/desktop/src/main | head`.

- [ ] **Step 4: Register the router**

In `index.ts`, add the import and `orchestrator: createOrchestratorRouter(),` to the `router({...})` block.

- [ ] **Step 5: Run runner test + typecheck**

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/runner.test.ts && npm run typecheck`
Expected: runner test PASS; typecheck 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/lib/orchestrator/runner.ts apps/desktop/src/main/lib/orchestrator/runner.test.ts apps/desktop/src/lib/trpc/routers/orchestrator.ts apps/desktop/src/lib/trpc/routers/index.ts
git commit -m "feat(orchestrator): tRPC router + runner loop (submitGoal/approvePlan/watchRun/cancelRun)"
```

---

## Task 9: Run Board screen

**Files:**
- Create: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/run-board/page.tsx`
- Create: `apps/desktop/src/renderer/screens/main/components/RunBoard/{GoalInput,PlanReview,DagView,ResultsPanel}.tsx`
- Create: `apps/desktop/src/renderer/react-query/orchestrator/hooks.ts`
- Reference: an existing dashboard route + a component that consumes a tRPC subscription (e.g. how `self-update`/`VersionBadge` consumes its subscription).

**Interfaces:**
- Consumes: the `orchestrator` tRPC router (Task 8).

**Steps** (UI — verified manually, not unit-TDD):

- [ ] **Step 1:** Add `hooks.ts`: `useSubmitGoal()`, `useApprovePlan()`, `useCancelRun()`, and `useWatchRun(runId)` that subscribes to `orchestrator.watchRun` and returns the latest `RunManifest`. Mirror the existing tRPC-react subscription usage in the codebase.
- [ ] **Step 2:** `GoalInput.tsx` — a text input + Run button → `useSubmitGoal`, storing the returned `runId`.
- [ ] **Step 3:** `PlanReview.tsx` — render the returned plan's nodes (agent, task, `needs`), allow inline edit of `task` text and node removal, with **Approve / Cancel** buttons → `useApprovePlan({ runId, nodes })`.
- [ ] **Step 4:** `DagView.tsx` — render nodes grouped by status (`pending / running / done / failed / skipped`) with a status dot; drive from `useWatchRun(runId)`. Show a **Retry** button on `failed` nodes → `retryNode`.
- [ ] **Step 5:** `ResultsPanel.tsx` — list each done node's `result` pointer; show the run `summary` when terminal.
- [ ] **Step 6:** `page.tsx` — compose the four; register the route in the dashboard nav the same way Mission Control is registered.
- [ ] **Step 7:** Typecheck + launch.

Run: `cd apps/desktop && npm run typecheck`
Expected: 0 errors. Then launch the app (`/run` skill or the repo's dev command) and confirm the Run Board renders, accepts a goal, and shows a (stub) plan.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/routes/_authenticated/_dashboard/run-board apps/desktop/src/renderer/screens/main/components/RunBoard apps/desktop/src/renderer/react-query/orchestrator
git commit -m "feat(orchestrator): Run Board screen (goal → plan review → live DAG → results)"
```

---

## Task 10: Conductor seed-brain + capability manifests

**Files:**
- Create: `assets/seed-brains/conductor/README.md`, `assets/seed-brains/conductor/brain/{persona.txt,mcp.json,context/CLAUDE.md,skills/conduct/SKILL.md}`, `assets/seed-brains/conductor/capabilities.yaml`
- Create: `assets/seed-brains/<slug>/capabilities.yaml` for each existing agent (foreman-listings, shopify-store-cockpit, sm-manager, clip-scout, script-writer, repurposer, rubypulse-laser, kalshi-tessa, codehq-portfolio, daily-planner).
- Reference: an existing seed-brain (`assets/seed-brains/sm-manager/brain/`) for structure; the `handoff` SKILL.md for the queue contract.

**Steps** (authored content — verified by the dry-run planning check + live-verify):

- [ ] **Step 1:** Write `conduct/SKILL.md` — the Conductor's planning procedure: read the goal + the injected roster, produce a run manifest at `2. Areas/Orchestrator/runs/<run_id>.md` with `status: awaiting-approval`, one node per required agent, `task` per node, leaving `needs` for the engine to wire (or wiring them from the roster's `emits→needs`). Explicitly: **plan only — do NOT dispatch or poll; the engine runs the loop.** Include a worked example (the Father's Day DAG).
- [ ] **Step 2:** Write `persona.txt` (a terse conductor identity), `context/CLAUDE.md` (points at the roster + run dir), `mcp.json` (`{ "mcpServers": {} }`).
- [ ] **Step 3:** Write `conductor/capabilities.yaml` (`team: Orchestration`, `agent: conductor`, `handles: [decompose goals into a team plan]`, `emits: []`, `needs: []`).
- [ ] **Step 4:** For each existing agent, write `capabilities.yaml` from its real persona/skills — `handles` (its actual jobs), `needs`/`emits` from a **small shared vocabulary** (define the vocab list in `conductor/context/CLAUDE.md`: e.g. `product-facts, angle, mockups, collection, drafted-posts, listing, clip-verdict, ...`). Keep each manifest to real capabilities only.
- [ ] **Step 5: Dry-run planning test.** Add `apps/desktop/src/main/lib/orchestrator/plan-dryrun.test.ts` that loads the real roster (`loadRosterFrom("assets/seed-brains")` resolved from repo root), builds a hand-written 3-node plan (`foreman → store → sm`), runs `wireDependencies` + `detectCycle`, and asserts the edges match and there's no cycle. This proves the manifests wire into a sane DAG without invoking an LLM.

```ts
// plan-dryrun.test.ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadRosterFrom } from "./capabilities";
import { wireDependencies, detectCycle } from "./dag";

test("real roster wires the Father's Day plan into an acyclic chain", () => {
	const roster = loadRosterFrom(join(import.meta.dir, "../../../../../..", "assets", "seed-brains"));
	const node = (id: string, agent: string) => ({ id, agent, task: id, needs: [], status: "pending" as const, handoff_id: null, result: null });
	const wired = wireDependencies(
		[node("n1", "foreman-listings"), node("n2", "shopify-store-cockpit"), node("n3", "sm-manager")],
		roster,
	);
	expect(detectCycle(wired)).toBeNull();
	// store depends on foreman, sm depends on store (via emits→needs vocab):
	expect(wired.find((n) => n.id === "n2")!.needs).toContain("n1");
	expect(wired.find((n) => n.id === "n3")!.needs).toContain("n2");
});
```

Run: `cd apps/desktop && bun test src/main/lib/orchestrator/plan-dryrun.test.ts`
Expected: PASS (adjust the `needs`/`emits` vocab in the manifests until the wiring asserts hold — this is the point of the test).

- [ ] **Step 6: Commit**

```bash
git add assets/seed-brains/conductor assets/seed-brains/*/capabilities.yaml apps/desktop/src/main/lib/orchestrator/plan-dryrun.test.ts
git commit -m "feat(orchestrator): Conductor seed-brain + capability manifests + dry-run wiring test"
```

---

## Task 11: End-to-end live-verify (2-node goal)

**Files:** none (manual verification + a short results note).

**Steps:**

- [ ] **Step 1:** Ensure at least two real seeded agents exist whose manifests chain (e.g. `foreman-listings` emits `mockups`, `shopify-store-cockpit` needs `mockups`). If not seeded, seed them via the app's normal flow.
- [ ] **Step 2:** Launch the installed/dev app, open the Run Board, submit a small real goal that touches exactly those two teams (e.g. "stage a 2-item test collection from a fresh mockup").
- [ ] **Step 3:** Confirm the Conductor writes a plan (`awaiting-approval`) that appears in the Run Board; approve it.
- [ ] **Step 4:** Watch: node 1 dispatches (a pane opens, agent processes its inbox, flips its handoff to `done` with a `result`), node 2 unlocks, dispatches, completes. Manifest reaches `done`.
- [ ] **Step 5:** Verify durability: kill and relaunch the app mid-run — the run manifest + queue state persist and the Run Board reflects the correct state on reopen.
- [ ] **Step 6:** Verify the failure path: submit a goal where one agent will reject its handoff; confirm dependents go `skipped`, run ends `partial`, and Retry re-dispatches just that node.
- [ ] **Step 7:** Full suite + typecheck: `cd apps/desktop && bun test src/main/lib/orchestrator && npm run typecheck`. Expected: all orchestrator tests PASS, typecheck 0.
- [ ] **Step 8:** Update `STATUS.md` (via `/wrap`) with the shipped orchestrator v1 and any live-verify caveats.

---

## Self-Review

**Spec coverage:**
- Goal dispatcher / decompose → dispatch → assemble → Tasks 7, 8, 10. ✔
- Plan-approval-up-front gate → Task 8 (`submitGoal` returns `awaiting-approval`; `approvePlan`) + Task 9 (`PlanReview`). ✔
- Conductor plans against declarative capability registry → Tasks 4, 10. ✔
- DAG (emits→needs wiring, parallel-where-independent) → Task 2 (`wireDependencies`, `readySet`) + Task 7. ✔
- Completion via handoff-queue contract (dispatch note + status/result, spawn to trigger) → Tasks 5, 6, 7. ✔
- Handoff `run_id`/`result` extension + back-compat → Task 5 (explicit back-compat test). ✔
- Run manifest as durable vault state → Task 3. ✔
- In-app Run Board → Task 9. ✔
- `orchestrator` tRPC router (submitGoal/approvePlan/watchRun observable/cancelRun) → Task 8. ✔
- Failure model (skip-dependents / partial / retry-node, no auto-retry) → Task 2 (`applyFailureSkips`), Task 7 (timeout→fail→skip, `finalize` partial), Task 9 (Retry button). ✔
- Per-node timeout + cancel + idempotent dedup → Task 7 (timeout), Task 8 (`cancelRun`), Task 5 (dedup). ✔
- Testing strategy (unit DAG/manifest/back-compat, dry-run planning, seam integration, manual live-verify) → Tasks 2,3,5 (unit), 10 (dry-run), 8 (runner seam integration), 11 (manual). ✔

**Placeholder scan:** UI (Task 9) and authored-content (Task 10) steps are intentionally guidance-level (not unit-TDD'able), but each names exact files, the tRPC procedures they call, and a concrete verification. The `submitGoal` body in Task 8 is described procedurally with the surrounding real code and a Design note — its Conductor-spawn wiring is the one genuine integration seam, verified in Task 11. No `TBD`/`TODO`/"handle edge cases" left.

**Type consistency:** `RunManifest`/`RunNode`/`NodeStatus`/`RunStatus` (Task 1) are used verbatim through Tasks 2–9. `EngineDeps` (Task 7) is consumed by `runToCompletion` (Task 8) with the same shape plus `timeoutMs`/`tick`. `dispatchAgent` deps (Task 6) match the `realDispatchDeps` assembled in Task 8. `readHandoffStatus` return shape (`{status, result}`) matches `EngineDeps.pollStatus`. Consistent.

**Known seams to confirm during execution (not gaps):**
1. Exact agents-registry query for slug→agentId (`resolveSlug`) — locate in the workspaces router / local-db before Task 8.
2. Whether `buildAgentLaunchCommand` output accepts a trailing initial-prompt arg or needs `-p`/print-mode — confirm against `agent-launch.ts` + the claude CLI when wiring Task 8/Task 6 real deps.
3. `VAULT_ROOT` constant location (env `BRAYNEE_VAULT` is set in global settings; the app likely already exposes the vault path) — reuse the existing accessor rather than hardcoding.
