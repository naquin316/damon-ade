# RyanOS Social Media Team — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up and prove the SM Manager loop — one real Hand Lane Designs store post authored in HLD's craft-fair voice, self-graded against the HLD rubric, held at an approval gate, and (only on approval) scheduled through Blotato.

**Architecture:** Author a single RyanOS agent brain (the SM Manager) in the exact seed-asset shape RyanOS already consumes (`assets/seed-brains/<slug>/brain/` = `persona.txt` + `context/CLAUDE.md` + `mcp.json` + `skills/`), by forking Blotato's free 7-skill pack and making the HLD-specific edits (voice brief from hld-admin's `brand-voice`/`product-facts`, HLD grader rubric, gated scheduler). Prove it by launching a `claude` session with the same injection flags RyanOS's `buildAgentLaunchCommand` emits, plus the Blotato MCP. No RyanOS Electron/seed code changes in Phase A — that wiring is Phase C.

**Tech Stack:** Markdown SKILL.md files (agentskills.io format), JSON (mcp.json/settings.json), Blotato remote MCP (`https://mcp.blotato.com/mcp`), Claude Code CLI launch flags. This is a content-authoring + integration plan: most tasks verify **behaviorally** (does the skill load, does the grader reject a banned cliché, does the scheduler refuse to publish un-approved) rather than via unit tests.

## Global Constraints

- **Repo:** `~/Code/damon-ade`. Solo repo, commits go direct to `main` and MUST be prefixed `BRAYNEE_ALLOW_MAIN_COMMITS=1` to pass the pre-commit guard.
- **Approval gate is mandatory.** Nothing publishes to any live account without explicit approval. The scheduler must NEVER call a Blotato publish/schedule tool on an un-approved item. This is a hard contract rule in the persona.
- **HLD voice (Phase A brand):** warm Texas maker at a craft fair, concrete over hype, gift-framing, zero corporate gloss. Virality tuning is OFF for HLD.
- **HLD banned clichés (hard grader fails):** "elevate", "look no further", "premium quality" (unqualified), "perfect for any occasion", "makes a statement", "sleek and stylish", "crafted with care", em-dash-heavy AI cadence, three adjectives in a row.
- **HLD brand facts (hard fails if wrong):** location is **New Braunfels, TX** (never Round Rock); craft term is **"hand-engraved"**; **no fabricated product claims/attributes**; customer-facing visuals must match the storefront style.
- **Shared copy rules (both brands):** contractions, digits-not-words ("3 tips"), NO em-dashes, active voice, short sentences, one concrete idea per post.
- **Blotato MCP:** `https://mcp.blotato.com/mcp`. Only the SM Manager brain carries it.
- **Brain seed-asset shape (must match `agent-scaffold.ts` `authoredBrainDir` contract):** `persona.txt`, `context/CLAUDE.md`, `mcp.json`, `skills/<name>/SKILL.md`. `MEMORY.md` is NEVER authored (learned-only).
- **RyanOS launch flags (from `apps/desktop/src/main/lib/agent-launch.ts`), the shape the Phase A manual test mirrors:**
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --model 'claude-opus-4-8[1m]' --settings <settings.json> --append-system-prompt-file <persona.txt> --add-dir <context> --mcp-config <mcp.json> --strict-mcp-config --dangerously-skip-permissions`
- **Skills are NOT loadable by flag** (per `agent-scaffold.ts`): Claude Code discovers skills only under `<cwd>/.claude/skills/` or `~/.claude/skills/`. The Phase A test installs the brain's skills to a discoverable location.

---

### Task 1: Fork the Blotato pack into the SM Manager seed asset

**Files:**
- Create: `assets/seed-brains/sm-manager/brain/skills/{content-coach,brand-brief,post-writer,post-grader,post-scheduler,viral-hooks,repurpose}/SKILL.md` (7 folders, from the ZIP)
- Create: `assets/seed-brains/sm-manager/README.md` (provenance note)

**Interfaces:**
- Produces: the 7 forked skill folders that Tasks 2-4 edit and Task 5's brain references.

- [ ] **Step 1: Download and unzip the pack**

Run:
```bash
cd ~/Code/damon-ade
mkdir -p /tmp/blotato-pack && cd /tmp/blotato-pack
curl -L -o pack.zip "https://2374509648-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FevfU9S4Nh53PiGflQLah%2Fuploads%2Fgit-blob-9d23ca667660ba8044c8dbe3e30631af9e7119c0%2Fblotato-content-pack.zip?alt=media"
unzip -o pack.zip
ls -R
```
Expected: 7 folders each containing a `SKILL.md` (content-coach, brand-brief, post-writer, post-grader, post-scheduler, viral-hooks, repurpose). If the URL 404s (GitBook rotates asset URLs), re-fetch the current link from `https://help.blotato.com/claude-skills/claude-skills` (the "Download all 7 skills" block) and retry.

