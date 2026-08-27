import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const BUILD_SOURCE = fs.readFileSync(new URL('../backupBuild.js', import.meta.url), 'utf8');
const NOTE_MEDIA_SOURCE = fs.readFileSync(new URL('../noteMedia.js', import.meta.url), 'utf8');
const BACKGROUND_SOURCE = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const PACK_SOURCE = fs.readFileSync(new URL('../scripts/pack.sh', import.meta.url), 'utf8');
const BG_MODULE_SOURCES = Object.fromEntries(
  ['webhookCore.js', 'bgNormalize.js', 'bgLayout.js', 'bgBackup.js', 'bgRestore.js', 'bgUndo.js', 'bgReminders.js', 'bgAi.js', 'bgPageAnnotate.js', 'bgUpdate.js'].map((name) => [
    name,
    fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'),
  ])
);
const MANIFEST = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_HTTP_MEMBER_ID = '55555555-5555-4555-8555-555555555555';
const GROUP_FILE_MEMBER_ID = '66666666-6666-4666-8666-666666666666';
const NOTE_ID = '77777777-7777-4777-8777-777777777777';
const NOTE_ATTACHMENT_ID = '88888888-8888-4888-8888-888888888888';
const NOTE_ATTACHMENT_TWO_ID = '99999999-9999-4999-8999-999999999999';
const LEGACY_ZIP = new URL(
  '../backup/tabwall-backup-full-2026-08-05T14-49-39+0800.zip',
  import.meta.url
);

function event() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

function createRuntime({ manifestVersion = '2.13.0' } = {}) {
  const store = Object.create(null);
  const sessionStore = Object.create(null);
  const media = new Map();
  const importStages = new Map();
  const removedDownloads = [];
  const removedTabs = [];
  const badgeCalls = [];
  const alarmStore = new Map();
  const notificationCalls = [];
  const testSetTimeout = setTimeout;
  const testClearTimeout = clearTimeout;
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
          return Object.fromEntries(list.map((key) => [key, store[key]]));
        },
        async set(values) {
          if (runtime.failNextStorageSet) {
            runtime.failNextStorageSet = false;
            throw new Error('storage_write_failed');
          }
          Object.assign(store, values);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
        },
      },
      session: {
        async get(key) {
          return { [key]: sessionStore[key] };
        },
        async set(values) {
          Object.assign(sessionStore, values);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
        },
      },
      onChanged: event(),
    },
    alarms: {
      onAlarm: event(),
      async create(name, info) {
        alarmStore.set(name, { name, ...info });
      },
      async clear(name) {
        return alarmStore.delete(name);
      },
      async getAll() {
        return [...alarmStore.values()];
      },
    },
    notifications: {
      onClicked: event(),
      create(id, options, callback) {
        notificationCalls.push({ id, options });
        if (runtime.failNotificationCreate) return Promise.reject(new Error('notification_create_failed'));
        callback?.(id);
        return Promise.resolve(id);
      },
      async clear() {},
    },
    runtime: {
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      lastError: null,
      getManifest: () => ({ version: manifestVersion }),
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    commands: { onCommand: event(), async getAll() { return []; } },
  action: {
      onClicked: event(),
      async setBadgeBackgroundColor(details) {
        badgeCalls.push({ type: 'background', ...details });
      },
      async setBadgeText(details) {
        badgeCalls.push({ type: 'text', ...details });
      },
  },
    tabs: {
      onActivated: event(),
      onCreated: event(),
      onUpdated: event(),
      async query(queryInfo = {}) {
        if (queryInfo.active && queryInfo.lastFocusedWindow) {
          return runtime.lastFocusedTabs ?? runtime.activeTabs;
        }
        if (queryInfo.active && queryInfo.currentWindow) return runtime.activeTabs;
        if (queryInfo.url) {
          return [...runtime.openTabs, ...runtime.parkTabs].filter((tab) => tab.url === queryInfo.url);
        }
        if (queryInfo.windowType === 'normal') return runtime.parkTabs;
        if (queryInfo.groupId != null) {
          return [...runtime.openTabs, ...runtime.groupTabs, ...runtime.activeTabs]
            .filter((tab, index, tabs) => tabs.findIndex((candidate) => candidate.id === tab.id) === index)
            .filter((tab) => tab.groupId === queryInfo.groupId);
        }
        return runtime.openTabs;
      },
      async create(info) {
        if (runtime.failTabCreate) throw new Error('tabs_create_failed');
        const tab = {
          id: ++runtime.nextTabId,
          windowId: info.windowId ?? runtime.activeTabs[0]?.windowId ?? 1,
          groupId: -1,
          index: runtime.openTabs.length,
          ...info,
        };
        runtime.createdTabs.push(tab);
        runtime.openTabs.push(tab);
        return tab;
      },
      async remove(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        removedTabs.push(...list);
        runtime.openTabs = runtime.openTabs.filter((tab) => !list.includes(tab.id));
      },
      async group(options = {}) {
        if (runtime.failNextGroup) {
          runtime.failNextGroup = false;
          throw new Error('tabs_group_failed');
        }
        const groupId = options.groupId ?? 77;
        runtime.groupCalls.push({ ...options, groupId });
        const ids = new Set(options.tabIds || []);
        runtime.openTabs.forEach((tab) => {
          if (ids.has(tab.id)) tab.groupId = groupId;
        });
        return groupId;
      },
      async update(id, info) {
        runtime.updatedTabs.push({ id, info });
        const tab = runtime.openTabs.find((candidate) => candidate.id === id);
        if (tab) Object.assign(tab, info, { active: info.active === true ? true : tab.active });
      },
      async move(ids, info) {
        const list = Array.isArray(ids) ? ids : [ids];
        runtime.movedTabs.push({ ids: [...list], info: { ...info } });
        runtime.openTabs.forEach((tab) => {
          if (list.includes(tab.id) && info.windowId != null) tab.windowId = info.windowId;
        });
        return runtime.openTabs.filter((tab) => list.includes(tab.id));
      },
      async getCurrent() {
        return runtime.currentTab;
      },
      async get(id) {
        const candidates = [
          ...runtime.activeTabs,
          ...runtime.groupTabs,
          ...runtime.openTabs,
          ...runtime.createdTabs,
        ];
        const found = candidates.find((tab) => tab?.id === id);
        return found ? { ...found, status: found.status || 'complete' } : {
          id,
          windowId: 1,
          status: 'complete',
        };
      },
      async sendMessage(tabId, message) {
        runtime.tabMessages.push({ tabId, message });
        if (runtime.failSendMessage) throw new Error('send_message_failed');
      },
      async captureVisibleTab() { return ''; },
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      async get(id) {
        return runtime.groupMeta || {
          id,
          title: '',
          color: 'grey',
          collapsed: false,
        };
      },
      async update(id, info) {
        runtime.groupUpdates.push({ id, info });
        runtime.groupMeta = { id, ...info };
      },
    },
    windows: {
      async create(info) {
        if (runtime.failWindowCreate) throw new Error('windows_create_failed');
        const tab = {
          id: ++runtime.nextTabId,
          url: info.url || 'chrome://newtab/',
          windowId: 55,
          groupId: -1,
          index: 0,
        };
        runtime.createdTabs.push(tab);
        runtime.openTabs.push(tab);
        return { id: 55, tabs: [tab] };
      },
      async update(id, info) {
        runtime.updatedWindows.push({ id, info });
      },
      async remove() {},
    },
    scripting: {
      async executeScript() {
        if (runtime.failExecuteScript) throw new Error('execute_script_failed');
      },
    },
    downloads: {
      onChanged: event(),
      async search() { return runtime.downloadItems; },
      removeFile(id, callback) {
        removedDownloads.push(id);
        callback();
      },
      erase(_query, callback) { callback(); },
    },
  };

  const runtime = {
    failNextStorageSet: false,
    failTabCreate: false,
    failNextGroup: false,
    failWindowCreate: false,
    nextTabId: 100,
    createdTabs: [],
    openTabs: [],
    lastFocusedTabs: null,
    updatedTabs: [],
    updatedWindows: [],
    movedTabs: [],
    groupCalls: [],
    groupUpdates: [],
    badgeCalls,
    alarmStore,
    notificationCalls,
    tabMessages: [],
    fetchCalls: [],
    fetchImpl: null,
    parkTabs: [],
    currentTab: null,
    downloadItems: [],
    activeTabs: [],
    groupTabs: [],
    groupMeta: null,
    failSendMessage: false,
    failExecuteScript: false,
    failNotificationCreate: false,
  };

  const mediaApi = {
    mediaKeyTab: (id) => `t:${id}`,
    mediaKeyMember: (groupId, memberId) => `g:${groupId}:${memberId}`,
    mediaKeyNoteAttachment: (noteId, attachmentId) => `n:${noteId}:${attachmentId}`,
    mediaKeyPageInk: (id) => `ink:${id}`,
    async getInk(key) {
      return media.get(key)?.ink || [];
    },
    async putInk(key, strokes) {
      media.set(key, { ink: strokes || [] });
    },
    async get(key) {
      return media.get(key) || { thumb: null, snap: null };
    },
    async getAttachment(key) {
      return media.get(key)?.attachment || null;
    },
    async put(key, value) {
      media.set(key, value);
    },
    async putAttachment(key, blob) {
      media.set(key, { attachment: blob });
      return true;
    },
    async remove(key) {
      media.delete(key);
    },
    async removeMany(keys) {
      for (const key of keys || []) media.delete(key);
    },
    async putFromDataUrls(key, thumb, snap) {
      if (!thumb && !snap) {
        media.delete(key);
        return { hasThumb: false, hasSnap: false };
      }
      media.set(key, { thumb: thumb || null, snap: snap || null });
      return { hasThumb: Boolean(thumb), hasSnap: Boolean(snap) };
    },
    async putFromBlobs(key, thumb, snap) {
      if (!thumb && !snap) {
        media.delete(key);
        return { hasThumb: false, hasSnap: false };
      }
      media.set(key, { thumb: thumb || null, snap: snap || null });
      return { hasThumb: Boolean(thumb), hasSnap: Boolean(snap) };
    },
    async putImportStage(stageId, rows) {
      importStages.set(
        stageId,
        new Map((rows || []).map((row) => [row.mediaKey, {
          thumb: row.thumb || null,
          snap: row.snap || null,
          attachment: row.attachment || null,
        }]))
      );
    },
    async getImportStage(stageId) {
      return new Map(importStages.get(stageId) || []);
    },
    async removeImportStage(stageId) {
      importStages.delete(stageId);
    },
    dataUrlToBlob(value) {
      if (typeof value !== 'string' || !value.startsWith('data:')) return null;
      const comma = value.indexOf(',');
      if (comma < 0) return null;
      const header = value.slice(5, comma);
      const body = value.slice(comma + 1);
      const mime = header.split(';')[0] || 'image/png';
      try {
        const bytes = /;base64/i.test(header)
          ? Uint8Array.from(atob(body), (char) => char.charCodeAt(0))
          : new TextEncoder().encode(decodeURIComponent(body));
        return new Blob([bytes], { type: mime });
      } catch {
        return null;
      }
    },
    async blobToDataUrl(value) { return value ? String(value) : ''; },
    keysForItem(item) {
      if (item.kind === 'group') {
        return [
          ...(item.tabs || []).map((member) => `g:${item.id}:${member.id}`),
          ...(item.notes || []).flatMap((note) => (
            note.attachments || []
          ).map((attachment) => `n:${note.id}:${attachment.id}`)),
        ];
      }
      if (item.kind === 'note') {
        return (item.attachments || []).map((attachment) => `n:${item.id}:${attachment.id}`);
      }
      return [`t:${item.id}`];
    },
    async removeOrphans(keepKeys) {
      const keep = new Set(keepKeys || []);
      const stale = [...media.keys()].filter((key) => !keep.has(key));
      for (const key of stale) media.delete(key);
      return stale;
    },
    async openDb() {},
  };

  const sandbox = {
    self: null,
    chrome,
    crypto: crypto.webcrypto,
    URL,
    Blob,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    AbortController,
    console,
    setTimeout(callback, delay, ...args) {
      const timer = testSetTimeout(callback, delay, ...args);
      if (delay >= 10000) timer.unref?.();
      return timer;
    },
    clearTimeout: testClearTimeout,
    fetch: (...args) => {
      runtime.fetchCalls.push(args);
      if (runtime.fetchImpl) return runtime.fetchImpl(...args);
      return Promise.reject(new Error('fetch_not_stubbed'));
    },
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { clearRect() {}, drawImage() {} };
      }
      async convertToBlob({ type = 'image/webp' } = {}) {
        return new Blob([new Uint8Array([1, 2, 3])], { type });
      }
    },
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    __TABWALL_TEST__: true,
    importScripts(...names) {
      for (const name of names) {
        // mediaDb/backupBuild/noteMedia are pre-injected on the sandbox.
        if (name === 'mediaDb.js' || name === 'backupBuild.js' || name === 'noteMedia.js') continue;
        const source = BG_MODULE_SOURCES[name];
        if (!source) throw new Error(`unexpected importScripts: ${name}`);
        vm.runInContext(source, sandbox, { filename: name });
      }
    },
    TabWallMediaDB: mediaApi,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BUILD_SOURCE, sandbox, { filename: 'backupBuild.js' });
  vm.runInContext(NOTE_MEDIA_SOURCE, sandbox, { filename: 'noteMedia.js' });
  vm.runInContext(BACKGROUND_SOURCE, sandbox, { filename: 'background.js' });
  const ready = new Promise((resolve) => setTimeout(resolve, 0));
  return {
    api: sandbox.TabWallBackgroundTest,
    core: sandbox.TabWallWebhookCore,
    chrome,
    Build: sandbox.TabWallBackupBuild,
    store,
    media,
    importStages,
    runtime,
    removedDownloads,
    removedTabs,
    badgeCalls,
    alarmStore,
    notificationCalls,
    ready,
  };
}

function tab(id, url = 'https://example.com/') {
  return {
    kind: 'tab',
    id,
    url,
    title: id,
    favIconUrl: '',
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    hasThumb: true,
    hasSnap: true,
  };
}

function note(id = NOTE_ID, { attachment = true, tags = ['idea'] } = {}) {
  return {
    kind: 'note',
    id,
    title: 'Canvas note',
    markdown: attachment ? `# Heading\n\n![diagram](attachment://${NOTE_ATTACHMENT_ID})` : 'Plain note',
    contentMode: 'markdown',
    webSource: '',
    tags,
    pinned: false,
    savedAt: Date.now() - 1000,
    attachments: attachment ? [{
      id: NOTE_ATTACHMENT_ID,
      name: 'diagram.png',
      alt: 'diagram',
      mime: 'image/png',
      size: 3,
      width: 1,
      height: 1,
      hasData: true,
      data: 'data:image/png;base64,AQID',
    }] : [],
  };
}

function quotaNoteForTest(id, attachmentCount = 4, size = 24 * 1024 * 1024) {
  const result = note(id, { attachment: false });
  result.attachments = Array.from({ length: attachmentCount }, (_, index) => ({
    id: `${String(id).slice(0, 8)}-${String(index + 1).padStart(4, '0')}-4aaa-8aaa-aaaaaaaaaaaa`,
    name: `image-${index}.webp`,
    alt: '',
    mime: 'image/webp',
    size,
    width: 4096,
    height: 4096,
    hasData: true,
  }));
  return result;
}

test('New Tab takeover is configurable through the dynamic background route', async () => {
  assert.equal(MANIFEST.chrome_url_overrides, undefined);
  assert.equal(MANIFEST.version, '2.59.2');
  assert.ok(MANIFEST.web_accessible_resources?.some((entry) => entry.resources?.includes('icons/icon16.png')));
  assert.match(BACKGROUND_SOURCE, /webhookCore\.js/);
  assert.ok(MANIFEST.web_accessible_resources?.some((entry) => entry.resources?.includes('webhookCore.js')));
  assert.match(PACK_SOURCE, /\bwebhookCore\.js/);
  assert.match(BACKGROUND_SOURCE, /bgNormalize\.js/);
  assert.match(BACKGROUND_SOURCE, /bgLayout\.js/);
  assert.match(BACKGROUND_SOURCE, /bgBackup\.js/);
  assert.match(BACKGROUND_SOURCE, /bgRestore\.js/);
  assert.match(BACKGROUND_SOURCE, /bgUndo\.js/);
  assert.match(BACKGROUND_SOURCE, /importScripts\('bgNormalize\.js', 'bgLayout\.js', 'bgBackup\.js', 'bgRestore\.js', 'bgUndo\.js', 'bgReminders\.js', 'bgAi\.js', 'bgPageAnnotate\.js', 'bgUpdate\.js'\)/);
  assert.match(PACK_SOURCE, /\bbgUpdate\.js/);
  assert.equal(MANIFEST.action?.default_popup, 'popup.html');
  assert.equal(Object.keys(MANIFEST.commands || {}).length, 6);
  assert.equal(MANIFEST.commands?.['save-keep']?.suggested_key?.default, 'Alt+Shift+S');
  assert.equal(MANIFEST.commands?.['open-ai']?.suggested_key, undefined);
  assert.equal(MANIFEST.commands?.['toggle-annotate']?.suggested_key, undefined);
  assert.ok(
    Object.values(MANIFEST.commands || {}).filter((command) => command?.suggested_key).length <= 4,
    'Chrome allows at most 4 suggested_key commands'
  );
  assert.deepEqual(MANIFEST.content_scripts?.[0]?.js, ['parkSearchQuery.js', 'quickSearch.js', 'aiUiCore.js', 'aiPanel.js', 'content.js', 'pageAnnotate.js']);

  const runtime = createRuntime();
  await runtime.ready;
  const defaults = await dispatchMessage(runtime, { type: 'PATCH_SETTINGS', partial: {} });
  assert.equal(defaults.settings.newTabOverride, true);

  const newTab = { id: 7101, windowId: 1, url: 'chrome://newtab/', incognito: false };
  runtime.runtime.openTabs.push(newTab);
  await runtime.chrome.tabs.onCreated.listeners[0](newTab);
  assert.equal(newTab.url, 'chrome-extension://test/park.html');
  assert.equal(runtime.runtime.updatedTabs.filter(({ id }) => id === newTab.id).length, 1);

  await runtime.chrome.tabs.onUpdated.listeners[0](newTab.id, {
    url: 'chrome-extension://test/park.html',
    status: 'complete',
  }, newTab);
  assert.equal(runtime.runtime.updatedTabs.filter(({ id }) => id === newTab.id).length, 1);
});

