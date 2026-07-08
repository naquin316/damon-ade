# RubyPulse — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy
them. When you need detail, go read the source — don't rely on stale
paraphrase here.

## Repo (primary operating manual)

- `~/Code/rubypulse/README.md` — full architecture (collector + Fastify
  server + dashboard, all in one Node process on the laser PC), the
  read-only safety model (`src/contract/ruby-contract.ts` is the one file
  that gates every Hot API path / Mongo read), setup, dev run, build,
  deploy (`scripts/deploy.sh`), running as the `RubyPulse` Windows
  Scheduled Task, alert channels, and known limitations/deferrals.
- `~/Code/rubypulse/STATUS.md` — current Now/Next/Roadmap/Done log: what's
  live today, what's still unverified against a real running job, and
  what to check next.

## Vault (verified 2026-07-08 via QMD search)

- Vault note `project_rubypulse`
  (`2. Areas/Claude Memory/project_rubypulse.md`) — project history: build
  date, architecture summary, related notes
  (`reference_trotec-ruby-internals`, `project_trotec-bridge`).
- Vault note `reference_trotec-ruby-internals`
  (`2. Areas/Claude Memory/reference_trotec-ruby-internals.md`) — the Ruby
  laser software's own internals (local .NET + MongoDB + Angular stack):
  ports, Mongo details, Hot API, home-screen image path. Load this before
  reasoning about anything upstream of RubyPulse's own contract file.

Look these up by slug with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<slug>"
```

## Reaching the laser PC

The laser PC (`TROTEC-PC`, `192.168.86.28`) is production hardware serving
real jobs — never disrupt it. Today there are two distinct, narrow access
paths (see `mcp.json` for the current tool-wiring status, which is a
flagged TODO, not a working command):
- `ask-trotec` — a shell function (`~/.zshrc`) hitting a token-authed
  claude-bridge HTTP endpoint on the box.
- Direct `ssh` (user `naqui`) — used only by `rubypulse/scripts/deploy.sh`
  for shipping builds.
Neither path is a substitute for RubyPulse's own read-only dashboard/API;
prefer the dashboard data first.

## Roster context

Sibling RyanOS agents on the HLD Ops team (for handoff, not for this agent
to act as): Shopify/Store Cockpit, Storefront Support (Concierge),
Foreman/Listings. Store/listing/customer-chat asks belong to them — hand
off, don't attempt.
