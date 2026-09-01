import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadAi() {
  const src = fs.readFileSync(new URL('../bgAi.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    globalThis: null,
    console,
    URL,
    Map,
    Set,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Date,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    fetch: async () => { throw new Error('fetch should not run in pure tests'); },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'bgAi.js' });
  return { Ai: sandbox.TabWallAi, sandbox };
}

test('AI settings normalize OpenAI-compatible providers and strip unsafe headers', () => {
  const { Ai } = loadAi();
  const normalized = Ai.normalizeAiSettings({
    enabled: true,
    activeProviderId: 'remote',
    providers: [{
      id: 'remote', name: 'Remote', baseUrl: 'https://example.com/v1/', model: 'gpt-test', bearerToken: 'secret',
      headers: [{ name: 'X-API-Key', value: 'key' }, { name: 'Authorization', value: 'bad' }],
    }, { id: 'bad', baseUrl: 'http://example.com/v1' }],
    timeoutMs: 999999,
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.activeProviderId, 'remote');
  assert.equal(normalized.providers.find((provider) => provider.id === 'remote').baseUrl, 'https://example.com/v1');
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.providers.find((provider) => provider.id === 'remote').headers)), [{ name: 'X-API-Key', value: 'key' }]);
  assert.equal(normalized.providers.some((provider) => provider.id === 'bad'), false);
  assert.equal(normalized.providers.some((provider) => provider.id === 'local-llama-cpp'), true);
  assert.equal(normalized.providers.find((provider) => provider.id === 'remote').bypassConfirmations, false);
  assert.equal(normalized.timeoutMs, 180000);
  const publicSettings = Ai.publicAiSettings(normalized);
  assert.equal(JSON.stringify(publicSettings).includes('secret'), false);
});

test('confirmation bypass is scoped to its provider and covers reads and writes', () => {
  const { Ai } = loadAi();
  const localSession = { provider: { baseUrl: 'http://127.0.0.1:8080/v1' } };
  const remoteSession = { provider: { baseUrl: 'https://example.com/v1' } };
  const bypassSession = { provider: { baseUrl: 'https://example.com/v1', bypassConfirmations: true } };
  assert.equal(Ai.toolNeedsConfirmation(localSession, 'list_open_tabs'), false);
  assert.equal(Ai.toolNeedsConfirmation(localSession, 'create_note'), true);
  assert.equal(Ai.toolNeedsConfirmation(remoteSession, 'list_open_tabs'), true);
  assert.equal(Ai.toolNeedsConfirmation(remoteSession, 'create_note'), true);
  assert.equal(Ai.toolNeedsConfirmation(bypassSession, 'list_open_tabs'), false);
  assert.equal(Ai.toolNeedsConfirmation(bypassSession, 'create_note'), false);
});

test('provider headers add bearer auth without allowing system header overrides', () => {
  const { Ai } = loadAi();
  const provider = Ai.selectedProvider(Ai.normalizeAiSettings({ providers: [{
    id: 'remote', baseUrl: 'https://example.com/v1', bearerToken: 'token',
    headers: [{ name: 'X-Test', value: 'yes' }, { name: 'Content-Type', value: 'bad' }],
  }] }), 'remote');
  assert.deepEqual(JSON.parse(JSON.stringify(Ai.providerHeaders(provider, { Accept: 'application/json' }))), {
    Accept: 'application/json', 'X-Test': 'yes', Authorization: 'Bearer token',
  });
});

test('quota headers are public, accept successful or rate-limited responses, and ignore unauthorized responses', () => {
  const { Ai } = loadAi();
  const headers = {
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '95',
    'x-ratelimit-reset-requests': '5d7h',
    'x-ratelimit-limit-tokens': '1000000',
    'x-ratelimit-remaining-tokens': '950000',
    'x-ratelimit-reset-tokens': '5d7h',
  };
  const response = (status) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] || null },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(Ai.parseQuotaHeaders(response(200)))), {
    requests: { remaining: 95, limit: 100, reset: '5d7h' },
    tokens: { remaining: 950000, limit: 1000000, reset: '5d7h' },
  });
  assert.equal(Ai.parseQuotaHeaders(response(401)), null);
  assert.equal(Ai.parseQuotaHeaders(response(429)).requests.remaining, 95);
});

