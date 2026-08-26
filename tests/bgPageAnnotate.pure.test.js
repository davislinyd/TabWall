import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadAnnotate() {
  const src = fs.readFileSync(new URL('../bgPageAnnotate.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    globalThis: null,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Set,
    JSON,
    crypto: { randomUUID: () => 'live-test-id' },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'bgPageAnnotate.js' });
  return sandbox.TabWallPageAnnotate;
}

test('normalizePageAnnotation keeps exact URL identity and strips control chars', () => {
  const A = loadAnnotate();
  const ann = A.normalizePageAnnotation({
    url: 'https://example.com/a?q=1#h',
    title: 'Hello\u0000World',
    note: 'n1',
    tags: [' work ', 'work', 'read', ''],
    overlayVisible: 'yes',
    hasInk: 1,
  });
  assert.equal(ann.url, 'https://example.com/a?q=1#h');
  assert.equal(ann.title, 'HelloWorld');
  assert.equal(ann.tags.join('\0'), ['work', 'read'].join('\0'));
  assert.equal(ann.overlayVisible, false);
  assert.equal(ann.hasInk, false);
  assert.equal(A.normalizePageAnnotation({ url: '' }), null);
});

test('page Sticker placements are bounded, deduplicated, and keep page records live', () => {
  const A = loadAnnotate();
  const ann = A.normalizePageAnnotation({
    url: 'https://sticker.test/',
    stickers: [
      { noteId: 'note-a', x: -10, y: 20, w: 80, h: 900, z: 2 },
      { noteId: 'note-a', x: 50, y: 60, w: 300, h: 200, z: 3 },
      { noteId: 'note-b', x: 100, y: 120, w: 640, h: 560, z: 4 },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(ann.stickers)), [
    { noteId: 'note-a', x: 0, y: 20, w: 160, h: 560, z: 2 },
    { noteId: 'note-b', x: 100, y: 120, w: 640, h: 560, z: 4 },
  ]);
  assert.equal(A.pageAnnotationIsKeepable(ann), true);
  assert.equal(A.toLiveWallItem(ann).stickerCount, 2);
});

test('merge live tags/notes unions tags and concatenates distinct notes', () => {
  const A = loadAnnotate();
  assert.equal(A.mergeAnnotationNotes('keep', ''), 'keep');
  assert.equal(A.mergeAnnotationNotes('', 'next'), 'next');
  assert.equal(A.mergeAnnotationNotes('same', 'same'), 'same');
  assert.equal(A.mergeAnnotationNotes('alpha\nbeta', 'beta'), 'alpha\nbeta');
  assert.equal(A.mergeAnnotationNotes('alpha', 'beta'), 'alpha\nbeta');
  const merged = A.mergeLiveIntoSaveMeta(
    { note: 'live note', tags: ['a', 'b'] },
    { note: 'hint', tags: ['b', 'c'] },
  );
  assert.equal(merged.note, 'live note\nhint');
  assert.equal(merged.tags.join('\0'), ['a', 'b', 'c'].join('\0'));
});

test('consumeAnnotationMeta drops tags/notes but keeps ink/overlay records', () => {
  const A = loadAnnotate();
  const kept = A.consumeAnnotationMeta({
    id: 'x',
    url: 'https://a.test/',
    note: 'gone',
    tags: ['t'],
    hasInk: true,
    overlayVisible: true,
  });
  assert.equal(kept.note, '');
  assert.equal(kept.tags.length, 0);
  assert.equal(kept.hasInk, true);
  assert.equal(kept.overlayVisible, true);

  const dropped = A.consumeAnnotationMeta({
    id: 'y',
    url: 'https://b.test/',
    note: 'gone',
    tags: ['t'],
    hasInk: false,
    overlayVisible: false,
  });
  assert.equal(dropped, null);
});

test('live wall hides parked URLs and empty overlay-only records', () => {
  const A = loadAnnotate();
  const parked = [
    { kind: 'tab', url: 'https://saved.test/a', tags: [] },
    { kind: 'group', tabs: [{ url: 'https://saved.test/member' }] },
  ];
  const live = A.normalizePageAnnotation({
    url: 'https://open.test/',
    note: 'hi',
    tags: ['x'],
  });
  assert.equal(A.liveWallVisible(live, parked), true);
  assert.equal(A.liveWallVisible({ ...live, url: 'https://saved.test/a' }, parked), false);
  assert.equal(A.liveWallVisible({ ...live, url: 'https://saved.test/member' }, parked), false);
  assert.equal(A.liveWallVisible({
    url: 'https://open.test/',
    note: '',
    tags: [],
    hasInk: false,
    overlayVisible: true,
  }, parked), false);
  assert.equal(A.liveWallVisible({
    url: 'https://open.test/',
    note: '',
    tags: [],
    hasInk: true,
  }, parked), true);
  assert.equal(A.toLiveWallItem(live).kind, 'live');
});

test('findParkedTabForUrl matches standalone tabs and group members', () => {
  const A = loadAnnotate();
  const items = [
    { kind: 'tab', id: 't1', url: 'https://a.test/?x=1' },
    { kind: 'group', id: 'g1', tabs: [{ id: 'm1', url: 'https://b.test/#z' }] },
  ];
  assert.equal(A.findParkedTabForUrl('https://a.test/?x=1', items).kind, 'tab');
  assert.equal(A.findParkedTabForUrl('https://b.test/#z', items).kind, 'member');
  assert.equal(A.findParkedTabForUrl('https://miss.test/', items), null);
});
