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
OP_TOKEN_FILE="$HOME/.config/op/dev-workstation.token"

if [ -z "${BLOTATO_API_KEY:-}" ]; then
  if [ -f "$TMPL" ] && [ -r "$OP_TOKEN_FILE" ] && command -v op >/dev/null 2>&1; then
    if [ ! -f "$CACHE" ] || [ "$TMPL" -nt "$CACHE" ]; then
      OP_SERVICE_ACCOUNT_TOKEN="$(<"$OP_TOKEN_FILE")" \
        op inject -i "$TMPL" -o "$CACHE" -f >/dev/null 2>&1
    fi
  fi
  # shellcheck disable=SC1090
  [ -f "$CACHE" ] && source "$CACHE" 2>/dev/null
fi
export BLOTATO_API_KEY="${BLOTATO_API_KEY:-}"

exec "$BUN" "$REPO/apps/desktop/scripts/queue-server.ts"