test('AI settings normalize context size with safe bounds', () => {
  const { Ai } = loadAi();
  assert.equal(Ai.normalizeAiSettings({}).contextSize, 8192);
  assert.equal(Ai.normalizeAiSettings({ contextSize: 1 }).contextSize, 2048);
  assert.equal(Ai.normalizeAiSettings({ contextSize: 999999 }).contextSize, 131072);
  assert.equal(Ai.normalizeAiSettings({ contextSize: 16384 }).contextSize, 16384);
});

test('built-in schemas and bridge allowlist reject collisions and unsafe names', () => {
  const { Ai } = loadAi();
  const names = Ai.getBuiltinTools().map((tool) => tool.function.name);
  assert.ok(names.includes('read_page'));
  assert.equal(Ai.normalizeBridgeTool({ name: 'list_open_tabs' }, ['list_open_tabs']), null);
  assert.equal(Ai.normalizeBridgeTool({ name: '../secrets' }, ['../secrets']), null);
  const tool = Ai.normalizeBridgeTool({
    name: 'read_mail',
    risk: 'read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }, ['read_mail']);
  assert.equal(tool.name, 'bridge_read_mail');
  assert.equal(tool.tool.function.parameters.type, 'object');
});

test('model tool schemas omit llama.cpp-incompatible maxLength constraints', async () => {
  const { Ai, sandbox } = loadAi();
  let requestBody = null;
  sandbox.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      async text() {
        return JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
      },
    };
  };
  const session = {
    model: 'local',
    messages: [{ role: 'user', content: 'hello' }],
    tools: Ai.getBuiltinTools(),
    toolsAvailable: true,
    aiSettings: { baseUrl: 'http://127.0.0.1:8080/v1', timeoutMs: 1000 },
    abortController: new AbortController(),
    port: { postMessage() {} },
  };
  await Ai.requestChat(session);
  assert.ok(requestBody);
  assert.equal(requestBody.max_tokens, 768);
  assert.doesNotMatch(JSON.stringify(requestBody.tools), /maxLength/);
  assert.match(JSON.stringify(Ai.getBuiltinTools()), /maxLength/);
});

test('chat uses the selected OpenAI-compatible provider headers', async () => {
  const { Ai, sandbox } = loadAi();
  let requestUrl = '';
  let requestHeaders = null;
  sandbox.fetch = async (url, options) => {
    requestUrl = url;
    requestHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => ({
        'content-type': 'application/json',
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '95',
      })[name] || null },
      body: null,
      async text() { return JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }); },
    };
  };
  const provider = Ai.selectedProvider(Ai.normalizeAiSettings({ providers: [{
    id: 'remote', baseUrl: 'https://remote.example/v1', bearerToken: 'token', headers: [{ name: 'X-Client', value: 'TabWall' }],
  }] }), 'remote');
  const events = [];
  await Ai.requestChat({
    model: 'remote-model', messages: [{ role: 'user', content: 'hello' }], tools: [], toolsAvailable: false,
    provider, aiSettings: { timeoutMs: 1000, contextSize: 8192 }, abortController: new AbortController(), port: { postMessage(message) { events.push(message); } },
  });
  assert.equal(requestUrl, 'https://remote.example/v1/chat/completions');
  assert.equal(requestHeaders.Authorization, 'Bearer token');
  assert.equal(requestHeaders['X-Client'], 'TabWall');
  assert.deepEqual(JSON.parse(JSON.stringify(events.find((event) => event.type === 'AI_QUOTA')?.quota)), {
    requests: { remaining: 95, limit: 100 },
    tokens: null,
  });
  assert.equal(JSON.stringify(events).includes('Bearer '), false);
});

