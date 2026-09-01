import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadCore() {
  const source = fs.readFileSync(new URL('../aiUiCore.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    URL,
    setTimeout,
    clearTimeout,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'aiUiCore.js' });
  return sandbox.TabWallAiCore;
}

function fakeDocument() {
  const createNode = (tagName, text = '') => ({
    tagName,
    children: [],
    dataset: {},
    textContent: text,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    },
    replaceChildren(...children) {
      this.children = children.flatMap((child) => child?.tagName === '#fragment' ? child.children : [child]);
      this.children.forEach((child) => { child.parentNode = this; });
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
    addEventListener() {},
  });
  return {
    createDocumentFragment: () => createNode('#fragment'),
    createElement: (tagName) => createNode(tagName),
    createTextNode: (value) => createNode('#text', String(value)),
  };
}

function tags(node) {
  return [node.tagName, ...(node.children || []).flatMap(tags)];
}

test('Option letter hotkeys use the physical key and reject modifiers, IME, and repeat', () => {
  const core = loadCore();
  assert.equal(core.isOptionLetterHotkey({ altKey: true, code: 'KeyA' }, 'KeyA'), true);
  assert.equal(core.isOptionLetterHotkey({ altKey: true, code: 'KeyA', key: 'å' }, 'KeyA'), true);
  for (const event of [
    { altKey: false, code: 'KeyA' },
    { altKey: true, metaKey: true, code: 'KeyA' },
    { altKey: true, ctrlKey: true, code: 'KeyA' },
    { altKey: true, shiftKey: true, code: 'KeyA' },
    { altKey: true, code: 'KeyA', repeat: true },
    { altKey: true, code: 'KeyA', isComposing: true },
    { altKey: true, code: 'KeyA', keyCode: 229 },
    { altKey: true, code: 'KeyB' },
  ]) {
    assert.equal(core.isOptionLetterHotkey(event, 'KeyA'), false);
  }
});

test('safe Markdown parser creates readable blocks and inline nodes', () => {
  const core = loadCore();
  const blocks = core.parseSafeMarkdown([
    '# Title',
    '',
    'Paragraph with **bold** and [docs](https://example.com).',
    '',
    '- first',
    '- second',
    '',
    '> quoted',
    '',
    '```js',
    'const value = 1;',
    '```',
  ].join('\n'));

  assert.deepEqual(Array.from(blocks, (block) => block.type), ['heading', 'paragraph', 'list', 'quote', 'code-block']);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[4].value, 'const value = 1;');
  assert.equal(blocks[1].children.find((node) => node.type === 'link').href, 'https://example.com/');

  const rendered = core.renderSafeMarkdown(fakeDocument(), '# Title\n\n- one\n- two\n\n```\ncode\n```');
  assert.deepEqual(Array.from(tags(rendered)), ['#fragment', 'h1', '#text', 'ul', 'li', '#text', 'li', '#text', 'pre', 'code']);
});

