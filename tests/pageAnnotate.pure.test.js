import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const PAGE_ANNOTATE_SOURCE = fs.readFileSync(new URL('../pageAnnotate.js', import.meta.url), 'utf8');

function loadInk() {
  const sandbox = {
    self: null,
    globalThis: null,
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    JSON,
    Date,
    URL,
    crypto: { randomUUID: () => 'stroke-1' },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PAGE_ANNOTATE_SOURCE, sandbox, { filename: 'pageAnnotate.js' });
  return sandbox.TabWallPageInk;
}

test('textBounds prefers stored width and height', () => {
  const Ink = loadInk();
  const box = Ink.textBounds({ x: 10, y: 20, text: 'hi', fontSize: 16, w: 80, h: 22 });
  assert.equal(box.w, 80);
  assert.equal(box.h, 22);
  assert.equal(box.x, 10);
  assert.equal(box.y, 20);
});

test('translateObject moves text, lines, and stroke points', () => {
  const Ink = loadInk();
  const text = Ink.translateObject({ kind: 'text', x: 4, y: 6, text: 'a' }, 10, -2);
  assert.equal(text.x, 14);
  assert.equal(text.y, 4);
  const line = Ink.translateObject({ kind: 'line', x1: 0, y1: 0, x2: 8, y2: 2 }, 1, 1);
  assert.equal(line.x1, 1);
  assert.equal(line.y2, 3);
  const stroke = Ink.translateObject({
    kind: 'stroke',
    points: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
  }, 5, 5);
  assert.equal(stroke.points[1].x, 7);
  assert.equal(stroke.points[1].y, 7);
  const rect = Ink.translateObject({
    kind: 'shape',
    shape: 'rect',
    x1: 0,
    y1: 0,
    x2: 8,
    y2: 2,
  }, 5, 5);
  assert.equal(rect.x2, 13);
  assert.equal(rect.y2, 7);
});

test('undo stack restores the previous snapshot', () => {
  const Ink = loadInk();
  const stack = Ink.createUndoStack(2);
  stack.push(Ink.snapshotObjects([{ id: 'a', kind: 'text', x: 1, y: 1, text: 'one' }]));
  stack.push(Ink.snapshotObjects([{ id: 'b', kind: 'text', x: 2, y: 2, text: 'two' }]));
  const prev = stack.pop();
  assert.equal(prev[0].id, 'b');
  assert.equal(stack.pop()[0].id, 'a');
  assert.equal(stack.pop(), null);
});

test('overlay stays open when session hint says it was visible', () => {
  const Ink = loadInk();
  assert.equal(Ink.resolveOverlayVisible(false, true), true);
  assert.equal(Ink.resolveOverlayVisible(true, false), false);
  assert.equal(Ink.resolveOverlayVisible(true, null), true);
  assert.equal(Ink.resolveOverlayVisible(false, null), false);
});

test('toolbar modes reset to view when collapsed and pen when expanded', () => {
  const Ink = loadInk();
  assert.equal(Ink.toolbarModeForCollapsed(true), 'view');
  assert.equal(Ink.toolbarModeForCollapsed(false), 'pen');
});

test('chrome layout opens away from the nearest horizontal edge', () => {
  const Ink = loadInk();
  const rightEdge = Ink.resolveChromeLayout({
    anchorX: 760,
    anchorY: 300,
    viewportWidth: 800,
    viewportHeight: 600,
    panelWidth: 360,
    panelHeight: 48,
  });
  assert.equal(rightEdge.orientation, 'horizontal');
  assert.equal(rightEdge.side, 'left');
  assert.equal(rightEdge.left, 432);

  const leftEdge = Ink.resolveChromeLayout({
    anchorX: 8,
    anchorY: 300,
    viewportWidth: 800,
    viewportHeight: 600,
    panelWidth: 360,
    panelHeight: 48,
  });
  assert.equal(leftEdge.orientation, 'horizontal');
  assert.equal(leftEdge.side, 'right');
  assert.equal(leftEdge.left, 8);
});

