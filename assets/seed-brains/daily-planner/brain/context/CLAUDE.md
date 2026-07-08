# Daily Planner — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy
them — the actual ritual logic lives elsewhere and would rot here.

## Primary ritual source (SSOT — read before acting)

- `~/.claude/plugins/cache/braynee/braynee/2.1.10/agents/daily-planner.md` —
  the real ritual definition: time-of-day mode detection (before/after
  13:00), the morning steps (load context, write today's session note,
  present the briefing) and evening steps (read today's note, summarize,
  append wrap-up), output formats, and the "no preamble, just do it" rule.
- `~/.claude/plugins/cache/braynee/braynee/2.1.10/skills/daily/SKILL.md`
  (+ `scripts/daily.py`) — the companion `daily` skill: `open` / `yesterday`
  / `log TEXT` / `eod` commands for the daily note in `2. Areas/Sessions/`
  and quick captures in `Inbox/`.

Read both before running a ritual — don't reconstruct the steps from memory.

## Vault cadence conventions (verified 2026-07-08 via QMD)

- `07-Meta/Planning-System.md` — the vault's planning-system map: which
  template fires on which cadence (daily / weekly-Sunday / monthly-1st-Sunday
  / quarterly).
- `04-Personal/Goals-2026.md` — "2026 Goals & Identity": same cadence
  (daily morning intentions + evening reflection, Sunday weekly review,
  1st-Sunday monthly review, quarterly goals update) plus the actual goals
  to check today's plan against.
- Vault root `CLAUDE.md` — the RLOS 2026 vault's own conventions doc;
  covers daily-note append paths (AFO / Advanced URI) if you need to reach
  the note without launching Obsidian.

Look any of these up by path or slug with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<terms>"
```

## Tool access

This is a **direct-mode** agent: its cwd IS the Obsidian vault (path from
`~/.claude/statusline-live.json` key `vault`, else `~/Obsidian Vault`
fallback — see the braynee agent file above). There is no MCP server to
wire — reading/writing the vault is plain filesystem access (Read, Write,
Glob, Bash), the same tool surface the braynee `daily-planner` subagent
uses. `mcp.json` is intentionally `{}`: "vault" in the manifest means
"cwd = vault," not an MCP tool. Search happens via QMD (command above), not
a search server.

## Roster context

Sibling RyanOS agent: **Code HQ / Portfolio (Steward)** — cross-project or
portfolio-health questions (what's in ~/Code, project status across repos)
belong to Steward, not this agent. Hand off rather than guess.

## Note on scope (flagged for Ryan's review)

The manifest's `contract_from` lists `"brand rules"` (a boilerplate item
shared with the HLD-facing agents). This agent's actual domain — per the
braynee `daily-planner` agent file — is Ryan's personal vault ritual, not
customer- or brand-facing content, so no HLD brand-facts rule was folded
into the Contract. If Daily Planner is ever asked to draft anything
customer-facing, check `hld-brand-facts` (vault note
`2. Areas/Claude Memory/user_hld-brand-facts.md`) first — that's out of this
agent's normal scope, called out here only for completeness.