test('safe Markdown keeps HTML and unsafe links as text', () => {
  const core = loadCore();
  const source = '<script>alert(1)</script>\n\n![remote](https://example.com/x.png)\n\n[bad](javascript:alert(1))\n\n[data](data:text/html,test)';
  const blocks = core.parseSafeMarkdown(source);
  const serialized = JSON.stringify(blocks);
  assert.match(serialized, /<script>alert\(1\)<\/script>/);
  assert.match(serialized, /!\[remote\]/);
  assert.match(serialized, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.doesNotMatch(serialized, /"href":"(?:javascript|data):/);
  assert.equal(core.isSafeAiUrl('javascript:alert(1)'), '');
  assert.equal(core.isSafeAiUrl('file:///tmp/private.txt'), '');

  const rendered = core.renderSafeMarkdown(fakeDocument(), source);
  const renderedTags = tags(rendered);
  assert.equal(renderedTags.includes('script'), false);
  assert.equal(renderedTags.includes('img'), false);
  assert.equal(renderedTags.includes('a'), false);
});

test('streaming assistant messages render structured Markdown blocks', async () => {
  const core = loadCore();
  const doc = fakeDocument();
  const messages = doc.createElement('div');
  messages.scrollHeight = 0;
  messages.scrollTop = 0;
  messages.clientHeight = 0;
  const ui = core.create({
    document: doc,
    env: { aiMessages: messages },
    t: (key) => key,
  });

  ui.handlePortMessage({ type: 'AI_MESSAGE_START', messageId: 'stream-1' });
  ui.handlePortMessage({ type: 'AI_DELTA', messageId: 'stream-1', text: '# Heading\n\n- item' });
  ui.handlePortMessage({ type: 'AI_MESSAGE_END', messageId: 'stream-1', text: '# Heading\n\n- item' });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const assistantBody = messages.children[0].children[1];
  assert.deepEqual(Array.from(tags(assistantBody)), ['div', 'h1', '#text', 'ul', 'li', '#text']);
});

test('tool rounds collapse intermediate assistant text into one activity row and quota resets cleanly', async () => {
  const core = loadCore();
  const doc = fakeDocument();
  const messages = doc.createElement('div');
  messages.scrollHeight = 0;
  messages.scrollTop = 0;
  messages.clientHeight = 0;
  const quota = doc.createElement('div');
  const ui = core.create({ document: doc, env: { aiMessages: messages, aiQuota: quota }, t: (key) => key });

  ui.handlePortMessage({ type: 'AI_MESSAGE_START', messageId: 'tool-1' });
  ui.handlePortMessage({ type: 'AI_DELTA', messageId: 'tool-1', text: 'I will inspect the page first.' });
  ui.handlePortMessage({ type: 'AI_MESSAGE_END', messageId: 'tool-1', text: 'I will inspect the page first.', hasToolCalls: true });
  ui.handlePortMessage({ type: 'AI_TOOL_RESULT', name: 'list_open_tabs', ok: true });
  ui.handlePortMessage({ type: 'AI_TOOL_RESULT', name: 'read_page', ok: true });
  ui.handlePortMessage({ type: 'AI_MESSAGE_START', messageId: 'final-1' });
  ui.handlePortMessage({ type: 'AI_DELTA', messageId: 'final-1', text: 'Final answer' });
  ui.handlePortMessage({ type: 'AI_MESSAGE_END', messageId: 'final-1', text: 'Final answer', hasToolCalls: false });
  ui.handlePortMessage({ type: 'AI_QUOTA', quota: { requests: { remaining: 95, limit: 100 }, tokens: { remaining: 950000, limit: 1000000, reset: '5d' } } });

  assert.equal(messages.children.length, 2);
  assert.equal(messages.children[0].tagName, 'details');
  assert.equal(messages.children[0].children[1].children.length, 2);
  assert.equal(messages.children[1].className, 'ai-message ai-message-assistant');
  assert.doesNotMatch(messages.children.flatMap((node) => [node.textContent, ...node.children.map((child) => child.textContent)]).join(' '), /inspect the page first/);
  assert.match(quota.textContent, /95 \/ 100/);
  assert.match(quota.textContent, /950K \/ 1M/);
  ui.reset();
  assert.equal(quota.hidden, true);
  assert.equal(quota.textContent, '');
});

test('IME composing Enter is not treated as submit', () => {
  const core = loadCore();
  let inputKeydown;
  let settingsReads = 0;
  const input = {
    addEventListener(type, handler) {
      if (type === 'keydown') inputKeydown = handler;
    },
  };
  const ui = core.create({
    env: { aiInput: input },
    getSettings: () => {
      settingsReads += 1;
      return { enabled: true };
    },
  });
  ui.init();
  let prevented = false;
  inputKeydown({
    key: 'Enter',
    keyCode: 229,
    isComposing: true,
    shiftKey: false,
    stopPropagation() {},
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false);
  assert.equal(settingsReads, 0);
});
