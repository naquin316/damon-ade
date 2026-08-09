#!/bin/bash
# Weekly producer — launchd entry point.
#
# Resolves BLOTATO_API_KEY via the same 1Password service-account pipeline the drain
# uses (refs in ~/.secrets.op.zsh -> op inject -> ~/.secrets.env, unlocked by the
# token at ~/.config/op/dev-workstation.token, so it works headless), then tops the
# approval-queue shelf back up to target from the Google Drive product-photo library.
#
# Pass --dry-run to see which photos it would pick without spending a single call.
#
#   ./scripts/stock-queue.sh [--dry-run] [--count N]
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
  echo "stock-queue: BLOTATO_API_KEY unresolved (needs op://Code Secrets/shell-secrets/BLOTATO_API_KEY)." >&2
  exit 1
fi

# Telegram is how Ryan learns the shelf was restocked. Best-effort, exactly as in
# drain-queue.sh: the bot token lives in ~/.hermes/.env and the personal chat id in
# ~/.config/hld/foreman-worker.env as CHAT_ID. Missing creds silence the ping; they
# never stop the drafts being written.
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -f "$HOME/.hermes/.env" ]; then
  # shellcheck disable=SC1091
  TELEGRAM_BOT_TOKEN="$(set -a; source "$HOME/.hermes/.env" 2>/dev/null; printf '%s' "${TELEGRAM_BOT_TOKEN:-}")"
fi
if [ -z "${TELEGRAM_CHAT_ID:-}" ] && [ -f "$HOME/.config/hld/foreman-worker.env" ]; then
  # shellcheck disable=SC1091
  TELEGRAM_CHAT_ID="$(set -a; source "$HOME/.config/hld/foreman-worker.env" 2>/dev/null; printf '%s' "${CHAT_ID:-${TELEGRAM_CHAT_ID:-}}")"
fi
export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID

exec "$BUN" "$REPO/apps/desktop/scripts/stock-queue.ts" "$@"