test('New Tab takeover waits for a late URL and respects disabled/incognito boundaries', async () => {
  const lateRuntime = createRuntime();
  await lateRuntime.ready;
  const lateTab = { id: 7102, windowId: 1, url: '', incognito: false };
  lateRuntime.runtime.openTabs.push(lateTab);
  await lateRuntime.chrome.tabs.onCreated.listeners[0](lateTab);
  assert.equal(lateTab.url, '');
  lateTab.url = 'edge://newtab/';
  await lateRuntime.chrome.tabs.onUpdated.listeners[0](lateTab.id, {
    url: lateTab.url,
    status: 'loading',
  }, lateTab);
  assert.equal(lateTab.url, 'chrome-extension://test/park.html');

  const normalTab = { id: 7105, windowId: 1, url: 'https://example.com/', incognito: false };
  lateRuntime.runtime.openTabs.push(normalTab);
  await lateRuntime.chrome.tabs.onCreated.listeners[0](normalTab);
  assert.equal(normalTab.url, 'https://example.com/');

  const disabledRuntime = createRuntime();
  await disabledRuntime.ready;
  await dispatchMessage(disabledRuntime, {
    type: 'PATCH_SETTINGS',
    partial: { newTabOverride: false },
  });
  const disabledTab = { id: 7103, windowId: 1, url: 'chrome://newtab/', incognito: false };
  disabledRuntime.runtime.openTabs.push(disabledTab);
  await disabledRuntime.chrome.tabs.onCreated.listeners[0](disabledTab);
  assert.equal(disabledTab.url, 'chrome://newtab/');

  disabledRuntime.store.settings.newTabOverride = true;
  const incognitoTab = { id: 7104, windowId: 1, url: 'chrome://newtab/', incognito: true };
  disabledRuntime.runtime.openTabs.push(incognitoTab);
  await disabledRuntime.chrome.tabs.onCreated.listeners[0](incognitoTab);
  assert.equal(incognitoTab.url, 'chrome://newtab/');
});

test('page ink survives extension-startup orphan cleanup', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const url = 'https://ink-persistence.example/page';
  const strokes = [
    { id: 'line-1', kind: 'line', x1: 10, y1: 20, x2: 80, y2: 20, color: '#2563eb', width: 3 },
    { id: 'text-1', kind: 'text', x: 30, y: 40, text: 'survives reload', color: '#111827', fontSize: 16 },
  ];

  const saved = await runtime.api.putPageInk(url, strokes, {
    title: 'Ink persistence',
    overlayVisible: true,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.annotation.hasInk, true);
  runtime.media.set('ink:orphan', ['remove me']);

  await runtime.api.cleanupOrphanMedia();

  assert.equal(runtime.media.has(`ink:${saved.annotation.id}`), true);
  assert.equal(runtime.media.has('ink:orphan'), false);
  const loaded = await runtime.api.getPageInk(url);
  assert.deepEqual(loaded.strokes, strokes);
});

test('action badge matches standalone tabs and group members by exact URL', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const standaloneUrl = 'https://badge-standalone.example/path?view=1#saved';
  const groupUrl = 'https://badge-group.example/member';
  await runtime.api.setParkedItems([
    tab(ITEM_ID, standaloneUrl),
    {
      kind: 'group',
      id: GROUP_ID,
      title: 'Badge group',
      color: 'blue',
      tabs: [{
        id: GROUP_HTTP_MEMBER_ID,
        url: groupUrl,
        title: 'Group member',
      }],
      notes: [note(NOTE_ID, { attachment: false })],
    },
  ]);

  await runtime.api.refreshTabBadge({ id: 1101, url: standaloneUrl });
  const standaloneText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1101);
  const standaloneBackground = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'background' && call.tabId === 1101);
  assert.equal(standaloneText.text, '✓');
  assert.equal(standaloneBackground.color, '#16a34a');

  await runtime.api.refreshTabBadge({
    id: 1101,
    url: 'https://badge-standalone.example/path?view=2#saved',
  });
  const queryMismatch = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1101);
  assert.equal(queryMismatch.text, '');

  await runtime.api.refreshTabBadge({ id: 1102, url: groupUrl });
  const groupText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1102);
  assert.equal(groupText.text, '✓');

  await runtime.api.refreshTabBadge({ id: 1103, url: 'https://badge-note.example/' });
  const noteText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1103);
  assert.equal(noteText.text, '');
});

test('action badge refreshes on lifecycle, tab, navigation, and storage events', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const savedUrl = 'https://badge-events.example/saved';
  await runtime.api.setParkedItems([tab(ITEM_ID, savedUrl)]);

  runtime.runtime.activeTabs = [{ id: 1201, windowId: 1, url: savedUrl }];
  await runtime.chrome.runtime.onStartup.listeners[0]();
  let currentText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1201);
  assert.equal(currentText.text, '✓');

  runtime.runtime.activeTabs = [{ id: 1202, windowId: 1, url: 'https://badge-events.example/other' }];
  await runtime.chrome.tabs.onActivated.listeners[0]({ tabId: 1202, windowId: 1 });
  currentText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1202);
  assert.equal(currentText.text, '');

  runtime.runtime.activeTabs = [{ id: 1202, windowId: 1, url: savedUrl }];
  await runtime.chrome.tabs.onUpdated.listeners[0](
    1202,
    { url: savedUrl, status: 'complete' },
    runtime.runtime.activeTabs[0]
  );
  currentText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1202);
  assert.equal(currentText.text, '✓');

  const changedUrl = 'https://badge-events.example/added';
  runtime.runtime.activeTabs = [{ id: 1202, windowId: 1, url: changedUrl }];
  await runtime.api.setParkedItems([tab(ITEM_ID, changedUrl)]);
  await runtime.chrome.storage.onChanged.listeners[0](
    { parkedItems: { newValue: runtime.store.parkedItems } },
    'local'
  );
  currentText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1202);
  assert.equal(currentText.text, '✓');

  await runtime.api.setParkedItems([]);
  await runtime.chrome.storage.onChanged.listeners[0]({
    parkedItems: { newValue: [] },
  }, 'local');
  currentText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1202);
  assert.equal(currentText.text, '');
});

test('temporary action badge restores the saved-state checkmark', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const savedUrl = 'https://badge-flash.example/saved';
  await runtime.api.setParkedItems([tab(ITEM_ID, savedUrl)]);
  runtime.runtime.activeTabs = [{ id: 1301, windowId: 1, url: savedUrl }];

  await runtime.api.flashBadge('!', '#ef4444', 0);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const currentText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1301);
  assert.equal(currentText.text, '✓');
});

test('action badge shows a pen when the drawing overlay is open', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const url = 'https://draw-badge.example/page';
  runtime.store.pageAnnotations = [{
    id: 'live-draw',
    url,
    title: 'Draw',
    note: '',
    tags: [],
    overlayVisible: true,
    hasInk: true,
    updatedAt: Date.now(),
  }];
  await runtime.api.refreshTabBadge({ id: 1401, url });
  const drawText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1401);
  const drawBackground = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'background' && call.tabId === 1401);
  assert.equal(drawText.text, '✎');
  assert.equal(drawBackground.color, '#c97858');

  await runtime.api.setParkedItems([tab(ITEM_ID, url)]);
  runtime.store.pageAnnotations[0].overlayVisible = false;
  await runtime.api.refreshTabBadge({ id: 1401, url });
  const parkedText = [...runtime.badgeCalls]
    .reverse()
    .find((call) => call.type === 'text' && call.tabId === 1401);
  assert.equal(parkedText.text, '✓');
});

test('automatic save metadata rules support matchers, negation, and accumulation', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const config = {
    enabled: true,
    rules: [
      {
        id: 'docs',
        logic: 'AND',
        conditions: [
          { field: 'domain', operator: 'contains', value: 'EXAMPLE.COM' },
          { field: 'title', operator: 'startsWith', value: 'guide' },
        ],
        note: 'docs\nshared',
        tags: ['docs', 'shared'],
      },
      {
        id: 'or-rule',
        logic: 'OR',
        conditions: [
          { field: 'domain', operator: 'endsWith', value: '.example.com' },
          { field: 'title', operator: 'regex', value: '^unmatched$' },
        ],
        note: 'shared\nor',
        tags: ['shared', 'or'],
      },
      {
        id: 'not-blocked',
        logic: 'AND',
        conditions: [{ field: 'domain', operator: 'contains', value: 'blocked', negate: true }],
        note: 'safe',
        tags: ['safe'],
      },
    ],
  };

  const applied = runtime.api.applyAutoSaveMetadata(
    { url: 'https://Docs.Example.com/path?q=1', title: 'Guide to docs' },
    { note: 'existing', tags: ['shared', 'legacy'] },
    config
  );
  assert.equal(applied.note, 'existing\ndocs\nshared\nor\nsafe');
  assert.deepEqual([...applied.tags], ['shared', 'legacy', 'docs', 'or', 'safe']);

  assert.equal(runtime.api.matchesAutoSaveCondition(
    { url: 'https://Docs.Example.com/path', title: 'Guide' },
    { field: 'domain', operator: 'match', value: 'docs.example.com' }
  ), true);
  assert.equal(runtime.api.matchesAutoSaveCondition(
    { url: 'https://docs.example.com/path', title: 'Guide' },
    { field: 'domain', operator: 'regex', value: '[' }
  ), false);
  assert.equal(runtime.api.matchesAutoSaveCondition(
    { url: 'https://docs.example.com/path', title: 'Guide' },
    { field: 'domain', operator: 'contains', value: 'blocked', negate: true }
  ), true);
  assert.equal(runtime.api.matchesAutoSaveCondition(
    { url: 'file:///tmp/page.html', title: 'Guide' },
    { field: 'domain', operator: 'contains', value: 'blocked', negate: true }
  ), false);
});

test('automatic save metadata applies without creating restore hints', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([{
    ...tab(ITEM_ID, 'https://merge-rules.example/'),
    note: 'restored note',
    tags: ['legacy'],
  }]);
  const restored = await runtime.api.restoreTab(ITEM_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.kept, true);
  assert.equal(runtime.store.parkedItems.length, 1);

  runtime.store.settings = {
    preSaveEdit: false,
    autoSaveMetadata: {
      enabled: true,
      rules: [{
        id: 'merge',
        logic: 'AND',
        conditions: [{ field: 'domain', operator: 'match', value: 'merge-rules.example' }],
        note: 'automatic note',
        tags: ['automatic', 'legacy'],
      }],
    },
  };
  const saved = await runtime.api.commitSaveTab({
    id: 301,
    windowId: null,
    url: 'https://merge-rules.example/',
    title: 'Merged',
    favIconUrl: '',
  });
  assert.equal(saved.ok, true);
  const items = await runtime.api.getParkedItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].note, 'automatic note');
  assert.deepEqual([...items[0].tags], ['automatic', 'legacy']);
  assert.equal(items[1].note, 'restored note');
  assert.deepEqual([...items[1].tags], ['legacy']);
  assert.deepEqual([...runtime.store.tagCatalog].sort(), ['automatic', 'legacy']);
});

test('automatic save metadata applies independently to Group members', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    saveGroupCapture: 'none',
    autoSaveMetadata: {
      enabled: true,
      rules: [
        {
          id: 'docs',
          conditions: [{ field: 'domain', operator: 'contains', value: 'docs.example' }],
          note: 'Documentation',
          tags: ['work'],
        },
        {
          id: 'news',
          conditions: [{ field: 'title', operator: 'contains', value: 'news' }],
          note: 'Read later',
          tags: ['reading'],
        },
      ],
    },
  };
  runtime.runtime.groupTabs = [
    { id: 401, windowId: 1, groupId: 77, index: 0, url: 'https://docs.example/a', title: 'API docs' },
    { id: 402, windowId: 1, groupId: 77, index: 1, url: 'https://news.example/a', title: 'Daily News' },
  ];
  runtime.runtime.activeTabs = [runtime.runtime.groupTabs[0]];

  const saved = await runtime.api.saveActiveGroup({ afterSaveGroup: 'keep' });
  assert.equal(saved.ok, true);
  const group = (await runtime.api.getParkedItems())[0];
  assert.deepEqual([...group.tabs].map((member) => member.note), ['Documentation', 'Read later']);
  assert.deepEqual([...group.tabs].map((member) => [...member.tags]), [['work'], ['reading']]);
  assert.equal(group.note, '');
  assert.deepEqual([...group.tags], []);
  assert.deepEqual(runtime.removedTabs, []);
});

test('PATCH_SETTINGS normalizes automatic save metadata rules', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const result = await dispatchMessage(runtime, {
    type: 'PATCH_SETTINGS',
    partial: {
      autoSaveMetadata: {
        enabled: true,
        rules: [{
          id: 'normalized',
          enabled: false,
          logic: 'invalid',
          conditions: Array.from({ length: 25 }, () => ({ field: 'bad', operator: 'bad', value: 'x' })),
          tags: ['  one  ', 'one'],
        }],
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.settings.autoSaveMetadata.enabled, true);
  assert.equal(result.settings.autoSaveMetadata.rules[0].enabled, false);
  assert.equal(result.settings.autoSaveMetadata.rules[0].logic, 'AND');
  assert.equal(result.settings.autoSaveMetadata.rules[0].conditions.length, 20);
  assert.deepEqual([...result.settings.autoSaveMetadata.rules[0].tags], ['one']);
});

test('Chrome keep shortcut saves the current tab or group without closing it', async () => {
  const tabRuntime = createRuntime();
  await tabRuntime.ready;
  tabRuntime.runtime.activeTabs = [{
    id: 901,
    windowId: 1,
    url: 'https://command-keep-tab.example/',
    title: 'Keep tab',
    favIconUrl: '',
  }];

  const tabResult = await tabRuntime.api.handleCommandAction('save-keep');
  assert.equal(tabResult.ok, true);
  assert.deepEqual(tabRuntime.removedTabs, []);

  const groupRuntime = createRuntime();
  await groupRuntime.ready;
  groupRuntime.store.settings = { saveGroupCapture: 'none' };
  groupRuntime.runtime.groupTabs = [
    { id: 902, windowId: 1, groupId: 77, index: 0, url: 'https://command-keep-group.example/', title: 'Keep group' },
  ];
  groupRuntime.runtime.activeTabs = [groupRuntime.runtime.groupTabs[0]];

  const groupResult = await groupRuntime.api.handleCommandAction('save-keep');
  assert.equal(groupResult.ok, true);
  assert.deepEqual(groupRuntime.removedTabs, []);
});

test('popup tab keep override saves without closing and does not change settings', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = { preSaveEdit: false };
  runtime.runtime.activeTabs = [{
    id: 501,
    windowId: 1,
    url: 'https://popup-keep.example/',
    title: 'Popup keep',
    favIconUrl: '',
  }];

  const saved = await dispatchMessage(runtime, {
    type: 'SAVE_ACTIVE_TAB',
    afterSave: 'keep',
  });

  assert.equal(saved.ok, true);
  assert.deepEqual(runtime.removedTabs, []);
  assert.equal((await runtime.api.getParkedItems())[0].url, 'https://popup-keep.example/');
  assert.equal((await runtime.api.commitSaveTab({
    id: 502,
    windowId: 1,
    url: 'https://popup-close-default.example/',
    title: 'Default close',
    favIconUrl: '',
  })).ok, true);
  assert.deepEqual(runtime.removedTabs, [502]);
});

test('parking a tab merges live annotation tags/notes and consumes the live record', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = { preSaveEdit: false };
  runtime.store.pageAnnotations = [{
    id: 'live-1',
    url: 'https://live-merge.example/path?q=1',
    title: 'Live page',
    note: 'from live',
    tags: ['alpha', 'beta'],
    overlayVisible: true,
    hasInk: true,
    updatedAt: Date.now(),
  }];

  const meta = await runtime.api.computeSaveMetadata({
    url: 'https://live-merge.example/path?q=1',
    title: 'Live page',
  });
  assert.equal(meta.metadata.note, 'from live');
  assert.equal(Array.from(meta.metadata.tags || []).join(','), 'alpha,beta');

  const saved = await runtime.api.commitSaveTab({
    url: 'https://live-merge.example/path?q=1',
    title: 'Live page',
    favIconUrl: '',
  }, { afterSave: 'keep' });
  assert.equal(saved.ok, true);
  const parked = (await runtime.api.getParkedItems())[0];
  assert.equal(parked.note, 'from live');
  assert.equal([...parked.tags].join(','), 'alpha,beta');
  const remaining = runtime.store.pageAnnotations;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].note, '');
  assert.equal(remaining[0].tags.length, 0);
  assert.equal(remaining[0].hasInk, true);
  assert.equal(remaining[0].overlayVisible, true);
});

test('popup tab close override removes the saved tab', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = { preSaveEdit: false };
  runtime.runtime.activeTabs = [{
    id: 503,
    windowId: 1,
    url: 'https://popup-close.example/',
    title: 'Popup close',
    favIconUrl: '',
  }];

  const saved = await dispatchMessage(runtime, {
    type: 'SAVE_ACTIVE_TAB',
    afterSave: 'close',
  });

  assert.equal(saved.ok, true);
  assert.deepEqual(runtime.removedTabs, [503]);
});

