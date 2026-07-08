# RyanOS Social Media Team — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the 3-agent Social Media crew — add the **Repurposer** and **Strategist** agents and the **personal / Hand Lane AI** brand — so the team goes from "one HLD post at a time" (Phase A) to "one long-form piece → a graded week of posts across two brands," all still behind the approval gate.

**Architecture:** Phase A shipped only the SM Manager brain (HLD brand). Phase B authors two more RyanOS agent brains in the same seed-asset shape (`assets/seed-brains/<agent>/brain/` = `persona.txt` + `context/CLAUDE.md` + `mcp.json` + `skills/`), authors two net-new skills (`brand-brief-personal`, `content-calendar`), and adds `brand-brief-personal` to the SM Manager so its two-brand switching becomes real. The forked `repurpose`/`viral-hooks`/`post-grader`/`post-scheduler` skills already exist from Phase A. Only the SM Manager holds the Blotato MCP; Repurposer and Strategist draft/plan and hand work to the SM Manager's approval queue.

**Tech Stack:** Markdown SKILL.md (agentskills.io format), JSON (mcp.json), Claude Code launch-flag injection (same as Phase A). Content-authoring plan — verification is behavioral (does the brand switch, does the grader use the right rubric, does a long-form input produce a graded week of posts) plus end-to-end runs, not unit tests.

## Global Constraints

