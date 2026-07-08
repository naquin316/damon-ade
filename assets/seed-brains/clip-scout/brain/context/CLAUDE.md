# Clip Scout — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy
them. When you need detail, go read the source — don't rely on stale
paraphrase here.

## The real operating surface (skill, not this repo)

Clip Scout's actual pipeline is NOT this ADE repo — it's a globally installed
Claude Code skill Ryan already built and wired on 2026-07-07:

- `~/.claude/skills/clip-scout/SKILL.md` — the full four-phase runbook
  (POUR → TRIAGE → DIGEST → LOG), config table (vault path, batch size,
  pitch/run-log/dashboard paths), flags (`--batch N`, `--dry-run`,
  `--note <file>`), and the idempotency rule (never re-touch a note that
  already has a `triage` key). Read this before running anything.
- `~/.claude/skills/clip-scout/scripts/scan.mjs` — the frontmatter-driven
  scanner (`pending`, `approved`, `counts` subcommands). Use this, never
  grep/find on vault paths — braynee's vault-search-guard blocks those
  outright and its override can't be toggled per-command.
- `~/.claude/skills/clip-scout/references/pitch-prd-template.md` — the
  mini-PRD template every pitch record follows.

## Vault state (this agent's cwd)

Direct-mode agent — cwd IS the vault
(`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026/`):

- `Clippings/youtube/` — the clipping notes being triaged; frontmatter
  (`triage`, `pitch_status`, `build_status`) is the state machine.
- `Clippings/youtube/Clip Scout Pipeline.base` — the dashboard view.
- `2. Areas/Clip Scout/Pitches/` — one mini-PRD per pitch, `pitch_id:`
  frontmatter (global, sequential — what Ryan's Telegram replies reference).
- `2. Areas/Clip Scout/Run Log.md` — one row per run.
- `2. Areas/Clip Scout/outbox/` — Telegram-ready digests; Hermes relays and
  moves them to `outbox/sent/`.
- `2. Areas/Claude Memory/MEMORY.md` — check before pitching: Dify, Rybbit,
  and tank are shelved, never re-pitch them.

## Vault memory (verified 2026-07-08 via QMD)

- Vault note `project_clip-scout`
  (`2. Areas/Claude Memory/project-clip-scout.md`) — build history
  (2026-07-07), the shadow-vault path gotcha Roux hit and fixed (always
  verify Hermes vault writes land in the iCloud path, not
  `~/Documents/Obsidian/RLOS_2026`), and that approval-reply routing is
  Hermes's own skill `roux-clip-scout-approval` — not this agent's code to
  fix if it misbehaves.

Look it up with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "project_clip-scout"
```

## Tool access

`mcp.json` is genuinely `{ "mcpServers": {} }` here — not a stub-to-fill-in.
Clip Scout is a `direct`-mode ADE agent (seed-cockpit.ts source type
`"direct"`, not `linked-worktree`): its cwd IS the Obsidian vault, so "vault"
in the manifest's `tools: ["vault"]` means cwd, not an MCP server to wire.
The real access route:
- **Filesystem** — this agent's cwd is the vault itself; read/write/edit the
  files above directly.
- **Search** — QMD only (`qmd-wrapper.mjs search "<term>"`), never grep/find
  on vault paths (blocked by braynee's vault-search-guard).
- **Approval loop / cron** — owned by Hermes, not this agent: Hermes runs the
  daily cron, relays `outbox/` to Telegram, and routes `approve/decline/later
  <pitch_id>` replies back into frontmatter. This agent's job starts and ends
  at reading that frontmatter, not the Telegram transport.

## Roster context

Sibling RyanOS agent on the Content / YouTube team: Script Writer (Scribe) —
owns voice/outline drafting for scripts. Clip Scout triages and pitches;
Scribe writes. Hand off scripting asks, don't attempt them here.
