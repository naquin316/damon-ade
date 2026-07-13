---
name: conduct
description: Plan a run manifest from a goal and roster
version: 0.1.0
platforms: [macos]
metadata:
  ade:
    tags: [RyanOS, Orchestrator]
---

# Conduct

Decompose a goal into a run plan for the deterministic orchestrator engine to execute.

## When to Use

- Ryan (or the desktop app) gives the Conductor a goal and the current roster of
  `capabilities.yaml` manifests, and wants a multi-agent plan.

## Procedure

1. **Read the goal + roster.** The roster is injected — the full parsed list of
   `capabilityManifestSchema` entries from every `assets/seed-brains/<slug>/capabilities.yaml`
   (see `context/CLAUDE.md` for the schema and the shared needs/emits vocabulary). Do not
   invent an agent or a capability that isn't in the roster.
2. **Pick the agents the goal actually needs.** For each, add one node:
   `{ id, agent: <slug>, task: <what this agent should do for this goal>, needs: [],
   status: "pending", handoff_id: null, result: null }`. Leave `needs` (node-id edges)
   empty — the engine's `wireDependencies()` fills them by matching each agent's `needs`
   vocab keys against earlier nodes' `emits` keys. You only decide *which agents* and
   *in what order they're listed*; the engine decides the edges.
3. **Order nodes so producers precede consumers** (e.g. a `mockups`/`listing` producer
   before the agent that `needs` them) — `wireDependencies()` picks the first matching
   producer in node order, so ordering matters even though you don't write the edges
   yourself.
4. **Write the run manifest** to `<VAULT>/2. Areas/Orchestrator/runs/<run_id>.md` via
   `runManifestSchema`: `run_id` (deterministic from the goal + date), `goal`, `status:
   awaiting-approval`, `created`, `nodes` (from step 2), `summary: null`.
5. **Stop.** Plan only — do NOT dispatch any node, do NOT poll for completion, do NOT
   call any agent's tools. The deterministic engine (`apps/desktop/src/main/lib/
   orchestrator/engine.ts`) picks up an `awaiting-approval` manifest, wires it, and runs
   the dispatch/poll loop itself once a human approves it.

## Worked example — Father's Day plan

Goal: "Put together a Father's Day push for the store."

Roster picks (from real capabilities, not invented ones):
- `foreman-listings` — creates the new Father's Day engraved-mug listing (mockups +
  copy + publish).
- `shopify-store-cockpit` — stages the new listing into a Father's Day collection/promo
  on the live store.
- `sm-manager` — drafts and queues the announcement posts for Ryan's approval.

```yaml
run_id: 2026-07-13-fathers-day-push
goal: Put together a Father's Day push for the store.
status: awaiting-approval
created: 2026-07-13
nodes:
  - id: n1
    agent: foreman-listings
    task: Draft and publish a Father's Day engraved-mug listing.
    needs: []
    status: pending
    handoff_id: null
    result: null
  - id: n2
    agent: shopify-store-cockpit
    task: Stage the new listing into a Father's Day collection/promo.
    needs: []
    status: pending
    handoff_id: null
    result: null
  - id: n3
    agent: sm-manager
    task: Draft and queue Father's Day announcement posts.
    needs: []
    status: pending
    handoff_id: null
    result: null
summary: null
```

After `wireDependencies()` runs (not this skill — the engine), `n2.needs` picks up
`["n1"]` (foreman-listings emits `listing`/`mockups`/`product-facts`, which
shopify-store-cockpit needs) and `n3.needs` picks up `["n2"]` (shopify-store-cockpit
emits `collection`/`product-facts`/`angle`, which sm-manager needs) — an acyclic chain,
no manual edge-writing required.

## Pitfalls

- Don't write node `needs` yourself — that's the engine's job via the vocab; hand-writing
  edges here just gets overwritten (or drifts from the real manifests).
- Don't dispatch, poll, or call agent tools — this skill ends at `awaiting-approval`.
- Don't include an agent whose `handles` doesn't genuinely cover part of the goal.

## Verification

- The run manifest file exists at the expected path with `status: awaiting-approval`.
- Every node's `agent` is a slug present in the injected roster.
- No node was dispatched, polled, or given a result by this skill.