- [ ] **Step 2: Copy the 7 skills into the seed asset**

Run:
```bash
cd ~/Code/damon-ade
mkdir -p assets/seed-brains/sm-manager/brain/skills
# copy each skill folder (adjust source path to the unzipped layout from Step 1)
cp -R /tmp/blotato-pack/*/ assets/seed-brains/sm-manager/brain/skills/ 2>/dev/null || \
  cp -R /tmp/blotato-pack/blotato-content-pack/*/ assets/seed-brains/sm-manager/brain/skills/
ls assets/seed-brains/sm-manager/brain/skills/
```
Expected: the 7 skill folders present under the seed asset.

- [ ] **Step 3: Write the provenance README**

Create `assets/seed-brains/sm-manager/README.md`:
```markdown
# SM Manager — seed brain

Forked from Blotato's free "content creator pack" (help.blotato.com/claude-skills),
downloaded 2026-07-07. We fork (not reference) so we can HLD-tune the skills and
survive upstream changes. HLD-specific edits live in:
- skills/brand-brief-hld  (Task 2 — HLD voice, not Blotato's generic brief)
- skills/post-grader      (Task 3 — per-brand rubric; HLD virality OFF)
- skills/post-scheduler   (Task 4 — approval gate before Blotato)

Design: docs/superpowers/specs/2026-07-07-ryanos-social-media-team-design.md
```

- [ ] **Step 4: Verify each SKILL.md has valid frontmatter**

Run:
```bash
cd ~/Code/damon-ade
for f in assets/seed-brains/sm-manager/brain/skills/*/SKILL.md; do
  echo "== $f =="; head -5 "$f"
done
```
Expected: every file opens with `---` frontmatter containing `name:` and `description:`.

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/sm-manager
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): fork Blotato 7-skill pack into SM Manager seed asset"
```

---

### Task 2: Author the HLD brand brief from Ryan's real voice skills

**Files:**
- Read (source): `~/Code/hld-admin/.claude/skills/brand-voice/SKILL.md`, `~/Code/hld-admin/.claude/skills/product-facts/SKILL.md`
- Create: `assets/seed-brains/sm-manager/brain/skills/brand-brief-hld/SKILL.md`

**Interfaces:**
- Consumes: hld-admin's `brand-voice` + `product-facts` skills (the proven, listing-trained HLD voice).
- Produces: `brand-brief-hld` — the brief the post-writer and post-grader load for HLD jobs. Trigger phrase: "use the HLD brand brief" / auto-selected when the target is an HLD store account.

- [ ] **Step 1: Read the source voice skills**

Run:
```bash
cat ~/Code/hld-admin/.claude/skills/brand-voice/SKILL.md
cat ~/Code/hld-admin/.claude/skills/product-facts/SKILL.md
```
Expected: the craft-fair voice rules, banned-cliché list, gift-framing guidance, and product facts. Use these as the source of truth — distill, don't invent.

- [ ] **Step 2: Write `brand-brief-hld/SKILL.md`**

Create the file with this content (fill the Product facts section from Step 1's `product-facts` output; the voice section below is distilled from the real `brand-voice` skill):
```markdown
---
name: brand-brief-hld
description: Hand Lane Designs brand brief — voice, facts, and rules for HLD store posts
---

# Hand Lane Designs — Brand Brief (store)

Use this brief for every Hand Lane Designs STORE post. It is the HLD side of the
social team. Source of truth: `~/Code/hld-admin/.claude/skills/brand-voice` and
`product-facts` — refresh from there when they change.