test('popup group keep and close overrides control member removal', async () => {
  const keepRuntime = createRuntime();
  await keepRuntime.ready;
  keepRuntime.store.settings = { saveGroupCapture: 'none' };
  keepRuntime.runtime.groupTabs = [
    { id: 601, windowId: 1, groupId: 77, index: 0, url: 'https://group-keep-a.example/', title: 'A' },
    { id: 602, windowId: 1, groupId: 77, index: 1, url: 'https://group-keep-b.example/', title: 'B' },
  ];
  keepRuntime.runtime.activeTabs = [keepRuntime.runtime.groupTabs[0]];

  const kept = await dispatchMessage(keepRuntime, {
    type: 'SAVE_ACTIVE_GROUP',
    afterSaveGroup: 'keep',
  });
  assert.equal(kept.ok, true);
  assert.deepEqual(keepRuntime.removedTabs, []);

  const closeRuntime = createRuntime();
  await closeRuntime.ready;
  closeRuntime.store.settings = { saveGroupCapture: 'none' };
  closeRuntime.runtime.groupTabs = [
    { id: 603, windowId: 1, groupId: 77, index: 0, url: 'https://group-close-a.example/', title: 'A' },
    { id: 604, windowId: 1, groupId: 77, index: 1, url: 'https://group-close-b.example/', title: 'B' },
  ];
  closeRuntime.runtime.activeTabs = [closeRuntime.runtime.groupTabs[0]];

  const closed = await dispatchMessage(closeRuntime, {
    type: 'SAVE_ACTIVE_GROUP',
    afterSaveGroup: 'close',
  });
  assert.equal(closed.ok, true);
  assert.deepEqual(closeRuntime.removedTabs, [603, 604]);
});

test('popup save mode survives duplicate conflict resolution', async () => {
  const keepRuntime = createRuntime();
  await keepRuntime.ready;
  keepRuntime.store.settings = { preSaveEdit: false };
  await keepRuntime.api.setParkedItems([tab(ITEM_ID, 'https://conflict-popup.example/')]);
  keepRuntime.runtime.activeTabs = [{
    id: 701,
    windowId: 1,
    url: 'https://conflict-popup.example/',
    title: 'Incoming',
    favIconUrl: '',
  }];

  const pendingKeep = await dispatchMessage(keepRuntime, {
    type: 'SAVE_ACTIVE_TAB',
    afterSave: 'keep',
  });
  assert.equal(pendingKeep.conflict, true);
  assert.equal((await dispatchMessage(keepRuntime, {
    type: 'RESOLVE_SAVE_CONFLICT',
    decision: 'keep',
  })).ok, true);
  assert.deepEqual(keepRuntime.removedTabs, []);

  const closeRuntime = createRuntime();
  await closeRuntime.ready;
  closeRuntime.store.settings = { preSaveEdit: false };
  await closeRuntime.api.setParkedItems([tab(ITEM_ID, 'https://conflict-popup-close.example/')]);
  closeRuntime.runtime.activeTabs = [{
    id: 702,
    windowId: 1,
    url: 'https://conflict-popup-close.example/',
    title: 'Incoming',
    favIconUrl: '',
  }];

  const pendingClose = await dispatchMessage(closeRuntime, {
    type: 'SAVE_ACTIVE_TAB',
    afterSave: 'close',
  });
  assert.equal(pendingClose.conflict, true);
  assert.equal((await dispatchMessage(closeRuntime, {
    type: 'RESOLVE_SAVE_CONFLICT',
    decision: 'keep',
  })).ok, true);
  assert.deepEqual(closeRuntime.removedTabs, [702]);
});

test('automatic save metadata is applied after duplicate conflict resolution', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID, 'https://conflict-rules.example/')]);
  runtime.store.settings = {
    preSaveEdit: false,
    autoSaveMetadata: {
      enabled: true,
      rules: [{
        id: 'conflict-rule',
        conditions: [{ field: 'domain', operator: 'match', value: 'conflict-rules.example' }],
        note: 'conflict note',
        tags: ['conflict'],
      }],
    },
  };
  runtime.runtime.activeTabs = [{
    id: 703,
    windowId: 1,
    url: 'https://conflict-rules.example/',
    title: 'Incoming rule tab',
    favIconUrl: '',
  }];

  const pending = await dispatchMessage(runtime, {
    type: 'SAVE_ACTIVE_TAB',
    afterSave: 'keep',
  });
  assert.equal(pending.conflict, true);
  const resolved = await dispatchMessage(runtime, {
    type: 'RESOLVE_SAVE_CONFLICT',
    decision: 'keep',
  });
  assert.equal(resolved.ok, true);
  const items = await runtime.api.getParkedItems();
  const incoming = items.find((item) => item.id !== ITEM_ID);
  assert.equal(incoming.note, 'conflict note');
  assert.deepEqual([...incoming.tags], ['conflict']);
  assert.deepEqual(runtime.removedTabs, []);
});

test('pre-save edit panel defers the write until confirmed, then commits the user note/tags', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{
    id: 910,
    windowId: 1,
    url: 'https://presave-confirm.example/',
    title: 'Pre-save confirm',
    favIconUrl: '',
  }];

  const opened = await dispatchMessage(runtime, { type: 'SAVE_ACTIVE_TAB', afterSave: 'close' });
  assert.equal(opened.ok, true);
  assert.equal(opened.presave, true);
  assert.equal((await runtime.api.getParkedItems()).length, 0);
  assert.deepEqual(runtime.removedTabs, []);

  const pending = await dispatchMessage(runtime, { type: 'GET_PENDING_PRESAVE' });
  assert.equal(pending.ok, true);
  assert.equal(pending.preSave.url, 'https://presave-confirm.example/');

  const resolved = await dispatchMessage(runtime, {
    type: 'RESOLVE_PRESAVE_EDIT',
    decision: 'save',
    note: 'edited note',
    tags: ['edited'],
  });
  assert.equal(resolved.ok, true);
  const items = await runtime.api.getParkedItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].note, 'edited note');
  assert.deepEqual([...items[0].tags], ['edited']);
  assert.deepEqual(runtime.removedTabs, [910]);
});

test('pre-save cancel leaves the tab untouched even in close mode', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{
    id: 911,
    windowId: 1,
    url: 'https://presave-cancel.example/',
    title: 'Pre-save cancel',
    favIconUrl: '',
  }];

  const opened = await dispatchMessage(runtime, { type: 'SAVE_ACTIVE_TAB', afterSave: 'close' });
  assert.equal(opened.ok, true);
  assert.equal(opened.presave, true);

  const resolved = await dispatchMessage(runtime, { type: 'RESOLVE_PRESAVE_EDIT', decision: 'cancel' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.cancelled, true);
  assert.equal((await runtime.api.getParkedItems()).length, 0);
  assert.deepEqual(runtime.removedTabs, []);

  const pendingAfter = await dispatchMessage(runtime, { type: 'GET_PENDING_PRESAVE' });
  assert.equal(pendingAfter.preSave, null);
});

test('pre-save panel pre-fills automatic tags but the user override wins on commit', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    autoSaveMetadata: {
      enabled: true,
      rules: [{
        id: 'presave-rule',
        conditions: [{ field: 'domain', operator: 'match', value: 'presave-rule.example' }],
        note: 'auto note',
        tags: ['auto'],
      }],
    },
  };
  runtime.runtime.activeTabs = [{
    id: 912,
    windowId: 1,
    url: 'https://presave-rule.example/',
    title: 'Pre-save rule',
    favIconUrl: '',
  }];

  await dispatchMessage(runtime, { type: 'SAVE_ACTIVE_TAB', afterSave: 'keep' });
  const pending = await dispatchMessage(runtime, { type: 'GET_PENDING_PRESAVE' });
  assert.equal(pending.preSave.note, 'auto note');
  assert.deepEqual([...pending.preSave.tags], ['auto']);

  const resolved = await dispatchMessage(runtime, {
    type: 'RESOLVE_PRESAVE_EDIT',
    decision: 'save',
    note: 'user note',
    tags: ['user-tag'],
  });
  assert.equal(resolved.ok, true);
  const items = await runtime.api.getParkedItems();
  assert.equal(items[0].note, 'user note');
  assert.deepEqual([...items[0].tags], ['user-tag']);
});

test('duplicate conflict flows into the pre-save panel; replace only deletes the old item on confirm', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID, 'https://presave-conflict.example/')]);
  runtime.runtime.activeTabs = [{
    id: 913,
    windowId: 1,
    url: 'https://presave-conflict.example/',
    title: 'Incoming',
    favIconUrl: '',
  }];

  const pendingConflict = await dispatchMessage(runtime, { type: 'SAVE_ACTIVE_TAB', afterSave: 'keep' });
  assert.equal(pendingConflict.conflict, true);

  const resolvedConflict = await dispatchMessage(runtime, {
    type: 'RESOLVE_SAVE_CONFLICT',
    decision: 'replace',
  });
  assert.equal(resolvedConflict.ok, true);
  assert.equal(resolvedConflict.presave, true);
  // Not deleted yet — the pre-save panel hasn't been confirmed.
  assert.equal((await runtime.api.getParkedItems()).length, 1);

  const resolvedPreSave = await dispatchMessage(runtime, {
    type: 'RESOLVE_PRESAVE_EDIT',
    decision: 'save',
    note: 'replacement note',
    tags: ['replacement'],
  });
  assert.equal(resolvedPreSave.ok, true);
  const items = await runtime.api.getParkedItems();
  assert.equal(items.length, 1);
  assert.notEqual(items[0].id, ITEM_ID);
  assert.equal(items[0].note, 'replacement note');
});

test('open panel action opens overlay, standalone fallback, or reuses TabWall', async () => {
  const overlayRuntime = createRuntime();
  await overlayRuntime.ready;
  overlayRuntime.runtime.activeTabs = [{ id: 801, windowId: 1, url: 'https://open-panel.example/' }];
  const overlay = await dispatchMessage(overlayRuntime, { type: 'OPEN_PARK_ACTIVE' });
  assert.equal(overlay.ok, true);
  assert.equal(overlay.mode, 'overlay');
  assert.equal(overlay.tabId, 801);

  const standaloneRuntime = createRuntime();
  await standaloneRuntime.ready;
  standaloneRuntime.runtime.activeTabs = [{ id: 802, windowId: 1, url: 'chrome://extensions/' }];
  const standalone = await dispatchMessage(standaloneRuntime, { type: 'OPEN_PARK_ACTIVE' });
  assert.equal(standalone.ok, true);
  assert.equal(standalone.mode, 'standalone');
  assert.equal(standaloneRuntime.runtime.createdTabs[0].url, 'chrome-extension://test/park.html?surface=standalone');

  const existingRuntime = createRuntime();
  await existingRuntime.ready;
  existingRuntime.runtime.activeTabs = [{ id: 803, windowId: 1, url: 'chrome-extension://test/park.html?surface=standalone' }];
  const existing = await dispatchMessage(existingRuntime, { type: 'OPEN_PARK_ACTIVE' });
  assert.equal(existing.ok, true);
  assert.equal(existing.mode, 'already-open');
  assert.equal(existing.tabId, 803);
});

test('popup panel opening targets the requested tab', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 816, windowId: 1, url: 'https://popup-tab.example/' }];
  runtime.runtime.lastFocusedTabs = [{ id: 815, windowId: 2, url: 'https://other-window.example/' }];

  const result = await dispatchMessage(runtime, {
    type: 'OPEN_PARK_ACTIVE',
    targetTabId: 816,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'overlay');
  assert.equal(result.tabId, 816);
});

test('PATCH_SETTINGS preserves Canvas rail preferences', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const updated = await dispatchMessage(runtime, {
    type: 'PATCH_SETTINGS',
    partial: { canvasRailWidth: 240, canvasRailCollapsed: true },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.settings.canvasRailWidth, 240);
  assert.equal(updated.settings.canvasRailCollapsed, true);
});

test('GET_AI_SETTINGS returns normalized AI settings without bridge token data', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    ai: {
      enabled: true,
      baseUrl: 'http://localhost:8000/v1/',
      model: 'local-model',
      bridgeUrl: 'https://remote.example/bridge',
    },
  };
  const result = await dispatchMessage(runtime, { type: 'GET_AI_SETTINGS' });
  assert.equal(result.ok, true);
  assert.equal(result.ai.enabled, true);
  assert.equal(result.ai.baseUrl, 'http://localhost:8000/v1');
  assert.equal(result.ai.bridgeUrl, 'http://127.0.0.1:8787');
  assert.equal(result.ai.contextSize, 8192);
  assert.equal(Object.prototype.hasOwnProperty.call(result.ai, 'bridgeToken'), false);
});

test('PATCH_SETTINGS persists a normalized AI context size', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const updated = await dispatchMessage(runtime, {
    type: 'PATCH_SETTINGS',
    partial: { ai: { enabled: true, contextSize: 16384 } },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.settings.ai.contextSize, 16384);
  const result = await dispatchMessage(runtime, { type: 'GET_AI_SETTINGS' });
  assert.equal(result.ai.contextSize, 16384);
});

function dispatchMessage(runtime, message, sender = {}) {
  const listener = runtime.chrome.runtime.onMessage.listeners[0];
  return new Promise((resolve) => {
    listener(message, sender, resolve);
  });
}

function webhookResponse(status = 200, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body; },
  };
}

function releaseResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function releasePayload(version, id = `release-${version}`) {
  return {
    id,
    tag_name: `v${version}`,
    name: `TabWall ${version}`,
    html_url: `https://github.com/davislinyd/TabWall/releases/tag/v${version}`,
    published_at: '2026-08-27T00:00:00Z',
  };
}

test('GitHub release checks run on install and startup without notifications or auto-open', async () => {
  const runtime = createRuntime({ manifestVersion: '2.58.0' });
  runtime.runtime.fetchImpl = async () => releaseResponse(releasePayload('2.59.0'));
  await runtime.ready;

  await runtime.chrome.runtime.onInstalled.listeners[0]();
  const alarm = runtime.alarmStore.get('tabwall-release-check');
  assert.equal(alarm.periodInMinutes, 24 * 60);
  assert.equal(alarm.delayInMinutes, 24 * 60);
  assert.equal(runtime.runtime.fetchCalls.length, 1);
  assert.equal(runtime.runtime.fetchCalls[0][0], 'https://api.github.com/repos/davislinyd/TabWall/releases/latest');
  assert.equal(runtime.runtime.fetchCalls[0][1].credentials, 'omit');
  assert.equal(runtime.runtime.fetchCalls[0][1].headers.Accept, 'application/vnd.github+json');

  let status = await runtime.api.getReleaseUpdateStatus();
  assert.equal(status.currentVersion, '2.58.0');
  assert.equal(status.hasNewerRelease, true);
  assert.equal(status.noticePending, true);
  assert.equal(status.latestRelease.version, '2.59.0');
  assert.equal(runtime.notificationCalls.length, 0);
  assert.equal(runtime.runtime.createdTabs.length, 0);

  await runtime.chrome.runtime.onStartup.listeners[0]();
  assert.equal(runtime.runtime.fetchCalls.length, 2);
  status = await runtime.api.getReleaseUpdateStatus();
  assert.equal(status.noticePending, true);
  assert.equal(runtime.notificationCalls.length, 0);
  assert.equal(runtime.runtime.createdTabs.length, 0);
});

test('GitHub release status distinguishes same, older, and newer stable releases', async () => {
  for (const [version, expected] of [
    ['2.58.0', false],
    ['2.57.9', false],
    ['2.59.0', true],
  ]) {
    const runtime = createRuntime({ manifestVersion: '2.58.0' });
    runtime.runtime.fetchImpl = async () => releaseResponse(releasePayload(version));
    await runtime.ready;
    const result = await runtime.api.checkReleaseUpdate();
    assert.equal(result.ok, true);
    assert.equal(result.hasNewerRelease, expected, version);
    assert.equal(result.noticePending, expected, version);
  }
});

test('GitHub release notices are dismissed by release key and return for a new release', async () => {
  const runtime = createRuntime({ manifestVersion: '2.58.0' });
  runtime.runtime.fetchImpl = async () => releaseResponse(releasePayload('2.59.0', 'release-259'));
  await runtime.ready;
  const first = await runtime.api.checkReleaseUpdate();
  assert.equal(first.noticePending, true);

  const dismissed = await dispatchMessage(runtime, {
    type: 'DISMISS_RELEASE_UPDATE',
    releaseKey: 'release-259',
  });
  assert.equal(dismissed.ok, true);
  assert.equal(dismissed.noticePending, false);
  assert.equal(runtime.runtime.createdTabs.length, 0);

  const sameRelease = await runtime.api.checkReleaseUpdate();
  assert.equal(sameRelease.noticePending, false);

  runtime.runtime.fetchImpl = async () => releaseResponse(releasePayload('2.60.0', 'release-260'));
  const newRelease = await runtime.api.checkReleaseUpdate();
  assert.equal(newRelease.noticePending, true);
  assert.equal(newRelease.latestRelease.key, 'release-260');
});

test('GitHub release check failures and invalid releases preserve the last valid state', async () => {
  const runtime = createRuntime({ manifestVersion: '2.58.0' });
  runtime.runtime.fetchImpl = async () => releaseResponse(releasePayload('2.59.0', 'release-good'));
  await runtime.ready;
  await runtime.api.checkReleaseUpdate();
  const before = JSON.parse(JSON.stringify(runtime.store.releaseUpdate));

  runtime.runtime.fetchImpl = async () => { throw new Error('offline'); };
  let result = await runtime.api.checkReleaseUpdate();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'network_error');
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.store.releaseUpdate)), before);

  runtime.runtime.fetchImpl = async () => releaseResponse({ message: 'rate limited' }, 503);
  result = await runtime.api.checkReleaseUpdate();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'http_503');
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.store.releaseUpdate)), before);

  runtime.runtime.fetchImpl = async () => releaseResponse({
    id: 'release-invalid',
    tag_name: 'latest',
    html_url: 'https://github.com/davislinyd/TabWall/releases/tag/latest',
  });
  result = await runtime.api.checkReleaseUpdate();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_release');
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.store.releaseUpdate)), before);
});

