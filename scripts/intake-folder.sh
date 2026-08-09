#!/bin/bash
# Intake DOOR 2 (drop folder) — launchd entry point.
#
# Resolves BLOTATO_API_KEY via the same 1Password service-account pipeline the drain
# uses (refs in ~/.secrets.op.zsh -> op inject -> ~/.secrets.env, unlocked by the
# token at ~/.config/op/dev-workstation.token, so it works headless), then processes
# any photos or video waiting in either drop root (the vault Intake dir and Google
# Drive's "My Drive/Social Media/_Drop/"). Override with SOCIAL_INTAKE_DIRS.
#
#   ./scripts/intake-folder.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="${BUN_BIN:-$HOME/.bun/bin/bun}"
TMPL="$HOME/.secrets.op.zsh"
CACHE="$HOME/.secrets.env"
# 2026-07-30: `op inject` -> oprun, so this resolves via the self-hosted Connect
# server (handlane-core) instead of the metered cloud API, which was hitting its
# 1,000 req/24h cap daily. oprun handles token selection and cloud fallback itself.
# --template is required: it substitutes refs in place and preserves the `export `
# prefixes this cache is sourced for.
OPRUN="$HOME/Code/.codehq/1password/oprun"

if [ -z "${BLOTATO_API_KEY:-}" ]; then
  if [ -f "$TMPL" ] && [ -x "$OPRUN" ]; then
    if [ ! -f "$CACHE" ] || [ "$TMPL" -nt "$CACHE" ]; then
      "$OPRUN" inject --template -i "$TMPL" -o "$CACHE" >/dev/null 2>&1
    fi
  fi
  # shellcheck disable=SC1090
  [ -f "$CACHE" ] && source "$CACHE" 2>/dev/null
fi
export BLOTATO_API_KEY="${BLOTATO_API_KEY:-}"

if [ -z "$BLOTATO_API_KEY" ] || [ "${BLOTATO_API_KEY#op://}" != "$BLOTATO_API_KEY" ]; then
  echo "intake-folder: BLOTATO_API_KEY unresolved (needs op://Code Secrets/shell-secrets/BLOTATO_API_KEY)." >&2
  exit 1
fi

exec "$BUN" "$REPO/apps/desktop/scripts/intake-folder.ts" "$@"
