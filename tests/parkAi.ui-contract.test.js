import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('AI panel exposes local endpoint, bridge, sources, and confirmation controls', () => {
  const html = read('park.html');
  const manifest = JSON.parse(read('manifest.json'));
  assert.match(html, /id="aiBox"/);
  assert.match(html, /id="aiSources"/);
  assert.match(html, /id="settingsAiBaseUrl"/);
  assert.match(html, /id="settingsAiBridgeUrl"/);
  assert.match(html, /id="settingsAiContextSize"/);
  assert.match(html, /id="aiBridgeToken"/);
  assert.match(html, /id="aiBridgeToken"[^>]*autocomplete="new-password"/);
  assert.match(html, /data-settings-section="ai"/);
  assert.equal(manifest.version, '2.59.2');
  assert.ok(manifest.web_accessible_resources[0].resources.includes('parkAiUi.js'));
  assert.deepEqual(manifest.content_scripts?.[0]?.js, ['parkSearchQuery.js', 'quickSearch.js', 'aiUiCore.js', 'aiPanel.js', 'content.js', 'pageAnnotate.js']);
});

test('AI UI renders model and tool data as text', () => {
  const ui = read('aiUiCore.js');
  assert.doesNotMatch(ui, /innerHTML/);
  assert.match(ui, /textContent/);
  assert.match(ui, /parseSafeMarkdown/);
  assert.match(ui, /createTextNode/);
  assert.match(ui, /AI_CONFIRM_TOOL/);
  assert.match(ui, /JSON\.stringify\(message\?\.arguments/);
});

test('AI message classes and scrollbar surfaces match both panel implementations', () => {
  const external = read('aiPanel.js');
  const css = read('park.css');
  const ui = read('aiUiCore.js');
  assert.match(external, /\.ai-message-text h1/);
  assert.match(external, /color-scheme: light/);
  assert.match(external, /\.ai-messages::-webkit-scrollbar-track/);
  assert.match(external, /bridgeToken = null/);
  assert.match(external, /resize-height-handle/);
  assert.match(external, /DOUBLE_ESCAPE_WINDOW_MS = 500/);
  assert.match(external, /FAB_SIZE = 52 \* 0\.6/);
  assert.match(ui, /AI_CONTEXT_TRIMMED/);
  assert.match(css, /\.ai-message-text h1/);
  assert.match(css, /scrollbar-color: var\(--border-strong\) var\(--panel\)/);
  assert.match(css, /\.ai-messages::-webkit-scrollbar-track/);
});

test('AI waiting state animates and search ai token opens the AI panel', () => {
  const ui = read('aiUiCore.js');
  const external = read('aiPanel.js');
  const internal = read('parkAiUi.js');
  const searchUi = read('parkSearchUi.js');
  const css = read('park.css');
  assert.match(ui, /t\('aiWorking'\)/);
  assert.doesNotMatch(ui, /message\.bridgeError \? ` ·/);
  assert.match(external, /tabwall-external-ai-dots/);
  assert.match(searchUi, /ai: 'ai'/);
  assert.match(searchUi, /ctx\.openAiBox\(\)/);
  assert.match(internal, /isOptionLetterHotkey/);
  assert.match(internal, /handleAiShortcut/);
  assert.match(internal, /addEventListener\('keydown', handleAiShortcut, true\)/);
  assert.match(internal, /openAiBox\(\)/);
  assert.match(css, /tabwall-ai-waiting-dots/);
});

test('AI runtime keeps bridge calls on registered tools and loopback URLs', () => {
  const runtime = read('bgAi.js');
  assert.match(runtime, /GET.*tools|fetchBridgeJson\(session, 'tools'/s);
  assert.match(runtime, /tools\/call/);
  assert.match(runtime, /LOOPBACK_HOSTS/);
  assert.match(runtime, /BUILTIN_TOOL_NAMES\.has\(rawName\)/);
  assert.doesNotMatch(runtime, /fetch\(args\.url/);
});
