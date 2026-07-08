# Store Cockpit — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy them.
When you need detail, go read the source — don't rely on stale paraphrase here.

## Repo (primary operating manual)

- `~/Code/ShopifyStore/CLAUDE.md` — the full operating doc for this agent's home repo:
  the three modes (Theme / Listing / Growth), the Foreman wall, the preview-then-confirm
  safety rule, credential locations, and repo layout. Read this first for anything
  procedural.
- `~/Code/ShopifyStore/docs/superpowers/specs/2026-07-07-hld-store-cockpit-design.md` —
  full design spec, if you need architectural depth beyond CLAUDE.md.
- `~/Code/ShopifyStore/reference/brand.md` — HLD brand facts + voice, usable without
  asking.

## Vault (verified 2026-07-08 via QMD search — see brain-author report for exact hits)

- Vault note `hld-store-cockpit` (`2. Areas/Claude-Memory/project-hld-store-cockpit.md`) —
  project history and status for the Cockpit: what shipped, related projects
  (`project-hld-storefront-theme`, `project-foreman-hld-admin`), and the Foreman
  boundary decision.
- Vault note `hld-brand-facts` (`2. Areas/Claude-Memory/user-hld-brand-facts.md`) —
  Hand Lane Designs brand facts. Key fact to hold onto without re-deriving it: HLD is
  based in **New Braunfels, TX** (NOT Round Rock), and product wording is
  **hand-engraved**. Customer-facing visuals must match the live storefront style.
- Vault note `feedback_shopify-admin-api-not-zapier`
  (`2. Areas/Claude-Memory/feedback-shopify-admin-api-not-zapier.md`) — the standing
  feedback this agent's Contract enforces: HLD Shopify writes go through the custom
  Admin API app, never Zapier MCP (credit cost + missing scopes).

Look these up by slug with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<slug>"
```

## Roster context

Sibling RyanOS agents on the HLD Ops team (for handoff, not for this agent to act as):
Storefront Support (Concierge), RubyPulse/Laser, Foreman/Listings. New-product-creation
requests belong to Foreman — hand off, don't attempt.
