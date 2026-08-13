/**
 * TabWall park undo/redo — session-local stack + connection history.
 * Undoable: stack (SW token) and canvas connections only.
 */
(function (global) {
  'use strict';

  const DEFAULT_LIMIT = 20;
  const INVALIDATING_TYPES = new Set([
    'DELETE_ITEM',
    'DELETE_TAB',
    'DELETE_NOTE',
    'RESTORE_TAB',
    'RESTORE_GROUP',
    'RESTORE_GROUP_MEMBER',
    'UPDATE_ITEM',
    'UPDATE_TAB',
    'UPDATE_NOTE',
    'UPDATE_GROUP_MEMBER',
    'CREATE_NOTE',
    'IMPORT_BACKUP',
    'APPLY_DEDUPE',
    'BATCH_UPDATE_ITEMS',
    'BATCH_DELETE_ITEMS',
    'CREATE_FROM_URL_TEXT',
    'SAVE_ACTIVE_TAB',
    'SAVE_ACTIVE_GROUP',
    'SAVE_TAB_FROM_CONTENT',
  ]);

  let env = null;
  let session = null;

  function cloneConnections(connections) {
    return (Array.isArray(connections) ? connections : []).map((connection) => ({
      sourceId: String(connection?.sourceId || ''),
      targetId: String(connection?.targetId || ''),
      ...(connection?.curveOffset ? { curveOffset: { ...connection.curveOffset } } : {}),
    }));
  }

  function connectionsEqual(left, right) {
    return JSON.stringify(cloneConnections(left)) === JSON.stringify(cloneConnections(right));
  }

  function cloneEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.kind === 'connections') {
      return {
        kind: 'connections',
        before: cloneConnections(entry.before),
        after: cloneConnections(entry.after),
      };
    }
    if (entry.kind === 'stack') {
      const token = String(entry.token || '');
      return token ? { kind: 'stack', token } : null;
    }
    return null;
  }

  function createHistory(options = {}) {
    const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
    const undo = [];
    const redo = [];
    let applying = false;

    function push(entry) {
      if (applying) return false;
      const next = cloneEntry(entry);
      if (!next) return false;
      undo.push(next);
      while (undo.length > limit) undo.shift();
      redo.length = 0;
      return true;
    }

    function popUndo() {
      if (!undo.length) return null;
      const entry = undo.pop();
      redo.push(entry);
      return cloneEntry(entry);
    }

    function popRedo() {
      if (!redo.length) return null;
      const entry = redo.pop();
      undo.push(entry);
      return cloneEntry(entry);
    }

    function unpopUndo() {
      if (!redo.length) return;
      undo.push(redo.pop());
    }

    function unpopRedo() {
      if (!undo.length) return;
      redo.push(undo.pop());
    }

    return {
      push,
      popUndo,
      popRedo,
      unpopUndo,
      unpopRedo,
      beginApply() { applying = true; },
      endApply() { applying = false; },
      isApplying() { return applying; },
      clear() {
        undo.length = 0;
        redo.length = 0;
      },
      canUndo() { return undo.length > 0; },
      canRedo() { return redo.length > 0; },
      snapshot() {
        return {
          undo: undo.map((entry) => cloneEntry(entry)),
          redo: redo.map((entry) => cloneEntry(entry)),
          applying,
        };
      },
    };
  }

  function ensureSession() {
    if (!session) session = createHistory();
    return session;
  }

  function bind(next) {
    if (next && typeof next === 'object') env = next;
    ensureSession();
  }

  function push(entry) {
    return ensureSession().push(entry);
  }

  function clear(options = {}) {
    const notify = options.notify !== false && !ensureSession().isApplying();
    ensureSession().clear();
    if (notify) env?.sendMessage?.({ type: 'CLEAR_STACK_UNDO' });
  }

  function noteMessageResult(type, response) {
    if (!response?.ok || ensureSession().isApplying()) return;
    if (INVALIDATING_TYPES.has(type)) clear();
  }

  function commitConnectionsTracked(next) {
    const store = env?.ensureCanvasStore?.() || env?.canvasStore;
    const current = env?.canvasStoreSnapshot?.()?.layout?.connections || [];
    const before = cloneConnections(current);
    const after = cloneConnections(next);
    if (!ensureSession().isApplying() && !connectionsEqual(before, after)) {
      ensureSession().push({ kind: 'connections', before, after });
    }
    if (store) store.commitConnections(after);
    return after;
  }

  async function applyEntry(entry, direction) {
    if (!entry) return false;
    if (entry.kind === 'connections') {
      const connections = direction === 'redo' ? entry.after : entry.before;
      const store = env?.ensureCanvasStore?.() || env?.canvasStore;
      if (store) store.commitConnections(cloneConnections(connections));
      env?.showCopyToast?.(env.t(direction === 'redo' ? 'redoConnection' : 'undoConnection'));
      return true;
    }
    if (entry.kind === 'stack') {
      const res = await env.sendMessage({
        type: direction === 'redo' ? 'REDO_STACK' : 'UNDO_STACK',
        token: entry.token,
      });
      if (!res?.ok) {
        env?.showCopyToast?.(env.t('undoFailed'));
        return false;
      }
      await env.loadList();
      env?.showCopyToast?.(env.t(direction === 'redo' ? 'redoStack' : 'undoStack'));
      return true;
    }
    return false;
  }

  async function applyUndo() {
    const hist = ensureSession();
    if (!hist.canUndo()) return false;
    const entry = hist.popUndo();
    hist.beginApply();
    try {
      const ok = await applyEntry(entry, 'undo');
      if (!ok) hist.unpopUndo();
      return ok;
    } finally {
      hist.endApply();
    }
  }

  async function applyRedo() {
    const hist = ensureSession();
    if (!hist.canRedo()) return false;
    const entry = hist.popRedo();
    hist.beginApply();
    try {
      const ok = await applyEntry(entry, 'redo');
      if (!ok) hist.unpopRedo();
      return ok;
    } finally {
      hist.endApply();
    }
  }

  function handleKeydown(event) {
    if (!event || env?.isTypingTarget?.(event.target)) return false;
    const undoKey = (event.code === 'KeyZ' || event.key === 'z' || event.key === 'Z')
      && (event.metaKey || event.ctrlKey)
      && !event.altKey;
    if (undoKey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) applyRedo();
      else applyUndo();
      return true;
    }
    const redoY = (event.code === 'KeyY' || event.key === 'y' || event.key === 'Y')
      && event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !event.shiftKey;
    if (redoY) {
      event.preventDefault();
      event.stopPropagation();
      applyRedo();
      return true;
    }
    return false;
  }

  global.TabWallHistory = {
    DEFAULT_LIMIT,
    INVALIDATING_TYPES,
    cloneConnections,
    connectionsEqual,
    createHistory,
    bind,
    push,
    clear,
    noteMessageResult,
    commitConnectionsTracked,
    applyUndo,
    applyRedo,
    handleKeydown,
    canUndo() { return ensureSession().canUndo(); },
    canRedo() { return ensureSession().canRedo(); },
    isApplying() { return ensureSession().isApplying(); },
    getSession: ensureSession,
  };
})(typeof self !== 'undefined' ? self : globalThis);
