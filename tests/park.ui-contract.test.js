import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const PARK_SOURCE = fs.readFileSync(new URL('../park.js', import.meta.url), 'utf8');
const HTML_SOURCE = fs.readFileSync(new URL('../park.html', import.meta.url), 'utf8');
const STORE_SOURCE = fs.readFileSync(new URL('../canvasStore.js', import.meta.url), 'utf8');
const WORKBENCH_CSS = HTML_SOURCE.split('/* ─── TabWall 2.17.0 Editorial Workbench')[1] || '';

test('Spatial Canvas exposes isolated controls and complete node actions', () => {
  assert.match(HTML_SOURCE, /id="canvasViewport"[^>]*class="canvas-viewport"/);
  for (const id of ['canvasArrangePanel', 'canvasContextBar', 'canvasMinimap', 'canvasZoomOut', 'canvasZoomIn']) {
    assert.match(HTML_SOURCE, new RegExp(`id="${id}"`));
  }
  assert.match(HTML_SOURCE, /data-canvas-arrange="grid"[^>]*data-i18n="canvasArrangeGrid"/);
  assert.match(HTML_SOURCE, /data-canvas-arrange="circle"[^>]*data-i18n="canvasArrangeCircle"/);
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
  assert.match(PARK_SOURCE, /canvasActiveTool === 'pan' \|\| canvasActiveTool === 'select' \|\| canvasSpacePressed[\s\S]*?beginCanvasPointer\(event, 'pan'\)/);
  assert.match(PARK_SOURCE, /classList\.toggle\('is-panning', kind === 'pan'\)/);
  assert.match(PARK_SOURCE, /normalizeCanvasWheelDelta\(event\)/);
  assert.match(PARK_SOURCE, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(PARK_SOURCE, /commitPan\(dx \/ zoom, dy \/ zoom\)/);
  assert.match(PARK_SOURCE, /setCanvasZoom\(zoom, event\.clientX, event\.clientY\)/);
  assert.match(PARK_SOURCE, /const CANVAS_NODE_CLICK_DELAY = 300/);
  assert.match(PARK_SOURCE, /scheduleCanvasNodePreview\(item\)/);
  assert.match(PARK_SOURCE, /event\.detail > 1/);
  assert.match(PARK_SOURCE, /openCanvasGroupLightbox\(current\)/);
  assert.match(PARK_SOURCE, /suppressCanvasNodeClick\(state\.id\)/);
  const pointerControlSource = PARK_SOURCE.match(/function isCanvasControlTarget\(target\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(pointerControlSource, /\.canvas-node-thumb/);
  assert.match(HTML_SOURCE, /\.canvas-viewport\s*\{[\s\S]*?cursor: grab;/);
  assert.match(HTML_SOURCE, /class="canvas-minimap-viewport"/);
  assert.match(HTML_SOURCE, /body\.canvas-mode \.header-primary\s*\{[\s\S]*?background: transparent;/);
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
  assert.match(PARK_SOURCE, /function syncViewModeButton\(mode\)/);
  assert.match(PARK_SOURCE, /viewModeBtn\?\.addEventListener\('click'/);
  assert.match(PARK_SOURCE, /applyI18n\(\);\s*syncViewModeButton\(settings\.viewMode\);/);
  const quickAddCanvasCss = HTML_SOURCE.match(/body\.canvas-mode \.quick-add-main\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(quickAddCanvasCss, /background: var\(--accent-soft\) !important;/);
  assert.match(quickAddCanvasCss, /color: var\(--accent\);/);
  assert.doesNotMatch(quickAddCanvasCss, /color:\s*#fff/);
});

test('Editorial Workbench is desktop-only with low-contrast theme tokens', () => {
  assert.match(PARK_SOURCE, /theme: 'dark'/);
  assert.match(HTML_SOURCE, /<html lang="zh-Hant" data-theme="dark">/);
  assert.match(WORKBENCH_CSS, /--bg: #101110;/);
  assert.match(WORKBENCH_CSS, /html\[data-theme='light'\][\s\S]*?--bg: #f5f1ea;/);
  assert.match(WORKBENCH_CSS, /min-width: 1200px;/);
  assert.doesNotMatch(HTML_SOURCE, /@media\s*\(\s*(?:max|min)-width\s*:/);
  assert.match(WORKBENCH_CSS, /\.app-header\s*\{[\s\S]*?border: 0;/);
  assert.match(WORKBENCH_CSS, /\.canvas-rail\s*\{[\s\S]*?flex: 0 0 188px;[\s\S]*?border: 0;/);
  assert.match(WORKBENCH_CSS, /\.canvas-node\.selected\s*\{[\s\S]*?border-color: var\(--accent\);/);
  const quickAddCss =
    WORKBENCH_CSS.match(/\.btn\.primary\.quick-add-main,[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(quickAddCss, /color: var\(--accent\) !important;/);
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
  assert.match(PARK_SOURCE, /function refreshCanvasMediaQuality\(\)/);
  assert.match(PARK_SOURCE, /const canvasMinimapElements = new Map\(\)/);
  assert.match(PARK_SOURCE, /function arrangeCanvasGrid\(items, layout\)/);
  assert.match(PARK_SOURCE, /function arrangeCanvasCircle\(items, layout\)/);
  assert.match(PARK_SOURCE, /if \(mode === 'grid'\)/);
  assert.match(PARK_SOURCE, /else if \(mode === 'circle'\)/);
  assert.doesNotMatch(PARK_SOURCE.match(/function renderCanvasMinimap\(items\)[\s\S]*?\n\}\n\nfunction canvasNodeRenderKey/)?.[0] || '', /innerHTML/);
  assert.match(PARK_SOURCE, /data-canvas-media="true"/);
  assert.match(HTML_SOURCE, /id="canvasZoomValue">100%<\/span>/);
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
