# RyanOS — Phase 3A Design: Inter-Agent Handoff (Store Cockpit → SM Manager)

**Date:** 2026-07-08
**Repo:** `~/Code/damon-ade` (RyanOS)
**Builds on:** Phase 2B-2 (shipped & live-verified) — 9 authored superagent brains + the brain-author skill + memory-safe scaffold install. The SM Team's Phase A (shipped, merged `ceac5a6`) — a live SM Manager agent with a proven draft→grade→approval-gate→schedule loop over Blotato.
**Goal:** Give RyanOS agents a real mechanism to hand work to each other — proven on ONE concrete pipeline: **Store Cockpit auto-drops a post-worthy store event to SM Manager**, which turns it into a graded, brand-voiced, approval-gated social post. The mechanism is reusable by construction but only this one pipeline is built and proven now.

---

## 1. Scope & first customer

Phase 3 splits into two independent sub-projects: **3A inter-agent handoff** (this doc) and **3B dashboards-as-panels** (separate spec, later). This spec is 3A only.

**First customer: Store Cockpit → SM Manager.** Chosen over Clip Scout → SM after grounding revealed Clip Scout produces *build-worthy* pitches (mini-PRDs for the RyanOS backlog), not social content. Store Cockpit, by contrast, tends the live HLD Shopify store and runs growth — so "this is a post-worthy store event" is something it genuinely knows. This pipeline extends the SM Team's already-live loop (which posted a real product to IG) by letting Store Cockpit *initiate* a post instead of Ryan doing it manually.