test('request budgeting trims large tool results while preserving the current turn', () => {
  const { Ai } = loadAi();
  const session = {
    model: 'local',
    messages: [
      { role: 'system', content: 'policy' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'current question: summarize the focused page' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_page', arguments: '{"tabId":7}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '頁面內容 '.repeat(12000) },
    ],
    tools: Ai.getBuiltinTools(),
    toolsAvailable: true,
    aiSettings: { baseUrl: 'http://127.0.0.1:8000/v1', timeoutMs: 1000, contextSize: 8192 },
    abortController: new AbortController(),
    port: { postMessage() {} },
  };
  const prepared = Ai.prepareRequestBody(session);
  assert.equal(prepared.contextSize, 8192);
  assert.equal(prepared.trimmed, true);
  assert.ok(prepared.estimatedTokens <= 8192 - 768);
  assert.equal(prepared.body.messages[0].role, 'system');
  assert.equal(prepared.body.messages.some((message) => message.role === 'user' && message.content.includes('current question')), true);
  assert.equal(prepared.body.messages.some((message) => message.role === 'assistant' && message.tool_calls), true);
  const toolMessage = prepared.body.messages.find((message) => message.role === 'tool');
  assert.ok(toolMessage);
  assert.match(toolMessage.content, /context truncated/);
});

test('context search matches open tabs and saved metadata without page bodies', () => {
  const { Ai } = loadAi();
  const snapshot = {
    createdAt: 1,
    openTabs: [{ tabId: 7, title: 'Design notes', url: 'https://docs.test/design', note: '' }],
    savedItems: [{ ref: 'saved-1', title: 'Project plan', url: 'https://wiki.test/plan', note: 'launch checklist', tags: ['work'] }],
  };
  assert.deepEqual(Array.from(Ai.searchContext(snapshot, 'checklist', 10).map((item) => item.ref)), ['saved-1']);
  assert.deepEqual(Array.from(Ai.searchContext(snapshot, 'design', 10).map((item) => item.tabId)), [7]);
  assert.equal(Ai.publicContext(snapshot).savedItemCount, 1);
});

test('context index marks the last-focused tab and prioritizes it', async () => {
  const { Ai, sandbox } = loadAi();
  sandbox.getParkedItems = async () => [];
  sandbox.chrome = {
    tabs: {
      async query(query) {
        if (query?.lastFocusedWindow) return [{ id: 9 }];
        return [
          { id: 7, windowId: 1, active: true, title: 'Other window', url: 'https://other.test' },
          { id: 9, windowId: 2, active: true, title: 'Focused window', url: 'https://focused.test' },
        ];
      },
    },
  };
  const snapshot = await Ai.buildContextIndex();
  assert.equal(snapshot.openTabs[0].tabId, 9);
  assert.equal(snapshot.openTabs[0].focused, true);
  assert.equal(snapshot.openTabs[1].focused, false);
});

test('context index prioritizes the tab that opened an external AI panel', async () => {
  const { Ai, sandbox } = loadAi();
  sandbox.getParkedItems = async () => [];
  sandbox.chrome = {
    tabs: {
      async query(query) {
        if (query?.lastFocusedWindow) return [{ id: 9 }];
        return [
          { id: 7, windowId: 1, active: false, title: 'Opened page', url: 'https://opened.test' },
          { id: 9, windowId: 1, active: true, title: 'Other page', url: 'https://other.test' },
        ];
      },
    },
  };
  const snapshot = await Ai.buildContextIndex(7);
  assert.equal(snapshot.openTabs[0].tabId, 7);
  assert.equal(snapshot.openTabs[0].focused, true);
  assert.equal(snapshot.openTabs[1].focused, false);
});