test('chrome layout switches to vertical only when horizontal space is insufficient', () => {
  const Ink = loadInk();
  const narrow = Ink.resolveChromeLayout({
    anchorX: 200,
    anchorY: 300,
    viewportWidth: 420,
    viewportHeight: 600,
    panelWidth: 80,
    horizontalWidth: 560,
    panelHeight: 260,
  });
  assert.equal(narrow.orientation, 'vertical');
  assert.equal(narrow.verticalDirection, 'up');
  assert.equal(narrow.width, 80);

  const top = Ink.resolveChromeLayout({
    anchorX: 500,
    anchorY: 8,
    viewportWidth: 1200,
    viewportHeight: 800,
    panelWidth: 360,
    panelHeight: 260,
  });
  assert.equal(top.orientation, 'horizontal');
  assert.equal(top.verticalDirection, '');

  const bottom = Ink.resolveChromeLayout({
    anchorX: 500,
    anchorY: 752,
    viewportWidth: 1200,
    viewportHeight: 800,
    panelWidth: 360,
    panelHeight: 260,
  });
  assert.equal(bottom.orientation, 'horizontal');
  assert.equal(bottom.verticalDirection, '');
});

test('chrome anchor remains inside the viewport', () => {
  const Ink = loadInk();
  const anchor = Ink.clampChromeAnchor(9999, -50, 800, 600);
  assert.equal(anchor.x, 752);
  assert.equal(anchor.y, 8);
});

