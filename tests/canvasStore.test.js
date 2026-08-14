import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../canvasStore.js', import.meta.url), 'utf8');

function loadStore() {
  const sandbox = { setTimeout, clearTimeout, console };
  sandbox.self = sandbox;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'canvasStore.js' });
  return sandbox.TabWallCanvasStore;
}

const ITEM = { id: 'a', kind: 'tab' };

test('canvas fallback positions keep logical card size and use the wider 128px grid gap', () => {
  const api = loadStore();
  const layout = api.normalizeLayout({}, [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
    { id: 'e' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(layout.positions.a)), { x: 128, y: 128, w: 220, h: 170, z: 0 });
  assert.equal(layout.positions.b.x - layout.positions.a.x, 370);
  assert.equal(layout.positions.e.y - layout.positions.a.y, 315);
  assert.equal(layout.positions.e.w, 220);
  assert.equal(layout.positions.e.h, 170);
});

test('canvas store keeps pointer preview transient and commits semantic pan', () => {
  const api = loadStore();
  const store = api.createCanvasStore({ items: [ITEM] });
  store.beginPointer('pan', { pointerId: 1, startX: 10, startY: 10 });
  store.previewPointer({ dx: 24, dy: -8, moved: true });
  assert.equal(store.getState().interaction.kind, 'pan');
  assert.equal(store.getState().pendingOperations.length, 0);
  assert.equal(store.getState().layout.viewport.x, 24);

  store.finishPointer({ commit: true });
  const state = store.getState();
  assert.equal(state.interaction, null);
  assert.equal(state.layout.viewport.x, 24);
  assert.equal(state.layout.viewport.y, -8);
  assert.equal(state.pendingOperations.length, 1);
});

test('viewport preview stays transient and clear restores the persistent viewport', async () => {
  const api = loadStore();
  let calls = 0;
  const store = api.createCanvasStore({
    items: [ITEM],
    sendPatch: async () => {
      calls += 1;
      return { ok: true, revision: 1 };
    },
  });
  const persistentViewport = { ...store.getState().layout.viewport };

  assert.equal(store.previewViewport({ x: 50, y: 60, zoom: 1.5 }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().layout.viewport)), { x: 50, y: 60, zoom: 1.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().viewportPreview)), { x: 50, y: 60, zoom: 1.5 });
  assert.equal(store.getState().pendingOperations.length, 0);
  assert.equal(store.getState().revision, 0);
  await store.flush();
  assert.equal(calls, 0);

  assert.equal(store.clearViewportPreview(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().layout.viewport)), persistentViewport);
  assert.equal(store.getState().viewportPreview, null);
  assert.equal(store.getState().pendingOperations.length, 0);
});

test('canvas wheel pan coalesces consecutive pending deltas', () => {
  const api = loadStore();
  const store = api.createCanvasStore({ items: [ITEM] });
  store.commitPan(12, 4);
  store.commitPan(-2, 8);
  const state = store.getState();
  assert.equal(state.pendingOperations.length, 1);
  assert.equal(state.pendingOperations[0].type, 'pan');
  assert.equal(state.pendingOperations[0].dx, 10);
  assert.equal(state.pendingOperations[0].dy, 12);
  assert.equal(state.layout.viewport.x, 10);
  assert.equal(state.layout.viewport.y, 12);
});

test('short pointer and cancel restore the last committed layout', () => {
  const api = loadStore();
  const store = api.createCanvasStore({ items: [ITEM] });
  store.beginPointer('pan', { pointerId: 1 });
  store.previewPointer({ dx: 30, dy: 30, moved: true });
  store.cancelPointer();
  assert.equal(store.getState().layout.viewport.x, 0);
  assert.equal(store.getState().layout.viewport.y, 0);
  assert.equal(store.getState().layout.viewport.zoom, 1);

  store.beginPointer('pan', { pointerId: 2 });
  store.finishPointer({ commit: false });
  assert.equal(store.getState().pendingOperations.length, 0);
});

