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

test('canvasSearchViewportForBounds caps sparse results and centers them', () => {
  const G = loadGeom();
  const viewport = G.canvasSearchViewportForBounds(1200, 800, {
    minX: 100,
    minY: 200,
    maxX: 342,
    maxY: 387,
  }, { padding: 24, minZoom: 0.25, maxZoom: G.CANVAS_SEARCH_ZOOM_MAX });
  assert.ok(viewport);
  assert.equal(viewport.zoom, G.CANVAS_SEARCH_ZOOM_MAX);
  assert.equal(viewport.x, 221 - 1200 / (2 * G.CANVAS_SEARCH_ZOOM_MAX));
  assert.equal(viewport.y, 293.5 - 800 / (2 * G.CANVAS_SEARCH_ZOOM_MAX));
});

test('canvasSearchViewportForBounds fits dense results to both viewport axes', () => {
  const G = loadGeom();
  const bounds = { minX: 0, minY: 0, maxX: 1800, maxY: 1200 };
  const viewport = G.canvasSearchViewportForBounds(1200, 800, bounds, {
    padding: 24,
    minZoom: 0.25,
    maxZoom: G.CANVAS_SEARCH_ZOOM_MAX,
  });
  assert.ok(viewport);
  assert.equal(viewport.zoom, Math.min((1200 - 48) / 1800, (800 - 48) / 1200));
  assert.equal(viewport.x, 900 - 1200 / (2 * viewport.zoom));
  assert.equal(viewport.y, 600 - 800 / (2 * viewport.zoom));
});

test('canvasSearchViewportForBounds rejects empty or invalid bounds', () => {
  const G = loadGeom();
  assert.equal(G.canvasSearchViewportForBounds(1200, 800, null), null);
  assert.equal(G.canvasSearchViewportForBounds(1200, 800, { minX: 1, minY: 1, maxX: 1, maxY: 2 }), null);
  assert.equal(G.canvasSearchViewportForBounds(0, 800, { minX: 0, minY: 0, maxX: 10, maxY: 10 }), null);
});

test('canvasMinimapViewportForPoint centers the clicked world coordinate at the current zoom', () => {
  const G = loadGeom();
  const viewport = G.canvasMinimapViewportForPoint({
    mapWidth: 200,
    mapHeight: 120,
    scale: 0.5,
    offsetX: 10,
    offsetY: 20,
  }, { x: 60, y: 70 }, 1000, 800, 1.25);
  assert.equal(viewport.x, -300);
  assert.equal(viewport.y, -220);
  assert.equal(viewport.zoom, 1.25);
});
