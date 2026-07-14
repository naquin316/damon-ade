import { spawn as spawnProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, openSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { workspaces } from "@superset/local-db";
import { observable } from "@trpc/server/observable";
import { eq, isNotNull } from "drizzle-orm";
import { buildAgentLaunchCommand } from "main/lib/agent-launch";
import { resolveAgentWorktreePath } from "main/lib/agent-worktree";
import { getSupersetHomeDir } from "main/lib/app-environment";
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
import { handoffInbox, runPath, runsDir } from "main/lib/orchestrator/paths";
import { runToCompletion } from "main/lib/orchestrator/runner";
import { vaultRoot } from "main/lib/orchestrator/vault";
import { slugForAgent } from "main/lib/seed-brains";
import {
	type OrchestratorEvent,
	type RunManifest,
	type RunNode,
	runNodeSchema,
} from "shared/orchestrator/types";
import { z } from "zod";
import { publicProcedure, router } from "..";

// Poll interval for submitGoal's background wait on the Conductor's plan.
const PLAN_POLL_MS = 2000;
// A headless `claude -p` plan should land well under this.
const PLAN_TIMEOUT_MS = 3 * 60 * 1000;
// Runner loop tick interval + per-node dispatch timeout for a live run.
const TICK_INTERVAL_MS = 3000;
const NODE_TIMEOUT_MS = 15 * 60 * 1000;
// Cap on simultaneously "running" headless agent sessions. Heavy Opus-1M
// `claude -p` panes starve the Claude API / machine if every ready node in a
// wave launches at once (most then hang 20+ min and time out); dispatching a
// bounded number at a time keeps them responsive.
const ORCH_MAX_CONCURRENT = 3;
/**
 * A "running" manifest older than this is treated as ABANDONED, not resumable.
 * The run loop rewrites the manifest on every tick (TICK_INTERVAL_MS), so its
 * mtime is an exact liveness signal: a gap larger than a full node timeout
 * means nothing has driven this run for longer than any node is allowed to
 * live, i.e. the app wasn't briefly restarted — the run was walked away from.
 * Resuming those re-dispatches agents for work the user abandoned hours ago;
 * they stay put for an explicit retry/cancel from the Run Board instead.
 */
const RECOVERY_STALE_AFTER_MS = NODE_TIMEOUT_MS;

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
 * Resolve the cwd an agent's headless process should run in: its real
 * worktree (mirrors agent-memory-backfill.ts), falling back to the vault
 * root if the workspace row or worktree can't be resolved.
 */
function resolveAgentCwd(agentId: string): string {
	const row = localDb
		.select()
		.from(workspaces)
		.where(eq(workspaces.id, agentId))
		.get();
	const worktree = resolveAgentWorktreePath(agentId, row?.worktreeId);
	return worktree || vaultRoot();
}

/** Directory headless agent panes' stdout/stderr are logged to, so a stuck
 *  9-panes-at-once agent (or a capped wave of them) is debuggable instead of
 *  silently swallowed by `stdio: "ignore"`. */
function orchestratorLogDir(): string {
	return join(getSupersetHomeDir(), "orchestrator-logs");
}

/** Turn a dispatch label into a filesystem-safe log file basename. */
function sanitizeLogLabel(label: string): string {
	return label.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/**
 * Spawn the agent's launch command as a headless, detached child process
 * (non-interactive `claude -p ...`) — mirrors the detached-spawn pattern in
 * self-update.ts. Best-effort: never throws out of the Spawner.
 *
 * stdout/stderr are appended to a per-label log file under
 * `<ADE home>/orchestrator-logs/` rather than discarded, so a stuck agent
 * (e.g. hung under concurrency starvation) can be inspected after the fact.
 * If the log file can't be opened for any reason, falls back to
 * `stdio: "ignore"` -- logging must never break the spawn.
 */
const spawnHeadless: Spawner = ({ agentId, command, label }) => {
	try {
		const cwd = resolveAgentCwd(agentId);
		let stdio: "ignore" | [ "ignore", number, number ] = "ignore";
		try {
			const logDir = orchestratorLogDir();
			mkdirSync(logDir, { recursive: true });
			const logPath = join(logDir, `${sanitizeLogLabel(label)}.log`);
			const fd = openSync(logPath, "a");
			stdio = ["ignore", fd, fd];
		} catch (logError) {
			console.error(`[orchestrator] failed to open log file for ${label}:`, logError);
		}
		const child = spawnProcess(command, {
			shell: true,
			cwd,
			detached: true,
			stdio,
		});
		child.unref();
	} catch (error) {
		console.error(`[orchestrator] spawn failed for ${label}:`, error);
	}
};

const realDispatchDeps = {
	resolveSlug,
	spawn: spawnHeadless,
	// Append -p so dispatchAgent's appended `JSON.stringify(instruction)`
	// becomes the print-mode prompt: `... -p "<instruction>"`.
	buildCommand: (agentId: string) =>
		`${buildAgentLaunchCommand(agentId, "claude")[0]} -p`,
};

/** Sentinel thrown by `pollForPlan` when the run is cancelled mid-poll, so
 *  callers can distinguish "cancelled" from "timed out" without inspecting
 *  message strings. */
class PollCancelledError extends Error {}

async function pollForPlan(
	runId: string,
	timeoutMs: number,
): Promise<RunManifest> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (cancelledRuns.has(runId)) throw new PollCancelledError(runId);
		const manifest = readManifest(vaultRoot(), runId);
		if (manifest && manifest.status === "awaiting-approval") return manifest;
		await sleep(PLAN_POLL_MS);
	}
	throw new Error(
		`Timed out waiting for the Conductor to write a plan for run ${runId}`,
	);
}

