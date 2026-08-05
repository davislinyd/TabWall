import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadBuild() {
  const sandbox = {
    atob,
    btoa,
    Blob,
    TextDecoder,
    TextEncoder,
    URL,
    console,
  };
  sandbox.self = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../backupBuild.js', import.meta.url), 'utf8'), sandbox, {
    filename: 'backupBuild.js',
  });
  return sandbox.TabWallBackupBuild;
}

const Build = loadBuild();
const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_ZIP = new URL(
  '../backup/tabwall-backup-full-2026-08-05T14-49-39+0800.zip',
  import.meta.url
);

function sampleItem({ image = true, id = ITEM_ID } = {}) {
  return {
    kind: 'tab',
    id,
    url: 'https://example.com/path?q=1',
    title: 'Example',
    favIconUrl: 'https://example.com/favicon.ico',
    note: 'note',
    tags: ['one'],
    savedAt: Date.now() - 1000,
    hasThumb: image,
    hasSnap: image,
    thumbnail: image ? 'data:image/png;base64,AQID' : '',
    snapshot: image ? 'data:image/webp;base64,BAUG' : '',
  };
}

function sampleBackup(items = [sampleItem()]) {
  return {
    format: 'tabwall-backup',
    version: Build.FORMAT_VERSION,
    media: 'inline',
    appVersion: '2.11.4',
    exportedAt: new Date().toISOString(),
    parkedItems: items,
    parkedTabs: items.filter((item) => item.kind === 'tab').map(({ kind, ...item }) => item),
    settings: {},
    tagCatalog: ['one'],
  };
}

test('data URL conversion preserves bytes', () => {
  const bytes = Build.dataUrlToBytes('data:image/png;base64,AQID');
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(Build.bytesToDataUrl(bytes, 'image/png'), 'data:image/png;base64,AQID');
});

test('data URL conversion accepts MIME parameters before base64', () => {
  const bytes = Build.dataUrlToBytes(
    'data:image/svg+xml;charset=UTF-8;base64,PHN2Zz48L3N2Zz4='
  );
  assert.equal(new TextDecoder().decode(bytes), '<svg></svg>');
});

test('legacy v3 preparation normalizes color and preserves file URLs as stored-only', () => {
  const legacy = {
    format: 'tabwall-backup',
    version: 3,
    media: 'inline',
    appVersion: '2.11.1',
    exportedAt: new Date().toISOString(),
    parkedItems: [{
      kind: 'group',
      id: ITEM_ID,
      title: 'Legacy group',
      color: 'orange',
      collapsed: false,
      note: '',
      tags: [],
      savedAt: Date.now() - 1000,
      tabs: [{
        id: MEMBER_ID,
        url: 'file:///Users/test/legacy.html',
        title: 'Legacy file',
        favIconUrl: 'data:image/svg+xml;charset=UTF-8;base64,PHN2Zz48L3N2Zz4=',
        pinned: false,
        indexInGroup: 0,
        note: '',
        tags: [],
        savedAt: Date.now() - 1000,
        hasThumb: false,
        hasSnap: false,
      }],
    }],
    parkedTabs: [],
    settings: {},
    tagCatalog: [],
  };

  const prepared = Build.prepareImportedBackup(legacy);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.allowStoredOnlyUrls, true);
  assert.equal(prepared.backup.parkedItems[0].color, 'grey');
  assert.equal(prepared.backup.parkedItems[0].tabs[0].url, 'file:///Users/test/legacy.html');
  assert.equal(prepared.warnings.legacyVersion, 3);
  assert.equal(prepared.warnings.normalizedGroupColors, 1);
  assert.equal(prepared.warnings.storedOnlyUrls, 1);
  assert.equal(
    Build.validateBackup(prepared.backup, { allowStoredOnlyUrls: true }).ok,
    true
  );
  assert.equal(Build.validateBackup(prepared.backup).error, 'invalid_url');

  const repeated = Build.prepareImportedBackup(prepared.backup);
  assert.deepEqual(repeated.backup, prepared.backup);
});

test('legacy ZIP media without mediaMimes falls back to extension MIME', () => {
  const zip = Build.zipStore([
    { name: 'media/item_thumb.jpg', data: new Uint8Array([0xff, 0xd8, 0xff]) },
  ]);
  const files = Build.unzipStore(zip);
  const hydrated = Build.rehydrateMedia(
    [{ ...sampleItem({ image: false }), thumbnail: 'media/item_thumb.jpg', snapshot: '' }],
    files,
    {}
  );
  assert.match(hydrated[0].thumbnail, /^data:image\/jpeg;base64,/);
});