- **Repo:** `~/Code/damon-ade`. Solo repo, commits direct to `main`, prefix `BRAYNEE_ALLOW_MAIN_COMMITS=1`.
- **Two brands, two rubrics (from Phase A `post-grader`):** HLD = virality OFF (warm craft-fair voice, banned clichés/wrong-town/fake-claims = hard fails). Personal / Hand Lane AI = virality ON (Blotato's hook-50% rubric — contrarian wedge, receipts). The active brand brief selects the rubric.
- **Approval gate unchanged:** nothing publishes un-approved. Repurposer/Strategist have NO Blotato MCP — they physically cannot publish; only the SM Manager holds the keys and routes through `post-scheduler`.
- **Brain seed-asset shape (matches `agent-scaffold.ts` `authoredBrainDir`):** `persona.txt`, `context/CLAUDE.md`, `mcp.json`, `skills/<name>/SKILL.md`. `MEMORY.md` never authored.
- **Repurposer input is RYAN'S OWN long-form** (YouTube transcript, blog, newsletter, session notes, or a URL) — NOT Clip Scout output. Clip Scout triages *inbound* clippings into build-pitches (`2. Areas/Clip Scout/Pitches`), a different purpose; any tie is optional and only when a clipping is genuinely Ryan's content to redistribute.
- **Personal brand voice is greenfield-ish:** author a strong starter brief from known facts (Hand Lane AI = solo AI automation/consulting/SaaS for SMBs; tagline "Operational AI, built by operators"; build-in-public), then flag it for a refine-interview with Ryan — same honesty rule 2B-2 uses for greenfield agents (no faked depth).
- **Launch flags (per Phase A / `agent-launch.ts`):** `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --model 'claude-opus-4-8[1m]' --settings <s> --append-system-prompt-file <persona> --add-dir <context> --mcp-config <mcp> --strict-mcp-config --dangerously-skip-permissions`. Skills are discovered under `<cwd>/.claude/skills/` or `~/.claude/skills/`, not by flag.
- **Not in scope (Phase C):** first-boot seed integration, Hermes weekly cron, Telegram approval digest.

---

### Task 1: Author `brand-brief-personal` skill (personal / Hand Lane AI, virality ON)

**Files:**
- Create: `assets/seed-brains/sm-manager/brain/skills/brand-brief-personal/SKILL.md`
- Copy into (later tasks): `assets/seed-brains/strategist/brain/skills/brand-brief-personal/` (Task 3)

**Interfaces:**
- Produces: `brand-brief-personal` — the brief the post-writer/post-grader load for personal-brand jobs. When active, the grader uses the VIRALITY rubric (not HLD's). Written to `brand-brief.md` at the start of a personal-brand job.

- [ ] **Step 1: Draft the brief from known facts**

Create `assets/seed-brains/sm-manager/brain/skills/brand-brief-personal/SKILL.md`:
```markdown
---
name: brand-brief-personal
description: Ryan's personal / Hand Lane AI creator brand brief — build-in-public voice, virality ON. Use for Ryan's personal-brand posts (AI/automation/build-in-public), NOT Hand Lane Designs store content.
allowed-tools: Read, Write, Edit, Glob
---

# Ryan / Hand Lane AI — Brand Brief (personal creator brand)

Use this for Ryan's PERSONAL / Hand Lane AI content. Unlike the HLD store brief,
this brand WANTS virality: contrarian wedge, receipts, build-in-public. When you
start a personal-brand job, write this to brand-brief.md so post-writer/post-grader
use it (and the grader applies the VIRALITY rubric, not HLD's).

> STARTER BRIEF — refine with Ryan (interview) before heavy use; do not fake depth.

**1. Business — what he does**
Hand Lane AI: solo AI automation, consulting, and SaaS for small/medium businesses,
built by someone who actually runs an operation (co-owns Hand Lane Designs). Tagline:
"Operational AI, built by operators."

**2. Audience — one real person**
An SMB owner or operator who is drowning in tools and AI hype and wants practical,
built-by-a-peer automation that actually ships — not enterprise theater.

**3. One action per post**
Follow / subscribe, or DM about a build. One CTA.

**4. Strong opinion / wedge (the viral fuel — REQUIRED)**
Operators beat consultants: AI advice from people who never ran the business is
theater. Ship small real automations over big decks. (Refine Ryan's sharpest takes
in the interview — this wedge drives the contrarian/receipts hooks.)

**5. Raw material**
Build-in-public: what Ryan actually built this week (e.g. this RyanOS social-media
agent), the numbers, what broke, what worked. Real receipts beat generic advice.

**6. Voice**
Direct, technical-but-plain, a little contrarian, receipts-driven. Show the work.
No corporate gloss, no hype-bro energy.

## Rules
- Virality ON: hook is ~50% of the grade (per post-grader default rubric). Lead with
  receipts / contrarian / stolen-lessons hooks from viral-hooks.
- Shared copy rules still apply: contractions, digits, NO em-dashes, active voice,
  one idea per post.
- Honesty: only claim what Ryan actually did/built. No invented metrics.
```

- [ ] **Step 2: Verify it selects the virality path**

Run:
```bash
cd /Users/ryannaquin/Code/damon-ade
grep -icE "virality ON|wedge|Operational AI, built by operators|build-in-public" \
  assets/seed-brains/sm-manager/brain/skills/brand-brief-personal/SKILL.md | xargs echo "anchors:"
```
Expected: ≥3 anchors present.

- [ ] **Step 3: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add assets/seed-brains/sm-manager/brain/skills/brand-brief-personal
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): brand-brief-personal (Hand Lane AI, virality ON)"
```

---

### Task 2: Author `content-calendar` skill (net-new; weekly plan per brand)

**Files:**
- Create: `assets/seed-brains/strategist/brain/skills/content-calendar/SKILL.md`

**Interfaces:**
- Produces: `content-calendar` — reads both brand briefs, produces the week's plan (themes, slots, which long-form to repurpose) into a vault note the Manager + Repurposer consume.

- [ ] **Step 1: Write the skill**

Create `assets/seed-brains/strategist/brain/skills/content-calendar/SKILL.md`:
```markdown
---
name: content-calendar
description: Plan a week of social content per brand — themes, angles, which products/long-form to cover, and which posting slots to target. Writes a plan note the SM Manager and Repurposer work from. Use for "plan my week", "content calendar", "what should we post this week".
allowed-tools: Read, Write, Edit, Glob
---

# Content Calendar

You plan a WEEK of content per brand. You do not write finished posts (post-writer
does) — you decide what to cover, in what mix, and when.

## When to Activate
- "Plan my content week", "content calendar", "what should we post this week", or the
  weekly batch run (Phase C cron) calls you.

## Inputs
- brand-brief-hld and/or brand-brief-personal (which brand(s) this week).
- Any long-form Ryan wants repurposed (hand off to the Repurposer).
- Seasonal context (holidays, back-to-school, product drops) and the Blotato posting
  slots (2/day × 7, Central — set at my.blotato.com/scheduler).

## Procedure
1. Confirm the brand(s) and how many posts this week (default: fill ~1 slot/day, not
   all 14 — sustainable beats maximal).
2. Draft a themed mix: e.g. HLD = product spotlights + gift-framing + seasonal; personal
   = 1 build-in-public receipt + 1 contrarian take + 1 how-to. Vary angles; no two
   near-identical posts.
3. For each slot: brand, platform(s), angle/theme, the product or long-form source, and
   whether it's a fresh write (post-writer) or a repurpose (Repurposer).
4. Write the plan to a vault note (see Verification path). Hand repurpose items to the
   Repurposer and fresh writes to the SM Manager.

## Verification
Write the plan to:
`/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/2. Areas/Social Media/Content Calendar/<YYYY-MM-DD>-week.md`
with one row per planned post (day, slot time, brand, platform, angle, source, write-vs-repurpose).
```

- [ ] **Step 2: Verify + create the calendar folder**

Run:
```bash
cd /Users/ryannaquin/Code/damon-ade
mkdir -p "/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/2. Areas/Social Media/Content Calendar"
head -4 assets/seed-brains/strategist/brain/skills/content-calendar/SKILL.md
```
Expected: valid frontmatter with `name: content-calendar`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add assets/seed-brains/strategist/brain/skills/content-calendar
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): content-calendar skill (weekly plan per brand)"
```

---

### Task 3: Author the Strategist brain

**Files:**
- Create: `assets/seed-brains/strategist/brain/persona.txt`
- Create: `assets/seed-brains/strategist/brain/context/CLAUDE.md`
- Create: `assets/seed-brains/strategist/brain/mcp.json`
- Copy: both brand briefs + `viral-hooks` into `assets/seed-brains/strategist/brain/skills/`

**Interfaces:**
- Consumes: `brand-brief-hld` (Phase A), `brand-brief-personal` (Task 1), `content-calendar` (Task 2), `viral-hooks`.
- Produces: the Strategist agent — plans the week per brand into the Content Calendar vault note. NO Blotato (planning only).

- [ ] **Step 1: Assemble the Strategist's skills**

Run:
```bash
cd /Users/ryannaquin/Code/damon-ade
SM=assets/seed-brains/sm-manager/brain/skills
ST=assets/seed-brains/strategist/brain/skills
mkdir -p "$ST"
cp -R "$SM/brand-brief-hld" "$SM/brand-brief-personal" "$SM/viral-hooks" "$ST/"
# content-calendar already created under strategist in Task 2
ls "$ST"
```
Expected: `brand-brief-hld  brand-brief-personal  content-calendar  viral-hooks`.

- [ ] **Step 2: Write `persona.txt`**

Create `assets/seed-brains/strategist/brain/persona.txt`:
```
You are the Strategist for Ryan's social media across two brands: Hand Lane Designs
(the engraving store) and Ryan's personal / Hand Lane AI brand.

## Profile
- You plan the WEEK, you don't write finished posts. You decide themes, angles, the
  product/long-form mix, and which posting slots to fill.
- Proactive: propose the plan, flag gaps (no content for a slot), keep both briefs current.

## Contract
- Use content-calendar to produce a weekly plan per brand into the vault Content
  Calendar folder. Hand repurpose items to the Repurposer and fresh writes to the SM
  Manager.
- Respect each brand's voice: HLD = warm craft-fair (virality OFF); personal = build-in-
  public, contrarian (virality ON).
- Sustainable beats maximal: plan ~1 post/day, not all 14 slots.
- You have NO publishing tools. You never schedule or publish.

## Memory
- Keep MEMORY.md current with what themes/angles worked and Ryan's planning preferences.
```

- [ ] **Step 2b: Write `context/CLAUDE.md`**

Create `assets/seed-brains/strategist/brain/context/CLAUDE.md`:
```markdown
# Strategist — Knowledge

## Brands
- HLD store: skill brand-brief-hld (virality OFF). Personal/Hand Lane AI: brand-brief-personal (virality ON).

## How to work
- Skills: content-calendar (your main tool), brand-brief-hld, brand-brief-personal, viral-hooks.
- Output: weekly plan note at vault `2. Areas/Social Media/Content Calendar/<date>-week.md`.
- Posting slots: 2/day × 7 (Central), set in Blotato. Plan into them; don't overfill.

## Handoffs
- Repurpose items → Repurposer agent. Fresh writes → SM Manager. You never publish.

## Sources of truth (point, do not copy)
- HLD facts/voice: user_hld-brand-facts, hld-admin brand-voice/product-facts.
- Design: docs/superpowers/specs/2026-07-07-ryanos-social-media-team-design.md
```

- [ ] **Step 2c: Write `mcp.json` (no tools)**

Create `assets/seed-brains/strategist/brain/mcp.json`:
```json
{ "mcpServers": {} }
```

- [ ] **Step 3: Verify shapes**

Run:
```bash
cd /Users/ryannaquin/Code/damon-ade
B=assets/seed-brains/strategist/brain
test -f "$B/persona.txt" && test -f "$B/context/CLAUDE.md" && python3 -c "import json;json.load(open('$B/mcp.json'))" && echo "strategist-brain-ok"
wc -c "$B/persona.txt"
```
Expected: `strategist-brain-ok`, persona under ~1500 bytes.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add assets/seed-brains/strategist
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): author Strategist brain (weekly planner, no publish)"
```

---

### Task 4: Author the Repurposer brain

**Files:**
- Create: `assets/seed-brains/repurposer/brain/persona.txt`
- Create: `assets/seed-brains/repurposer/brain/context/CLAUDE.md`
- Create: `assets/seed-brains/repurposer/brain/mcp.json`
- Copy: `repurpose`, `viral-hooks`, `post-grader`, `brand-brief-hld`, `brand-brief-personal` into `assets/seed-brains/repurposer/brain/skills/`

**Interfaces:**
- Consumes: a long-form input (transcript/blog/URL/notes) + the active brand brief.
- Produces: the Repurposer agent — 1 long piece → 3 LinkedIn + 5 X threads + 2 short-form scripts, each auto-graded, handed to the SM Manager's approval queue. NO Blotato (drafts only).

- [ ] **Step 1: Assemble the Repurposer's skills**

Run:
```bash
cd /Users/ryannaquin/Code/damon-ade
SM=assets/seed-brains/sm-manager/brain/skills
RP=assets/seed-brains/repurposer/brain/skills
mkdir -p "$RP"
cp -R "$SM/repurpose" "$SM/viral-hooks" "$SM/post-grader" "$SM/brand-brief-hld" "$SM/brand-brief-personal" "$RP/"
ls "$RP"
```
Expected: `brand-brief-hld  brand-brief-personal  post-grader  repurpose  viral-hooks`.

- [ ] **Step 2: Write `persona.txt`**

Create `assets/seed-brains/repurposer/brain/persona.txt`:
```
You are the Repurposer for Ryan's social content across two brands (Hand Lane Designs
store; Ryan's personal / Hand Lane AI brand).

