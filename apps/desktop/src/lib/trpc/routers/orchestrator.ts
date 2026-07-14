import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { workspaces } from "@superset/local-db";
import { observable } from "@trpc/server/observable";
import { isNotNull } from "drizzle-orm";
import { buildAgentLaunchCommand } from "main/lib/agent-launch";
import { localDb } from "main/lib/local-db";
import { loadRoster } from "main/lib/orchestrator/capabilities";
import { detectCycle, wireDependencies } from "main/lib/orchestrator/dag";
import {
	dispatchAgent,
	type SlugResolver,
	type Spawner,
} from "main/lib/orchestrator/dispatch";
import {
	clearDispatchNote,
	readHandoffStatus,
	writeDispatchNote,
} from "main/lib/orchestrator/handoff";
import { readManifest, writeManifest } from "main/lib/orchestrator/manifest";
import { runsDir } from "main/lib/orchestrator/paths";
import { runToCompletion } from "main/lib/orchestrator/runner";
import { vaultRoot } from "main/lib/orchestrator/vault";
import { slugForAgent } from "main/lib/seed-brains";
import { getWorkspaceRuntimeRegistry } from "main/lib/workspace-runtime";
import {
	type OrchestratorEvent,
	type RunManifest,
	type RunNode,
	runNodeSchema,
} from "shared/orchestrator/types";
import { z } from "zod";
import { publicProcedure, router } from "..";

// Poll interval for submitGoal's bounded wait on the Conductor's plan.
const PLAN_POLL_MS = 2000;
const SUBMIT_GOAL_TIMEOUT_MS = 5 * 60 * 1000;
// Runner loop tick interval + per-node dispatch timeout for a live run.
const TICK_INTERVAL_MS = 3000;
const NODE_TIMEOUT_MS = 15 * 60 * 1000;

const bus = new EventEmitter();
const emit = (e: OrchestratorEvent) => bus.emit("event", e);
const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/** run_ids currently mid-cancel; consulted by the in-flight loop's `tick`. */
const cancelledRuns = new Set<string>();

/**
 * run_ids with a `runToCompletion` loop currently in flight. Guards against
 * `approvePlan`/`retryNode` starting a second loop for the same run (e.g. a
 * double-click or a retry race), which would spawn duplicate agent panes and
 * have two loops writing/clobbering the same manifest concurrently.
 */
const activeRuns = new Set<string>();

/**
 * slug (seed-brain slug, e.g. "foreman-listings") -> workspace/agent id.
 * Re-queried per call rather than cached — the roster of agent workspaces
 * can change between dispatches within a long-running orchestration.
 */
const resolveSlug: SlugResolver = (slug) => {
	const rows = localDb
		.select()
		.from(workspaces)
		.where(isNotNull(workspaces.runtime))
		.all();
	return rows.find((r) => r.name && slugForAgent(r.name) === slug)?.id ?? null;
};

/**
 * Open a pane for the agent and type its launch command into it.
 *
 * SEAM (Task 11 live-verify): `createOrAttach` is designed for a UI-owned
 * pane (paneId/tabId normally come from a renderer tab). Here we synthesize
 * both since the orchestrator dispatches headlessly from the main process.
 * This is the smallest correct call against the real
 * `getWorkspaceRuntimeRegistry().getDefault().terminal` surface — confirm
 * against a live agent dispatch once the Conductor seed-brain exists
 * (Task 10) that a synthetic paneId/tabId with no owning renderer tab
 * behaves (daemon accepts it, output is inspectable/killable from the UI).
 */
const spawnInPane: Spawner = ({ agentId, command, label }) => {
	const runtime = getWorkspaceRuntimeRegistry().getDefault();
	const paneId = `orchestrator-${label}-${randomUUID()}`;
	void runtime.terminal
		.createOrAttach({
			paneId,
			tabId: paneId,
			workspaceId: agentId,
			runtime: "claude",
		})
		.then(() =>
			runtime.terminal.write({
				paneId,
				data: command.endsWith("\n") ? command : `${command}\n`,
			}),
		)
		.catch((error) => {
			console.error(`[orchestrator] spawn failed for ${label}:`, error);
		});
};

const realDispatchDeps = {
	resolveSlug,
	spawn: spawnInPane,
	buildCommand: (agentId: string) =>
		buildAgentLaunchCommand(agentId, "claude")[0],
};

