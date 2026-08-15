import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadPanel() {
  const source = fs.readFileSync(new URL('../aiPanel.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    document: undefined,
    navigator: { language: 'zh-TW' },
    innerWidth: 1440,
    innerHeight: 900,
    console,
    Number,
    String,
    Boolean,
    Math,
    Array,
    Object,
    Set,
    Promise,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'aiPanel.js' });
  return sandbox.TabWallAiPanel;
}

test('Option+A uses physical KeyA and ignores other modifiers', () => {
  const panel = loadPanel();
  assert.equal(panel.isAiPanelHotkey({ altKey: true, code: 'KeyA' }), true);
  assert.equal(panel.isAiPanelHotkey({ altKey: true, code: 'KeyA', key: 'å' }), true);
  assert.equal(panel.isAiPanelHotkey({ altKey: false, code: 'KeyA' }), false);
  assert.equal(panel.isAiPanelHotkey({ altKey: true, metaKey: true, code: 'KeyA' }), false);
  assert.equal(panel.isAiPanelHotkey({ altKey: true, ctrlKey: true, code: 'KeyA' }), false);
  assert.equal(panel.isAiPanelHotkey({ altKey: true, shiftKey: true, code: 'KeyA' }), false);
  assert.equal(panel.isAiPanelHotkey({ altKey: true, code: 'KeyB' }), false);
});

test('AI shortcut leaves editable page controls alone', () => {
  const panel = loadPanel();
  assert.equal(panel.isEditableTarget({ nodeType: 1, tagName: 'INPUT' }), true);
  assert.equal(panel.isEditableTarget({ nodeType: 1, tagName: 'textarea' }), true);
  assert.equal(panel.isEditableTarget({ nodeType: 1, tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(panel.isEditableTarget({ nodeType: 1, tagName: 'main' }), false);
});

test('Shadow DOM panel keyboard events are isolated from the host page', () => {
  const panel = loadPanel();
  const host = {};
  const input = {};
  assert.equal(panel.isAiPanelKeyboardEvent({ type: 'keydown', composedPath: () => [input, host] }, host), true);
  assert.equal(panel.isAiPanelKeyboardEvent({ type: 'keyup', composedPath: () => [input, host] }, host), true);
  assert.equal(panel.isAiPanelKeyboardEvent({ type: 'keydown', composedPath: () => [input] }, host), false);
  assert.equal(panel.isAiPanelKeyboardEvent({ type: 'click', composedPath: () => [input, host] }, host), false);
});

test('double Escape uses a 500ms non-IME window and the FAB is 60% of its old size', () => {
  const panel = loadPanel();
  assert.equal(panel.DOUBLE_ESCAPE_WINDOW_MS, 500);
  assert.equal(panel.isDoubleEscapePress(1500, 1000), true);
  assert.equal(panel.isDoubleEscapePress(1501, 1000), false);
  assert.equal(panel.isDoubleEscapePress(1500, 0), false);
  assert.equal(panel.shouldMinimizeOnEscape({ key: 'Escape' }, 1500, 1000), true);
  assert.equal(panel.shouldMinimizeOnEscape({ key: 'Escape', isComposing: true }, 1500, 1000), false);
  assert.equal(panel.shouldMinimizeOnEscape({ key: 'Escape', keyCode: 229 }, 1500, 1000), false);
  assert.equal(panel.shouldMinimizeOnEscape({ key: 'Escape', repeat: true }, 1500, 1000), false);
  assert.equal(panel.shouldMinimizeOnEscape({ key: 'Enter' }, 1500, 1000), false);
  assert.equal(panel.FAB_SIZE, 31.2);
});

test('layout normalizes width, height, panel position, fab position, and collapse state', () => {
  const panel = loadPanel();
  const layout = panel.normalizeLayout({
    width: 9999,
    height: 9999,
    left: 9999,
    top: 9999,
    fabLeft: -5,
    fabTop: 9999,
    collapsed: true,
  }, { width: 900, height: 600 });
  assert.equal(layout.width, 760);
  assert.equal(layout.height, 568);
  assert.equal(layout.left, 132);
  assert.equal(layout.top, 24);
  assert.equal(layout.fabLeft, 8);
  assert.equal(layout.fabTop, 560.8);
  assert.equal(layout.collapsed, true);
});

test('layout keeps the default height and clamps small requested heights', () => {
  const panel = loadPanel();
  assert.equal(panel.normalizeLayout({}, { width: 1440, height: 900 }).height, 720);
  assert.equal(panel.normalizeLayout({ height: 1 }, { width: 1440, height: 900 }).height, 320);
});

test('external panel source uses the shared AI port and session-only bridge token', () => {
  const source = fs.readFileSync(new URL('../aiPanel.js', import.meta.url), 'utf8');
  const core = fs.readFileSync(new URL('../aiUiCore.js', import.meta.url), 'utf8');
  assert.match(source, /GET_AI_SETTINGS/);
  assert.match(source, /AI_PANEL_PING/);
  assert.match(source, /OPEN_AI_PANEL/);
  assert.match(core, /name: 'tabwall-ai'/);
  assert.match(source, /type = 'password'/);
  assert.match(source, /bridgeToken = null/);
  assert.match(source, /aiBridgeTokenOptional/);
  assert.match(source, /autocomplete = 'new-password'/);
  assert.match(source, /bridgeRow\.hidden = true/);
  assert.doesNotMatch(source, /chrome\.storage\.local\.set\(\{[^}]*bridge/i);
  assert.match(source, /className = 'ai-messages'/);
  assert.match(source, /className = 'ai-sources'/);
  assert.match(source, /handleInputKeydown: false/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /event\.isComposing/);
  assert.match(source, /event\.repeat/);
  assert.match(source, /isDoubleEscapePress/);
  assert.match(source, /setExpanded\(false\)/);
  assert.match(source, /heightResizeHandle/);
  assert.match(source, /resize-height/);
  assert.match(source, /height: layout\.height/);
  assert.doesNotMatch(source, /t\('aiYou'\)/);
});