/**
 * Background task kicked off by `submitGoal` (NOT awaited by the mutation):
 * poll for the Conductor's plan, wire dependencies + check for cycles, then
 * persist + broadcast the result. Bails early (no manifest write — `cancelRun`
 * already wrote "cancelled") if the run is cancelled mid-poll.
 */
async function awaitPlanInBackground(
	runId: string,
	roster: ReturnType<typeof loadRoster>,
): Promise<void> {
	try {
		const plan = await pollForPlan(runId, PLAN_TIMEOUT_MS);
		if (cancelledRuns.has(runId)) return;
		const wired: RunManifest = {
			...plan,
			nodes: wireDependencies(plan.nodes, roster),
		};
		const cycle = detectCycle(wired.nodes);
		if (cycle) {
			const failed: RunManifest = {
				...wired,
				status: "failed",
			};
			writeManifest(vaultRoot(), failed);
			emit({ type: "run-updated", run: failed });
			emit({
				type: "run-error",
				runId,
				message: `Conductor produced a cyclic plan: ${cycle.join(" -> ")}`,
			});
			return;
		}
		writeManifest(vaultRoot(), wired);
		emit({ type: "run-updated", run: wired });
	} catch (error) {
		if (error instanceof PollCancelledError) return;
		const message = error instanceof Error ? error.message : String(error);
		const current = readManifest(vaultRoot(), runId);
		if (current) {
			const failed: RunManifest = {
				...current,
				status: "failed",
			};
			writeManifest(vaultRoot(), failed);
			emit({ type: "run-updated", run: failed });
		}
		emit({ type: "run-error", runId, message });
	}
}

/**
 * Render a ready node's already-"done" dependencies into the `## Facts` block of
 * its dispatch note. This is the result-passing pipe: wiring `needs` edges only
 * buys ORDERING — without this, a downstream agent never sees what upstream
 * produced and silently re-derives it from live sources (or invents it).
 * Returns undefined for a root node so `writeDispatchNote` omits the section.
 */
