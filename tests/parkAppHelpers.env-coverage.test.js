import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('../park.js', import.meta.url)));
const HELPERS_SRC = fs.readFileSync(path.join(ROOT, 'parkAppHelpers.js'), 'utf8');
const PARK_SRC = fs.readFileSync(path.join(ROOT, 'park.js'), 'utf8');

/** Panel modules that receive bindPanelModules env (same order as park.js). */
const PANEL_MODULES = [
  'parkSettingsUi.js',
  'parkImportExport.js',
  'parkStickerUi.js',
  'parkCanvasInteraction.js',
  'parkCanvasChrome.js',
  'parkListUi.js',
  'parkWorkspaceUi.js',
  'parkAppHelpers.js',
];

function envKeysUsedInSource(src) {
  const keys = new Set();
  for (const m of src.matchAll(/\benv\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  return keys;
}

/** Assignments: `env.x =`, postfix/prefix ++/--, and compound ops (need setters). */
function envKeysAssignedInSource(src) {
  const keys = new Set();
  for (const m of src.matchAll(/\benv\.([A-Za-z_$][\w$]*)\s*=/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\benv\.([A-Za-z_$][\w$]*)\s*(?:\+\+|--|\+=|-=|\*=|\/=)/g)) keys.add(m[1]);
  // Prefix ++env.x / --env.x (loadList: ++env.canvasLoadGeneration)
  for (const m of src.matchAll(/(?:\+\+|--)\s*env\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  return keys;
}

function bindPanelRoRwKeys() {
  const start = PARK_SRC.indexOf('function bindPanelModules');
  assert.ok(start >= 0, 'bindPanelModules present');
  const end = PARK_SRC.indexOf('\nbindPanelModules();', start);
  assert.ok(end > start, 'bindPanelModules call present');
  const body = PARK_SRC.slice(start, end);
  const roStart = body.indexOf('const ro = {');
  const rwStart = body.indexOf('const rw = {');
  assert.ok(roStart >= 0 && rwStart > roStart, 'ro/rw maps present');
  const roBody = body.slice(roStart, rwStart);
  const rwBody = body.slice(rwStart, body.indexOf('\n  for (const [name, get]'));
  const ro = new Set([...roBody.matchAll(/"([A-Za-z_$][\w$]*)"\s*:/g)].map((m) => m[1]));
  const rw = new Set([...rwBody.matchAll(/"([A-Za-z_$][\w$]*)"\s*:/g)].map((m) => m[1]));
  return { ro, rw, bound: new Set([...ro, ...rw]) };
}

function loadAppHelpers() {
  const sandbox = { self: null, console, Date, String, Number, Object, Array, JSON, Math, Error, URL };
  sandbox.self = sandbox;
  sandbox.window = { location: { ancestorOrigins: undefined } };
  sandbox.document = { referrer: '' };
  sandbox.chrome = undefined;
  vm.createContext(sandbox);
  vm.runInContext(HELPERS_SRC, sandbox, { filename: 'parkAppHelpers.js' });
  return sandbox.TabWallAppHelpers;
}

test('bindPanelModules covers every env.* key used by parkAppHelpers', () => {
  const used = envKeysUsedInSource(HELPERS_SRC);
  assert.ok(used.size > 0, 'helpers reference env.*');
  const { ro, rw, bound } = bindPanelRoRwKeys();
  const missing = [...used].filter((k) => !bound.has(k)).sort();
  assert.deepEqual(missing, [], `AppHelpers env keys missing from bindPanelModules: ${missing.join(', ')}`);

  const assigned = envKeysAssignedInSource(HELPERS_SRC);
  const assignedNotRw = [...assigned].filter((k) => !rw.has(k)).sort();
  assert.deepEqual(
    assignedNotRw,
    [],
    `AppHelpers assigns env.* keys that are not rw: ${assignedNotRw.join(', ')}`,
  );

  for (const k of ['uiLogBuffer', 'UI_LOG_MAX', 'CanvasStoreApi', 'domainOf', 'cardPointerRaf', 'loadListTimer']) {
    assert.ok(bound.has(k), `expected ${k} in bind`);
  }
  assert.ok(rw.has('canvasNotePlacementArmed'), 'canvasNotePlacementArmed must be rw');
  assert.ok(!ro.has('canvasNotePlacementArmed'), 'canvasNotePlacementArmed must not be ro-only');
});

test('all panel modules: used env keys bound; assigned/compound keys are rw (not ro-only)', () => {
  const { ro, rw, bound } = bindPanelRoRwKeys();
  const allUsed = new Set();
  const allAssigned = new Set();
  const assignedByFile = {};

  for (const file of PANEL_MODULES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const used = envKeysUsedInSource(src);
    const assigned = envKeysAssignedInSource(src);
    for (const k of used) allUsed.add(k);
    for (const k of assigned) {
      allAssigned.add(k);
      if (!assignedByFile[k]) assignedByFile[k] = [];
      assignedByFile[k].push(file);
    }

    const missing = [...used].filter((k) => !bound.has(k)).sort();
    assert.deepEqual(missing, [], `${file}: env keys missing from bind: ${missing.join(', ')}`);

    const assignedNotRw = [...assigned].filter((k) => !rw.has(k)).sort();
    assert.deepEqual(
      assignedNotRw,
      [],
      `${file}: assigns env.* that are not rw (strict mode TypeError risk): ${assignedNotRw.join(', ')}`,
    );
  }

  // Skeptic anchors: List / Workspace / Ix / Chrome write surfaces.
  const mustRw = [
    'dragState',
    'gridNodeIsList',
    'editingId',
    'editContext',
    'editTagList',
    'expandedId',
    'expandedMeta',
    'membersGroupId',
    'preSaveContext',
    'preSaveTagList',
    'dedupeState',
    'canvasNeedsInitialCenter',
    'canvasPointerState',
    'canvasPointerRaf',
    'canvasQueuedPointerEvent',
    'canvasLastPointerEvent',
    'canvasLastMiddleClickAt',
    'canvasMiddleClickTimer',
    'canvasGeometryObserver',
    'canvasZoomWheelFrame',
    'canvasZoomWheelState',
    'canvasContextMenuState',
    'canvasInitialCenterRaf',
    'canvasRailResizeFrame',
    'canvasRailResizeState',
    'canvasInteractionGeneration',
  ];
  for (const k of mustRw) {
    assert.ok(allAssigned.has(k) || rw.has(k), `expected ${k} to be assigned or already rw`);
    assert.ok(rw.has(k), `${k} must be rw`);
    assert.ok(!ro.has(k), `${k} must not remain ro-only`);
  }

  assert.ok(allUsed.size >= 100, `expected substantial panel env surface, got ${allUsed.size}`);
  assert.ok(allAssigned.size >= 20, `expected many assigned keys, got ${allAssigned.size}`);
});

test('rw accessors accept assignment (simulates bindPanelModules defineProperty)', () => {
  // Mirrors park.js bind: get/set closures over live let bindings.
  let dragState = null;
  let canvasPointerRaf = 0;
  let canvasInteractionGeneration = 0;
  let canvasNotePlacementArmed = false;

  const env = Object.create(null);
  const rw = {
    dragState: { get: () => dragState, set: (v) => { dragState = v; } },
    canvasPointerRaf: { get: () => canvasPointerRaf, set: (v) => { canvasPointerRaf = v; } },
    canvasInteractionGeneration: {
      get: () => canvasInteractionGeneration,
      set: (v) => { canvasInteractionGeneration = v; },
    },
    canvasNotePlacementArmed: {
      get: () => canvasNotePlacementArmed,
      set: (v) => { canvasNotePlacementArmed = v; },
    },
  };
  for (const [name, acc] of Object.entries(rw)) {
    Object.defineProperty(env, name, {
      enumerable: true,
      configurable: true,
      get: acc.get,
      set: acc.set,
    });
  }

  assert.doesNotThrow(() => {
    env.dragState = { kind: 'card', id: 'x' };
    env.canvasPointerRaf = 1;
    env.canvasInteractionGeneration += 1;
    env.canvasNotePlacementArmed = env.canvasNotePlacementArmed || true;
  });
  assert.equal(dragState.kind, 'card');
  assert.equal(canvasPointerRaf, 1);
  assert.equal(canvasInteractionGeneration, 1);
  assert.equal(canvasNotePlacementArmed, true);

  // ro-only would throw in strict mode — prove contrast for a getter-only prop.
  const roOnly = Object.create(null);
  Object.defineProperty(roOnly, 'dragState', {
    enumerable: true,
    configurable: true,
    get: () => dragState,
  });
  assert.throws(() => {
    'use strict';
    roOnly.dragState = { kind: 'fail' };
  }, TypeError);
});

test('canvasLoadGeneration is rw (loadList uses prefix ++env.canvasLoadGeneration)', () => {
  const { ro, rw } = bindPanelRoRwKeys();
  assert.ok(rw.has('canvasLoadGeneration'), 'canvasLoadGeneration must be rw');
  assert.ok(!ro.has('canvasLoadGeneration'), 'canvasLoadGeneration must not be ro-only');

  let canvasLoadGeneration = 0;
  const env = Object.create(null);
  Object.defineProperty(env, 'canvasLoadGeneration', {
    enumerable: true,
    configurable: true,
    get: () => canvasLoadGeneration,
    set: (v) => { canvasLoadGeneration = v; },
  });
  assert.doesNotThrow(() => {
    const generation = ++env.canvasLoadGeneration;
    assert.equal(generation, 1);
    assert.equal(canvasLoadGeneration, 1);
  });
});

test('getParentOrigin is pre-bind safe (park.js PARENT_ORIGIN at load)', () => {
  // Blank-page regression: park.js evaluates `const PARENT_ORIGIN = getParentOrigin()`
  // before bindPanelModules(). ensureBound must not run here.
  const H = loadAppHelpers();
  assert.equal(typeof H.getParentOrigin, 'function');
  assert.doesNotThrow(() => {
    const origin = H.getParentOrigin();
    assert.equal(typeof origin, 'string');
  });
  // Still unbound — uiLog must still fail closed.
  assert.throws(() => H.uiLog('info', 'x', 'y'), /before bind/);
});

test('sendMessage is pre-bind safe (chrome.runtime only)', async () => {
  const sandbox = { self: null, console, Date, String, Number, Object, Array, JSON, Math, Error, URL };
  sandbox.self = sandbox;
  sandbox.window = { location: { ancestorOrigins: undefined } };
  sandbox.document = { referrer: '' };
  let lastPayload = null;
  sandbox.chrome = {
    runtime: {
      lastError: null,
      sendMessage(payload, cb) {
        lastPayload = payload;
        cb({ ok: true });
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(HELPERS_SRC, sandbox, { filename: 'parkAppHelpers.js' });
  const H = sandbox.TabWallAppHelpers;
  const res = await H.sendMessage({ type: 'PING' });
  assert.equal(res.ok, true);
  assert.equal(lastPayload.type, 'PING');
});

test('AppHelpers.bind + uiLog uses live uiLogBuffer via env (real module path)', () => {
  const H = loadAppHelpers();
  assert.equal(typeof H.bind, 'function');
  assert.equal(typeof H.uiLog, 'function');

  const used = envKeysUsedInSource(HELPERS_SRC);
  const buffer = [];
  const state = Object.create(null);
  for (const k of used) {
    state[k] = undefined;
  }
  state.uiLogBuffer = buffer;
  state.UI_LOG_MAX = 3;
  state.t = (x) => x;

  const env = Object.create(null);
  for (const name of Object.keys(state)) {
    Object.defineProperty(env, name, {
      enumerable: true,
      configurable: true,
      get: () => state[name],
      set: (v) => {
        state[name] = v;
      },
    });
  }

  H.bind(env);
  H.uiLog('info', 'test', 'hello', 'detail');
  assert.equal(buffer.length, 1);
  assert.equal(buffer[0].tag, 'test');
  assert.equal(buffer[0].msg, 'hello');
  assert.match(buffer[0].detail, /detail/);

  H.uiLog('info', 't2', 'a');
  H.uiLog('info', 't3', 'b');
  H.uiLog('info', 't4', 'c');
  assert.equal(buffer.length, 3);
  assert.equal(buffer[0].tag, 't2');
  assert.equal(buffer[2].tag, 't4');
});