## Profile
- You take ONE long-form piece Ryan gives you (a YouTube transcript, blog, newsletter,
  session notes, or a URL to fetch) and turn it into a week of platform-native posts.
- You draft only. You do NOT publish and you have no Blotato tools.

## Contract
- Input is RYAN'S OWN long-form content, not inbound clippings. If given a URL, fetch/read it.
- Pick the brand first and load its brief (brand-brief-hld = virality OFF; brand-brief-
  personal = virality ON). Use repurpose → open every output with a viral-hooks hook →
  auto-grade each with post-grader to 8+/10 for that brand's rubric.
- Hand the graded drafts to the SM Manager's approval queue (write them to the vault
  Approval Queue as pending). NEVER publish or schedule.
- Respect product-facts for HLD; honesty (no invented metrics) for personal.

## Memory
- Keep MEMORY.md current with repurposing patterns that landed and Ryan's format prefs.
```

- [ ] **Step 2b: Write `context/CLAUDE.md`**

Create `assets/seed-brains/repurposer/brain/context/CLAUDE.md`:
```markdown
# Repurposer — Knowledge

## Job
1 long-form input → 3 LinkedIn + 5 X threads + 2 short-form scripts, each graded, all
queued for approval. Draft only; the SM Manager publishes.

## Input sources (Ryan's OWN content)
- A YouTube transcript / video URL, a blog post, a newsletter, or session notes Ryan provides.
- NOT Clip Scout output (that triages inbound clippings into build-pitches — different purpose).
  Only touch a clipping if it is genuinely Ryan's content to redistribute.

