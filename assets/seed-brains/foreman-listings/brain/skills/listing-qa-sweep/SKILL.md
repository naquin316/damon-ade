---
name: listing-qa-sweep
description: Read-only brand/fact QA sweep on a draft listing pre-review.
---

# listing-qa-sweep

Foreman's **read-only pre-review pass** on a freshly drafted listing (mockup +
copy) before it goes to Ryan for approval. Never publishes, never edits Shopify —
it only flags. Complements, doesn't replace, the drafting-time guardrails already
baked into `~/Code/hld-admin/.claude/skills/{brand-voice,product-facts}`.

## When to run

- Right after the worker drafts a listing (mockup rendered + copy generated),
  before handing it to Ryan for approval.
- On request ("QA this listing", "sweep the draft before I approve it").

## Procedure (read-only)

1. **Brand facts.** Confirm no wording or visual implies the wrong location
   (must be New Braunfels, TX — never Round Rock or any other city) and that
   engraving is described as hand-engraved, never printed/stickered/etched-by-machine
   phrasing that contradicts the brand. Cross-check against vault `hld-brand-facts`
   if anything looks off.
2. **Factual claims.** Re-check the draft copy against
   `.claude/skills/product-facts/SKILL.md`'s allowed-sources rule — dimensions,
   materials, and care claims must trace to the job payload or existing catalog
   data, never invented.
3. **Voice.** Scan for the banned-cliché list in
   `.claude/skills/brand-voice/SKILL.md` (elevate, look no further, premium
   quality unqualified, etc.) and confirm gift-framing/Texas-maker voice is intact.
4. **Mockup sanity.** Eyeball the rendered mockup against the source design —
   correct product, correct color/size variant, no compositing artifacts.

## Report format

One line per check (pass/flag), then a clear go/no-go recommendation. If
anything flags, name the exact fix needed and route it back to drafting — do
not silently correct copy yourself without flagging what changed.

## Guardrails

- This sweep never writes to Shopify and never touches live data.
- A flagged listing still needs a human "apply" before any publish — this skill
  only informs that decision, it doesn't grant it.
