import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('../park.js', import.meta.url)));
const WORKSPACE_SRC = fs.readFileSync(path.join(ROOT, 'parkWorkspaceUi.js'), 'utf8');

function loadWorkspace(env) {
  const sandbox = {
    self: null,
    console,
    Date,
    String,
    Number,
    Object,
    Array,
    JSON,
    Math,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    document: {},
    window: {},
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(WORKSPACE_SRC, sandbox, { filename: 'parkWorkspaceUi.js' });
  sandbox.TabWallWorkspaceUi.bind(env);
  return sandbox.TabWallWorkspaceUi;
}

function makeEnv({ viewMode = 'list', sendMessage, items = [{ id: 'old', kind: 'tab' }] } = {}) {
  const calls = [];
  const logs = [];
  const store = {
    getState: () => ({ pendingOperations: [], interaction: null, revision: 4 }),
    setItems: (next) => calls.push(['setItems', next]),
    hydrate: (next, layout, revision) => calls.push(['hydrate', next, layout, revision]),
    applyRemote: (layout, revision) => calls.push(['applyRemote', layout, revision]),
  };
  return {
    calls,
    logs,
    env: {
      allTabs: items,
      canvasLayout: { viewport: { zoom: 1 }, positions: {}, connections: [] },
      canvasLoadGeneration: 0,
      canvasNeedsInitialCenter: true,
      canvasSessionFallback: false,
      ensureCanvasStore: () => store,
      loadStatusEl: { textContent: '' },
      markTagSuggestIndexDirty: () => calls.push(['markTags']),
      normalizeParkedList: (raw) => raw,
      pruneAttachmentUrlCache: (next) => calls.push(['prune', next]),
      renderCanvasStackIndex: () => calls.push(['stack']),
      renderGrid: () => calls.push(['grid']),
      scheduleInitialCanvasCenter: () => calls.push(['center']),
      applyViewMode: (mode) => calls.push(['mode', mode]),
      sendMessage,
      settings: { viewMode },
      t: () => '資料讀取失敗',
      uiLog: (...args) => logs.push(args),
    },
  };
}

test('items can render in list mode when the canvas layout is unavailable', async () => {
  const nextItems = [{ id: 'new', kind: 'tab' }];
  const { env, calls, logs } = makeEnv({
    sendMessage: async ({ type }) => type === 'GET_PARKED_ITEMS'
      ? { ok: true, items: nextItems }
      : { ok: false, error: 'layout_unavailable' },
  });
  const ui = loadWorkspace(env);

  const result = await ui.loadList();

  assert.equal(result, true);
  assert.deepEqual(env.allTabs, nextItems);
  assert.equal(env.loadStatusEl.textContent, '');
  assert.ok(calls.some(([type]) => type === 'grid'));
  assert.ok(calls.some(([type]) => type === 'hydrate'));
  assert.equal(env.canvasSessionFallback, false);
  assert.equal(logs.some(([, scope, message]) => scope === 'load' && message === 'loadList failed'), false);
});

test('a failed reload preserves the existing canvas data and view state', async () => {
  const existingItems = [{ id: 'existing', kind: 'tab' }];
  const { env, calls, logs } = makeEnv({
    viewMode: 'canvas',
    items: existingItems,
    sendMessage: async () => {
      throw new Error('storage_unavailable');
    },
  });
  const ui = loadWorkspace(env);

  const result = await ui.loadList();

  assert.equal(result, false);
  assert.deepEqual(env.allTabs, existingItems);
  assert.equal(env.settings.viewMode, 'canvas');
  assert.equal(env.canvasSessionFallback, false);
  assert.equal(calls.some(([type]) => type === 'mode'), false);
  assert.equal(calls.some(([type]) => type === 'grid'), false);
  assert.equal(env.loadStatusEl.textContent, '資料讀取失敗');
  assert.ok(logs.some(([, scope, message]) => scope === 'load' && message === 'parked items unavailable'));
});
