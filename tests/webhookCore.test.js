import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../webhookCore.js', import.meta.url), 'utf8');

function loadCore() {
  const sandbox = { URL, crypto: globalThis.crypto, Date, Math, console };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'webhookCore.js' });
  return sandbox.TabWallWebhookCore;
}

test('webhook profiles normalize HTTP URLs, headers, limits, and IDs', () => {
  const core = loadCore();
  assert.equal(core.normalizeUrl('https://hooks.example.test/path'), 'https://hooks.example.test/path');
  assert.equal(core.normalizeUrl('javascript:alert(1)'), '');
  assert.equal(core.normalizeUrl('file:///tmp/hook'), '');
  assert.equal(core.normalizeUrl('https://user:pass@hooks.example.test/'), '');

  const headers = core.normalizeHeaders({
    authorization: 'old',
    Authorization: 'new',
    'Content-Type': 'application/json',
    'bad header': 'ignored',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(headers)), {
    Authorization: 'new',
    'Content-Type': 'application/json',
  });

  const profiles = core.normalizeProfiles([
    { id: 'same', name: 'One', url: 'https://one.example.test', headers, body: 'A' },
    { id: 'same', name: 'Two', url: 'https://two.example.test', body: 'B' },
  ]);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].id, 'same');
  assert.notEqual(profiles[1].id, 'same');
  assert.deepEqual(JSON.parse(JSON.stringify(profiles[0].headers)), JSON.parse(JSON.stringify(headers)));
  assert.equal(profiles[0].body, 'A');
});

test('webhook body templates expose reminder context and preserve unknown tokens', () => {
  const core = loadCore();
  assert.equal(core.sampleContext().nextAt, 1735689600000);
  const nextAt = 1735689600000;
  const context = core.buildContext({
    id: 'card-1',
    title: 'Original title',
    displayTitle: 'Shown title',
    url: 'https://example.test/card-1',
    tags: ['one', 'two'],
  }, {
    mode: 'interval',
    message: 'Review it',
    nextAt,
  });
  assert.equal(context.title, 'Original title');
  assert.equal(context.displayTitle, 'Shown title');
  assert.equal(context.mode, 'interval');
  assert.equal(context.nextAt, nextAt);
  assert.equal(context.nextAtIso, new Date(nextAt).toISOString());
  assert.equal(
    core.renderBodyTemplate(
      '{{id}}|{{title}}|{{displayTitle}}|{{url}}|{{message}}|{{mode}}|{{nextAt}}|{{nextAtIso}}|{{tags}}|{{unknown}}',
      context,
    ),
    `card-1|Original title|Shown title|https://example.test/card-1|Review it|interval|${nextAt}|${new Date(nextAt).toISOString()}|one, two|{{unknown}}`,
  );
  const json = core.renderBodyTemplate('{{json}}', context);
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(context)));
});

test('webhook profile validation rejects unsafe or oversized input', () => {
  const core = loadCore();
  assert.equal(core.validateProfile({ url: 'http://hooks.example.test', headers: { 'X-Test': 'ok' } }).ok, true);
  assert.equal(core.validateProfile({ url: 'ftp://hooks.example.test' }).error, 'invalid_webhook_url');
  assert.equal(core.validateProfile({ url: 'https://hooks.example.test', headers: { 'bad header': 'x' } }).error, 'invalid_webhook_header_name');
  assert.equal(core.validateProfile({ url: 'https://hooks.example.test', headers: { 'X-Test': 'line\nbreak' } }).error, 'invalid_webhook_header_value');
  assert.equal(core.validateProfile({ url: 'https://hooks.example.test', body: 'x'.repeat(core.MAX_BODY_LENGTH + 1) }).error, 'webhook_body_too_long');

  const ids = core.normalizeProfileIds(['one', 'one', 'bad id', 'two']);
  assert.deepEqual(Array.from(ids), ['one', 'two']);
});
