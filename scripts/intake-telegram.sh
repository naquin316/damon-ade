#!/bin/bash
# Intake DOOR 3 (Telegram photo intake) — launchd entry point.
#
# Resolves BLOTATO_API_KEY (1Password service-account pipeline, headless) plus the
# Telegram bot token + chat id (the same sources the drain's notifier uses), then
# runs the long-poll listener. A persistent process — launchd keeps it alive.
#
#   ./scripts/intake-telegram.sh
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
  echo "intake-telegram: BLOTATO_API_KEY unresolved (needs op://Code Secrets/shell-secrets/BLOTATO_API_KEY)." >&2
  exit 1
fi

# Telegram creds — same sources as drain-queue.sh: bot token in ~/.hermes/.env, the
# personal chat id in ~/.config/hld/foreman-worker.env as CHAT_ID.
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -f "$HOME/.hermes/.env" ]; then
  # shellcheck disable=SC1091
  TELEGRAM_BOT_TOKEN="$(set -a; source "$HOME/.hermes/.env" 2>/dev/null; printf '%s' "${TELEGRAM_BOT_TOKEN:-}")"
fi
if [ -z "${TELEGRAM_CHAT_ID:-}" ] && [ -f "$HOME/.config/hld/foreman-worker.env" ]; then
  # shellcheck disable=SC1091
  TELEGRAM_CHAT_ID="$(set -a; source "$HOME/.config/hld/foreman-worker.env" 2>/dev/null; printf '%s' "${CHAT_ID:-${TELEGRAM_CHAT_ID:-}}")"
fi
export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "intake-telegram: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unresolved." >&2
  exit 1
fi

exec "$BUN" "$REPO/apps/desktop/scripts/intake-telegram.ts" "$@"