## Business
- Custom laser engraving shop, run by Ryan Naquin (with wife Meredith).
- Location: **New Braunfels, TX** (NEVER "Round Rock").
- Sells on Shopify + Etsy. Trotec Speedy 360 laser.

## Customer
- Mostly buying a GIFT for someone else. Name the moment: Father's Day,
  graduation, reunion, coach gift, wedding, "just because".

## Voice (warm Texas maker, not a marketing department)
- Sound like Ryan talking to a customer at a craft fair: warm, direct, proud of
  the work, zero corporate gloss.
- Concrete over hype. Say what it is, what it's made of, who it's for. Let the
  product carry the excitement.
- Personal touch is the product: engraving is **permanent** (never a sticker,
  never fades) and makes it one-of-a-kind. The craft term is **"hand-engraved"**.
- A little folksy is on-brand ("holds ice for days", "built for the deer lease or
  the office"). Playful, specific title flair is good ("...for Dads on the Go!").

## Hard rules (a post that breaks any of these is rejected)
- Banned clichés: "elevate", "look no further", "premium quality" (unqualified),
  "perfect for any occasion", "makes a statement", "sleek and stylish",
  "crafted with care", em-dash-heavy AI cadence, three adjectives in a row.
- Never say Round Rock. Never invent product attributes or claims.
- Shared copy rules: contractions, digits not words, NO em-dashes, active voice,
  short sentences (buyer skims on a phone), one idea per post.

## CTA
- Drive to the store / DM for custom orders. Gift-framing beats "what do you think?"

## Product facts
- (Distill the current product list + attributes from
  `~/Code/hld-admin/.claude/skills/product-facts`. Do NOT fabricate; if a fact
  isn't in that source, leave it out.)
```

- [ ] **Step 3: Verify the brief carries the non-negotiables**

Run:
```bash
cd ~/Code/damon-ade
grep -iE "New Braunfels|hand-engraved|craft fair|banned clich" \
  assets/seed-brains/sm-manager/brain/skills/brand-brief-hld/SKILL.md
```
Expected: matches for New Braunfels, hand-engraved, craft fair, and the banned-cliché line.

- [ ] **Step 4: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/sm-manager/brain/skills/brand-brief-hld
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): HLD brand brief distilled from hld-admin brand-voice"
```

---

### Task 3: Give post-grader a per-brand rubric (HLD virality OFF)

**Files:**
- Modify: `assets/seed-brains/sm-manager/brain/skills/post-grader/SKILL.md`

**Interfaces:**
- Consumes: the active brand brief (brand-brief-hld for HLD).
- Produces: a grader that selects its rubric by brand, keeps Blotato's loop-to-8+/10 mechanism, and hard-fails HLD banned clichés / brand-fact errors.

- [ ] **Step 1: Read the forked grader to learn its structure**

Run: `cat assets/seed-brains/sm-manager/brain/skills/post-grader/SKILL.md`
Expected: Blotato's virality rubric (hook ≈50%, curiosity, share-worthiness, etc.), the 8+/10 loop, and the top-3-fixes output. Note the section headings so the edit fits its shape.

- [ ] **Step 2: Insert a brand-selector + HLD rubric near the top of the grader body**

Add this section immediately after the skill's intro (keep the rest of Blotato's mechanism intact):
```markdown
## Brand rubric selector (READ FIRST)

Grade against the rubric for the ACTIVE brand. The mechanism is the same
(score, list the top 3 fixes, loop until 8+/10); the rubric differs.

### HLD (Hand Lane Designs store) — virality OFF
Load `brand-brief-hld`. This brand does NOT want viral growth-hacker energy.
- HARD FAILS (auto-reject, score them 0, must be fixed before any other scoring):
  - any banned cliché ("elevate", "look no further", "premium quality" unqualified,
    "perfect for any occasion", "makes a statement", "sleek and stylish",
    "crafted with care"), em-dash-heavy AI cadence, or three adjectives in a row
  - wrong location (anything other than New Braunfels, TX)
  - wrong craft term (must be "hand-engraved")
  - any invented product attribute or claim not in `brand-brief-hld` product facts
- SCORED DIMENSIONS (after hard fails pass): warmth (sounds like a real maker),
  concreteness (says what it is / made of / who it's for), gift-framing,
  permanence-of-engraving mentioned or implied, platform fit. Optimize for
  trust and "a real person made this", NOT reach.

### Personal / Hand Lane AI — virality ON
Load `brand-brief-personal` (added in Phase B). Use Blotato's default virality
rubric below (hook ≈50%, curiosity, share-worthiness, polarity, platform fit).

## Blotato virality rubric (personal brand default)
<!-- the original forked rubric content stays here, unchanged -->
```

Wrap the pre-existing Blotato rubric text under the `## Blotato virality rubric` heading so the HLD path clearly does not use it.

- [ ] **Step 3: Behavioral verify — grader hard-fails a cliché draft (dry run)**

Run a throwaway Claude turn (or a manual read-through if not yet launchable): give the grader this HLD draft and confirm it hard-fails on the banned cliché and the wrong town:
> "Elevate your morning with our premium quality tumbler, hand-crafted with care in Round Rock, TX."
Expected reasoning: rejects for "elevate", "premium quality", "crafted with care", AND "Round Rock" → score 0, must fix. (Full end-to-end run happens in Task 7; this step just confirms the rubric text makes the failure unambiguous on read.)

- [ ] **Step 4: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/sm-manager/brain/skills/post-grader/SKILL.md
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): per-brand grader rubric, HLD banned clichés as hard fails"
```

---

### Task 4: Gate the post-scheduler (draft → approve → schedule)

**Files:**
- Modify: `assets/seed-brains/sm-manager/brain/skills/post-scheduler/SKILL.md`

**Interfaces:**
- Consumes: a graded (8+/10) post + its target platform(s).
- Produces: an approval-queue vault note + an approval request; a Blotato schedule call that fires ONLY after explicit approval.

- [ ] **Step 1: Read the forked scheduler**

Run: `cat assets/seed-brains/sm-manager/brain/skills/post-scheduler/SKILL.md`
Expected: it calls the Blotato MCP to schedule immediately, with a file-fallback when Blotato isn't connected. We insert a gate BEFORE the Blotato call.

- [ ] **Step 2: Rewrite the scheduler's flow to gate before Blotato**

Replace the "schedule now" flow with this gated flow (keep the Blotato tool call details the forked skill already documents; only change WHEN they fire):
```markdown
## Publishing is GATED — never publish un-approved

