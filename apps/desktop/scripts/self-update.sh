#!/usr/bin/env bash
# RyanOS git-native self-updater. Runs DETACHED after the app quits:
#   git pull --ff-only origin main -> rebuild -> install to /Applications -> relaunch.
# Refuses on a dirty tree or non-main branch. Never touches /Applications until a
# successful build. All output tee'd to ~/.ade/update.log.
set -uo pipefail

REPO="" ; APP="/Applications/RyanOS.app" ; WAIT_PID="" ; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --app) APP="$2"; shift 2;;
    --pid) WAIT_PID="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

ADE_HOME="${ADE_HOME_DIR:-$HOME/.ade}"
mkdir -p "$ADE_HOME"
LOG="$ADE_HOME/update.log"
INTENT="$ADE_HOME/update.intent"
FAILED="$ADE_HOME/update.failed"

# build-info.generated.ts is machine-generated on every build/typecheck, so its local
# churn must NOT count as "dirty" and must not block an ff-only pull.
GEN_REL="apps/desktop/src/shared/build-info.generated.ts"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; echo "$*" > "$FAILED"; exit 1; }

[ -n "$REPO" ] || { echo "--repo required" >&2; exit 2; }
DESKTOP="$REPO/apps/desktop"

log "=== self-update start (dry_run=$DRY_RUN, repo=$REPO) ==="

# Basic preconditions (checked in both real and dry-run mode).
command -v git >/dev/null 2>&1 || fail "git not found on PATH"
[ -d "$REPO/.git" ] || fail "not a git repo: $REPO"

# Dry-run: print the plan and exit BEFORE any mutation or strict guard, so it always
# succeeds regardless of working-tree state.
if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN plan:"
  log "  guard: on branch main, working tree clean (excluding $GEN_REL)"
  log "  git -C $REPO checkout -- $GEN_REL   (discard generated churn)"
  log "  git -C $REPO pull --ff-only origin main"
  log "  (bun install if lockfile changed)"
  log "  cd $DESKTOP && bun run clean:dev && bun run compile:app && CSC_IDENTITY_AUTO_DISCOVERY=false bun run package"
  log "  rm -rf $APP && cp -R $DESKTOP/release/mac-arm64/RyanOS.app $APP"
  log "  open -a $APP"
  log "=== dry run complete (no changes made) ==="
  exit 0
fi

command -v bun >/dev/null 2>&1 || fail "bun not found on PATH"

# 1. Wait for the app to exit so we can replace its bundle.
if [ -n "$WAIT_PID" ]; then
  log "waiting for app pid $WAIT_PID to exit…"
  for _ in $(seq 1 60); do kill -0 "$WAIT_PID" 2>/dev/null || break; sleep 0.5; done
fi

# 2. Guards — branch + clean tree (ignoring the generated build-info file).
BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || fail "refusing to update: on branch '$BRANCH', not main"
DIRTY="$(git -C "$REPO" status --porcelain -- . ":!$GEN_REL")"
if [ -n "$DIRTY" ]; then
  fail "refusing to update: working tree is dirty (commit/stash first)"
fi

# 3. Discard generated-file churn, then pull.
git -C "$REPO" checkout -- "$GEN_REL" 2>/dev/null || true
LOCK_BEFORE="$(md5 -q "$REPO/bun.lock" 2>/dev/null || echo none)"
log "pulling origin/main…"
git -C "$REPO" pull --ff-only origin main >>"$LOG" 2>&1 || fail "git pull --ff-only failed"
LOCK_AFTER="$(md5 -q "$REPO/bun.lock" 2>/dev/null || echo none)"

# 4. Install deps only if the lockfile changed.
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  log "lockfile changed → bun install…"
  ( cd "$REPO" && bun install ) >>"$LOG" 2>&1 || fail "bun install failed"
fi

# 5. Build (into release/; /Applications untouched until success).
# gen:build-info MUST run first so the freshly pulled commit is baked into the app
# (the explicit compile:app/package chain does not trigger the pre* hooks).
log "building…"
( cd "$DESKTOP" && bun run gen:build-info && bun run clean:dev && bun run compile:app && CSC_IDENTITY_AUTO_DISCOVERY=false bun run package ) >>"$LOG" 2>&1 \
  || fail "build failed"

BUILT="$DESKTOP/release/mac-arm64/RyanOS.app"
[ -d "$BUILT" ] || fail "built app not found at $BUILT"

# 6. Swap into /Applications.
log "installing to $APP…"
rm -rf "$APP" || fail "could not remove old app at $APP"
cp -R "$BUILT" "$APP" || fail "could not copy new app to $APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# 7. Relaunch + clear markers.
rm -f "$INTENT" "$FAILED"
log "relaunching…"
open -a "$APP" || fail "relaunch failed"
log "=== self-update complete ==="
