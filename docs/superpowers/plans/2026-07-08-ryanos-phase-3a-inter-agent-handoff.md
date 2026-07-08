# RyanOS Phase 3A — Inter-Agent Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove one inter-agent handoff — Store Cockpit auto-drops a post-worthy store event to SM Manager, which drafts/grades/gates it into a social post — via a reusable vault handoff-queue mechanism (inbox + note contract + `handoff` skill), needing only a small seed slice plus content.

**Architecture:** A handoff is a durable markdown note in a per-recipient vault inbox (`2. Areas/Handoffs/<recipient-slug>/`). A single reusable `handoff` skill has SEND + RECEIVE halves; each agent uses the half its role calls for. Store Cockpit (SEND) writes a contract note; SM Manager (RECEIVE) processes pending notes through its existing draft→grade→approval-gate loop. No ADE runtime code except the ~10-line seed slice that makes SM Manager a live agent.

**Tech Stack:** TypeScript (Electron main, Bun test), Claude Code agent skills (agentskills.io SKILL.md), Obsidian vault markdown, the 2B-2 seed-brains scaffold (already installs authored `skills/*` additively).

## Global Constraints

- **Commit discipline:** direct to `main`, every commit prefixed `BRAYNEE_ALLOW_MAIN_COMMITS=1`; push to `origin` (`naquin316/damon-ade`).
- **MEMORY.md / learned-skill safety (absolute):** adding the `handoff` skill + context edits must NEVER write/truncate/delete any `MEMORY.md`, and the scaffold's authored-skill copy must remain additive (never clobber a learned skill). Re-seed installs into fresh homes.
- **Handoff writes ONLY to the vault inbox** — the SEND half must never write into the sender's repo/worktree (Store Cockpit's cwd is the ShopifyStore worktree). Verify no ShopifyStore pollution.
- **No cross-dir `@`-imports** in any `context/CLAUDE.md`.
- **Skill description ≤ 60 chars** (agentskills.io).
- **Exact identifiers:** SM Manager display name is exactly `SM Manager`; its slug is `sm-manager`. Inbox path `<VAULT>/2. Areas/Handoffs/sm-manager/`; `<VAULT>` = `/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026`.
- **Seed counts after this phase:** 6 teams / 12 agents; `AGENT_BRAIN_SLUGS` = 10 entries.
- **Point-don't-copy** in handoff notes: product/store refs are pointers; only `facts` (promo specifics) is carried inline.
- **Blotato is out of scope** (§8 of the spec): verify the mechanism at SM's approval gate, not the Blotato schedule.

## File Structure

**Modified (code):**
- `apps/desktop/src/main/lib/seed-brains.ts` — add `"SM Manager": "sm-manager"` to `AGENT_BRAIN_SLUGS`.
- `apps/desktop/src/main/lib/seed-brains.test.ts` — count assertion `9 → 10`.
- `apps/desktop/src/main/lib/seed-cockpit.ts` — add a "Social Media" team with SM Manager (`direct`-vault source).
- `apps/desktop/src/main/lib/seed-cockpit.test.ts` — counts `5→6` teams, `11→12` agents.

**New (content):**
- `assets/seed-brains/_shared/handoff/SKILL.md` — the authored `handoff` skill (source of truth).
- `assets/seed-brains/shopify-store-cockpit/brain/skills/handoff/SKILL.md` — installed copy (SEND role).
- `assets/seed-brains/sm-manager/brain/skills/handoff/SKILL.md` — installed copy (RECEIVE role).
- `2. Areas/Handoffs/README.md` + `2. Areas/Handoffs/sm-manager/done/.gitkeep` — vault inbox (created in the vault, not the repo).

**Modified (content):**
- `assets/seed-brains/shopify-store-cockpit/brain/context/CLAUDE.md` — add `## Handoffs (send)`.
- `assets/seed-brains/sm-manager/brain/context/CLAUDE.md` — add `## Handoffs (receive)`.

Note: `assets/seed-brains/_shared/` is a NON-slug directory (not in `AGENT_BRAIN_SLUGS`), so `getAuthoredBrainDir` never resolves it — it's just the canonical copy of the skill that gets installed into both brains. This keeps one source of truth for the skill body.

---