test('card reminders create, list, clear, and sync one-shot alarms', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  const reminder = {
    mode: 'once',
    message: 'Review this card',
    nextAt: Date.now() + 60000,
  };

  const set = await dispatchMessage(runtime, { type: 'SET_REMINDER', id: ITEM_ID, reminder });
  assert.equal(set.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(set.item.reminder)), reminder);
  assert.ok(runtime.alarmStore.has(`tabwall-reminder:${ITEM_ID}`));

  const listed = await dispatchMessage(runtime, { type: 'GET_REMINDERS' });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.items.map((item) => item.id), [ITEM_ID]);
  assert.deepEqual(JSON.parse(JSON.stringify(listed.items[0].reminder)), reminder);

  const cleared = await dispatchMessage(runtime, { type: 'CLEAR_REMINDER', id: ITEM_ID });
  assert.equal(cleared.ok, true);
  assert.equal((await runtime.api.getParkedItems())[0].reminder, undefined);
  assert.equal(runtime.alarmStore.has(`tabwall-reminder:${ITEM_ID}`), false);
});

test('top-level Sticker Note reminders stay independent while Stack notes remain unsupported', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([
    note(NOTE_ID, { attachment: false }),
    note(SOURCE_ID, { attachment: false }),
  ]);
  const firstReminder = { mode: 'once', message: 'First', nextAt: Date.now() + 60000 };
  const secondReminder = { mode: 'once', message: 'Second', nextAt: Date.now() + 120000 };
  assert.equal((await dispatchMessage(runtime, { type: 'SET_REMINDER', id: NOTE_ID, reminder: firstReminder })).ok, true);
  assert.equal((await dispatchMessage(runtime, { type: 'SET_REMINDER', id: SOURCE_ID, reminder: secondReminder })).ok, true);
  assert.ok(runtime.alarmStore.has(`tabwall-reminder:${NOTE_ID}`));
  assert.ok(runtime.alarmStore.has(`tabwall-reminder:${SOURCE_ID}`));
  assert.equal((await dispatchMessage(runtime, { type: 'CLEAR_REMINDER', id: NOTE_ID })).ok, true);
  assert.equal(runtime.alarmStore.has(`tabwall-reminder:${NOTE_ID}`), false);
  assert.ok(runtime.alarmStore.has(`tabwall-reminder:${SOURCE_ID}`));
  const items = await runtime.api.getParkedItems();
  assert.equal(items.find((item) => item.id === NOTE_ID).reminder, undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify(items.find((item) => item.id === SOURCE_ID).reminder)),
    secondReminder
  );

  const nested = note(TARGET_ID, { attachment: false });
  await runtime.api.setParkedItems([{
    kind: 'group',
    id: GROUP_ID,
    title: 'Stack',
    color: 'blue',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [],
    notes: [nested],
  }]);
  const rejected = await dispatchMessage(runtime, {
    type: 'SET_REMINDER',
    id: TARGET_ID,
    reminder: firstReminder,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'not_found');
});

test('one-shot reminder notification clears the reminder and interval reschedules from send time', async () => {
  const onceRuntime = createRuntime();
  await onceRuntime.ready;
  await onceRuntime.api.setParkedItems([{
    ...tab(ITEM_ID),
    reminder: { mode: 'once', message: '', nextAt: Date.now() - 1000 },
  }]);
  const onceResult = await onceRuntime.api.handleReminderAlarm({ name: `tabwall-reminder:${ITEM_ID}` });
  assert.equal(onceResult.ok, true);
  assert.equal(onceRuntime.notificationCalls[0].options.message, ITEM_ID);
  assert.equal((await onceRuntime.api.getParkedItems())[0].reminder, undefined);
  assert.equal(onceRuntime.alarmStore.has(`tabwall-reminder:${ITEM_ID}`), false);

  const intervalRuntime = createRuntime();
  await intervalRuntime.ready;
  await intervalRuntime.api.setParkedItems([{
    ...tab(ITEM_ID),
    reminder: { mode: 'interval', message: 'Ping', nextAt: Date.now() - 1000, intervalMinutes: 5 },
  }]);
  const before = Date.now();
  const intervalResult = await intervalRuntime.api.handleReminderAlarm({ name: `tabwall-reminder:${ITEM_ID}` });
  const stored = (await intervalRuntime.api.getParkedItems())[0];
  assert.equal(intervalResult.ok, true);
  assert.equal(stored.reminder.message, 'Ping');
  assert.ok(stored.reminder.nextAt >= before + 5 * 60 * 1000);
  assert.ok(intervalRuntime.alarmStore.get(`tabwall-reminder:${ITEM_ID}`).when >= stored.reminder.nextAt);
});

test('reminder webhook profiles send parallel POST requests and preserve one-shot lifecycle', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    webhookProfiles: [
      {
        id: 'first',
        name: 'First',
        url: 'https://first.example.test/hook',
        headers: { 'X-Profile': 'one' },
        body: '{"id":"{{id}}","title":"{{title}}","display":"{{displayTitle}}","tags":"{{tags}}"}',
      },
      {
        id: 'second',
        name: 'Second',
        url: 'https://second.example.test/hook',
        headers: { 'X-Profile': 'two' },
        body: '{{message}}|{{mode}}|{{nextAtIso}}',
      },
    ],
  };
  const started = [];
  const resolvers = [];
  let resolveStarted;
  const allStarted = new Promise((resolve) => { resolveStarted = resolve; });
  runtime.runtime.fetchImpl = (url, options) => {
    started.push({ url, options });
    if (started.length === 2) resolveStarted();
    return new Promise((resolve) => resolvers.push(() => resolve(webhookResponse(204, 'accepted'))));
  };
  await runtime.api.setParkedItems([{
    ...tab(ITEM_ID),
    displayTitle: 'Visible card',
    tags: ['one', 'two'],
    reminder: {
      mode: 'once',
      message: 'Review now',
      nextAt: Date.now() - 1000,
      webhookProfileIds: ['first', 'second'],
    },
  }]);

  const alarmPromise = runtime.api.handleReminderAlarm({ name: `tabwall-reminder:${ITEM_ID}` });
  await allStarted;
  assert.equal(started.length, 2);
  assert.equal(started[0].options.method, 'POST');
  assert.equal(started[0].options.credentials, 'omit');
  assert.equal(started[0].options.headers['X-Profile'], 'one');
  assert.equal(started[0].options.body, `{"id":"${ITEM_ID}","title":"${ITEM_ID}","display":"Visible card","tags":"one, two"}`);
  assert.match(started[1].options.body, /^Review now\|once\|/);
  resolvers.forEach((resolve) => resolve());

  const result = await alarmPromise;
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.webhooks, (entry) => entry.status), [204, 204]);
  assert.equal(runtime.notificationCalls.length, 1);
  assert.equal((await runtime.api.getParkedItems())[0].reminder, undefined);
  assert.equal(runtime.alarmStore.has(`tabwall-reminder:${ITEM_ID}`), false);
});

test('webhook failures are isolated from interval rescheduling and missing profiles', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    webhookProfiles: [
      { id: 'ok', name: 'OK', url: 'https://ok.example.test/hook', headers: {}, body: 'ok' },
      { id: 'failed', name: 'Failed', url: 'https://failed.example.test/hook', headers: {}, body: 'failed' },
      { id: 'timeout', name: 'Timeout', url: 'https://timeout.example.test/hook', headers: {}, body: 'timeout' },
    ],
  };
  runtime.core.REQUEST_TIMEOUT_MS = 10;
  runtime.runtime.fetchImpl = (url, options) => {
    if (url.includes('failed')) return Promise.resolve(webhookResponse(503, 'downstream unavailable'));
    if (url.includes('timeout')) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    return Promise.resolve(webhookResponse(200, 'ok'));
  };
  try {
    await runtime.api.setParkedItems([{
      ...tab(ITEM_ID),
      reminder: {
        mode: 'interval',
        message: 'Keep checking',
        nextAt: Date.now() - 1000,
        intervalMinutes: 5,
        webhookProfileIds: ['missing', 'ok', 'failed', 'timeout'],
      },
    }]);
    const result = await runtime.api.handleReminderAlarm({ name: `tabwall-reminder:${ITEM_ID}` });
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(result.webhooks, (entry) => entry.id), ['missing', 'ok', 'failed', 'timeout']);
    assert.equal(result.webhooks[0].skipped, true);
    assert.equal(result.webhooks[0].error, 'profile_not_found');
    assert.equal(result.webhooks[1].ok, true);
    assert.equal(result.webhooks[2].status, 503);
    assert.equal(result.webhooks[2].ok, false);
    assert.equal(result.webhooks[3].error, 'webhook_timeout');
    assert.equal(runtime.notificationCalls.length, 1);
    const stored = (await runtime.api.getParkedItems())[0];
    assert.equal(stored.reminder.message, 'Keep checking');
    assert.ok(stored.reminder.nextAt > Date.now());
    assert.ok(runtime.alarmStore.has(`tabwall-reminder:${ITEM_ID}`));
    assert.equal(runtime.runtime.fetchCalls.length, 3);
  } finally {
    runtime.core.REQUEST_TIMEOUT_MS = 15000;
  }
});

test('TEST_WEBHOOK_PROFILE posts draft data without persisting settings', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    keep: 'local-only',
    webhookProfiles: [{ id: 'saved', name: 'Saved', url: 'https://saved.example.test', headers: {}, body: 'saved' }],
  };
  const before = JSON.parse(JSON.stringify(runtime.store.settings));
  runtime.runtime.fetchImpl = (_url, options) => Promise.resolve(webhookResponse(201, 'x'.repeat(1200)));
  const result = await dispatchMessage(runtime, {
    type: 'TEST_WEBHOOK_PROFILE',
    profile: {
      id: 'draft',
      name: 'Draft',
      url: 'https://draft.example.test/test',
      headers: { 'X-Test': 'draft' },
      body: '{{id}}|{{url}}|{{tags}}',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.test, true);
  assert.equal(result.status, 201);
  assert.equal(result.responsePreview.length, 1000);
  assert.equal(runtime.runtime.fetchCalls.length, 1);
  assert.equal(runtime.runtime.fetchCalls[0][1].headers['X-Test'], 'draft');
  assert.match(runtime.runtime.fetchCalls[0][1].body, /^webhook-test\|https:\/\/example\.com\/tabwall-webhook-test\|webhook, test$/);
  assert.deepEqual(runtime.store.settings, before);
});

test('notification failure preserves reminder metadata and reports an error result', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.failNotificationCreate = true;
  const reminder = { mode: 'once', message: 'Keep me', nextAt: Date.now() - 1000 };
  await runtime.api.setParkedItems([{ ...tab(ITEM_ID), reminder }]);

  const result = await runtime.api.handleReminderAlarm({ name: `tabwall-reminder:${ITEM_ID}` });
  assert.equal(result.ok, false);
  assert.match(result.error, /notification_create_failed/);
  assert.deepEqual(JSON.parse(JSON.stringify((await runtime.api.getParkedItems())[0].reminder)), reminder);
});

test('reminder startup sync removes orphan alarms and notification click opens focused standalone TabWall', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([{
    ...tab(ITEM_ID),
    reminder: { mode: 'once', message: 'Open me', nextAt: Date.now() + 60000 },
  }]);
  runtime.alarmStore.set('tabwall-reminder:orphan', { name: 'tabwall-reminder:orphan', when: Date.now() + 60000 });

  const startup = runtime.chrome.runtime.onStartup.listeners[0];
  await startup();
  assert.equal(runtime.alarmStore.has('tabwall-reminder:orphan'), false);
  assert.equal(runtime.alarmStore.has(`tabwall-reminder:${ITEM_ID}`), true);

  const clicked = await runtime.api.handleReminderNotificationClick(`tabwall-reminder:${ITEM_ID}`);
  assert.equal(clicked, true);
  assert.match(runtime.runtime.createdTabs[0].url, /surface=standalone&focusReminder=/);
  assert.match(runtime.runtime.createdTabs[0].url, new RegExp(ITEM_ID));
});

test('reminder import syncs alarms and Stack blocks conflicts or transfers the sole reminder', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const reminder = { mode: 'once', message: 'Imported', nextAt: Date.now() + 60000 };
  const imported = await runtime.api.importBackup({
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'none',
    parkedItems: [{ ...tab(ITEM_ID), reminder }],
    parkedTabs: [],
    settings: {},
    tagCatalog: [],
  }, { mode: 'replace' });
  assert.equal(imported.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify((await runtime.api.getParkedItems())[0].reminder)), reminder);
  assert.ok(runtime.alarmStore.has(`tabwall-reminder:${ITEM_ID}`));

  const conflictRuntime = createRuntime();
  await conflictRuntime.ready;
  await conflictRuntime.api.setParkedItems([
    { ...tab(ITEM_ID), reminder },
    { ...tab(SOURCE_ID), reminder: { ...reminder, message: 'Second' } },
  ]);
  const conflict = await conflictRuntime.api.stackItems(ITEM_ID, SOURCE_ID);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'reminder_conflict');
  assert.deepEqual((await conflictRuntime.api.getParkedItems()).map((item) => item.id), [ITEM_ID, SOURCE_ID]);

  const transferRuntime = createRuntime();
  await transferRuntime.ready;
  await transferRuntime.api.setParkedItems([
    { ...tab(ITEM_ID), reminder },
    tab(SOURCE_ID),
  ]);
  const transfer = await transferRuntime.api.stackItems(ITEM_ID, SOURCE_ID);
  assert.equal(transfer.ok, true);
  const group = (await transferRuntime.api.getParkedItems())[0];
  assert.deepEqual(JSON.parse(JSON.stringify(group.reminder)), reminder);
  assert.equal(group.tabs.every((member) => member.reminder == null), true);
});

test('backup export removes webhook profiles and import preserves local profiles', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const localProfile = {
    id: 'local',
    name: 'Local profile',
    url: 'https://local.example.test/hook',
    headers: { Authorization: 'Bearer local-secret' },
    body: 'local body',
  };
  runtime.store.settings = { webhookProfiles: [localProfile] };
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  const exported = await dispatchMessage(runtime, { type: 'EXPORT_BACKUP', mode: 'lite' });
  assert.equal(exported.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.backup.settings, 'webhookProfiles'), false);

  const reminder = {
    mode: 'once',
    message: 'Imported reminder',
    nextAt: Date.now() + 60000,
    webhookProfileIds: ['local', 'missing'],
  };
  const imported = await runtime.api.importBackup({
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'none',
    parkedItems: [{ ...tab(SOURCE_ID), reminder }],
    parkedTabs: [tab(SOURCE_ID)],
    settings: {
      webhookProfiles: [{
        id: 'remote',
        name: 'Remote profile',
        url: 'https://remote.example.test/hook',
        headers: { Authorization: 'Bearer remote-secret' },
        body: 'remote body',
      }],
    },
    tagCatalog: [],
  }, { mode: 'replace' });
  assert.equal(imported.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.store.settings.webhookProfiles)), [localProfile]);
  assert.deepEqual(Array.from((await runtime.api.getParkedItems())[0].reminder.webhookProfileIds), ['local', 'missing']);
});

test('BATCH_UPDATE_ITEMS appends unique note lines and merges tags', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const withNote = tab(ITEM_ID);
  withNote.note = 'existing line\nkeep me';
  withNote.tags = ['old'];
  const other = tab(SOURCE_ID, 'https://other.example/');
  other.note = 'existing line';
  other.tags = ['keep'];
  const sticker = note(NOTE_ID, { attachment: false, tags: ['idea'] });
  sticker.markdown = 'Plain note';
  const empty = tab(TARGET_ID, 'https://empty.example/');
  await runtime.api.setParkedItems([withNote, other, sticker, empty]);

  const appended = await dispatchMessage(runtime, {
    type: 'BATCH_UPDATE_ITEMS',
    ids: [ITEM_ID, SOURCE_ID, NOTE_ID, TARGET_ID],
    note: 'existing line\nnew line',
    tags: ['keep', 'new'],
    tagMode: 'merge',
  });
  assert.equal(appended.ok, true);
  const byId = Object.fromEntries((await runtime.api.getParkedItems()).map((item) => [item.id, item]));
  assert.equal(byId[ITEM_ID].note, 'existing line\nkeep me\nnew line');
  assert.deepEqual([...byId[ITEM_ID].tags], ['old', 'keep', 'new']);
  assert.equal(byId[SOURCE_ID].note, 'existing line\nnew line');
  assert.deepEqual([...byId[SOURCE_ID].tags], ['keep', 'new']);
  assert.equal(byId[NOTE_ID].markdown, 'Plain note\nexisting line\nnew line');
  assert.ok(byId[NOTE_ID].tags.includes('idea'));
  assert.ok(byId[NOTE_ID].tags.includes('keep'));
  assert.ok(byId[NOTE_ID].tags.includes('new'));
  assert.equal(byId[TARGET_ID].note, 'existing line\nnew line');

  const emptyPatch = await dispatchMessage(runtime, {
    type: 'BATCH_UPDATE_ITEMS',
    ids: [ITEM_ID],
    note: '',
    tags: [],
    tagMode: 'merge',
  });
  assert.equal(emptyPatch.ok, true);
  const afterEmpty = (await runtime.api.getParkedItems()).find((item) => item.id === ITEM_ID);
  assert.equal(afterEmpty.note, 'existing line\nkeep me\nnew line');
  assert.deepEqual([...afterEmpty.tags], ['old', 'keep', 'new']);
});

