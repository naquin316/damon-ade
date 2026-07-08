# RyanOS — Phase 2 Design: Superagent Brains + Real-Repo Working Trees

**Date:** 2026-07-07
**Repo:** `~/Code/damon-ade` (RyanOS; origin `naquin316/damon-ade`)
**Builds on:** Phase 0+1 (shipped 2026-07-07) — de-bloated, renamed, seeds 5 teams / 10 agents with generic brains.
**Two centerpieces:** (A) each agent works in a **branch-isolated worktree of its real repo** (or vault), and (B) each agent boots as a **superagent** — a rich, domain-expert brain seeded from Ryan's existing knowledge.

---

## 1. Goals

Turn the seeded agents from identical blank coding shells into domain-expert superagents that (per Ryan) have **deep domain knowledge, curated skills+tools, proactive autonomy, and a distinct persona + collaboration awareness** — and let them do real work on the actual `~/Code` repos and vault, safely.

Success = opening the "Shopify / Store Cockpit" agent gives you a Claude session that already knows it runs handlanedesigns.com, knows the Admin-API-not-Zapier rule, is working on a branch off `~/Code/ShopifyStore`, has the Shopify MCP wired, and points at your brand-facts SSOT — with zero ADE files written into that repo.

## 2. The three subsystems

- **2A — Working-tree strategy:** per-agent workspace (branch-worktree / direct / isolated) + launch-time context injection with zero repo-file writes.
- **2B — Superagent brains:** the Hermes-4-layer brain structure, a brain-author skill + per-agent manifests, and the 11 authored brains.
- **2C — Memory/trust:** folds into 2A+2B (see §6) — the launch-flag mechanism eliminates the "allow external imports?" prompt and keeps the vault as the pointed-at SSOT.

Build order: **2A (plumbing) → 2B (content)**. Each is its own spec → plan → build cycle.

## 3. Brain structure (Hermes 4-layer → files)

Expressed in `~/.ade/agents/<id>/`, mapping Ryan's Profile/Contract/Skill/Workspace model. Two carried principles: **Contract gives rules teeth**, and **Knowledge points at the vault SSOT, never duplicates it** ("folders are dumb until something points to them").

| Hermes layer | RyanOS file (external, launch-injected) | Holds |
|---|---|---|
| **Profile** | `persona.txt` (+ identity in `context/CLAUDE.md`) | Identity, voice, domain mandate |
| **Contract** | `persona.txt` (contract section) / `settings.json` permissions | always/never rules, autonomy level, tool-use policy, safety boundaries |
| **Skill** | `skills/` (symlinked into worktree `.claude/skills`) | Curated domain skills |
| **Workspace** | the worktree (2A) + `context/CLAUDE.md` (KNOWLEDGE) | Real repo/vault it operates on + **pointers** to vault SSOT |
| — | `memory/USER.md` | Ryan profile (shared) |
| — | `memory/MEMORY.md` | Learned state (keep the existing write-back infra + Stop-hook reflection) |

`persona.txt` (Profile+Contract) is injected via `--append-system-prompt-file`; `context/` (Knowledge) via `--add-dir` + `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`; `memory/` via `autoMemoryDirectory` in the external `settings.json`.

## 4. Working-tree strategy (2A)

Three modes, chosen per agent:
- **branch-worktree** (real git repo): `git worktree add` off the real repo onto a per-agent branch; the worktree dir lives under `~/.ade/agents/<id>/worktree`. Real history/remote, branch-isolated so a `--dangerously-skip-permissions` agent cannot touch your main checkout. **Changes reach main only when Ryan reviews and `git merge`s the branch** (decided).
- **direct cwd** (non-git targets, e.g. the vault): cwd points at the target directory; no worktree/branch.
- **isolated init** (greenfield): the current Phase-1 behavior — a fresh `git init` repo.

