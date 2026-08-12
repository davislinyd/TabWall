import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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
    JSON,
    Math,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'parkSearchQuery.js' });
  return sandbox.TabWallSearchQuery;
}

test('TabWallSearchQuery matches plain title/url haystack', () => {
  const SQ = loadSearchQuery();
  let query = 'example';
  SQ.bind({
    getSearchScope: () => 'all',
    getSearchRegex: () => false,
    getQuery: () => query,
  });
  SQ.compileSearchQuery(query);
  const hit = { kind: 'tab', title: 'Example Site', url: 'https://foo.test/', note: '', tags: [] };
  const miss = { kind: 'tab', title: 'Other', url: 'https://bar.test/', note: '', tags: [] };
  assert.equal(SQ.matchesQuery(hit, query), true);
  assert.equal(SQ.matchesQuery(miss, query), false);
});

test('TabWallSearchQuery tag expression and domain scope + invalid regex boundary', () => {
  const SQ = loadSearchQuery();
  let query = 'work && read';
  SQ.bind({
    getSearchScope: () => 'tag',
    getSearchRegex: () => false,
    getQuery: () => query,
  });
  SQ.compileSearchQuery(query);
  assert.equal(SQ.isTagExpressionMode(), true);
  const tagged = { kind: 'tab', title: 'A', url: 'https://a.test/', tags: ['work', 'read'], note: '' };
  const partial = { kind: 'tab', title: 'B', url: 'https://b.test/', tags: ['work'], note: '' };
  assert.equal(SQ.matchesQuery(tagged, query), true);
  assert.equal(SQ.matchesQuery(partial, query), false);

  query = 'example.com';
  SQ.bind({
    getSearchScope: () => 'domain',
    getSearchRegex: () => false,
    getQuery: () => query,
  });
  SQ.compileSearchQuery(query);
  const domainHit = { kind: 'tab', title: 'X', url: 'https://www.example.com/path', tags: [], note: '' };
  const domainMiss = { kind: 'tab', title: 'Y', url: 'https://other.test/', tags: [], note: '' };
  assert.equal(SQ.domainOf(domainHit.url), 'www.example.com');
  assert.equal(SQ.matchesQuery(domainHit, query), true);
  assert.equal(SQ.matchesQuery(domainMiss, query), false);

  query = '(unclosed';
  SQ.bind({
    getSearchScope: () => 'all',
    getSearchRegex: () => true,
    getQuery: () => query,
  });
  assert.doesNotThrow(() => SQ.compileSearchQuery(query));
  const compiled = SQ.getCompiledSearch();
  assert.ok(compiled.err);
  assert.equal(compiled.re, null);
  assert.equal(SQ.matchesQuery(domainHit, query), false);
});
