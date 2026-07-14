# Handoff — damon-ade (RyanOS) (2026-07-14 07:05)

## Goal
The orchestrator is built and live-proven. What's left is **closing the loop**: finished
agent work has no path out. Next session starts with RYA-166 (the Approval Queue
consumer) — the single change that turns a proven engine into a system Ryan uses daily.

## State
- Branch/commit: `main` @ `6759e77` — pushed to `origin`, **0 unpushed**. Dirty: only
  `apps/desktop/src/shared/build-info.generated.ts` (generated build stamp — rewritten by
  every dev/build/typecheck run; **do not commit it**, HEAD intentionally holds dev defaults).
- Tests: **40 pass / 2 fail** in the orchestrator suite. The 2 are PRE-EXISTING
  (Electron-import-under-`bun test`, part of ~49 repo-wide) — verified against a clean
  tree, NOT caused by this session. Typecheck 14/14 clean. (STATUS.md's old "34/34" claim
  was stale and has been corrected.)
- Deployed: `/Applications/RyanOS.app` is the OLD packaged v0.2.0 (`2acc0eb`) and is QUIT.
  This session ran `bun run dev` off `main`; that dev instance is also stopped.
  **The installed app does NOT contain this session's work** — run dev or rebuild.

## Done this session
- **Result-passing shipped and PROVEN LIVE on real work** (`1a61abd`). `EngineDeps.dispatch`
  now takes `(node, upstream)`; upstream `result`s render into the dispatch note's
  `## Facts`. Proof: the strategist raised a blocker ("Father's Day 2026 was 23 days ago"),
  it travelled the pipe, and the repurposer **changed what it produced because of it** —
  wrote all 3 posts evergreen-safe, self-graded 8.6–9.0, published nothing, escalated the
  timing call. Both agents also *corrected their upstream*. This closes the spec's
  "a done note's output becomes the next step's input" — the system's biggest hole.
- **Crash resume shipped** (`1a61abd`) — `recoverInFlightRuns()` at boot; proved itself on
  its very first boot by recovering a run (and immediately exposing its own bug, below).
- **Three bugs found by the live run**, none findable by unit test: `5c01448` resurrection
  of ABANDONED runs (only failed to spawn agents by luck — the wave cap was saturated);
  `4f17f3f` a finished node silently DESTROYED by a YAML quoting slip; `25c9c13` paste
  dead app-wide (`user-select:none` inherits into inputs).
- **Plan-approval gate rebuilt** (`6759e77`) — 300-char tasks were rendered in a
  single-line `<Input>`; you were authorising text you couldn't read. Also fixed a latent
  flexbox bug that made the graph preview invisible on any plan >~4 nodes.
- **Framework bake-off answered: KEEP the custom orchestrator** (not pydantic-ai/CrewAI).
- STATUS.md `## Roadmap` rewritten (Phases 4–7 + The Conn boundary). The Conn v2 designed
  + mockup published.

## In flight
Nothing half-finished in this repo — all committed, merged to `main`, pushed.

**Elsewhere:** `~/Code/the-conn` has **5 uncommitted modified files** (`agent/src/builders/
brief-gen.mjs`, `system.mjs`, `run-agent.sh`, the plist, a test) from an EARLIER session —
**not mine. Do not blow them away; ask Ryan before touching that tree.**

## Decisions
- **Keep the custom orchestrator; don't adopt pydantic-ai or CrewAI.** They're in-process
  API-loop agent libraries; this orchestrates *full Claude Code brains* (personas, skills,
  per-agent MCP, vault access). Adopting CrewAI means rewriting every seed-brain as a
  role/goal/backstory string and losing the whole tool surface. Steal the ideas instead:
  CrewAI's `Task.context` → result-passing; pydantic-ai's `ModelRetry`/durable-exec →
  validation + resume.
- **The dispatch instruction stays TASK-NEUTRAL.** It used to hardcode "it is a read-only
  check, so take no real action" into EVERY dispatch — that would cap every future run at
  read-only forever. How much action a node may take belongs in its `## Task` text, where
  the smoke plan already states it per-agent.
- **Handoff notes get TOLERANT parsing; the manifest stays strict.** The manifest is
  machine-written (always valid YAML); notes are AGENT-written, so strict YAML silently
  destroyed completed work. Strictness bought nothing (no second reader) and cost real work.
- **Recovery is bounded by manifest mtime.** The loop rewrites the manifest every tick, so
  mtime is an exact liveness signal: untouched longer than a node timeout ⇒ abandoned, not
  resumable. "Resume anything marked running" resurrects work Ryan walked away from.
