import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../bgUpdate.js', import.meta.url), 'utf8');

function createRuntime({ version = '2.13.0', fetchImpl, immediateTimeout = false } = {}) {
  const store = Object.create(null);
  const alarms = new Map();
  const chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: store[key] }; },
        async set(values) { Object.assign(store, values); },
      },
    },
    alarms: {
      async getAll() { return [...alarms.values()]; },
      async create(name, info) { alarms.set(name, { name, ...info }); },
    },
    runtime: { getManifest: () => ({ version }) },
  };
  const sandbox = {
    self: null,
    chrome,
    AbortController,
    fetch: fetchImpl || (async () => ({ ok: false, status: 503 })),
    setTimeout(callback, delay, ...args) {
      if (immediateTimeout && delay === 10_000) {
        callback(...args);
        return 1;
      }
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'bgUpdate.js' });
  return { api: sandbox.TabWallReleaseUpdate, store, alarms };
}

test('release versions parse and compare as stable semantic versions', () => {
  const { api } = createRuntime();
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseVersion('v2.57.0'))), {
    major: 2,
    minor: 57,
    patch: 0,
    value: '2.57.0',
  });
  assert.equal(api.compareVersions('2.57.0', 'v2.56.9'), 1);
  assert.equal(api.compareVersions('2.57.0+build.1', '2.57.0'), 0);
  assert.equal(api.parseVersion('v2.57.0-beta.1'), null);
  assert.equal(api.parseVersion('latest'), null);
  assert.equal(api.compareVersions('invalid', '2.57.0'), null);
});

test('release normalization keeps only safe release metadata and rejects non-stable tags', () => {
  const { api } = createRuntime();
  const release = api.normalizeRelease({
    id: 123,
    tag_name: 'v2.57.0',
    name: 'TabWall 2.57.0',
    html_url: 'https://github.com/davislinyd/TabWall/releases/tag/v2.57.0',
    published_at: '2026-08-27T00:00:00Z',
    body: 'do not persist this',
    assets: [{ name: 'TabWall.zip' }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(release)), {
    key: '123',
    version: '2.57.0',
    tagName: 'v2.57.0',
    name: 'TabWall 2.57.0',
    url: 'https://github.com/davislinyd/TabWall/releases/tag/v2.57.0',
    publishedAt: '2026-08-27T00:00:00Z',
  });
  assert.equal(api.normalizeRelease({ ...release, tag_name: 'v2.58.0-rc.1' }), null);
  assert.equal(api.normalizeRelease({ ...release, prerelease: true }), null);
  assert.equal(api.normalizeRelease({ ...release, html_url: 'https://example.com/release' }), null);
});

test('release checks deduplicate concurrent requests and classify timeout', async () => {
  let calls = 0;
  const runtime = createRuntime({
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 456,
            tag_name: 'v2.14.0',
            html_url: 'https://github.com/davislinyd/TabWall/releases/tag/v2.14.0',
          };
        },
      };
    },
  });
  const [first, second] = await Promise.all([
    runtime.api.checkReleaseUpdate({ reason: 'manual' }),
    runtime.api.checkReleaseUpdate({ reason: 'manual' }),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.noticePending, true);
  assert.deepEqual(second, first);
  assert.equal(runtime.store.releaseUpdate.latestRelease.key, '456');

  const timedOut = createRuntime({
    immediateTimeout: true,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(new Error('aborted'));
      else options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  const result = await timedOut.api.checkReleaseUpdate();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
  assert.equal(timedOut.store.releaseUpdate, undefined);
});
