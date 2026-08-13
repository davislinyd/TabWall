import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadGeom() {
  const src = fs.readFileSync(new URL('../parkCanvasGeometry.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    console,
    Math,
    Number,
    Object,
    Array,
    String,
    Boolean,
    JSON,
    isFinite,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'parkCanvasGeometry.js' });
  return sandbox.TabWallCanvasGeometry;
}

test('canvasBoundsForItems: empty vs single card', () => {
  const G = loadGeom();
  assert.equal(G.canvasBoundsForItems([], { positions: {} }), null);
  const item = { id: 'a' };
  const layout = { positions: { a: { x: 10, y: 20, w: 100, h: 50, z: 0 } } };
  const b = G.canvasBoundsForItems([item], layout);
  assert.ok(b);
  assert.ok(Number.isFinite(b.minX) && Number.isFinite(b.maxX));
  assert.ok(b.maxX > b.minX);
  assert.ok(b.maxY > b.minY);
  assert.ok(b.maxX - b.minX >= 100 * G.CANVAS_NODE_DISPLAY_SCALE - 0.01);
});

test('canvasConnectionPathD and wheel zoom factor boundaries', () => {
  const G = loadGeom();
  const d = G.canvasConnectionPathD({ x: 0, y: 0 }, { x: 100, y: 50 });
  assert.equal(typeof d, 'string');
  assert.match(d, /^M /);
  const bad = G.canvasConnectionPathD(null, { x: 1, y: 1 });
  assert.ok(!bad);

  const sens = G.CANVAS_WHEEL_ZOOM_SENSITIVITY;
  const zoomIn = G.canvasWheelZoomFactor(-100, sens);
  const zoomOut = G.canvasWheelZoomFactor(100, sens);
  assert.ok(zoomIn > 1, 'scroll up zooms in');
  assert.ok(zoomOut < 1, 'scroll down zooms out');
  const huge = G.canvasWheelZoomFactor(1e9, sens);
  assert.ok(Number.isFinite(huge) && huge > 0);
});

test('canvasZoomToFitCardColumns fits six default cards in the viewport width', () => {
  const G = loadGeom();
  const displayW = G.CANVAS_NODE_DEFAULT_WIDTH * G.CANVAS_NODE_DISPLAY_SCALE;
  const gap = G.CANVAS_DEFAULT_CARD_GAP;
  const padding = 24;
  const content = 6 * displayW + 5 * gap;
  const viewport = 1932;
  const expected = (viewport - padding * 2) / content;
  assert.equal(G.CANVAS_DEFAULT_VISIBLE_COLUMNS, 6);
  assert.equal(G.CANVAS_DEFAULT_CARD_GAP, 128);
  assert.ok(Math.abs(G.canvasZoomToFitCardColumns(viewport, { padding, minZoom: 0.25, maxZoom: 2 }) - expected) < 1e-9);
  assert.equal(G.canvasZoomToFitCardColumns(400, { padding, minZoom: 0.25, maxZoom: 2 }), 0.25);
  assert.equal(G.canvasZoomToFitCardColumns(20000, { padding, minZoom: 0.25, maxZoom: 2 }), 2);
});
