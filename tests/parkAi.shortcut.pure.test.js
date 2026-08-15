import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const CORE_SOURCE = fs.readFileSync(new URL('../aiUiCore.js', import.meta.url), 'utf8');
const UI_SOURCE = fs.readFileSync(new URL('../parkAiUi.js', import.meta.url), 'utf8');

function loadUi() {
  const listeners = new Map();
  const focusCalls = [];
  const document = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    createElement() {
      return {
        className: '',
        style: {},
        append() {},
        appendChild() {},
        addEventListener() {},
      };
    },
  };
  const port = {
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
    postMessage() {},
    disconnect() {},
  };
  const sandbox = {
    self: null,
    document,
    chrome: { runtime: { connect: () => port } },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    URL,
    Number,
    String,
    Boolean,
    Math,
    Array,
    Object,
    Set,
    Promise,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CORE_SOURCE, sandbox, { filename: 'aiUiCore.js' });
  vm.runInContext(UI_SOURCE, sandbox, { filename: 'parkAiUi.js' });

  let open = false;
  const aiBox = {
    classList: {
      add() { open = true; },
      remove() { open = false; },
      contains() { return open; },
    },
    setAttribute() {},
  };
  const aiInput = {
    focus() { focusCalls.push(true); },
    addEventListener() {},
  };
  sandbox.TabWallAiUi.bind({
    aiBox,
    aiBtn: { classList: { add() {}, remove() {} }, addEventListener() {} },
    aiInput,
    t: (key) => key,
    settings: { ai: {} },
    closeAllFloatsExcept() {},
    syncFloatBackdrop() {},
  });
  sandbox.TabWallAiUi.init();

  return {
    ui: sandbox.TabWallAiUi,
    handler: listeners.get('keydown'),
    aiInput,
    focusCalls,
  };
}

test('park AI Option+A opens and focuses the internal AI panel', () => {
  const runtime = loadUi();
  let prevented = false;
  let stopped = false;
  runtime.handler({
    altKey: true,
    code: 'KeyA',
    target: {},
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.ok(runtime.focusCalls.length > 0);
});

test('park AI Option+A leaves other editable controls alone', () => {
  const runtime = loadUi();
  let prevented = false;
  runtime.handler({
    altKey: true,
    code: 'KeyA',
    target: { nodeType: 1, tagName: 'INPUT' },
    preventDefault() { prevented = true; },
    stopPropagation() {},
  });
  assert.equal(prevented, false);
});