## Task 1: Seed SM Manager as a live agent

**Files:**
- Modify: `apps/desktop/src/main/lib/seed-brains.ts` (AGENT_BRAIN_SLUGS)
- Modify: `apps/desktop/src/main/lib/seed-brains.test.ts` (count)
- Modify: `apps/desktop/src/main/lib/seed-cockpit.ts` (roster)
- Modify: `apps/desktop/src/main/lib/seed-cockpit.test.ts` (counts)

**Interfaces:**
- Produces: `slugForAgent("SM Manager") === "sm-manager"`; `getAuthoredBrainDir("SM Manager")` resolves to `assets/seed-brains/sm-manager/brain` (the asset already exists). The seed roster gains a 6th team "Social Media" / 12th agent "SM Manager" as a `direct`-vault agent.

- [ ] **Step 1: Update the failing count tests first (TDD)**

In `seed-brains.test.ts`, change the count assertion:
```typescript
expect(Object.keys(AGENT_BRAIN_SLUGS)).toHaveLength(10);
```
In `seed-cockpit.test.ts`, update the seed counts (lines ~96–101 and ~138–139):
```typescript
it("seeds 6 teams and 12 agents into an empty DB", () => {
  // ...
  expect(firstSeed.length).toBe(12);
  expect(localDb.select().from(projects).all().length).toBe(6);
  expect(localDb.select().from(workspaces).all().length).toBe(12);
  expect(localDb.select().from(worktrees).all().length).toBe(12);
  // ...
});
// idempotency block:
expect(localDb.select().from(projects).all().length).toBe(6);
expect(localDb.select().from(workspaces).all().length).toBe(12);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/seed-brains.test.ts src/main/lib/seed-cockpit.test.ts`
Expected: FAIL — slug map still has 9; seeder still makes 5 teams / 11 agents.

- [ ] **Step 3: Add SM Manager to the slug map**

In `seed-brains.ts`, add to `AGENT_BRAIN_SLUGS` (after the `codehq-portfolio` line):
```typescript
	"SM Manager": "sm-manager",
```

- [ ] **Step 4: Add the Social Media team to the roster**

In `seed-cockpit.ts`, inside `buildSeedTeams()`, append a team after the "Personal / RLOS" team object:
```typescript
		{
			name: "Social Media",
			color: "#DB2777",
			agents: [
				{ name: "SM Manager", source: { type: "direct", path: VAULT } },
			],
		},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/Code/damon-ade/apps/desktop && bun test src/main/lib/seed-brains.test.ts src/main/lib/seed-cockpit.test.ts`
Expected: PASS. If any other assertion in seed-cockpit.test.ts enumerates team/agent names or per-source counts (e.g. number of `direct` agents), update it to include SM Manager and re-run. Then run the whole lib suite for regressions: `bun test src/main/lib` (pre-existing static-ports/agent-wrappers failures are unrelated — confirm they match unmodified `main`).

- [ ] **Step 6: Commit**

```bash
cd ~/Code/damon-ade
git add apps/desktop/src/main/lib/seed-brains.ts apps/desktop/src/main/lib/seed-brains.test.ts apps/desktop/src/main/lib/seed-cockpit.ts apps/desktop/src/main/lib/seed-cockpit.test.ts
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(3A): seed SM Manager as a live agent (Social Media team, direct-vault)"
```

---

## Task 2: Author the `handoff` skill

**Files:**
- Create: `assets/seed-brains/_shared/handoff/SKILL.md`

**Interfaces:**
- Produces: the canonical `handoff` skill body (SEND + RECEIVE halves) that Task 3 copies into both agents' brains. Description ≤ 60 chars.

- [ ] **Step 1: Write the skill**

Create `assets/seed-brains/_shared/handoff/SKILL.md` exactly:
```markdown
---
name: handoff
description: Pass work between RyanOS agents via a vault inbox queue.
version: 0.1.0
platforms: [macos]
metadata:
  ade:
    tags: [RyanOS, Handoff]
---

# Handoff

Pass work between RyanOS agents as durable vault notes. Two halves — use the one
your role calls for (your context's `## Handoffs` section says which). Never
touches MEMORY.md; never writes into any repo/worktree.

