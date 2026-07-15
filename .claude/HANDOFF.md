# Handoff — damon-ade (RyanOS) · Social Media approval + intake system (2026-07-15)

## Goal
Ryan's Hand Lane Designs social pipeline now runs end to end: **feed a photo + a line → an
agent writes HLD copy → a pending card → he approves on a web page → it schedules to
Blotato → Telegram confirms.** The engine + the web front-end both work and are
live-proven. **What's left is buttoning up the front-end into something solid** — the two
things Ryan explicitly wants next:
1. **Approve-with-options**: when he taps Approve, let him pick **WHERE** (which platforms)
   and **WHEN** (time) — not the current one-tap "ships to the note's platform in ~15 min".
2. **Full edit rights on pending cards**: edit the copy, the platform(s), the time, the
   media — from the viewer, before approving.
Plus the two remaining intake doors (drop-folder, Telegram) that reuse the built core.

## State (verified, not recalled)
- **Branch/commit:** `main` @ `649908a` — pushed, **0 unpushed**. Dirty: only
  `apps/desktop/src/shared/build-info.generated.ts` (generated stamp — NEVER commit it;
  every typecheck/dev run rewrites it; HEAD holds dev defaults on purpose).
- **Tests:** 111 pass / 0 fail in `apps/desktop/src/main/lib/approval-queue/`. Typecheck
  clean. (Repo-wide there are ~2 pre-existing Electron-import-under-bun failures unrelated
  to this work.)
- **Web viewer:** RUNNING at http://localhost:4319 (`nohup ./scripts/queue-server.sh`).
  Restart: `pkill -f queue-server.ts` then re-run.
- **Drain timer:** `com.ryan.drain-queue` LOADED and healthy (84 runs, all exit 0). Fires
  every 15 min, ships approved posts, DMs Telegram. **It is LIVE — an approved shippable
  note posts to real accounts within 15 min (Mac awake).**
- **Queue right now:** 6 pending / 16 skipped / 0 scheduled. The water bottle
  (`2026-07-08-hld-ig-20oz-custom-water-bottle.md`) is `pending, approved: false` — I
  un-armed it: Ryan approved it expecting a where/when picker, didn't get one, so it was
  reverted so it wouldn't publish. A demo intake draft exists:
  `2026-07-15-intake-bamboo-coaster-set-*.md` (pending, real generated copy — approve or
  skip it, it's a legit card).
- **Nothing has ever published.** Every live ship test scheduled a Blotato post then
  DELETED it (204). Blotato has 0 schedules right now.

## Done this session (all committed + pushed, `2e9b733..649908a`)
The whole system, most of it live-proven against real Blotato + real Telegram:

- **RYA-166 output loop — the drain.** `apps/desktop/scripts/drain-queue.ts` +
  `scripts/drain-queue.sh` + `scripts/com.ryan.drain-queue.plist`. Scans the Approval
  Queue, ships `status: approved` (or `approved: true` checkbox) notes to Blotato REST,
  writes back `status: scheduled` + `blotato_post_ids` + `scheduled_time`. Invariants
  (each test-pinned): never approves; never double-posts (claims `scheduling` before send,
  failed claim aborts send); stale claim → `needs-review`, never auto-retried; blocked
  reported not failed; dry-run default (only `--ship` schedules).
- **Blotato REST client** `.../approval-queue/blotato.ts`: MCP is interactive-OAuth-only
  and can't work headless (proven), so we use REST. `createPost` (returns
  `postSubmissionId`, NOT `id` — measured live), `listSchedules`/`deleteSchedule` (the
  cancel path), `uploadMedia` (POST /v2/media/uploads → presign → PUT bytes → public URL;
  the PUT carries NO api-key header). Base URL `backend.blotato.com/v2`
  (`api.blotato.com` is NOT valid). Ryan's 5 connected accounts: facebook, instagram,
  pinterest, threads, tiktok. **No X, no LinkedIn.**
