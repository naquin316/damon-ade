# RyanOS — Handoff (2026-07-08)

## Where we are
RyanOS = personal fork of `per-simmons/damon-ade` (Electron ADE cockpit). Repo `~/Code/damon-ade`, origin `naquin316/damon-ade`. **Shipped & pushed:** Phase 0+1, 2A, 2B-1, worktree-collision patch, and now **Phase 2B-2 (code + content)**. HEAD ≈ `b66255c`. Everything subagent-driven (impl + per-task review + final Opus whole-branch review = READY TO MERGE).

- **0+1 / 2A / 2B-1:** see vault `[[project_ryanos]]`. Net: agents run in branch-isolated worktrees of their REAL repos; brain lives external under `~/.ade/agents/<id>/`, injected at launch; import-safe composition (no cross-dir `@`-import → no trust prompt); authored (persona/context/mcp, refreshable) vs learned (MEMORY.md/skills, never clobbered) split.
- **2B-2 (code):** `seed-brains.ts` resolver (agent name → slug → `assets/seed-brains/<slug>/brain/`), wired into the **Electron-free** `agent-scaffold.ts` so a re-seed installs the AUTHORED brain instead of generic templates (via `writeIfEmpty`; **never touches MEMORY.md** — proven by a discriminating test); callers `agent-init.ts` + `agent-memory-backfill.ts`; `electron-builder.ts` bundles the assets. 49 tests green.
- **2B-2 (content):** the `brain-author` skill (`.claude/skills/brain-author/`) + **9 manifests + 9 authored brains** (persona.txt Profile+Contract, context/CLAUDE.md Knowledge *pointers*, mcp.json, a few starter skills). Greenfield **Consulting + SaaS Build deferred** (absent from the slug map → generic template). Tessa is paper-only (verbatim hard gates, empty mcp.json, no live-order path).
- **Tooling decision (2026-07-08):** RyanOS agents don't use local stdio MCP — real tools are direct scripts / claude.ai remote OAuth connectors / the ask-trotec HTTP bridge. So `mcp.json` holds **honest stubs** and each brain's `context/CLAUDE.md` has a `## Tool access` section documenting the real route. Codified in the brain-author skill.

## Do this first (finish 2B-2 — the live gate)
The code+content is pushed but the **end-to-end live re-seed hasn't been boot-tested** (needs the Electron app). This also folds in the still-owed 2B-1 smoke test. Quit the running dev app, then:
```bash
mv ~/.ade ~/.ade.bak.$(date +%s); mv ~/.ade-default ~/.ade-default.bak.$(date +%s) 2>/dev/null
cd ~/Code/damon-ade/apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev
```
Confirm: (1) each of the **9 agents boots as its authored specialist** (persona name = Store Cockpit/Concierge/RubyPulse/Foreman/Scribe/Scout/Tessa/Planner/Steward, NOT the generic template); the 2 greenfield agents show the generic template (correct). (2) **No import prompt** on any launch; Shopify on branch `ade/shopify-<id8>`. (3) Real repos clean (`git -C ~/Code/ShopifyStore status`), namespaced `~/.claude/skills/ryanos-*` present, **no `.claude/skills` in the vault root** (already cleaned the stale one).
Automated resolve check already passes: `getAuthoredBrainDir` resolves all 9 + greenfield unmapped (bun test 2/2).

## After the live gate
- Invoke the `wrap` skill (update RyanOS `STATUS.md`), then refine vault `[[project_ryanos]]` from "code+content complete" → "2B-2 SHIPPED".
- Known non-blocking Minors (from Opus review, all ship): mcp.json `_note` on tessa/scribe but bare `{}` elsewhere; Daily Planner voice folded into prose; 2 SKILL descriptions at the 60-char limit; `.gitkeep` copied into bundle; **braynee paths pinned to `2.1.10` will rot on update**; daily-planner cites `07-Meta/04-Personal` vault folders (QMD-verified, not repo-verifiable).

## Next: Phase 3
Deep inter-agent collaboration/handoff (roster awareness exists; the pilot personas already negotiate boundaries — Store Cockpit edits existing products, Foreman creates new, each hands off). Embed dashboards ([[project-opsdeck-dashboard]], [[project_rubypulse]], [[project_mypka-cockpit]], [[project_catchpad-remote-dashboard]]) as panels + [[project-codehq-dashboard]] awareness.

## Conventions
- Commit direct to `main`, prefix `BRAYNEE_ALLOW_MAIN_COMMITS=1`. Push to `origin`. Actions disabled on the fork.
- **Heads-up:** a concurrent "Social Media Team" workstream also commits docs to this `main` (markdown only, no file overlap with 2B-2). Scope reviews/diffs to your own files.
- Build subagent-driven with the review loop — it caught real bugs in 2B-2 (dev-path resolution, a toothless MEMORY.md-safety test, systemic vault-path formatting). Keep it.
- SDD progress ledger: `.superpowers/sdd/progress.md`. Full context in vault `[[project_ryanos]]`.
