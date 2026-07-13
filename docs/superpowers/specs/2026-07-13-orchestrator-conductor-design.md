# RyanOS Orchestrator ("Conductor") — Design

- **Date:** 2026-07-13
- **Repo:** damon-ade (RyanOS)
- **Status:** approved (brainstorm), pending implementation plan
- **Author:** Ryan + Claude (brainstorming session)

## Summary

*A Conductor agent turns one natural-language goal into an approved dependency-graph
of handoffs, dispatches them across the existing RyanOS team agents, and a Run Board
screen watches the vault as the source of truth.*

The orchestrator is a **goal dispatcher**: you give one objective (e.g. "Father's Day
push across store + social"), a Conductor agent decomposes it into per-team subtasks
with dependencies, you approve/edit the plan, and it dispatches the work across your
teams, collecting each result to feed the next dependent step.

It is **orchestration glue over primitives RyanOS already ships** — not a new runtime.
It reuses `startAgentSession` (spawning agents into panes), the vault handoff queue
(dispatch + durable results), and tRPC (UI ↔ main).

## Decisions (locked during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Core job | **Goal dispatcher** | One objective → decompose → dispatch → assemble. Most capable; primitives support it. |
| Human gate | **Plan-approval up front** (approve / edit / cancel) | Catches bad decomposition before any agent burns work. Each agent's own output gate still applies. |
| Planner | **Conductor** agent (own seed-brain) | A dedicated brain that knows the roster and plans. |
| Capability model | **Declarative capability registry** (`capabilities.yaml` per agent) | Grounded, predictable, testable decomposition — no hallucinated routing. |
| Execution | **Dependency graph (DAG)** — parallel where independent, gated where dependent | Auto-wired from `emits → needs`. |
| Completion + results | **Handoff queue as the contract** | Reuses the durable bus + status contract; survives app restart; no terminal-scraping. |
| Surface (v1) | **In-app "Run Board" screen** | The interactive plan-edit gate needs a real UI; cron/Telegram is a fast-follow. |
| Failure model | **Skip-dependents / partial run / retry-node; no auto-retry** | A failing team doesn't sink unrelated branches; no half-baked work flows downstream. |

## Architecture

The **Conductor** agent plans and drives; the **Run Board** screen is the human
surface; the **vault** holds all durable state (plan, node statuses, results). The UI
never holds the source of truth — it reflects vault state, so a run survives an app
restart or a closed tab.

### Components

1. **Capability registry** — a `capabilities.yaml` in each agent's seed-brain, plus a
   loader that aggregates them into one roster the Conductor reads. Authoring manifests
   for the existing agents is part of this build.
2. **Conductor agent** — a new seed-brain with a `conduct` skill: read goal + roster →
   emit a plan (DAG), auto-wiring dependencies by matching `emits → needs` → on
   approval, execute the run loop (dispatch ready nodes, poll to `done`, collect,
   unlock dependents) → assemble.
3. **Run manifest** — one durable file per run in
   `2. Areas/Orchestrator/runs/<run_id>.md`: the goal, the DAG, per-node status, and
   result pointers. This *is* the run state.
4. **Run Board screen** — a new RyanOS route: goal input → plan review/edit/approve →
   live DAG view → results. Watches the run manifest + queue; drives nothing itself.
5. **Orchestrator tRPC router** — `submitGoal` (spawn Conductor, return plan),
   `approvePlan`, `watchRun` (subscription over a file-watch — an **observable**, per
   the trpc-electron constraint in `apps/desktop/AGENTS.md`), `cancelRun`.

Reused as-is: `startAgentSession` (the `useCommandWatcher` command bus), the handoff
queue + `handoff` skill, tRPC.

## Data model

Three schemas. The handoff note is *already* the dispatch+result contract; it is
**extended, not replaced**, so hand-run agents outside an orchestrated run keep working
exactly as today.

### a) Capability manifest — `assets/seed-brains/<agent>/capabilities.yaml`

```yaml
team: Social Media
agent: sm-manager          # seed-brain slug == handoff recipient-slug
handles:                   # human-readable capabilities (Conductor plans against these)
  - draft brand-voiced posts (HLD | personal)
  - schedule approved posts (Blotato)
needs:  [product-facts, angle]      # dependency keys — matched against others' `emits`
emits:  [drafted-posts]             # what completing this produces
gate:   publish-approval            # the agent's own downstream gate (informational)
```

`needs` / `emits` draw from a **controlled vocabulary** (a flat, documented key list) so
DAG wiring is exact-match, not fuzzy.

### b) Run manifest — `2. Areas/Orchestrator/runs/<run_id>.md`

```yaml
run_id: 2026-07-13-fathers-day-push
goal: "Father's Day push across store + social"
status: planning | awaiting-approval | running | done | partial | cancelled
created: 2026-07-13
nodes:
  - id: n1
    agent: foreman
    task: "build 3 Father's Day listing mockups"
    needs: []              # DAG edges (node ids)
    status: pending | running | done | failed | skipped
    handoff_id: 2026-07-13-fd-mockups-foreman   # links to the queue note
    result: null           # pointer/summary filled on done
```

### c) Handoff extension

The existing contract gains two **optional** fields the orchestrator sets/reads:

- `run_id` — back-link to the run manifest.
- `result` — the `emits` payload/pointer the receiver writes on `done`.

Everything else — `status` (`pending→drafted→done|rejected`), dedup by `handoff_id`,
receive-side re-verification — is unchanged. A note without `run_id` must still parse
(back-compat).

### Data flow

Conductor writes a node → derives a handoff note (`pending`, carrying `run_id`) →
spawns the agent to process its inbox now → agent processes, writes `result` + flips
`done` → Conductor copies `result` into the manifest node and flips dependents from
blocked to `pending`.

## Execution flow

After you approve the plan, the Conductor runs:

1. **Ready set** = nodes whose `needs` are all `done`. Dispatch the *entire* ready set
   at once — this is where parallelism comes from (independent teams run concurrently,
   each in its own pane via `startAgentSession`).
2. **Dispatch a node:** write its handoff note (`pending`, with `run_id`), spawn the
   target agent told to process its inbox now, set node `running`.
3. **Poll** each running node's handoff note for a status flip (a lightweight file-watch
   on the queue, not busy-waiting). On `done`: copy `result` into the node, mark `done`,
   recompute the ready set. Loop until no nodes remain runnable.
