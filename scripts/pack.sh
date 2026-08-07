#!/usr/bin/env bash
# Build a clean zip for Load unpacked / local sharing (no docs, git, screenshots, etc.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f manifest.json ]]; then
  echo "error: manifest.json not found in $ROOT" >&2
  exit 1
fi

VERSION="$(node -e "console.log(require('./manifest.json').version)")"
OUT_DIR="$ROOT/dist"
OUT_ZIP="$OUT_DIR/TabWall-${VERSION}.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_ZIP"

# Whitelist only — extension runtime files
zip -r "$OUT_ZIP" \
  manifest.json \
  background.js \
  content.js \
  mediaDb.js \
  backupBuild.js \
  canvasStore.js \
  park.html \
  park.js \
  icons/icon16.png \
  icons/icon48.png \
  icons/icon128.png \
  -x "*.DS_Store"

echo "Packed: $OUT_ZIP"
unzip -l "$OUT_ZIP"
ls -la "$OUT_ZIP"
