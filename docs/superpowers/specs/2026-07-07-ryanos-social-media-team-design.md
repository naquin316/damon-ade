# RyanOS — Social Media Team Design

**Date:** 2026-07-07
**Repo:** `~/Code/damon-ade` (RyanOS)
**Builds on:** Phase 2B (superagent brains + `brain-author` skill + per-agent manifests). This adds a new **team**, three new **agents**, a forked **skill pack**, and one new **MCP integration** — all authored through the existing 2B-2 machinery.
**Origin:** Sabrina Ramonov's "Set Up Your AI Marketing Team in Claude (7 Free Skills)" (sabrina.dev, 2026-06-17) + Blotato's free `blotato-content-pack.zip`. We fork the pack rather than depend on it.
**Goal:** Turn Ryan's paid Blotato subscription into ROI by standing up a 3-agent social-media crew inside RyanOS that drafts, self-grades, and (on approval) publishes content for **two brands** — Hand Lane Designs (store) and Ryan's personal / Hand Lane AI brand — via Blotato as the publishing hands, with a human-in-the-loop gate before anything goes live.

---

## 1. Overview & fit

An "agent" in RyanOS is already a Claude Code session with an injected external brain (`persona.txt` Profile+Contract + `context/CLAUDE.md` Knowledge + `MEMORY.md` learned + `skills/`) and a per-agent `mcp.json`, seeded on first boot into **Teams → Agents**. Sabrina's "team of 7 skills" maps almost 1:1 onto this: her *skills* become RyanOS agent *skills*, her *brand-brief* becomes Ryan's existing HLD voice assets (hld-admin's `brand-voice`/`product-facts` skills + `user_hld-brand-facts`), and Blotato's agent-native MCP (`https://mcp.blotato.com/mcp`) becomes a per-agent connector loaded through RyanOS's existing `--mcp-config … --strict-mcp-config` launch flags.

So this is **not a new subsystem** — it is the next authored team in the Phase 2B-2 brain-authoring work, plus a small skill fork and one MCP wiring.

**Key technical facts that shaped this design (verified from Blotato docs, 2026-07-07):**
- The pack ships as a downloadable ZIP of 7 `SKILL.md` files → we fork exact source, no reverse-engineering.
- **6 of the 7 skills need zero Blotato.** Only `post-scheduler` touches it, and it *falls back to writing the post to a file* when Blotato is not connected. Therefore **the approval gate lives before Blotato, in RyanOS/Hermes** — it does not depend on Blotato having a "held/draft" state.
- The grader weights **hook strength at 50%** and loops a draft to 8+/10 before it is considered shippable.

**Critical brand-voice correction (the reason this doesn't just sound like a generic AI marketing bot):** Blotato's pack is tuned for **virality** — contrarian wedges, "I tested 47 X" receipts, polarizing CTAs. That is the *opposite* of Hand Lane Designs' established voice. Ryan already owns a mature, real-listing-trained HLD voice as a skill at `~/Code/hld-admin/.claude/skills/brand-voice` (plus `product-facts`, `listing-writer`, `pricing-analyst`): *"sound like Ryan talking to a customer at a craft fair: warm, direct, proud of the work, zero corporate gloss,"* with a banned-cliché list and gift-framing rules. **The HLD side of this team reuses those existing skills; it does not inherit Blotato's viral defaults.** Only the personal / Hand Lane AI brand uses Blotato's virality tuning (where it is actually appropriate). See §3 and §3a.

## 2. The team (hybrid: 1 manager + 2 specialists)

New `projects` row: **"Social Media"**. Three `workspaces` (agents):

```
Social Media Team
├─ 🧠 SM Manager    editor-in-chief / social lead
│     skills: content-coach, post-writer, post-grader, post-scheduler
│     mcp:    blotato   (the ONLY agent that publishes)
│     brand:  switches between HLD brief + Personal brief per job
│     cwd:    direct-vault agent (content lives in vault, not a code repo)
│
├─ ♻️  Repurposer    content multiplier
│     skills: repurpose, viral-hooks
│     input:  latest YouTube video / session transcript, read from Clip Scout output
│     output: 1 long piece → 3 LinkedIn posts + 5 X threads + 2 short-form scripts
│     hands graded drafts → SM Manager's approval queue (no direct publish)
│
└─ 🎯 Strategist    weekly planner / trend + hook research
      skills: brand-brief (x2), content-calendar (new), viral-hooks
      output: the week's content plan per brand → feeds Manager + Repurposer
```

**Why hybrid, not 7 agents:** Sabrina's 7 "skills" are skills, not sessions. Spinning up 7 terminal agents for what is fundamentally one skill pipeline is wasteful. The manager carries the core `coach→write→grade→schedule` loop in one brain; the two specialists exist only where real parallelism pays — heavy video→week batching (Repurposer) and cross-brand weekly planning (Strategist).

**Team boundary:** Social Media is its **own team**, separate from the existing Content/YouTube team (Script Writer, Clip Scout). The Repurposer *reads from* Clip Scout's triage output but does not merge into it — keeps concerns clean (Content team = source/ideation about YouTube; Social Media team = multi-platform distribution).

## 3. The skill fork

Decision: **fork, don't reference.** We copy the 7 `SKILL.md` files from `blotato-content-pack.zip` into RyanOS-owned skills so we can HLD-tune them and so they survive Blotato changing their pack.

- **`direct`-vault install path** (per the 2A/2B direct-vault fix): the SM Manager and its specialists are vault-cwd agents, so their skills install under `~/.claude/skills/ryanos-<agentId>/` — never the shared vault `.claude/skills` root.
- Seed copies live under `assets/seed-brains/<agent>/brain/skills/` so a re-seed reinstalls them.

**Three HLD-specific edits to the forked pack (everything else kept verbatim initially, tuned later):**

1. **`brand-brief` → two briefs, not one — and the HLD brief is built from Ryan's existing voice skills, not from scratch.**
   - `brand-brief-hld.md` — **generated from and pointing to `~/Code/hld-admin/.claude/skills/brand-voice` + `product-facts`** (the real, listing-trained HLD voice: warm Texas maker, concrete over hype, gift-framing, banned-cliché list, "zero corporate gloss"). Also carries the `user_hld-brand-facts` facts (New Braunfels TX not Round Rock, "hand-engraved", visuals must match, no fabricated claims). The HLD side **reuses proven assets** rather than reinventing voice.
   - `brand-brief-personal.md` — build-in-public / Hand Lane AI creator voice (Sabrina-style: contrarian wedge, receipts, build-in-public). This brand *wants* Blotato's virality tuning.
   - The SM Manager selects the brief per job; the Strategist owns keeping both briefs current.

2. **`post-grader` → two rubrics, keep the mechanism.** Keep Blotato's grading *machinery* (self-grade, list top-3 fixes, loop to 8+/10) but swap the *rubric values* per brand. See §3a.

3. **`post-scheduler` gated.** Instead of scheduling immediately, it writes the graded post to an **approval queue** (§4) and pings Ryan. A separate "approve" action is what actually fires the Blotato MCP call.

### 3a. Per-brand grading rubric

The grader's mechanism is shared; the rubric it scores against is chosen by the active brand brief:

| | **HLD (store)** | **Personal / Hand Lane AI** |
|---|---|---|
| Voice source | hld-admin `brand-voice` skill | Blotato virality tuning + personal wedge |
| Hard fails | banned clichés ("elevate", "premium quality", "makes a statement", em-dash AI cadence, 3 adjectives in a row); wrong town; wrong craft term; invented product claims | off-voice for the wedge; fabricated receipts |
| Scored dimensions | warmth, concreteness (say what it is / made of / who it's for), gift-framing, permanence-of-engraving, platform fit | hook strength (≈50%), curiosity, share-worthiness, polarity, platform fit |
| Optimizes for | trust + "a real person made this" → clicks to store | reach + audience growth → inbound |

Shared across both (Blotato universal rules that already match HLD standards): contractions, digits-not-words, no em-dashes, active voice, short sentences, one idea per post.

## 4. Approval gate (draft → approve → schedule)

The gate is a RyanOS/Hermes concern, not Blotato's, so it works regardless of Blotato's API state model.

```
Agent drafts + self-grades (post-grader loops to 8+/10)
        ↓
post-scheduler writes to approval queue  →  vault note + Telegram ping
        ↓
Ryan approves  (reuse the existing FB Messenger HITL Telegram approve-flow)
        ↓
post-scheduler fires Blotato MCP  →  post scheduled on the platform calendar
```

- **Queue representation:** a vault note (one per pending batch) listing each graded post, its grade, target platform(s), and scheduled time — plus a Telegram digest with approve/reject affordances.
- **Approval channel:** reuse the **Telegram** approve→send pattern already running for `handlaneultimate-fb-hitl` (approve from phone). Nothing publishes on an un-approved item.
- **Reject/edit path:** a rejected item returns to the Manager with the reason; the Manager revises and re-queues.

## 5. Trigger model (weekly batch + on-demand)

- **Weekly (Hermes cron, ~Sun PM):** Strategist plans the week for both brands → Repurposer turns the latest video/session (via Clip Scout output) into a batch → Manager drafts + grades + queues → Ryan receives **one Telegram digest** to approve. Chains onto the existing Clip Scout pipeline and Hermes cron infrastructure.
- **On-demand (anytime in RyanOS):** open SM Manager, e.g. *"write an IG post about the new walnut cutting board"* → draft → grade → queue.

## 6. Blotato wiring

- Per-agent `mcp.json` on the **SM Manager only**: `{ "mcpServers": { "blotato": { "url": "https://mcp.blotato.com/mcp" } } }`, loaded via RyanOS's existing launch flags.
- **One-time human setup:** in Blotato settings, connect the HLD + personal social accounts and generate the API key; add/authorize the connector so the MCP can act on those accounts.
- **Account scope:** HLD accounts and Ryan's personal accounts are both connected in Blotato; the Manager targets the right set based on the active brand brief.
- This is the ROI unlock — the existing paid subscription becomes the team's publishing engine.

## 7. RyanOS integration (fits Phase 2B-2)

Follows the existing manifest + brain-author flow exactly. Three new `assets/seed-brains/<agent>/manifest.yaml` entries:

| Agent | Persona | Brain sources | Tools | Autonomy | Safety |
|---|---|---|---|---|---|
| SM Manager | "Editor" | hld-admin `brand-voice` + `product-facts` skills, `user_hld-brand-facts`, forked Blotato pack, `handlaneultimate-fb-hitl` (HITL pattern) | blotato (MCP) | medium | never publish without approval; brand-correct facts only; HLD grader ≠ virality grader |
| Repurposer | "Multiplier" | `clip-scout` skill+output, forked `repurpose`/`viral-hooks` | vault (read Clip Scout) | high (drafts only; cannot publish) | drafts to queue only |
| Strategist | "Planner" | both brand briefs, `viral-hooks`, `content-calendar` skill (net-new) | vault | medium | — |

The `content-calendar` skill is the one net-new skill beyond the forked Blotato pack: it produces the week's plan per brand (themes, slots, which long-form to repurpose) into a vault note that feeds the Manager and Repurposer.

- Manager's persona encodes the two-brand switching + the gate as a hard contract rule ("never call the Blotato schedule tool on an un-approved item").
- Repurposer and Strategist carry **no** Blotato MCP — they physically cannot publish; only the Manager holds the keys.
- Seeded on re-seed like the other teams (idempotent), so a fresh boot brings the crew up brained.

## 8. Build decomposition (phased for a fast first win)

- **Phase A — prove the loop with a real HLD post (≈1 session):** download `blotato-content-pack.zip`; fork the edited skills; build `brand-brief-hld.md` from hld-admin's `brand-voice` + `product-facts`; wire the **HLD grader rubric** (§3a); author the **SM Manager** brain only; wire Blotato MCP + connect accounts; run **one real HLD store post end-to-end** through draft → grade (against the HLD rubric, not virality) → Telegram approval → Blotato schedule. Success = the post sounds like the craft-fair voice AND passes the gate. Proves the whole loop with one agent before scaling.
- **Phase B — full crew:** add Repurposer + Strategist manifests/brains; wire the two brand briefs; run a manual "video → week of posts" batch through the gate.
- **Phase C — automate:** Hermes weekly cron + Telegram approval digest; fold all three manifests into the 2B-2 seed so a re-seed boots the whole team brained.

## 9. Success criteria

- Phase A: one HLD post drafted, graded 8+/10, approved via Telegram, and confirmed scheduled in Blotato — with zero ADE files written into any real repo and no un-approved publish possible.
- Phase C: a Sunday cron produces a full week of graded, queued posts across both brands from one long-form input, delivered as a single Telegram digest Ryan can approve in minutes.
- ROI signal: Blotato is used every week (was previously idle/paid-for-nothing).

## 10. Non-goals

- No new publishing engine — Blotato is the hands; we do not rebuild scheduling.
- No autonomous publishing — the gate is mandatory for both brands (revisit only if Ryan later opts into a tiered auto/gate model).
- No deep inter-agent messaging beyond Repurposer/Strategist → Manager handoff (consistent with Phase 3 boundary).
- Not folding into the Content/YouTube team.
- No paid Blotato-tier features assumed beyond what the current subscription provides.

## 11. Risks & mitigations

- **Blotato MCP tool surface unknown until wired.** Mitigation: Phase A explicitly validates the `post-scheduler` → Blotato call against the live MCP before scaling; `post-scheduler`'s documented file-fallback covers the case where a needed tool is missing.
- **Blotato-virality voice overriding HLD's craft-fair voice** (the core risk — off-brand-by-default). Mitigation: HLD brief is sourced from hld-admin's proven `brand-voice`/`product-facts`, the HLD grader uses the §3a rubric (banned clichés = hard fails, virality tuned down), and the personal-brand virality rubric is never applied to HLD jobs.
- **Two-brand voice bleed** (HLD product voice leaking into personal posts or vice-versa). Mitigation: separate brand-brief files + a hard grader check that the active brief matches the target accounts.
- **hld-admin skills drift / availability** (the Manager depends on skills living in another repo). Mitigation: the brand-brief generation copies the relevant voice rules into the seed brief AND records a pointer back to the source skill, so the Manager works even if hld-admin isn't checked out, but can be refreshed when it is.
- **Brand-fact errors reaching customers** (e.g. wrong town). Mitigation: HLD non-negotiables are hard grader fails AND the approval gate is the backstop.
- **Persona.txt length limit** (~1K practical for `--append-system-prompt-file`): keep the Manager's Profile+Contract tight; push the skill mechanics into skills, brand facts into `context/CLAUDE.md` pointers.
- **Skill drift from upstream Blotato pack:** we forked deliberately; periodically diff against a fresh pack download if Blotato ships improvements worth pulling.
