#!/bin/bash
# Intake DOOR 2 (drop folder) — launchd entry point.
#
# Resolves BLOTATO_API_KEY via the same 1Password service-account pipeline the drain
# uses (refs in ~/.secrets.op.zsh -> op inject -> ~/.secrets.env, unlocked by the
# token at ~/.config/op/dev-workstation.token, so it works headless), then processes
# any photos waiting in "2. Areas/Social Media/Intake/".
#
#   ./scripts/intake-folder.sh
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

if [ -z "$BLOTATO_API_KEY" ] || [ "${BLOTATO_API_KEY#op://}" != "$BLOTATO_API_KEY" ]; then
  echo "intake-folder: BLOTATO_API_KEY unresolved (needs op://Code Secrets/shell-secrets/BLOTATO_API_KEY)." >&2
  exit 1
fi

exec "$BUN" "$REPO/apps/desktop/scripts/intake-folder.ts" "$@"