test('UPDATE_ITEM persists displayTitle and lock fields through normalize', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  const salted = await dispatchMessage(runtime, {
    type: 'UPDATE_ITEM',
    id: ITEM_ID,
    displayTitle: 'BBB',
    locked: true,
    hideOriginalTitle: true,
    lockSalt: 'aa'.repeat(16),
    lockHash: 'bb'.repeat(32),
  });
  assert.equal(salted.ok, true);
  assert.equal(salted.item.displayTitle, 'BBB');
  assert.equal(salted.item.title, ITEM_ID);
  assert.equal(salted.item.locked, true);
  assert.equal(salted.item.hideOriginalTitle, true);
  assert.equal(salted.item.lockSalt, 'aa'.repeat(16));
  assert.equal(salted.item.lockHash, 'bb'.repeat(32));

  const sameTitle = await dispatchMessage(runtime, {
    type: 'UPDATE_ITEM',
    id: ITEM_ID,
    displayTitle: ITEM_ID,
    hideOriginalTitle: true,
  });
  assert.equal(sameTitle.ok, true);
  assert.equal(sameTitle.item.displayTitle, undefined);
  assert.equal(sameTitle.item.hideOriginalTitle, undefined);

  const relocked = await dispatchMessage(runtime, {
    type: 'UPDATE_ITEM',
    id: ITEM_ID,
    displayTitle: 'BBB',
    locked: true,
    hideOriginalTitle: true,
  });
  assert.equal(relocked.ok, true);
  assert.equal(relocked.item.hideOriginalTitle, true);

  const unlocked = await dispatchMessage(runtime, {
    type: 'UPDATE_ITEM',
    id: ITEM_ID,
    locked: false,
  });
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.item.locked, undefined);
  assert.equal(unlocked.item.lockHash, undefined);
  assert.equal(unlocked.item.hideOriginalTitle, undefined);
});

test('legacy items default top-level pinned to false and update keeps order', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([
    tab(ITEM_ID),
    {
      kind: 'group',
      id: GROUP_ID,
      title: 'Group',
      color: 'blue',
      collapsed: false,
      note: '',
      tags: [],
      savedAt: Date.now() - 1000,
      tabs: [],
    },
  ]);

  let items = await runtime.api.getParkedItems();
  assert.deepEqual(items.map((item) => item.pinned), [false, false]);

  const updated = await runtime.api.updateItem(GROUP_ID, { pinned: true });
  assert.equal(updated.ok, true);
  items = await runtime.api.getParkedItems();
  assert.deepEqual(items.map((item) => item.id), [ITEM_ID, GROUP_ID]);
  assert.deepEqual(items.map((item) => item.pinned), [false, true]);
});

test('note CRUD persists fixed metadata and cleans attachment media', async () => {
  const runtime = createRuntime();
  await runtime.ready;

  const created = await runtime.api.createNote(note(), { x: 120, y: 240, w: 280, h: 220 });
  assert.equal(created.ok, true);
  assert.equal(created.item.kind, 'note');
  assert.equal(runtime.media.has(`n:${NOTE_ID}:${NOTE_ATTACHMENT_ID}`), true);
  assert.deepEqual(
    Object.keys(runtime.store.parkedItems[0]).sort(),
    ['attachments', 'contentMode', 'id', 'kind', 'markdown', 'pinned', 'savedAt', 'tags', 'title', 'webSource'].sort()
  );

  const updated = await runtime.api.updateNote(NOTE_ID, {
    title: 'Updated note',
    markdown: 'Updated **text**',
    contentMode: 'web',
    webSource: '<!doctype html><html><head><style>button { color: blue; }</style></head><body><button>Updated</button><script>document.body.dataset.updated = "yes";</script></body></html>',
    tags: ['updated'],
    attachments: [],
  });
  assert.equal(updated.ok, true);
  assert.equal(runtime.store.parkedItems[0].title, 'Updated note');
  assert.equal(runtime.store.parkedItems[0].contentMode, 'web');
  assert.equal(runtime.store.parkedItems[0].webSource, '<!doctype html><html><head><style>button { color: blue; }</style></head><body><button>Updated</button><script>document.body.dataset.updated = "yes";</script></body></html>');
  assert.deepEqual([...runtime.store.parkedItems[0].tags], ['updated']);
  assert.equal(runtime.media.has(`n:${NOTE_ID}:${NOTE_ATTACHMENT_ID}`), false);

  const tags = await dispatchMessage(runtime, { type: 'GET_TAGS' });
  const updatedTag = tags.tags.find((entry) => entry.name === 'updated');
  assert.equal(updatedTag?.name, 'updated');
  assert.equal(updatedTag?.count, 1);
  assert.equal((await runtime.api.deleteNote(NOTE_ID)).ok, true);
  assert.equal(runtime.store.parkedItems.length, 0);
});

test('page Stickers share top-level Notes, preserve independent reminders, and detach safely', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const firstUrl = 'https://page-sticker.example/first';
  const secondUrl = 'https://page-sticker.example/second';
  const first = await runtime.api.createNotePageSticker(
    note(NOTE_ID, { attachment: false }),
    { x: 40, y: 80, w: 280, h: 220 },
    firstUrl,
    { x: 120, y: 240, w: 320, h: 240, z: 2 },
  );
  const second = await runtime.api.createNotePageSticker(
    note(SOURCE_ID, { attachment: false }),
    { x: 420, y: 480, w: 300, h: 230 },
    firstUrl,
    { x: 520, y: 640, w: 360, h: 260, z: 3 },
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const crossPage = await runtime.api.createPageSticker(secondUrl, NOTE_ID, {
    x: 16, y: 32, w: 240, h: 180, z: 1,
  });
  assert.equal(crossPage.ok, true);
  assert.equal((await runtime.api.getPageStickers(firstUrl)).stickers.length, 2);
  assert.equal((await runtime.api.getPageStickers(secondUrl)).stickers.length, 1);

  const firstReminder = { mode: 'once', message: 'First', nextAt: Date.now() + 60000 };
  const secondReminder = { mode: 'once', message: 'Second', nextAt: Date.now() + 120000 };
  assert.equal((await runtime.api.setReminder(NOTE_ID, firstReminder)).ok, true);
  assert.equal((await runtime.api.setReminder(SOURCE_ID, secondReminder)).ok, true);
  assert.equal((await runtime.api.clearReminder(NOTE_ID)).ok, true);
  const listed = await runtime.api.getPageStickers(firstUrl);
  assert.equal(listed.stickers.find((item) => item.note.id === NOTE_ID).note.reminder, undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify(listed.stickers.find((item) => item.note.id === SOURCE_ID).note.reminder)),
    secondReminder,
  );

  assert.equal((await runtime.api.deletePageSticker(firstUrl, SOURCE_ID)).removed, true);
  assert.equal((await runtime.api.getPageStickers(firstUrl)).stickers.length, 1);
  assert.equal((await runtime.api.getParkedItems()).some((item) => item.id === SOURCE_ID), true);

  assert.equal((await runtime.api.deleteNote(NOTE_ID)).ok, true);
  assert.equal((await runtime.api.getPageStickers(firstUrl)).stickers.length, 0);
  assert.equal((await runtime.api.getPageStickers(secondUrl)).stickers.length, 0);

  const nested = note(TARGET_ID, { attachment: false });
  await runtime.api.setParkedItems([{
    kind: 'group',
    id: GROUP_ID,
    title: 'Stack',
    color: 'blue',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [],
    notes: [nested],
  }]);
  const rejected = await runtime.api.createPageSticker(firstUrl, TARGET_ID, {
    x: 10, y: 10, w: 240, h: 180, z: 1,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'invalid_note_scope');
});

test('Canvas Sticker source locations reverse-index top-level Notes across URLs', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const firstUrl = 'https://source-index.example/first';
  const secondUrl = 'https://source-index.example/second';
  await runtime.api.setParkedItems([
    note(NOTE_ID, { attachment: false }),
    note(SOURCE_ID, { attachment: false }),
    {
      kind: 'group',
      id: GROUP_ID,
      title: 'Stack',
      color: 'blue',
      collapsed: false,
      note: '',
      tags: [],
      savedAt: Date.now(),
      tabs: [],
      notes: [note(TARGET_ID, { attachment: false })],
    },
  ]);
  runtime.store.pageAnnotations = [
    {
      id: 'source-index-first',
      url: firstUrl,
      title: 'First page',
      stickers: [{ noteId: NOTE_ID, x: 1, y: 2, w: 240, h: 180, z: 1 }],
    },
    {
      id: 'source-index-duplicate',
      url: firstUrl,
      title: 'Duplicate record',
      stickers: [{ noteId: NOTE_ID, x: 3, y: 4, w: 240, h: 180, z: 2 }],
    },
    {
      id: 'source-index-second',
      url: secondUrl,
      title: 'Second page',
      stickers: [
        { noteId: NOTE_ID, x: 5, y: 6, w: 240, h: 180, z: 3 },
        { noteId: SOURCE_ID, x: 7, y: 8, w: 240, h: 180, z: 4 },
        { noteId: 'deleted-note', x: 9, y: 10, w: 240, h: 180, z: 5 },
      ],
    },
  ];

  const indexed = await runtime.api.getNotePageLocations();
  assert.equal(indexed.ok, true);
  const routed = await dispatchMessage(runtime, { type: 'GET_NOTE_PAGE_LOCATIONS' });
  assert.equal(routed.ok, true);
  assert.deepEqual(routed.locations, indexed.locations);
  assert.deepEqual(JSON.parse(JSON.stringify(indexed.locations)), [
    {
      noteId: NOTE_ID,
      pages: [
        { url: firstUrl, title: 'First page' },
        { url: secondUrl, title: 'Second page' },
      ],
    },
    { noteId: SOURCE_ID, pages: [{ url: secondUrl, title: 'Second page' }] },
  ]);

  runtime.store.pageAnnotations = runtime.store.pageAnnotations.filter((entry) => entry.id !== 'source-index-duplicate');
  assert.equal((await runtime.api.deletePageSticker(firstUrl, NOTE_ID)).removed, true);
  const afterDetach = await runtime.api.getNotePageLocations();
  assert.deepEqual(JSON.parse(JSON.stringify(afterDetach.locations[0].pages)), [{ url: secondUrl, title: 'Second page' }]);

  assert.equal((await runtime.api.deleteNote(NOTE_ID)).ok, true);
  const afterDelete = await runtime.api.getNotePageLocations();
  assert.equal(afterDelete.locations.some((entry) => entry.noteId === NOTE_ID), false);
});

test('Canvas Sticker source links always open a new tab', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const url = 'https://source-open.example/page';
  runtime.runtime.openTabs.push({ id: 901, url, windowId: 1, active: true });

  const result = await dispatchMessage(runtime, { type: 'OPEN_NEW_TAB_URL', url });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(runtime.runtime.createdTabs.length, 1);
  assert.equal(runtime.runtime.createdTabs[0].url, url);
  assert.equal(runtime.runtime.createdTabs[0].active, true);

  const invalid = await runtime.api.openUrlInNewTab('');
  assert.deepEqual(JSON.parse(JSON.stringify(invalid)), { ok: false, error: 'invalid_url' });
});

test('page Sticker editor and reminder requests bridge to the sender tab', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const sender = { tab: { id: 77 }, frameId: 0 };
  const placement = { x: 20, y: 40, w: 240, h: 180, z: 1, noteId: '' };
  const editor = await dispatchMessage(runtime, {
    type: 'OPEN_PAGE_STICKER_EDITOR',
    url: 'https://page-sticker.example/',
    noteId: '',
    placement,
  }, sender);
  const reminder = await dispatchMessage(runtime, {
    type: 'OPEN_PAGE_STICKER_REMINDER',
    url: 'https://page-sticker.example/',
    noteId: NOTE_ID,
  }, sender);
  assert.equal(editor.ok, true);
  assert.equal(reminder.ok, true);
  assert.equal(JSON.stringify(runtime.runtime.tabMessages), JSON.stringify([
    {
      tabId: 77,
      message: {
        type: 'OPEN_PAGE_STICKER_EDITOR',
        url: 'https://page-sticker.example/',
        noteId: '',
        placement,
      },
    },
    {
      tabId: 77,
      message: {
        type: 'OPEN_PAGE_STICKER_REMINDER',
        url: 'https://page-sticker.example/',
        noteId: NOTE_ID,
      },
    },
  ]));
});

test('CREATE_IMAGE_CARD stores a tab with cardSource image and no restorable URL', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const created = await runtime.api.createImageCard({
    title: 'clip',
    thumbnail: 'data:image/jpeg;base64,AAAA',
    snapshot: 'data:image/jpeg;base64,BBBB',
  }, { x: 40, y: 80 });
  assert.equal(created.ok, true);
  assert.equal(created.item.kind, 'tab');
  assert.equal(created.item.cardSource, 'image');
  assert.equal(created.item.url, '');
  assert.equal(created.item.hasThumb, true);
  assert.equal(created.item.hasSnap, true);
  assert.equal(runtime.media.has(`t:${created.item.id}`), true);
  const restored = await runtime.api.restoreTab(created.item.id);
  assert.equal(restored.ok, false);
  assert.equal(restored.error, 'image_not_restorable');
  const items = await runtime.api.getParkedItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].cardSource, 'image');
  const layout = await runtime.api.getCanvasLayout();
  assert.equal(layout.positions[created.item.id].x, 40);
  assert.equal(layout.positions[created.item.id].y, 80);
  assert.equal(layout.positions[created.item.id].h, 248);
});

test('attachment usage reports note and global quotas and rejects a full note', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const rejected = await runtime.api.createNote(quotaNoteForTest(NOTE_ID, 5));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'attachment_quota_exceeded');
  assert.equal(runtime.store.parkedItems?.length || 0, 0);

  const created = await runtime.api.createNote(note());
  assert.equal(created.ok, true);
  const usage = await dispatchMessage(runtime, {
    type: 'GET_ATTACHMENT_USAGE',
    noteId: NOTE_ID,
  });
  assert.equal(usage.ok, true);
  assert.equal(usage.noteBytes, 3);
  assert.equal(usage.usedBytes, 3);
  assert.equal(usage.noteMaxBytes, 96 * 1024 * 1024);
  assert.equal(usage.maxBytes, 512 * 1024 * 1024);
});

test('global attachment quota includes notes nested in mixed Stacks', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.createNote(note());
  await runtime.api.setParkedItems([tab(ITEM_ID), ...(await runtime.api.getParkedItems())]);
  const stacked = await runtime.api.stackItems(ITEM_ID, NOTE_ID);
  assert.equal(stacked.ok, true);
  const usage = await dispatchMessage(runtime, {
    type: 'GET_ATTACHMENT_USAGE',
    noteId: NOTE_ID,
    groupId: stacked.groupId,
  });
  assert.equal(usage.noteBytes, 3);
  assert.equal(usage.usedBytes, 3);
});

test('global attachment quota rejects the sixth 96MiB note', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  for (let index = 0; index < 5; index++) {
    const id = `${String(index + 1).padStart(8, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
    assert.equal((await runtime.api.createNote(quotaNoteForTest(id))).ok, true);
  }
  const rejected = await runtime.api.createNote(
    quotaNoteForTest('00000006-cccc-4ccc-8ccc-cccccccccccc')
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'attachment_quota_exceeded');
  const usage = await dispatchMessage(runtime, { type: 'GET_ATTACHMENT_USAGE' });
  assert.equal(usage.usedBytes, 5 * 96 * 1024 * 1024);
});

test('full import quota failure is atomic', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  const incoming = quotaNoteForTest(NOTE_ID, 5);
  const result = await runtime.api.importBackup({
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'inline',
    parkedItems: [incoming],
    parkedTabs: [],
    settings: {},
    tagCatalog: [],
  }, { mode: 'replace' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'attachment_quota_exceeded');
  assert.deepEqual(runtime.store.parkedItems.map((item) => item.id), [ITEM_ID]);
  assert.equal(runtime.media.size, 0);
});

test('Stack supports mixed tabs and notes as Canvas-only group members', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.createNote(note());
  await runtime.api.setParkedItems([tab(ITEM_ID), ...(await runtime.api.getParkedItems())]);

  const result = await runtime.api.stackItems(ITEM_ID, NOTE_ID);
  assert.equal(result.ok, true);
  const group = runtime.store.parkedItems[0];
  assert.equal(group.kind, 'group');
  assert.equal(group.tabs.length, 1);
  assert.equal(group.notes.length, 1);
  assert.equal(group.notes[0].id, NOTE_ID);
  assert.equal(runtime.media.has(`n:${NOTE_ID}:${NOTE_ATTACHMENT_ID}`), true);
});

test('restoring a mixed Stack keeps notes after browser tabs are restored', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const groupNote = note();
  delete groupNote.attachments[0].data;
  const group = {
    kind: 'group',
    id: GROUP_ID,
    title: 'Mixed group',
    color: 'blue',
    collapsed: false,
    pinned: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [{ ...tab(GROUP_HTTP_MEMBER_ID), indexInGroup: 0 }],
    notes: [groupNote],
  };
  await runtime.api.setParkedItems([group]);
  runtime.media.set(`n:${NOTE_ID}:${NOTE_ATTACHMENT_ID}`, { attachment: 'attachment-bytes' });

  const restored = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.notesRemaining, 1);
  assert.equal(runtime.runtime.createdTabs.length, 1);
  assert.equal(runtime.store.parkedItems.length, 1);
  assert.equal(runtime.store.parkedItems[0].kind, 'group');
  assert.equal(runtime.store.parkedItems[0].tabs.length, 1);
  assert.equal(runtime.store.parkedItems[0].notes.length, 1);
  assert.equal(runtime.media.has(`n:${NOTE_ID}:${NOTE_ATTACHMENT_ID}`), true);
  const repeated = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.reused, 1);
});

test('append import remints note and attachment IDs and rewrites Markdown tokens', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const backup = {
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'inline',
    parkedItems: [note()],
    parkedTabs: [],
    settings: {},
    tagCatalog: ['idea'],
    pageAnnotations: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      url: 'https://import-sticker.example/',
      title: 'Imported Sticker',
      favIconUrl: '',
      note: '',
      tags: [],
      overlayVisible: true,
      hasInk: false,
      stickers: [{ noteId: NOTE_ID, x: 20, y: 40, w: 240, h: 180, z: 1 }],
      updatedAt: Date.now(),
    }],
  };
  backup.parkedItems[0].contentMode = 'web';
  backup.parkedItems[0].webSource = '<!doctype html><html><head><style>h1 { color: green; }</style></head><body><h1>Imported</h1><script>document.body.dataset.imported = "yes";</script></body></html>';

  assert.equal((await runtime.api.importBackup(backup, { mode: 'replace' })).ok, true);
  assert.equal((await runtime.api.importBackup(backup, { mode: 'append' })).ok, true);
  const notes = runtime.store.parkedItems.filter((item) => item.kind === 'note');
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0].id, notes[1].id);
  assert.notEqual(notes[0].attachments[0].id, notes[1].attachments[0].id);
  assert.match(notes[1].markdown, new RegExp(`attachment://${notes[1].attachments[0].id}`));
  assert.equal(notes[1].contentMode, 'web');
  assert.equal(notes[1].webSource, backup.parkedItems[0].webSource);
  const importedStickers = await runtime.api.getPageStickers('https://import-sticker.example/');
  assert.equal(importedStickers.ok, true);
  assert.equal(importedStickers.stickers.length, 2);
  assert.deepEqual(
    new Set(importedStickers.stickers.map((item) => item.note.id)),
    new Set(notes.map((item) => item.id)),
  );
  assert.equal(runtime.media.has(`n:${notes[0].id}:${notes[0].attachments[0].id}`), true);
  assert.equal(runtime.media.has(`n:${notes[1].id}:${notes[1].attachments[0].id}`), true);
});