## Brands + rubric
- HLD store: brand-brief-hld (virality OFF, product-facts guardrail). Personal: brand-brief-personal (virality ON).

## Output
- Write each graded draft to the vault Approval Queue
  (`2. Areas/Social Media/Approval Queue/`) as status: pending, tagged with brand + platform.

## Sources of truth (point, do not copy)
- Design: docs/superpowers/specs/2026-07-07-ryanos-social-media-team-design.md
```

- [ ] **Step 2c: Write `mcp.json` (no tools)**

Create `assets/seed-brains/repurposer/brain/mcp.json`:
```json
{ "mcpServers": {} }
```

- [ ] **Step 3: Verify shapes**

Run:
```bash
cd /Users/ryannaquin/Code/damon-ade
B=assets/seed-brains/repurposer/brain
test -f "$B/persona.txt" && test -f "$B/context/CLAUDE.md" && python3 -c "import json;json.load(open('$B/mcp.json'))" && echo "repurposer-brain-ok"
```
Expected: `repurposer-brain-ok`.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryannaquin/Code/damon-ade
git add assets/seed-brains/repurposer
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): author Repurposer brain (long-form -> week of posts, draft only)"
```

---

### Task 5: Wire + verify two-brand switching on the SM Manager

**Files:**
- (No new files — `brand-brief-personal` was added to the SM Manager in Task 1.)

