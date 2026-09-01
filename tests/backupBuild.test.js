import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadBuild() {
  const sandbox = {
    atob,
    btoa,
    Blob,
    crypto: globalThis.crypto,
    TextDecoder,
    TextEncoder,
    URL,
    console,
  };
  sandbox.self = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../webhookCore.js', import.meta.url), 'utf8'), sandbox, {
    filename: 'webhookCore.js',
  });
  vm.runInNewContext(fs.readFileSync(new URL('../backupBuild.js', import.meta.url), 'utf8'), sandbox, {
    filename: 'backupBuild.js',
  });
  return sandbox.TabWallBackupBuild;
}

const Build = loadBuild();
const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_ID = '77777777-7777-4777-8777-777777777777';
const ATTACHMENT_ID = '88888888-8888-4888-8888-888888888888';
const LEGACY_ZIP = new URL(
  '../backup/tabwall-backup-full-2026-08-05T14-49-39+0800.zip',
  import.meta.url
);

function sampleItem({ image = true, id = ITEM_ID, pinned = false } = {}) {
  return {
    kind: 'tab',
    id,
    url: 'https://example.com/path?q=1',
    title: 'Example',
    favIconUrl: 'https://example.com/favicon.ico',
    pinned,
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

function sampleNote({ id = NOTE_ID, attachment = true } = {}) {
  return {
    kind: 'note',
    id,
    title: '安全筆記',
    contentMode: 'markdown',
    webSource: '',
    markdown: attachment
      ? `# Heading\n\n![diagram](attachment://${ATTACHMENT_ID})\n\n[Open](https://example.com)`
      : 'Plain note',
    tags: ['idea'],
    pinned: true,
    savedAt: Date.now() - 1000,
    attachments: attachment ? [{
      id: ATTACHMENT_ID,
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

function quotaNote(id, attachmentCount, size = Build.LIMITS.MAX_IMAGE_BYTES) {
  const note = sampleNote({ id, attachment: false });
  note.attachments = Array.from({ length: attachmentCount }, (_, index) => ({
    id: `${String(id).slice(0, 8)}-${String(index + 1).padStart(4, '0')}-4aaa-8aaa-aaaaaaaaaaaa`,
    name: `image-${index}.webp`,
    alt: '',
    mime: 'image/webp',
    size,
    width: 4096,
    height: 4096,
    hasData: true,
  }));
  return note;
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

test('full ZIP includes wallpaper blob and rehydrates it', async () => {
  const backup = sampleBackup();
  backup.settings = {
    wallpaper: {
      enabled: true,
      fit: 'fitWidth',
      opacity: 40,
      blurPx: 16,
      mime: 'image/webp',
      data: 'data:image/webp;base64,BAUG',
    },
  };
  const built = Build.buildFullZipBlob(backup);
  const files = Build.unzipStore(new Uint8Array(await built.blob.arrayBuffer()));
  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  assert.equal(metadata.settings.wallpaper.data, 'media/wallpaper.webp');
  assert.equal(metadata.mediaMimes['media/wallpaper.webp'], 'image/webp');
  assert.ok(files['media/wallpaper.webp']);
  const hydrated = Build.rehydrateWallpaper(metadata.settings, files, metadata.mediaMimes);
  assert.match(hydrated.wallpaper.data, /^data:image\/webp;base64,/);
});

test('full ZIP export preserves stored-only file URLs and remains importable', async () => {
  const url = 'file:///Users/test/current.html';
  const backup = sampleBackup([sampleItem({ image: false })]);
  backup.parkedItems[0].url = url;
  backup.parkedTabs[0].url = url;

  const built = Build.buildFullZipBlob(backup);
  const files = Build.unzipStore(new Uint8Array(await built.blob.arrayBuffer()));
  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  const prepared = Build.prepareImportedBackup(metadata);

  assert.equal(metadata.parkedItems[0].url, url);
  assert.equal(prepared.allowStoredOnlyUrls, true);
  assert.equal(
    Build.validateBackup(prepared.backup, {
      allowStoredOnlyUrls: prepared.allowStoredOnlyUrls,
    }).ok,
    true
  );
});

test('full ZIP rehydration preserves a missing attachment as missing binary data', () => {
  const attachmentPath = `media/${NOTE_ID}_${ATTACHMENT_ID}.png`;
  const source = sampleNote();
  source.attachments[0].data = attachmentPath;
  const hydrated = Build.rehydrateMedia(
    [source],
    {},
    { [attachmentPath]: 'image/png' }
  );
  assert.equal(hydrated[0].attachments[0].data, '');
  assert.equal(hydrated[0].attachments[0].hasData, true);
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

test('backup accepts optional displayTitle and lock fields', () => {
  const locked = {
    ...sampleItem(),
    displayTitle: 'Friendly name',
    locked: true,
    hideOriginalTitle: true,
    lockSalt: 'ab'.repeat(16),
    lockHash: 'cd'.repeat(32),
  };
  assert.equal(Build.validateBackup(sampleBackup([locked])).ok, true);
  assert.equal(
    Build.validateBackup(sampleBackup([{ ...sampleItem(), lockSalt: 'nope' }])).error,
    'invalid_lock_salt'
  );
  assert.equal(
    Build.validateBackup(sampleBackup([{ ...sampleItem(), hideOriginalTitle: 'yes' }])).error,
    'invalid_hide_original_title'
  );
});

test('backup accepts image cards with empty URL and rejects a URL on them', () => {
  const imageCard = {
    ...sampleItem({ image: true }),
    url: '',
    favIconUrl: '',
    cardSource: 'image',
    title: 'clip',
  };
  assert.equal(Build.validateBackup(sampleBackup([imageCard])).ok, true);
  assert.equal(
    Build.validateBackup(sampleBackup([{ ...imageCard, url: 'https://example.com' }])).error,
    'invalid_url'
  );
});

test('backup keeps optional top-level pinned state and accepts legacy omission', async () => {
  const pinnedBackup = sampleBackup([sampleItem({ pinned: true })]);
  assert.equal(Build.validateBackup(pinnedBackup).ok, true);
  const built = Build.buildFullZipBlob(pinnedBackup);
  const files = Build.unzipStore(new Uint8Array(await built.blob.arrayBuffer()));
  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  assert.equal(metadata.parkedItems[0].pinned, true);

  const legacyBackup = sampleBackup([sampleItem()]);
  delete legacyBackup.parkedItems[0].pinned;
  delete legacyBackup.parkedTabs[0].pinned;
  assert.equal(Build.validateBackup(legacyBackup).ok, true);
});

test('backup preserves valid top-level reminders and rejects nested reminder scope', async () => {
  const reminder = {
    mode: 'interval',
    message: 'Review this card',
    nextAt: Date.now() + 3600000,
    intervalMinutes: 60,
  };
  const onceReminder = {
    mode: 'once',
    message: reminder.message,
    nextAt: reminder.nextAt,
  };
  const backup = sampleBackup([
    { ...sampleItem(), reminder },
    { ...sampleNote({ attachment: false }), reminder: onceReminder },
  ]);
  assert.equal(Build.validateBackup(backup).ok, true);

  const lite = Build.buildLiteBlob(backup);
  const liteMetadata = JSON.parse(await lite.blob.text());
  assert.deepEqual(liteMetadata.parkedItems[0].reminder, reminder);
  assert.deepEqual(liteMetadata.parkedItems[1].reminder, onceReminder);

  const group = {
    kind: 'group',
    id: ITEM_ID,
    title: 'Group',
    color: 'grey',
    collapsed: false,
    note: '',
    tags: [],
    savedAt: Date.now() - 1000,
    tabs: [],
    notes: [{ ...sampleNote({ attachment: false }), reminder }],
  };
  assert.equal(Build.validateBackup(sampleBackup([{ ...group, reminder }])).ok, false);
  assert.equal(
    Build.validateBackup(sampleBackup([{ ...group, reminder: undefined }])).error,
    'invalid_reminder_scope'
  );
});

test('lite, full, and partial backups exclude local-only webhook and AI profiles', async () => {
  const backup = sampleBackup([sampleItem()]);
  backup.settings = {
    locale: 'zh',
    webhookProfiles: [{
      id: 'secret',
      name: 'Private endpoint',
      url: 'https://hooks.example.test/private',
      headers: { Authorization: 'Bearer should-not-export' },
      body: '{{json}}',
    }],
    ai: {
      providers: [{ id: 'remote', bearerToken: 'should-not-export', headers: [{ name: 'X-Key', value: 'secret' }] }],
    },
  };

  const lite = JSON.parse(await Build.buildLiteBlob(backup).blob.text());
  assert.equal(Object.prototype.hasOwnProperty.call(lite.settings, 'webhookProfiles'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(lite.settings, 'ai'), false);
  assert.equal(lite.settings.locale, 'zh');

  const partial = JSON.parse(await Build.buildLiteBlob(backup, { partial: true }).blob.text());
  assert.equal(Object.prototype.hasOwnProperty.call(partial.settings, 'webhookProfiles'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(partial.settings, 'ai'), false);

  const full = Build.buildFullZipBlob(backup, { partial: true });
  const files = Build.unzipStore(new Uint8Array(await full.blob.arrayBuffer()));
  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  assert.equal(Object.prototype.hasOwnProperty.call(metadata.settings, 'webhookProfiles'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(metadata.settings, 'ai'), false);
});

test('backup preserves optional canvas layout and validates its bounds', async () => {
  const backup = sampleBackup([sampleItem(), sampleItem({ id: SECOND_ID, image: false })]);
  backup.canvasLayout = {
    version: 1,
    viewport: { x: 12, y: 24, zoom: 0.76 },
    positions: {
      [ITEM_ID]: { x: 120, y: 240, w: 220, h: 170, z: 1 },
      [SECOND_ID]: { x: 420, y: 240, w: 220, h: 170, z: 2 },
    },
    connections: [{ sourceId: SECOND_ID, targetId: ITEM_ID, curveOffset: { x: 44, y: -22 } }],
  };
  assert.equal(Build.validateBackup(backup).ok, true);

  const lite = Build.buildLiteBlob(backup);
  const liteMetadata = JSON.parse(await lite.blob.text());
  assert.deepEqual(liteMetadata.canvasLayout, backup.canvasLayout);

  const full = Build.buildFullZipBlob(backup);
  const files = Build.unzipStore(new Uint8Array(await full.blob.arrayBuffer()));
  const fullMetadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  assert.deepEqual(fullMetadata.canvasLayout, backup.canvasLayout);

  const invalidConnection = {
    ...backup,
    canvasLayout: {
      ...backup.canvasLayout,
      connections: [{ sourceId: ITEM_ID, targetId: 'not-an-item' }],
    },
  };
  assert.equal(Build.validateBackup(invalidConnection).error, 'invalid_canvas_layout');

  const invalidCurveOffset = {
    ...backup,
    canvasLayout: {
      ...backup.canvasLayout,
      connections: [{ sourceId: SECOND_ID, targetId: ITEM_ID, curveOffset: { x: 2001, y: 0 } }],
    },
  };
  assert.equal(Build.validateBackup(invalidCurveOffset).error, 'invalid_canvas_layout');

  const invalid = {
    ...backup,
    canvasLayout: {
      version: 1,
      viewport: { x: 0, y: 0, zoom: 3 },
      positions: { [ITEM_ID]: { x: 0, y: 0, w: 120, h: 170, z: 0 } },
    },
  };
  assert.equal(Build.validateBackup(invalid).error, 'invalid_canvas_layout');
});

test('backup rejects a non-boolean top-level pinned value', () => {
  const invalid = sampleBackup([{ ...sampleItem(), pinned: 'yes' }]);
  assert.equal(Build.validateBackup(invalid).error, 'invalid_pinned');
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

test('note schema validates attachments and attachment references', () => {
  const backup = sampleBackup([sampleNote()]);
  assert.equal(Build.validateBackup(backup).ok, true);

  const brokenReference = sampleBackup([{
    ...sampleNote(),
    markdown: '![missing](attachment://99999999-9999-4999-8999-999999999999)',
  }]);
  assert.equal(Build.validateBackup(brokenReference).error, 'invalid_attachment_reference');

  const tooMany = sampleNote({ attachment: false });
  tooMany.attachments = Array.from({ length: 13 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    name: `image-${index}.png`,
    alt: '',
    mime: 'image/png',
    size: 0,
    width: 1,
    height: 1,
  }));
  assert.equal(Build.validateBackup(sampleBackup([tooMany])).error, 'invalid_attachments');
});

test('safe Markdown renderer escapes XSS and rejects remote or dangerous images', () => {
  const html = Build.renderSafeMarkdown(
    '# Title\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![remote](https://example.com/a.png)\n\n![local](attachment://' + ATTACHMENT_ID + ')',
    [{ id: ATTACHMENT_ID, name: 'local.png' }]
  );
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, new RegExp('src="https://example\\.com', 'i'));
  assert.match(html, /data-attachment-id="88888888-8888-4888-8888-888888888888"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('v6 notes migrate legacy Web fields to the canonical single document', async () => {
  const legacy = sampleBackup([sampleNote({ attachment: false })]);
  legacy.version = 6;
  delete legacy.parkedItems[0].contentMode;
  delete legacy.parkedItems[0].webSource;
  legacy.parkedItems[0].html = '<!doctype html><html><head></head><body><button>Run</button></body></html>';
  legacy.parkedItems[0].css = 'button { color: red; }';
  legacy.parkedItems[0].javascript = 'document.body.dataset.ready = "yes";';
  const prepared = Build.prepareImportedBackup(legacy);
  assert.equal(prepared.ok, true);
  const migrated = prepared.backup.parkedItems[0];
  assert.equal(migrated.contentMode, 'markdown');
  assert.match(migrated.webSource, /<button>Run<\/button>/);
  assert.match(migrated.webSource, /<style>[\s\S]*color: red/);
  assert.match(migrated.webSource, /<script>[\s\S]*dataset\.ready/);
  assert.equal('html' in migrated, false);
  assert.equal('css' in migrated, false);
  assert.equal('javascript' in migrated, false);
  assert.equal(Build.validateBackup(prepared.backup).ok, true);

  const exportedLegacy = sampleBackup([sampleNote({ attachment: false })]);
  exportedLegacy.version = 6;
  delete exportedLegacy.parkedItems[0].contentMode;
  delete exportedLegacy.parkedItems[0].webSource;
  exportedLegacy.parkedItems[0].html = '<!doctype html><html><body>Exported</body></html>';
  const exported = JSON.parse(await Build.buildLiteBlob(exportedLegacy).blob.text());
  const exportedNote = exported.parkedItems[0];
  assert.equal(exported.version, 7);
  assert.match(exportedNote.webSource, /Exported/);
  assert.equal('html' in exportedNote, false);
});

test('single Web document round-trips and rejects unsafe shapes', async () => {
  const web = sampleNote({ attachment: false });
  web.contentMode = 'web';
  web.webSource = '<!doctype html><html><head><style>button { color: red; }</style></head><body><button>Run</button><script>document.body.dataset.ready = "yes";</script></body></html>';
  const backup = sampleBackup([web]);
  const lite = Build.buildLiteBlob(backup);
  const prepared = Build.prepareImportedBackup(JSON.parse(await lite.blob.text()));
  assert.equal(prepared.ok, true);
  assert.equal(prepared.backup.parkedItems[0].contentMode, 'web');
  assert.equal(prepared.backup.parkedItems[0].webSource, web.webSource);
  assert.equal('html' in prepared.backup.parkedItems[0], false);
  assert.equal('css' in prepared.backup.parkedItems[0], false);
  assert.equal('javascript' in prepared.backup.parkedItems[0], false);
  assert.equal(Build.validateBackup(prepared.backup).ok, true);

  const invalidMode = sampleNote({ attachment: false });
  invalidMode.contentMode = 'mixed';
  assert.equal(Build.validateBackup(sampleBackup([invalidMode])).error, 'invalid_note_content_mode');
  const invalidControl = sampleNote({ attachment: false });
  invalidControl.contentMode = 'web';
  invalidControl.webSource = '<div>\u0000</div>';
  assert.equal(Build.validateBackup(sampleBackup([invalidControl])).error, 'invalid_note_web_source');
  const tooLong = sampleNote({ attachment: false });
  tooLong.contentMode = 'web';
  tooLong.webSource = 'x'.repeat(Build.LIMITS.MAX_NOTE_WEB_SOURCE_LENGTH + 1);
  assert.equal(Build.validateBackup(sampleBackup([tooLong])).error, 'invalid_note_web_source');
});

test('v7 backup round-trips page Sticker placements and rejects non-top-level references', async () => {
  const backup = sampleBackup([sampleNote({ attachment: false })]);
  backup.pageAnnotations = [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    url: 'https://sticker.example/page',
    title: 'Sticker page',
    favIconUrl: '',
    note: '',
    tags: [],
    overlayVisible: true,
    hasInk: false,
    stickers: [{ noteId: NOTE_ID, x: 24, y: 48, w: 320, h: 240, z: 2 }],
    updatedAt: Date.now(),
  }];
  assert.equal(Build.validateBackup(backup).ok, true);
  const lite = Build.buildLiteBlob(backup);
  const imported = Build.prepareImportedBackup(JSON.parse(await lite.blob.text()));
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.backup.pageAnnotations[0].stickers, backup.pageAnnotations[0].stickers);

  const invalid = structuredClone(backup);
  invalid.pageAnnotations[0].stickers[0].noteId = MEMBER_ID;
  assert.equal(Build.validateBackup(invalid).error, 'invalid_page_annotations');
  const noTopLevelNote = structuredClone(backup);
  noTopLevelNote.parkedItems = [];
  assert.equal(Build.validateBackup(noTopLevelNote).error, 'invalid_page_annotations');
  const outOfBounds = structuredClone(backup);
  outOfBounds.pageAnnotations[0].stickers[0].w = 100;
  assert.equal(Build.validateBackup(outOfBounds).error, 'invalid_page_annotations');
});

test('full ZIP round-trip preserves note attachment bytes', async () => {
  const backup = sampleBackup([sampleNote()]);
  const built = Build.buildFullZipBlob(backup);
  const files = Build.unzipStore(new Uint8Array(await built.blob.arrayBuffer()));
  const metadata = JSON.parse(new TextDecoder().decode(files['backup.json']));
  const path = `media/${NOTE_ID}_${ATTACHMENT_ID}.png`;

  assert.equal(metadata.version, 7);
  assert.equal(metadata.parkedItems[0].attachments[0].data, path);
  assert.deepEqual([...files[path]], [1, 2, 3]);
  const hydrated = Build.rehydrateMedia(metadata.parkedItems, files, metadata.mediaMimes);
  assert.equal(hydrated[0].attachments[0].data, 'data:image/png;base64,AQID');
});

test('lite backup keeps note text and attachment metadata without binary data', async () => {
  const backup = sampleBackup([sampleNote()]);
  const lite = Build.buildLiteBlob(backup);
  const metadata = JSON.parse(await lite.blob.text());
  const imported = Build.prepareImportedBackup(metadata);

  assert.equal(imported.ok, true);
  assert.equal(imported.backup.parkedItems[0].markdown, backup.parkedItems[0].markdown);
  assert.equal(imported.backup.parkedItems[0].attachments[0].name, 'diagram.png');
  assert.equal(imported.backup.parkedItems[0].attachments[0].data, '');
  assert.equal(imported.backup.parkedItems[0].attachments[0].hasData, false);
  assert.equal(Build.validateBackup(imported.backup).ok, true);
});

test('note and global attachment quotas reject oversized metadata', () => {
  const noteLimit = quotaNote(NOTE_ID, 4);
  assert.equal(Build.validateBackup(sampleBackup([noteLimit])).ok, true);
  assert.equal(Build.validateBackup(sampleBackup([quotaNote(NOTE_ID, 5)])).error, 'attachment_quota_exceeded');

  const notes = Array.from({ length: 6 }, (_, index) => quotaNote(
    `${String(index + 1).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    4
  ));
  assert.equal(Build.validateBackup(sampleBackup(notes)).error, 'attachment_quota_exceeded');
});

test('full ZIP preflight includes metadata and ZIP overhead', () => {
  const files = [{ name: 'media/large.webp', data: { length: Build.LIMITS.MAX_ZIP_BYTES } }];
  assert.ok(Build.estimateZipBytes(new Uint8Array([1]), files) > Build.LIMITS.MAX_ZIP_BYTES);
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