## When to Use
- SEND: you finished something another agent should act on (e.g. Store Cockpit →
  SM Manager: a post-worthy store event).
- RECEIVE: at session start, check whether another agent handed you work.

## Convention
- `<VAULT>` = `/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026`
- Inbox: `<VAULT>/2. Areas/Handoffs/<recipient-slug>/`; processed → its `done/` subdir.
- `<recipient-slug>` = the recipient's seed-brain slug (e.g. `sm-manager`,
  `shopify-store-cockpit`).
- One markdown note per handoff. Frontmatter IS the contract:
  `handoff_id, from, to, status (pending→drafted→done|rejected), brand,
  event_type, product (pointer), facts (postable specifics), angle, created`.

## Procedure — SEND
1. Pick the recipient + inbox path. Build `handoff_id = <date>-<event>-<handle>`
   (deterministic from the event, so the same event yields the same id).
2. Scan the inbox AND its `done/` — if a note with this `handoff_id` already
   exists, STOP (no duplicate).
3. Write `<inbox>/<handoff_id>.md` with `status: pending` and the full contract
   frontmatter + a short human body. Use pointers (title/handle/URL), never
   copied prose — EXCEPT `facts`, which carries the concrete promotable specifics
   (sale %, dates, price).
4. Fire-and-forget — do not wait; the recipient processes on its own schedule.
5. Write ONLY under the vault inbox. Never write into your own repo/worktree.

## Procedure — RECEIVE
1. List `<inbox>/*.md` where `status: pending`.
2. For each: read it, re-verify any `facts` against the live source of truth,
   then run your normal loop for that kind of work. Flip the note to
   `status: drafted`.
3. On completion (approved + done): set `status: done`, move the note to `done/`.
4. On rejection: set `status: rejected` + a one-line reason; do NOT auto-redraft.

## Pitfalls
- Duplicate handoffs — always dedup by `handoff_id` against inbox + `done/`.
- Stale `facts` — RECEIVE re-verifies before acting.
- Never write MEMORY.md; never write into another repo/worktree.

## Verification
- SEND: a contract-valid note exists in the recipient inbox with `status: pending`
  and no duplicate.
- RECEIVE: pending notes move to `drafted`/`done`; MEMORY.md untouched.
```

- [ ] **Step 2: Verify frontmatter + description length**

Run:
```bash
cd ~/Code/damon-ade
sed -n 's/^description: //p' assets/seed-brains/_shared/handoff/SKILL.md | tr -d '\n' | wc -c
```
Expected: ≤ 60. (The line above is 52 chars.) Confirm the `---` frontmatter fence parses (single opening/closing).

- [ ] **Step 3: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/_shared/handoff/SKILL.md
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(3A): author reusable handoff skill (send + receive halves)"
```

---

## Task 3: Wire the mechanism into both brains + create the inbox

**Files:**
- Create: `assets/seed-brains/shopify-store-cockpit/brain/skills/handoff/SKILL.md` (copy of the canonical)
- Create: `assets/seed-brains/sm-manager/brain/skills/handoff/SKILL.md` (copy of the canonical)
- Modify: `assets/seed-brains/shopify-store-cockpit/brain/context/CLAUDE.md` (add `## Handoffs (send)`)
- Modify: `assets/seed-brains/sm-manager/brain/context/CLAUDE.md` (add `## Handoffs (receive)`)
- Create (in the VAULT, not the repo): `2. Areas/Handoffs/README.md`, `2. Areas/Handoffs/sm-manager/` (+ `done/`)

**Interfaces:**
- Consumes: the canonical skill from Task 2.
- Produces: both brains carry `skills/handoff/` and a `## Handoffs` context section; the vault inbox exists.

- [ ] **Step 1: Install the skill into both brains (identical body)**

```bash
cd ~/Code/damon-ade
for slug in shopify-store-cockpit sm-manager; do
  mkdir -p "assets/seed-brains/$slug/brain/skills/handoff"
  cp assets/seed-brains/_shared/handoff/SKILL.md "assets/seed-brains/$slug/brain/skills/handoff/SKILL.md"
done
```

- [ ] **Step 2: Add `## Handoffs (send)` to Store Cockpit context**

