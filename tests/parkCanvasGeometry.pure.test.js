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

test('project/unproject invert at tilt and depth', () => {
  const G = loadGeom();
  const camera = G.canvasCameraState({ x: 40, y: 80, zoom: 1 }, { width: 1200, height: 800 });
  assert.ok(camera.tiltDeg > 0);
  const world = { x: 220, y: 180, depth: 48 };
  const screen = G.projectCanvasPoint(world, camera);
  assert.ok(screen);
  const back = G.unprojectCanvasPoint(screen, camera, world.depth);
  assert.ok(back);
  assert.ok(Math.abs(back.x - world.x) < 0.08);
  assert.ok(Math.abs(back.y - world.y) < 0.08);
  const flat = G.canvasCameraState({ x: 0, y: 0, zoom: 1 }, { width: 1000, height: 800 }, { quiet: true });
  assert.equal(flat.tiltDeg, 0);
  const origin = G.unprojectCanvasPoint({ x: 0, y: 0 }, flat, 0);
  assert.ok(origin);
  assert.ok(Math.abs(origin.x) < 1e-9);
  assert.ok(Math.abs(origin.y) < 1e-9);
});

test('island merge adopts the connected-to depth', () => {
  const G = loadGeom();
  const positions = {
    a: { x: 0, y: 0, w: 220, h: 170, z: 0, depth: 96 },
    b: { x: 300, y: 0, w: 220, h: 170, z: 1, depth: 0 },
    c: { x: 600, y: 0, w: 220, h: 170, z: 2, depth: 96 },
  };
  const linked = [{ sourceId: 'a', targetId: 'c' }];
  assert.equal(G.canvasIslandIds('a', linked).slice().sort().join(','), 'a,c');
  const merged = G.mergeCanvasIslandDepth(positions, [...linked, { sourceId: 'a', targetId: 'b' }], 'a', 'b');
  assert.equal(merged.a.depth, 0);
  assert.equal(merged.b.depth, 0);
  assert.equal(merged.c.depth, 0);
  const unified = G.unifyCanvasIslandDepths({
    a: { ...positions.a, depth: 24 },
    b: { ...positions.b, depth: 24 },
    c: { ...positions.c, depth: 96 },
  }, [{ sourceId: 'a', targetId: 'b' }]);
  assert.equal(unified.a.depth, unified.b.depth);
  assert.equal(unified.c.depth, 96);
});
