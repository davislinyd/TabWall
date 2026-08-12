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
  assert.deepEqual(recent.map((item) => item.id), ['new', 'grp', 'old']);
  const hits = QS.rankItems(items, 'grafana', SQ);
  assert.deepEqual(hits.map((item) => item.id).sort(), ['grp', 'old']);
});
