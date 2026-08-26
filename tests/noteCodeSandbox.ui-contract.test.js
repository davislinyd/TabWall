import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const JS = fs.readFileSync(new URL('noteCodeSandbox.js', root), 'utf8');
const HTML = fs.readFileSync(new URL('noteCodeSandbox.html', root), 'utf8');

test('sandbox bootstrap creates body before importing HTML fragments', () => {
  assert.match(JS, /'<\/head><body><\/body><script>',/);
  assert.match(JS, /document\.body\.appendChild\(document\.importNode\(node, true\)\)/);
  assert.match(JS, /'<\\\/script><\/html>',/);
  assert.doesNotMatch(JS, /'<\\\/script><\/head><body><\/body><\/html>',/);
});

test('sandbox preserves fragment rendering, web code execution, and error reporting', () => {
  assert.match(JS, /new DOMParser\(\)\.parseFromString\(payload\.webSource, "text\/html"\)/);
  assert.match(JS, /parsed\.querySelectorAll\("script"\)/);
  assert.match(JS, /for \(const source of scripts\)/);
  assert.match(JS, /report\("error", error\?\.message/);
  assert.match(HTML, /<iframe id="preview" sandbox="allow-scripts"/);
  assert.match(HTML, /content-security-policy/i);
});
