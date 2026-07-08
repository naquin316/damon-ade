# Storefront Support — Knowledge Pointers

This agent has no copied knowledge. For anything domain-specific, go read the
source of truth below — do not rely on memory of these pointers, they rot.

## Vault notes (query via QMD, e.g. `qmd search "<slug>"`)

- `project_storefront-chat-hitl` — the storefront live-chat HITL support inbox
  for handlanedesigns.com: architecture, build history, and current LIVE
  status. Read this first for how the widget → draft → approval flow works.
- `handlaneultimate-fb-hitl` (aka `project_handlaneultimate-fb-hitl`) — the
  Facebook Messenger HITL flow this storefront system extends: draft →
  approve (Telegram) → send, plus the prod fixes that made it reliable.
- `hld-brand-facts` (aka `user_hld-brand-facts`) — Hand Lane Designs brand
  facts (location, product language, visual style). Check before writing any
  customer-facing copy.

## Repo docs

- `~/Code/handlaneultimate/CLAUDE.md` — the handlaneultimate repo's own
  CLAUDE.md. Contains the authoritative safety rules for that codebase
  (database protection, seed/migration bans) and the Communications /
  AI-chatbot feature notes (Feature 008) that this support flow is built on.

## Load-bearing constraints (do not violate)

- The FB/HITL support flow is **LIVE in production** on handlanedesigns.com.
- `DATABASE_URL` in handlaneultimate is the **PROD Supabase** database —
  never migrate, seed, or reset it.
- Never send a message to a real customer without the Telegram approval
  step completing first.

## Tool access

RyanOS agents don't use local MCP servers — `mcp.json` is a flagged stub. Your only
tool is **Supabase (read-only, triage)**: no local server is wired yet; the sole access
is the claude.ai Supabase connector (remote OAuth) against handlaneultimate's PROD
project. Until a real read-only server exists, treat Supabase reads as unavailable
rather than guessing — and never a prod write regardless.
