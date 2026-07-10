#!/usr/bin/env bash
# Local semver release: bump apps/desktop/package.json, commit, annotated tag, push tag.
# No GitHub Actions / Release object — tags only. Usage:
#   tag-release.sh patch|minor|major|<x.y.z> [--dry-run]
set -euo pipefail

BUMP="${1:-}"; DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1
[ -n "$BUMP" ] || { echo "usage: tag-release.sh patch|minor|major|<x.y.z> [--dry-run]"; exit 2; }

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="$ROOT/apps/desktop/package.json"
CUR="$(node -p "require('$PKG').version")"
IFS='.' read -r MA MI PA <<< "$CUR"
case "$BUMP" in
  patch) NEW="$MA.$MI.$((PA+1))";;
  minor) NEW="$MA.$((MI+1)).0";;
  major) NEW="$((MA+1)).0.0";;
  *) [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "bad version: $BUMP"; exit 2; }; NEW="$BUMP";;
esac
TAG="v$NEW"
echo "current: $CUR  →  new: $NEW  (tag $TAG)"

if [ "$DRY" -eq 1 ]; then echo "(dry run — no changes)"; exit 0; fi
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo "working tree dirty — commit first"; exit 1; }

node -e "const f='$PKG';const p=require(f);p.version='$NEW';require('fs').writeFileSync(f, JSON.stringify(p,null,'\t')+'\n')"
git -C "$ROOT" add "$PKG"
git -C "$ROOT" commit -m "chore(desktop): release $TAG"
git -C "$ROOT" tag -a "$TAG" -m "RyanOS $TAG"
git -C "$ROOT" push origin HEAD "$TAG"
echo "pushed $TAG"
