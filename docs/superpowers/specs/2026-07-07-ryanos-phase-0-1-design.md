# RyanOS — Phase 0 + 1 Design

**Date:** 2026-07-07
**Repo:** `~/Code/damon-ade` (fork of `per-simmons/damon-ade`; `origin` = `naquin316/damon-ade`, `upstream` = original)
**Scope:** First buildable milestone — a de-bloated, personalized, locally-running "RyanOS" cockpit.
**North star (not this doc):** Full RyanOS cockpit fusion (vault-backed memory, Hermes structure, dashboards-as-panels). Phases 2–3.

---

## 1. What this is

ADE/"Damon" is an Electron desktop app (Superset rebrand under the hood) for running persistent coding agents: **Teams** (categories) → **Agents** → tabbed terminal sessions, each agent with its own repo + memory files and a model/runtime picker (Claude, Codex, OpenCode, plus Kimi/MiniMax/GLM via OpenRouter).

This is an unusually strong match for Ryan's stated Vision (a multi-agent "RyanOS/RLOS" where AI does grunt work, organized around one cockpit). Phases 0+1 turn the generic app into *Ryan's* cockpit: stripped of SaaS bloat, renamed, opening straight into his real teams and agents.

## 2. Goals (Phase 0 + 1)

1. Repo de-bloated to just the desktop app + its packages; builds clean and fast.
2. App opens directly to the cockpit for **local-only personal use** (no cloud sign-in).
3. Surface-renamed to **RyanOS**.
4. Quality-of-life fixes: dark mode locked, default emoji noise removed, Claude runtime defaults to Opus 4.8 (1M context).
5. On first run, **auto-seeds Ryan's five teams and their agents** so the cockpit is populated, not blank.
6. Runs via `bun run dev` and produces an installable unsigned local DMG.

## 3. Non-goals (deferred to Phase 2/3)

- Vault-backed agent memory (`RLOS_2026` as source of truth) and session→vault export.
- Attaching agents **in-place** to real `~/Code` repos / the vault, and resolving the `CLAUDE.md`/`.claude` collision that requires. **Phase 1 seeds fresh empty repos.**
- Replacing generic Hermes memory templates with Ryan's Profile/Contract/Skill/Workspace structure.
- Embedding existing dashboards (Ops Deck, RubyPulse, myPKA, CatchPad) or Code HQ `STATUS.md` awareness as panels.
- Deep rename (data dir, `superset-icon://` protocol, `@superset/*` package names). **Surface rename only.**
- Pruning shared `packages/*` (load-bearing for desktop; risk without payoff now).

## 4. Phase 0 — Foundation

### 4.1 De-bloat
Delete the six unused Superset SaaS apps and their wiring:
- `apps/admin`, `apps/api`, `apps/web`, `apps/mobile`, `apps/marketing`, `apps/streams`
- Remove their entries from root workspace globs (`package.json`), `turbo.json` pipeline, and any root `dev`/`build` turbo filters that name them.
- Keep `apps/desktop`, `apps/docs`, and all `packages/*` (some shared packages are load-bearing for desktop; prune later only if proven unused).
- **Verification:** `bun install` resolves; `cd apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev` still launches.

### 4.2 Bypass the cloud auth gate
The renderer's app routes live under `_authenticated`; without `SKIP_ENV_VALIDATION=1` the app hits a Superset sign-in screen. For local-only use, open straight to the cockpit:
- Simplest path: bake the env-skip into dev and packaged builds so the auth loader is short-circuited; or short-circuit the `_authenticated` loader guard directly.
- Cloud-sync mirror tables (Electric SQL) become inert without auth — acceptable for local-first personal use.
- **Verification:** launching the app (dev and packaged) lands on the cockpit/welcome, never a sign-in form.

### 4.3 Surface rename → "RyanOS"
Rename only user-visible surfaces:
- Window title, app menu, About panel, tray/dock name.
- `productName`/artifact name in `apps/desktop/electron-builder.ts` (DMG shows "RyanOS").
- **Leave untouched:** `~/.ade/` data dir, `superset-icon://` protocol, `@superset/*` / `@ade/*` package names.
- **Verification:** built DMG and running window read "RyanOS"; app still boots (internals unchanged).

### 4.4 Quality-of-life fixes
- **Dark mode locked** (no light mode; night-shift friendly).
- **Default emoji icons removed/softened** — seeded agents ship real/neutral icons instead.
- **Claude runtime default → Opus 4.8, 1M context.** Edit the `claude` preset in `packages/shared/src/agent-command.ts` (`AGENT_PRESET_COMMANDS.claude`). Target: default model to Opus with 1M context. *Exact flag verified during implementation* (likely `claude --model claude-opus-4-8[1m] --dangerously-skip-permissions`, or via a `.claude` setting if the CLI rejects the bracketed id).
- **Verification:** new Claude session launches on Opus 1M; UI stays dark; no stray emoji.

### 4.5 Build / run
- Dev loop: `cd apps/desktop && SKIP_ENV_VALIDATION=1 bun run dev`.
- If `better-sqlite3`/`node-pty` fail to load: `bun run install:deps` (rebuilds native modules for arch).
- Local unsigned DMG: `bun run build` (signing auto-discovery already disabled via `CSC_IDENTITY_AUTO_DISCOVERY=false`).
- Git must be present (`xcode-select --install`) or agent creation preflight fails.

