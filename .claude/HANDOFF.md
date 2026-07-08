# RyanOS — Handoff (2026-07-08)

## Where we are
RyanOS = personal fork of `per-simmons/damon-ade` (Electron ADE cockpit). Repo `~/Code/damon-ade`, origin `naquin316/damon-ade`. **Shipped & pushed:** Phase 0+1, 2A, 2B-1, worktree-collision patch, and now **Phase 2B-2 — LIVE-VERIFIED 2026-07-08**. HEAD ≈ `ae72c2b`. Everything subagent-driven (impl + per-task review + final Opus whole-branch review = READY TO MERGE). **Live re-seed confirmed: 9/9 sourced agents boot as their authored specialists, 2/2 greenfield generic, zero real-repo pollution, memory-safe.** Backups at `~/.ade.bak.1783491114` (delete when satisfied).

- **0+1 / 2A / 2B-1:** see vault `[[project_ryanos]]`. Net: agents run in branch-isolated worktrees of their REAL repos; brain lives external under `~/.ade/agents/<id>/`, injected at launch; import-safe composition (no cross-dir `@`-import → no trust prompt); authored (persona/context/mcp, refreshable) vs learned (MEMORY.md/skills, never clobbered) split.
- **2B-2 (code):** `seed-brains.ts` resolver (agent name → slug → `assets/seed-brains/<slug>/brain/`), wired into the **Electron-free** `agent-scaffold.ts` so a re-seed installs the AUTHORED brain instead of generic templates (via `writeIfEmpty`; **never touches MEMORY.md** — proven by a discriminating test); callers `agent-init.ts` + `agent-memory-backfill.ts`; `electron-builder.ts` bundles the assets. 49 tests green.
- **2B-2 (content):** the `brain-author` skill (`.claude/skills/brain-author/`) + **9 manifests + 9 authored brains** (persona.txt Profile+Contract, context/CLAUDE.md Knowledge *pointers*, mcp.json, a few starter skills). Greenfield **Consulting + SaaS Build deferred** (absent from the slug map → generic template). Tessa is paper-only (verbatim hard gates, empty mcp.json, no live-order path).
- **Tooling decision (2026-07-08):** RyanOS agents don't use local stdio MCP — real tools are direct scripts / claude.ai remote OAuth connectors / the ask-trotec HTTP bridge. So `mcp.json` holds **honest stubs** and each brain's `context/CLAUDE.md` has a `## Tool access` section documenting the real route. Codified in the brain-author skill.

## Live re-seed — DONE (2026-07-08, agent-run + verified)
Re-seeded (`mv ~/.ade` → `~/.ade.bak.1783491114`, relaunched dev). Verified on disk: 9/9 sourced agents booted AUTHORED, 2/2 greenfield GENERIC; authored context (`## Tool access`, 0 `@`-imports) + mcp.json installed; MEMORY.md = fresh template (memory-safe); all 6 repos on `ade/<role>-<id8>`; **zero ADE pollution** (no `.claude/skills` symlink in any main tree; all dirty files predate the reseed = pre-existing cmux/user/runtime); vault root clean. `getAuthoredBrainDir` resolves all 9 (bun test 2/2).
- **Human-only leftover:** eyeball "no import prompt" when you open an agent terminal (file-level cause — 0 `@`-imports — verified gone across all 11).
- **Backlog (minor):** the mv-based re-seed orphans prior `~/.claude/skills/ryanos-*` symlinks (pruned 3 dangling by hand); `setupAgentRepo`/re-seed should prune them.

## After the live gate
- Invoke the `wrap` skill (update RyanOS `STATUS.md`); vault `[[project_ryanos]]` already flipped to "2B-2 shipped".
- Known non-blocking Minors (from Opus review, all ship): mcp.json `_note` on tessa/scribe but bare `{}` elsewhere; Daily Planner voice folded into prose; 2 SKILL descriptions at the 60-char limit; `.gitkeep` copied into bundle; **braynee paths pinned to `2.1.10` will rot on update**; daily-planner cites `07-Meta/04-Personal` vault folders (QMD-verified, not repo-verifiable).

## Next: Phase 3
Deep inter-agent collaboration/handoff (roster awareness exists; the pilot personas already negotiate boundaries — Store Cockpit edits existing products, Foreman creates new, each hands off). Embed dashboards ([[project-opsdeck-dashboard]], [[project_rubypulse]], [[project_mypka-cockpit]], [[project_catchpad-remote-dashboard]]) as panels + [[project-codehq-dashboard]] awareness.

## Conventions
- Commit direct to `main`, prefix `BRAYNEE_ALLOW_MAIN_COMMITS=1`. Push to `origin`. Actions disabled on the fork.
- **Heads-up:** a concurrent "Social Media Team" workstream also commits docs to this `main` (markdown only, no file overlap with 2B-2). Scope reviews/diffs to your own files.
- Build subagent-driven with the review loop — it caught real bugs in 2B-2 (dev-path resolution, a toothless MEMORY.md-safety test, systemic vault-path formatting). Keep it.
- SDD progress ledger: `.superpowers/sdd/progress.md`. Full context in vault `[[project_ryanos]]`.