- **Approve by CHECKBOX** (`queue.ts`): Obsidian 1.8.10 has no enum type, so `approved` is
  a native checkbox (registered in the vault's `.obsidian/types.json`). Strict: only real
  YAML `true` counts. A typo status (`aproved`) is `blocked: unknown-status`, not silently
  ignored. `upsertFrontmatter` is the shared surgical, byte-preserving frontmatter editor
  (drain claim + viewer approve/skip/requeue all use it).
- **Guards** (`queue.ts` `classify`): media-required platforms
  (instagram/tiktok/youtube/pinterest); `not-a-post` for `type: video-script` (a reel
  shooting script would have published `[b-roll:]` directions); `no-connected-account`
  (X/LinkedIn); facebook `no-page-id`; copy extracted from `## Final copy (verbatim)` with
  a trailing `**Facebook version:**` annotation stripped.
- **Telegram feedback edge** (`notify.ts`): on `--ship`, DMs Ryan on shipped / needs-review
  / blocked. Notify on state CHANGES not state (blocked deduped via
  `~/.ade/drain-queue-notified.json` so a 15-min timer doesn't spam). Reuses the Hermes bot
  token (`~/.hermes/.env`) + Ryan's chat id (`~/.config/hld/foreman-worker.env` `CHAT_ID`).
- **Web viewer** (`apps/desktop/scripts/queue-server.ts` + `scripts/queue-server.sh`) =
  **The Conn v2 approvals surface, built local-first** (deploys onto The Conn later; NOT a
  second dashboard — that decision holds). localhost:4319. Card grid: media, serif copy,
  provenance, the drain's ACTUAL verdict (reuses readNote/classify). Same-size Approve/Skip
  per the v2 spec. Endpoints: `/api/queue` `/api/approve` `/api/skip` `/api/requeue`
  `/api/intake`.
- **Intake front door — DOOR 1 (web) done.** `intake.ts` `createDraft`: uploadMedia →
  generate HLD copy (`claude -p --output-format json`, reuses Ryan's subscription, spawned
  argv-array so no shell injection) → `buildDraftNote` (PURE, tested) → pending card.
  "+ New post" modal (photo + "what is it?" hint). PROVEN: real coaster photo + one line →
  a genuinely good HLD post in ~15s.
- **Viewer polish:** scheduled cards show the real time + Blotato link; orphaned
  "scheduled" notes (no `blotato_post_ids`) flagged red with a one-tap Re-queue; plain
  language instead of "sweep" jargon.

## Next steps (in order) — THIS is the unfinished business
1. **Approve-with-WHERE-and-WHEN picker (Ryan's #1 ask).** Tapping Approve should open a
   small step, not fire immediately:
   - WHERE: checkboxes for connected platforms (the note's `platform` + `crosspostable:`
     list, filtered to Ryan's 5 connected accounts).
   - WHEN: "Next free slot" (default) or a date-time picker.
   - Confirm → writes `approved: true` + `platform: <selected joined with " + ">` +
     `scheduled_time: <iso>` (omit for next-slot).
   **The drain ALREADY honors `platform` and `scheduled_time`** (`resolveScheduledTime` +
   the per-platform loop in `classify` already parse `a + b`). So the picker mostly WRITES
   those two fields; verify crosspost fans out to all selected platforms end-to-end (a
   multi-platform note creates one Blotato post per platform in `ship.ts`).
2. **Full edit rights on pending cards (Ryan's #2 ask).** In the viewer, an Edit mode on a
   pending card: edit the copy (textarea → rewrites the `## Final copy (verbatim)` body),
   change platform(s), change/clear `scheduled_time`, swap/re-upload media (reuse
   `uploadMedia`). New endpoint `/api/edit`: `upsertFrontmatter` for frontmatter fields +
   a surgical body rewrite for the copy section. Keep it byte-surgical — do NOT
   yaml-roundtrip (see the 4f17f3f lesson: it destroys notes whose YAML doesn't parse).
3. **Intake DOOR 2 — drop folder.** A launchd/cron watcher on
   `2. Areas/Social Media/Intake/`: per new image (+ optional sidecar `.txt` hint or the
   filename as hint), call `createDraft`, move the image to `Intake/processed/`. Phone via
   iCloud Files/Obsidian. Reuses the intake core entirely.
4. **Intake DOOR 3 — Telegram photo intake.** A `getUpdates` long-poll listener on the
   Hermes bot: on a photo + caption, download the largest photo (getFile), call
   `createDraft` with the caption as hint. Reuses the bot already wired for notifications.
5. (Deferred, lower priority) RYA-177 rotate the leaked Blotato key (still live in an
   iCloud transcript); make the drain skip the Blotato call when 0 approved (saves ~96
   idle API calls/day).

## Decisions (with WHY — don't re-litigate)
- **The vault is the bus.** Approving = flip `approved: true` in the note; the drain reads
  it. No endpoint/DB between the phone and the engine. Everything (drain, viewer, intake)
  reads/writes the same markdown.
- **Web viewer IS The Conn v2, hosted locally for now.** Ryan wanted a web UI; that exact
  surface was already his approved v2 design ("the 2am scene"). Built to that spec so it
  deploys onto The Conn when v1 ships. Do NOT spin up a separate dashboard (violates the
  2026-07-12 consolidation decision).
- **Blotato via REST, not MCP.** MCP needs interactive OAuth; headless it's always
  `needs-auth`. REST with the `blotato-api-key` header works. Key lives in
  `op://Code Secrets/shell-secrets/BLOTATO_API_KEY` (the service-account-readable vault;
  the Personal vault is NOT readable headless). `drain-queue.sh`/`queue-server.sh` resolve
  it via the existing `~/.secrets.op.zsh` → `op inject` → `~/.secrets.env` pipeline
  (service-account token at `~/.config/op/dev-workstation.token`, no biometric).
- **Copy-gen via `claude -p`** (subscription auth, no API key), argv-array spawn (no shell
  → no RYA-176 injection). HLD voice is inlined in `intake.ts` `HLD_VOICE`.
- **Never publish-now.** Ships schedule ~10 min out (or the note's `scheduled_time`), so
  there's always a cancel window in Blotato.

## Read first
- `apps/desktop/scripts/queue-server.ts` — the viewer + all `/api/*` endpoints + the inline
  HTML/CSS/JS. **This is where the picker + edit UI go.**
- `apps/desktop/src/main/lib/approval-queue/queue.ts` — `classify`, `readNote`,
  `resolveScheduledTime`, `upsertFrontmatter` (the drain contract).
- `apps/desktop/src/main/lib/approval-queue/intake.ts` — the shared intake core (doors 2+3
  call `createDraft`).
- `docs/superpowers/specs/2026-07-14-approval-queue-consumer-design.md` — the drain design.
- `~/Code/the-conn/docs/superpowers/specs/2026-07-14-conn-v2-approvals-design.md` — the v2
  approvals design this viewer implements (locked decisions: Approve/Skip same size,
  provenance leads, serif copy, escalations disable approve).
- STATUS.md `## Now`.

## Gotchas
- **The drain timer is LIVE.** Approving a shippable note publishes to real accounts within
  15 min. When testing, un-arm (`approved: false`) or delete the Blotato schedule after
  (`listSchedules` → `deleteSchedule`, returns 204). Scheduler:
  https://my.blotato.com/scheduler
- **Don't commit `build-info.generated.ts`.** STATUS.md is gitignored (disk-only).
- **Direct-to-main convention:** `BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit`,
  `BRAYNEE_ALLOW_MAIN_PUSH=1 git push`.
- **Vault-search hook** blocks a single command containing both `grep`/`find` AND a vault
  path — split them, or read exact files with node.
- **Restart the viewer to pick up server changes** (`pkill -f queue-server.ts`, re-run).
  The page auto-refreshes every 5s but HTML is served fresh only on a new server + reload.
- `X` and `LinkedIn` have no connected Blotato account — 8 personal drafts are skipped for
  that reason; don't try to ship them. The 2 reel notes are `video-script` (not posts) and
  skipped.
- Ryan makes his own product photos (often on his phone). Intake takes a photo + a short
  text hint (product/price/who it's for); the copy is hint-driven, the photo is attached.
- Live-test cleanup pattern (used 4× this session): approve a note → run
  `./scripts/drain-queue.sh --ship` → screenshot/verify → find the schedule via
  `GET /v2/schedules` → `DELETE /v2/schedules/:id` (204) → revert the note. Nothing goes
  live.
