import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadHistory() {
  const src = fs.readFileSync(new URL('../parkHistory.js', import.meta.url), 'utf8');
  const sandbox = {
    self: null,
    console,
    JSON,
    String,
    Number,
    Object,
    Array,
    Set,
    Math,
    Boolean,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'parkHistory.js' });
  return sandbox.TabWallHistory;
}

test('createHistory push/undo/redo connections and stack tokens', () => {
  const History = loadHistory();
  const hist = History.createHistory();
  assert.equal(hist.canUndo(), false);
  assert.equal(hist.push({ kind: 'connections', before: [], after: [{ sourceId: 'a', targetId: 'b' }] }), true);
  assert.equal(hist.push({ kind: 'stack', token: 'tok-1' }), true);
  assert.equal(hist.push({ kind: 'nope' }), false);
  assert.equal(hist.push({ kind: 'stack', token: '' }), false);
  assert.equal(hist.canUndo(), true);

  const stack = hist.popUndo();
  assert.equal(JSON.stringify(stack), JSON.stringify({ kind: 'stack', token: 'tok-1' }));
  assert.equal(hist.canRedo(), true);
  const conn = hist.popUndo();
  assert.equal(conn.kind, 'connections');
  assert.equal(JSON.stringify(conn.after), JSON.stringify([{ sourceId: 'a', targetId: 'b' }]));
  const redone = hist.popRedo();
  assert.equal(redone.kind, 'connections');
});

test('createHistory new push clears redo; applying blocks push; limit evicts oldest', () => {
  const History = loadHistory();
  const hist = History.createHistory({ limit: 2 });
  hist.push({ kind: 'stack', token: 'a' });
  hist.push({ kind: 'stack', token: 'b' });
  hist.popUndo();
  hist.push({ kind: 'stack', token: 'c' });
  assert.equal(hist.canRedo(), false);
  assert.equal(JSON.stringify(hist.popUndo()), JSON.stringify({ kind: 'stack', token: 'c' }));
  assert.equal(JSON.stringify(hist.popUndo()), JSON.stringify({ kind: 'stack', token: 'a' }));
  assert.equal(hist.popUndo(), null);

  const capped = History.createHistory({ limit: 2 });
  capped.push({ kind: 'stack', token: '1' });
  capped.push({ kind: 'stack', token: '2' });
  capped.push({ kind: 'stack', token: '3' });
  assert.equal(JSON.stringify(capped.popUndo()), JSON.stringify({ kind: 'stack', token: '3' }));
  assert.equal(JSON.stringify(capped.popUndo()), JSON.stringify({ kind: 'stack', token: '2' }));
  assert.equal(capped.popUndo(), null);

  const blocked = History.createHistory();
  blocked.beginApply();
  assert.equal(blocked.push({ kind: 'stack', token: 'x' }), false);
  blocked.endApply();
  assert.equal(blocked.push({ kind: 'stack', token: 'x' }), true);
  blocked.clear();
  assert.equal(blocked.canUndo(), false);
});

test('commitConnectionsTracked records once and skips while applying', async () => {
  const History = loadHistory();
  const commits = [];
  let connections = [];
  History.bind({
    canvasStoreSnapshot: () => ({ layout: { connections } }),
    ensureCanvasStore: () => ({
      commitConnections(next) {
        connections = next;
        commits.push(next);
      },
    }),
    t: (key) => key,
    showCopyToast() {},
    isTypingTarget: () => false,
    async sendMessage() { return { ok: true }; },
    async loadList() {},
  });
  History.commitConnectionsTracked([{ sourceId: 'a', targetId: 'b' }]);
  assert.equal(History.canUndo(), true);
  assert.equal(commits.length, 1);
  History.commitConnectionsTracked([{ sourceId: 'a', targetId: 'b' }]);
  assert.equal(commits.length, 2);
  assert.equal(History.getSession().snapshot().undo.length, 1);

  await History.applyUndo();
  assert.equal(JSON.stringify(commits.at(-1)), '[]');
  assert.equal(History.canRedo(), true);
  await History.applyRedo();
  assert.equal(JSON.stringify(commits.at(-1)), JSON.stringify([{ sourceId: 'a', targetId: 'b' }]));
});

test('handleKeydown ignores typing targets and maps undo/redo keys', () => {
  const History = loadHistory();
  let typing = true;
  History.bind({
    isTypingTarget: () => typing,
    t: (key) => key,
    showCopyToast() {},
    canvasStoreSnapshot: () => ({ layout: { connections: [] } }),
    ensureCanvasStore: () => ({ commitConnections() {} }),
  });
  History.commitConnectionsTracked([{ sourceId: 'a', targetId: 'b' }]);
  const prevented = [];
  const event = {
    code: 'KeyZ',
    key: 'z',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: {},
    preventDefault() { prevented.push('prevent'); },
    stopPropagation() { prevented.push('stop'); },
  };
  assert.equal(History.handleKeydown(event), false);
  assert.equal(prevented.length, 0);
  typing = false;
  assert.equal(History.handleKeydown(event), true);
  assert.deepEqual(prevented, ['prevent', 'stop']);
});

test('noteMessageResult clears history on item mutations only', () => {
  const History = loadHistory();
  History.bind({
    sendMessage() {},
    canvasStoreSnapshot: () => ({ layout: { connections: [] } }),
    ensureCanvasStore: () => ({ commitConnections() {} }),
  });
  History.push({ kind: 'stack', token: 'keep' });
  History.noteMessageResult('STACK_ITEMS', { ok: true });
  assert.equal(History.canUndo(), true);
  History.noteMessageResult('RESTORE_TAB', { ok: true, kept: true });
  assert.equal(History.canUndo(), true);
  History.noteMessageResult('DELETE_ITEM', { ok: true });
  assert.equal(History.canUndo(), false);
});
