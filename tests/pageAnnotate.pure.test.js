import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadInk() {
  const src = fs.readFileSync(new URL('../pageAnnotate.js', import.meta.url), 'utf8');
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
    crypto: { randomUUID: () => 'stroke-1' },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'pageAnnotate.js' });
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
