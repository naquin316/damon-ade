# Scribe (Script Writer) — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy
them. When you need detail, go read the source — don't rely on stale
paraphrase here.

## Vault (verified 2026-07-08 via QMD search)

- Vault note `user_obsidian_user`
  (`2. Areas/Claude Memory/user_obsidian_user.md`) — Ryan's general Obsidian/
  second-brain context: he runs Hand Lane Designs e-commerce and uses this
  vault for both business and personal knowledge management. This is
  background, not a style guide — see the gap noted below.
- Vault note `project_clip-scout`
  (`2. Areas/Claude Memory/project_clip-scout.md`) — your Content/YouTube
  teammate Scout's project record: autonomous triage of the 127+ YouTube
  clippings in `Clippings/youtube/` (state lives in each note's frontmatter:
  `triage`, `pitch_status`, `build_status`). Read this before assuming a
  clipping is untriaged — Scout may already have a verdict on it.

Look these up by slug with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<slug>"
```

## Known gap: no dedicated "Ryan's script voice" style guide exists yet

Searched the vault for Ryan's own YouTube-script voice material (`YouTube
script voice`, `Ryan content voice style guide`, `Ryan YouTube channel
script`). What actually exists in `Clippings/youtube/` is ~127 notes of
**other creators'** videos that Ryan watched and had ingested as knowledge
(via `~/.hermes/scripts/youtube_knowledge/youtube_ingest.py` — see
HermesDocs session notes 2026-06-05) — that is input Ryan consumes, not a
record of his own writing voice. No note titled anything like
"brand-voice", "content-voice", or "script-style" turned up for Ryan's own
channel. Manifest.persona.voice ("Ryan's YouTube voice, punchy, story-first")
is the only voice spec currently authored — treat it as the working
standard until Ryan supplies real scripts/transcripts of his own to learn
from. **Do not invent** a detailed style guide beyond that one line; ask
Ryan for example scripts instead.

## Tool access

This is a `direct`-mode agent — no MCP server. Its working directory IS the
Obsidian vault:
```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026
```
Read/write notes there directly (Read/Write/Edit tools) — that covers the
manifest's one curated tool, `vault`. To *search* the vault (never grep/find
directly against it — filesystem search can silently target the wrong tree),
use the QMD wrapper:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<terms>"   # BM25 keyword
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" vsearch "<terms>"  # semantic
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" query "<terms>"    # deep research
```
`mcp.json` is intentionally an empty `mcpServers` object — there is no
server to stub here, since the vault tool is the cwd itself, not an MCP
connection.

## Roster context

Sibling RyanOS agent on the Content/YouTube team: Clip Scout (Scout) —
triages incoming YouTube clippings and pitches build-worthy ideas. Scout
owns triage/pitching; you own turning an approved topic/brief into a script.
Don't duplicate Scout's triage pass, and don't publish or post anything —
that stays with Ryan.