### 4.1 Confirmed launch recipe (zero repo-file writes)
Verified against current Claude Code (v2.1.x) docs. Per-agent launch:
```bash
cd <worktree-or-target-dir>
CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude \
  --model 'claude-opus-4-8[1m]' \
  --settings                  ~/.ade/agents/<id>/settings.json \
  --append-system-prompt-file ~/.ade/agents/<id>/persona.txt \
  --add-dir                   ~/.ade/agents/<id>/context \
  --mcp-config                ~/.ade/agents/<id>/mcp.json --strict-mcp-config \
  --dangerously-skip-permissions
```
- `--settings` (external) has precedence over the repo's `.claude/settings.json` → sets `autoMemoryDirectory`, the Stop-hook, and permissions **without writing into the repo**, and pre-authorizes external imports so the "allow external CLAUDE.md imports?" prompt no longer fires.
- The repo's own `CLAUDE.md` still loads natively and stays authoritative; the agent's brain rides in via flags.
- **Skills caveat:** skills can't be passed by flag, so per-agent `skills/` is symlinked into the worktree's git-excluded `.claude/skills/`. (Direct-cwd/vault agents symlink into a `.claude/skills` under the target or use `~/.claude/skills`.)
- **persona.txt** stays tight (~1K practical limit); long-form domain detail lives in `context/` (loaded via `--add-dir`).

### 4.2 Required ADE code changes
- `create-agent-input.ts`: add `source` variants `{type:"linked-worktree", repoPath, branch}` and `{type:"direct", path}` (today only `init`/`clone`).
- `agent-repo.ts` / `agent-init.ts`: implement `git worktree add <~/.ade/agents/<id>/worktree> -b <branch>` off `repoPath` for linked mode; for direct mode, record the target path and skip repo creation. `resolveAgentWorktreePath` already supports external paths.
- `agent-scaffold.ts`: **stop writing bridge files into the worktree.** Instead write the external brain: `~/.ade/agents/<id>/{persona.txt, context/CLAUDE.md, settings.json (autoMemoryDirectory+Stop hook+permissions), mcp.json}` + keep `memory/{MEMORY,USER}.md`. Symlink `skills/` → worktree `.claude/skills/`.
- `agent-command.ts` + `useAgentSession.ts`: the `claude` launch is no longer a static preset string — it's **built per-agent** from that agent's home paths (the flags above). Non-linked/legacy agents keep the simple preset.

## 5. Superagent brains (2B)

### 5.1 Brain-author skill + per-agent manifest
A Claude skill (`brain-author`) + a per-agent manifest (in-repo `assets/seed-brains/<agent>/manifest.yaml`) listing the agent's brain sources. The skill reads the manifest's sources (vault via QMD, repo `CLAUDE.md`, Hermes profile), drafts `persona.txt` (Profile+Contract), `context/CLAUDE.md` (Knowledge pointers), `mcp.json` (curated tools), and starter `skills/`, then Ryan reviews. Repeatable for any future agent. (An in-app generator is explicitly **out of scope** — deferred.)

### 5.2 Install
Authored brains ship as seed assets under `assets/seed-brains/<agent>/`; the seeder/scaffold installs them into `~/.ade/agents/<id>/` instead of the generic stub.

### 5.3 Not every agent is equally rich (honest fallback)
Well-documented domains → rich seed. Thin/greenfield domains (SaaS Build, Consulting) → strong role-specific Profile+Contract, then the agent builds its own Knowledge via an onboarding interview using the existing write-back infra. We don't fake depth.

### 5.4 Collaboration — light now, deep later
"Collaboration" ships as **roster awareness**: each brain's `context/` lists the sibling agents and their domains + a "how to hand off" note. Deep inter-agent messaging/dispatch (à la Hermes AgentCairn/gateway routing) is **Phase 3**.

## 6. 2C resolution (memory/trust)
The launch-flag mechanism resolves 2C: (a) external `--settings` pre-authorizes imports → the per-session prompt disappears; (b) `KNOWLEDGE`/`context` **points at** the vault SSOT (not duplicated); (c) `memory/MEMORY.md` stays under `~/.ade` (Claude Code auto-memory is machine-local by design). **Optional/deferred:** mirror each agent's `MEMORY.md` into the vault for cross-machine search.