You MUST NOT call any Blotato schedule/publish tool until the operator has
explicitly approved THIS specific post. The flow is always:

1. Confirm the post is graded 8+/10 for its brand rubric. If not, send it back
   to post-writer/post-grader first.
2. Write the post to the approval queue:
   - File: `<VAULT>/2. Areas/Social Media/Approval Queue/<YYYY-MM-DD>-<slug>.md`
     (create the folder if missing). Include: brand, target platform(s),
     final copy, grade + rubric notes, and the intended schedule time.
3. Emit an approval request to the operator:
   - Always: print the queued post + ask "Approve and schedule? (reply approved / edit / skip)".
   - Optional phone ping: if `HLD_APPROVALS_BOT_TOKEN` and `HLD_APPROVALS_CHAT_ID`
     are set in the environment, POST a one-line notice to
     `https://api.telegram.org/bot$HLD_APPROVALS_BOT_TOKEN/sendMessage`
     (send-only notification, NOT tap-to-approve — that bot is Phase C).
     If the vars are unset, skip silently.
4. WAIT. Only when the operator replies "approved" do you call the Blotato
   schedule tool for the queued post. On "edit", revise and re-queue. On
   "skip", mark the queue note skipped and stop.
5. After a successful Blotato schedule, update the queue note status to
   `scheduled` with the returned Blotato id/time.

If Blotato isn't connected, fall back to leaving the approved post in the queue
note marked `approved — publish manually` (do not silently drop it).
```

- [ ] **Step 3: Behavioral verify — scheduler refuses to publish without approval**

Confirm by reading: the skill must have no path where a Blotato schedule/publish tool is called before an explicit "approved". Grep for the guard:
```bash
grep -iE "never publish un-approved|Approve and schedule|only when the operator replies" \
  assets/seed-brains/sm-manager/brain/skills/post-scheduler/SKILL.md
