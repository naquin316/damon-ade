# RyanOS — Phase 2B Design: Superagent Brains + Brain-Author Skill

**Date:** 2026-07-07
**Repo:** `~/Code/damon-ade` (RyanOS)
**Builds on:** Phase 2A (shipped: real-repo branch-worktrees + external brain injected at launch). 2A left the brain *content* generic and left a one-time external-import prompt.
**Goal:** Author the 11 agents into domain-expert **superagents** (deep knowledge, curated skills+tools, proactive autonomy, distinct persona), seeded from Ryan's vault/Hermes/repos via a repeatable **brain-author skill** — and, in the process, make launches fully non-interactive (kill the import prompt).

---

## 1. Import-safe brain composition (also the prompt fix)

Each Hermes layer rides its own **native Claude Code launch channel** — none of which is a cross-directory `@`-import, so the workspace-trust gate never fires.

| Layer | Channel | Authored / Learned |
|---|---|---|
| **Profile + Contract** (identity, voice, mandate, always/never rules, autonomy, safety boundaries, roster awareness, stable "who Ryan is" baseline) | `persona.txt` via `--append-system-prompt-file` | **Authored** (refreshable) |
| **Knowledge** (pointers to vault SSOT + repo docs — never copies) | `context/CLAUDE.md` via `--add-dir` (self-contained, no cross-dir import) | **Authored** (refreshable) |
| **Curated tools** | `mcp.json` via `--mcp-config --strict-mcp-config` | **Authored** (refreshable) |
| **Learned state** (preferences, facts, lessons the agent picks up) | `MEMORY.md` via native `autoMemoryDirectory` | **Learned** (never clobbered) |
| **Skills** | `skills/` symlinked into worktree `.claude/skills` | Authored + learned |

**Authored vs learned split** is the key invariant: the brain-author overwrites ONLY `persona.txt` / `context/CLAUDE.md` / `mcp.json`; `MEMORY.md` and `skills/` accrue and are never wiped. Re-authoring a brain is therefore always memory-safe. `USER.md` collapses: the stable baseline → `persona.txt`; anything learned about Ryan → `MEMORY.md`.

## 2. Scaffold change (2A → 2B)

In `agent-scaffold.ts`:
- **Drop the cross-dir import:** `context/CLAUDE.md` no longer `@`-imports `memory/AGENT.md`/`USER.md`. It becomes the self-contained Knowledge doc.
- **`persona.txt`** becomes the Profile+Contract doc (currently a one-liner) — for un-authored agents a strong role-generic default; for authored agents, the brain-author's output.
- **Write-back protocol retargets:** learned → `MEMORY.md`; reusable procedures → `skills/`. Update `.writeback-protocol.md` + the Stop-hook reflection prompt to name these two targets (drop USER.md/AGENT.md edit guidance).
- Verify launch is now **fully non-interactive** (no import prompt) — human smoke-test.

## 3. Brain-author skill

In-repo Claude skill: `.claude/skills/brain-author/`. Process:
1. Read `assets/seed-brains/<agent>/manifest.yaml`.
2. Gather sources: QMD queries for named vault notes; `Read` repo `CLAUDE.md`/`STATUS.md`; Hermes profile if present.
3. Draft `persona.txt` (Profile+Contract), `context/CLAUDE.md` (Knowledge pointers), `mcp.json` (curated tools), 1–2 starter `skills/`.
4. Human review.
5. Install to the seed asset (`assets/seed-brains/<agent>/brain/`) AND optionally the live `~/.ade/agents/<id>/` (memory-safe: never touch `MEMORY.md`).

### Manifest schema
```yaml
agent: "Shopify / Store Cockpit"
persona: { name: "Store Cockpit", voice: "operator, terse, proactive" }
profile_from:   ["vault:hld-brand-facts", "vault:hld-store-cockpit"]
contract_from:  ["feedback:shopify-admin-api-not-zapier", "brand rules"]
knowledge_from: ["repo:~/Code/ShopifyStore/CLAUDE.md", "vault:hld-store-cockpit"]
tools:          ["shopify-admin-api", "supabase"]
autonomy:       "high"   # proposes + executes within contract
safety:         ["never touch prod without confirm", "Admin API not Zapier"]
```

