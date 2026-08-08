import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');

function createElement(tagName) {
  const listeners = new Map();
  const element = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    children: [],
    attributes: {},
    parentNode: null,
    isConnected: false,
    contentWindow: null,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    append(...nodes) {
      nodes.forEach((node) => {
        node.parentNode = this;
        this.children.push(node);
      });
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    attachShadow() {
      const shadow = createElement('shadow-root');
      this.shadowRoot = shadow;
      return shadow;
    },
    remove() {
      this.isConnected = false;
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      }
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
  if (String(tagName).toLowerCase() === 'iframe') {
    element.contentWindow = {
      posted: [],
      postMessage(payload, origin) {
        this.posted.push({ payload, origin });
      },
    };
  }
  return element;
}

function createContentRuntime() {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const frameQueue = [];
  const root = createElement('html');
  const runtimeListeners = [];
  const sentMessages = [];
  let saveResponse = null;
  const windowObject = {
    __tabWallInjected: false,
    parent: {},
    setTimeout(callback) {
      callback();
      return 1;
    },
    requestAnimationFrame(callback) {
      frameQueue.push(callback);
      return frameQueue.length;
    },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    dispatch(type, event = {}) {
      windowListeners.get(type)?.(event);
    },
  };
  const documentObject = {
    documentElement: root,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    createElement,
  };
  const chrome = {
    runtime: {
      lastError: null,
      getURL(path) {
        return `https://tabwall.test/${path}`;
      },
      sendMessage(message, callback) {
        sentMessages.push(message);
        saveResponse = callback;
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
    },
  };
  const context = vm.createContext({
    URL,
    window: windowObject,
    document: documentObject,
    chrome,
    setTimeout: windowObject.setTimeout,
  });
  vm.runInContext(SOURCE, context, { filename: 'content.js' });

  return {
    chrome,
    document: documentObject,
    window: windowObject,
    frameQueue,
    runtimeListeners,
    sentMessages,
    get root() {
      return root.children[0];
    },
    dispatchRuntime(message) {
      runtimeListeners[0]?.(message, {}, () => {});
    },
    dispatchSaveFromPark() {
      const iframe = root.children[0]?.shadowRoot?.children[1]?.children[0]?.children[0];
      windowObject.dispatch('message', {
        source: iframe?.contentWindow,
        origin: 'https://tabwall.test',
        data: { type: 'TABWALL_SAVE_ACTIVE' },
      });
    },
    respond(result) {
      saveResponse?.(result);
      saveResponse = null;
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('overlay quick save hides TabWall before capture and restores it after response', async () => {
  const runtime = createContentRuntime();
  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  const overlay = runtime.root;
  assert.ok(overlay);
  assert.equal(overlay.style.visibility || '', '');

  runtime.dispatchSaveFromPark();
  assert.equal(runtime.sentMessages.length, 0);
  assert.equal(overlay.style.visibility, 'hidden');
  assert.equal(runtime.frameQueue.length, 1);

  runtime.frameQueue.shift()();
  assert.equal(runtime.frameQueue.length, 1);
  runtime.frameQueue.shift()();
  await flushMicrotasks();

  assert.deepEqual(JSON.parse(JSON.stringify(runtime.sentMessages)), [{ type: 'SAVE_TAB_FROM_CONTENT' }]);
  assert.equal(overlay.style.visibility, 'hidden');

  runtime.respond({ ok: true, id: 'saved-id' });
  await flushMicrotasks();

  assert.equal(overlay.style.visibility || '', '');
  const iframe = overlay.shadowRoot.children[1].children[0].children[0];
  assert.deepEqual(JSON.parse(JSON.stringify(iframe.contentWindow.posted)), [{
    payload: { type: 'TABWALL_SAVE_RESULT', result: { ok: true, id: 'saved-id' } },
    origin: 'https://tabwall.test',
  }]);
});
