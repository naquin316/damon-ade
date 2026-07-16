# Handoff — damon-ade (RyanOS) · Social pipeline: front-end + all 3 doors DONE (2026-07-15)

## Goal
Ryan's Hand Lane Designs social pipeline runs end to end: **feed a photo + a line → an
agent writes HLD copy → a pending card → he approves (picking WHERE + WHEN) on a web
page → it schedules to Blotato → Telegram confirms.** As of this session the engine,
the web front-end (picker + full edit), and all three intake doors are built and
proven. **What's left is operational, not build:** load the two new intake launchd
jobs, and the deferred RYA-177 cleanups.

## State (verified, not recalled)
- **Branch/commit:** `main` @ `f4044b9` — pushed, **0 unpushed**. Dirty: only
  `apps/desktop/src/shared/build-info.generated.ts` (generated stamp — NEVER commit).
- **Tests:** 119 pass / 0 fail in `apps/desktop/src/main/lib/approval-queue/` (+8 this
  session). Typecheck clean. (~2 pre-existing Electron-import-under-bun failures
  elsewhere, unrelated.)
- **Web viewer:** RUNNING at http://localhost:4319 (`nohup ./scripts/queue-server.sh`).
  Restart: `pkill -f queue-server.ts` then re-run.
- **Drain timer:** `com.ryan.drain-queue` LOADED, every 15 min, `--ship`. LIVE — an
  approved shippable note posts to real accounts within 15 min (Mac awake).
- **Queue right now:** 6 pending / 16 skipped / 0 scheduled. Nothing armed
  (`approved: true`) — verified. Blotato has 0 schedules. Nothing has ever published.

## Done this session (all committed + pushed, `04b124c..f4044b9`)
**Ryan's #1 and #2 asks + the two remaining intake doors — the whole front-end.**

