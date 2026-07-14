# Orchestrator — Test Scenarios

Concrete goals to exercise the Conductor orchestrator (Run Board → plan → approve →
engine dispatch → handoff queue → results). Use these for the Task-11 live verify and as
regression scenarios after changes.

Prereqs (see STATUS.md / the live-verify runbook): app rebuilt from `main`, re-seeded so
the **Conductor** (Orchestration team) + capability manifests + handoff-receive skills are
in `~/.ade`. Watch the run live on disk at
`…/RLOS_2026/2. Areas/Orchestrator/runs/<run_id>.md` and the per-agent inboxes at
`…/2. Areas/Handoffs/<slug>/`.

---

## Scenario A — Fleet smoke test (run through ALL agents)

**Goal to submit (verbatim):**

```
SMOKE TEST: every agent report in
```

The Conductor recognizes the `SMOKE TEST` prefix (see `conduct/SKILL.md` → *Smoke-test
mode*) and emits **one node per agent** (all 12 dispatchable agents, not the Conductor),
each with the same read-only task: *confirm the dispatch, write a one-line status from a
read-only glance, flip the handoff to done — do NOT publish/apply/send/place anything.*

**Why this is the canonical "all agents" test:** it hits every agent in one run, and
because the engine auto-wires `emits → needs`, it exercises BOTH a real dependency
sub-graph AND wide parallel fan-out at once.

**Expected wired DAG** (the engine fills `needs`; you list agents, it draws edges):

```
ROOTS (dispatch immediately, in parallel)
  ● strategist            emits: content-plan, angle
  ● foreman-listings      emits: mockups, listing, product-facts
  ● codehq-portfolio      (standalone)
  ● daily-planner         (standalone)
  ● kalshi-tessa          (standalone)
  ● rubypulse-laser       (standalone)
  ● storefront-support    (standalone)
  ● clip-scout            (standalone)
  ● script-writer         (standalone)

THEN (unlock as inputs complete)
  ● shopify-store-cockpit  needs mockups/listing/product-facts  → after foreman-listings
  ● repurposer             needs content-plan                   → after strategist
  ● sm-manager             needs collection/product-facts/angle/content-plan
                                                                → after store + foreman + strategist
```

So 9 nodes start in parallel; `shopify-store-cockpit` unlocks after `foreman-listings`;
`sm-manager` unlocks last (its deepest dependency). This proves parallel dispatch, the
ready-set/unlock logic, and result collection across the whole fleet in a single approve.

**What to verify (maps to the un-live-verified seams):**
- All 12 nodes appear in the approved plan (one per agent, Conductor excluded).
- The 9 roots dispatch **concurrently** (panes open together) — proves parallel fan-out.
- Each node flips `pending → running → done` and shows a one-line `result` in the
  ResultsPanel — proves the `result` write-back (finding C1) end-to-end.
- `shopify-store-cockpit` does **not** dispatch until `foreman-listings` is `done`;
  `sm-manager` is last — proves dependency gating.
- Nothing gets published/applied/sent (read-only task) — proves gates aren't bypassed.
- Run ends `done` (or `partial` if any agent legitimately failed — inspect which).

**Safety:** every task is explicitly read-only. Gated agents (`foreman-listings`,
`shopify-store-cockpit`, `sm-manager`, `storefront-support`, `clip-scout`) should report
status without hitting their publish/apply/send/telegram gate. `kalshi-tessa` never
places real orders; `rubypulse-laser` is structurally read-only. If any agent *does* try
to act, that's a finding — stop and note it.

---

## Scenario B — Realistic dependency chain + human gate (HLD launch)

Once the smoke test passes, run a *real* goal to prove the DAG + block-on-gate behavior
with genuine work:

**Goal to submit:**

```
Prep a small "New Braunfels summer" push: one new engraved item, staged on the store, with announcement posts queued for my approval.
```

**Expected plan (real capability decomposition):**
1. `foreman-listings` — draft the new engraved-item listing (mockups + copy). *Gate:
   publish-apply-confirmation.*
2. `shopify-store-cockpit` — stage it into a summer collection. *(needs foreman's output;
   gate: apply-confirmation.)*
3. `sm-manager` — draft + queue announcement posts. *(needs the collection; gate:
   approval-queue.)*

**What to verify:**
- The chain runs **in order** (store waits for foreman, sm waits for store).
- **Block-on-gate (finding I1):** when `foreman-listings` reaches its
  publish-apply-confirmation gate, its handoff sits at `drafted` and the node stays
  `running` — it must **not** be force-failed at the 15-min timeout. Approve it in
  Foreman's own flow → it flips to `done` → the store node unlocks. This is the core of
  the gate/timeout decision.
- **Retry (finding I2):** if a node fails, hit **Retry** on it in the DagView — confirm a
  fresh dispatch note is written (not a no-op on the stale one) and the sub-graph re-runs.
- **Cancel (finding I3):** start the run, hit **Cancel** mid-flight → no new panes spawn
  after cancel and the manifest ends `cancelled` (not a zombie `running`).

Brand facts to keep honest for HLD: **New Braunfels, TX** (not Round Rock),
hand-engraved wording; nothing publishes without your gate approval.

---

## Capability graph reference (emits → needs)

| vocab key | emitted by | needed by |
|---|---|---|
| `mockups` | foreman-listings | shopify-store-cockpit |
| `listing` | foreman-listings | shopify-store-cockpit |
| `product-facts` | foreman-listings, shopify-store-cockpit | shopify-store-cockpit, sm-manager |
| `collection` | shopify-store-cockpit | sm-manager |
| `angle` | shopify-store-cockpit, strategist | sm-manager |
| `content-plan` | strategist | repurposer, sm-manager |
| `drafted-posts` | repurposer, sm-manager | — (leaf) |
| `clip-verdict` | clip-scout | — (leaf) |
| `script` | script-writer | — (leaf) |

Standalone (no vocab links — always parallel roots): `codehq-portfolio`, `daily-planner`,
`kalshi-tessa`, `rubypulse-laser`, `storefront-support`. The Conductor itself plans and is
never a dispatch target.