async function pollForPlan(
	runId: string,
	timeoutMs: number,
): Promise<RunManifest> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const manifest = readManifest(vaultRoot(), runId);
		if (manifest && manifest.status === "awaiting-approval") return manifest;
		await sleep(PLAN_POLL_MS);
	}
	throw new Error(
		`Timed out waiting for the Conductor to write a plan for run ${runId}`,
	);
}

/** Drive `run` to completion via the runner loop, persisting + broadcasting
 *  every update. Fire-and-forget from the caller's perspective (mutations
 *  return immediately; progress streams over `watchRun`). */
function startRunLoop(run: RunManifest): void {
	const runId = run.run_id;
	if (activeRuns.has(runId)) {
		console.warn(
			`[orchestrator] run ${runId} already has a loop in flight; refusing to start a second one`,
		);
		return;
	}
	activeRuns.add(runId);
	cancelledRuns.delete(runId);
	void runToCompletion(run, {
		dispatch: (n) => {
			// stepRun (engine.ts) always sets handoff_id on the node it hands to
			// `dispatch`, using this same fallback formula; re-derive it rather
			// than asserting non-null so this closure stays safe if ever called
			// directly.
			const handoffId = n.handoff_id ?? `${runId}-${n.id}`;
			writeDispatchNote(vaultRoot(), {
				slug: n.agent,
				handoffId,
				runId,
				task: n.task,
			});
			return dispatchAgent(
				realDispatchDeps,
				n.agent,
				`Process your inbox for run ${runId} now.`,
			);
		},
		pollStatus: (n) =>
			n.handoff_id
				? readHandoffStatus(vaultRoot(), n.agent, n.handoff_id)
				: null,
		now: () => Date.now(),
		onUpdate: (r) => {
			writeManifest(vaultRoot(), r);
			emit({ type: "run-updated", run: r });
		},
		timeoutMs: NODE_TIMEOUT_MS,
		shouldCancel: () => cancelledRuns.has(runId),
		tick: async () => {
			await sleep(TICK_INTERVAL_MS);
		},
	})
		.then(() => {
			if (!cancelledRuns.has(runId)) return;
			// The loop broke on `shouldCancel` rather than running to a terminal
			// state. `cancelRun` already wrote a "cancelled" manifest when the
			// flag was set, but a `stepRun` that was already in flight at that
			// moment can still have clobbered it via `onUpdate` before the next
			// iteration's `shouldCancel` check took effect. Re-assert
			// "cancelled" as authoritative now that the loop has fully unwound.
			const current = readManifest(vaultRoot(), runId);
			if (current) {
				const cancelled: RunManifest = { ...current, status: "cancelled" };
				writeManifest(vaultRoot(), cancelled);
				emit({ type: "run-updated", run: cancelled });
			}
			cancelledRuns.delete(runId);
		})
		.catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[orchestrator] run ${runId} loop error:`, message);
			emit({ type: "run-error", runId, message });
		})
		.finally(() => {
			activeRuns.delete(runId);
		});
}

/** Node ids transitively depending on `rootId` via `needs` edges (mirrors the
 *  fixed-point traversal `applyFailureSkips` in dag.ts uses to compute which
 *  nodes to skip on a failure). Used by `retryNode` to find the dependents a
 *  failure previously skipped, so a retry can reset them alongside the node
 *  it targets. */
function transitiveDependents(nodes: RunNode[], rootId: string): Set<string> {
	const dependents = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const n of nodes) {
			if (dependents.has(n.id)) continue;
			if (n.needs.some((d) => d === rootId || dependents.has(d))) {
				dependents.add(n.id);
				changed = true;
			}
		}
	}
	return dependents;
}

export const createOrchestratorRouter = () =>
	router({
		/**
		 * Spawn the Conductor (headless) with the goal + roster, told to WRITE
		 * the plan manifest with status: awaiting-approval. The engine never
		 * asks an LLM to run the loop — this is plan authoring only. The
		 * Conductor seed-brain doesn't exist until Task 10, so this cannot be
		 * live-exercised yet; structure + typecheck only (see task-8-report.md).
		 */
		submitGoal: publicProcedure
			.input(z.object({ goal: z.string() }))
			.mutation(async ({ input }) => {
				const runId = `run-${randomUUID()}`;
				const roster = loadRoster();
				const instruction = [
					`Goal: ${input.goal}`,
					"",
					`Write the run plan to runs/${runId}.md with run_id: "${runId}" and status: awaiting-approval.`,
					"Plan only — do not dispatch any agent yet.",
					"",
					"Roster (capabilities.yaml per agent):",
					JSON.stringify(roster, null, 2),
				].join("\n");

				const dispatched = dispatchAgent(
					realDispatchDeps,
					"conductor",
					instruction,
				);
				if (!dispatched.ok) throw new Error(dispatched.error);

				const plan = await pollForPlan(runId, SUBMIT_GOAL_TIMEOUT_MS);
				const wired: RunManifest = {
					...plan,
					nodes: wireDependencies(plan.nodes, roster),
				};
				const cycle = detectCycle(wired.nodes);
				if (cycle)
					throw new Error(
						`Conductor produced a cyclic plan: ${cycle.join(" -> ")}`,
					);

				writeManifest(vaultRoot(), wired);
				emit({ type: "run-updated", run: wired });
				return wired;
			}),

		approvePlan: publicProcedure
			.input(
				z.object({
					runId: z.string(),
					nodes: z.array(runNodeSchema).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const run = readManifest(vaultRoot(), input.runId);
				if (!run) throw new Error(`unknown run ${input.runId}`);
				const running: RunManifest = {
					...run,
					status: "running",
					...(input.nodes ? { nodes: input.nodes } : {}),
				};
				writeManifest(vaultRoot(), running);
				emit({ type: "run-updated", run: running });
				startRunLoop(running);
				return running;
			}),

		watchRun: publicProcedure
			.input(z.object({ runId: z.string() }))
			.subscription(({ input }) =>
				observable<OrchestratorEvent>((emitObs) => {
					const current = readManifest(vaultRoot(), input.runId);
					if (current) emitObs.next({ type: "run-updated", run: current });
					const onEvent = (event: OrchestratorEvent) => {
						const forThisRun =
							event.type === "run-updated"
								? event.run.run_id === input.runId
								: event.runId === input.runId;
						if (forThisRun) emitObs.next(event);
					};
					bus.on("event", onEvent);
					return () => bus.off("event", onEvent);
				}),
			),

		cancelRun: publicProcedure
			.input(z.object({ runId: z.string() }))
			.mutation(({ input }) => {
				const run = readManifest(vaultRoot(), input.runId);
				if (!run) throw new Error(`unknown run ${input.runId}`);
				cancelledRuns.add(input.runId);
				const cancelled: RunManifest = { ...run, status: "cancelled" };
				writeManifest(vaultRoot(), cancelled);
				emit({ type: "run-updated", run: cancelled });
				return cancelled;
			}),

		listRuns: publicProcedure.query(() => {
			const dir = runsDir(vaultRoot());
			if (!existsSync(dir)) return [];
			return readdirSync(dir)
				.filter((f) => f.endsWith(".md"))
				.map((f) => readManifest(vaultRoot(), f.slice(0, -".md".length)))
				.filter((r): r is RunManifest => r !== null);
		}),

		retryNode: publicProcedure
			.input(z.object({ runId: z.string(), nodeId: z.string() }))
			.mutation(({ input }) => {
				const run = readManifest(vaultRoot(), input.runId);
				if (!run) throw new Error(`unknown run ${input.runId}`);
				const target = run.nodes.find((n) => n.id === input.nodeId);
				if (!target)
					throw new Error(`unknown node ${input.nodeId} in run ${input.runId}`);

				// The engine re-derives the same deterministic handoff_id on
				// redispatch (`${run_id}-${node.id}`), so a stale note left behind
				// by the failed attempt would otherwise dedup-block the fresh
				// dispatch (writeDispatchNote no-ops if a note with that id already
				// exists). Clear it -- and the notes of any dependents this failure
				// previously skipped -- before resetting them to "pending".
				const dependents = transitiveDependents(run.nodes, input.nodeId);
				const resetIds = new Set<string>([input.nodeId]);
				for (const n of run.nodes) {
					if (dependents.has(n.id) && n.status === "skipped") resetIds.add(n.id);
				}
				for (const n of run.nodes) {
					if (resetIds.has(n.id) && n.handoff_id) {
						clearDispatchNote(vaultRoot(), n.agent, n.handoff_id);
					}
				}

				const nodes = run.nodes.map((n) =>
					resetIds.has(n.id)
						? {
								...n,
								status: "pending" as const,
								handoff_id: null,
								result: null,
							}
						: n,
				);
				const retried: RunManifest = { ...run, status: "running", nodes };
				writeManifest(vaultRoot(), retried);
				emit({ type: "run-updated", run: retried });
				startRunLoop(retried);
				return retried;
			}),
	});