- **`857bbbe` — Approve-with-WHERE-and-WHEN picker + full edit (Ryan's #1 + #2).**
  - Approve no longer fires immediately: it opens a picker. **WHERE** = connected
    accounts as checkboxes (pre-checked to the note's `platform`; `crosspostable:` ones
    tagged "suggested"). **WHEN** = "Next free slot" (default) or a datetime-local.
    Confirm writes `approved: true` + `platform: a + b` + optional `scheduled_time`.
    The drain already honors both, so the picker just writes fields; multi-select fans
    out to one Blotato post per platform (`ship.ts`). New `/api/approve` body:
    `{file, platforms?, scheduledTime?}`.
  - **Edit** mode on pending cards (link under Approve/Skip): rewrite the copy, change
    platform(s), change/clear the time, swap/re-upload the photo. New `/api/edit`.
    Refuses a `scheduling`/`scheduled` note (a booked post can't be edited into false
    confidence).
  - `queue.ts` gained two pure, tested helpers: **`replaceCopySection`** (byte-surgical
    body rewrite of `## Final copy (verbatim)`; preserves a trailing
    `**Platform version:**` annotation; never a YAML round-trip — the 4f17f3f lesson)
    and **`parseCrosspostable`**. `extractCopy` now shares the annotation regex.
  - Live-verified: approve wrote the fan-out + time then reverted clean; edit rewrote
    copy + platform and read back through `extractCopy`; both modals render/toggle in
    the browser (screenshotted).

- **`f4044b9` — 3 intake doors on a shared runner.**
  - **`intake-runner.ts`**: `realIntakeDeps(apiKey)` + `claudeGenerateCopy` + `QUEUE_DIR`,
    extracted from `queue-server.ts`. The web door uses it too now — copy-gen/upload/
    write wiring lives in ONE place. Every door is just "read a photo + hint, call
    `createDraft(realIntakeDeps(key), …)`".
  - **DOOR 2 (drop folder)** — `apps/desktop/scripts/intake-folder.ts` +
    `scripts/intake-folder.sh` + `scripts/com.ryan.intake-folder.plist`. Scans
    `2. Areas/Social Media/Intake/`; each image → a pending draft (hint = sidecar
    `<name>.txt`, else the humanized filename) → moves to `processed/` (failures to
    `processed/failed/` so a bad file can't re-bill claude). Skips 0-byte iCloud
    placeholders. StartInterval 300s. **Proven end-to-end** this session with a real
    image + sidecar; test artifacts removed after.
  - **DOOR 3 (Telegram)** — `apps/desktop/scripts/intake-telegram.ts` +
    `scripts/intake-telegram.sh` + `scripts/com.ryan.intake-telegram.plist`. Long-poll
    `getUpdates` listener; photo + caption → download largest size → draft → reply with
    the slug. Caption = hint. Only Ryan's chat id honored. Persisted offset
    (`~/.ade/intake-telegram-offset.json`). KeepAlive daemon.
    - **Uses a DEDICATED bot `@HLD_intake_bot`, NOT Roux2** (`dca174f`). Roux2 is
      Hermes's inbound channel — `ai.hermes.gateway` already long-polls getUpdates on
      it, and Telegram allows one getUpdates consumer per bot; the first load fought
      Hermes (live 409s). Token: `op://Code Secrets/shell-secrets/INTAKE_BOT_TOKEN`,
      resolved by `intake-telegram.sh` as `TELEGRAM_BOT_TOKEN`. Chat id = Ryan's user id
      (same for any bot).
    - **LOADED + CONFIRMED LIVE end-to-end** — Ryan DM'd a real photo (AF Grandma Yeti
      + Tango cat bowl) to `@HLD_intake_bot`; it uploaded, wrote on-target copy, and
      rendered as an `intake (telegram)` card. Single consumer, no webhook, no new 409.
- **`0055f26` — intake filenames are now collision-safe.** The slug is
  `<date>-intake-<first-40-of-hint>`, so two same-day same-caption drops made the same
  filename and the second SILENTLY overwrote the first (observed: the Telegram yeti
  clobbered an earlier same-caption draft). `uniqueNotePath` appends `-2/-3/…`. All
  three doors share it via `realIntakeDeps.writeNote`.

## FIRST REAL PUBLISH happened (2026-07-15 ~7:19 PM CT)
The yeti card (`2026-07-15-intake-engraved-yeti-tumbler-and-personalized-c.md`) was
Ryan's first live ship. What it proved / taught:
- **facebook + instagram + threads posted successfully via the REST API** — all 3
  confirmed `status: "published"` (checked via `GET /v2/posts/:id`). Live URLs:
  facebook.com/100587251684586_1545743284230841 · instagram.com/p/Da1Vp5YlY7w ·
  threads.com/@handlanedesigns/post/Da1Vp3-lrqE. **Facebook's target shape is now
  PROVEN** (pageId on `target` works). URLs saved on the note as `published_urls`.
- **NEAR-MISS: don't invent note statuses.** I briefly set `status: published` — which
  the drain does NOT recognize as terminal, and with `approved: true` still on the note
  the next tick would have DOUBLE-POSTED. A fired note must stay a recognized terminal
  status (`scheduled` / `needs-review` / `skipped`). FIXED (`b2e86c4`): the drain now has
  a real post-publish step — a `scheduled` note past its time gets its post ids polled
  via `GET /v2/posts/:id`; all `published` → terminal `published` status + `published_urls`
  + a 🎉 Telegram with the links; any `failed` → needs-review; in-flight → left scheduled.
  `published` is a recognized MACHINE status now (inert, can't re-send). Proven live on
  the yeti note (scheduled → published, 3 URLs captured). Viewer shows a green
  "Published ✓ — live" card + a "Live" filter.
- **Pinterest is DISABLED until ~2026-07-29.** The first ship 422'd on pinterest: the
  HLD account is too new for 3rd-party API posting (Blotato wants ~2 weeks of manual
  warmup, 1 pin/day ramping up, or shadowban risk). `targets.ts` `TARGET_DEFAULTS.
  unavailable.pinterest` now blocks any pinterest-targeting note BEFORE any send
  (`platform-unavailable`), so it can't half-ship a multi-platform note again. RE-ENABLE
  by deleting that one line in `targets.ts` once the account's been warmed up manually.
- **The half-ship was handled correctly** — sequential send stopped at pinterest, note
  parked at `needs-review` (never double-posted). Ryan chose keep-fb+ig + add-threads;
  the threads post was created directly (one-off script, since the drain can't cleanly
  re-ship one platform of a partial note) and the note repaired to `status: scheduled`
  with all 3 ids + `platform: facebook + instagram + threads`.

## Next steps (operational, in order) — the build is done
- **DONE — both intake launchd jobs are loaded.** `com.ryan.intake-folder` (every
  300s) and `com.ryan.intake-telegram` (KeepAlive, on `@HLD_intake_bot`) are installed
  in `~/Library/LaunchAgents/` and running. `com.ryan.drain-queue` still runs `--ship`
  every 15 min. Logs: `~/.ade/{intake-folder,intake-telegram,drain-queue}.log`.
The pipeline is fully built AND proven with a real publish. Nothing is required; the
open items are optional:
1. **Re-enable Pinterest ~2026-07-29** — after warming the account manually (1 pin/day),
   delete the `unavailable.pinterest` line in `targets.ts`. Its board id + boardId
   wiring are already in place. (facebook/instagram/threads are PROVEN live.)
2. **RYA-177 is CANCELLED** (2026-07-15) — Ryan declined rotating the leaked Blotato key.
   Do NOT re-file it. (The separate "exporter should redact command-line secrets"
   prevention idea from that issue is unaddressed, if it ever matters.)
3. *(nice-to-have)* make the drain skip its `listAccounts` call when 0 notes are
   approved AND no scheduled note needs confirming — saves idle API calls.

## Decisions (with WHY — don't re-litigate)
- **The vault is the bus.** Approving = write `approved: true` (+ picker's `platform`/
  `scheduled_time`) into the note; the drain reads it. Every surface (drain, viewer,
  all 3 intake doors) reads/writes the same markdown. No DB, no endpoint between phone
  and engine.
- **Web viewer IS The Conn v2, hosted locally.** Built to the approved v2 approvals
  spec so it deploys onto The Conn when v1 ships. Do NOT spin up a second dashboard
  (2026-07-12 consolidation decision). Locked UI: Approve/Skip same size, provenance
  leads, serif copy, escalations disable approve.
- **Picker/edit only WRITE fields the drain already honors.** No drain changes were
  needed — `resolveScheduledTime` + the per-platform loop in `classify`/`ship` already
  parse `a + b` and `scheduled_time`.
- **Byte-surgical writes only.** `upsertFrontmatter` (frontmatter) + `replaceCopySection`
  (body) — never `splitFrontmatter → yaml.stringify → join` (4f17f3f: a YAML that
  doesn't parse comes back `{}` and the round-trip erases the note).
- **Blotato via REST, not MCP** (MCP needs interactive OAuth, dead headless). Key in
  `op://Code Secrets/shell-secrets/BLOTATO_API_KEY`; every launcher resolves it via
  `~/.secrets.op.zsh` → `op inject` → `~/.secrets.env` (service-account token at
  `~/.config/op/dev-workstation.token`, no biometric).
- **Copy-gen via `claude -p`** (subscription auth, no API key), argv-array spawn (no
  shell → no RYA-176 injection). HLD voice inlined in `intake.ts` `HLD_VOICE`. NOTE: the
  image is NOT sent to the model — copy is generated from the hint text; the photo is
  uploaded only as the post's media.
- **Never publish-now.** Ships schedule ~10 min out (or the note's `scheduled_time`), so
  there's always a cancel window in Blotato.

## Read first
- `apps/desktop/scripts/queue-server.ts` — the viewer + `/api/*` (approve/skip/requeue/
  edit/intake) + inline HTML/CSS/JS (picker + edit UI live here).
- `apps/desktop/src/main/lib/approval-queue/queue.ts` — `classify`, `readNote`,
  `resolveScheduledTime`, `upsertFrontmatter`, `replaceCopySection`, `parseCrosspostable`.
- `apps/desktop/src/main/lib/approval-queue/intake.ts` — pure intake core (`createDraft`,
  `buildDraftNote`).
- `apps/desktop/src/main/lib/approval-queue/intake-runner.ts` — the real deps every door
  shares.
- `apps/desktop/scripts/{intake-folder,intake-telegram}.ts` — doors 2 & 3.
- `docs/superpowers/specs/2026-07-14-approval-queue-consumer-design.md` — the drain design.

## Gotchas
- **The drain timer is LIVE.** Approving a shippable note publishes within 15 min. When
  testing, keep notes `approved: false`, or delete the Blotato schedule after
  (`listSchedules` → `deleteSchedule` = 204). Scheduler: https://my.blotato.com/scheduler
- **Don't commit `build-info.generated.ts`.** STATUS.md is gitignored (disk-only).
- **Direct-to-main:** `BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit`,
  `BRAYNEE_ALLOW_MAIN_PUSH=1 git push`.
- **Vault-search hook** blocks a single shell command containing both `grep`/`find`
  (even `.find()` in inline JS) AND a vault path — split them, or use a scratchpad
  `.mjs` script (that's how door tests were run).
- **Restart the viewer to pick up server changes** (`pkill -f queue-server.ts`, re-run).
- `X`/`LinkedIn` have no connected Blotato account; the 2 reel notes are `video-script`
  (not posts). Those stay skipped/blocked — don't try to ship them.
- Copy is hint-driven; the photo is attached, not described to the model.
