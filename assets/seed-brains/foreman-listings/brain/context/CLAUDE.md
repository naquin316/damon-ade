# Foreman — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy them.
When you need detail, go read the source — don't rely on stale paraphrase here.

## Repo (primary operating manual)

- `~/Code/hld-admin/CLAUDE.md` — the full operating doc for this agent's home repo:
  npm workspaces layout (`apps/dashboard` on Cloudflare Workers + D1 + R2,
  `apps/worker` running locally, `packages/mockup-engine`, `packages/shopify`),
  run/build commands, key paths, and the standing safety rule on live publishes.
- `~/Code/hld-admin/docs/superpowers/specs/2026-07-01-foreman-design.md` — the
  approved design spec, for architectural depth beyond CLAUDE.md.
- `~/Code/hld-admin/.claude/skills/{brand-voice,product-facts,listing-writer,pricing-analyst}/SKILL.md` —
  the drafting-time guardrails the Worker's Claude Agent SDK call already applies
  (banned clichés, factual-claim sourcing rules, pricing logic). Read before touching
  listing copy so you don't relitigate rules that already exist.

## Vault (verified 2026-07-08 via QMD search — see brain-author report for exact hits)

- Vault note `project-foreman-hld-admin`
  (`2. Areas/Claude-Memory/project-foreman-hld-admin.md`) — project history: the
  mockup-engine spike approved 2026-07-01, dashboard/worker unblocked, current build
  status. Check this before assuming a feature is or isn't built yet.
- Vault note `hld-brand-facts` (`2. Areas/Claude-Memory/user-hld-brand-facts.md`) —
  Hand Lane Designs brand facts. Key fact to hold onto without re-deriving it: HLD is
  based in **New Braunfels, TX** (NOT Round Rock), and product wording is
  **hand-engraved**. Customer-facing visuals must match the live storefront style.
- Vault note `feedback_shopify-admin-api-not-zapier`
  (`2. Areas/Claude-Memory/feedback-shopify-admin-api-not-zapier.md`) — the standing
  feedback this agent's Contract enforces: HLD Shopify writes go through the custom
  Admin API app (`packages/shopify`, the `hld-ops` app), never Zapier MCP (credit
  cost + missing scopes).

Look these up by slug with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<slug>"
```

## Tool access

RyanOS agents don't use local MCP servers — `mcp.json` holds flagged stubs. Reach tools via:
- **Shopify Admin API** → `~/Code/hld-admin/packages/shopify` (the hld-ops Admin API client,
  client-credentials), invoked from `apps/dashboard`'s Cloudflare Worker; secrets in
  `apps/dashboard/.dev.vars`. **Never Zapier.**
- **Cloudflare D1 / R2** → no local MCP server; hld-admin uses `wrangler` (`apps/dashboard`,
  `npm run db:migrate:local`) and the R2 binding in `apps/dashboard/wrangler.jsonc`. The
  claude.ai Cloudflare connector exists (remote) but isn't a local command.

## Roster context

Sibling RyanOS agents on the HLD Ops team (for handoff, not for this agent to act
as): Store Cockpit (edits EXISTING live products + theme + growth strategy),
Storefront Support (Concierge, customer chat HITL), RubyPulse/Laser (laser
telemetry, read-only). New-product creation stays with Foreman; editing a live
product or pushing theme changes belongs to Store Cockpit — hand off, don't attempt.