test('canvas layout defaults missing positions and normalizes bounds', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID), tab(SOURCE_ID)]);

  const initial = await runtime.api.getCanvasLayout();
  assert.equal(initial.version, 1);
  assert.equal(initial.viewport.x, 0);
  assert.equal(initial.viewport.y, 0);
  assert.equal(initial.viewport.zoom, 1);
  assert.deepEqual(Object.keys(initial.positions), [ITEM_ID, SOURCE_ID]);

  const normalized = await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 999999, y: 'bad', zoom: 0 },
    positions: {
      [ITEM_ID]: { x: 12, y: 24, w: 999, h: 1, z: -4 },
      [SOURCE_ID]: null,
      'unknown-id': { x: 80, y: 80, w: 220, h: 170, z: 2 },
    },
  });
  assert.equal(normalized.viewport.x, 100000);
  assert.equal(normalized.viewport.y, 0);
  assert.equal(normalized.viewport.zoom, 0.25);
  assert.equal(normalized.positions[ITEM_ID].w, 640);
  assert.equal(normalized.positions[ITEM_ID].h, 120);
  assert.equal(normalized.positions[ITEM_ID].z, 0);
  assert.equal(normalized.positions[SOURCE_ID].x, 752);
  assert.equal(normalized.positions['unknown-id'], undefined);
});

test('newly saved tabs stay near the existing canvas cluster without overlap', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([
    tab(ITEM_ID, 'https://existing-one.example/'),
    tab(SOURCE_ID, 'https://existing-two.example/'),
  ]);
  await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    positions: {
      [ITEM_ID]: { x: 2400, y: 1800, w: 220, h: 170, z: 7 },
      [SOURCE_ID]: { x: 2738, y: 1800, w: 220, h: 170, z: 8 },
    },
  });

  const first = await runtime.api.commitSaveTab({
    windowId: null,
    url: 'https://saved-one.example/',
    title: 'Saved one',
    favIconUrl: '',
  }, { afterSave: 'keep' });
  const second = await runtime.api.commitSaveTab({
    windowId: null,
    url: 'https://saved-two.example/',
    title: 'Saved two',
    favIconUrl: '',
  }, { afterSave: 'keep' });
  const third = await runtime.api.commitSaveTab({
    windowId: null,
    url: 'https://saved-three.example/',
    title: 'Saved three',
    favIconUrl: '',
  }, { afterSave: 'keep' });
  const layout = await runtime.api.getCanvasLayout();
  const rect = (position) => ({
    x: position.x,
    y: position.y,
    w: position.w * 1.1,
    h: position.h * 1.1,
  });
  const overlaps = (left, right) => (
    left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y
  );
  const ids = [ITEM_ID, SOURCE_ID, first.id, second.id, third.id];
  const rects = ids.map((id) => rect(layout.positions[id]));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(layout.positions[ITEM_ID])), {
    x: 2400,
    y: 1800,
    w: 220,
    h: 170,
    z: 7,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(layout.positions[SOURCE_ID])), {
    x: 2738,
    y: 1800,
    w: 220,
    h: 170,
    z: 8,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify([first.id, second.id, third.id].map((id) => layout.positions[id]))),
    [
      { x: 3140, y: 1800, w: 220, h: 170, z: 9 },
      { x: 3510, y: 1800, w: 220, h: 170, z: 10 },
      { x: 2400, y: 2115, w: 220, h: 170, z: 11 },
    ]
  );
  assert.equal(new Set(rects.map(({ x, y }) => `${x},${y}`)).size, rects.length);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.equal(overlaps(rects[i], rects[j]), false);
    }
  }
  assert.ok(layout.positions[first.id].x > layout.positions[SOURCE_ID].x);
  assert.ok(layout.positions[second.id].x > layout.positions[first.id].x);
  assert.ok(layout.positions[third.id].y > layout.positions[ITEM_ID].y);
  assert.ok(layout.positions[first.id].z > layout.positions[SOURCE_ID].z);
  assert.ok(layout.positions[second.id].z > layout.positions[first.id].z);
  assert.ok(layout.positions[third.id].z > layout.positions[second.id].z);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await runtime.api.getCanvasLayout())),
    JSON.parse(JSON.stringify(layout))
  );
});

test('canvas initial center is reported once and does not follow Reset View', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID), tab(SOURCE_ID)]);

  const initial = await dispatchMessage(runtime, { type: 'GET_CANVAS_LAYOUT' });
  assert.equal(initial.ok, true);
  assert.equal(initial.needsInitialCenter, true);
  assert.equal(runtime.store.canvasInitialCenterMigratedV2, false);

  const centered = await dispatchMessage(runtime, {
    type: 'PATCH_CANVAS_LAYOUT',
    baseRevision: initial.revision,
    layout: {
      ...initial.layout,
      viewport: { x: 140, y: 90, zoom: 1 },
    },
  });
  assert.equal(centered.ok, true);
  assert.equal(runtime.store.canvasInitialCenterMigratedV2, true);

  const reset = await dispatchMessage(runtime, {
    type: 'PATCH_CANVAS_LAYOUT',
    baseRevision: centered.revision,
    layout: {
      ...centered.layout,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  assert.equal(reset.ok, true);
  const afterReset = await dispatchMessage(runtime, { type: 'GET_CANVAS_LAYOUT' });
  assert.equal(afterReset.needsInitialCenter, false);
  assert.equal(afterReset.layout.viewport.x, 0);
  assert.equal(afterReset.layout.viewport.y, 0);
});

test('canvas default layout retries initial centering after the legacy marker migration', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  runtime.store.canvasInitialCenterMigratedV1 = true;
  delete runtime.store.canvasInitialCenterMigratedV2;

  const initial = await dispatchMessage(runtime, { type: 'GET_CANVAS_LAYOUT' });
  assert.equal(initial.ok, true);
  assert.equal(initial.needsInitialCenter, true);

  const centered = await dispatchMessage(runtime, {
    type: 'PATCH_CANVAS_LAYOUT',
    baseRevision: initial.revision,
    layout: {
      ...initial.layout,
      viewport: { x: 140, y: 90, zoom: 1 },
    },
  });
  assert.equal(centered.ok, true);
  assert.equal(runtime.store.canvasInitialCenterMigratedV2, true);
});

test('custom layout and imported viewport never request initial centering', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 12, y: 24, zoom: 1 },
    positions: { [ITEM_ID]: { x: 420, y: 360, w: 220, h: 170, z: 0 } },
  });

  const custom = await dispatchMessage(runtime, { type: 'GET_CANVAS_LAYOUT' });
  assert.equal(custom.needsInitialCenter, false);

  const backup = {
    format: 'tabwall-backup',
    version: 4,
    media: 'none',
    parkedItems: [tab(SOURCE_ID)],
    parkedTabs: [tab(SOURCE_ID)],
    settings: {},
    tagCatalog: [],
    canvasLayout: {
      version: 1,
      viewport: { x: 900, y: 700, zoom: 0.8 },
      positions: { [SOURCE_ID]: { x: 20, y: 30, w: 220, h: 170, z: 0 } },
    },
  };
  const imported = await dispatchMessage(runtime, { type: 'IMPORT_BACKUP', backup, mode: 'replace' });
  assert.equal(imported.ok, true);
  const afterImport = await dispatchMessage(runtime, { type: 'GET_CANVAS_LAYOUT' });
  assert.equal(afterImport.needsInitialCenter, false);
  assert.equal(afterImport.layout.viewport.x, 900);
  assert.equal(afterImport.layout.viewport.y, 700);
  const exported = await dispatchMessage(runtime, { type: 'EXPORT_BACKUP', mode: 'lite' });
  assert.equal(exported.ok, true);
  assert.equal('canvasInitialCenterMigratedV2' in exported.backup, false);
});

test('canvas layout migrates the legacy default zoom only once', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  delete runtime.store.canvasZoomDefaultMigratedV1;
  runtime.store.canvasLayout = {
    version: 1,
    viewport: { x: 12, y: 24, zoom: 0.76 },
    positions: {},
  };

  const migrated = await runtime.api.getCanvasLayout();
  assert.equal(migrated.viewport.zoom, 1);
  assert.equal(runtime.store.canvasZoomDefaultMigratedV1, true);

  runtime.store.canvasLayout.viewport.zoom = 0.76;
  const preserved = await runtime.api.getCanvasLayout();
  assert.equal(preserved.viewport.zoom, 0.76);

  delete runtime.store.canvasLayoutRevision;
  const markerWins = await runtime.api.getCanvasLayout();
  assert.equal(markerWins.viewport.zoom, 0.76);
});

test('canvas layout preserves a custom zoom during default migration', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  delete runtime.store.canvasZoomDefaultMigratedV1;
  runtime.store.canvasLayout = {
    version: 1,
    viewport: { x: 12, y: 24, zoom: 1.35 },
    positions: {},
  };

  const layout = await runtime.api.getCanvasLayout();
  assert.equal(layout.viewport.zoom, 1.35);
  assert.equal(runtime.store.canvasZoomDefaultMigratedV1, true);
});

test('canvas layout GET and PATCH use a monotonic compare-and-set revision', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  const initial = await dispatchMessage(runtime, { type: 'GET_CANVAS_LAYOUT' });
  assert.equal(initial.ok, true);
  assert.equal(typeof initial.revision, 'number');

  const first = await dispatchMessage(runtime, {
    type: 'PATCH_CANVAS_LAYOUT',
    baseRevision: initial.revision,
    layout: {
      version: 1,
      viewport: { x: 40, y: 20, zoom: 1.25 },
      positions: { [ITEM_ID]: { x: 120, y: 240, w: 220, h: 170, z: 0 } },
    },
  });
  assert.equal(first.ok, true);
  assert.equal(first.revision, initial.revision + 1);

  const beforeConflict = JSON.parse(JSON.stringify(runtime.store.canvasLayout));
  const conflict = await dispatchMessage(runtime, {
    type: 'PATCH_CANVAS_LAYOUT',
    baseRevision: initial.revision,
    layout: {
      version: 1,
      viewport: { x: 999, y: 999, zoom: 2 },
      positions: {},
    },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'canvas_conflict');
  assert.equal(conflict.revision, first.revision);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.store.canvasLayout)), beforeConflict);

  const legacy = await dispatchMessage(runtime, {
    type: 'PATCH_CANVAS_LAYOUT',
    layout: first.layout,
  });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.revision, first.revision + 1);

  const backup = await dispatchMessage(runtime, { type: 'EXPORT_BACKUP', mode: 'lite' });
  assert.equal(backup.ok, true);
  assert.equal('canvasLayoutRevision' in backup.backup, false);
});

test('CREATE_STACK keeps item metadata and remaps the canvas anchor', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const first = tab(ITEM_ID);
  first.note = 'first note';
  first.tags = ['one'];
  const second = tab(SOURCE_ID, 'https://second.example/');
  await runtime.api.setParkedItems([first, second]);
  await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 20, y: 30, zoom: 0.9 },
    positions: {
      [ITEM_ID]: { x: 120, y: 240, w: 220, h: 170, z: 1 },
      [SOURCE_ID]: { x: 420, y: 240, w: 220, h: 170, z: 2 },
    },
  });

  const result = await runtime.api.createStack([ITEM_ID, SOURCE_ID], '工作 Stack');
  assert.equal(result.ok, true);
  assert.equal(result.item.title, '工作 Stack');
  assert.equal(result.item.tabs.length, 2);
  assert.equal(result.item.tabs[0].note, 'first note');
  assert.deepEqual([...result.item.tabs[0].tags], ['one']);

  const layout = await runtime.api.getCanvasLayout();
  assert.equal(layout.viewport.x, 20);
  assert.equal(layout.viewport.y, 30);
  assert.equal(layout.viewport.zoom, 0.9);
  assert.deepEqual(Object.keys(layout.positions), [result.groupId]);
  assert.equal(layout.positions[result.groupId].x, 120);
  assert.equal(layout.positions[result.groupId].y, 240);
  assert.equal(layout.positions[result.groupId].w, 220);
  assert.equal(layout.positions[result.groupId].h, 170);
  assert.equal(layout.positions[result.groupId].z, 1);
});

test('canvas layout PATCH normalizes persistent connections', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID), tab(SOURCE_ID), tab(TARGET_ID)]);
  const result = await runtime.api.patchCanvasLayout({
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    positions: {},
    connections: [
      { sourceId: SOURCE_ID, targetId: ITEM_ID, curveOffset: { x: 32, y: -16 } },
      { sourceId: ITEM_ID, targetId: SOURCE_ID },
      { sourceId: ITEM_ID, targetId: ITEM_ID },
      { sourceId: ITEM_ID, targetId: 'not-an-item' },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.layout.connections)), [{
    sourceId: ITEM_ID,
    targetId: SOURCE_ID,
    curveOffset: { x: 32, y: -16 },
  }]);
});

test('Stack merge remaps connection endpoints and removes self or duplicate links', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID), tab(SOURCE_ID), tab(TARGET_ID), tab(GROUP_HTTP_MEMBER_ID)]);
  await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    positions: {
      [ITEM_ID]: { x: 100, y: 100, w: 220, h: 170, z: 0 },
      [SOURCE_ID]: { x: 400, y: 100, w: 220, h: 170, z: 1 },
      [TARGET_ID]: { x: 700, y: 100, w: 220, h: 170, z: 2 },
      [GROUP_HTTP_MEMBER_ID]: { x: 1000, y: 100, w: 220, h: 170, z: 3 },
    },
    connections: [
      { sourceId: ITEM_ID, targetId: TARGET_ID, curveOffset: { x: 48, y: 12 } },
      { sourceId: SOURCE_ID, targetId: TARGET_ID, curveOffset: { x: -24, y: 16 } },
      { sourceId: ITEM_ID, targetId: SOURCE_ID },
      { sourceId: TARGET_ID, targetId: GROUP_HTTP_MEMBER_ID, curveOffset: { x: 60, y: -30 } },
    ],
  });
  const result = await runtime.api.stackItems(ITEM_ID, SOURCE_ID);
  assert.equal(result.ok, true);
  const layout = await runtime.api.getCanvasLayout();
  const [sourceId, targetId] = [result.groupId, TARGET_ID].sort();
  const normalizedConnections = JSON.parse(JSON.stringify(layout.connections));
  assert.deepEqual(normalizedConnections.find((connection) => (
    [connection.sourceId, connection.targetId].includes(result.groupId)
      && [connection.sourceId, connection.targetId].includes(TARGET_ID)
  )), { sourceId, targetId });
  assert.deepEqual(normalizedConnections.find((connection) => connection.sourceId === GROUP_HTTP_MEMBER_ID || connection.targetId === GROUP_HTTP_MEMBER_ID), {
    sourceId: TARGET_ID,
    targetId: GROUP_HTTP_MEMBER_ID,
    curveOffset: { x: 60, y: -30 },
  });
});

test('STACK_ITEMS undo restores items, keeps later moves, and retains old media', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID), tab(SOURCE_ID), tab(TARGET_ID)]);
  runtime.media.set(`t:${ITEM_ID}`, { thumb: 'item', snap: 'item' });
  runtime.media.set(`t:${SOURCE_ID}`, { thumb: 'source', snap: 'source' });
  await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    positions: {
      [ITEM_ID]: { x: 100, y: 100, w: 220, h: 170, z: 0 },
      [SOURCE_ID]: { x: 400, y: 100, w: 220, h: 170, z: 1 },
      [TARGET_ID]: { x: 700, y: 100, w: 220, h: 170, z: 2 },
    },
    connections: [
      { sourceId: ITEM_ID, targetId: TARGET_ID, curveOffset: { x: 48, y: 12 } },
    ],
  });

  const stacked = await runtime.api.stackItems(ITEM_ID, SOURCE_ID);
  assert.equal(stacked.ok, true);
  assert.equal(typeof stacked.undoToken, 'string');
  assert.equal(runtime.media.has(`t:${ITEM_ID}`), true);
  assert.equal(runtime.media.has(`t:${SOURCE_ID}`), true);
  assert.ok([...runtime.media.keys()].some((key) => key.startsWith(`g:${stacked.groupId}:`)));

  const afterStack = await runtime.api.getCanvasLayout();
  afterStack.positions[TARGET_ID] = { x: 900, y: 240, w: 220, h: 170, z: 2 };
  afterStack.viewport = { x: 12, y: 34, zoom: 1.2 };
  await runtime.api.setCanvasLayout(afterStack);

  const undone = await runtime.api.undoStack(stacked.undoToken);
  assert.equal(undone.ok, true);
  const items = await runtime.api.getParkedItems();
  assert.deepEqual(JSON.parse(JSON.stringify(items.map((item) => item.id).sort())), [ITEM_ID, SOURCE_ID, TARGET_ID].sort());
  const layout = await runtime.api.getCanvasLayout();
  assert.equal(layout.viewport.x, 12);
  assert.equal(layout.viewport.zoom, 1.2);
  assert.equal(layout.positions[TARGET_ID].x, 900);
  assert.equal(layout.positions[ITEM_ID].x, 100);
  assert.equal(layout.positions[SOURCE_ID].x, 400);
  assert.equal(Boolean(layout.positions[stacked.groupId]), false);
  assert.deepEqual(JSON.parse(JSON.stringify(layout.connections)), [{
    sourceId: ITEM_ID,
    targetId: TARGET_ID,
    curveOffset: { x: 48, y: 12 },
  }]);
  assert.equal(runtime.media.has(`t:${ITEM_ID}`), true);
  assert.equal(runtime.media.has(`t:${SOURCE_ID}`), true);

  const redone = await runtime.api.redoStack(stacked.undoToken);
  assert.equal(redone.ok, true);
  const redoneItems = await runtime.api.getParkedItems();
  assert.equal(redoneItems.length, 2);
  assert.equal(redoneItems.some((item) => item.id === stacked.groupId), true);
  assert.equal(redoneItems.some((item) => item.id === TARGET_ID), true);
});

