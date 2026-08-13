import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const PARK_SOURCE = fs.readFileSync(new URL('../park.js', import.meta.url), 'utf8');
const SEARCH_QUERY_SOURCE = fs.readFileSync(new URL('../parkSearchQuery.js', import.meta.url), 'utf8');
const SEARCH_UI_SOURCE = fs.readFileSync(new URL('../parkSearchUi.js', import.meta.url), 'utf8');
const MEDIA_UI_SOURCE = fs.readFileSync(new URL('../parkMediaUi.js', import.meta.url), 'utf8');
const CANVAS_GEOM_SOURCE = fs.readFileSync(new URL('../parkCanvasGeometry.js', import.meta.url), 'utf8');
const CANVAS_RENDER_SOURCE = fs.readFileSync(new URL('../parkCanvasRender.js', import.meta.url), 'utf8');
const CANVAS_IX_SOURCE = fs.readFileSync(new URL('../parkCanvasInteraction.js', import.meta.url), 'utf8');
const CANVAS_CHROME_SOURCE = fs.readFileSync(new URL('../parkCanvasChrome.js', import.meta.url), 'utf8');
const LIST_UI_SOURCE = fs.readFileSync(new URL('../parkListUi.js', import.meta.url), 'utf8');
const WORKSPACE_UI_SOURCE = fs.readFileSync(new URL('../parkWorkspaceUi.js', import.meta.url), 'utf8');
const APP_HELPERS_SOURCE = fs.readFileSync(new URL('../parkAppHelpers.js', import.meta.url), 'utf8');
const I18N_SOURCE = fs.readFileSync(new URL('../parkI18n.js', import.meta.url), 'utf8');
const SETTINGS_UI_SOURCE = fs.readFileSync(new URL('../parkSettingsUi.js', import.meta.url), 'utf8');
const IMPORT_EXPORT_SOURCE = fs.readFileSync(new URL('../parkImportExport.js', import.meta.url), 'utf8');
const STICKER_UI_SOURCE = fs.readFileSync(new URL('../parkStickerUi.js', import.meta.url), 'utf8');
const HTML_MARKUP = fs.readFileSync(new URL('../park.html', import.meta.url), 'utf8');
const CSS_SOURCE = fs.readFileSync(new URL('../park.css', import.meta.url), 'utf8');
// Markup + external CSS (styles moved out of park.html in v2.29.1).
const HTML_SOURCE = `${HTML_MARKUP}\n${CSS_SOURCE}`;
const STORE_SOURCE = fs.readFileSync(new URL('../canvasStore.js', import.meta.url), 'utf8');
// Combined park runtime surface for contract tests (core + extracted domains).
const PARK_BEHAVIOR_SOURCE = [
  PARK_SOURCE,
  typeof CANVAS_IX_SOURCE !== 'undefined' ? CANVAS_IX_SOURCE : '',
  typeof CANVAS_CHROME_SOURCE !== 'undefined' ? CANVAS_CHROME_SOURCE : '',
  typeof LIST_UI_SOURCE !== 'undefined' ? LIST_UI_SOURCE : '',
  typeof WORKSPACE_UI_SOURCE !== 'undefined' ? WORKSPACE_UI_SOURCE : '',
  typeof APP_HELPERS_SOURCE !== 'undefined' ? APP_HELPERS_SOURCE : '',
  typeof CANVAS_RENDER_SOURCE !== 'undefined' ? CANVAS_RENDER_SOURCE : '',
  typeof CANVAS_GEOM_SOURCE !== 'undefined' ? CANVAS_GEOM_SOURCE : '',
  typeof I18N_SOURCE !== 'undefined' ? I18N_SOURCE : '',
  typeof SETTINGS_UI_SOURCE !== 'undefined' ? SETTINGS_UI_SOURCE : '',
  typeof IMPORT_EXPORT_SOURCE !== 'undefined' ? IMPORT_EXPORT_SOURCE : '',
  typeof STICKER_UI_SOURCE !== 'undefined' ? STICKER_UI_SOURCE : '',
].join('\n');
// Flat copy: strip env. so contracts written for pre-extract free names still match module bodies.
const PARK_BEHAVIOR_FLAT = PARK_BEHAVIOR_SOURCE.replace(/\benv\./g, '');

/** Prefer full implementation body over one-line `...args` thin aliases. */
function extractFnSource(src, name) {
  const re = new RegExp(`(?:async )?function ${name}\\s*\\(`, 'g');
  let best = '';
  let m;
  while ((m = re.exec(src))) {
    const from = m.index;
    // brace-match from first { after this match
    let i = src.indexOf('{', from);
    if (i < 0) continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < src.length; j++) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) continue;
    const chunk = src.slice(from, end + 1);
    if (chunk.includes('...args') && chunk.length < 160) continue;
    if (chunk.length > best.length) best = chunk;
  }
  return best;
}

const WORKBENCH_CSS = CSS_SOURCE.split('/* ─── TabWall 2.17.0 Editorial Workbench')[1] || CSS_SOURCE;

