---
name: handoff
description: Pass work between RyanOS agents via a vault inbox queue.
version: 0.1.0
platforms: [macos]
metadata:
  ade:
    tags: [RyanOS, Handoff]
---

# Handoff

Pass work between RyanOS agents as durable vault notes. Two halves — use the one
your role calls for (your context's `## Handoffs` section says which). Never
touches MEMORY.md; never writes into any repo/worktree.

## When to Use
- SEND: you finished something another agent should act on (e.g. Store Cockpit →
  SM Manager: a post-worthy store event).
- RECEIVE: at session start, check whether another agent handed you work.

## Convention
- `<VAULT>` = `/Users/ryannaquin/Library/Mobile Documents/iCloud~md~obsidian/Documents/RLOS_2026`
- Inbox: `<VAULT>/2. Areas/Handoffs/<recipient-slug>/`; processed → its `done/` subdir.
- `<recipient-slug>` = the recipient's seed-brain slug (e.g. `sm-manager`,
  `shopify-store-cockpit`).
- One markdown note per handoff. Frontmatter IS the contract:
  `handoff_id, from, to, status (pending→drafted→done|rejected), brand,
  event_type, product (pointer), facts (postable specifics), angle, created`.

## Procedure — SEND
1. Pick the recipient + inbox path. Build `handoff_id = <date>-<event>-<handle>`
   (deterministic from the event, so the same event yields the same id).
2. Scan the inbox AND its `done/` — if a note with this `handoff_id` already
   exists, STOP (no duplicate).
3. Write `<inbox>/<handoff_id>.md` with `status: pending` and the full contract
   frontmatter + a short human body. Use pointers (title/handle/URL), never
   copied prose — EXCEPT `facts`, which carries the concrete promotable specifics
   (sale %, dates, price).
4. Fire-and-forget — do not wait; the recipient processes on its own schedule.
5. Write ONLY under the vault inbox. Never write into your own repo/worktree.

## Procedure — RECEIVE
1. List `<inbox>/*.md` where `status: pending`.
2. For each: read it, re-verify any `facts` against the live source of truth,
   then run your normal loop for that kind of work. Flip the note to
   `status: drafted`.
3. On completion (approved + done): set `status: done`, move the note to `done/`.
4. On rejection: set `status: rejected` + a one-line reason; do NOT auto-redraft.

## Pitfalls
- Duplicate handoffs — always dedup by `handoff_id` against inbox + `done/`.
- Stale `facts` — RECEIVE re-verifies before acting.
- Never write MEMORY.md; never write into another repo/worktree.

## Verification
- SEND: a contract-valid note exists in the recipient inbox with `status: pending`
  and no duplicate.
- RECEIVE: pending notes move to `drafted`/`done`; MEMORY.md untouched.
