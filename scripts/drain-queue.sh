#!/bin/bash
# Approval Queue consumer (RYA-166) — launchd entry point.
#
# Resolves BLOTATO_API_KEY, then runs the drain.
#
# SECRETS: reuses the existing 1Password pipeline (RYA-156), rather than inventing
# anything. Refs live in ~/.secrets.op.zsh; `op inject` resolves them into the 0600
# cache ~/.secrets.env using the SERVICE ACCOUNT token at
# ~/.config/op/dev-workstation.token. That token is why this works under launchd at
# all: plain `op run`/`op signin` need an interactive unlock, and a timer firing every
# 15 minutes has no one to touch the sensor (observed: authorization timeout).
# This mirrors the auto-refresh block in ~/.zshrc so both paths stay identical.
#
# To add the key (once):
#   1Password -> "Code Secrets" -> shell-secrets -> add field BLOTATO_API_KEY
#   echo 'export BLOTATO_API_KEY="op://Code Secrets/shell-secrets/BLOTATO_API_KEY"' >> ~/.secrets.op.zsh
#   refresh-secrets
#
#   ./scripts/drain-queue.sh            # dry run — prints what WOULD ship, mutates nothing
#   ./scripts/drain-queue.sh --ship     # actually schedule
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="${BUN_BIN:-$HOME/.bun/bin/bun}"
TMPL="$HOME/.secrets.op.zsh"
CACHE="$HOME/.secrets.env"
OP_TOKEN_FILE="$HOME/.config/op/dev-workstation.token"

# 1) already injected (e.g. you exported it yourself)
if [ -z "${BLOTATO_API_KEY:-}" ]; then
  # 2) refresh the 0600 cache if it's missing or older than the template, exactly as
  #    ~/.zshrc does. Service-account auth => no prompt, works headless.
  if [ -f "$TMPL" ] && [ -r "$OP_TOKEN_FILE" ] && command -v op >/dev/null 2>&1; then
    if [ ! -f "$CACHE" ] || [ "$TMPL" -nt "$CACHE" ]; then
      OP_SERVICE_ACCOUNT_TOKEN="$(<"$OP_TOKEN_FILE")" \
        op inject -i "$TMPL" -o "$CACHE" -f >/dev/null 2>&1
    fi
  fi
  # 3) source the resolved cache
  # shellcheck disable=SC1090
  [ -f "$CACHE" ] && source "$CACHE" 2>/dev/null
fi
export BLOTATO_API_KEY="${BLOTATO_API_KEY:-}"

if [ -z "$BLOTATO_API_KEY" ] || [ "${BLOTATO_API_KEY#op://}" != "$BLOTATO_API_KEY" ]; then
  echo "drain-queue: BLOTATO_API_KEY unresolved." >&2
  echo "  The key must live in the vault the service account can actually read." >&2
  echo "  It is scoped to 'Code Secrets' only — a ref to op://Personal/... will NOT resolve." >&2
  echo "" >&2
  echo "  1. 1Password -> 'Code Secrets' -> shell-secrets -> add field BLOTATO_API_KEY" >&2
  echo "  2. echo 'export BLOTATO_API_KEY=\"op://Code Secrets/shell-secrets/BLOTATO_API_KEY\"' >> ~/.secrets.op.zsh" >&2
  echo "  3. refresh-secrets" >&2
  exit 1
fi

# Telegram notifications (RYA-166 feedback edge). OPTIONAL: if these don't resolve,
# the drain still ships — it just sends no pings (the notifier no-ops on absent
# creds). The bot token lives in ~/.hermes/.env (the same bot that sends Ryan's
# cloud routines); the personal chat id is in ~/.config/hld/foreman-worker.env as
# CHAT_ID. We source those only for these two vars and don't let a missing file
# break the run.
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -f "$HOME/.hermes/.env" ]; then
  # shellcheck disable=SC1091
  TELEGRAM_BOT_TOKEN="$(set -a; source "$HOME/.hermes/.env" 2>/dev/null; printf '%s' "${TELEGRAM_BOT_TOKEN:-}")"
fi
if [ -z "${TELEGRAM_CHAT_ID:-}" ] && [ -f "$HOME/.config/hld/foreman-worker.env" ]; then
  # shellcheck disable=SC1091
  TELEGRAM_CHAT_ID="$(set -a; source "$HOME/.config/hld/foreman-worker.env" 2>/dev/null; printf '%s' "${CHAT_ID:-${TELEGRAM_CHAT_ID:-}}")"
fi
export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID

exec "$BUN" "$REPO/apps/desktop/scripts/drain-queue.ts" "$@"