test('Spatial Canvas exposes isolated controls and complete node actions', () => {
  assert.match(HTML_SOURCE, /id="canvasViewport"[^>]*class="canvas-viewport"/);
  for (const id of ['canvasContextBar', 'canvasMinimap', 'canvasZoomControls', 'canvasZoomValue', 'canvasZoomSlider', 'canvasZoomMenu', 'canvasZoomOut', 'canvasZoomIn', 'canvasConnections', 'canvasMinimapViewport']) {
    assert.match(HTML_SOURCE, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(HTML_SOURCE, /canvasArrangePanel|canvasArrangeBtn|canvasSnapToggle/);
  assert.match(HTML_SOURCE, /id="canvasOrganizePanel"[^>]*role="dialog"[^>]*hidden/);
  assert.match(HTML_SOURCE, /data-canvas-arrange="grid"[^>]*data-i18n="canvasArrangeGrid"/);
  assert.match(HTML_SOURCE, /data-canvas-arrange="align"[^>]*data-i18n="canvasArrangeAlign"/);
  assert.match(HTML_SOURCE, /id="sortBy"/);
  assert.match(HTML_SOURCE, /value="newest"/);
  assert.match(HTML_SOURCE, /value="domain"/);
  assert.match(HTML_SOURCE, /value="group-first"/);
  assert.doesNotMatch(HTML_SOURCE, /value="oldest"|value="title-desc"|value="manual"|canvasArrangeCircle/);
  assert.match(HTML_SOURCE, /id="canvasLinkBtn"[^>]*data-canvas-tool="link"/);
  assert.match(HTML_SOURCE, /id="lbGroupMosaic" class="lb-group-mosaic"/);
  assert.match(HTML_SOURCE, /id="lbBack"[^>]*data-i18n="backToGroup"/);
  assert.match(HTML_SOURCE, /id="lbManageMembers"[^>]*data-i18n="openMembersManage"/);
  assert.match(HTML_SOURCE, /\.lb-group-grid\s*\{/);
  assert.match(HTML_SOURCE, /\.lb-group-cell\s*\{/);
  for (const action of ['restore', 'snapshot', 'edit', 'copy', 'members', 'pin', 'delete']) {
    assert.match(CANVAS_RENDER_SOURCE, new RegExp(`action: '${action}'`));
  }
  assert.match(CANVAS_RENDER_SOURCE, /function canvasNodeActionEntries\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasNodeActionEntries\(/);
  assert.match(PARK_SOURCE, /TabWallCanvasRender/);
  assert.match(PARK_BEHAVIOR_FLAT, /async function runCanvasNodeAction\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function isCanvasControlTarget\(target\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function isCanvasWheelControlTarget\(target\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(isCanvasControlTarget\(event\.target\)\) return;/);
  assert.match(PARK_BEHAVIOR_FLAT, /node\.focus\(\{ preventScroll: true \}\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /getBoundingClientRect\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasActiveTool === 'area'[\s\S]*?beginCanvasPointer\(event, 'lasso'\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasActiveTool === 'select' \|\| canvasSpacePressed[\s\S]*?beginCanvasPointer\(event, 'pan'\)/);
  assert.doesNotMatch(PARK_SOURCE, /canvasActiveTool === 'pan'/);
  assert.doesNotMatch(HTML_SOURCE, /data-canvas-tool="pan"/);
  assert.match(PARK_BEHAVIOR_FLAT, /classList\.toggle\('is-panning', kind === 'pan'\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /normalizeCanvasWheelDelta\(event\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(PARK_BEHAVIOR_FLAT, /commitPan\(dx \/ zoom, dy \/ zoom\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /scheduleCanvasWheelZoom\(event, dy\)/);
  assert.match(CANVAS_GEOM_SOURCE, /CANVAS_TRACKPAD_ZOOM_SENSITIVITY = 0\.006/);
  assert.match(PARK_BEHAVIOR_FLAT, /CANVAS_TRACKPAD_ZOOM_SENSITIVITY/);
  assert.match(PARK_BEHAVIOR_FLAT, /flushCanvasWheelZoom\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_NODE_CLICK_DELAY = 300/);
  assert.match(PARK_BEHAVIOR_FLAT, /scheduleCanvasNodePreview\(item\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.detail > 1/);
  assert.match(PARK_BEHAVIOR_FLAT, /openCanvasGroupLightbox\(current\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function buildGroupMemberNavList\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function renderGroupOverviewGrid\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function handleLightboxEscape\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function backToGroupOverview\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /lb-group-grid/);
  assert.match(PARK_BEHAVIOR_FLAT, /fromOverview/);
  // Group expand must not reuse the 4-tile card cover as the lightbox body.
  {
    const groupLb = extractFnSource(PARK_BEHAVIOR_FLAT, 'openCanvasGroupLightbox');
    assert.doesNotMatch(groupLb, /groupCoverHtml/);
    assert.match(groupLb, /renderGroupOverviewGrid/);
  }
  assert.match(PARK_BEHAVIOR_FLAT, /item\?\.kind === 'group'[\s\S]*?openCanvasGroupLightbox\(item\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /item\.kind === 'group'[\s\S]*?openCanvasGroupLightbox\(item\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /suppressCanvasNodeClick\(state\.id\)/);
  const pointerControlSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'isCanvasControlTarget');
  assert.doesNotMatch(pointerControlSource, /\.canvas-node-thumb/);
  assert.match(HTML_SOURCE, /\.canvas-viewport\s*\{[\s\S]*?cursor: grab;/);
  assert.doesNotMatch(WORKBENCH_CSS, /\.canvas-viewport:focus-visible\s*\{[\s\S]*?box-shadow/);
  assert.match(HTML_SOURCE, /class="canvas-minimap-viewport"/);
  assert.doesNotMatch(HTML_SOURCE, /id="canvasMinimap"[^>]*aria-hidden="true"/);
  assert.match(CANVAS_RENDER_SOURCE, /function renderCanvasConnections\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function renderCanvasConnections\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function handleCanvasConnectionNodeClick\(id\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(event\.button === 0 && !node && \(selectedCanvasConnectionId \|\| canvasConnectionSourceId\)\) \{[\s\S]*?clearCanvasConnectionSelection\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasActiveTool === 'link'/);
  assert.match(HTML_SOURCE, /body\.canvas-mode \.header-primary\s*\{[\s\S]*?background: transparent;/);
});

test('Top bar exposes Canvas organization and manual add popovers', () => {
  for (const id of ['canvasOrganizeWrap', 'canvasOrganizeBtn', 'canvasOrganizePanel', 'manualAddWrap', 'manualAddTopBtn', 'manualAddPanel']) {
    assert.match(HTML_SOURCE, new RegExp(`id="${id}"`));
  }
  assert.match(HTML_SOURCE, /id="canvasOrganizeWrap"[^>]*hidden/);
  assert.match(HTML_SOURCE, /id="canvasOrganizeBtn"[^>]*aria-expanded="false"[^>]*aria-controls="canvasOrganizePanel"/);
  assert.match(HTML_SOURCE, /id="manualAddTopBtn"[^>]*aria-expanded="false"[^>]*aria-controls="manualAddPanel"/);
  for (const id of ['manualAddText', 'manualAddBtn', 'manualAddStatus']) {
    assert.match(HTML_SOURCE, new RegExp(`id="${id}"`));
  }
  const settingsStart = HTML_SOURCE.indexOf('<div id="settingsBox"');
  const lightboxStart = HTML_SOURCE.indexOf('<div id="lightbox"', settingsStart);
  const settingsSource = HTML_SOURCE.slice(settingsStart, lightboxStart);
  assert.doesNotMatch(settingsSource, /id="sortBy"|data-canvas-arrange|manualAddBlock|id="manualAddText"/);
  assert.doesNotMatch(HTML_SOURCE, /data-settings-arrange/);
  assert.match(PARK_BEHAVIOR_FLAT, /function openCanvasOrganizePanel\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function openManualAddPanel\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function closeHeaderPopovers\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function syncCanvasOrganizeUi\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(kind === 'url'\) \{[\s\S]*?openManualAddPanel\(\)/);
  assert.match(SETTINGS_UI_SOURCE, /canvasOrganizePanel\?\.querySelectorAll\('\[data-canvas-arrange\]'\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /#quickAddWrap, #moreToolsMenu, #moreToolsBtn, #canvasOrganizeWrap, #manualAddWrap/);
});

test('Search field scopes include domain mode via d/domain + Tab', () => {
  // Search UI (tokens / Tab scope) lives in parkSearchUi.js (v2.29.3+)
  assert.match(SEARCH_UI_SOURCE, /d:\s*'domain'/);
  assert.match(SEARCH_UI_SOURCE, /domain:\s*'domain'/);
  assert.match(SEARCH_UI_SOURCE, /token === 'tag' \|\| token === 'note' \|\| token === 'group' \|\| token === 'domain' \|\| token === 'all'/);
  assert.match(SEARCH_UI_SOURCE, /scope === 'domain'/);
  assert.match(PARK_BEHAVIOR_FLAT, /searchPhDomain/);
  assert.match(PARK_BEHAVIOR_FLAT, /searchPhDomainRegex/);
  assert.match(PARK_BEHAVIOR_FLAT, /d\/domain/);
  // Match/compile lives in parkSearchQuery.js (v2.29.2+)
  assert.match(SEARCH_QUERY_SOURCE, /scope === 'domain'/);
  assert.match(SEARCH_QUERY_SOURCE, /item\?\.kind === 'tab' \|\| item\?\.kind === 'group'/);
  assert.match(HTML_MARKUP, /parkSearchQuery\.js/);
  assert.match(HTML_MARKUP, /parkSearchUi\.js/);
  assert.match(HTML_MARKUP, /parkMediaUi\.js/);
  assert.match(HTML_MARKUP, /parkCanvasGeometry\.js/);
  assert.match(HTML_MARKUP, /parkCanvasRender\.js/);
  assert.match(PARK_SOURCE, /TabWallSearchQuery/);
  assert.match(PARK_SOURCE, /TabWallSearchUi/);
  assert.match(PARK_SOURCE, /TabWallMediaUi/);
  assert.match(PARK_SOURCE, /TabWallCanvasGeometry/);
  assert.match(PARK_SOURCE, /TabWallCanvasRender/);
  // Media thumb/snap lazy-load lives in parkMediaUi.js (v2.29.4+)
  assert.match(MEDIA_UI_SOURCE, /function observeThumb\(/);
  assert.match(MEDIA_UI_SOURCE, /function wireCanvasMedia\(/);
  assert.match(MEDIA_UI_SOURCE, /function fetchMediaUrl\(/);
  assert.match(MEDIA_UI_SOURCE, /TabWallMediaUi/);
  // Canvas pure geometry lives in parkCanvasGeometry.js (v2.29.5+)
  assert.match(CANVAS_GEOM_SOURCE, /function canvasConnectionCurveGeometry\(/);
  assert.match(CANVAS_GEOM_SOURCE, /function canvasBoundsForItems\(/);
  assert.match(CANVAS_GEOM_SOURCE, /TabWallCanvasGeometry/);
  // Canvas render surface lives in parkCanvasRender.js (v2.29.6+)
  assert.match(CANVAS_RENDER_SOURCE, /function canvasNodeHtml\(/);
  assert.match(CANVAS_RENDER_SOURCE, /function renderCanvas\(/);
  assert.match(CANVAS_RENDER_SOURCE, /function arrangeCanvasGrid\(/);
  assert.match(CANVAS_RENDER_SOURCE, /function renderCanvasMinimap\(/);
  assert.match(CANVAS_RENDER_SOURCE, /TabWallCanvasRender/);
  // Panel domains live in parkSettingsUi / parkImportExport / parkStickerUi (v2.29.7+)
  assert.match(HTML_MARKUP, /parkSettingsUi\.js/);
  assert.match(HTML_MARKUP, /parkImportExport\.js/);
  assert.match(HTML_MARKUP, /parkStickerUi\.js/);
  assert.match(PARK_SOURCE, /TabWallSettingsUi/);
  assert.match(PARK_SOURCE, /TabWallImportExport/);
  assert.match(PARK_SOURCE, /TabWallStickerUi/);
  assert.match(SETTINGS_UI_SOURCE, /function initSettingsUi\(/);
  assert.match(IMPORT_EXPORT_SOURCE, /function exportLiteBackup\(/);
  assert.match(STICKER_UI_SOURCE, /function openStickerNoteEditor\(/);
  assert.match(SETTINGS_UI_SOURCE, /TabWallSettingsUi/);
  assert.match(IMPORT_EXPORT_SOURCE, /TabWallImportExport/);
  assert.match(STICKER_UI_SOURCE, /TabWallStickerUi/);
});

test('Canvas context menu covers blank canvas and single-card node actions', () => {
  assert.match(HTML_SOURCE, /id="canvasContextMenu"[^>]*role="menu"[^>]*hidden/);
  assert.match(HTML_SOURCE, /\.canvas-context-menu\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(HTML_SOURCE, /\.canvas-context-menu button\.danger\s*\{/);
  assert.match(CANVAS_RENDER_SOURCE, /function canvasNodeActionEntries\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasNodeActionEntries\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /async function runCanvasNodeAction\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasBlankContextMenuEntries\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function renderCanvasContextMenuItems\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function openCanvasContextMenu\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function closeCanvasContextMenu\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function handleCanvasContextMenuAction\(/);
  assert.match(IMPORT_EXPORT_SOURCE, /async function exportLiteBackup\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /async function exportLiteBackup\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /addEventListener\('contextmenu'/);
  assert.match(PARK_BEHAVIOR_FLAT, /const node = event\.target\.closest\?\.\('\.canvas-node'\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /mode: 'node'/);
  assert.match(PARK_BEHAVIOR_FLAT, /mode: 'blank'/);
  assert.match(PARK_BEHAVIOR_FLAT, /setSelection\(\[id\]\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /await runCanvasNodeAction\(state\.itemId, action\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /await runCanvasNodeAction\(item\.id, button\.dataset\.canvasNodeAction/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasNodeActionEntries\(item\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /#canvasContextMenu/);
  assert.match(PARK_BEHAVIOR_FLAT, /placeStickerNoteAt\(state\.worldPoint \|\| canvasWorldViewportCenter\(\)\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /arrangeCanvas\('align'\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /exportLiteBackup\(\{ toast: true \}\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /normalizeSortBy\('newest'\)/);
  for (const key of ['canvasCtxSortDate', 'canvasCtxArrangeAlign', 'canvasCtxBackup', 'canvasCtxAddNote']) {
    assert.match(PARK_BEHAVIOR_FLAT, new RegExp(`'${key}'`));
  }
  for (const action of ['sort-date', 'arrange-align', 'backup-lite', 'add-note']) {
    assert.match(PARK_BEHAVIOR_FLAT, new RegExp(`action: '${action}'`));
  }
  for (const action of ['restore', 'snapshot', 'edit', 'copy', 'members', 'pin', 'delete']) {
    assert.match(CANVAS_RENDER_SOURCE, new RegExp(`action: '${action}'`));
  }
});

test('Canvas Sticker Note exposes placement, split editing, attachments, and safe actions', () => {
  assert.match(HTML_SOURCE, /id="canvasAddNoteBtn"[^>]*data-canvas-tool="note"/);
  for (const id of [
    'stickerNoteBox',
    'stickerNoteTitle',
    'stickerNoteTagDraft',
    'stickerNoteMarkdown',
    'stickerNoteFile',
    'stickerNoteDrop',
    'stickerNoteAttachments',
    'stickerNoteMediaStatus',
    'stickerNotePreview',
    'stickerNoteSave',
    'stickerNoteCancel',
  ]) {
    assert.match(HTML_SOURCE, new RegExp(`id="${id}"`));
  }
  assert.match(HTML_SOURCE, /class="sticker-note-body"/);
  assert.match(HTML_SOURCE, /type="file" accept="image\/\*" multiple hidden/);
  assert.match(HTML_SOURCE, /\.sticker-note-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(320px, 1fr\) minmax\(280px, 1fr\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function armCanvasNotePlacement\(\)/);
  assert.match(STICKER_UI_SOURCE, /function placeStickerNoteAt\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function placeStickerNoteAt\(/);
  assert.match(STICKER_UI_SOURCE, /type: 'CREATE_NOTE'/);
  assert.match(PARK_BEHAVIOR_FLAT, /type: 'UPDATE_NOTE'/);
  assert.match(PARK_BEHAVIOR_FLAT, /type: 'DELETE_NOTE'/);
  assert.match(STICKER_UI_SOURCE, /env\.Build\?\.renderSafeMarkdown/);
  assert.match(STICKER_UI_SOURCE, /attachment:\/\//);
  assert.match(PARK_BEHAVIOR_FLAT, /stickerNoteFile\.files/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.clipboardData\?\.items/);
  assert.match(PARK_BEHAVIOR_FLAT, /stickerNoteDrop\?\.addEventListener\('drop'/);
  assert.match(HTML_SOURCE, /<script src="noteMedia\.js"><\/script>/);
  assert.match(PARK_SOURCE, /const NoteMedia = self\.TabWallNoteMedia/);
  assert.match(STICKER_UI_SOURCE, /await env\.NoteMedia\.normalizeBlob\(file\)/);
  assert.match(STICKER_UI_SOURCE, /type: 'GET_ATTACHMENT_USAGE'/);
  // Attachment URL cache + observe lives in parkMediaUi.js (v2.29.4+)
  assert.match(MEDIA_UI_SOURCE, /const ATTACHMENT_URL_CACHE_MAX = 8/);
  assert.match(MEDIA_UI_SOURCE, /function observeStickerAttachment\(img\)/);
  assert.match(MEDIA_UI_SOURCE, /function pruneAttachmentUrlCache\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /const observeStickerAttachment = MediaUi\.observeStickerAttachment/);
  assert.match(PARK_BEHAVIOR_FLAT, /const pruneAttachmentUrlCache = MediaUi\.pruneAttachmentUrlCache/);
  assert.match(PARK_BEHAVIOR_FLAT, /stickerNoteMediaBusy/);
});

test('Top-level actions are consolidated in the header', () => {
  for (const id of ['viewCards', 'viewList', 'canvasTagsBtn', 'canvasAddBtn', 'canvasSettingsBtn', 'canvasListBtn']) {
    assert.doesNotMatch(HTML_SOURCE, new RegExp(`id="${id}"`));
    assert.doesNotMatch(PARK_SOURCE, new RegExp(`getElementById\(['"]${id}['"]\)`));
  }
  assert.match(HTML_SOURCE, /id="viewModeBtn"/);
  assert.match(HTML_SOURCE, /id="viewModeLabel"/);
  assert.match(HTML_SOURCE, /id="viewModeListIcon"/);
  assert.match(HTML_SOURCE, /id="viewModeCanvasIcon"/);
  assert.doesNotMatch(HTML_SOURCE, /canvas-rail-bottom/);
  assert.match(HTML_SOURCE, /class="btn header-text-btn" id="themeBtn"/);
  const moreToolsMenu = HTML_SOURCE.match(/<div class="tools-menu" id="moreToolsMenu">[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(moreToolsMenu, /id="themeBtn"/);
  assert.match(SETTINGS_UI_SOURCE, /function syncViewModeButton\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function syncViewModeButton\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /viewModeBtn\?\.addEventListener\('click'/);
  assert.match(SETTINGS_UI_SOURCE, /applyI18n\(\);[\s\S]{0,40}syncViewModeButton\(env\.settings\.viewMode\)/);
  assert.match(HTML_SOURCE, /class="btn quick-add-main" id="quickAddBtn"/);
  assert.match(HTML_SOURCE, /class="btn quick-add-menu-btn" id="quickAddMenuBtn"/);
  assert.doesNotMatch(HTML_SOURCE, /class="btn primary quick-add-main"/);
  assert.doesNotMatch(HTML_SOURCE, /class="btn primary quick-add-menu-btn"/);
  assert.match(PARK_BEHAVIOR_FLAT, /function resetCanvasView\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function setCanvasActiveTool\(nextTool\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.button !== 0 \|\| isCanvasControlTarget\(event\.target\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(id\) \{[\s\S]*?restoreItem\(id\);[\s\S]*?\} else \{[\s\S]*?setCanvasActiveTool\(canvasActiveTool === 'area' \? 'select' : 'area'\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasActiveTool = nextTool === 'area' \|\| nextTool === 'link' \|\| nextTool === 'note'/);
  assert.match(PARK_BEHAVIOR_FLAT, /function handleCanvasMiddleClick\(event\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_MIDDLE_CLICK_DELAY = 300/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.button === 1[\s\S]*?handleCanvasMiddleClick\(event\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /document\.getElementById\('canvasResetView'\)\?\.addEventListener\('click', resetCanvasView\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function focusCanvasItem\(id\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /setCanvasIndexFilter\(`stack:\$\{id\}`, id\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /focusCanvasItem\(focusId\)/);
  assert.doesNotMatch(PARK_SOURCE, /canvasArrangePanel|canvasArrangeBtn|canvasSnapToggle|data-settings-arrange/);
});

test('Chrome shortcut settings expose the tab-or-group keep command', () => {
  for (const command of ['save-tab', 'save-keep', 'save-group', 'toggle-park']) {
    assert.match(HTML_SOURCE, new RegExp(`data-chrome-cmd="${command}"`));
  }
  assert.match(PARK_BEHAVIOR_FLAT, /helpShortcutSaveKeep: '儲存目前分頁／Tab Group（不關閉）'/);
  assert.match(PARK_BEHAVIOR_FLAT, /helpShortcutSaveKeep: 'Park current tab or Tab Group \(keep open\)'/);
});

test('Help panel is centered; cards have newsprint; Option+/ is documented', () => {
  assert.match(CSS_SOURCE, /#helpBox\.open\s*\{[\s\S]*?transform:\s*translate\(-50%, -50%\) !important;/);
  assert.match(WORKBENCH_CSS, /#grid\.cards \.card,[\s\S]*?\.canvas-node:not\(\.canvas-note\)[\s\S]*?feTurbulence/);
  assert.match(HTML_SOURCE, /<script src="quickSearch\.js"><\/script>/);
  assert.match(HTML_SOURCE, /data-i18n="helpShortcutQuickSearch"/);
  assert.match(I18N_SOURCE, /helpShortcutQuickSearch: '在任何分頁搜尋已存項目（不必開啟 TabWall）。tag／group／note／domain \+ Tab 切換欄位'/);
});

test('Canvas rail is resizable, collapsible, and the header mark is a stacked-panel SVG', () => {
  assert.match(HTML_SOURCE, /id="canvasRail" class="canvas-rail"/);
  assert.match(HTML_SOURCE, /class="canvas-rail-content"/);
  assert.match(HTML_SOURCE, /id="canvasRailResize"[^>]*role="separator"/);
  assert.match(HTML_SOURCE, /id="canvasRailResize"[^>]*aria-orientation="vertical"/);
  assert.match(HTML_SOURCE, /id="canvasRailToggle"[^>]*aria-controls="canvasRail"/);
  assert.match(HTML_SOURCE, /id="canvasRailToggle"[^>]*aria-expanded="true"/);
  assert.match(HTML_SOURCE, /--canvas-rail-width:\s*188px/);
  assert.match(HTML_SOURCE, /data-canvas-rail-collapsed='true'/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_RAIL_DEFAULT_WIDTH = 188/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_RAIL_MIN_WIDTH = 168/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_RAIL_MAX_WIDTH = 360/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_RAIL_COLLAPSE_THRESHOLD = 120/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_RAIL_COLLAPSED_WIDTH = 34/);
  const canvasRailSource = HTML_SOURCE.match(/<aside id="canvasRail"[\s\S]*?<\/aside>/)?.[0] || '';
  assert.match(canvasRailSource, /class="canvas-rail-content"[\s\S]*?id="versionBadge"/);
  assert.doesNotMatch(PARK_SOURCE, /--canvas-version-left/);
  assert.doesNotMatch(HTML_SOURCE, /body\.canvas-mode #versionBadge/);
  assert.match(WORKBENCH_CSS, /#versionBadge\s*\{[\s\S]*?position:\s*static;[\s\S]*?align-self:\s*stretch;/);
  assert.match(PARK_BEHAVIOR_FLAT, /function normalizeCanvasRailSettings\(target\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function applyCanvasRailUi\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function initCanvasRailResize\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasRailResize\.addEventListener\('pointerdown'/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasRailResize\.addEventListener\('keydown'/);
  assert.match(PARK_BEHAVIOR_FLAT, /function scheduleCanvasRailResizePreview\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function flushCanvasRailResizePreview\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasRailWidth: collapsed \? normalizeCanvasRailWidth\(state\.startWidth\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /window\.addEventListener\('pointermove', updateCanvasRailResize, true\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.isPrimary/);
  assert.match(PARK_BEHAVIOR_FLAT, /saveSettings\(next\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.key !== 'ArrowLeft' && event\.key !== 'ArrowRight'/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.key === 'Home'/);
  assert.match(PARK_BEHAVIOR_FLAT, /event\.key === 'End'/);
  assert.match(WORKBENCH_CSS, /flex:\s*0 0 var\(--canvas-rail-width\)/);
  assert.match(WORKBENCH_CSS, /cursor:\s*col-resize/);
  assert.match(WORKBENCH_CSS, /touch-action:\s*none/);
  assert.match(WORKBENCH_CSS, /#canvasView\.is-rail-resizing/);
  const brandMark = HTML_SOURCE.match(/<span class="brand-mark"[\s\S]*?<\/span>/)?.[0] || '';
  assert.match(brandMark, /viewBox="0 0 36 36"/);
  assert.match(brandMark, /<path[^>]+><\/path>/);
  assert.doesNotMatch(brandMark, /<rect\s/);
  assert.match(WORKBENCH_CSS, /\.brand-mark\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
});

test('Editorial Workbench is desktop-only with low-contrast theme tokens', () => {
  assert.match(PARK_BEHAVIOR_FLAT, /theme: 'dark'/);
  assert.match(HTML_SOURCE, /<html lang="zh-Hant" data-theme="dark" data-fx="standard">/);
  assert.match(WORKBENCH_CSS, /--bg: #101110;/);
  assert.match(WORKBENCH_CSS, /html\[data-theme='light'\][\s\S]*?--bg: #f5f1ea;/);
  assert.match(WORKBENCH_CSS, /min-width: 1200px;/);
  assert.doesNotMatch(HTML_SOURCE, /@media\s*\(\s*(?:max|min)-width\s*:/);
  assert.match(WORKBENCH_CSS, /\.app-header\s*\{[\s\S]*?flex-wrap: nowrap;[\s\S]*?border: 0;/);
  assert.match(WORKBENCH_CSS, /\.canvas-rail\s*\{[\s\S]*?flex: 0 0 var\(--canvas-rail-width\);[\s\S]*?border: 0;/);
  assert.match(WORKBENCH_CSS, /\.canvas-node\.selected\s*\{[\s\S]*?border-color: var\(--accent\);/);
  const quickAddCss =
    WORKBENCH_CSS.match(/\.quick-add-main,[\s\S]*?background: var\(--btn-bg\) !important;[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(quickAddCss, /color: var\(--muted\) !important;/);
  assert.match(quickAddCss, /border-color: transparent !important;/);
  assert.doesNotMatch(quickAddCss, /var\(--accent-soft\)/);
  assert.doesNotMatch(quickAddCss, /color:\s*#fff/);
});

test('Standard visual fx is gated by fxLevel and data-fx', () => {
  assert.match(PARK_SOURCE, /fxLevel: 'standard'/);
  assert.match(HTML_MARKUP, /name="fxLevel"[^>]*value="standard"/);
  assert.match(HTML_MARKUP, /name="fxLevel"[^>]*value="quiet"/);
  assert.match(HTML_MARKUP, /name="fxLevel"[^>]*value="cinematic"/);
  assert.match(SETTINGS_UI_SOURCE, /function applyFxLevel\(/);
  assert.match(SETTINGS_UI_SOURCE, /function normalizeFxLevel\(/);
  assert.match(SETTINGS_UI_SOURCE, /dataset\.fx/);
  assert.match(SETTINGS_UI_SOURCE, /value === 'quiet' \|\| value === 'cinematic'/);
  assert.match(CSS_SOURCE, /:is\(\[data-fx='standard'\], \[data-fx='cinematic'\]\)/);
  assert.match(CSS_SOURCE, /@keyframes fxDash/);
  assert.match(CSS_SOURCE, /@keyframes fxSearchFlash/);
  assert.match(CSS_SOURCE, /@keyframes fxJustSaved/);
  assert.match(CSS_SOURCE, /@keyframes fxFadeIn/);
  assert.match(CSS_SOURCE, /@keyframes fxPinSweep/);
  assert.match(CSS_SOURCE, /@keyframes fxConnFlow/);
  assert.match(CANVAS_RENDER_SOURCE, /just-saved/);
  assert.match(CANVAS_RENDER_SOURCE, /canvas-connection-flow/);
  assert.match(CANVAS_IX_SOURCE, /function syncCanvasNodeDragFx\(/);
  assert.match(CANVAS_IX_SOURCE, /function updateCanvasNodeTilt\(/);
  assert.match(CANVAS_CHROME_SOURCE, /--fx-grid-x/);
  assert.match(I18N_SOURCE, /fxTitle:/);
  assert.match(I18N_SOURCE, /fxQuiet:/);
  assert.match(I18N_SOURCE, /fxStandard:/);
  assert.match(I18N_SOURCE, /fxCinematic:/);
});

test('Spatial Canvas state and settings use shared persistence contracts', () => {
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasLayoutSnapshot\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /type: 'PATCH_CANVAS_LAYOUT',[\s\S]*?baseRevision/);
  assert.match(PARK_BEHAVIOR_FLAT, /getCanvasVisibleTabs\(\)\.length/);
  assert.match(SETTINGS_UI_SOURCE, /saveSettings\(\{ canvasSnap: env\.canvasSnapToGrid \}\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasSnapToGrid/);
  assert.match(PARK_BEHAVIOR_FLAT, /DEFAULT_CANVAS_VIEWPORT = Object\.freeze\(\{ x: 0, y: 0, zoom: 1 \}\)/);
  // Canvas thumb/snap quality lives in parkMediaUi.js (v2.29.4+)
  assert.match(MEDIA_UI_SOURCE, /function canvasPreferredMediaKind\(\)/);
  assert.match(MEDIA_UI_SOURCE, /return canvasZoom\(\) > 1 \? 'snap' : 'thumb'/);
  assert.match(MEDIA_UI_SOURCE, /const mediaFetches = new Map\(\)/);
  assert.match(MEDIA_UI_SOURCE, /function getCanvasMediaObserver\(\)/);
  assert.match(MEDIA_UI_SOURCE, /root: viewport/);
  assert.match(MEDIA_UI_SOURCE, /function probeCanvasMediaUrl\(url\)/);
  assert.match(MEDIA_UI_SOURCE, /canvasPendingMediaUrls/);
  assert.match(MEDIA_UI_SOURCE, /function loadCanvasThumbFallback\(img\)/);
  assert.match(MEDIA_UI_SOURCE, /function refreshCanvasMediaQuality\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /data-canvas-has-snap/);
  assert.match(PARK_BEHAVIOR_FLAT, /const refreshCanvasMediaQuality = MediaUi\.refreshCanvasMediaQuality/);
  assert.match(PARK_BEHAVIOR_FLAT, /const canvasMinimapElements = new Map\(\)/);
  assert.match(CANVAS_RENDER_SOURCE, /function arrangeCanvasGrid\(items, layout\)/);
  assert.match(CANVAS_RENDER_SOURCE, /function arrangeCanvasAlign\(items, layout\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function arrangeCanvasGrid\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function arrangeCanvasAlign\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /mode === 'grid'/);
  assert.match(PARK_BEHAVIOR_FLAT, /function normalizeSortBy\(value\)/);
  assert.match(SETTINGS_UI_SOURCE, /sortByEl\?\.addEventListener/);
  assert.match(SETTINGS_UI_SOURCE, /data-canvas-arrange/);
  assert.match(HTML_SOURCE, /data-canvas-arrange/);
  assert.match(PARK_BEHAVIOR_FLAT, /function beginCanvasMinimapDrag\(event\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function updateCanvasMinimapDrag\(event\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /previewPointer\(\{ dx, dy, moved:/);
  assert.match(PARK_BEHAVIOR_FLAT, /finishPointer\(\{ commit \}\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasMinimapProjection/);
  assert.doesNotMatch(CANVAS_RENDER_SOURCE.match(/function renderCanvasMinimap\([\s\S]*?\n\}/)?.[0] || '', /innerHTML/);
  assert.match(CANVAS_RENDER_SOURCE, /data-canvas-media="true"/);
  assert.match(HTML_SOURCE, /id="canvasZoomValue"[^>]*aria-expanded="false"[^>]*aria-controls="canvasZoomMenu">100%<\/button>/);
  assert.match(HTML_SOURCE, /#settingsBox\.open[\s\S]*?display: grid/);
  assert.match(HTML_SOURCE, /#settingsBox\.open\s*\{\s*display:\s*grid;\s*transform:\s*translate\(-50%, -50%\) !important;/);
  assert.match(HTML_SOURCE, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(HTML_SOURCE, /overflow-y: auto/);
  const railCss = HTML_SOURCE.match(/\.canvas-rail\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(railCss, /overflow: hidden/);
  assert.doesNotMatch(railCss, /overflow-y:\s*auto/);
  assert.match(HTML_SOURCE, /\.canvas-stack-index\s*\{[\s\S]*?overflow-y: auto;/);
  assert.match(HTML_SOURCE, /id="autoBackupStatus"[\s\S]*?<\/div>\s*<\/div>\s*<div class="settings-footer"/);
});

test('Automatic note and tag save rules expose a localized settings editor', () => {
  assert.match(HTML_SOURCE, /data-settings-section="automation"[^>]*data-i18n="settingsAutomation"/);
  assert.match(HTML_SOURCE, /id="autoSaveMetadataEnabled"/);
  assert.match(HTML_SOURCE, /id="autoSaveMetadataRules"/);
  assert.match(HTML_SOURCE, /id="autoSaveMetadataAddRuleBtn"/);
  for (const field of ['domain', 'title']) {
    assert.match(PARK_BEHAVIOR_FLAT, new RegExp(`['\\"]${field}['\\"]`));
  }
  for (const operator of ['match', 'contains', 'startsWith', 'endsWith', 'regex']) {
    assert.match(PARK_BEHAVIOR_FLAT, new RegExp(`['\\"]${operator}['\\"]`));
  }
  for (const key of [
    'autoSaveMetadataTitle',
    'autoSaveMetadataHint',
    'autoSaveMetadataEnable',
    'autoSaveMetadataAddRule',
    'autoSaveMetadataRuleEnable',
    'autoSaveMetadataAddCondition',
    'autoSaveMetadataNote',
    'autoSaveMetadataTags',
  ]) {
    assert.match(PARK_BEHAVIOR_FLAT, new RegExp(`${key}:`));
  }
  assert.match(PARK_BEHAVIOR_FLAT, /settings\.autoSaveMetadata/);
  assert.match(SETTINGS_UI_SOURCE, /type: 'PATCH_SETTINGS'/);
  assert.match(PARK_BEHAVIOR_FLAT, /function saveSettings\(/);
  assert.match(SETTINGS_UI_SOURCE, /data-auto-save-rule-prop/);
  assert.match(SETTINGS_UI_SOURCE, /data-auto-save-condition-prop/);
});

test('Spatial Canvas uses the single store and keyed interaction lifecycle', () => {
  assert.match(HTML_SOURCE, /<script src="canvasStore\.js"><\/script>/);
  assert.match(STORE_SOURCE, /function createCanvasStore\(options = \{\}\)/);
  assert.match(STORE_SOURCE, /function normalizeConnections\(rawConnections/);
  assert.match(STORE_SOURCE, /op.type === 'setConnections'/);
  assert.match(STORE_SOURCE, /function commitConnections\(connections\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /const canvasNodeElements = new Map\(\)/);
  assert.match(CANVAS_RENDER_SOURCE, /canvasNodeElements\.get\(item\.id\)/);
  assert.doesNotMatch(CANVAS_RENDER_SOURCE.match(/function renderCanvas\(\)[\s\S]*?\n\}/)?.[0] || '', /getCanvasNodesEl\(\)\.innerHTML\s*=\s*''/);
  assert.match(PARK_BEHAVIOR_FLAT, /requestAnimationFrame/);
  assert.match(PARK_BEHAVIOR_FLAT, /lostpointercapture/);
  assert.match(PARK_BEHAVIOR_FLAT, /visibilitychange/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasLoadGeneration/);
  assert.match(PARK_BEHAVIOR_FLAT, /applyRemote\(layout, revision\)/);
  assert.match(MEDIA_UI_SOURCE, /preferred === 'snap'/);
});

test('Canvas search relations and connection gestures have a stable UI contract', () => {
  assert.match(CANVAS_RENDER_SOURCE, /\['top', 'canvasLinkHandleTop'\]/);
  assert.match(CANVAS_RENDER_SOURCE, /\['right', 'canvasLinkHandleRight'\]/);
  assert.match(CANVAS_RENDER_SOURCE, /\['bottom', 'canvasLinkHandleBottom'\]/);
  assert.match(CANVAS_RENDER_SOURCE, /\['left', 'canvasLinkHandleLeft'\]/);
  assert.match(CANVAS_RENDER_SOURCE, /data-canvas-link-handle="\$\{side\}"/);
  assert.match(CANVAS_RENDER_SOURCE, /canvas-link-handle-\$\{side\}/);
  assert.match(PARK_BEHAVIOR_FLAT, /function getCanvasSearchContext\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /const directIds = new Set/);
  assert.match(PARK_BEHAVIOR_FLAT, /const relatedIds = new Set/);
  assert.match(CANVAS_RENDER_SOURCE, /classList\.toggle\('search-direct'/);
  assert.match(CANVAS_RENDER_SOURCE, /classList\.toggle\('search-related'/);
  assert.match(WORKBENCH_CSS, /\.canvas-node\.search-related\s*\{[\s\S]*?opacity:\s*0\.58/);
  assert.match(WORKBENCH_CSS, /\.canvas-node\.search-related:hover,[\s\S]*?opacity:\s*1/);
  assert.match(PARK_BEHAVIOR_FLAT, /function wireCanvasLinkHandles\(node\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function beginCanvasConnectionDrag\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_CONNECTION_HIT_WIDTH = 16/);
  // Curve math lives in parkCanvasGeometry.js (v2.29.5+)
  assert.match(CANVAS_GEOM_SOURCE, /function canvasConnectionCurveGeometry\(/);
  assert.match(CANVAS_GEOM_SOURCE, /function canvasCubicBezierTAtLength\(/);
  assert.match(CANVAS_GEOM_SOURCE, /function canvasConnectionCurveSegments\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasConnectionCurveGeometry/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasConnectionCurveSegments/);
  assert.match(CANVAS_RENDER_SOURCE, /const zones = \['source', 'curve', 'target'\]/);
  assert.match(CANVAS_RENDER_SOURCE, /setAttribute\('class', \`canvas-connection-hit \$\{zone\}\`\)/);
  assert.match(CANVAS_RENDER_SOURCE, /stroke-width', String\(getCanvasConnectionHitWidth\(\)\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(CANVAS_RENDER_SOURCE, /function renderCanvasConnectionDraft\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function renderCanvasConnectionDraft\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function commitCanvasConnectionDrag\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /kind === 'curve'/);
  assert.match(PARK_BEHAVIOR_FLAT, /initialCurveOffset/);
  assert.match(PARK_BEHAVIOR_FLAT, /function resetCanvasConnectionCurve\(connectionId\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /state\.curveOffset/);
  assert.match(PARK_BEHAVIOR_FLAT, /function setCanvasConnectionZoneHover\(connectionId, zone, active\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvas-connection-zone-highlight/);
  assert.match(PARK_BEHAVIOR_FLAT, /pointerenter/);
  assert.match(PARK_BEHAVIOR_FLAT, /pointerleave/);
  assert.match(PARK_BEHAVIOR_FLAT, /function detectCanvasConnectionDoublePointerDown\(connectionId, event\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasConnectionPointerDownAt/);
  assert.match(PARK_BEHAVIOR_FLAT, /movingEndpoint/);
  assert.match(PARK_BEHAVIOR_FLAT, /path\.addEventListener\('dblclick'/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasConnectionClickSuppressUntil/);
  const endConnectionSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'endCanvasConnectionDrag');
  assert.match(endConnectionSource, /const shouldSelect = commit && !moved && Boolean\(connectionId\)/);
  assert.match(endConnectionSource, /if \(shouldSelect\) \{[\s\S]*?selectCanvasConnection\(connectionId\)/);
  assert.match(HTML_SOURCE, /data-canvas-selection-connection[^>]*data-i18n="canvasConnectionSelected"/);
  assert.match(HTML_SOURCE, /data-canvas-action="delete-connection"[^>]*data-i18n="canvasDeleteConnection"[^>]*hidden/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasViewportEl\?\.focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(action === 'delete-connection'\) \{[\s\S]*?deleteCanvasConnection\(\);/);
  assert.match(PARK_BEHAVIOR_FLAT, /function deleteCanvasConnection\(connectionId = selectedCanvasConnectionId\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function handleCanvasConnectionNodeClick\(id\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /isMultiSelectModifier\(event\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /!state\.selectionAdditive/);
  assert.match(PARK_BEHAVIOR_FLAT, /window\.addEventListener\('pointermove', updateCanvasConnectionDrag, true\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /window\.addEventListener\('pointercancel', \(event\) => endCanvasConnectionDrag\(event, false\), true\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasConnectionDragState\) cancelCanvasConnectionDrag\(\)/);
  assert.match(WORKBENCH_CSS, /\.canvas-connection-hit\s*\{[\s\S]*?stroke-width:\s*16px/);
  assert.match(WORKBENCH_CSS, /\.canvas-connection-hit\.curve\s*\{[\s\S]*?cursor:\s*grab/);
  assert.match(WORKBENCH_CSS, /\.canvas-connection-zone-highlight\s*\{[\s\S]*?stroke-width:\s*5px/);
  assert.match(WORKBENCH_CSS, /\.canvas-connection-zone-highlight\.is-visible\s*\{[\s\S]*?opacity:\s*0\.9/);
  assert.match(WORKBENCH_CSS, /\.canvas-node:hover \.canvas-link-handle/);
  assert.doesNotMatch(WORKBENCH_CSS, /\.canvas-viewport\.is-link-tool \.canvas-node:hover \.canvas-link-handle/);
  assert.match(HTML_SOURCE, /id="canvasConnections"[^>]*role="group"/);
  assert.match(HTML_SOURCE, /data-i18n-aria="canvasConnectionsLabel"/);
});

test('Canvas display geometry and connection endpoints use the four side handles', () => {
  // Display-scale / default position math lives in parkCanvasGeometry.js (v2.29.5+)
  assert.match(CANVAS_GEOM_SOURCE, /const CANVAS_NODE_DISPLAY_SCALE = 1\.1/);
  assert.match(CANVAS_GEOM_SOURCE, /const CANVAS_DEFAULT_CARD_GAP = 96/);
  assert.match(CANVAS_GEOM_SOURCE, /const CANVAS_NODE_DEFAULT_WIDTH = 220/);
  assert.match(CANVAS_GEOM_SOURCE, /const CANVAS_NODE_DEFAULT_HEIGHT = 170/);
  assert.match(PARK_BEHAVIOR_FLAT, /CANVAS_NODE_DISPLAY_SCALE/);
  assert.match(PARK_BEHAVIOR_FLAT, /CANVAS_DEFAULT_CARD_GAP/);
  assert.match(CANVAS_GEOM_SOURCE, /function canvasDisplayPosition\(position/);
  assert.match(CANVAS_GEOM_SOURCE, /Math\.round\(CANVAS_NODE_DEFAULT_WIDTH \* CANVAS_NODE_DISPLAY_SCALE\) \+ CANVAS_DEFAULT_CARD_GAP/);
  assert.match(CANVAS_GEOM_SOURCE, /Math\.round\(CANVAS_NODE_DEFAULT_HEIGHT \* CANVAS_NODE_DISPLAY_SCALE\) \+ CANVAS_DEFAULT_CARD_GAP/);
  assert.match(CANVAS_GEOM_SOURCE, /function canvasConnectionSideForVector\(dx, dy\)/);
  assert.match(CANVAS_GEOM_SOURCE, /Math\.abs\(dx\) >= Math\.abs\(dy\)/);
  assert.match(CANVAS_RENDER_SOURCE, /function canvasConnectionHandlePoints\(source, target,/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasConnectionHandlePoints\(/);
  assert.match(CANVAS_RENDER_SOURCE, /function canvasConnectionDomHandlePoint\(id, side\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasConnectionDomHandlePoint\(/);
  assert.match(CANVAS_RENDER_SOURCE, /function canvasConnectionHandlePointForId\(id, position, side\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasConnectionHandlePointForId\(/);
  assert.match(CANVAS_RENDER_SOURCE, /const measured = node\?\.isConnected \? canvasNodeWorldRect\(node\) : null/);
  assert.doesNotMatch(PARK_SOURCE, /function canvasConnectionEdgePoints\(/);
  assert.match(CANVAS_RENDER_SOURCE, /canvasConnectionHandlePoints\(source, target, connection\.sourceId, connection\.targetId\)/);
  assert.match(CANVAS_RENDER_SOURCE, /function canvasConnectionHandlePointForCursor\(rect, point/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasConnectionHandlePointForCursor\(/);
  assert.match(CANVAS_RENDER_SOURCE, /const gapX = CanvasGeom\(\)\.CANVAS_DEFAULT_CARD_GAP/);
  assert.match(CANVAS_RENDER_SOURCE, /const gapY = CanvasGeom\(\)\.CANVAS_DEFAULT_CARD_GAP/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handles\s*\{[\s\S]*?z-index:\s*5/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handle\s*\{[\s\S]*?width:\s*24px[\s\S]*?height:\s*24px/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handle svg\s*\{[\s\S]*?width:\s*14px[\s\S]*?height:\s*14px/);
  assert.match(WORKBENCH_CSS, /\.canvas-node:hover \.canvas-link-handle/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handle:hover,[\s\S]*?transform:\s*translate\(-50%, -50%\) scale\(1\.08\)/);
});

test('Canvas search results use a transient grid layout without persisting positions', () => {
  assert.match(PARK_BEHAVIOR_FLAT, /let canvasSearchPreview = null/);
  assert.match(PARK_BEHAVIOR_FLAT, /function isCanvasSearchPreviewActive\(searchContext = getCanvasSearchContext\(\)\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasSearchLayoutFor\(searchContext = getCanvasSearchContext\(\)\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /positions: arrangeCanvasGrid\(searchContext\.items, layout\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(!isCanvasSearchPreviewActive\(searchContext\)\) \{[\s\S]*?canvasSearchPreview = null/);

  const renderSource = CANVAS_RENDER_SOURCE.match(/function renderCanvas\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(renderSource, /const renderLayout = canvasSearchLayoutFor\(searchContext\)/);
  assert.match(renderSource, /renderLayout\.positions\[item\.id\]/);
  assert.match(renderSource, /renderCanvasMinimap\(filtered, renderLayout\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function renderCanvas\(/);

  const arrangeSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'arrangeCanvas');
  assert.match(arrangeSource, /if \(isCanvasSearchPreviewActive\(searchContext\)\)/);
  assert.match(arrangeSource, /canvasSearchPreview\.positions =/);
  const transientArrangeBranch = arrangeSource.split('if (isCanvasSearchPreviewActive(searchContext))')[1]?.split('const items =')[0] || '';
  assert.doesNotMatch(transientArrangeBranch, /commitPositions|flush|sendMessage/);

  const moveSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'canvasMoveSelected');
  assert.match(moveSource, /isCanvasSearchPreviewActive\(searchContext\)/);
  assert.match(moveSource, /moveCanvasSearchPreview\(/);
  const pointerSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'beginCanvasPointer');
  assert.match(pointerSource, /const searchPreview = kind === 'node' && isCanvasSearchPreviewActive\(\)/);
  assert.match(pointerSource, /if \(searchPreview\)[\s\S]*?searchStartPositions/);

  const endPointerSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'endCanvasPointer');
  assert.match(endPointerSource, /const operation = state\.searchPreview\s*\? null/);
  assert.match(endPointerSource, /if \(state\.searchPreview\) finishCanvasSearchPointer\(state, state\.moved\)/);
  const transientEndBranch = endPointerSource.match(/if \(state\.searchPreview\) \{[\s\S]*?return;/)?.[0] || '';
  assert.doesNotMatch(transientEndBranch, /STACK_ITEMS|commitPositions|flush/);
});

test('Canvas zoom uses a layout-scaled inner world and translation-only outer transform', () => {
  assert.match(HTML_SOURCE, /id="canvasWorld" class="canvas-world">[\s\S]*?id="canvasWorldScale" class="canvas-world-scale">[\s\S]*?id="canvasConnections"/);
  const worldCss = HTML_SOURCE.match(/\.canvas-world\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.doesNotMatch(worldCss, /will-change:\s*transform/);
  assert.match(HTML_SOURCE, /\.canvas-world-scale\s*\{[\s\S]*?width:\s*10000px[\s\S]*?height:\s*10000px/);
  const transformSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'updateCanvasTransform');
  assert.match(transformSource, /canvasWorldScaleEl\.style\.zoom = String\(zoom\)/);
  assert.match(transformSource, /canvasWorldEl\.style\.transform = `translate\(\$\{-x \* zoom\}px, \$\{-y \* zoom\}px\)`/);
  assert.doesNotMatch(transformSource, /scale\(/);
  const zoomSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'setCanvasZoom');
  assert.match(zoomSource, /clientX != null && clientY != null/);
  assert.match(zoomSource, /x: rect\.width \/ 2/);
  assert.match(zoomSource, /y: rect\.height \/ 2/);
  assert.match(zoomSource, /x: offset\.x \/ oldZoom \+ state\.layout\.viewport\.x/);
  assert.match(zoomSource, /y: offset\.y \/ oldZoom \+ state\.layout\.viewport\.y/);
});

test('Canvas zoom controls expose a hover slider and accessible fit menu', () => {
  assert.match(HTML_SOURCE, /class="canvas-zoom-value-wrap"[^>]*data-menu-open="false"/);
  assert.match(HTML_SOURCE, /id="canvasZoomSlider"[^>]*type="range"[^>]*min="0\.25"[^>]*max="2"[^>]*step="0\.05"/);
  assert.match(HTML_SOURCE, /id="canvasZoomMenu"[^>]*role="menu"[^>]*hidden/);
  assert.match(HTML_SOURCE, /class="canvas-zoom-value-wrap"[^>]*data-menu-open="false"[^>]*data-pointer-outside="false"/);
  for (const action of ['width', 'screen', 'reset']) {
    assert.match(HTML_SOURCE, new RegExp(`data-canvas-zoom-action="${action}"`));
  }
  assert.match(HTML_SOURCE, /\.canvas-zoom-value-wrap:hover \.canvas-zoom-slider-popover/);
  assert.match(HTML_SOURCE, /\.canvas-zoom-value-wrap:focus-within:not\(\[data-pointer-outside="true"\]\) \.canvas-zoom-slider-popover/);
  assert.match(HTML_SOURCE, /\.canvas-zoom-value-wrap\[data-menu-open="true"\] \.canvas-zoom-slider-popover/);
  assert.match(HTML_SOURCE, /\.canvas-zoom-value-wrap\[data-pointer-outside="true"\] \.canvas-zoom-slider-popover/);
  assert.match(HTML_SOURCE, /\.canvas-zoom-value-wrap::after[\s\S]*?height:\s*11px/);
  assert.match(HTML_SOURCE, /\.canvas-zoom-controls \.canvas-sync-status\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*50%;[\s\S]*?right:\s*calc\(100% \+ 8px\);[\s\S]*?transform:\s*translateY\(-50%\)/);
  const sliderPopoverCss = HTML_SOURCE.match(/\.canvas-zoom-slider-popover\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(sliderPopoverCss, /display:\s*flex/);
  assert.match(sliderPopoverCss, /justify-content:\s*center/);
  assert.match(sliderPopoverCss, /width:\s*44px/);
  const sliderCss = HTML_SOURCE.match(/\.canvas-zoom-slider\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(sliderCss, /writing-mode:\s*vertical-lr/);
  assert.match(sliderCss, /direction:\s*rtl/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasZoomSlider\.addEventListener\('input'/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasZoomValueWrap\?\.addEventListener\('pointerenter'/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasZoomValueWrap\?\.addEventListener\('pointerleave'/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasZoomValue\?\.addEventListener\('click'/);
  assert.match(PARK_BEHAVIOR_FLAT, /function toggleCanvasZoomMenu\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /function closeCanvasZoomMenu\(/);
  assert.match(PARK_BEHAVIOR_FLAT, /function applyCanvasZoomAction\(action\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /document\.addEventListener\('pointerdown', \(event\) => \{[\s\S]*?closeCanvasZoomMenu\(\);/);
});

test('Canvas fit actions use visible card bounds and preserve the viewport schema', () => {
  assert.match(PARK_BEHAVIOR_FLAT, /const CANVAS_FIT_PADDING = 24/);
  assert.match(PARK_BEHAVIOR_FLAT, /function canvasFitViewport\(mode\)/);
  // Bounds math lives in parkCanvasGeometry.js (v2.29.5+)
  assert.match(CANVAS_GEOM_SOURCE, /function canvasBoundsForItems\(items, layout\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /canvasBoundsForItems/);
  assert.match(PARK_BEHAVIOR_FLAT, /const bounds = canvasBoundsForItems\(allTabs, state\.layout \|\| canvasLayout\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /x: \(bounds\.minX \+ bounds\.maxX\) \/ 2 - width \/ \(2 \* zoom\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /y: \(bounds\.minY \+ bounds\.maxY\) \/ 2 - height \/ \(2 \* zoom\)/);
  const boundsSource = CANVAS_GEOM_SOURCE.match(/function canvasBoundsForItems\(items, layout\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(boundsSource, /canvasDisplayPosition\(layout\.positions\?\.\[item\.id\] \|\| canvasDefaultPosition\(index\)\)/);
  const fitSource = extractFnSource(PARK_BEHAVIOR_FLAT, 'canvasFitViewport');
  assert.match(fitSource, /const items = getCanvasVisibleTabs\(\)/);
  assert.match(fitSource, /const widthZoom = availableWidth \/ contentWidth/);
  assert.match(fitSource, /const requestedZoom = mode === 'width' \? widthZoom : Math\.min\(widthZoom, heightZoom\)/);
  assert.match(fitSource, /ensureCanvasStore\(\)\?\.commitViewport\(\{/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(action === 'reset'\) resetCanvasView\(\)/);
  assert.match(PARK_BEHAVIOR_FLAT, /if \(canvasZoomMenu && !canvasZoomMenu\.hidden\)/);
});