test('CREATE_STACK undo restores the original cards', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID), tab(SOURCE_ID)]);
  await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 20, y: 30, zoom: 0.9 },
    positions: {
      [ITEM_ID]: { x: 120, y: 240, w: 220, h: 170, z: 1 },
      [SOURCE_ID]: { x: 420, y: 240, w: 220, h: 170, z: 2 },
    },
  });
  const created = await runtime.api.createStack([ITEM_ID, SOURCE_ID], '工作 Stack');
  assert.equal(created.ok, true);
  assert.equal(typeof created.undoToken, 'string');
  const undone = await runtime.api.undoStack(created.undoToken);
  assert.equal(undone.ok, true);
  const items = await runtime.api.getParkedItems();
  assert.deepEqual(JSON.parse(JSON.stringify(items.map((item) => item.id).sort())), [ITEM_ID, SOURCE_ID].sort());
});

test('overlay quick save uses the content sender tab', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = { preSaveEdit: false };
  runtime.runtime.activeTabs = [{ id: 90, windowId: 1, url: 'https://wrong.example/' }];

  const result = await dispatchMessage(
    runtime,
    { type: 'SAVE_TAB_FROM_CONTENT' },
    { tab: { id: 91, windowId: 1, url: 'https://sender.example/', title: 'Sender tab' } }
  );

  assert.equal(result.ok, true);
  assert.equal(runtime.store.parkedItems[0].url, 'https://sender.example/');
});

test('standalone quick save rejects TabWall and restricted URLs', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 92, windowId: 1, url: 'chrome-extension://test/park.html?surface=standalone' }];
  let result = await dispatchMessage(runtime, { type: 'SAVE_ACTIVE_TAB' });
  assert.equal(result.error, 'self_tab');
  assert.equal(runtime.store.parkedItems.length, 0);

  runtime.runtime.activeTabs = [{ id: 93, windowId: 1, url: 'chrome://extensions/' }];
  result = await dispatchMessage(runtime, { type: 'SAVE_ACTIVE_TAB' });
  assert.equal(result.error, 'restricted_url');
  assert.equal(runtime.store.parkedItems.length, 0);
});

test('toggle keeps the overlay path for regular HTTPS tabs', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 7, windowId: 1, url: 'https://example.com/' }];

  const result = await runtime.api.toggleParkOnActiveTab();

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'overlay');
  assert.equal(result.tabId, 7);
  assert.equal(runtime.runtime.createdTabs.length, 0);
});

test('active-tab actions prefer the last focused Edge window', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [];
  runtime.runtime.lastFocusedTabs = [{ id: 14, windowId: 2, url: 'https://last-focused.example/' }];

  const result = await runtime.api.handleCommandAction('toggle-park');

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'overlay');
  assert.equal(result.tabId, 14);
});

test('toggle opens a standalone page for restricted tabs', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 8, windowId: 1, url: 'chrome://extensions/' }];

  const result = await runtime.api.toggleParkOnActiveTab();

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'standalone');
  assert.equal(result.created, true);
  assert.equal(
    runtime.runtime.createdTabs[0].url,
    'chrome-extension://test/park.html?surface=standalone'
  );
});

test('toggle falls back to a standalone page when content injection fails', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 9, windowId: 1, url: 'https://example.com/' }];
  runtime.runtime.failSendMessage = true;
  runtime.runtime.failExecuteScript = true;

  const result = await runtime.api.toggleParkOnActiveTab();

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'standalone');
  assert.equal(runtime.runtime.createdTabs[0].url, 'chrome-extension://test/park.html?surface=standalone');
});

test('toggle reuses an existing standalone page instead of creating a duplicate', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 10, windowId: 1, url: 'chrome://extensions/' }];
  runtime.runtime.parkTabs = [{
    id: 110,
    windowId: 2,
    url: 'chrome-extension://test/park.html?surface=standalone',
  }];

  const result = await runtime.api.toggleParkOnActiveTab();

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'standalone');
  assert.equal(result.reused, true);
  assert.equal(result.tabId, 110);
  assert.equal(runtime.runtime.createdTabs.length, 0);
  assert.equal(runtime.runtime.updatedTabs.length, 1);
  assert.equal(runtime.runtime.updatedTabs[0].id, 110);
  assert.equal(runtime.runtime.updatedTabs[0].info.active, true);
  assert.equal(runtime.runtime.updatedWindows.length, 1);
  assert.equal(runtime.runtime.updatedWindows[0].id, 2);
  assert.equal(runtime.runtime.updatedWindows[0].info.focused, true);
});

test('toggle does not duplicate a TabWall page that is already active', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 11, windowId: 1, url: 'chrome-extension://test/park.html' }];

  const result = await runtime.api.toggleParkOnActiveTab();

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'already-open');
  assert.equal(result.tabId, 11);
  assert.equal(runtime.runtime.createdTabs.length, 0);
});

test('toggle-park command uses the same restricted-page fallback', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 12, windowId: 1, url: 'chrome://extensions/' }];

  const result = await runtime.api.handleCommandAction('toggle-park');

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'standalone');
  assert.equal(runtime.runtime.createdTabs[0].url, 'chrome-extension://test/park.html?surface=standalone');
});

test('native Option+O command uses one toggle path and debounce guard', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.activeTabs = [{ id: 13, windowId: 1, url: 'https://toggle-command.example/' }];

  const first = await runtime.api.handleCommandAction('toggle-park');
  assert.equal(first.ok, true);
  assert.equal(first.mode, 'overlay');

  const duplicate = await runtime.api.handleCommandAction('toggle-park');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'debounced');
});

test('background no longer exposes a content-script Option+O action message', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const result = await dispatchMessage(runtime, { type: 'TOGGLE_PARK_ACTIVE' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unknown_type');
});

test('open-ai command toggles the external panel on normal pages and notifies on restricted pages', async () => {
  const normal = createRuntime();
  await normal.ready;
  normal.runtime.activeTabs = [{ id: 121, windowId: 1, url: 'https://ai-panel.example/' }];
  const opened = await normal.api.handleCommandAction('open-ai');
  assert.equal(opened.ok, true);
  assert.equal(opened.mode, 'panel');
  assert.equal(opened.tabId, 121);
  assert.equal(normal.runtime.tabMessages.at(-1).tabId, 121);
  assert.equal(normal.runtime.tabMessages.at(-1).message.type, 'TOGGLE_AI_PANEL');
  const closed = await normal.api.handleCommandAction('open-ai');
  assert.equal(closed.ok, true);
  assert.equal(normal.runtime.tabMessages.filter(({ message }) => message.type === 'TOGGLE_AI_PANEL').length, 2);

  const restricted = createRuntime();
  await restricted.ready;
  restricted.runtime.activeTabs = [{ id: 122, windowId: 1, url: 'chrome://extensions/' }];
  const rejected = await restricted.api.handleCommandAction('open-ai');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.mode, 'restricted');
  assert.equal(restricted.runtime.notificationCalls.length, 1);
  assert.match(restricted.runtime.notificationCalls[0].options.message, /Chrome 限制/);
});

test('replace import removes stale media for an ID with no incoming image', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  runtime.media.set(`t:${ITEM_ID}`, { thumb: 'old', snap: 'old' });

  const backup = {
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'inline',
    parkedItems: [{ ...tab(ITEM_ID), hasThumb: false, hasSnap: false, thumbnail: '', snapshot: '' }],
    tagCatalog: [],
    settings: {},
  };
  const result = await runtime.api.importBackup(backup, { mode: 'replace' });
  assert.equal(result.ok, true);
  assert.equal(runtime.media.has(`t:${ITEM_ID}`), false);
  assert.equal(runtime.store.parkedItems[0].hasThumb, false);
});

test('append import keeps the current viewport and offsets incoming canvas items', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  await runtime.api.setCanvasLayout({
    version: 1,
    viewport: { x: 88, y: 144, zoom: 1.1 },
    positions: { [ITEM_ID]: { x: 120, y: 240, w: 220, h: 170, z: 1 } },
  });

  const incoming = tab(TARGET_ID, 'https://incoming.example/');
  const incomingSecond = tab(SOURCE_ID, 'https://incoming-second.example/');
  const result = await runtime.api.importBackup({
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'none',
    parkedItems: [incoming, incomingSecond],
    parkedTabs: [incoming, incomingSecond],
    settings: {},
    tagCatalog: [],
    canvasLayout: {
      version: 1,
      viewport: { x: 900, y: 900, zoom: 0.4 },
      positions: {
        [TARGET_ID]: { x: 720, y: 360, w: 220, h: 170, z: 7 },
        [SOURCE_ID]: { x: 1020, y: 360, w: 220, h: 170, z: 8 },
      },
      connections: [{ sourceId: TARGET_ID, targetId: SOURCE_ID, curveOffset: { x: 36, y: -18 } }],
    },
  }, { mode: 'append' });
  assert.equal(result.ok, true);

  const items = await runtime.api.getParkedItems();
  const appended = items.find((item) => item.url === 'https://incoming.example/');
  const appendedSecond = items.find((item) => item.url === 'https://incoming-second.example/');
  assert.ok(appended);
  assert.ok(appendedSecond);
  const layout = await runtime.api.getCanvasLayout();
  assert.equal(layout.viewport.x, 88);
  assert.equal(layout.viewport.y, 144);
  assert.equal(layout.viewport.zoom, 1.1);
  assert.equal(layout.positions[appended.id].x, 1140);
  assert.equal(layout.positions[appended.id].y, 480);
  assert.equal(layout.positions[appended.id].w, 220);
  assert.equal(layout.positions[appended.id].h, 170);
  assert.equal(layout.positions[appended.id].z, 7);
  const [sourceId, targetId] = [appended.id, appendedSecond.id].sort();
  assert.deepEqual(JSON.parse(JSON.stringify(layout.connections)), [{
    sourceId,
    targetId,
    curveOffset: { x: 36, y: -18 },
  }]);
});

test('staged replace import commits IndexedDB media without inline message data', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const stageId = 'stage-replace';
  runtime.importStages.set(stageId, new Map([
    ['t:' + ITEM_ID, { thumb: new Blob(['thumb']), snap: new Blob(['snap']) }],
  ]));
  const backup = {
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'idb',
    parkedItems: [{ ...tab(ITEM_ID), thumbnail: '', snapshot: '' }],
    tagCatalog: [],
    settings: {},
  };

  const result = await runtime.api.importBackup(backup, { mode: 'replace', importId: stageId });
  assert.equal(result.ok, true);
  assert.equal(runtime.media.get('t:' + ITEM_ID).thumb instanceof Blob, true);
  assert.equal(runtime.store.parkedItems[0].hasThumb, true);
  assert.equal(runtime.importStages.has(stageId), false);
});

test('staged append remints IDs while preserving staged media mapping', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const stageId = 'stage-append';
  runtime.importStages.set(stageId, new Map([
    ['t:' + ITEM_ID, { thumb: new Blob(['thumb']), snap: null }],
  ]));
  const backup = {
    format: 'tabwall-backup',
    version: runtime.Build.FORMAT_VERSION,
    media: 'idb',
    parkedItems: [{ ...tab(ITEM_ID), hasSnap: false, thumbnail: '', snapshot: '' }],
    tagCatalog: [],
    settings: {},
  };

  const result = await runtime.api.importBackup(backup, { mode: 'append', importId: stageId });
  assert.equal(result.ok, true);
  const imported = runtime.store.parkedItems.find((item) => item.id !== ITEM_ID);
  assert.ok(imported);
  assert.equal(imported.hasThumb, true);
  assert.equal(runtime.media.has('t:' + imported.id), true);
  assert.equal(runtime.media.has('t:' + ITEM_ID), false);
  assert.equal(runtime.importStages.has(stageId), false);
});

test('legacy import keeps file members and group restore reports skipped count', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const savedAt = Date.now() - 1000;
  const backup = {
    format: 'tabwall-backup',
    version: 3,
    media: 'inline',
    appVersion: '2.11.1',
    exportedAt: new Date().toISOString(),
    parkedItems: [{
      kind: 'group',
      id: GROUP_ID,
      title: 'Legacy group',
      color: 'orange',
      collapsed: false,
      note: '',
      tags: [],
      savedAt,
      tabs: [
        {
          id: GROUP_HTTP_MEMBER_ID,
          url: 'https://example.com/restorable',
          title: 'HTTPS member',
          favIconUrl: '',
          pinned: false,
          indexInGroup: 0,
          note: '',
          tags: [],
          savedAt,
          hasThumb: false,
          hasSnap: false,
        },
        {
          id: GROUP_FILE_MEMBER_ID,
          url: 'file:///Users/test/legacy.html',
          title: 'File member',
          favIconUrl: '',
          pinned: false,
          indexInGroup: 1,
          note: '',
          tags: [],
          savedAt,
          hasThumb: false,
          hasSnap: false,
        },
      ],
    }],
    parkedTabs: [],
    settings: {},
    tagCatalog: [],
  };

  const imported = await runtime.api.importBackup(backup, { mode: 'replace' });
  assert.equal(imported.ok, true);
  assert.equal(imported.warnings.normalizedGroupColors, 1);
  assert.equal(imported.warnings.storedOnlyUrls, 1);
  assert.equal(runtime.store.parkedItems[0].color, 'grey');

  const restored = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.skipped, 1);
  assert.equal(runtime.runtime.createdTabs.length, 1);
  assert.equal(runtime.store.parkedItems.length, 1);
  assert.equal(runtime.store.parkedItems[0].tabs.length, 2);
});

test('service worker import accepts the local legacy full ZIP after rehydration', {
  skip: !fs.existsSync(LEGACY_ZIP),
}, async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const files = runtime.Build.unzipStore(new Uint8Array(fs.readFileSync(LEGACY_ZIP)));
  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  metadata.parkedItems = runtime.Build.rehydrateMedia(
    metadata.parkedItems,
    files,
    metadata.mediaMimes || {}
  );

  const imported = await runtime.api.importBackup(metadata, { mode: 'replace' });
  assert.equal(imported.ok, true);
  assert.equal(imported.warnings.legacyVersion, 3);
  assert.equal(imported.warnings.storedOnlyUrls, 8);
  assert.equal(runtime.store.parkedItems.length, 88);
  assert.equal(runtime.store.parkedItems.filter((item) => item.kind === 'group').length, 15);
  assert.ok(runtime.media.size > 0);
});

test('file URL remains stored but restoreTab rejects it', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID, 'file:///Users/test/legacy.html')]);
  const result = await runtime.api.restoreTab(ITEM_ID);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'restricted_url');
  assert.equal(runtime.runtime.createdTabs.length, 0);
  assert.equal(runtime.store.parkedItems.length, 1);
});

test('restore create failure retains parked metadata', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  runtime.runtime.failTabCreate = true;
  const result = await runtime.api.restoreTab(ITEM_ID);
  assert.equal(result.ok, false);
  assert.equal(runtime.store.parkedItems.length, 1);
});

test('restored tab keeps its card and focuses an existing URL on repeat', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([{
    ...tab(ITEM_ID),
    note: 'keep this note',
    tags: ['keep', 'important'],
  }]);
  runtime.media.set(`t:${ITEM_ID}`, { thumb: 'thumb', snap: 'snap' });

  const restored = await runtime.api.restoreTab(ITEM_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.kept, true);
  assert.equal(restored.created, 1);
  assert.equal(runtime.store.parkedItems.length, 1);
  assert.equal(runtime.store.parkedItems[0].note, 'keep this note');
  assert.deepEqual([...runtime.store.parkedItems[0].tags], ['keep', 'important']);
  assert.equal(runtime.media.has(`t:${ITEM_ID}`), true);

  const repeated = await runtime.api.restoreTab(ITEM_ID);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.kept, true);
  assert.equal(repeated.reused, 1);
  assert.equal(repeated.created, 0);
  assert.equal(runtime.runtime.createdTabs.length, 1);
  assert.equal(runtime.runtime.updatedTabs.at(-1).info.active, true);
});

test('restore matches the exact full URL and focuses the existing tab', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const url = 'https://exact.example/path?q=1#section';
  await runtime.api.setParkedItems([tab(ITEM_ID, url)]);
  runtime.runtime.openTabs = [{
    id: 701,
    windowId: 3,
    index: 2,
    groupId: -1,
    url,
    active: false,
  }, {
    id: 702,
    windowId: 3,
    index: 3,
    groupId: -1,
    url: 'https://exact.example/path?q=2#section',
    active: true,
  }];

  const restored = await runtime.api.restoreTab(ITEM_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.kept, true);
  assert.equal(restored.reused, 1);
  assert.equal(restored.created, 0);
  assert.equal(runtime.runtime.createdTabs.length, 0);
  assert.equal(runtime.runtime.updatedTabs.at(-1).id, 701);
  assert.equal(runtime.runtime.updatedTabs.at(-1).info.active, true);
  assert.equal(runtime.runtime.updatedWindows.at(-1).id, 3);
  assert.equal(runtime.runtime.updatedWindows.at(-1).info.focused, true);
});

