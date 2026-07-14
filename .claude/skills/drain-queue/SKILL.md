---
name: drain-queue
description: Ship approved posts out of the Social Media Approval Queue. Use when the user says "drain the queue", "ship approved posts", "what's approved", "why hasn't my post gone out", or asks what is waiting in the Approval Queue.
version: 0.1.0
platforms: [macos]
allowed-tools: Bash, Read
metadata:
  ade:
    tags: [RyanOS, SocialMedia, Orchestrator]
---

# Drain Queue

Consumer for `2. Areas/Social Media/Approval Queue/` (RYA-166). Hands every note a
human marked `status: approved` to sm-manager's `post-scheduler`.

The same script runs on a schedule via `com.ryan.drain-queue` — this skill is just
the on-demand door to it. Both paths share one code path, so there is no drift.

## The one rule

**This never approves anything.** It ships only what is *already* marked
`approved`. If you are tempted to set `status: approved` on Ryan's behalf: don't.
That is the human gate, and it is the only thing standing between a drafting agent
and a live brand account. Ryan approves by editing the note (including from
Obsidian on his phone — the vault is in iCloud).

## Usage

Always look before you ship. Dry run is the default and mutates nothing:

```bash
bun apps/desktop/scripts/drain-queue.ts
```

Then, only if the report looks right:

```bash
bun apps/desktop/scripts/drain-queue.ts --ship
```

Run from the repo root (`~/Code/damon-ade`).

## Reading the report

```
Approval Queue drain — 2026-07-14T20:32:12Z  [DRY RUN]
  would ship     0
  blocked        0
  needs-review   0
  untouched     21  (16 pending, 1 scheduled, 4 skipped)
```

| Line | Meaning | What to do |
|---|---|---|
| `would ship` / `shipped` | approved, valid, dispatched to post-scheduler | nothing |
| `blocked` | approved but unshippable — `no-media` (Instagram needs a media URL) or `no-platform` | attach `media:` to the note, re-run; no re-approval needed |
| `needs-review` | a shipper claimed this note and never reported back | **check Blotato before touching it** — see below |
| `in flight` | claimed by a run that is still going | wait |
| `untouched` | not approved | nothing — this is the normal resting state |

## needs-review means a human decides

A note parks at `needs-review` when a shipper took the claim and died. That state is
genuinely ambiguous: the agent either died **before** calling Blotato (never posted)
or **after** (already posted). Nothing on disk distinguishes them.

So: **open Blotato and look.** If the post is not there, set the note back to
`approved` and re-run. If it is there, set `status: scheduled` and add the post id.
Never re-approve a `needs-review` note without checking — that is how you
double-post on a live account.

## Notes

- `status: scheduling` is a claim, not a state Ryan sets. Don't hand-edit it.
- Instagram requires media at approval time; the drain reports that rather than failing.
- Design + invariants: `docs/superpowers/specs/2026-07-14-approval-queue-consumer-design.md`