**Interfaces:**
- Consumes: `brand-brief-personal` (Task 1) now present in the SM Manager's skills.
- Produces: verified behavior — a personal-brand post is graded on the VIRALITY rubric, an HLD post on the HLD rubric.

- [ ] **Step 1: Refresh the discoverable skills for a test run**

Run:
```bash
RUN=/tmp/sm-manager-run; mkdir -p "$RUN/.claude/skills"
for d in /Users/ryannaquin/Code/damon-ade/assets/seed-brains/sm-manager/brain/skills/*/; do
  ln -sfn "$d" "$RUN/.claude/skills/$(basename "$d")"
done
ls "$RUN/.claude/skills" | grep -E "brand-brief-personal|brand-brief-hld"
```
Expected: both briefs present.

- [ ] **Step 2: Run a personal-brand post and confirm the virality rubric**

Run (a real build-in-public angle — e.g. "I built an AI social-media manager for my engraving shop in a day"):
```bash
cd /tmp/sm-manager-run
B=/Users/ryannaquin/Code/damon-ade/assets/seed-brains/sm-manager/brain
claude --append-system-prompt-file "$B/persona.txt" --add-dir "$B/context" --dangerously-skip-permissions \
  -p 'Write ONE LinkedIn post for RYAN'\''S PERSONAL / Hand Lane AI brand (NOT the store) about: "I built an AI social-media manager for my engraving shop in a day, and it schedules posts in my own voice." Load brand-brief-personal, use post-writer, grade with post-grader. Then STATE which rubric post-grader used (virality vs HLD) and why. Do not publish or schedule.'
```
Expected: it loads `brand-brief-personal`, and post-grader explicitly uses the **virality** rubric (hook ~50%, contrarian/receipts), NOT the HLD rubric. If it uses the HLD rubric, fix the brand selector wording in `post-grader` / `brand-brief-personal` and re-run.

- [ ] **Step 3: Spot-check HLD still uses the HLD rubric**

Confirm from the Phase A run (or a quick re-run) that an HLD store post still grades on the HLD rubric (virality OFF). No code change expected — this is a regression check that Task 1 didn't disturb HLD routing.

- [ ] **Step 4: No commit** (verification only; any fix needed gets its own commit).