## 7. Per-agent manifest (roster: 5 teams / 11 agents)

| Team | Agent | Mode | Workspace | Brain seeded from | Curated tools |
|---|---|---|---|---|---|
| HLD Ops | Shopify / Store Cockpit | branch-worktree | `~/Code/ShopifyStore` | `[[hld-brand-facts]]`, `[[hld-store-cockpit]]`, repo CLAUDE.md, `[[shopify-admin-api-not-zapier]]` | Shopify Admin API (custom app), Supabase |
| HLD Ops | Storefront Support | branch-worktree | `~/Code/handlaneultimate` | `[[project_storefront-chat-hitl]]`, `[[handlaneultimate-fb-hitl]]`, repo CLAUDE.md | Supabase (read), Telegram *(contract: never touch prod DB unprompted)* |
| HLD Ops | RubyPulse / Laser | branch-worktree | `~/Code/rubypulse` | `[[project_rubypulse]]`, `[[reference_trotec-ruby-internals]]`, repo CLAUDE.md | ssh trotec bridge |
| HLD Ops | Foreman / Listings | branch-worktree | `~/Code/hld-admin` | `[[project-foreman-hld-admin]]`, repo CLAUDE.md, `[[hld-brand-facts]]` | Shopify Admin API, Cloudflare D1/R2 |
| Hand Lane AI | Consulting | isolated | greenfield | role brief; interview-onboard | — |
| Hand Lane AI | SaaS Build | isolated | greenfield | role brief; interview-onboard | — |
| Content / YouTube | Script Writer | direct cwd | vault (content area) | Ryan voice/content notes | vault |
| Content / YouTube | Clip Scout | direct cwd | vault (clippings area) | `[[clip-scout]]` skill + state | vault |
| Trading | Kalshi BTC / Tessa | branch-worktree | `~/Code/kalshi-btc-lab` | **Hermes Tessa profile**, `[[project-kalshi-btc-lab]]`, SSOT risk rules | (per Tessa contract; paper-only) |
| Personal / RLOS | Daily Planner | direct cwd | the RLOS_2026 vault | braynee/daily-planner conventions | vault (braynee) |
| Personal / RLOS | Code HQ / Portfolio | branch-worktree | `~/Code/.codehq` | `[[project-codehq-dashboard]]`, repo CLAUDE.md | — |

(Manifests are drafts; the brain-author skill and Ryan's review finalize each. Foreman is the new 11th agent; Phase 1's seed must add it.)

## 8. Migration
Ryan's running instance already has the 10 Phase-1 agents with generic brains under `~/.ade` (packaged app) / `~/.ade-default` (dev). Phase 2 must either migrate existing agents (install authored brains + convert their worktree to a linked one) or support a clean re-seed. Simplest: a one-time backfill that installs the authored brain for any agent matching a seeded name, plus adding Foreman. Decide the exact migration in the 2A/2B plans.

## 9. Non-goals (Phase 3+)
- In-app brain generator (the skill covers repeatable authoring).
- Deep inter-agent messaging/handoff (roster awareness only in Phase 2).
- Cross-machine memory sync / vault memory mirror.
- Dashboards-as-panels (still Phase 3).

## 10. Risks & mitigations
- **`--append-system-prompt` length limit (~1K practical):** keep persona.txt tight; push detail to `context/` via `--add-dir`. 
- **`--strict-mcp-config` disables repo `.mcp.json`:** intended (agents get isolated tool sets); document it.
- **Skills-by-flag unsupported:** symlink per-agent `skills/` into the worktree's git-excluded `.claude/skills/`; verify Claude Code discovers symlinked skills.
- **Launch command is now per-agent, not a static preset:** the biggest ADE change; keep a simple-preset fallback for non-linked agents so nothing regresses.
- **Worktree branch hygiene:** each linked agent owns a branch; document the review→merge→prune flow so branches don't pile up.
- **Migration of already-seeded agents:** back up `~/.ade*` before any migration; make the backfill idempotent.
