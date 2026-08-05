import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const BUILD_SOURCE = fs.readFileSync(new URL('../backupBuild.js', import.meta.url), 'utf8');
const BACKGROUND_SOURCE = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_HTTP_MEMBER_ID = '55555555-5555-4555-8555-555555555555';
const GROUP_FILE_MEMBER_ID = '66666666-6666-4666-8666-666666666666';
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

function createRuntime() {
  const store = Object.create(null);
  const sessionStore = Object.create(null);
  const media = new Map();
  const importStages = new Map();
  const removedDownloads = [];
  const removedTabs = [];
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
      async create() {},
      async clear() {},
    },
    runtime: {
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      lastError: null,
      getManifest: () => ({ version: '2.11.4' }),
    },
    commands: { onCommand: event(), async getAll() { return []; } },
    action: {
      onClicked: event(),
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
    },
    tabs: {
      async query() { return []; },
      async create(info) {
        if (runtime.failTabCreate) throw new Error('tabs_create_failed');
        const tab = { id: ++runtime.nextTabId, ...info };
        runtime.createdTabs.push(tab);
        return tab;
      },
      async remove(ids) {
        removedTabs.push(...(Array.isArray(ids) ? ids : [ids]));
      },
      async group() { return 77; },
      async update() {},
      async get() { return { id: 1, windowId: 1, status: 'complete' }; },
      async sendMessage() {},
      async captureVisibleTab() { return ''; },
    },
    tabGroups: { async update() {} },
    windows: {
      async create(info) {
        if (runtime.failWindowCreate) throw new Error('windows_create_failed');
        const tab = { id: ++runtime.nextTabId, url: info.url };
        runtime.createdTabs.push(tab);
        return { id: 55, tabs: [tab] };
      },
      async remove() {},
    },
    scripting: { async executeScript() {} },
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
    failWindowCreate: false,
    nextTabId: 100,
    createdTabs: [],
    downloadItems: [],
  };

  const mediaApi = {
    mediaKeyTab: (id) => `t:${id}`,
    mediaKeyMember: (groupId, memberId) => `g:${groupId}:${memberId}`,
    async get(key) {
      return media.get(key) || { thumb: null, snap: null };
    },
    async put(key, value) {
      media.set(key, value);
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
        }]))
      );
    },
    async getImportStage(stageId) {
      return new Map(importStages.get(stageId) || []);
    },
    async removeImportStage(stageId) {
      importStages.delete(stageId);
    },
    async blobToDataUrl(value) { return value ? String(value) : ''; },
    keysForItem(item) {
      return item.kind === 'group'
        ? (item.tabs || []).map((member) => `g:${item.id}:${member.id}`)
        : [`t:${item.id}`];
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
    console,
    setTimeout,
    clearTimeout,
    fetch,
    OffscreenCanvas: class {},
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    __TABWALL_TEST__: true,
    importScripts() {},
    TabWallMediaDB: mediaApi,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BUILD_SOURCE, sandbox, { filename: 'backupBuild.js' });
  vm.runInContext(BACKGROUND_SOURCE, sandbox, { filename: 'background.js' });
  const ready = new Promise((resolve) => setTimeout(resolve, 0));
  return {
    api: sandbox.TabWallBackgroundTest,
    Build: sandbox.TabWallBackupBuild,
    store,
    media,
    importStages,
    runtime,
    removedDownloads,
    removedTabs,
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
  assert.equal(runtime.store.parkedItems.length, 0);
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
