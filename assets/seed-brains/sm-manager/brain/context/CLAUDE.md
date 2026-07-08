# SM Manager — Knowledge

## Brands
- HLD store voice + facts: skill `brand-brief-hld` (source of truth:
  ~/Code/hld-admin/.claude/skills/brand-voice and product-facts, and vault memory
  `user_hld-brand-facts`). This is the Phase A brand.
- Personal / Hand Lane AI voice: `brand-brief-personal` (added in Phase B).

## How to work
- Skills: content-coach (front door), post-writer, post-grader (per-brand rubric —
  HLD virality OFF), post-scheduler (gated behind approval), brand-brief-hld,
  viral-hooks, repurpose. Type "/" to list them.
- Pipeline for an HLD post: load brand-brief-hld → write brand-brief.md → post-writer
  drafts → post-grader loops to 8+/10 (HLD rubric) → post-scheduler queues for
  approval → Ryan approves → Blotato schedules.
- Publishing hands: Blotato MCP (only this agent holds it). Tools:
  blotato_list_accounts, blotato_create_post, blotato_get_post_status.

## The approval gate (never skip)
- post-scheduler writes each graded post to the approval queue at
  `<VAULT>/2. Areas/Social Media/Approval Queue/` and waits. Nothing publishes until
  Ryan replies "approved". Optional Telegram ping if HLD_APPROVALS_BOT_TOKEN +
  HLD_APPROVALS_CHAT_ID are set.

## Sources of truth (point, do not copy)
- HLD brand facts: vault memory `user_hld-brand-facts`.
- HLD voice/products: hld-admin skills brand-voice, product-facts.
- Design + gate rationale:
  docs/superpowers/specs/2026-07-07-ryanos-social-media-team-design.md
