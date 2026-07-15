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

# Telegram bot — a DEDICATED intake bot, NOT the Hermes/Roux2 bot. Roux2 is Hermes's
# inbound channel (ai.hermes.gateway long-polls getUpdates on it); Telegram allows
# exactly ONE getUpdates consumer per bot, so a second listener on Roux2 fights Hermes
# for every message. This door therefore uses its own bot, whose token lives beside
# BLOTATO_API_KEY: op://Code Secrets/shell-secrets/INTAKE_BOT_TOKEN (already resolved
# into ~/.secrets.env by the op inject above). The chat id is still Ryan's user id
# (same value for any bot), sourced from ~/.config/hld/foreman-worker.env CHAT_ID.
export TELEGRAM_BOT_TOKEN="${INTAKE_BOT_TOKEN:-}"
if [ -z "${TELEGRAM_CHAT_ID:-}" ] && [ -f "$HOME/.config/hld/foreman-worker.env" ]; then
  # shellcheck disable=SC1091
  TELEGRAM_CHAT_ID="$(set -a; source "$HOME/.config/hld/foreman-worker.env" 2>/dev/null; printf '%s' "${CHAT_ID:-${TELEGRAM_CHAT_ID:-}}")"
fi
export TELEGRAM_CHAT_ID

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ "${TELEGRAM_BOT_TOKEN#op://}" != "$TELEGRAM_BOT_TOKEN" ]; then
  echo "intake-telegram: INTAKE_BOT_TOKEN unresolved. Add a DEDICATED bot token:" >&2
  echo "  1. Telegram @BotFather -> /newbot -> copy the token" >&2
  echo "  2. 1Password -> 'Code Secrets' -> shell-secrets -> add field INTAKE_BOT_TOKEN" >&2
  echo "  3. echo 'export INTAKE_BOT_TOKEN=\"op://Code Secrets/shell-secrets/INTAKE_BOT_TOKEN\"' >> ~/.secrets.op.zsh" >&2
  echo "  4. refresh-secrets" >&2
  exit 1
fi
if [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "intake-telegram: TELEGRAM_CHAT_ID unresolved (CHAT_ID in ~/.config/hld/foreman-worker.env)." >&2
  exit 1
fi

exec "$BUN" "$REPO/apps/desktop/scripts/intake-telegram.ts" "$@"