test('toolbar contract has one collapsed icon and no collapse control', () => {
  assert.doesNotMatch(PAGE_ANNOTATE_SOURCE, /data-act="collapse"/);
  assert.doesNotMatch(PAGE_ANNOTATE_SOURCE, /TabWall layer|TabWall 圖層/);
  assert.match(PAGE_ANNOTATE_SOURCE, /class="chrome-handle"/);
  assert.match(PAGE_ANNOTATE_SOURCE, /addEventListener\('dblclick', onChromeDoubleClick\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /toolbar\.hidden = !show \|\| barPos\.collapsed/);
  assert.match(PAGE_ANNOTATE_SOURCE, /fab\.hidden = !show \|\| !barPos\.collapsed/);
  assert.match(PAGE_ANNOTATE_SOURCE, /data-act="hide"/);
});

test('collapsed drawing FAB opens on a click but stays draggable', () => {
  const Ink = loadInk();
  assert.equal(Ink.chromePointerUpAction('fab', false, 'pointerup'), 'toggle');
  assert.equal(Ink.chromePointerUpAction('fab', true, 'pointerup'), 'drag');
  assert.equal(Ink.chromePointerUpAction('fab', false, 'pointercancel'), 'drag');
  assert.equal(Ink.chromePointerUpAction('bar', false, 'pointerup'), 'drag');
  assert.match(PAGE_ANNOTATE_SOURCE, /function chromePointerUpAction\(target, moved, eventType = 'pointerup'\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /chromePointerUpAction\(target, moved, event\.type\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /fab\.addEventListener\('pointerup', onBarPointerUp\)/);
  assert.doesNotMatch(PAGE_ANNOTATE_SOURCE, /fab\.addEventListener\('dblclick', onChromeDoubleClick\)/);
});

test('canvas overlay stays transparent and only captures drawing input', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /:host \{ all: initial; background: transparent !important; \}/);
  assert.match(PAGE_ANNOTATE_SOURCE, /background: transparent !important;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /mix-blend-mode: normal;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /pointer-events: none;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /canvas\.style\.pointerEvents = capturing\(\) \? 'auto' : 'none';/);
  assert.match(PAGE_ANNOTATE_SOURCE, /rootEl\.style\.cssText = 'position:fixed;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /window\.addEventListener\('scroll', onWindowScroll, \{ passive: true \}\);/);
  assert.match(PAGE_ANNOTATE_SOURCE, /canvas\.style\.transform = transform/);
});

test('drawing toolbar exposes line, circle, and rectangle tools with compact sizing', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /data-tool="line"/);
  assert.match(PAGE_ANNOTATE_SOURCE, /data-tool="circle"/);
  assert.match(PAGE_ANNOTATE_SOURCE, /data-tool="rect"/);
  assert.match(PAGE_ANNOTATE_SOURCE, /\['pen', 'eraser', 'highlight', 'line', 'circle', 'rect', 'text'\]/);
  assert.match(PAGE_ANNOTATE_SOURCE, /const TOOLBAR_HANDLE_SIZE = 32;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /padding: 4px 6px;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /\.swatch \{ width: 14px; height: 14px;/);
});

test('text editor isolates keyboard events and renders safe Markdown links', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /aria-multiline.*true/);
  assert.match(PAGE_ANNOTATE_SOURCE, /event\.composedPath\(\)\.includes\(textEditor\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /\['keydown', 'keypress', 'keyup'\]/);
  assert.match(PAGE_ANNOTATE_SOURCE, /function onKeyEvent\(event\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /event\.stopPropagation\(\);/);
  assert.match(PAGE_ANNOTATE_SOURCE, /function appendMarkdownBlocks\(parent, source\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /target = '_blank'/);
  assert.match(PAGE_ANNOTATE_SOURCE, /rel = 'noopener noreferrer'/);
  assert.match(PAGE_ANNOTATE_SOURCE, /\.text-render \{/);
});

test('completed text boxes return to View and reopen on double-click', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /function exitTextEditToView\(\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /tool = 'view';\s+closeTextEditor\(\{ save: true \}\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /view\.classList\.toggle\('is-editable', tool === 'view'\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /view\.addEventListener\('dblclick'/);
  assert.match(PAGE_ANNOTATE_SOURCE, /startTextEdit\(obj\);/);
  assert.match(PAGE_ANNOTATE_SOURCE, /hit\.kind === 'text' && event\.detail >= 2 && \(tool === 'pen' \|\| tool === 'text'\)/);
});

test('page ink persistence queues immutable snapshots and flushes after loading', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /let persistChain = Promise\.resolve\(\);/);
  assert.match(PAGE_ANNOTATE_SOURCE, /strokes: snapshotObjects\(objects\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /inkLoaded = Boolean\(ink\?\.ok\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /if \(inkLoaded\) \{\s*schedulePersist\(\);/);
  assert.doesNotMatch(PAGE_ANNOTATE_SOURCE, /persistTimer = window\.setTimeout/);
});

test('selected drawing tool has an explicit high-contrast state', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /button\.setAttribute\('aria-pressed', button\.dataset\.tool === tool \? 'true' : 'false'\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /\.bar \.tools > button\[data-tool\]\[aria-pressed="true"\]/);
  assert.match(PAGE_ANNOTATE_SOURCE, /box-shadow: 0 0 0 2px rgba\(201,120,88,.3\)/);
});

test('default drawing icon anchor is right inset and vertically centered', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /let barPos = \{ x: null, y: null, collapsed: true \};/);
  assert.match(PAGE_ANNOTATE_SOURCE, /const DEFAULT_CHROME_INSET = 24;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /Math\.round\(\(window\.innerHeight - FAB_SIZE\) \/ 2\)/);
});

test('page ink helpers load without a document and do not inject UI', () => {
  const Ink = loadInk();
  assert.equal(typeof Ink.normalizeStroke, 'function');
  assert.equal(Ink.MAX_STROKES, 500);
  assert.equal(Ink.DEFAULT_COLLAPSED, true);
});

test('normalizeStroke downsamples near points and rejects short strokes', () => {
  const Ink = loadInk();
  assert.equal(Ink.normalizeStroke({ points: [{ x: 1, y: 1 }] }), null);
  const stroke = Ink.normalizeStroke({
    tool: 'eraser',
    color: '#2563eb',
    width: 99,
    points: [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 10, y: 10 },
    ],
  });
  assert.equal(stroke.tool, 'eraser');
  assert.equal(stroke.kind, 'stroke');
  assert.equal(stroke.width, 24);
  assert.equal(stroke.points.length, 2);
  assert.equal(stroke.points[1].x, 10);
  assert.equal(stroke.points[1].y, 10);
});

test('legacy strokes stay valid through normalizeObject', () => {
  const Ink = loadInk();
  const obj = Ink.normalizeObject({
    points: [{ x: 0, y: 0 }, { x: 8, y: 2 }],
    color: '#c97858',
    width: 3,
  });
  assert.equal(obj.kind, 'stroke');
  assert.equal(obj.tool, 'pen');
});

test('shape objects normalize and Shift constrains circles to a square', () => {
  const Ink = loadInk();
  const ellipse = Ink.normalizeShape({
    shape: 'circle',
    x1: 10,
    y1: 20,
    x2: 50,
    y2: 80,
    color: '#2563eb',
  });
  assert.equal(ellipse.kind, 'shape');
  assert.equal(ellipse.shape, 'circle');
  assert.equal(Ink.shapeGeometry(ellipse).w, 40);
  assert.equal(Ink.shapeGeometry(ellipse).h, 60);

  const circle = Ink.normalizeShape({
    shape: 'circle',
    x1: 10,
    y1: 20,
    x2: 50,
    y2: 80,
    constrainCircle: true,
  });
  const geometry = Ink.shapeGeometry(circle);
  assert.equal(geometry.w, 60);
  assert.equal(geometry.h, 60);
  assert.equal(geometry.x2, 70);
  assert.equal(geometry.y2, 80);

  const rect = Ink.normalizeShape({ shape: 'rect', x1: 20, y1: 30, x2: 5, y2: 10 });
  assert.equal(rect.shape, 'rect');
  assert.equal(Ink.normalizeShape({ shape: 'rect', x1: 1, y1: 1, x2: 1, y2: 10 }), null);
});

test('transparent shape interiors do not hit-test as the outline', () => {
  const Ink = loadInk();
  const rect = Ink.normalizeShape({ shape: 'rect', x1: 0, y1: 0, x2: 100, y2: 80, width: 4 });
  assert.equal(Ink.hitTestObjects([rect], { x: 50, y: 40 }), null);
  assert.equal(Ink.hitTestObjects([rect], { x: 50, y: 2 }).id, rect.id);
  const ellipse = Ink.normalizeShape({ shape: 'circle', x1: 0, y1: 0, x2: 100, y2: 80, width: 4 });
  assert.equal(Ink.hitTestObjects([ellipse], { x: 50, y: 40 }), null);
  assert.equal(Ink.hitTestObjects([ellipse], { x: 50, y: 2 }).id, ellipse.id);
});

test('canvas scroll transform keeps page coordinates aligned to the viewport', () => {
  const Ink = loadInk();
  assert.equal(Ink.canvasScrollTransform(24, 80), 'translate(-24px, -80px)');
  assert.equal(Ink.canvasScrollTransform('bad', null), 'translate(0px, 0px)');
});

test('page Sticker placement normalizes page CSS pixel bounds', () => {
  const Ink = loadInk();
  assert.deepEqual(JSON.parse(JSON.stringify(Ink.normalizePageStickerPlacement({
    noteId: 'note-a',
    x: -12,
    y: 24.6,
    w: 80,
    h: 900,
    z: 4.4,
  }))), {
    noteId: 'note-a',
    x: 0,
    y: 25,
    w: 160,
    h: 560,
    z: 4,
  });
  assert.equal(Ink.normalizePageStickerPlacement({ x: 1, y: 2 }), null);
  assert.equal(Ink.PAGE_STICKER_MIN_WIDTH, 160);
  assert.equal(Ink.PAGE_STICKER_MAX_HEIGHT, 560);
});

test('page Sticker drag and resize previews clamp without mutating the source', () => {
  const Ink = loadInk();
  const original = { noteId: 'note-1', x: 12, y: 18, w: 240, h: 180, z: 3 };
  const dragged = Ink.pageStickerPlacementForDelta(original, 'drag', -100, 24);
  assert.deepEqual(JSON.parse(JSON.stringify(dragged)), { noteId: 'note-1', x: 0, y: 42, w: 240, h: 180, z: 3 });
  const resized = Ink.pageStickerPlacementForDelta(original, 'resize', 1000, -1000);
  assert.deepEqual(JSON.parse(JSON.stringify(resized)), { noteId: 'note-1', x: 12, y: 18, w: 640, h: 120, z: 3 });
  assert.deepEqual(original, { noteId: 'note-1', x: 12, y: 18, w: 240, h: 180, z: 3 });
});

test('page Sticker collapse state toggles by note ID without mutating the source', () => {
  const Ink = loadInk();
  const initial = ['note-a'];
  const expanded = Ink.pageStickerCollapsedNext(initial, 'note-a');
  assert.deepEqual(Array.from(expanded), []);
  assert.deepEqual(initial, ['note-a']);
  const collapsed = Ink.pageStickerCollapsedNext(expanded, 'note-a');
  assert.deepEqual(Array.from(collapsed), ['note-a']);
  assert.deepEqual(Array.from(Ink.pageStickerCollapsedNext(collapsed, 'note-b')), ['note-a', 'note-b']);
});

test('page Sticker double-click action handles title, captured header, buttons, and body', () => {
  const Ink = loadInk();
  const node = (selectors) => ({ matches: (selector) => selectors.includes(selector) });
  const event = (targetSelectors, pathSelectors) => ({
    target: { closest: (selector) => targetSelectors.includes(selector) ? {} : null },
    composedPath: () => pathSelectors.map((selectors) => node(selectors)),
  });

  assert.equal(Ink.pageStickerDblClickAction(event(['.page-sticker-title'], [['.page-sticker-title'], ['.page-sticker-header']])), 'collapse');
  assert.equal(Ink.pageStickerDblClickAction(event(['.page-sticker-header'], [['.page-sticker-header']])), 'collapse');
  assert.equal(Ink.pageStickerDblClickAction(event(['button'], [['button'], ['.page-sticker-header']])), 'ignore');
  assert.equal(Ink.pageStickerDblClickAction(event(['.page-sticker-body'], [['.page-sticker-body']])), 'edit');
});

test('page Sticker runtime contract uses a tool, lazy sandbox, and one release update', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /data-tool="sticker"/);
  assert.match(PAGE_ANNOTATE_SOURCE, /type: 'GET_PAGE_STICKERS'/);
  assert.match(PAGE_ANNOTATE_SOURCE, /PAGE_STICKER_EDITOR_ORIGIN/);
  assert.match(PAGE_ANNOTATE_SOURCE, /pageStickerEditor\.html/);
  assert.match(PAGE_ANNOTATE_SOURCE, /TABWALL_PAGE_STICKER_EDITOR_INIT/);
  assert.match(PAGE_ANNOTATE_SOURCE, /TABWALL_PAGE_STICKER_EDITOR_SAVED/);
  assert.match(PAGE_ANNOTATE_SOURCE, /tool = 'sticker';\s+syncChrome\(\);/);
  assert.match(PAGE_ANNOTATE_SOURCE, /type: 'UPDATE_PAGE_STICKER'/);
  assert.match(PAGE_ANNOTATE_SOURCE, /sandbox.*allow-scripts/);
  assert.match(PAGE_ANNOTATE_SOURCE, /IntersectionObserver/);
  assert.match(PAGE_ANNOTATE_SOURCE, /setPointerCapture/);
  assert.match(PAGE_ANNOTATE_SOURCE, /requestAnimationFrame/);
  assert.match(PAGE_ANNOTATE_SOURCE, /pointercancel/);
  assert.match(PAGE_ANNOTATE_SOURCE, /is-resizing/);
  assert.match(PAGE_ANNOTATE_SOURCE, /if \(!interaction\.moved\) return/);
});