test('full ZIP round-trip preserves backup version and media MIME', async () => {
  const backup = sampleBackup();
  const built = Build.buildFullZipBlob(backup);
  const files = Build.unzipStore(new Uint8Array(await built.blob.arrayBuffer()));
  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));

  assert.equal(metadata.version, Build.FORMAT_VERSION);
  assert.equal(metadata.mediaMimes['media/' + ITEM_ID + '_thumb.png'], 'image/png');
  assert.equal(metadata.mediaMimes['media/' + ITEM_ID + '_snap.webp'], 'image/webp');

  const hydrated = Build.rehydrateMedia(metadata.parkedItems, files, metadata.mediaMimes);
  assert.match(hydrated[0].thumbnail, /^data:image\/png;base64,/);
  assert.match(hydrated[0].snapshot, /^data:image\/webp;base64,/);
});

test('malformed ZIP boundaries and traversal paths are rejected', () => {
  const valid = Build.zipStore([{ name: 'backup.json', data: new TextEncoder().encode('{}') }]);
  assert.throws(() => Build.unzipStore(valid.slice(0, -1)), /invalid_zip/);

  const traversal = Build.zipStore([{ name: '../backup.json', data: new Uint8Array([1]) }]);
  assert.throws(() => Build.unzipStore(traversal), /invalid_zip:bad_filename/);

  const duplicate = Build.zipStore([
    { name: 'backup.json', data: new Uint8Array([1]) },
    { name: 'backup.json', data: new Uint8Array([2]) },
  ]);
  assert.throws(() => Build.unzipStore(duplicate), /invalid_zip:bad_filename/);

  const crcCorrupt = valid.slice();
  const nameLength = crcCorrupt[26] | (crcCorrupt[27] << 8);
  const extraLength = crcCorrupt[28] | (crcCorrupt[29] << 8);
  crcCorrupt[30 + nameLength + extraLength] ^= 0xff;
  assert.throws(() => Build.unzipStore(crcCorrupt), /invalid_zip:crc/);
});

test('backup schema rejects duplicate IDs and non-HTTP URLs', () => {
  const duplicate = sampleBackup([sampleItem(), sampleItem({ image: false, id: ITEM_ID })]);
  assert.equal(Build.validateBackup(duplicate).error, 'duplicate_or_invalid_id');

  const invalidUrl = sampleBackup([{
    ...sampleItem({ image: false }),
    url: 'javascript:alert(1)',
  }]);
  assert.equal(Build.validateBackup(invalidUrl).error, 'invalid_url');
});

test('backup schema accepts valid group members and rejects invalid color', () => {
  const group = {
    kind: 'group',
    id: ITEM_ID,
    title: 'Group',
    color: 'blue',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [{
      id: MEMBER_ID,
      url: 'https://example.com/member',
      title: 'Member',
      favIconUrl: '',
      pinned: false,
      indexInGroup: 0,
      note: '',
      tags: [],
      hasThumb: false,
      hasSnap: false,
    }],
  };
  assert.equal(Build.validateBackup(sampleBackup([group])).ok, true);
  assert.equal(Build.validateBackup(sampleBackup([{ ...group, color: 'orange' }])).error, 'invalid_group_color');
});

test('local legacy full ZIP imports all metadata and media', { skip: !fs.existsSync(LEGACY_ZIP) }, () => {
  const zipBytes = new Uint8Array(fs.readFileSync(LEGACY_ZIP));
  const files = Build.unzipStore(zipBytes);
  assert.equal(Object.keys(files).length, 273);
  assert.equal(Object.keys(files).filter((name) => name.startsWith('media/')).length, 272);

  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  assert.equal(metadata.version, 3);
  assert.equal(metadata.appVersion, '2.11.1');
  const hydrated = {
    ...metadata,
    parkedItems: Build.rehydrateMedia(
      metadata.parkedItems,
      files,
      metadata.mediaMimes || {}
    ),
  };
  const prepared = Build.prepareImportedBackup(hydrated);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.warnings.normalizedGroupColors, 1);
  assert.equal(prepared.warnings.storedOnlyUrls, 8);
  assert.equal(prepared.warnings.droppedFavicons, 1);

  const validation = Build.validateBackup(prepared.backup, {
    allowStoredOnlyUrls: prepared.allowStoredOnlyUrls,
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.version, 3);
  assert.equal(validation.itemCount, 88);
  assert.equal(validation.memberCount, 114);
  assert.equal(
    prepared.backup.parkedItems.filter((item) => item.kind === 'group').length,
    15
  );
  assert.equal(validation.itemCount + validation.memberCount, 202);
  const urls = prepared.backup.parkedItems.flatMap((item) =>
    item.kind === 'group' ? item.tabs.map((member) => member.url) : [item.url]
  );
  assert.equal(urls.filter((url) => Build.isHttpUrl(url)).length, 179);
  assert.equal(urls.filter((url) => Build.isFileUrl(url)).length, 8);
});
