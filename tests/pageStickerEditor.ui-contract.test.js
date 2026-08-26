import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const HTML = read('pageStickerEditor.html');
const JS = read('pageStickerEditor.js');
const CSS = read('pageStickerEditor.css');
const STICKER_UI = read('parkStickerUi.js');
const MANIFEST = JSON.parse(read('manifest.json'));

test('page Sticker editor is a standalone extension-origin document', () => {
  assert.doesNotMatch(HTML, /park\.html/);
  assert.doesNotMatch(JS, /park\.html/);
  assert.match(HTML, /parkStickerUi\.js/);
  for (const id of [
    'stickerNoteBox',
    'stickerNoteMarkdown',
    'stickerNoteWebSource',
    'stickerNoteModeMarkdown',
    'stickerNoteModeWeb',
    'stickerNoteFile',
    'stickerNoteLockEnabled',
    'stickerNoteSave',
    'stickerNoteCancel',
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"`));
  }
  assert.match(HTML, /sandbox="allow-scripts"/);
  assert.match(`${HTML}\n${STICKER_UI}`, /noteCodeSandbox\.html/);
  assert.match(HTML, /maxlength="50000"/);
  assert.match(CSS, /\.sticker-note-box\.open/);
  assert.match(CSS, /\.sticker-note-web-pane\[hidden\][\s\S]*?display: none !important/);
  assert.match(CSS, /\.sticker-note-code-preview-pane\[hidden\][\s\S]*?display: none !important/);
});

test('page Sticker editor bridge authenticates the parent session and lifecycle', () => {
  for (const type of [
    'TABWALL_PAGE_STICKER_EDITOR_INIT',
    'TABWALL_PAGE_STICKER_EDITOR_LOADED',
    'TABWALL_PAGE_STICKER_EDITOR_READY',
    'TABWALL_PAGE_STICKER_EDITOR_SAVED',
    'TABWALL_PAGE_STICKER_EDITOR_CANCELLED',
    'TABWALL_PAGE_STICKER_EDITOR_CLOSE',
    'TABWALL_PAGE_STICKER_EDITOR_ERROR',
  ]) {
    assert.match(`${HTML}\n${JS}`, new RegExp(type));
  }
  assert.match(JS, /event\.source !== window\.parent/);
  assert.match(JS, /event\.origin !== expectedParentOrigin/);
  assert.match(JS, /sessionId/);
  assert.match(JS, /parentOrigin/);
  assert.match(STICKER_UI, /CREATE_PAGE_STICKER/);
  assert.match(STICKER_UI, /UPDATE_NOTE/);
  assert.match(JS, /addStickerNoteFiles/);
  assert.match(STICKER_UI, /runStickerNoteCodePreview/);
});

test('manifest exposes the page editor assets and sandbox CSP', () => {
  const resources = MANIFEST.web_accessible_resources?.flatMap((entry) => entry.resources || []) || [];
  for (const resource of ['pageStickerEditor.html', 'pageStickerEditor.js', 'pageStickerEditor.css']) {
    assert.ok(resources.includes(resource), resource);
  }
  assert.equal(MANIFEST.content_security_policy?.sandbox, "sandbox allow-scripts; script-src 'self' 'unsafe-inline'; object-src 'self';");
});