test('node move snaps at commit while replay remains a delta', () => {
  const api = loadStore();
  const store = api.createCanvasStore({
    items: [ITEM],
    layout: { positions: { a: { x: 10, y: 10, w: 220, h: 170, z: 0 } } },
  });
  store.beginPointer('node', { pointerId: 1, ids: ['a'] });
  store.previewPointer({ dx: 15, dy: 20, moved: true });
  store.finishPointer({ commit: true, snap: true });
  assert.equal(store.getState().layout.positions.a.x, 24);
  assert.equal(store.getState().layout.positions.a.y, 24);

  store.applyRemote({ positions: { a: { x: 100, y: 100, w: 220, h: 170, z: 0 } } }, 2);
  assert.equal(store.getState().layout.positions.a.x, 120);
  assert.equal(store.getState().layout.positions.a.y, 120);
});

test('zoom keeps the requested screen anchor and selection is reducer state', () => {
  const api = loadStore();
  const store = api.createCanvasStore({ items: [ITEM] });
  store.setSelection(['a']);
  assert.deepEqual([...store.getState().selectedIds], ['a']);
  store.commitZoom(2, { world: { x: 100, y: 80 }, offset: { x: 50, y: 40 } });
  assert.equal(store.getState().layout.viewport.zoom, 2);
  assert.equal(store.getState().layout.viewport.x, 75);
  assert.equal(store.getState().layout.viewport.y, 60);
});

test('consecutive pending zoom commits coalesce without changing the final anchor', () => {
  const api = loadStore();
  const store = api.createCanvasStore({ items: [ITEM] });
  store.commitZoom(1.25, { world: { x: 100, y: 80 }, offset: { x: 50, y: 40 } });
  store.commitZoom(1.5, { world: { x: 100, y: 80 }, offset: { x: 50, y: 40 } });
  const state = store.getState();
  assert.equal(state.pendingOperations.length, 1);
  assert.equal(state.pendingOperations[0].type, 'zoom');
  assert.equal(state.pendingOperations[0].zoom, 1.5);
  assert.equal(state.layout.viewport.zoom, 1.5);
  assert.equal(state.layout.viewport.x, 100 - 50 / 1.5);
  assert.equal(state.layout.viewport.y, 80 - 40 / 1.5);
});

test('remote revisions replay pending operations and ignore stale responses', () => {
  const api = loadStore();
  const store = api.createCanvasStore({ items: [ITEM] });
  store.commitPan(12, 4);
  assert.equal(store.applyRemote({ viewport: { x: 100, y: 50, zoom: 1 } }, 3), true);
  assert.equal(store.getState().layout.viewport.x, 112);
  assert.equal(store.getState().layout.viewport.y, 54);
  assert.equal(store.applyRemote({ viewport: { x: 1, y: 1, zoom: 1 } }, 2), false);
  assert.equal(store.getState().layout.viewport.x, 112);
});

test('remote layout waits until an active pointer interaction ends', () => {
  const api = loadStore();
  const store = api.createCanvasStore({ items: [ITEM] });
  store.beginPointer('pan', { pointerId: 1 });
  store.previewPointer({ dx: 20, dy: 0, moved: true });
  store.applyRemote({ viewport: { x: 100, y: 0, zoom: 1 } }, 2);
  assert.equal(store.getState().layout.viewport.x, 20);
  store.finishPointer({ commit: true });
  assert.equal(store.getState().layout.viewport.x, 120);
  assert.equal(store.getState().queuedRemote, null);
});

test('conflict replay and bounded retry eventually acknowledge the latest operation', async () => {
  const api = loadStore();
  let calls = 0;
  const store = api.createCanvasStore({
    items: [ITEM],
    retryDelays: [0, 0],
    sendPatch: async ({ layout }) => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          error: 'canvas_conflict',
          layout: { viewport: { x: 100, y: 0, zoom: 1 } },
          revision: 4,
        };
      }
      return { ok: true, layout, revision: 5 };
    },
  });
  store.commitPan(10, 0);
  await store.flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  assert.equal(store.getState().pendingOperations.length, 0);
  assert.equal(store.getState().layout.viewport.x, 110);

  calls = 0;
  const retryStore = api.createCanvasStore({
    items: [ITEM],
    retryDelays: [0],
    sendPatch: async ({ layout }) => {
      calls += 1;
      if (calls === 1) throw new Error('temporary');
      return { ok: true, layout, revision: 2 };
    },
  });
  retryStore.commitPan(5, 0);
  await retryStore.flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  assert.equal(retryStore.getState().pendingOperations.length, 0);
});