test('group restore reuses matching tabs, creates missing members, and regroups them', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const group = {
    kind: 'group',
    id: GROUP_ID,
    title: 'Reuse group',
    color: 'blue',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [
      { ...tab(GROUP_HTTP_MEMBER_ID, 'https://reuse.example/a'), indexInGroup: 0 },
      { ...tab(GROUP_FILE_MEMBER_ID, 'https://reuse.example/b'), indexInGroup: 1 },
    ],
  };
  await runtime.api.setParkedItems([group]);
  runtime.runtime.openTabs = [{
    id: 710,
    windowId: 2,
    index: 0,
    groupId: 88,
    url: 'https://reuse.example/a',
    active: false,
  }];
  runtime.runtime.activeTabs = [{
    id: 711,
    windowId: 1,
    url: 'https://other.example/',
    active: true,
  }];

  const restored = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.kept, true);
  assert.equal(restored.reused, 1);
  assert.equal(restored.created, 1);
  assert.equal(restored.skipped, 0);
  assert.equal(runtime.runtime.movedTabs.length, 1);
  assert.equal(runtime.runtime.groupCalls.at(-1).tabIds.length, 2);
  assert.equal(runtime.store.parkedItems.length, 1);
  assert.equal(runtime.store.parkedItems[0].tabs.length, 2);
});

test('group duplicate URLs are matched one-to-one and preserve member count', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const url = 'https://duplicate.example/path?q=1#tab';
  await runtime.api.setParkedItems([{
    kind: 'group',
    id: GROUP_ID,
    title: 'Duplicate URLs',
    color: 'purple',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [
      { ...tab(GROUP_HTTP_MEMBER_ID, url), indexInGroup: 0 },
      { ...tab(GROUP_FILE_MEMBER_ID, url), indexInGroup: 1 },
    ],
  }]);
  runtime.runtime.activeTabs = [{ id: 718, windowId: 1, active: true, url: 'https://other.example/' }];
  runtime.runtime.openTabs = [{
    id: 719,
    windowId: 1,
    index: 0,
    groupId: -1,
    url,
  }];

  const restored = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.reused, 1);
  assert.equal(restored.created, 1);
  assert.equal(runtime.runtime.groupCalls.at(-1).tabIds.length, 2);
  assert.equal(new Set(runtime.runtime.groupCalls.at(-1).tabIds).size, 2);
  assert.equal(runtime.runtime.openTabs.filter((tab) => tab.url === url).length, 2);
});

test('new-window group restore moves matching tabs into the focused window', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([{
    kind: 'group',
    id: GROUP_ID,
    title: 'New window group',
    color: 'green',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [
      { ...tab(GROUP_HTTP_MEMBER_ID, 'https://window.example/a'), indexInGroup: 0 },
      { ...tab(GROUP_FILE_MEMBER_ID, 'https://window.example/b'), indexInGroup: 1 },
    ],
  }]);
  runtime.store.settings = { restoreGroupIn: 'newWindow' };
  runtime.runtime.openTabs = [
    { id: 720, windowId: 2, index: 0, groupId: 88, url: 'https://window.example/a' },
    { id: 721, windowId: 3, index: 0, groupId: 89, url: 'https://window.example/b' },
  ];

  const restored = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.kept, true);
  assert.equal(restored.reused, 2);
  assert.equal(restored.created, 0);
  assert.equal(runtime.runtime.movedTabs.length, 2);
  assert.ok(runtime.removedTabs.length >= 1, 'new-window placeholder should be removed');
  assert.equal(runtime.store.parkedItems.length, 1);
});

test('group restore failure rolls back moved tabs and removes only new tabs', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([{
    kind: 'group',
    id: GROUP_ID,
    title: 'Rollback group',
    color: 'red',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [
      { ...tab(GROUP_HTTP_MEMBER_ID, 'https://rollback.example/a'), indexInGroup: 0 },
      { ...tab(GROUP_FILE_MEMBER_ID, 'https://rollback.example/b'), indexInGroup: 1 },
    ],
  }]);
  runtime.runtime.openTabs = [{
    id: 730,
    windowId: 2,
    index: 4,
    groupId: 88,
    url: 'https://rollback.example/a',
  }];
  runtime.runtime.activeTabs = [{ id: 731, windowId: 1, active: true, url: 'https://other.example/' }];
  runtime.runtime.failNextGroup = true;

  const restored = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(restored.ok, false);
  assert.match(restored.error, /tabs_group_failed/);
  const reused = runtime.runtime.openTabs.find((tab) => tab.id === 730);
  assert.equal(reused.windowId, 2);
  assert.equal(runtime.runtime.openTabs.some((tab) => tab.url === 'https://rollback.example/b'), false);
  assert.equal(runtime.store.parkedItems.length, 1);
  assert.equal(runtime.store.parkedItems[0].tabs.length, 2);
});

test('restoring a tab does not seed metadata for a different URL', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = { preSaveEdit: false };
  await runtime.api.setParkedItems([{
    ...tab(ITEM_ID),
    note: 'do not copy',
    tags: ['source'],
  }]);

  const restored = await runtime.api.restoreTab(ITEM_ID);
  assert.equal(restored.ok, true);

  const saved = await runtime.api.saveCurrentTab({
    id: 202,
    windowId: 1,
    url: 'https://example.com/other',
    title: 'Other URL',
    favIconUrl: '',
  });
  assert.equal(saved.ok, true);
  assert.equal(runtime.store.parkedItems[0].note, '');
  assert.deepEqual([...runtime.store.parkedItems[0].tags], []);
  assert.equal(runtime.store.parkedItems[1].note, 'do not copy');
  assert.deepEqual([...runtime.store.parkedItems[1].tags], ['source']);
});

test('restored group member keeps its member metadata', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = { preSaveEdit: false };
  await runtime.api.setParkedItems([{
    kind: 'group',
    id: GROUP_ID,
    title: 'Saved group',
    color: 'blue',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [{
      id: GROUP_HTTP_MEMBER_ID,
      url: 'https://example.com/member',
      title: 'Member',
      favIconUrl: '',
      pinned: false,
      indexInGroup: 0,
      note: 'member note',
      tags: ['member-tag'],
      hasThumb: false,
      hasSnap: false,
    }],
  }]);

  const restored = await runtime.api.restoreGroupMember(GROUP_ID, GROUP_HTTP_MEMBER_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.kept, true);
  assert.equal(runtime.store.parkedItems.length, 1);
  assert.equal(runtime.store.parkedItems[0].tabs.length, 1);
  assert.equal(runtime.store.parkedItems[0].tabs[0].note, 'member note');
  assert.deepEqual([...runtime.store.parkedItems[0].tabs[0].tags], ['member-tag']);
});

test('restored group keeps group and member metadata', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([{
    kind: 'group',
    id: GROUP_ID,
    title: 'Saved group',
    color: 'blue',
    collapsed: false,
    note: 'group note',
    tags: ['group-tag'],
    savedAt: Date.now() - 1000,
    tabs: [{
      id: GROUP_HTTP_MEMBER_ID,
      url: 'https://example.com/group-member',
      title: 'Group member',
      favIconUrl: '',
      pinned: false,
      indexInGroup: 0,
      note: '',
      tags: [],
      hasThumb: false,
      hasSnap: false,
    }],
  }]);

  const restored = await runtime.api.restoreGroup(GROUP_ID);
  assert.equal(restored.ok, true);
  assert.equal(restored.kept, true);
  assert.equal(runtime.store.parkedItems.length, 1);
  assert.equal(runtime.store.parkedItems[0].note, 'group note');
  assert.deepEqual([...runtime.store.parkedItems[0].tags], ['group-tag']);
  assert.equal(runtime.store.parkedItems[0].tabs.length, 1);
});

test('Stack storage failure rolls copied media back and preserves old keys', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(SOURCE_ID), tab(TARGET_ID)]);
  runtime.media.set(`t:${SOURCE_ID}`, { thumb: 'source', snap: 'source' });
  runtime.media.set(`t:${TARGET_ID}`, { thumb: 'target', snap: 'target' });
  runtime.runtime.failNextStorageSet = true;

  const result = await runtime.api.stackItems(SOURCE_ID, TARGET_ID);
  assert.equal(result.ok, false);
  assert.equal(runtime.media.has(`t:${SOURCE_ID}`), true);
  assert.equal(runtime.media.has(`t:${TARGET_ID}`), true);
  assert.equal([...runtime.media.keys()].filter((key) => key.startsWith('g:')).length, 0);
});

test('CREATE_STACK is atomic when a multi-select write fails', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  await runtime.api.setParkedItems([tab(SOURCE_ID), tab(TARGET_ID), tab(ITEM_ID)]);
  runtime.media.set(`t:${SOURCE_ID}`, { thumb: 'source', snap: 'source' });
  runtime.media.set(`t:${TARGET_ID}`, { thumb: 'target', snap: 'target' });
  runtime.media.set(`t:${ITEM_ID}`, { thumb: 'item', snap: 'item' });
  const before = JSON.parse(JSON.stringify(runtime.store.parkedItems));
  runtime.runtime.failNextStorageSet = true;

  const result = await runtime.api.createStack([SOURCE_ID, TARGET_ID, ITEM_ID], 'Merged');
  assert.equal(result.ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.store.parkedItems)), before);
  assert.deepEqual([...runtime.media.keys()].sort(), [`t:${ITEM_ID}`, `t:${SOURCE_ID}`, `t:${TARGET_ID}`].sort());
});

test('auto-backup pruning only deletes exact folder and mode names', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.runtime.downloadItems = [
    { id: 1, filename: '/Downloads/TabWall-Backups/tabwall-auto-lite-new.json' },
    { id: 2, filename: '/Downloads/TabWall-Backups/tabwall-auto-lite-old.json' },
    { id: 3, filename: '/Other/tabwall-auto-lite-old.json' },
    { id: 4, filename: '/Downloads/TabWall-Backups/tabwall-auto-full-old.zip' },
  ];
  await runtime.api.pruneDownloadedAutoBackups('lite', 1, {
    folderPath: '/Downloads/TabWall-Backups',
    subfolder: 'TabWall-Backups',
  });
  assert.deepEqual(runtime.removedDownloads, [2]);
});

test('autoBackupShouldRun only permits due daily backups', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  assert.equal(typeof runtime.api.autoBackupShouldRun, 'function');
  const shouldRun = runtime.api.autoBackupShouldRun;
  const normalize = runtime.api.normalizeAutoBackup;
  const scheduledAtFor = (hour, minute, dayOffset = 0) => {
    const date = new Date(2026, 7, 27 + dayOffset, hour, minute, 0, 0);
    return date.getTime();
  };
  const before = scheduledAtFor(9, 29);
  const slot = scheduledAtFor(9, 30);
  const after = scheduledAtFor(9, 31);
  const ab = normalize({
    enabled: true,
    mode: 'full',
    onChange: true,
    scheduleHour: 9,
    scheduleMinute: 30,
    dirtyAt: 123,
    lastSuccessAt: 0,
  });
  assert.equal(ab.scheduleHour, 9);
  assert.equal(ab.scheduleMinute, 30);
  assert.equal(Object.prototype.hasOwnProperty.call(ab, 'onChange'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(ab, 'dirtyAt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(ab, 'intervalUnit'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(ab, 'intervalValue'), false);

  const legacy = normalize({
    enabled: true,
    intervalUnit: 'hour',
    intervalValue: 24,
    intervalHours: 24,
    lastSuccessAt: scheduledAtFor(14, 49),
  });
  assert.equal(legacy.scheduleHour, 14);
  assert.equal(legacy.scheduleMinute, 30);
  assert.equal(normalize({}).scheduleHour, 0);
  assert.equal(normalize({}).scheduleMinute, 0);
  assert.equal(normalize({ scheduleHour: 24, scheduleMinute: 15 }).scheduleHour, 23);
  assert.equal(normalize({ scheduleHour: 24, scheduleMinute: 15 }).scheduleMinute, 0);

  assert.equal(shouldRun(ab, { reason: 'schedule', now: before }).run, false);
  assert.equal(shouldRun(ab, { reason: 'schedule', now: after }).run, true);
  for (const reason of ['resume', 'local']) {
    const result = shouldRun(ab, { reason, now: after });
    assert.equal(result.run, false);
    assert.equal(result.skipReason, 'not_due');
  }

  // A successful backup after today's slot blocks every automatic path.
  const successful = normalize({ ...ab, lastSuccessAt: after });
  for (const reason of ['schedule', 'resume', 'local']) {
    const result = shouldRun(successful, { reason, now: after });
    assert.equal(result.run, false);
    assert.equal(result.skipReason, 'not_due');
  }
  const legacyOnchange = shouldRun(successful, { reason: 'onchange', now: after });
  assert.equal(legacyOnchange.run, false);
  assert.equal(legacyOnchange.skipReason, 'onchange_disabled');

  // A missed slot can be recovered, but first-enable still waits for its alarm.
  const missed = normalize({ ...ab, lastSuccessAt: scheduledAtFor(8, 0) });
  for (const reason of ['schedule', 'resume', 'local']) {
    assert.equal(shouldRun(missed, { reason, now: after }).run, true);
  }
  assert.equal(shouldRun(missed, { reason: 'onchange', now: after }).run, false);
  assert.equal(shouldRun(missed, { reason: 'onchange', now: after }).skipReason, 'onchange_disabled');
  assert.equal(runtime.api.nextAutoBackupAt(ab, before), slot);
  assert.equal(runtime.api.nextAutoBackupAt(ab, after), scheduledAtFor(9, 30, 1));

  // Manual always runs when forced even if just backed up
  assert.equal(shouldRun(successful, { force: true, reason: 'manual', now: after }).run, true);
});

test('auto-backup alarms use the next local daily slot and clear legacy alarms', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    autoBackup: {
      enabled: true,
      scheduleHour: 23,
      scheduleMinute: 30,
      maxKeep: 5,
      subfolder: 'TabWall-Backups',
      folderPath: '',
      lastSuccessAt: 0,
      lastError: '',
    },
  };
  runtime.alarmStore.set('tabwall-auto-backup-onchange', {
    name: 'tabwall-auto-backup-onchange',
    delayInMinutes: 0.5,
  });
  const result = await dispatchMessage(runtime, { type: 'AUTO_BACKUP_SYNC_ALARMS' });
  assert.equal(result.ok, true);
  const alarm = runtime.alarmStore.get('tabwall-auto-backup-schedule');
  assert.equal(alarm.when, runtime.api.nextAutoBackupAt(runtime.store.settings.autoBackup));
  assert.equal(Object.prototype.hasOwnProperty.call(alarm, 'periodInMinutes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(alarm, 'delayInMinutes'), false);
  assert.equal(runtime.alarmStore.has('tabwall-auto-backup-onchange'), false);
});

test('data writes do not create legacy auto-backup change alarms', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.store.settings = {
    autoBackup: {
      enabled: true,
      mode: 'lite',
      onChange: true,
      scheduleHour: 23,
      scheduleMinute: 30,
      maxKeep: 5,
      subfolder: 'TabWall-Backups',
      folderPath: '',
      lastSuccessAt: Date.now(),
      lastError: '',
      dirtyAt: 123,
    },
  };
  await runtime.api.setParkedItems([tab(ITEM_ID)]);
  assert.equal(runtime.alarmStore.has('tabwall-auto-backup-onchange'), false);
  assert.equal(runtime.store.settings.autoBackup.dirtyAt, 123);
});

test('schedule sync clears legacy auto-backup change alarms', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  runtime.alarmStore.set('tabwall-auto-backup-onchange', {
    name: 'tabwall-auto-backup-onchange',
    delayInMinutes: 0.5,
  });
  const result = await dispatchMessage(runtime, { type: 'AUTO_BACKUP_SYNC_ALARMS' });
  assert.equal(result.ok, true);
  assert.equal(runtime.alarmStore.has('tabwall-auto-backup-onchange'), false);
});

test('PATCH_SETTINGS ignores removed auto-backup change fields and keeps clocks', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const lastSuccessAt = Date.now() - 60_000;
  const dirtyAt = lastSuccessAt - 5_000;
  runtime.store.settings = {
    afterSave: 'close',
    autoBackup: {
      enabled: true,
      mode: 'lite',
      onChange: true,
      scheduleHour: 23,
      scheduleMinute: 30,
      maxKeep: 5,
      subfolder: 'TabWall-Backups',
      folderPath: '/Downloads/TabWall-Backups',
      lastSuccessAt,
      lastError: '',
      dirtyAt,
    },
  };
  const created = [];
  const originalCreate = runtime.chrome.alarms.create;
  runtime.chrome.alarms.create = async (name, info) => {
    created.push({ name, info });
    return originalCreate.call(runtime.chrome.alarms, name, info);
  };

  const result = await dispatchMessage(runtime, {
    type: 'PATCH_SETTINGS',
    partial: {
      autoBackup: {
        enabled: true,
        mode: 'full',
        onChange: true,
        scheduleHour: 23,
        scheduleMinute: 30,
        maxKeep: 5,
        subfolder: 'TabWall-Backups',
        folderPath: '',
        lastSuccessAt: 0,
        lastError: 'stale',
        dirtyAt: 0,
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.settings.autoBackup.mode, 'full');
  assert.equal(Object.prototype.hasOwnProperty.call(result.settings.autoBackup, 'onChange'), false);
  assert.equal(result.settings.autoBackup.lastSuccessAt, lastSuccessAt);
  assert.equal(Object.prototype.hasOwnProperty.call(result.settings.autoBackup, 'dirtyAt'), false);
  assert.equal(result.settings.autoBackup.lastError, '');
  assert.equal(created.length, 0);
});

test('mutation queue executes concurrent tasks in FIFO order', async () => {
  const runtime = createRuntime();
  await runtime.ready;
  const order = [];
  await Promise.all([
    runtime.api.enqueueMutation(async () => {
      order.push('a:start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('a:end');
    }),
    runtime.api.enqueueMutation(async () => order.push('b')),
  ]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b']);
});
