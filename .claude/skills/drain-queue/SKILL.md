---
name: drain-queue
description: Ship approved posts out of the Social Media Approval Queue via Blotato. Use when the user says "drain the queue", "ship approved posts", "what's approved", "why hasn't my post gone out", or asks what is waiting in the Approval Queue.
version: 0.2.0
platforms: [macos]
allowed-tools: Bash, Read
metadata:
  ade:
    tags: [RyanOS, SocialMedia, Orchestrator]
---

# Drain Queue

Consumer for `2. Areas/Social Media/Approval Queue/` (RYA-166). Schedules every note
a human marked `status: approved` through the **Blotato REST API**.

The same script runs on a timer via `com.ryan.drain-queue` — this skill is just the
on-demand door to it. One code path, no drift.

## The one rule

**This never approves anything.** It ships only what is *already* marked `approved`.
If you are tempted to set `status: approved` on Ryan's behalf: don't. That is the
human gate, and it is the only thing between a drafting agent and a live brand
account. Ryan approves by editing the note — including from Obsidian on his phone,
since the vault is in iCloud.

## Usage

Always look before you ship. Dry run is the default and mutates nothing:

```bash
./scripts/drain-queue.sh
```

Read the copy preview it prints. Then, only if it's right:

```bash
./scripts/drain-queue.sh --ship
```

Run from the repo root (`~/Code/damon-ade`). The wrapper resolves
`BLOTATO_API_KEY` from `~/.secrets.zsh`; for a one-off you can inject it yourself:

```bash
BLOTATO_API_KEY="op://Personal/Blotato/credential" op run -- ./scripts/drain-queue.sh
```

## Why REST and not the MCP

Blotato's MCP (`mcp.blotato.com`) authenticates by **interactive OAuth**. A headless
drain can never complete it — proven twice (Agent SDK and `claude -p`, both
`needs-auth`, zero tools), *even with the `blotato-api-key` header set*. The REST API
takes the same key in a header and just works. So the drain calls
`backend.blotato.com/v2` directly: no agent, no MCP, no ~$0.50 Opus session per post.

`api.blotato.com` is **not** a valid host — it's the one an LLM guesses. Don't "fix"
the base URL to it.

## Reading the report

```
Blotato: 5 connected account(s) — facebook, instagram, pinterest, threads, tiktok
Approval Queue drain — 2026-07-14T20:32:12Z  [DRY RUN]
  would ship     0
  blocked        0
  needs-review   0
  untouched     21  (16 pending, 1 scheduled, 4 skipped)
```

| Line | Meaning | What to do |
|---|---|---|
| `would ship` / `shipped` | approved, valid, scheduled on Blotato | nothing |
| `blocked` | approved but unshippable — see reasons below | fix the gap, re-run; no re-approval needed |
| `needs-review` | a send failed or a claim went stale | **check Blotato before touching it** |
| `in flight` | claimed by a run still going | wait |
| `untouched` | not approved | nothing — the normal resting state |

**Blocked reasons:** `no-connected-account` (e.g. Ryan has **no X and no LinkedIn**
account in Blotato — 8 of the pending notes target them), `no-media` (Instagram needs
a media URL), `no-page-id` (Facebook needs one), `no-platform`, `no-copy` (no
`## Final copy (verbatim)` section). All are *reports*: the note stays `approved` and
untouched.

## needs-review means a human decides

A note parks at `needs-review` when a send failed or a claim went stale. That state is
genuinely ambiguous: the post either never went out, **or already did** and the write-back
died. On a multi-platform note it can be *partly* live — check `blotato_post_ids:` for
what did go out.

So: **open Blotato and look.** If it isn't there, set the note back to `approved` and
re-run. If it is, set `status: scheduled`. Never re-approve a `needs-review` note
without checking — that's how you double-post.

## Notes

- `status: scheduling` is a claim, not a state Ryan sets. Don't hand-edit it.
- It never publishes-now: an approval schedules ~10 min out (or the note's explicit
  `scheduled_time:`), so there's always a window to cancel in Blotato.
- The copy is lifted from `## Final copy (verbatim)` by regex, and a trailing
  `**Facebook version:** …` annotation is stripped. That's why the dry run prints the
  exact text — eyeball it.
- Design + invariants: `docs/superpowers/specs/2026-07-14-approval-queue-consumer-design.md`
