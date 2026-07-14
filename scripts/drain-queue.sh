#!/bin/bash
# Approval Queue consumer (RYA-166) — launchd entry point.
#
# Resolves BLOTATO_API_KEY, then runs the drain. Mirrors the-conn's run-agent.sh:
# secrets live outside git and outside the plist, and are injected at runtime.
#
# WHY NOT PLAIN `op run`: `op run` needs an interactive unlock (desktop-app
# integration / biometric). That's fine when you type it yourself, but a LaunchAgent
# firing every 15 minutes has no one to touch the sensor — it hangs and times out
# (observed). So the order below prefers whatever is already injected, falls back to
# ~/.secrets.zsh (this machine's established launchd pattern), and only then tries op
# for the interactive case.
#
#   ./scripts/drain-queue.sh            # dry run — prints what WOULD ship, mutates nothing
#   ./scripts/drain-queue.sh --ship     # actually schedule
#
# Install the timer:
#   cp scripts/com.ryan.drain-queue.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.ryan.drain-queue.plist
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="${BUN_BIN:-$HOME/.bun/bin/bun}"

# 1) already injected (e.g. you ran this under `op run`)
if [ -z "${BLOTATO_API_KEY:-}" ]; then
  # 2) ~/.secrets.zsh — the pattern every other launchd job here uses
  # shellcheck disable=SC1091
  [ -f "$HOME/.secrets.zsh" ] && source "$HOME/.secrets.zsh" 2>/dev/null
fi

# 3) interactive fallback: pull straight from 1Password. Will PROMPT, so it is last
#    and is skipped without a TTY (i.e. under launchd) rather than hanging.
if [ -z "${BLOTATO_API_KEY:-}" ] && [ -t 0 ] && command -v op >/dev/null 2>&1; then
  BLOTATO_API_KEY="$(op read "op://Personal/Blotato/credential" 2>/dev/null)"
fi
export BLOTATO_API_KEY

if [ -z "${BLOTATO_API_KEY:-}" ]; then
  echo "drain-queue: BLOTATO_API_KEY unresolved." >&2
  echo "  For the launchd timer, add it to ~/.secrets.zsh (same pattern as the-conn's agent):" >&2
  echo '    export BLOTATO_API_KEY="$(op read op://Personal/Blotato/credential)"   # or the literal value' >&2
  echo "  For a one-off by hand:" >&2
  echo '    BLOTATO_API_KEY="op://Personal/Blotato/credential" op run -- ./scripts/drain-queue.sh' >&2
  exit 1
fi

exec "$BUN" "$REPO/apps/desktop/scripts/drain-queue.ts" "$@"