function upstreamFacts(upstream: RunNode[]): string | undefined {
	if (upstream.length === 0) return undefined;
	return upstream
		.map(
			(u) =>
				`### From ${u.agent} (${u.id})\n${u.result ?? "(completed, but recorded no result)"}`,
		)
		.join("\n\n");
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
		dispatch: (n, upstream) => {
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
				facts: upstreamFacts(upstream),
				created: new Date().toISOString().slice(0, 10),
			});
			// Be EXPLICIT: agents otherwise read their OWN domain inbox
			// (agent_messages table, customer channels, Run Log…) and never touch
			// the orchestrator handoff note, so it stays `pending` → times out →
			// the node fails. Name the exact file and forbid the normal routine.
			//
			// The instruction is deliberately TASK-NEUTRAL: how much action a node
			// may take belongs in its `## Task` text (a smoke-test plan says
			// "read-only check"; a real plan says "draft the posts"), never
			// hardcoded here — that would cap every run at read-only forever.
			const notePath = join(
				handoffInbox(vaultRoot(), n.agent),
				`${handoffId}.md`,
			);
			return dispatchAgent(
				realDispatchDeps,
				n.agent,
				[
					`You have ONE orchestrator dispatch note at this exact path: ${notePath}`,
					`Read that file. Do EXACTLY the task in its "## Task" section and nothing else — no more, no less. Honour any limits the task states (e.g. if it says read-only, take no real action).`,
					`If the note has a "## Facts" section, that is the OUTPUT of the agents upstream of you in this run. Treat it as your input and build on it — do not re-derive or re-invent it from live sources.`,
					`Then edit that SAME file's YAML frontmatter: add a one-line \`result:\` value summarizing what you produced — a vault path, URL, or one-line summary that the NEXT agent can act on (never a secret; name the env var / 1Password location instead) — and change \`status: pending\` to \`status: done\`.`,
					`Do NOT check any other inbox, queue, message table, or channel. Do NOT run your normal routine. You are finished the moment that note reads \`status: done\` with a \`result\`.`,
				].join("\n"),
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
		maxConcurrent: ORCH_MAX_CONCURRENT,
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

/**
 * Re-enter the run loop for every manifest still marked "running" by a previous
 * process (crash, force-quit, reload). The manifest is ALREADY the durable
 * source of truth — node statuses, handoff_ids and results all survive on disk —
 * so recovery needs no new state, only a trigger. Safe by construction:
 *  - `startRunLoop` refuses a second loop for a run already in `activeRuns`;
 *  - `writeDispatchNote` dedups, so an already-dispatched node is never
 *    re-spawned;
 *  - `pollStatus` reads the EXISTING note, so a node that finished while we were
 *    down is collected as "done" on the very first tick;
 *  - agents are spawned detached + unref'd, so they outlive an app crash and go
 *    on writing their notes; anything genuinely orphaned simply restarts its
 *    pickup-timeout clock (`dispatchedAt` starts empty) and can be retried.
 * Best-effort: one unreadable manifest must never block recovering the rest.
 */
export function recoverInFlightRuns(): void {
	const dir = runsDir(vaultRoot());
	if (!existsSync(dir)) return;
	let recovered = 0;
	let abandoned = 0;
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".md")) continue;
		try {
			const runId = file.slice(0, -".md".length);
			const run = readManifest(vaultRoot(), runId);
			if (!run || run.status !== "running" || activeRuns.has(run.run_id)) {
				continue;
			}
			// Liveness gate: see RECOVERY_STALE_AFTER_MS. Only a run the loop was
			// actively ticking when we went down is resumable.
			const age = Date.now() - statSync(runPath(vaultRoot(), runId)).mtimeMs;
			if (age > RECOVERY_STALE_AFTER_MS) {
				abandoned++;
				continue;
			}
			startRunLoop(run);
			recovered++;
		} catch (error) {
			console.error(
				`[orchestrator] failed to recover run from ${file}:`,
				error,
			);
		}
	}
	if (recovered > 0) {
		console.log(`[orchestrator] recovered ${recovered} in-flight run(s)`);
	}
	if (abandoned > 0) {
		console.log(
			`[orchestrator] left ${abandoned} stale "running" run(s) alone (older than ${RECOVERY_STALE_AFTER_MS / 60_000}min — retry/cancel them from the Run Board)`,
		);
	}
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
		 * asks an LLM to run the loop — this is plan authoring only.
		 *
		 * Non-blocking: this mutation returns the "planning" manifest as soon as
		 * it's written and the Conductor is dispatched. The actual wait for the
		 * plan happens in `awaitPlanInBackground`, which is NOT awaited here —
		 * progress streams to the client over `watchRun` instead. This keeps the
		 * UI responsive (no multi-minute-blocked mutation) and gives the user a
		 * Cancel escape while planning is in flight.
		 */
		submitGoal: publicProcedure
			.input(z.object({ goal: z.string() }))
			.mutation(async ({ input }) => {
				const runId = `run-${randomUUID()}`;
				const roster = loadRoster();

				const planning: RunManifest = {
					run_id: runId,
					goal: input.goal,
					status: "planning",
					created: new Date().toISOString().slice(0, 10),
					nodes: [],
					summary: null,
				};
				writeManifest(vaultRoot(), planning);
				emit({ type: "run-updated", run: planning });

				const instruction = [
					`Goal: ${input.goal}`,
					"",
					`Write the plan to ${runPath(vaultRoot(), runId)} with run_id: "${runId}" and status: awaiting-approval.`,
					"Plan only — do not dispatch.",
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

				// Fire-and-forget: do NOT await. Errors surface via the "run-error"
				// event over watchRun, not via this mutation.
				void awaitPlanInBackground(runId, roster);

				return planning;
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