- **RYA-166 before triggers; cost before triggers.** Triggers while output is trapped just
  manufacture backlog; an unmetered 12×Opus-1M fan-out on a cron is how you find out the
  expensive way.
- **No second dashboard.** The phone surface is The Conn v2 (already on its roadmap, and a
  new one would violate the 2026-07-12 LifeOS consolidation decision). damon-ade owns the
  engine, The Conn owns the surface, **the vault is the bus**.

## Next steps (in order)
1. **RYA-166 — build the Approval Queue consumer.** Nothing reads `status: approved`, so
   approving is meaningless and 16 posts sit stale (some 6 days old). **This is THE unlock:
   the vault lives in iCloud and already syncs to Obsidian on Ryan's phone, so the watcher
   ALONE delivers phone approval — he edits one word in Obsidian mobile and it ships.**
   Decide the trigger (Hermes cron sweep vs. an on-demand `/drain-queue` skill vs. a
   file-watcher). Hard constraints: it must NEVER approve anything itself (only ship what
   is already explicitly marked approved), and it should surface "approved but no media"
   rather than fail (IG needs a media URL at approval time).
2. **RYA-167** — the orphaned "reply: approved / edit / skip" prompt on headless-written
   notes. Only becomes true once RYA-166 lands; do 166 first or both together.
3. **The Conn v1 deploy** (`~/Code/the-conn`, Task 13, human-gated,
   `docs/superpowers/plans/v1-deploy-runbook.md`) — needs Ryan: 5 secrets in
   `~/.secrets.zsh`, `wrangler d1 create`, deploy, domain swap off the v0 tunnel, launchd,
   retire v0. Gates RYA-168.
4. **RYA-168 — The Conn v2 approvals surface.** Design approved + mockup done; see its spec.
5. **RYA-158 — Agent SDK transport spike** behind `ORCH_TRANSPORT=sdk`. Highest upside: the
   YAML failure fixed in `4f17f3f` is exactly what `outputFormat: json_schema` makes
   structurally impossible, and it's the only path to per-node cost (needed before triggers).

## Read first
- `STATUS.md` — the rewritten `## Roadmap` (Phases 4–7, the dependency order, The Conn boundary)
- `docs/superpowers/specs/2026-07-14-orchestrator-durability-upgrades-design.md` — framework analysis + Features 1/2/3 + the SDK migration path
- `~/Code/the-conn/docs/superpowers/specs/2026-07-14-conn-v2-approvals-design.md` — v2 design; mockup: https://claude.ai/code/artifact/0c36a1ac-7e6e-4a8c-9f4b-a63d884effa1
- `apps/desktop/src/main/lib/orchestrator/engine.ts` + `handoff.ts` — the DI seam and the tolerant parser
- Linear (Claude Code project): RYA-158, RYA-166, RYA-167, RYA-168

## Gotchas
- **Don't commit `build-info.generated.ts`** — HEAD holds dev defaults on purpose; every
  typecheck/dev run rewrites it with a hash that's stale seconds later.
- **`STATUS.md` is gitignored** (`~/.config/git/ignore:2`) — disk-only, never commit it.
- **Convention is direct-to-main**: `BRAYNEE_ALLOW_MAIN_COMMITS=1 git commit …` (a hook
  blocks bare main commits). This session used a feature branch + fast-forward instead;
  same end state, but main is the norm here.
- **Main-process changes need a full restart** — no hot reload. And the packaged
  `/Applications/RyanOS.app` shares `~/.ade` + the single-instance lock with `bun run dev`,
  so **quit the packaged app before running dev** or the dev instance exits immediately.
- **`terminal-host.js` / `pty-subprocess.js` survive an app quit BY DESIGN** (boot calls
  `reconcileDaemonSessions()` to re-adopt them). Don't kill them — they host live agent terminals.
- **A real (non-smoke) goal makes agents do REAL work** — drafts land in the Approval Queue.
  Read-only-ness lives in the node's `## Task` text, NOT in the dispatch instruction.
- **The vault-search hook blocks grep/find on vault paths** — use QMD, or read exact files
  with node/Read. A single command containing both `grep` and a vault path is rejected.
- Approval Queue truth right now: **16 pending** (Ryan's 2026-07-08 personal drafts),
  1 scheduled, 4 skipped (tonight's 3 test drafts + 1 prior). **Nothing was ever published.**
- A dead Father's Day plan artifact remains at
  `2. Areas/Social Media/Content Calendar/2026-07-14-week.md` — Ryan hasn't decided its fate.