```
Expected: all three phrases present.

- [ ] **Step 4: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/sm-manager/brain/skills/post-scheduler/SKILL.md
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): gate post-scheduler behind explicit approval (queue + optional TG ping)"
```

---

### Task 5: Author the SM Manager brain (persona / context / mcp)

**Files:**
- Create: `assets/seed-brains/sm-manager/brain/persona.txt`
- Create: `assets/seed-brains/sm-manager/brain/context/CLAUDE.md`
- Create: `assets/seed-brains/sm-manager/brain/mcp.json`

**Interfaces:**
- Consumes: the skills authored in Tasks 1-4.
- Produces: the injected brain (Profile+Contract via `--append-system-prompt-file`; Knowledge via `--add-dir`; Blotato tool via `--mcp-config`) — the exact files `agent-scaffold.ts`'s `authoredBrainDir` contract expects.

- [ ] **Step 1: Write `persona.txt` (Profile + Contract, keep tight)**

Create `assets/seed-brains/sm-manager/brain/persona.txt`:
```
You are the SM Manager, Ryan's social media editor-in-chief for two brands:
Hand Lane Designs (the engraving store) and Ryan's personal / Hand Lane AI brand.

## Profile
- You run the pipeline: pick the brand, write, self-grade, and queue for approval.
- Warm and concrete for HLD; sharper and hook-forward for the personal brand.
- Proactive: propose the post and the schedule, don't wait to be told every detail.

## Contract — HARD rules
- Pick the brand FIRST. Load brand-brief-hld for HLD store posts; use its voice,
  facts, and banned-cliché list. HLD virality is OFF — never growth-hacker HLD.
- Grade every post with post-grader against the ACTIVE brand's rubric; loop to 8+/10.
- NEVER call a Blotato schedule/publish tool on a post that has not been explicitly
  approved by Ryan. Gate every post through post-scheduler's approval queue.
- HLD brand facts are non-negotiable: New Braunfels TX (never Round Rock),
  "hand-engraved", no invented product claims.
- Shared copy rules always: contractions, digits, no em-dashes, active voice,
  one idea per post.

## Memory
- Keep MEMORY.md current with learned brand/voice preferences and corrections.
```

- [ ] **Step 2: Write `context/CLAUDE.md` (Knowledge pointers, self-contained, no @-import)**

Create `assets/seed-brains/sm-manager/brain/context/CLAUDE.md`:
```markdown
# SM Manager — Knowledge

## Brands
- HLD store voice + facts: skill `brand-brief-hld` (source of truth:
  ~/Code/hld-admin/.claude/skills/brand-voice and product-facts).
- Personal / Hand Lane AI voice: skill `brand-brief-personal` (Phase B).

## How to work
- Skills: content-coach (front door), post-writer, post-grader (per-brand rubric),
  post-scheduler (gated), viral-hooks, repurpose. Type "/" to list them.
- Publishing hands: Blotato MCP (only this agent holds it). Accounts are connected
  in Blotato settings.

## Sources of truth (point, do not copy)
- HLD brand facts: vault memory `user_hld-brand-facts`.
- HLD voice/products: hld-admin skills brand-voice, product-facts.
- Approval gate + design: docs/superpowers/specs/2026-07-07-ryanos-social-media-team-design.md
```

- [ ] **Step 3: Write `mcp.json` (Blotato only)**