test('canvas connections normalize direction, deduplicate, and reject unknown endpoints', () => {
  const api = loadStore();
  const layout = api.normalizeLayout({
    connections: [
      { sourceId: 'b', targetId: 'a' },
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'a', targetId: 'a' },
      { sourceId: 'a', targetId: 'missing' },
    ],
  }, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(layout.connections)), [{ sourceId: 'a', targetId: 'b' }]);
});

test('canvas connection curve offsets normalize, clamp, and preserve the first valid duplicate', () => {
  const api = loadStore();
  const layout = api.normalizeLayout({
    connections: [
      { sourceId: 'a', targetId: 'b', curveOffset: { x: 0, y: 0 } },
      { sourceId: 'b', targetId: 'a', curveOffset: { x: 48, y: -24 } },
      { sourceId: 'a', targetId: 'b', curveOffset: { x: 96, y: 96 } },
      { sourceId: 'b', targetId: 'c', curveOffset: { x: 3000, y: -3000 } },
      { sourceId: 'a', targetId: 'c', curveOffset: { x: Infinity, y: 20 } },
    ],
  }, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(layout.connections)), [
    { sourceId: 'a', targetId: 'b', curveOffset: { x: 48, y: -24 } },
    { sourceId: 'a', targetId: 'c', curveOffset: { x: 0, y: 20 } },
    { sourceId: 'b', targetId: 'c', curveOffset: { x: 2000, y: -2000 } },
  ]);
  assert.deepEqual(api.normalizeCurveOffset({ x: 0, y: 0 }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeCurveOffset({ x: -2001, y: 2001 }))), { x: -2000, y: 2000 });
});

test('connection operations persist and replay through remote canvas revisions', () => {
  const api = loadStore();
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const store = api.createCanvasStore({ items });
  store.commitConnections([{ sourceId: 'b', targetId: 'a', curveOffset: { x: 32, y: -16 } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().layout.connections)), [{
    sourceId: 'a',
    targetId: 'b',
    curveOffset: { x: 32, y: -16 },
  }]);
  assert.equal(store.getState().pendingOperations[0].type, 'setConnections');

  store.applyRemote({ connections: [{ sourceId: 'b', targetId: 'c' }] }, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().layout.connections)), [{
    sourceId: 'a',
    targetId: 'b',
    curveOffset: { x: 32, y: -16 },
  }]);

  store.commitConnections([]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().layout.connections)), []);
});

test('connection endpoint rewires remain canonical and deduplicated', () => {
  const api = loadStore();
  const store = api.createCanvasStore({
    items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    layout: { connections: [{ sourceId: 'a', targetId: 'b' }] },
  });
  store.commitConnections([
    { sourceId: 'c', targetId: 'a' },
    { sourceId: 'b', targetId: 'c' },
    { sourceId: 'a', targetId: 'c' },
    { sourceId: 'd', targetId: 'missing' },
    { sourceId: 'd', targetId: 'd' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().layout.connections)), [
    { sourceId: 'a', targetId: 'c' },
    { sourceId: 'b', targetId: 'c' },
  ].sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.targetId.localeCompare(right.targetId)));
});

test('removing canvas items filters connection endpoints without touching the data shape', () => {
  const api = loadStore();
  const store = api.createCanvasStore({
    items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    layout: { connections: [{ sourceId: 'a', targetId: 'b' }, { sourceId: 'b', targetId: 'c' }] },
  });
  store.setItems([{ id: 'a' }, { id: 'c' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().layout.connections)), []);
  assert.deepEqual(Object.keys(store.getState().layout.positions), ['a', 'c']);
});
