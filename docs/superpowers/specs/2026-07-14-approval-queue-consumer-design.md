# Approval Queue Consumer (`drain-queue`) — Design

- **Date:** 2026-07-14
- **Repo:** damon-ade (RyanOS)
- **Status:** proposed
- **Linear:** RYA-166 (consumer), RYA-167 (orphaned approve prompt)
- **Follows:** `2026-07-14-orchestrator-durability-upgrades-design.md`

## Summary

Nothing reads `status: approved`. Agents *write* the status field; no process ever
*reads it as a signal*. So approving is a no-op, and 16 posts sit in
`2. Areas/Social Media/Approval Queue/` — most from 2026-07-08, six days stale.

The gate isn't broken. It works perfectly: nothing has ever published unreviewed.
What's missing is the other half — finished work has no path out.

This spec adds the consumer: a scanner that hands `status: approved` notes to
`post-scheduler`, so approving is **one word edited in Obsidian**, which is exactly what
the notes already tell you to do.

## Why this first

The vault is in iCloud and already syncs to Obsidian on Ryan's phone. So the consumer
**alone** delivers phone approval — no app, no bot, no new surface. Edit one word on the
couch and it ships. That is the entire Phase 5 unlock, and it's why RYA-166 precedes
triggers: adding triggers while output is trapped just manufactures backlog.

## Invariants (non-negotiable)

1. **It never approves anything.** It ships only what is *already* explicitly marked
   `approved` by a human. There is no path in this code that writes `status: approved`.
2. **It never publishes twice.** A cron loop over an async shipper is a double-post
   machine unless claims are explicit. See *Claiming*.
3. **It reports rather than fails.** "Approved but no media" is a *finding*, not an
   error — surfaced to Ryan, queue left untouched.
4. **Dry-run is the default.** Shipping requires an explicit `--ship`. The LaunchAgent
   passes it; a human typing the command by hand does not, by accident.

## Architecture

```
apps/desktop/src/main/lib/approval-queue/
  queue.ts        — PURE: scan, tolerant parse, classify. No I/O effects, no Electron.
  queue.test.ts   — unit tests (bun test, desktop workspace)
  ship.ts         — effects: claim, dispatch, write back
apps/desktop/scripts/drain-queue.ts   — CLI entry (bun runs .ts natively)
~/Library/LaunchAgents/com.ryan.drain-queue.plist   — follows com.ryan.* convention
```

**Why a standalone script and not the main process.** The whole value is approving from
the phone while the Mac sits closed. A watcher inside Electron only fires while RyanOS is
open, which is precisely when Ryan does *not* need it. `bun` executes TypeScript directly,
so the script shares the repo's modules and test runner with no build step, and never
imports Electron.

**Same entry point both ways.** The LaunchAgent and the on-demand `/drain-queue` skill
call the identical script. The manual path is free.

## Transport: why it goes through a headless agent

Blotato is an **OAuth HTTP MCP** (`https://mcp.blotato.com/mcp`). There is no API key —
checked `env` and `~/.secrets.zsh`, nothing. So a plain Node script *cannot* call Blotato.

The shipper therefore dispatches a headless `claude -p` against the **sm-manager** brain,
reusing its authed MCP session and the existing `post-scheduler` skill — the same
detached-spawn pattern the orchestrator already uses (`orchestrator.ts` `spawnHeadless`).

Consequence worth stating: `post-scheduler`'s own gate ("WAIT for the operator") is
satisfied *before* dispatch, by the human-set `status: approved` in the note. The drain
passes that approval through; it does not bypass the gate, and it does not create one.

## Parsing: tolerant, per the 4f17f3f lesson

Queue notes are **agent-written**, which is the exact case where `handoff.ts` learned that
strict YAML silently destroys completed work: an unquoted `result:` holding "Note: …"
made `splitFrontmatter` return `{}`, read back as `pending`, and a finished node was
thrown away for a quoting slip.