Create `assets/seed-brains/sm-manager/brain/mcp.json`:
```json
{
  "mcpServers": {
    "blotato": {
      "url": "https://mcp.blotato.com/mcp"
    }
  }
}
```
(Task 6 adds any auth header Blotato's MCP setup doc specifies.)

- [ ] **Step 4: Verify shapes**

Run:
```bash
cd ~/Code/damon-ade
test -f assets/seed-brains/sm-manager/brain/persona.txt && echo persona-ok
test -f assets/seed-brains/sm-manager/brain/context/CLAUDE.md && echo context-ok
python3 -c "import json;json.load(open('assets/seed-brains/sm-manager/brain/mcp.json'));print('mcp-json-ok')"
wc -c assets/seed-brains/sm-manager/brain/persona.txt
```
Expected: `persona-ok`, `context-ok`, `mcp-json-ok`, and persona.txt comfortably under ~1500 bytes (it appends to the system prompt).

- [ ] **Step 5: Commit**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/sm-manager/brain/persona.txt assets/seed-brains/sm-manager/brain/context assets/seed-brains/sm-manager/brain/mcp.json
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "feat(social): author SM Manager brain (persona, knowledge, Blotato mcp)"
```

---

### Task 6: (HUMAN) Connect Blotato accounts + wire MCP auth

**Files:**
- Modify (if the setup doc requires an auth header/token): `assets/seed-brains/sm-manager/brain/mcp.json`

> This task needs Ryan. It touches live Blotato account connections and secrets. Do the human steps, then capture the exact MCP auth config.

- [ ] **Step 1: Connect accounts + generate API key (Ryan, in Blotato)**

In Blotato: Settings → connect the HLD social accounts (and, for later, the personal-brand accounts) → API tab → **Generate API Key**. Keep the key handy for Step 2.

- [ ] **Step 2: Read Blotato's MCP setup doc and wire auth**

Fetch and follow `https://help.blotato.com/api/mcp/setup` (and `https://help.blotato.com/api/claude-code`). Determine how the remote MCP authenticates for a `--mcp-config` launch (OAuth connect vs. an API-key header). If it needs a header, update `mcp.json` accordingly, e.g.:
```json
{ "mcpServers": { "blotato": { "url": "https://mcp.blotato.com/mcp", "headers": { "Authorization": "Bearer <BLOTATO_API_KEY>" } } } }
```
Store the key via an env-substituted value or a local settings file — do NOT commit the raw key. If the key would land in `mcp.json`, keep that file out of git (add to `.gitignore`) and commit only a `mcp.json.example`.

- [ ] **Step 3: Verify the MCP connects**

Launch a throwaway `claude` with just the Blotato MCP and ask it to list accounts:
```bash
claude --mcp-config ~/Code/damon-ade/assets/seed-brains/sm-manager/brain/mcp.json --strict-mcp-config \
  -p "What social media accounts do I have?"
```
Expected: Blotato returns Ryan's connected HLD accounts. If it lists them, auth is wired. If it errors, re-check the setup doc's auth step before proceeding.

- [ ] **Step 4: Commit (config only, never the key)**

```bash
cd ~/Code/damon-ade
git add assets/seed-brains/sm-manager/brain/mcp.json* .gitignore 2>/dev/null
BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit -m "chore(social): wire Blotato MCP auth (key kept out of git)" || echo "nothing to commit"
```

---

### Task 7: End-to-end proof — one real HLD store post through the gate

**Files:**
- Create (runtime, not committed): a test working dir + discoverable skills install
- Create (runtime): the approval-queue note the scheduler writes

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: one real HLD post, graded 8+/10 in HLD voice, approved, and scheduled in Blotato — the Phase A success criterion.

- [ ] **Step 1: Make the brain's skills discoverable + set up a working dir**

Run:
```bash
# install the forked/edited skills where Claude Code can discover them
mkdir -p ~/.claude/skills
for d in ~/Code/damon-ade/assets/seed-brains/sm-manager/brain/skills/*/; do
  name=$(basename "$d"); ln -sfn "$d" ~/.claude/skills/"$name"
done
ls ~/.claude/skills | grep -E "brand-brief-hld|post-grader|post-scheduler|content-coach"
# a scratch working dir for the session
mkdir -p /tmp/sm-manager-run && cd /tmp/sm-manager-run
```
Expected: the social skills are symlinked into `~/.claude/skills`.

- [ ] **Step 2: Launch the SM Manager with the RyanOS injection flags**

Run (mirrors `buildAgentLaunchCommand`; the settings.json is optional for the manual test — omit it or point at a minimal one):
```bash
cd /tmp/sm-manager-run
B=~/Code/damon-ade/assets/seed-brains/sm-manager/brain
CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude \
  --model 'claude-opus-4-8[1m]' \
  --append-system-prompt-file "$B/persona.txt" \
  --add-dir "$B/context" \
  --mcp-config "$B/mcp.json" --strict-mcp-config \
  --dangerously-skip-permissions
```
Expected: an interactive Claude session that has the SM Manager persona, the Blotato MCP, and the social skills available (`/` lists them).

- [ ] **Step 3: Drive the real post**

In the session, pick a REAL current HLD product (from `product-facts`) and prompt:
> "Write an Instagram post about the [real product] for the Hand Lane Designs store."
Expected behavior: it loads `brand-brief-hld`, drafts in the craft-fair voice, auto-runs post-grader against the HLD rubric, and loops to 8+/10.

- [ ] **Step 4: Verify the draft is on-brand (the gate's whole point)**

Check the produced post by eye AND with a grep against the copy you paste into a temp file:
```bash
# paste the final post into /tmp/sm-manager-run/post.txt first, then:
grep -iE "elevate|premium quality|makes a statement|crafted with care|round rock|—" /tmp/sm-manager-run/post.txt \
  && echo "FAIL: off-brand phrase present" || echo "PASS: no banned phrases"
```
Expected: `PASS: no banned phrases`. The post should sound like a Texas maker, name a gift moment, and say "hand-engraved" / New Braunfels where relevant.

- [ ] **Step 5: Verify the approval gate holds**

Ask the session to schedule it:
> "Schedule this to Instagram."
Expected: it does NOT publish. It writes the approval-queue note and asks "Approve and schedule?". Confirm the queue note exists:
```bash
ls "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/2. Areas/Social Media/Approval Queue/"
```
Expected: a dated queue note for this post. (If `HLD_APPROVALS_BOT_TOKEN`/`HLD_APPROVALS_CHAT_ID` are set, a Telegram notice also arrives.)

- [ ] **Step 6: Approve → confirm it schedules in Blotato**

Reply in the session:
> "approved"
Expected: NOW it calls the Blotato schedule tool and reports back the scheduled time/id. Verify in the Blotato dashboard that the post is scheduled on the HLD Instagram account. Confirm the queue note status flipped to `scheduled`.

- [ ] **Step 7: Record the result**

Confirm all Phase A success criteria met:
- post drafted + graded 8+/10 in HLD voice (Steps 3-4)
- no un-approved publish possible; gate held (Step 5)
- approved post scheduled in Blotato (Step 6)

No commit (this task produces runtime artifacts, not repo files). Proceed to `wrap` to update STATUS.md and log the Phase A session.

---

## Self-Review

**Spec coverage:**
- §2 SM Manager agent → Task 5 (brain) + Task 1 (skills). Repurposer/Strategist are explicitly Phase B (out of scope here). ✓
- §3 fork the pack → Task 1; §3 two briefs → Task 2 (HLD brief; personal brief deferred to Phase B, correct since Phase A = HLD). ✓
- §3a per-brand grader → Task 3. ✓
- §3/§4 gated scheduler + approval queue → Task 4; gate proven → Task 7 Steps 5-6. ✓
- §6 Blotato wiring + one-time human account connect → Task 6. ✓
- §8 Phase A ("one real HLD post end-to-end, sounds like craft-fair voice AND passes the gate") → Task 7. ✓
- Trigger model weekly cron + full tap-to-approve Telegram bot → Phase C (correctly deferred; Phase A uses in-session approval + optional send-only ping). ✓

**Placeholder scan:** The only intentional "fill from source" is Task 2 Step 2's Product facts section (must be distilled from the live `product-facts` skill, not invented) and Task 6's auth header (must come from Blotato's setup doc, not guessed) — both are grounded in a named source with the exact command to read it, not vague TODOs.

**Type/name consistency:** skill folder names (`brand-brief-hld`, `post-grader`, `post-scheduler`, `content-coach`) are identical across Tasks 1-5 and Task 7; brain file paths (`persona.txt`, `context/CLAUDE.md`, `mcp.json`) match the `agent-scaffold.ts` `authoredBrainDir` contract in every task; launch flags in Task 7 match the Global Constraints block verbatim.