test('page Sticker title toggles transient collapse without replacing editor entry points', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /function pageStickerEventMatches\(event, selector\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /function pageStickerDblClickAction\(event\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /pageStickerEventMatches\(event, '\.page-sticker-header'\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /const action = pageStickerDblClickAction\(event\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /action === 'collapse'[\s\S]*?togglePageStickerCollapsed\(card, sticker\);[\s\S]*?\}, true\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /card\.classList\.toggle\('is-collapsed', isCollapsed\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /body\.hidden = isCollapsed/);
  assert.match(PAGE_ANNOTATE_SOURCE, /resize\.hidden = isCollapsed/);
  assert.match(PAGE_ANNOTATE_SOURCE, /if \(isCollapsed\) unmountPageStickerFrame\(card\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /stickerObserver\.unobserve\(card\);\s+stickerObserver\.observe\(card\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /title\.setAttribute\('aria-expanded', String\(!isCollapsed\)\)/);
  assert.doesNotMatch(PAGE_ANNOTATE_SOURCE, /title\.addEventListener\('dblclick'/);
  assert.doesNotMatch(PAGE_ANNOTATE_SOURCE, /header\.addEventListener\('dblclick'/);
  assert.match(PAGE_ANNOTATE_SOURCE, /pageStickerCollapsedIds = new Set\(\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /pageStickerCollapseUrl = ''/);
  assert.match(PAGE_ANNOTATE_SOURCE, /requestPageStickerEditor\(sticker\.noteId, sticker\)/);
  assert.match(PAGE_ANNOTATE_SOURCE, /card\.addEventListener\('dblclick'/);
  assert.match(PAGE_ANNOTATE_SOURCE, /\.page-sticker-card\.is-collapsed[\s\S]*?height: auto !important/);
  assert.match(PAGE_ANNOTATE_SOURCE, /\.page-sticker-card\.is-collapsed \.page-sticker-body,[\s\S]*?display: none/);
});

test('highlight lines snap near-horizontal and keep steep diagonals', () => {
  const Ink = loadInk();
  const snapped = Ink.snapHighlightLine(10, 40, 200, 42);
  assert.equal(snapped.y1, 40);
  assert.equal(snapped.y2, 40);
  const diagonal = Ink.snapHighlightLine(0, 0, 80, 80);
  assert.equal(diagonal.y2, 80);
  const line = Ink.normalizeLine({
    x1: 10,
    y1: 40,
    x2: 200,
    y2: 41,
    color: '#eab308',
  });
  assert.equal(line.kind, 'line');
  assert.equal(line.tool, 'highlight');
  assert.equal(line.y2, 40);
});

test('text objects require content and clip length', () => {
  const Ink = loadInk();
  assert.equal(Ink.normalizeText({ x: 1, y: 2, text: '   ' }), null);
  const text = Ink.normalizeText({
    x: 12,
    y: 24,
    text: `ok\u0000${'x'.repeat(3000)}`,
    color: '#1f2937',
  });
  assert.equal(text.kind, 'text');
  assert.equal(text.text.length, Ink.MAX_TEXT_LENGTH);
  assert.equal(text.text.startsWith('ok'), true);
});

test('text objects preserve multiline Markdown source and only allow web links', () => {
  const Ink = loadInk();
  const source = '# Title\n\n**bold** [open](https://example.com)';
  const text = Ink.normalizeText({ x: 12, y: 24, text: source, fontSize: 16 });
  assert.equal(text.text, source);
  assert.equal(text.h >= 16 * 1.3 * 3, true);
  assert.match(Ink.safeMarkdownUrl('https://example.com/path'), /^https:\/\/example\.com\/path$/);
  assert.equal(Ink.safeMarkdownUrl('javascript:alert(1)'), '');
});

test('hit-test prefers the topmost nearby object', () => {
  const Ink = loadInk();
  const line = Ink.normalizeLine({ x1: 0, y1: 10, x2: 100, y2: 10, width: 16 });
  const text = Ink.normalizeText({ x: 40, y: 4, text: 'hi', fontSize: 16 });
  const miss = Ink.hitTestObjects([line, text], { x: 200, y: 200 });
  assert.equal(miss, null);
  const hitText = Ink.hitTestObjects([line, text], { x: 45, y: 8 });
  assert.equal(hitText.kind, 'text');
  const hitLine = Ink.hitTestObjects([line], { x: 50, y: 12 });
  assert.equal(hitLine.kind, 'line');
});

test('normalizeStrokes caps count and drops invalid entries', () => {
  const Ink = loadInk();
  const many = Array.from({ length: 520 }, (_, i) => ({
    points: [{ x: i, y: 0 }, { x: i + 4, y: 4 }],
  }));
  const normalized = Ink.normalizeObjects(many);
  assert.equal(normalized.length, 500);
  assert.equal(Ink.normalizeObjects([null, { points: [] }]).length, 0);
});
