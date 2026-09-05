import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadTagSuggest() {
  const source = fs.readFileSync(new URL('../parkTagSuggest.js', import.meta.url), 'utf8');
  const sandbox = { self: null, console };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'parkTagSuggest.js' });
  sandbox.TabWallTagSuggest.bind({ getLocale: () => 'en' });
  return sandbox.TabWallTagSuggest;
}

test('editor tag suggestions match trimmed substrings case-insensitively and rank by match quality', () => {
  const TagSuggest = loadTagSuggest();
  const plainRows = (value) => Array.from(value, ({ name, count }) => ({ name, count }));
  const rows = [
    { name: 'alpha', count: 2 },
    { name: 'alpine', count: 2 },
    { name: 'alps', count: 9 },
    { name: 'catalog-only', count: 0 },
    { name: 'other', count: 99 },
  ];

  assert.deepEqual(
    plainRows(TagSuggest.filterTagSuggestions(rows, '  AL ', ['ALPS'])),
    [
      { name: 'alpha', count: 2 },
      { name: 'alpine', count: 2 },
      { name: 'catalog-only', count: 0 },
    ],
  );
  assert.deepEqual(plainRows(TagSuggest.filterTagSuggestions(rows, 'CAT')), [{ name: 'catalog-only', count: 0 }]);
  assert.deepEqual(plainRows(TagSuggest.filterTagSuggestions(rows, 'al')), [
    { name: 'alps', count: 9 },
    { name: 'alpha', count: 2 },
    { name: 'alpine', count: 2 },
    { name: 'catalog-only', count: 0 },
  ]);
});

test('editor tag suggestions prefer exact, prefix, then contains matches before usage', () => {
  const TagSuggest = loadTagSuggest();
  const rows = [
    { name: 'elsewhere-sse', count: 100 },
    { name: 'sse-tools', count: 1 },
    { name: 'sse', count: 1 },
    { name: 'asset', count: 99 },
  ];

  assert.deepEqual(
    Array.from(TagSuggest.filterTagSuggestions(rows, ' SSE '), (row) => row.name),
    ['sse', 'sse-tools', 'elsewhere-sse', 'asset'],
  );
});

test('editor tag suggestions cap results at eight and hide blank or unmatched queries', () => {
  const TagSuggest = loadTagSuggest();
  const plainNames = (value) => Array.from(value, (row) => row.name);
  const rows = Array.from({ length: 10 }, (_, index) => ({
    name: `tag-${String(index).padStart(2, '0')}`,
    count: 1,
  }));

  const suggestions = TagSuggest.filterTagSuggestions(rows, 'tag-');
  assert.equal(suggestions.length, 8);
  assert.deepEqual(plainNames(suggestions), rows.slice(0, 8).map((row) => row.name));
  assert.deepEqual(Array.from(TagSuggest.filterTagSuggestions(rows, '   ')), []);
  assert.deepEqual(Array.from(TagSuggest.filterTagSuggestions(rows, 'missing')), []);
});

test('an exact star shows the complete ranked catalog without the normal cap', () => {
  const TagSuggest = loadTagSuggest();
  const rows = [
    { name: 'zulu', count: 1 },
    { name: 'alpha', count: 1 },
    { name: 'popular', count: 9 },
    { name: 'catalog-only', count: 0 },
    ...Array.from({ length: 9 }, (_, index) => ({
      name: `tag-${String.fromCharCode(97 + index)}`,
      count: 2,
    })),
  ];

  assert.deepEqual(
    Array.from(TagSuggest.filterTagSuggestions(rows, '  *  ', ['POPULAR', 'TAG-C']), (row) => row.name),
    [
      'tag-a',
      'tag-b',
      'tag-d',
      'tag-e',
      'tag-f',
      'tag-g',
      'tag-h',
      'tag-i',
      'alpha',
      'zulu',
      'catalog-only',
    ],
  );
  assert.equal(TagSuggest.filterTagSuggestions(rows, '*', [], 1).length, 13);
  assert.deepEqual(Array.from(TagSuggest.filterTagSuggestions(rows, '*abc')), []);
});
