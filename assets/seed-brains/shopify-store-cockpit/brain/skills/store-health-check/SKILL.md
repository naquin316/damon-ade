---
name: store-health-check
description: Read-only storefront + inventory health sweep (HLD Shopify).
---

# store-health-check

Store Cockpit's periodic **read-only pulse check** on the Hand Lane Designs store —
broader than a catalog copy audit: inventory posture, order backlog, and sales
trend in one pass. Never writes. Any finding that warrants a fix gets handed to
`edit-listing` (product) or `theme-tweak` (theme), each of which previews before
touching the live store.

## When to run

- On request ("check the store", "how's HLD doing", "health check").
- Proactively at the start of a Cockpit session, before taking any other action.

## Procedure (all read-only; run from `~/Code/ShopifyStore`)

1. **Catalog QA.** `node scripts/shopify/audit-scan.mjs --status ACTIVE` — brand-fact
   mismatches (e.g. wrong location), missing alt text, thin descriptions, missing SEO.
   For a deeper voice/quality pass instead of a mechanical one, dispatch the
   `store-auditor` subagent (see the repo's `store-audit` skill — this check
   complements it, doesn't replace it).
2. **Inventory posture.** `node scripts/shopify/product-list.mjs` — scan for
   zero/low-stock active variants and anything unpublished that should be live.
3. **Order backlog.** `node scripts/shopify/orders-list.mjs` — flag unfulfilled or
   stuck orders that need attention.
4. **Sales pulse.** `node scripts/shopify/sales-summary.mjs` — quick trend read
   (up/down/flat) to frame the rest of the report.

If a script's exact flags are unclear at run time, invoke it with `--help` first
rather than guessing options.

## Report format

Lead with anything urgent (🔴 out-of-stock on an active listing, stuck orders),
then medium (🟡 catalog QA findings), then a one-line sales pulse. Keep it
scannable — this is a status sweep, not a deep-dive. End with a clear
recommendation for what (if anything) to act on next, and wait for approval
before dispatching any fix.

## Guardrails

- Every step above is read-only. No script here calls `product-update.mjs` or
  `product-image-alt.mjs`.
- Never touch prod data without explicit confirmation — fixes route through
  `edit-listing` / `theme-tweak`'s own preview→confirm gate, one change at a time.
- If asked to create a brand-new product mid-sweep, stop and point to Foreman —
  that's outside this agent's wall.