test('page extractor omits DOM controls and truncates visible text', () => {
  const { Ai, sandbox } = loadAi();
  const clone = {
    innerText: 'Visible page text password-looking input should not appear',
    querySelectorAll() { return []; },
  };
  const body = {
    cloneNode() { return clone; },
  };
  sandbox.document = {
    title: 'Example',
    body,
    querySelector() { return null; },
  };
  sandbox.location = { href: 'https://example.test/page' };
  sandbox.window = {
    getSelection() { return { toString: () => 'selected text' }; },
  };
  const result = Ai.extractPageContext(12);
  assert.equal(result.title, 'Example');
  assert.equal(result.selection, 'selected text');
  assert.equal(result.text.length, 12);
  assert.equal(result.truncated, true);
});

test('restricted tabs return metadata without attempting page injection', async () => {
  const { Ai, sandbox } = loadAi();
  let injected = false;
  sandbox.chrome = {
    tabs: {
      async get() {
        return { id: 9, incognito: false, title: 'Settings', url: 'chrome://settings/' };
      },
    },
    scripting: {
      async executeScript() {
        injected = true;
        return [];
      },
    },
  };
  const result = await Ai.readPage({ snapshot: { tabIds: new Set([9]) } }, { tabId: 9 });
  assert.equal(result.error, 'restricted_page');
  assert.equal(injected, false);
});

test('SSE parser emits JSON data frames and ignores malformed keep-alives', async () => {
  const { Ai } = loadAi();
  const chunks = ['data: {"n":1}\n\n', ': keep-alive\n\n', 'data: {"n":2}\n\ndata: [DONE]\n\n'];
  const response = {
    body: {
      getReader() {
        return {
          async read() {
            if (!chunks.length) return { done: true, value: undefined };
            return { done: false, value: new TextEncoder().encode(chunks.shift()) };
          },
        };
      },
    },
  };
  const events = [];
  await Ai.parseSse(response, (event) => events.push(event));
  assert.deepEqual(events, [{ n: 1 }, { n: 2 }]);
});

test('chat falls back to JSON chat-only mode when tools are rejected', async () => {
  const { Ai, sandbox } = loadAi();
  const responses = [
    {
      ok: false,
      status: 400,
      body: null,
      async text() { return JSON.stringify({ error: { message: 'tools are not supported' } }); },
    },
    {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      async text() { return JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'local answer' } }] }); },
    },
  ];
  sandbox.fetch = async () => responses.shift();
  const events = [];
  const session = {
    model: 'local',
    messages: [{ role: 'user', content: 'hello' }],
    tools: Ai.getBuiltinTools(),
    toolsAvailable: true,
    aiSettings: { baseUrl: 'http://127.0.0.1:8080/v1', timeoutMs: 1000 },
    abortController: new AbortController(),
    port: { postMessage(message) { events.push(message); } },
  };
  const message = await Ai.requestChat(session);
  assert.equal(message.content, 'local answer');
  assert.equal(session.toolsAvailable, false);
  assert.equal(events[0].type, 'AI_TOOLS_UNAVAILABLE');
});

test('chat retries one server context error with aggressive compaction', async () => {
  const { Ai, sandbox } = loadAi();
  let calls = 0;
  sandbox.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 400,
      body: null,
      async text() {
        return JSON.stringify({ error: { message: 'request (8615 tokens) exceeds the available context size (8192 tokens)' } });
      },
    };
  };
  const events = [];
  const session = {
    model: 'local',
    messages: [{ role: 'system', content: 'policy' }, { role: 'user', content: 'read the page' }],
    tools: Ai.getBuiltinTools(),
    toolsAvailable: true,
    aiSettings: { baseUrl: 'http://127.0.0.1:8000/v1', timeoutMs: 1000, contextSize: 8192 },
    abortController: new AbortController(),
    port: { postMessage(message) { events.push(message); } },
  };
  await assert.rejects(() => Ai.requestChat(session), /match llama-server -c/);
  assert.equal(calls, 2);
  assert.equal(events.filter((message) => message.type === 'AI_CONTEXT_TRIMMED').length, 1);
});
