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
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
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
    focus() {
      this.focused = true;
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

function createContentRuntime({ marker = false } = {}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const frameQueue = [];
  const root = createElement('html');
  const head = createElement('head');
  head.querySelectorAll = (selector) => {
    if (selector !== 'link[rel~="icon"]') return [];
    return head.children.filter((child) => (
      child.tagName === 'LINK' && child.attributes.rel?.split(/\s+/).includes('icon')
    ));
  };
  const runtimeListeners = [];
  const sentMessages = [];
  const focusCalls = [];
  const previousFocus = {
    focus(options) {
      focusCalls.push(options);
    },
  };
  let saveResponse = null;
  const windowObject = {
    __tabWallInjected: marker,
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
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
    dispatch(type, event = {}) {
      windowListeners.get(type)?.(event);
    },
  };
  const documentObject = {
    documentElement: root,
    head,
    activeElement: previousFocus,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
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
    focusCalls,
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

test('overlay CSS is 98% panel with backdrop blur', () => {
  assert.match(SOURCE, /backdrop-filter:\s*blur\(/);
  assert.match(SOURCE, /-webkit-backdrop-filter:\s*blur\(/);
  assert.match(SOURCE, /\.panel\s*\{[^}]*width:\s*98%/);
  assert.match(SOURCE, /\.panel\s*\{[^}]*height:\s*98%/);
  assert.match(SOURCE, /\.shell\s*\{[^}]*z-index:\s*2147483647/);
  assert.match(SOURCE, /previousActiveElement/);
});

test('closing the overlay restores the page element that had focus', () => {
  const runtime = createContentRuntime();
  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  assert.ok(runtime.root);

  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  assert.equal(runtime.focusCalls.length, 1);
  assert.equal(runtime.focusCalls[0].preventScroll, true);
  assert.equal(runtime.root, undefined);
});

test('overlay temporarily replaces the page favicon and restores the original link', () => {
  const runtime = createContentRuntime();
  const original = runtime.document.createElement('link');
  original.setAttribute('rel', 'icon');
  original.setAttribute('href', 'https://example.com/favicon.ico');
  const alternate = runtime.document.createElement('link');
  alternate.setAttribute('rel', 'shortcut icon');
  alternate.setAttribute('href', 'https://example.com/favicon-32.png');
  runtime.document.head.appendChild(original);
  runtime.document.head.appendChild(alternate);

  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  assert.equal(runtime.document.head.children.length, 2);
  assert.equal(original.attributes.href, 'https://tabwall.test/icons/icon16.png');
  assert.equal(alternate.attributes.href, 'https://tabwall.test/icons/icon16.png');

  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  assert.deepEqual(runtime.document.head.children, [original, alternate]);
  assert.equal(original.attributes.href, 'https://example.com/favicon.ico');
  assert.equal(alternate.attributes.href, 'https://example.com/favicon-32.png');
});

test('overlay injects a temporary favicon when the page has no icon link', () => {
  const runtime = createContentRuntime();

  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  assert.equal(runtime.document.head.children.length, 1);
  const temporary = runtime.document.head.children[0];
  assert.equal(temporary.attributes.rel, 'icon');
  assert.equal(temporary.attributes.type, 'image/png');
  assert.equal(temporary.attributes.href, 'https://tabwall.test/icons/icon16.png');
  assert.equal(temporary.attributes['data-tabwall-temporary-favicon'], '1');

  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  assert.equal(runtime.document.head.children.length, 0);
});

test('all overlay open paths share temporary favicon cleanup, including reload disposal', () => {
  const runtime = createContentRuntime();

  runtime.dispatchRuntime({ type: 'OPEN_PARK' });
  assert.equal(runtime.document.head.children.length, 1);
  runtime.window.__tabWallInjected.dispose();
  assert.equal(runtime.document.head.children.length, 0);

  runtime.dispatchRuntime({ type: 'OPEN_PARK' });
  runtime.dispatchRuntime({ type: 'OPEN_PARK' });
  assert.equal(runtime.document.head.children.length, 1);
  runtime.dispatchRuntime({ type: 'TOGGLE_PARK' });
  assert.equal(runtime.document.head.children.length, 0);
});

test('content shell replaces a stale reload marker instead of skipping injection', () => {
  const runtime = createContentRuntime({ marker: true });
  assert.equal(runtime.runtimeListeners.length, 1);
  assert.equal(runtime.window.__tabWallInjected.active, true);
  assert.equal(typeof runtime.window.__tabWallInjected.dispose, 'function');
});

test('content bridge queues page Sticker editor and forwards page changes', () => {
  assert.match(SOURCE, /OPEN_PAGE_STICKER_EDITOR/);
  assert.match(SOURCE, /OPEN_PAGE_STICKER_REMINDER/);
  assert.match(SOURCE, /pendingPageStickerEditor/);
  assert.match(SOURCE, /TABWALL_PAGE_STICKER_SAVED/);
  assert.match(SOURCE, /TABWALL_PAGE_STICKER_CHANGED/);
  assert.match(SOURCE, /TABWALL_PAGE_STICKER_CANCEL/);
  assert.match(SOURCE, /flushPendingPageStickerEditor/);
  assert.match(SOURCE, /flushPendingPageStickerReminder/);
});

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
