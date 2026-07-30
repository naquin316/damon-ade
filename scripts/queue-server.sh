#!/bin/bash
# Approval Queue web viewer (The Conn v2, local-first) — launcher.
#
# Resolves BLOTATO_API_KEY (optional — only used to show ready/blocked; the page
# renders without it) via the same 1Password pipeline the drain uses, then serves
# the viewer on http://localhost:4319.
#
#   ./scripts/queue-server.sh
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

exec "$BUN" "$REPO/apps/desktop/scripts/queue-server.ts"
