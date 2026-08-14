import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadQuickSearch(searchQuery) {
  const src = fs.readFileSync(new URL('../quickSearch.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    window: undefined,
    document: undefined,
    console,
    URL,
    Array,
    Object,
    Number,
    String,
    Boolean,
    TabWallSearchQuery: searchQuery,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'quickSearch.js' });
  return sandbox.TabWallQuickSearch;
}

function loadSearchQuery() {
  const src = fs.readFileSync(new URL('../parkSearchQuery.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    console,
    URL,
    Map,
    Set,
    RegExp,
    Number,
    String,
    Array,
    Object,
    Boolean,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'parkSearchQuery.js' });
  return sandbox.TabWallSearchQuery;
}

test('Option+/ hotkey uses code=Slash and ignores Option-remapped key', () => {
  const QS = loadQuickSearch();
  assert.equal(QS.isQuickSearchHotkey({ altKey: true, code: 'Slash', key: '/' }), true);
  assert.equal(QS.isQuickSearchHotkey({ altKey: true, code: 'Slash', key: '÷' }), true);
  assert.equal(QS.isQuickSearchHotkey({ altKey: false, code: 'Slash', key: '/' }), false);
  assert.equal(QS.isQuickSearchHotkey({ altKey: true, metaKey: true, code: 'Slash', key: '/' }), false);
  assert.equal(QS.isQuickSearchHotkey({ altKey: true, shiftKey: true, code: 'Slash', key: '?' }), false);
  assert.equal(QS.isQuickSearchHotkey({ altKey: true, code: 'KeyS', key: 's' }), false);
});

test('quick search ranks recent restorable items and reuses SearchQuery', () => {
  const SQ = loadSearchQuery();
  const QS = loadQuickSearch(SQ);
  const items = [
    { kind: 'tab', id: 'old', title: 'Grafana dash', url: 'https://old.example/', savedAt: 1 },
    { kind: 'note', id: 'note', title: 'Grafana note', savedAt: 9 },
    { kind: 'tab', id: 'new', title: 'Other', url: 'https://new.example/', savedAt: 8 },
    { kind: 'group', id: 'grp', title: 'Grafana stack', tabs: [{ title: 'a', url: 'https://g.example/' }], savedAt: 3 },
  ];
  const recent = QS.rankItems(items, '');
  assert.deepEqual(recent.map((item) => item.id), ['note', 'new', 'grp', 'old']);
  const hits = QS.rankItems(items, 'grafana', SQ);
  assert.deepEqual(hits.map((item) => item.id).sort(), ['grp', 'note', 'old']);
});

test('quick search scopes match tag / group / note / reminder / domain', () => {
  const SQ = loadSearchQuery();
  const QS = loadQuickSearch(SQ);
  assert.equal(QS.resolveScopeToken('t'), 'tag');
  assert.equal(QS.resolveScopeToken('tag'), 'tag');
  assert.equal(QS.resolveScopeToken('nn'), 'reminder');
  assert.equal(QS.resolveScopeToken('noti'), 'reminder');
  assert.equal(QS.resolveScopeToken('tab'), '');
  const items = [
    { kind: 'tab', id: 't1', title: 'Alpha', url: 'https://work.example/', tags: ['work'], savedAt: 1 },
    { kind: 'tab', id: 't2', title: 'Beta', url: 'https://other.test/', tags: ['play'], savedAt: 2 },
    { kind: 'note', id: 'n1', title: 'Memo', markdown: 'remember', tags: ['work'], savedAt: 3 },
    { kind: 'group', id: 'g1', title: 'Stack', tags: [], tabs: [{ title: 'Mem', url: 'https://work.example/m', tags: ['ops'] }], savedAt: 4 },
    { kind: 'tab', id: 'r1', title: 'Reminder card', url: 'https://reminder.example/', reminder: { message: 'buy milk' }, savedAt: 5 },
  ];
  assert.deepEqual(QS.rankItems(items, 'work', SQ, 'tag').map((item) => item.id).sort(), ['n1', 't1']);
  assert.deepEqual(QS.rankItems(items, '', SQ, 'group').map((item) => item.id), ['g1']);
  assert.deepEqual(QS.rankItems(items, 'memo', SQ, 'note').map((item) => item.id), ['n1']);
  assert.deepEqual(QS.rankItems(items, '', SQ, 'nn').map((item) => item.id), ['r1']);
  assert.deepEqual(QS.rankItems(items, 'milk', SQ, 'noti').map((item) => item.id), ['r1']);
  assert.deepEqual(QS.rankItems(items, 'reminder.example', SQ, 'reminder').map((item) => item.id), ['r1']);
  assert.deepEqual(QS.rankItems(items, 'work.example', SQ, 'domain').map((item) => item.id).sort(), ['g1', 't1']);
});

test('preview fields expose snap key, note, tags, and group member media', () => {
  const QS = loadQuickSearch();
  const tab = {
    kind: 'tab',
    id: 'tab-1',
    title: 'Docs',
    url: 'https://docs.example/path',
    note: 'read later',
    tags: ['work', ''],
    hasSnap: true,
    hasThumb: true,
    savedAt: 1700000000000,
  };
  const tabPreview = QS.previewFields(tab);
  assert.equal(QS.mediaKeyForPreview(tab), 't:tab-1');
  assert.equal(tabPreview.mediaKind, 'snap');
  assert.equal(tabPreview.note, 'read later');
  assert.deepEqual(tabPreview.tags, ['work']);

  const group = {
    kind: 'group',
    id: 'g1',
    title: 'Stack',
    note: 'group note',
    tags: ['stack'],
    tabs: [
      { id: 'm1', title: 'A', url: 'https://a.example/', hasThumb: false, hasSnap: false },
      { id: 'm2', title: 'B', url: 'https://b.example/', hasThumb: true, hasSnap: false },
    ],
  };
  const groupPreview = QS.previewFields(group);
  assert.equal(QS.mediaKeyForPreview(group), 'g:g1:m2');
  assert.equal(groupPreview.mediaKind, 'thumb');
  assert.equal(groupPreview.url, '');
  assert.equal(groupPreview.note, 'group note');
  assert.equal(groupPreview.members.length, 2);
});