Same contract applies here, for the same reason. `status:` is read by line scan when the
YAML parse fails. Strictness buys nothing (no second reader) and costs real posts.

Observed heterogeneity in the live queue, all of which the parser must absorb:

| Field | Reality |
|---|---|
| `platform` | `instagram`, `x`, **`instagram + facebook`** (multi, space-plus-separated) |
| `media` | present on some notes, absent on others |
| `accountId` | present on one note as `6789` — **looks like a placeholder, not a real id** |
| `status` | `pending` / `scheduled` / `skipped` |

## Claiming: the double-post problem

This is the one genuinely dangerous part, and it's why this isn't a 40-line script.

Cron ticks every N minutes. Shipping is async (a headless agent that takes a while). Tick
2 will re-read a note that tick 1 is still shipping and ship it **again** — a duplicate
post on a real public account.

So the drain **claims** before dispatch: rewrite `status: approved` → `status: scheduling`
+ `scheduling_started: <ISO>`. A claimed note is invisible to the next tick.

### The reclaim decision (deliberate, and it inverts the orchestrator's default)

What about a note stuck at `scheduling` — the agent died, or the Mac slept?

The orchestrator's recovery rule is *mtime-bounded resume*: untouched longer than a
timeout ⇒ abandoned ⇒ safe to re-enter. **That rule is wrong here, and applying it by
reflex would be the worst bug in this system.**

A stuck `scheduling` note is genuinely ambiguous:

- The agent died **before** calling Blotato → re-shipping is correct.
- The agent called Blotato and died **before writing back** → re-shipping **double-posts
  publicly**.

Nothing on disk distinguishes them. The orchestrator can gamble on resume because its
side effects are vault writes (idempotent, private, reversible). This shipper's side
effect is a **public post on a real brand account** — irreversible, and embarrassing in a
way no unit test will catch.

**Decision: a stuck claim is never auto-retried.** It goes to `status: needs-review` with
the timestamp, and the run reports it. Ryan checks Blotato and decides. An unresolvable
ambiguity in front of an irreversible public action escalates to a human — it does not
get a default.

## Media gate

Instagram requires a media URL at approval time (`post-scheduler` Step 2). A note with
`platform: instagram` and no `media:` is classified **`blocked: no-media`** — reported,
never shipped, never mutated. It stays `approved` so attaching media and re-running works
with no re-approval.

## Output

Every run prints (and the LaunchAgent logs to `~/.ade/drain-queue.log`):

```
Approval Queue drain — 2026-07-14T07:40:00Z  [DRY RUN]
  shipped        0
  blocked        1  (no-media)  2026-07-14-hld-ig-still-on-his-desk.md
  needs-review   0
  untouched     20  (16 pending, 1 scheduled, 4 skipped)
```

Nothing to do is the common case and must be quiet and obvious.

## Test plan

Unit (pure, no vault, no network):
- `approved` + media → shippable
- `approved` + instagram + no media → `blocked: no-media`
- `pending` / `skipped` / `scheduled` → untouched (**the never-approve invariant**)
- unparseable YAML with `status: approved` → still detected by line scan (4f17f3f)
- `platform: instagram + facebook` → two targets
- claimed note (`scheduling`) → skipped by a concurrent tick (**the double-post invariant**)
- stale `scheduling` → `needs-review`, never re-dispatched

Live: dry-run against the real 21-note queue, assert `shipped 0` and zero mutations.

## Non-goals

- No Telegram tap-to-approve (Phase C; it just flips the status this consumer reads).
- No new dashboard — The Conn owns the phone surface (2026-07-12 LifeOS consolidation).
- No auto-approval, ever, under any flag.

## Open question for Ryan

`accountId: 6789` on `2026-07-08-hld-ig-teacher-tumbler.md` looks like a placeholder
rather than a real Blotato account id. If it is, the drain should ignore `accountId` and
let `post-scheduler` resolve accounts via `blotato_list_accounts` (its Step 3 already
does). Confirm before the first live ship.