## 5. Phase 1 — Seed your world

### 5.1 Seed roster
On first run, seed five Teams (a `projects` row with `mainRepoPath=""`) and their Agents (a `workspaces` + `worktrees` row each). All agents: `runtime = "claude"`, repo `source.type = "init"` (fresh empty repo under `~/.ade/agents/<id>/worktree`).

| Team | Agents |
|------|--------|
| **HLD Ops** | Shopify / Store Cockpit · RubyPulse / Laser · Storefront Support |
| **Hand Lane AI** | Consulting · SaaS Build |
| **Content / YouTube** | Script Writer · Clip Scout |
| **Trading** | Kalshi BTC / Tessa |
| **Personal / RLOS** | Daily Planner (braynee) · Code HQ / Portfolio |

(Roster is editable in-app after seeding; this is the starting layout, not a cage.)

### 5.2 Seeding mechanism
- **Where:** main-process boot, in `apps/desktop/src/main/index.ts`, immediately after `localDb` init and alongside the existing `backfillAgentMemory()` call. Running in the main process avoids racing the renderer's onboarding redirect gate (`.../workspace/page.tsx`).
- **Guard:** seed only if the `projects` table is empty (idempotent; never re-seeds or duplicates).
- **Inserts:** reuse the exact row shapes from `projects.ts` (category create, `mainRepoPath: ""`) and `create-agent.ts` (agent + worktree rows), then call `beginAgentInit(...)` per agent so each gets its repo built and memory scaffolded by the existing pipeline.
- **Icons:** ship a small set of default team/agent images in the repo (`assets/seed-icons/`), copied into `~/.ade/project-icons/` and `~/.ade/workspace-icons/` at seed time; or leave iconless and add photos in-app. (Decide during implementation — cosmetic.)
- **Verification:** delete `~/.ade/local.db` (or use a named dev workspace → `~/.ade-<name>`), launch, confirm the five teams and all agents appear, each agent initializes to "ready," and a terminal session opens on Claude.

### 5.3 Repo strategy (Phase 1)
- Every seeded agent gets a **fresh `git init` repo** — safe, no collisions, cockpit structure is real.
- Attaching agents to real `~/Code` repos and the vault (in-place) is **Phase 2**, because it requires an in-place local-path repo variant *and* a fix so ADE's scaffolded `CLAUDE.md` + `.claude/settings.json` don't clobber the config already in those repos.

## 6. Architecture — insertion points (from code map)

| Change | File(s) |
|--------|---------|
| Delete SaaS apps | `apps/{admin,api,web,mobile,marketing,streams}`, root `package.json` workspaces, `turbo.json` |
| Auth bypass | `_authenticated` route loader; dev/build env wiring |
| Surface rename | window/menu/About strings; `apps/desktop/electron-builder.ts` (`productName`) |
| Dark-mode lock / emoji | theme setting; default-icon source |
| Claude model default | `packages/shared/src/agent-command.ts` (`AGENT_PRESET_COMMANDS.claude`) |
| Seed teams/agents | `apps/desktop/src/main/index.ts` (boot, near `backfillAgentMemory`); shapes from `projects.ts` + `create-agent.ts`; `beginAgentInit` in `agent-init.ts` |
| Data model reference | `packages/local-db/src/schema/schema.ts` (`projects`/`worktrees`/`workspaces`) |
| Build/run | root `package.json`, `apps/desktop/package.json`, `apps/desktop/BUILDING.md`, `electron-builder.ts` |

**Domain glossary:** `projects` table = Team/Category (repo-less when `mainRepoPath=""`); `workspaces` table = Agent; terminal tabs = renderer state + `settings.terminalPresets` (not a table). Runtime data dir = `~/.ade/`.

## 7. Testing & verification

1. **Build clean:** `bun install` + dev launch succeed after de-bloat.
2. **No sign-in:** app opens to cockpit/welcome, dev and packaged.
3. **Branding:** window + DMG read "RyanOS."
4. **Seed:** fresh DB → five teams + full agent roster appear and initialize to ready.
5. **Session:** opening an agent launches a Claude (Opus 1M) terminal session.
6. **Idempotent:** relaunch does not duplicate seeded rows.
7. **Packaged smoke test:** unsigned DMG installs to /Applications and launches.

## 8. Risks & mitigations

- **Deleting an app breaks a hidden import** → after each deletion, re-run dev; if a `packages/*` re-exports a deleted app, stop and prune the reference instead of the package.
- **Opus `[1m]` flag rejected by Claude Code CLI** → fall back to `--model opus` + a `.claude` 1M-context setting; verify a real session reports the right model.
- **Auth bypass leaves a dead cloud dependency on a hot path** → if a loader hard-requires a session object, stub a local/offline session rather than ripping out auth wholesale.
- **Seeding races renderer redirect** → mitigated by seeding in the main process before the window's onboarding gate evaluates.

## 9. Phase 2 preview (context only)

Vault-backed memory (`RLOS_2026` as source of truth), in-place attach of agents to real `~/Code` repos + vault with `CLAUDE.md`/`.claude` collision handling, and Ryan's Hermes memory structure replacing the generic templates. Designed separately after Phase 0+1 ships and gets real use.