4. **Assemble:** when all reachable nodes are terminal, write a run summary (each node's
   result pointer) and set the run `done` / `partial`.

### Guardrails

- **Per-node timeout** — default 15 min (configurable). A node not `done` in time is
  marked `failed`, so a stuck/closed agent can't hang the run.
- **Cancel** — `cancelRun` sets run `cancelled`; the Conductor stops dispatching.
  In-flight agents finish their current turn (panes are not killed mid-write).
- **Idempotent** — dedup by `handoff_id` prevents double-dispatch; re-running the same
  goal reuses the run manifest rather than duplicating work.

### Failure model

When a node `fails` (agent errors, times out, or flips the handoff to `rejected`):

- Its **downstream dependents are `skipped`** (their inputs never arrived).
- **Independent branches keep running** — one team failing doesn't sink unrelated work.
- Run ends **`partial`**; the Run Board shows the failed node with a **Retry-node**
  button (re-dispatches just that node and its skipped dependents). **No auto-retry.**

## Scope

### In scope (v1)

- Capability registry format + loader; author manifests for the existing agents.
- Conductor seed-brain + `conduct` skill (plan → DAG → execute → assemble).
- Run manifest read/write in the vault; handoff `run_id` / `result` extension.
- Run Board screen: goal input → plan review/**edit**/approve → live DAG + results.
- `orchestrator` tRPC router (`submitGoal`, `approvePlan`, `watchRun`, `cancelRun`).
- Failure model: skip-dependents / partial / retry-node.

### Deferred (YAGNI)

- Cron/Telegram triggering and Telegram plan-approval → fast-follow once the in-app
  loop is proven.
- Auto-retry / smart re-planning on failure.
- Multi-goal concurrency (v1 runs one goal at a time).
- Cost/token budgeting per run.

## Testing strategy

- **Unit (bun test):** DAG builder (`emits→needs` wiring, cycle detection), ready-set
  computation, failure→skip propagation, manifest read/write round-trip, handoff
  extension back-compat (a note without `run_id` still parses).
- **Conductor skill:** a dry-run planning test — given a fixed roster + goal, assert a
  sane DAG (right agents, right edges) without dispatching.
- **Integration (seam-level):** a fake agent that flips its handoff to `done` with a
  canned `result`, driving one full run loop (dispatch → poll → collect → assemble)
  against the real queue code — no live LLM agents needed.
- **Manual live-verify:** one real 2-node goal (e.g. Foreman → SM) end-to-end, matching
  how every prior RyanOS phase was verified.

## Open questions for the plan

- Exact controlled vocabulary for `needs` / `emits` keys (seed it from the current
  agents' real inputs/outputs; keep it small and documented).
- Where the Conductor session physically runs (dedicated pane vs headless-emulator) and
  how the Run Board hands it the goal + receives the plan back over tRPC.
- Whether the Run Board parses the markdown-frontmatter manifest directly or the loader
  exposes it as a typed object over tRPC (the manifest format itself is decided:
  markdown+frontmatter, per the data model — this is only about the read path).
