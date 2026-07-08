# Code HQ / Portfolio — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not
copy them. When you need detail, go read the source — don't rely on
stale paraphrase here.

## Vault (verified via QMD, 2026-07-08)

- Vault note `project_codehq-dashboard`
  (`2-Areas/Claude-Memory/project-codehq-dashboard.md`) — Code HQ project
  history: the scanner/dashboard build (2026-07-03) and the semantic
  layer + nightly self-healing audit (2026-07-07); what it outputs, the
  commands, the skills it seeded, and the launchd/iCloud TCC gotcha to
  watch for.

Look it up with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "project_codehq-dashboard"
```

## Repo design specs (primary architecture references)

- `~/Code/.codehq/docs/specs/2026-07-07-semantic-layer-design.md` — the
  data model this agent reasons over: per-repo `STATUS.md` (volatile:
  status/Now/Next/Log) + `CLAUDE.md` (stable: how-to-run/architecture),
  dormant-repo `descriptions.json`, and how `codehq scan` rolls all of it
  into `projects.json` / `PROJECTS.md` / `dashboard.html`. Also documents
  the freshness loop (the `/wrap` and `/portfolio` skills, and the
  nightly drift-audit that self-heals `Now`/`Next` as `(inferred)`).
- `~/Code/.codehq/docs/specs/2026-07-07-phase-b-harness-design.md` — the
  proposed (not-yet-built) cross-repo dispatch harness: safety tiers
  (green/yellow/red), worktree-per-target workers, Telegram HITL gate.
  Read this to know what's designed vs. what's actually shipped — Phase
  B has NOT been built as of this writing; this agent's real surface
  today is orientation/recall (Phase A), not dispatch.

## Tool access

`tools: []` in the manifest — no MCP server backs this agent. Code HQ is
driven entirely by its own CLI:

```
node ~/Code/.codehq/bin/codehq.js <scan [--no-audit] | init-git [--dry-run] [names…] | check-secrets [--staged] [dir] | status-stub <name>>
```

- `scan` — the nightly (and on-demand) full scan: rescans every repo,
  runs the drift self-heal audit, writes `projects.json` / `PROJECTS.md`
  / `dashboard.html`, and sends the Telegram digest. This agent should
  treat these three outputs as read-only, generated data — reason over
  them, never edit them by hand.
- `status-stub <name>` — scaffolds a fresh `STATUS.md` for a named
  project from `~/Code/.codehq/templates/STATUS.template.md`. This is
  the one mutating action this agent may be asked to trigger, and only
  with Ryan's explicit go-ahead (see persona.txt Autonomy).
- `check-secrets [--staged] [dir]` — secret-sweep gate; informational
  only for this agent.
- `init-git` — one-time repo bootstrapping; out of scope for this agent.

No stub is needed here since the manifest's tool list is empty (see
`mcp.json`) — there is no MCP server to wire, honest or otherwise.

## Roster context

Sibling RyanOS agent on the Personal/RLOS team: Daily Planner (Planner),
who owns day-to-day scheduling/tasks. This agent owns portfolio-wide
project state (what exists, what's live/dormant/drifted) — hand off
scheduling asks to Planner rather than attempting them here.