Append to `assets/seed-brains/shopify-store-cockpit/brain/context/CLAUDE.md`, after the `## Tool access` section:
```markdown
## Handoffs (send)

When you set up or spot a post-worthy store event — a sale, a featured product, a
restock, a seasonal push, or a standout best-seller — or Ryan asks you to promote
something, auto-drop a handoff to SM Manager using the `handoff` skill (SEND half).
Write a note to `<VAULT>/2. Areas/Handoffs/sm-manager/` with `brand: HLD`, the
product pointer (title + handle + storefront URL), the concrete promo `facts`, and
a suggested `angle`. Fire-and-forget — SM Manager drafts, grades, and gates it
(the approval gate still governs). Dedup by `handoff_id`. Write ONLY to the vault
inbox — never into the ShopifyStore repo.
```

- [ ] **Step 3: Add `## Handoffs (receive)` to SM Manager context**

Append to `assets/seed-brains/sm-manager/brain/context/CLAUDE.md`:
```markdown
## Handoffs (receive)

At session start, check your handoff inbox `<VAULT>/2. Areas/Handoffs/sm-manager/`
for `status: pending` notes (the `handoff` skill, RECEIVE half). For each, run your
normal pipeline (post-writer → post-grader → post-scheduler → approval gate) using
the note's `brand` + `facts` + `angle`; re-verify `facts` against the store first.
Move `pending → drafted → done` (archive to `done/`) as it progresses; a rejected
draft → `rejected` + reason, no redraft. A handoff NEVER bypasses the approval gate.
```

- [ ] **Step 4: Create the vault inbox (in the Obsidian vault, absolute path)**

```bash
VAULT="/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026"
mkdir -p "$VAULT/2. Areas/Handoffs/sm-manager/done"
cat > "$VAULT/2. Areas/Handoffs/README.md" <<'EOF'
# Handoffs — inter-agent work queue

RyanOS agents hand work to each other as notes here — one subdir per recipient
(`<recipient-slug>/`), processed notes archived to `<recipient>/done/`.
Frontmatter contract: `handoff_id, from, to, status (pending→drafted→done|rejected)`
plus payload fields. See the `handoff` skill. Read/edit these in Obsidian — they
are the log. First pipeline: store-cockpit → sm-manager (post-worthy store events).
EOF
echo "inbox:"; ls -R "$VAULT/2. Areas/Handoffs"
```

- [ ] **Step 5: Invariant checks**

```bash
cd ~/Code/damon-ade
echo "no @-imports in edited contexts:"; grep -c '@' assets/seed-brains/shopify-store-cockpit/brain/context/CLAUDE.md assets/seed-brains/sm-manager/brain/context/CLAUDE.md
echo "skill installed in both:"; ls assets/seed-brains/shopify-store-cockpit/brain/skills/handoff/SKILL.md assets/seed-brains/sm-manager/brain/skills/handoff/SKILL.md
```
Expected: `@` count 0 in both contexts; both skill files present.