**Grounded facts this rests on:**
- Store Cockpit (`assets/seed-brains/shopify-store-cockpit/`) — HLD store operator; edits existing products, tends the theme, runs growth strategy; `linked-worktree` agent, cwd = `~/Code/ShopifyStore` worktree (has full filesystem access — can write vault paths absolutely).
- SM Manager (`assets/seed-brains/sm-manager/`) — writes/grades/schedules social posts, holds Blotato (26 MCP tools, IG @handlanedesigns acct 6789 + others), HLD per-brand grading rubric (virality OFF, banned clichés + wrong-town + invented-claims are hard fails), a **mandatory approval gate** (`post-scheduler` writes to `2. Areas/Social Media/Approval Queue/` and never publishes un-approved). Blotato auth is per-machine OAuth in `~/.claude.json` — survives a re-seed (re-seed only touches `~/.ade`).
- Both can reach the shared Obsidian vault at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/`.

**Dependency (found in spec review):** the SM Manager brain *asset* exists, but SM Manager is **NOT yet a seeded live agent** — it's absent from `AGENT_BRAIN_SLUGS` (`seed-brains.ts`) and the roster (`seed-cockpit.ts`), and did not boot in the 2B-2 re-seed. 3A therefore owns a minimal seed-wiring slice (make SM Manager a live agent) — see §5. This overlaps the SM Team's Phase C ("wire the team into first-boot seed") but 3A only takes the slice it needs (SM Manager itself, not the Phase-B Repurposer/Strategist).

## 2. Mechanism: shared vault handoff queue

Agents are separate, async Claude Code sessions in separate worktrees — no shared process. The handoff travels as a **durable vault file**, not an in-process message. This matches how the agents already run and needs zero ADE/Electron runtime code.

**Inbox convention (generic):** `2. Areas/Handoffs/<recipient-slug>/` in the vault, where `<recipient-slug>` is the recipient's seed-brain slug (e.g. `sm-manager`). Obsidian-visible, sitting alongside SM's existing `2. Areas/Social Media/Approval Queue/`. A `done/` subdir archives processed handoffs.

**Handoff note contract** — one markdown note per handoff. Frontmatter is the interface between agents:

```yaml
---
handoff_id: 2026-07-08-sale-20oz-water-bottle   # dedup key; <date>-<event>-<handle>
from: store-cockpit          # sender seed-brain slug
to: sm-manager               # recipient seed-brain slug
status: pending              # pending → drafted → done | rejected
brand: HLD                   # HLD | personal (drives SM's grading rubric)
event_type: sale             # sale | feature | restock | seasonal | bestseller
product: "20oz Custom Engraved Water Bottle — 20oz-water-bottle — https://handlanedesigns.com/products/20oz-water-bottle"
facts: "20% off through Sun 7/13; summer hydration angle"   # postable specifics (this IS the content)
angle: "summer hydration push"        # sender's suggested hook (SM may override)
created: 2026-07-08
---
Short human-readable context: why this is worth posting, anything SM should know.
Pointer to the product/promo SSOT — never a copy that rots.
```

Field rules: `product` and any vault/store reference is a **pointer** (title + handle + URL), never copied prose. `facts` is the exception — the concrete promo specifics (sale %, dates, price) ARE the post's content, so they're carried inline; SM re-verifies them against the store before posting.

**Lifecycle** (mirrors SM's approval-queue pattern):
1. `pending` — Store Cockpit wrote it; SM hasn't processed it.
2. `drafted` — SM read it, drafted + graded a post, queued it to the approval gate.
3. `done` — the post was approved + scheduled; SM moves the note to `Handoffs/sm-manager/done/`.
4. `rejected` — Ryan rejected the draft at SM's gate; SM stamps `rejected` + a one-line reason and does NOT auto-redraft.

Dedup: `handoff_id` is deterministic from the event; a sender must not write a second note with an existing `handoff_id` (send-half checks the inbox + `done/` first).

## 3. The reusable `handoff` skill (send + receive)

One skill authored once, installed into both agents' brains via the 2B-2 scaffold machinery. It has two halves; each agent uses the half its role calls for (its persona/context names which).

**Send half** (Store Cockpit):
1. Determine the recipient (`sm-manager`) and its inbox `2. Areas/Handoffs/sm-manager/`.
2. Build `handoff_id`; scan the inbox + `done/` — if it already exists, STOP (no duplicate).
3. Write a contract-valid note (frontmatter above) with `status: pending`. Pointers not copies; `facts` carries the concrete promotable specifics.
4. Do NOT wait — this is fire-and-forget; SM processes on its own schedule.

**Receive half** (SM Manager):
1. At session start (and on demand), list `2. Areas/Handoffs/sm-manager/*.md` with `status: pending`.
2. For each: read it, re-verify `facts` against the live store where relevant, run the **existing** SM loop — `post-writer` (brand voice per `brand`) → `post-grader` (HLD rubric if `brand: HLD`) → `post-scheduler` (writes to the approval queue, never publishes un-approved). Flip the note to `status: drafted`.
3. When Ryan approves at the gate → schedule via Blotato → set `status: done`, move note to `done/`.
4. If Ryan rejects → `status: rejected` + reason; stop.

The skill hardcodes the inbox path convention and the recipient-slug table (the known roster). No network, no ADE tools — pure vault file I/O + the agents' existing skills.

## 4. Producer trigger (auto-drop)

Store Cockpit **auto-drops** a handoff — no separate approval on the handoff itself (SM's post-approval gate is the single control point) — when it identifies or sets up a post-worthy store event:
- a sale/promo it configured, a product it featured, a restock, a seasonal push, or a standout best-seller;
- or when Ryan explicitly asks it to "promote X."

Auto-drop trades a little noise for automation; if Store Cockpit's picks are noisy, that's a persona-tuning problem, not a reason to add a gate — every post still stops at SM's approval queue. Store Cockpit's persona/context gains one instruction pointing at the send half; its autonomy (already `high`) covers it.

## 5. What gets built (near-zero code: one small seed slice + content)

0. **Make SM Manager a live agent (the one code change):** add `"SM Manager": "sm-manager"` to `AGENT_BRAIN_SLUGS` in `seed-brains.ts`, and add SM Manager to the roster in `seed-cockpit.ts` — a new **"Social Media"** team with SM Manager as a `direct`-vault agent (cwd = vault, like Script Writer/Clip Scout/Daily Planner; it operates on `2. Areas/Social Media/` + Blotato MCP, has no dedicated repo). ~10 lines, identical pattern to the existing 9; covered by the existing `seed-cockpit.test.ts` count assertions (update the expected count). This is the slice of SM Team Phase C that 3A requires — nothing more.
1. **`handoff` skill** authored (SKILL.md, agentskills.io format) — send + receive halves + the inbox/slug convention. Lives as a seed-brain skill.
2. **Install to both brains:** add `skills/handoff/` to `assets/seed-brains/shopify-store-cockpit/brain/` and `assets/seed-brains/sm-manager/brain/` (re-author via brain-author; memory-safe — never touches MEMORY.md).
3. **Persona/context lines:** Store Cockpit context gains a `## Handoffs` pointer ("auto-drop post-worthy store events to SM Manager via the handoff skill"); SM Manager context gains "check your handoff inbox at session start, process pending."
4. **Inbox dir:** create `2. Areas/Handoffs/sm-manager/` (+ `done/`) with a short README explaining the convention.
5. **Re-seed** (memory-safe) so both agents boot with the skill + updated context — and SM Manager boots as a live agent for the first time — reusing the exact 2B-2 machinery just shipped and live-verified.

The ONLY code touched is the seed roster + slug map (step 0), plus its test count — the same well-trodden pattern the existing 9 agents already follow. No changes to `agent-scaffold.ts` install logic or any Electron runtime; the scaffold already installs authored `skills/*` (2B-2 Task 2). Everything else is content.

## 6. Verification

End-to-end dry run against a real product/promo (same shape as the SM Team's live-loop proof):
1. Re-seed; open Store Cockpit; have it configure or identify a real post-worthy event (e.g. a current best-seller) and auto-drop a handoff.
2. Confirm a contract-valid note lands in `2. Areas/Handoffs/sm-manager/` with `status: pending`.
3. Open SM Manager; confirm it reads the pending handoff, drafts an HLD-voiced post, grades it (HLD rubric), and writes it to the approval queue with the note flipped to `drafted` — **stopping at the gate** (no un-approved publish).
4. Approve once → SM sets `status: done` + archives to `done/`. (Or reject → `rejected` + reason, no redraft.) The actual Blotato *schedule* call is Blotato-auth-dependent (see §8) — if it fails under `--strict-mcp-config`, the mechanism still passes; the schedule is a separate confirmation owned by SM Team Phase C.
5. Idempotency: re-running Store Cockpit's trigger for the same event does NOT create a duplicate handoff.
6. No pollution: confirm Store Cockpit wrote ONLY to the vault inbox — nothing into `~/Code/ShopifyStore` — and both agents' `MEMORY.md` are untouched.

**Success = a store event flows Store Cockpit → SM Manager → approval gate with no manual copy-paste**, as a file convention Ryan can read/edit in Obsidian. (Blotato scheduling is the tail, not the mechanism.)

## 7. Non-goals (Phase 3+ / fast-follows)

- **In-app / real-time message passing** (ADE brokers a message into a running session's terminal) — the file queue solves the actual need; revisit only if a synchronous case appears.
- **Cron auto-trigger** — a Hermes weekly cron that auto-runs SM's receive half; Phase-later (SM Team Phase C already contemplates a weekly cron).
- **Multi-recipient fan-out** — one recipient per handoff for now.
- **More senders/receivers** — Foreman → SM (new-product launches), Concierge → Store Cockpit (order edits), Clip Scout → SM (needs a new content verdict first). Each is just "install send half on sender, receive half on receiver" once this is proven.
- **Handoff observability UI** — the notes ARE the log; no dashboard.

## 8. Risks

- **Sender writes to the vault by absolute path** (Store Cockpit's cwd is the ShopifyStore worktree, not the vault). Agents run with `--dangerously-skip-permissions`, so this works, but the skill must use the absolute vault path and must NOT write anything into the ShopifyStore repo. Enforce in the skill + verify no ShopifyStore pollution in the dry run.
- **`facts` staleness** — promo specifics carried inline can go stale between drop and post. Mitigation: SM re-verifies `facts` against the live store before drafting; the handoff points at the product SSOT.
- **Auto-drop noise** — Store Cockpit over-dropping. Mitigation: it's persona-tunable and the approval gate is the backstop; if noisy, tighten the persona's "post-worthy" bar, don't add a gate.
- **Re-author safety** — installing the skill + context edits must never touch MEMORY.md (guaranteed by the 2B-2 authored/learned split; re-verify in the dry run that each agent's MEMORY.md is untouched).
- **SM Manager source assumption** — 3A seeds SM Manager as a `direct`-vault agent (it has no dedicated repo; it works the vault Social Media dirs + Blotato). The plan must confirm this against the sm-manager brain asset (e.g. its context/persona) and that its display name is exactly "SM Manager" before wiring the roster/slug entries.
- **Blotato auth under seeded launch (SM Team Phase C concern)** — ADE launches agents with `--strict-mcp-config` pointing at the agent's `mcp.json`, but Blotato's auth is per-machine interactive OAuth in `~/.claude.json`, NOT an API key in `mcp.json`. So a seeded SM Manager may not be Blotato-authenticated at launch. **This does NOT block 3A:** the handoff mechanism is fully verifiable through SM's *approval gate* (draft → grade → queue), which is pure vault work needing no Blotato. Only the final *schedule* step needs Blotato; treat that as a separate confirmation and, if it fails under `--strict-mcp-config`, hand it to SM Team Phase C (the proper owner of the Blotato-in-seed problem) rather than solving it here.
