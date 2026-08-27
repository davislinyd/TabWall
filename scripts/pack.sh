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
  bgNormalize.js \
  bgLayout.js \
  bgBackup.js \
  bgRestore.js \
  bgUndo.js \
  bgReminders.js \
  bgAi.js \
  bgPageAnnotate.js \
  bgUpdate.js \
  content.js \
  pageAnnotate.js \
  quickSearch.js \
  aiUiCore.js \
  aiPanel.js \
  mediaDb.js \
  backupBuild.js \
  webhookCore.js \
  noteMedia.js \
  noteCodeSandbox.html \
  noteCodeSandbox.js \
  vendor/libheif-bundle.js \
  parkWallpaper.js \
  canvasStore.js \
  parkCanvasGeometry.js \
  parkCanvasRender.js \
  parkStickerUi.js \
  parkImportExport.js \
  parkSettingsUi.js \
  parkSearchQuery.js \
  parkSearchUi.js \
  parkMediaUi.js \
  popup.html \
  popup.js \
  park.html \
  park.css \
  parkI18n.js \
  parkCanvasInteraction.js \
  parkCanvasChrome.js \
  parkListUi.js \
  parkWorkspaceUi.js \
  parkReminderUi.js \
  parkAppHelpers.js \
  parkHistory.js \
  parkAiUi.js \
  pageStickerEditor.html \
  pageStickerEditor.js \
  pageStickerEditor.css \
  park.js \
  icons/icon16.png \
  icons/icon48.png \
  icons/icon128.png \
  -x "*.DS_Store"

echo "Packed: $OUT_ZIP"
unzip -l "$OUT_ZIP"
ls -la "$OUT_ZIP"