- [ ] **Step 6: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/shopify-store-cockpit/brain assets/seed-brains/sm-manager/brain
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(3A): install handoff skill + wire context in Store Cockpit + SM Manager"
```
(The vault inbox lives outside the repo — not committed here.)

---

## Task 4: Re-seed + end-to-end verification (dry run through the approval gate)

**Files:** none committed (live verification).

- [ ] **Step 1: Memory-safe re-seed**

Quit the running dev app, then:
```bash
mv ~/.ade ~/.ade.bak.$(date +%s); mv ~/.ade-default ~/.ade-default.bak.$(date +%s) 2>/dev/null
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```
Confirm the boot log seeds **12 agents / 6 teams** and that SM Manager now boots (persona names it "SM Manager").

- [ ] **Step 2: Confirm both agents carry the mechanism**

```bash
# SM Manager booted + has the handoff skill + receive context
smm=$(dirname "$(grep -l 'You are the SM Manager' ~/.ade/agents/*/persona.txt | head -1)")
echo "SM Manager home: $smm"
ls "$smm/skills/handoff/SKILL.md" && grep -q 'Handoffs (receive)' "$smm/context/CLAUDE.md" && echo "SM receive wired ✓"
# Store Cockpit send side
sc=$(dirname "$(grep -l 'You are Store Cockpit' ~/.ade/agents/*/persona.txt | head -1)")
ls "$sc/skills/handoff/SKILL.md" && grep -q 'Handoffs (send)' "$sc/context/CLAUDE.md" && echo "Store Cockpit send wired ✓"
```
Expected: both wired; MEMORY.md in each is the fresh template (memory-safe).

- [ ] **Step 2b: Drop a test handoff (simulating Store Cockpit's SEND)**

Author one contract-valid note directly (proving RECEIVE independent of Store Cockpit's judgment), for a real current product:
```bash
VAULT="/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026"
cat > "$VAULT/2. Areas/Handoffs/sm-manager/2026-07-08-feature-test.md" <<'EOF'
---
handoff_id: 2026-07-08-feature-test
from: store-cockpit
to: sm-manager
status: pending
brand: HLD
event_type: feature
product: "<a real current HLD product — title, handle, storefront URL>"
facts: "<a real current fact, e.g. 'best-seller this month'>"
angle: "spotlight our top engraved gift"
created: 2026-07-08
---
Test handoff for the 3A dry run — verify SM Manager picks this up and drafts.
EOF
echo "dropped test handoff"
```

- [ ] **Step 3: Verify SM Manager processes it through the approval gate**

Open SM Manager in the app; it should (per its RECEIVE context) find the pending note, draft an HLD-voiced post, grade it (HLD rubric), and write it to `<VAULT>/2. Areas/Social Media/Approval Queue/`, flipping the note to `status: drafted`. Confirm:
```bash
VAULT="/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026"
grep -l "status: drafted" "$VAULT/2. Areas/Handoffs/sm-manager/"*.md 2>/dev/null && echo "handoff → drafted ✓"
ls "$VAULT/2. Areas/Social Media/Approval Queue/" 2>/dev/null && echo "queued for approval ✓ (STOPPED at gate — no publish)"
```
Expected: the note is `drafted`; a graded post sits in the approval queue; nothing published. (The Blotato schedule tail is out of scope — §8.)

- [ ] **Step 4: Invariants + idempotency + no pollution**

```bash
git -C ~/Code/ShopifyStore status --short   # clean — SEND never wrote into the repo
# re-open SM Manager or re-drop the same handoff_id → no duplicate note created
# both agents' MEMORY.md are the fresh template (untouched)
```
Expected: ShopifyStore clean; no duplicate handoff for the same `handoff_id`; MEMORY.md untouched.

- [ ] **Step 5: Ryan's acceptance + wrap**

Ryan confirms the store-event → post flow works with no manual copy-paste. Then invoke `wrap` (STATUS.md), update `[[project_ryanos]]` + `.claude/HANDOFF.md` to mark Phase 3A shipped, and push. Optionally approve the queued post once to confirm the full tail (Blotato schedule) — or hand a Blotato-under-seed failure to SM Team Phase C.

---

## Self-Review

**Spec coverage (against phase-3a-design.md):**
- §2 inbox convention + note contract → Task 2 (skill encodes it) + Task 3 (inbox dir). ✓
- §3 reusable send/receive skill → Task 2 + Task 3 install. ✓
- §4 auto-drop trigger → Task 3 Store Cockpit `## Handoffs (send)` context. ✓
- §5 step 0 seed slice → Task 1. ✓  §5 steps 1–5 → Tasks 2–4. ✓
- §6 verification (mechanism at the approval gate, no Blotato) → Task 4. ✓
- §8 risks: SEND-no-repo-pollution → Task 3 Step 2 wording + Task 4 Step 4; MEMORY.md-safety → Task 4 Step 2/4; Blotato out of scope → Task 4 Step 3 note; SM source `direct`-vault + exact name → Task 1. ✓

**Placeholder scan:** Task 4 Step 2b intentionally leaves `<a real current HLD product…>` for the operator to fill with a live product at run time — that's a runtime value, not a plan gap. No TBD/TODO elsewhere.

**Type/identifier consistency:** `"SM Manager"` / `sm-manager` used identically across Task 1 (slug map + roster), Task 3 (inbox path), Task 4 (greps). Inbox path `2. Areas/Handoffs/sm-manager/` consistent in skill, context, and verification. Seed counts (6/12, slug map 10) consistent across Task 1 and Task 4.
