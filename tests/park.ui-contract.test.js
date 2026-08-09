import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const PARK_SOURCE = fs.readFileSync(new URL('../park.js', import.meta.url), 'utf8');
const HTML_SOURCE = fs.readFileSync(new URL('../park.html', import.meta.url), 'utf8');
const STORE_SOURCE = fs.readFileSync(new URL('../canvasStore.js', import.meta.url), 'utf8');
const WORKBENCH_CSS = HTML_SOURCE.split('/* ─── TabWall 2.17.0 Editorial Workbench')[1] || '';

test('Spatial Canvas exposes isolated controls and complete node actions', () => {
  assert.match(HTML_SOURCE, /id="canvasViewport"[^>]*class="canvas-viewport"/);
  for (const id of ['canvasContextBar', 'canvasMinimap', 'canvasZoomControls', 'canvasZoomValue', 'canvasZoomSlider', 'canvasZoomMenu', 'canvasZoomOut', 'canvasZoomIn', 'canvasConnections', 'canvasMinimapViewport']) {
    assert.match(HTML_SOURCE, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(HTML_SOURCE, /canvasArrangePanel|canvasArrangeBtn|canvasSnapToggle/);
  assert.match(HTML_SOURCE, /data-settings-arrange="grid"[^>]*data-i18n="canvasArrangeGrid"/);
  assert.match(HTML_SOURCE, /data-settings-arrange="align"[^>]*data-i18n="canvasArrangeAlign"/);
  assert.match(HTML_SOURCE, /id="sortBy"/);
  assert.match(HTML_SOURCE, /value="newest"/);
  assert.match(HTML_SOURCE, /value="domain"/);
  assert.match(HTML_SOURCE, /value="group-first"/);
  assert.doesNotMatch(HTML_SOURCE, /value="oldest"|value="title-desc"|value="manual"|canvasArrangeCircle/);
  assert.match(HTML_SOURCE, /id="canvasLinkBtn"[^>]*data-canvas-tool="link"/);
  assert.match(HTML_SOURCE, /id="lbGroupMosaic" class="lb-group-mosaic"/);
  for (const action of ['restore', 'snapshot', 'edit', 'copy', 'members', 'pin', 'delete']) {
    assert.match(PARK_SOURCE, new RegExp(`\\['${action}',`));
  }
  assert.match(PARK_SOURCE, /function isCanvasControlTarget\(target\)/);
  assert.match(PARK_SOURCE, /function isCanvasWheelControlTarget\(target\)/);
  assert.match(PARK_SOURCE, /if \(isCanvasControlTarget\(event\.target\)\) return;/);
  assert.match(PARK_SOURCE, /node\.focus\(\{ preventScroll: true \}\)/);
  assert.match(PARK_SOURCE, /getBoundingClientRect\(\)/);
  assert.match(PARK_SOURCE, /canvasActiveTool === 'area'[\s\S]*?beginCanvasPointer\(event, 'lasso'\)/);
  assert.match(PARK_SOURCE, /canvasActiveTool === 'select' \|\| canvasSpacePressed[\s\S]*?beginCanvasPointer\(event, 'pan'\)/);
  assert.doesNotMatch(PARK_SOURCE, /canvasActiveTool === 'pan'/);
  assert.doesNotMatch(HTML_SOURCE, /data-canvas-tool="pan"/);
  assert.match(PARK_SOURCE, /classList\.toggle\('is-panning', kind === 'pan'\)/);
  assert.match(PARK_SOURCE, /normalizeCanvasWheelDelta\(event\)/);
  assert.match(PARK_SOURCE, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(PARK_SOURCE, /commitPan\(dx \/ zoom, dy \/ zoom\)/);
  assert.match(PARK_SOURCE, /scheduleCanvasWheelZoom\(event, dy\)/);
  assert.match(PARK_SOURCE, /CANVAS_TRACKPAD_ZOOM_SENSITIVITY = 0\.006/);
  assert.match(PARK_SOURCE, /flushCanvasWheelZoom\(\)/);
  assert.match(PARK_SOURCE, /const CANVAS_NODE_CLICK_DELAY = 300/);
  assert.match(PARK_SOURCE, /scheduleCanvasNodePreview\(item\)/);
  assert.match(PARK_SOURCE, /event\.detail > 1/);
  assert.match(PARK_SOURCE, /openCanvasGroupLightbox\(current\)/);
  assert.match(PARK_SOURCE, /suppressCanvasNodeClick\(state\.id\)/);
  const pointerControlSource = PARK_SOURCE.match(/function isCanvasControlTarget\(target\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(pointerControlSource, /\.canvas-node-thumb/);
  assert.match(HTML_SOURCE, /\.canvas-viewport\s*\{[\s\S]*?cursor: grab;/);
  assert.doesNotMatch(WORKBENCH_CSS, /\.canvas-viewport:focus-visible\s*\{[\s\S]*?box-shadow/);
  assert.match(HTML_SOURCE, /class="canvas-minimap-viewport"/);
  assert.doesNotMatch(HTML_SOURCE, /id="canvasMinimap"[^>]*aria-hidden="true"/);
  assert.match(PARK_SOURCE, /function renderCanvasConnections()/);
  assert.match(PARK_SOURCE, /function handleCanvasConnectionNodeClick\(id\)/);
  assert.match(PARK_SOURCE, /if \(event\.button === 0 && !node && \(selectedCanvasConnectionId \|\| canvasConnectionSourceId\)\) \{[\s\S]*?clearCanvasConnectionSelection\(\)/);
  assert.match(PARK_SOURCE, /canvasActiveTool === 'link'/);
  assert.match(HTML_SOURCE, /body\.canvas-mode \.header-primary\s*\{[\s\S]*?background: transparent;/);
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
  assert.match(PARK_SOURCE, /function armCanvasNotePlacement\(\)/);
  assert.match(PARK_SOURCE, /function placeStickerNoteAt\(point\)/);
  assert.match(PARK_SOURCE, /type: 'CREATE_NOTE'/);
  assert.match(PARK_SOURCE, /type: 'UPDATE_NOTE'/);
  assert.match(PARK_SOURCE, /type: 'DELETE_NOTE'/);
  assert.match(PARK_SOURCE, /Build\.renderSafeMarkdown/);
  assert.match(PARK_SOURCE, /attachment:\/\//);
  assert.match(PARK_SOURCE, /stickerNoteFile\.files/);
  assert.match(PARK_SOURCE, /event\.clipboardData\?\.items/);
  assert.match(PARK_SOURCE, /stickerNoteDrop\?\.addEventListener\('drop'/);
  assert.match(HTML_SOURCE, /<script src="noteMedia\.js"><\/script>/);
  assert.match(PARK_SOURCE, /const NoteMedia = self\.TabWallNoteMedia/);
  assert.match(PARK_SOURCE, /await NoteMedia\.normalizeBlob\(file\)/);
  assert.match(PARK_SOURCE, /type: 'GET_ATTACHMENT_USAGE'/);
  assert.match(PARK_SOURCE, /const ATTACHMENT_URL_CACHE_MAX = 8/);
  assert.match(PARK_SOURCE, /function observeStickerAttachment\(img\)/);
  assert.match(PARK_SOURCE, /function pruneAttachmentUrlCache\(items = allTabs\)/);
  assert.match(PARK_SOURCE, /stickerNoteMediaBusy/);
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
  assert.match(PARK_SOURCE, /function syncViewModeButton\(mode\)/);
  assert.match(PARK_SOURCE, /viewModeBtn\?\.addEventListener\('click'/);
  assert.match(PARK_SOURCE, /applyI18n\(\);\s*syncViewModeButton\(settings\.viewMode\);/);
  assert.match(HTML_SOURCE, /class="btn quick-add-main" id="quickAddBtn"/);
  assert.match(HTML_SOURCE, /class="btn quick-add-menu-btn" id="quickAddMenuBtn"/);
  assert.doesNotMatch(HTML_SOURCE, /class="btn primary quick-add-main"/);
  assert.doesNotMatch(HTML_SOURCE, /class="btn primary quick-add-menu-btn"/);
  assert.match(PARK_SOURCE, /function resetCanvasView\(\)/);
  assert.match(PARK_SOURCE, /function setCanvasActiveTool\(nextTool\)/);
  assert.match(PARK_SOURCE, /event\.button !== 0 \|\| isCanvasControlTarget\(event\.target\)/);
  assert.match(PARK_SOURCE, /if \(id\) \{[\s\S]*?restoreItem\(id\);[\s\S]*?\} else \{[\s\S]*?setCanvasActiveTool\(canvasActiveTool === 'area' \? 'select' : 'area'\)/);
  assert.match(PARK_SOURCE, /canvasActiveTool = nextTool === 'area' \|\| nextTool === 'link' \|\| nextTool === 'note'/);
  assert.match(PARK_SOURCE, /function handleCanvasMiddleClick\(event\)/);
  assert.match(PARK_SOURCE, /const CANVAS_MIDDLE_CLICK_DELAY = 300/);
  assert.match(PARK_SOURCE, /event\.button === 1[\s\S]*?handleCanvasMiddleClick\(event\)/);
  assert.match(PARK_SOURCE, /document\.getElementById\('canvasResetView'\)\?\.addEventListener\('click', resetCanvasView\)/);
  assert.match(PARK_SOURCE, /function focusCanvasItem\(id\)/);
  assert.match(PARK_SOURCE, /setCanvasIndexFilter\(`stack:\$\{id\}`, id\)/);
  assert.match(PARK_SOURCE, /focusCanvasItem\(focusId\)/);
  assert.doesNotMatch(PARK_SOURCE, /canvasArrangePanel|canvasArrangeBtn|canvasSnapToggle/);
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
  assert.match(PARK_SOURCE, /const CANVAS_RAIL_DEFAULT_WIDTH = 188/);
  assert.match(PARK_SOURCE, /const CANVAS_RAIL_MIN_WIDTH = 168/);
  assert.match(PARK_SOURCE, /const CANVAS_RAIL_MAX_WIDTH = 360/);
  assert.match(PARK_SOURCE, /const CANVAS_RAIL_COLLAPSE_THRESHOLD = 120/);
  assert.match(PARK_SOURCE, /const CANVAS_RAIL_COLLAPSED_WIDTH = 34/);
  assert.match(PARK_SOURCE, /document\.body\?\.style\.setProperty\('--canvas-version-left', `\$\{visibleWidth \+ 16\}px`\)/);
  assert.match(HTML_SOURCE, /body\.canvas-mode #versionBadge\s*\{[\s\S]*?left:\s*var\(--canvas-version-left, 16px\)/);
  assert.match(PARK_SOURCE, /function normalizeCanvasRailSettings\(target\)/);
  assert.match(PARK_SOURCE, /function applyCanvasRailUi\(/);
  assert.match(PARK_SOURCE, /function initCanvasRailResize\(\)/);
  assert.match(PARK_SOURCE, /canvasRailResize\.addEventListener\('pointerdown'/);
  assert.match(PARK_SOURCE, /canvasRailResize\.addEventListener\('keydown'/);
  assert.match(PARK_SOURCE, /function scheduleCanvasRailResizePreview\(\)/);
  assert.match(PARK_SOURCE, /function flushCanvasRailResizePreview\(\)/);
  assert.match(PARK_SOURCE, /canvasRailWidth: collapsed \? normalizeCanvasRailWidth\(state\.startWidth\)/);
  assert.match(PARK_SOURCE, /window\.addEventListener\('pointermove', updateCanvasRailResize, true\)/);
  assert.match(PARK_SOURCE, /event\.isPrimary/);
  assert.match(PARK_SOURCE, /saveSettings\(next\)/);
  assert.match(PARK_SOURCE, /event\.key !== 'ArrowLeft' && event\.key !== 'ArrowRight'/);
  assert.match(PARK_SOURCE, /event\.key === 'Home'/);
  assert.match(PARK_SOURCE, /event\.key === 'End'/);
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
  assert.match(PARK_SOURCE, /theme: 'dark'/);
  assert.match(HTML_SOURCE, /<html lang="zh-Hant" data-theme="dark">/);
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

test('Spatial Canvas state and settings use shared persistence contracts', () => {
  assert.match(PARK_SOURCE, /function canvasLayoutSnapshot\(\)/);
  assert.match(PARK_SOURCE, /type: 'PATCH_CANVAS_LAYOUT',[\s\S]*?baseRevision/);
  assert.match(PARK_SOURCE, /getCanvasVisibleTabs\(\)\.length/);
  assert.match(PARK_SOURCE, /saveSettings\(\{ canvasSnap: canvasSnapToGrid \}\)/);
  assert.match(PARK_SOURCE, /DEFAULT_CANVAS_VIEWPORT = Object\.freeze\(\{ x: 0, y: 0, zoom: 1 \}\)/);
  assert.match(PARK_SOURCE, /function canvasPreferredMediaKind\(\)/);
  assert.match(PARK_SOURCE, /return canvasLayout\.viewport\.zoom > 1 \? 'snap' : 'thumb'/);
  assert.match(PARK_SOURCE, /const mediaFetches = new Map\(\)/);
  assert.match(PARK_SOURCE, /function getCanvasMediaObserver\(\)/);
  assert.match(PARK_SOURCE, /root: canvasViewportEl/);
  assert.match(PARK_SOURCE, /function probeCanvasMediaUrl\(url\)/);
  assert.match(PARK_SOURCE, /canvasPendingMediaUrls/);
  assert.match(PARK_SOURCE, /function loadCanvasThumbFallback\(img\)/);
  assert.match(PARK_SOURCE, /data-canvas-has-snap/);
  assert.match(PARK_SOURCE, /function refreshCanvasMediaQuality\(\)/);
  assert.match(PARK_SOURCE, /const canvasMinimapElements = new Map\(\)/);
  assert.match(PARK_SOURCE, /function arrangeCanvasGrid\(items, layout\)/);
  assert.match(PARK_SOURCE, /function arrangeCanvasAlign\(items, layout\)/);
  assert.match(PARK_SOURCE, /mode === 'grid'/);
  assert.match(PARK_SOURCE, /function arrangeCanvasAlign\(items, layout\)/);
  assert.match(PARK_SOURCE, /function normalizeSortBy\(value\)/);
  assert.match(PARK_SOURCE, /sortByEl\?\.addEventListener/);
  assert.match(PARK_SOURCE, /data-settings-arrange/);
  assert.match(PARK_SOURCE, /function beginCanvasMinimapDrag\(event\)/);
  assert.match(PARK_SOURCE, /function updateCanvasMinimapDrag\(event\)/);
  assert.match(PARK_SOURCE, /previewPointer\(\{ dx, dy, moved:/);
  assert.match(PARK_SOURCE, /finishPointer\(\{ commit \}\)/);
  assert.match(PARK_SOURCE, /canvasMinimapProjection/);
  assert.doesNotMatch(PARK_SOURCE.match(/function renderCanvasMinimap\(items\)[\s\S]*?\n\}\n\nfunction canvasNodeRenderKey/)?.[0] || '', /innerHTML/);
  assert.match(PARK_SOURCE, /data-canvas-media="true"/);
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

test('Spatial Canvas uses the single store and keyed interaction lifecycle', () => {
  assert.match(HTML_SOURCE, /<script src="canvasStore\.js"><\/script>/);
  assert.match(STORE_SOURCE, /function createCanvasStore\(options = \{\}\)/);
  assert.match(STORE_SOURCE, /function normalizeConnections\(rawConnections/);
  assert.match(STORE_SOURCE, /op.type === 'setConnections'/);
  assert.match(STORE_SOURCE, /function commitConnections\(connections\)/);
  assert.match(PARK_SOURCE, /const canvasNodeElements = new Map\(\)/);
  assert.match(PARK_SOURCE, /canvasNodeElements\.get\(item\.id\)/);
  assert.doesNotMatch(PARK_SOURCE.match(/function renderCanvas\(\)[\s\S]*?\n\}\n\nfunction updateCanvasArrangeState/)?.[0] || '', /canvasNodesEl\.innerHTML\s*=\s*''/);
  assert.match(PARK_SOURCE, /requestAnimationFrame/);
  assert.match(PARK_SOURCE, /lostpointercapture/);
  assert.match(PARK_SOURCE, /visibilitychange/);
  assert.match(PARK_SOURCE, /canvasLoadGeneration/);
  assert.match(PARK_SOURCE, /applyRemote\(layout, revision\)/);
  assert.match(PARK_SOURCE, /preferred === 'snap'/);
});

test('Canvas search relations and connection gestures have a stable UI contract', () => {
  assert.match(PARK_SOURCE, /\['top', 'canvasLinkHandleTop'\]/);
  assert.match(PARK_SOURCE, /\['right', 'canvasLinkHandleRight'\]/);
  assert.match(PARK_SOURCE, /\['bottom', 'canvasLinkHandleBottom'\]/);
  assert.match(PARK_SOURCE, /\['left', 'canvasLinkHandleLeft'\]/);
  assert.match(PARK_SOURCE, /data-canvas-link-handle="\$\{side\}"/);
  assert.match(PARK_SOURCE, /canvas-link-handle-\$\{side\}/);
  assert.match(PARK_SOURCE, /function getCanvasSearchContext\(\)/);
  assert.match(PARK_SOURCE, /const directIds = new Set/);
  assert.match(PARK_SOURCE, /const relatedIds = new Set/);
  assert.match(PARK_SOURCE, /classList\.toggle\('search-direct'/);
  assert.match(PARK_SOURCE, /classList\.toggle\('search-related'/);
  assert.match(WORKBENCH_CSS, /\.canvas-node\.search-related\s*\{[\s\S]*?opacity:\s*0\.58/);
  assert.match(WORKBENCH_CSS, /\.canvas-node\.search-related:hover,[\s\S]*?opacity:\s*1/);
  assert.match(PARK_SOURCE, /function wireCanvasLinkHandles\(node\)/);
  assert.match(PARK_SOURCE, /function beginCanvasConnectionDrag\(/);
  assert.match(PARK_SOURCE, /const CANVAS_CONNECTION_HIT_WIDTH = 16/);
  assert.match(PARK_SOURCE, /function canvasConnectionCurveGeometry\(/);
  assert.match(PARK_SOURCE, /function canvasCubicBezierTAtLength\(/);
  assert.match(PARK_SOURCE, /function canvasConnectionCurveSegments\(/);
  assert.match(PARK_SOURCE, /const zones = \['source', 'curve', 'target'\]/);
  assert.match(PARK_SOURCE, /setAttribute\('class', \`canvas-connection-hit \$\{zone\}\`\)/);
  assert.match(PARK_SOURCE, /stroke-width', String\(CANVAS_CONNECTION_HIT_WIDTH\)/);
  assert.match(PARK_SOURCE, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(PARK_SOURCE, /function renderCanvasConnectionDraft\(\)/);
  assert.match(PARK_SOURCE, /function commitCanvasConnectionDrag\(\)/);
  assert.match(PARK_SOURCE, /kind === 'curve'/);
  assert.match(PARK_SOURCE, /initialCurveOffset/);
  assert.match(PARK_SOURCE, /function resetCanvasConnectionCurve\(connectionId\)/);
  assert.match(PARK_SOURCE, /state\.curveOffset/);
  assert.match(PARK_SOURCE, /function setCanvasConnectionZoneHover\(connectionId, zone, active\)/);
  assert.match(PARK_SOURCE, /canvas-connection-zone-highlight/);
  assert.match(PARK_SOURCE, /pointerenter/);
  assert.match(PARK_SOURCE, /pointerleave/);
  assert.match(PARK_SOURCE, /function detectCanvasConnectionDoublePointerDown\(connectionId, event\)/);
  assert.match(PARK_SOURCE, /canvasConnectionPointerDownAt/);
  assert.match(PARK_SOURCE, /movingEndpoint/);
  assert.match(PARK_SOURCE, /path\.addEventListener\('dblclick'/);
  assert.match(PARK_SOURCE, /canvasConnectionClickSuppressUntil/);
  const endConnectionSource = PARK_SOURCE.match(/function endCanvasConnectionDrag\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(endConnectionSource, /const shouldSelect = commit && !moved && Boolean\(connectionId\)/);
  assert.match(endConnectionSource, /if \(shouldSelect\) \{[\s\S]*?selectCanvasConnection\(connectionId\)/);
  assert.match(HTML_SOURCE, /data-canvas-selection-connection[^>]*data-i18n="canvasConnectionSelected"/);
  assert.match(HTML_SOURCE, /data-canvas-action="delete-connection"[^>]*data-i18n="canvasDeleteConnection"[^>]*hidden/);
  assert.match(PARK_SOURCE, /canvasViewportEl\?\.focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(PARK_SOURCE, /if \(action === 'delete-connection'\) \{[\s\S]*?deleteCanvasConnection\(\);/);
  assert.match(PARK_SOURCE, /function deleteCanvasConnection\(connectionId = selectedCanvasConnectionId\)/);
  assert.match(PARK_SOURCE, /function handleCanvasConnectionNodeClick\(id\)/);
  assert.match(PARK_SOURCE, /isMultiSelectModifier\(event\)/);
  assert.match(PARK_SOURCE, /!state\.selectionAdditive/);
  assert.match(PARK_SOURCE, /window\.addEventListener\('pointermove', updateCanvasConnectionDrag, true\)/);
  assert.match(PARK_SOURCE, /window\.addEventListener\('pointercancel', \(event\) => endCanvasConnectionDrag\(event, false\), true\)/);
  assert.match(PARK_SOURCE, /canvasConnectionDragState\) cancelCanvasConnectionDrag\(\)/);
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
  assert.match(PARK_SOURCE, /const CANVAS_NODE_DISPLAY_SCALE = 1\.1/);
  assert.match(PARK_SOURCE, /const CANVAS_DEFAULT_CARD_GAP = 96/);
  assert.match(PARK_SOURCE, /const CANVAS_NODE_DEFAULT_WIDTH = 220/);
  assert.match(PARK_SOURCE, /const CANVAS_NODE_DEFAULT_HEIGHT = 170/);
  assert.match(PARK_SOURCE, /function canvasDisplayPosition\(position/);
  assert.match(PARK_SOURCE, /Math\.round\(CANVAS_NODE_DEFAULT_WIDTH \* CANVAS_NODE_DISPLAY_SCALE\) \+ CANVAS_DEFAULT_CARD_GAP/);
  assert.match(PARK_SOURCE, /Math\.round\(CANVAS_NODE_DEFAULT_HEIGHT \* CANVAS_NODE_DISPLAY_SCALE\) \+ CANVAS_DEFAULT_CARD_GAP/);
  assert.match(PARK_SOURCE, /function canvasConnectionSideForVector\(dx, dy\)/);
  assert.match(PARK_SOURCE, /Math\.abs\(dx\) >= Math\.abs\(dy\)/);
  assert.match(PARK_SOURCE, /function canvasConnectionHandlePoints\(source, target,/);
  assert.match(PARK_SOURCE, /function canvasConnectionDomHandlePoint\(id, side\)/);
  assert.match(PARK_SOURCE, /function canvasConnectionHandlePointForId\(id, position, side\)/);
  assert.match(PARK_SOURCE, /const measured = node\?\.isConnected \? canvasNodeWorldRect\(node\) : null/);
  assert.doesNotMatch(PARK_SOURCE, /function canvasConnectionEdgePoints\(/);
  assert.match(PARK_SOURCE, /canvasConnectionHandlePoints\(source, target, connection\.sourceId, connection\.targetId\)/);
  assert.match(PARK_SOURCE, /function canvasConnectionHandlePointForCursor\(rect, point/);
  assert.match(PARK_SOURCE, /const gapX = CANVAS_DEFAULT_CARD_GAP/);
  assert.match(PARK_SOURCE, /const gapY = CANVAS_DEFAULT_CARD_GAP/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handles\s*\{[\s\S]*?z-index:\s*5/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handle\s*\{[\s\S]*?width:\s*24px[\s\S]*?height:\s*24px/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handle svg\s*\{[\s\S]*?width:\s*14px[\s\S]*?height:\s*14px/);
  assert.match(WORKBENCH_CSS, /\.canvas-node:hover \.canvas-link-handle/);
  assert.match(WORKBENCH_CSS, /\.canvas-link-handle:hover,[\s\S]*?transform:\s*translate\(-50%, -50%\) scale\(1\.08\)/);
});

test('Canvas zoom uses a layout-scaled inner world and translation-only outer transform', () => {
  assert.match(HTML_SOURCE, /id="canvasWorld" class="canvas-world">[\s\S]*?id="canvasWorldScale" class="canvas-world-scale">[\s\S]*?id="canvasConnections"/);
  const worldCss = HTML_SOURCE.match(/\.canvas-world\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.doesNotMatch(worldCss, /will-change:\s*transform/);
  assert.match(HTML_SOURCE, /\.canvas-world-scale\s*\{[\s\S]*?width:\s*10000px[\s\S]*?height:\s*10000px/);
  const transformSource = PARK_SOURCE.match(/function updateCanvasTransform\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(transformSource, /canvasWorldScaleEl\.style\.zoom = String\(zoom\)/);
  assert.match(transformSource, /canvasWorldEl\.style\.transform = `translate\(\$\{-x \* zoom\}px, \$\{-y \* zoom\}px\)`/);
  assert.doesNotMatch(transformSource, /scale\(/);
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
  assert.match(PARK_SOURCE, /canvasZoomSlider\.addEventListener\('input'/);
  assert.match(PARK_SOURCE, /canvasZoomValueWrap\?\.addEventListener\('pointerenter'/);
  assert.match(PARK_SOURCE, /canvasZoomValueWrap\?\.addEventListener\('pointerleave'/);
  assert.match(PARK_SOURCE, /canvasZoomValue\?\.addEventListener\('click'/);
  assert.match(PARK_SOURCE, /function toggleCanvasZoomMenu\(\)/);
  assert.match(PARK_SOURCE, /function closeCanvasZoomMenu\(/);
  assert.match(PARK_SOURCE, /function applyCanvasZoomAction\(action\)/);
  assert.match(PARK_SOURCE, /document\.addEventListener\('pointerdown', \(event\) => \{[\s\S]*?closeCanvasZoomMenu\(\);/);
});

test('Canvas fit actions use visible card bounds and preserve the viewport schema', () => {
  assert.match(PARK_SOURCE, /const CANVAS_FIT_PADDING = 24/);
  assert.match(PARK_SOURCE, /function canvasFitViewport\(mode\)/);
  assert.match(PARK_SOURCE, /function canvasBoundsForItems\(items, layout\)/);
  assert.match(PARK_SOURCE, /const bounds = canvasBoundsForItems\(allTabs, state\.layout \|\| canvasLayout\)/);
  assert.match(PARK_SOURCE, /x: \(bounds\.minX \+ bounds\.maxX\) \/ 2 - width \/ \(2 \* zoom\)/);
  assert.match(PARK_SOURCE, /y: \(bounds\.minY \+ bounds\.maxY\) \/ 2 - height \/ \(2 \* zoom\)/);
  const boundsSource = PARK_SOURCE.match(/function canvasBoundsForItems\(items, layout\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(boundsSource, /canvasDisplayPosition\(layout\.positions\?\.\[item\.id\] \|\| canvasDefaultPosition\(index\)\)/);
  const fitSource = PARK_SOURCE.match(/function canvasFitViewport\(mode\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fitSource, /const items = getCanvasVisibleTabs\(\)/);
  assert.match(fitSource, /const widthZoom = availableWidth \/ contentWidth/);
  assert.match(fitSource, /const requestedZoom = mode === 'width' \? widthZoom : Math\.min\(widthZoom, heightZoom\)/);
  assert.match(fitSource, /ensureCanvasStore\(\)\?\.commitViewport\(\{/);
  assert.match(PARK_SOURCE, /if \(action === 'reset'\) resetCanvasView\(\)/);
  assert.match(PARK_SOURCE, /if \(canvasZoomMenu && !canvasZoomMenu\.hidden\)/);
});
