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

test('canvas overlay stays transparent and only captures drawing input', () => {
  assert.match(PAGE_ANNOTATE_SOURCE, /:host \{ all: initial; background: transparent !important; \}/);
  assert.match(PAGE_ANNOTATE_SOURCE, /background: transparent !important;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /mix-blend-mode: normal;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /pointer-events: none;/);
  assert.match(PAGE_ANNOTATE_SOURCE, /canvas\.style\.pointerEvents = capturing\(\) \? 'auto' : 'none';/);
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