## 4. Per-agent manifests (5 teams / 11 agents)

Sources are starting points; the skill's QMD lookups + Ryan's review finalize each. Persona names are suggestions.

| Agent | Persona | Brain sources | Tools | Autonomy |
|---|---|---|---|---|
| Shopify / Store Cockpit | "Store Cockpit" | `hld-brand-facts`, `hld-store-cockpit`, repo CLAUDE.md, `shopify-admin-api-not-zapier` | Shopify Admin API, Supabase | high |
| Storefront Support | "Concierge" | `project_storefront-chat-hitl`, `handlaneultimate-fb-hitl`, repo CLAUDE.md | Supabase (read), Telegram | medium (never prod-write unprompted) |
| RubyPulse / Laser | "RubyPulse" | `project_rubypulse`, `reference_trotec-ruby-internals`, repo CLAUDE.md | ssh trotec bridge | medium |
| Foreman / Listings | "Foreman" | `project-foreman-hld-admin`, repo CLAUDE.md, `hld-brand-facts` | Shopify Admin API, Cloudflare D1/R2 | high |
| Consulting | "Consigliere" | Hand Lane AI positioning; interview-onboard | — | medium |
| SaaS Build | "Builder" | role brief; interview-onboard | — | high |
| Script Writer | "Scribe" | Ryan voice/content notes (vault) | vault | high |
| Clip Scout | "Scout" | `clip-scout` skill + state | vault | high |
| Kalshi BTC / Tessa | **Tessa** | Hermes Tessa profile, `project-kalshi-btc-lab`, SSOT risk rules | (per Tessa contract; paper-only) | medium (paper-only, risk-gated) |
| Daily Planner | "Planner" | braynee/daily-planner conventions | vault (braynee) | medium |
| Code HQ / Portfolio | "Steward" | `project-codehq-dashboard`, repo CLAUDE.md | — | medium |

Greenfield agents (Consulting, SaaS Build) get a strong role-specific Profile+Contract, then build Knowledge via onboarding interview (honest — no faked depth).

## 5. Authoring the 11
Run the brain-author skill once per agent — a parallel fan-out (11 authoring passes reading vault/repo/Hermes), each drafting the brain, Ryan reviewing. Produces the seed assets; a re-seed then boots every agent brained.

## 6. direct-vault skills fix (carried from 2A)
Script Writer, Clip Scout, and Daily Planner share the vault as cwd → they collide on one `.claude/skills` symlink and pollute the vault root. Fix: for `direct` agents, install per-agent skills under **`~/.claude/skills/ryanos-<agentId>/`** (or gate the symlink) instead of the shared vault `.claude/skills`, so each vault agent gets its own skills without writing into the vault root.

## 7. Build decomposition
- **2B-1 (code):** scaffold composition change (drop cross-dir import; persona.txt = Profile+Contract; context/CLAUDE.md = Knowledge; write-back retarget) + direct-vault skills fix + verify non-interactive launch. Small, testable.
- **2B-2 (content):** brain-author skill + the 11 manifests + author + install the 11 brains + re-seed. Larger; content-heavy.

Build 2B-1 first (it makes launches clean and sets the file contract the brains are authored into), then 2B-2.

## 8. Non-goals (Phase 3+)
Deep inter-agent messaging/handoff (roster awareness only), in-app brain generator, cross-machine memory sync, dashboards-as-panels.

## 9. Risks
- **Persona.txt length** (~1K practical for `--append-system-prompt-file`): keep Profile+Contract tight; overflow to `context/CLAUDE.md`.
- **Re-authoring vs learned state:** guaranteed safe by the authored/learned split — but the scaffold + brain-author install must be audited to NEVER write `MEMORY.md`.
- **Knowledge staleness:** pointers to vault SSOT stay fresh; copied facts rot — enforce "point, don't copy" in the brain-author skill.
- **Manifest source accuracy:** the skill must verify a vault note exists (QMD) before citing it; a dead pointer is worse than none.