---

### Task 6: End-to-end — one long-form piece → a graded week of posts (the Phase B proof)

**Files:**
- Runtime only: discoverable skills for the Repurposer + queued approval notes.

**Interfaces:**
- Consumes: the Repurposer brain (Task 4) + a real long-form input.
- Produces: 3 LinkedIn + 5 X threads + 2 short-form scripts from one input, each graded 8+/10, all queued as `pending` in the Approval Queue — the Phase B success criterion.

- [ ] **Step 1: Set up the Repurposer run dir**

Run:
```bash
RUN=/tmp/repurposer-run; rm -rf "$RUN"; mkdir -p "$RUN/.claude/skills"
for d in /Users/ryannaquin/Code/damon-ade/assets/seed-brains/repurposer/brain/skills/*/; do
  ln -sfn "$d" "$RUN/.claude/skills/$(basename "$d")"
done
ls "$RUN/.claude/skills"
```
Expected: repurpose, viral-hooks, post-grader, brand-brief-hld, brand-brief-personal.

- [ ] **Step 2: Provide a real long-form input**

Pick one real source Ryan has: a YouTube transcript, a blog post, or (simplest for the test) the text of a recent build-in-public session. Save it to `/tmp/repurposer-run/source.md`. (If none is handy, use a 400-600 word write-up of today's "built an AI social-media agent" story as the personal-brand source.)

- [ ] **Step 3: Run the Repurposer end-to-end**

Run:
```bash
cd /tmp/repurposer-run
B=/Users/ryannaquin/Code/damon-ade/assets/seed-brains/repurposer/brain
claude --append-system-prompt-file "$B/persona.txt" --add-dir "$B/context" --dangerously-skip-permissions \
  -p 'Brand: personal / Hand Lane AI. Read source.md in this directory and repurpose it: load brand-brief-personal, produce 3 LinkedIn posts, 5 X threads, and 2 short-form video scripts, open each with a viral-hooks hook, and auto-grade each with post-grader (virality rubric) to 8+/10. QUEUE every output as a separate pending note in the vault Approval Queue folder (do NOT publish or schedule). Print a summary table: type | angle | score | queue-note filename.'
```
Expected: 10 graded outputs, each queued as a pending note. No Blotato call.

- [ ] **Step 4: Verify the outputs**

Run (list the new queue notes):
```bash
ls -1 "/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/2. Areas/Social Media/Approval Queue/" | tail -12
```
Expected: the new Repurposer notes present. Read 2-3 to confirm: on-brand for the personal voice, graded 8+, `status: pending`, no publish occurred.

- [ ] **Step 5: No commit** (runtime artifacts). Phase B complete — proceed to `wrap` and update the design/STATUS to mark Phase B done.

---

## Self-Review

**Spec coverage (design §2, §3, §8 Phase B):**
- Repurposer agent → Task 4 + end-to-end Task 6. ✓
- Strategist agent + content-calendar → Tasks 2-3. ✓
- brand-brief-personal (second brand) → Task 1; two-brand switching verified → Task 5. ✓
- "1 long-form → week of posts" validation → Task 6. ✓
- Repurposer/Strategist hold NO Blotato (draft/plan only) → mcp.json `{}` in Tasks 3-4. ✓
- Phase C items (seed, cron, Telegram digest) correctly excluded. ✓

**Placeholder scan:** The one deliberate "fill from Ryan" is `brand-brief-personal`'s wedge/voice (marked STARTER — refine by interview, same honesty rule as 2B-2 greenfield); it ships usable, not blank. Task 6's source input is "a real long-form piece Ryan has, else a 400-600 word write-up of today's story" — concrete fallback, not a TODO.

**Type/name consistency:** skill folder names (`brand-brief-personal`, `content-calendar`, `repurpose`, `viral-hooks`, `post-grader`) and brain paths (`persona.txt`, `context/CLAUDE.md`, `mcp.json`) are identical across tasks and match the Phase A / `agent-scaffold.ts` contract. Repurposer/Strategist `mcp.json` are both `{ "mcpServers": {} }` (no publish), consistent with the "only SM Manager publishes" invariant.
