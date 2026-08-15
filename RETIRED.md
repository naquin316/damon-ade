# RETIRED — 2026-08-14

**RyanOS (damon-ade) is retired.** Its agents, teams, and Mission Control were released on
Release Day of the **Workforce Five** rebuild ("The Fifth Nine"). This repo is archived, not deleted.

## Why

Four parallel agent workforces existed simultaneously — Hermes profiles, the Buzz 15-agent pack,
these RyanOS agents, and the Claude Code cron/routine layer — with the same characters (Roux,
Tessa, Scout, Lane, Foreman, SM Manager) duplicated across two or three of them and no shared
state between copies. Ryan's own architecture doctrine calls that the bug: *three copies of a
fact is the bug*. One club replaces all four.

Mission Control specifically dies by adopted doctrine: a dashboard that reports without proposing
an action is a scoreboard, not an advance scout.

Plan: <https://claude.ai/code/artifact/11444098-7169-4940-90e8-12e04fc0a193>

## State at retirement

- Final commit on `main` pushed to `origin` (`naquin316/damon-ade`) — the working tree of
  in-flight seed-brain edits was committed first, so nothing is stranded here.
- All 13 `ade/*` agent branches in ShopifyStore, hld-admin and rubypulse were **merged** and
  deleted; worktree registrations pruned. Those repos are clean.
- `~/.ade/` (agent brains, learned `MEMORY.md` files, local SQLite) is **left in place and
  untouched** — it is data, not a layer.

## Salvage — what outlived it

- **`assets/seed-brains/`** — 9 authored agent brains (persona/context/mcp). Kept as a reference
  corpus for writing Skip's brain. Not installed.
- **The `brain-author` skill** and the persona/context/knowledge split it encodes.
- **The handoff-queue note contract** (vault `2. Areas/Handoffs/`) — the pattern survives even
  though the agents that used it do not.
- **Build discipline**: subagent-driven phases with per-task review caught real bugs (the
  `.git`-as-file ENOTDIR crash, the worktree-branch collision). That practice carries forward.

## Do not

- Do not resurrect these agent identities. New club, new names: **Skip** (manager), **Gus**
  (bench coach), **Tank** (chin music), and an unsigned lineup card of six.
- Do not re-propose Mission Control as a tile wall.
