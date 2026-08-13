/**
 * TabWall background — session-local stack undo / redo snapshots.
 * importScripts shared SW scope with background.js (after bgLayout / Media).
 */

const STACK_UNDO_LIMIT = 20;

/** @type {Map<string, object>} */
const stackUndoByToken = new Map();
/** @type {string[]} */
const stackUndoOrder = [];
/** @type {Map<string, object>} */
const stackRedoByToken = new Map();

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function collectStackUndoMediaKeys() {
  const keys = new Set();
  const absorb = (record) => {
    if (!record) return;
    for (const key of record.obsoleteMediaKeys || []) keys.add(key);
    for (const key of record.createdMediaKeys || []) keys.add(key);
  };
  for (const record of stackUndoByToken.values()) absorb(record);
  for (const record of stackRedoByToken.values()) absorb(record);
  return keys;
}

function forgetStackUndo(token, { evictMedia = false } = {}) {
  const key = String(token || '');
  const record = stackUndoByToken.get(key);
  stackUndoByToken.delete(key);
  stackRedoByToken.delete(key);
  const index = stackUndoOrder.indexOf(key);
  if (index >= 0) stackUndoOrder.splice(index, 1);
  if (evictMedia && record?.obsoleteMediaKeys?.length && typeof Media !== 'undefined') {
    Media.removeMany([...record.obsoleteMediaKeys]).catch(() => {});
  }
  return record || null;
}

function evictOldestStackUndo() {
  while (stackUndoOrder.length > STACK_UNDO_LIMIT) {
    forgetStackUndo(stackUndoOrder[0], { evictMedia: true });
  }
}

function recordStackUndo(snapshot) {
  const token = (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `stack-undo-${Date.now()}-${stackUndoOrder.length}`;
  const record = {
    token,
    beforeItems: cloneJson(snapshot.beforeItems) || [],
    beforeLayout: cloneJson(snapshot.beforeLayout) || {},
    removedIds: [...new Set((snapshot.removedIds || []).map(String))],
    newGroupId: String(snapshot.newGroupId || ''),
    obsoleteMediaKeys: [...new Set((snapshot.obsoleteMediaKeys || []).map(String))],
    createdMediaKeys: [...new Set((snapshot.createdMediaKeys || []).map(String))],
  };
  stackUndoByToken.set(token, record);
  stackUndoOrder.push(token);
  stackRedoByToken.delete(token);
  evictOldestStackUndo();
  return token;
}

function mergeLayoutForStackUndo(beforeLayout, currentLayout, removedIds, newGroupId) {
  const removed = new Set((removedIds || []).map(String));
  const groupId = String(newGroupId || '');
  const current = normalizeCanvasLayout(currentLayout);
  const before = normalizeCanvasLayout(beforeLayout);
  const next = {
    version: current.version,
    viewport: { ...current.viewport },
    positions: { ...current.positions },
    connections: [...(current.connections || [])],
  };
  if (groupId) delete next.positions[groupId];
  for (const id of removed) {
    if (before.positions[id]) next.positions[id] = { ...before.positions[id] };
  }
  const keepConnections = (next.connections || []).filter((connection) => (
    connection.sourceId !== groupId && connection.targetId !== groupId
  ));
  const restoreConnections = (before.connections || []).filter((connection) => (
    removed.has(connection.sourceId) || removed.has(connection.targetId)
  ));
  next.connections = normalizeCanvasConnections(
    [...keepConnections, ...restoreConnections],
    Object.keys(next.positions),
  );
  return next;
}

function mergeLayoutForStackRedo(afterLayout, currentLayout, removedIds, newGroupId) {
  const removed = new Set((removedIds || []).map(String));
  const groupId = String(newGroupId || '');
  const current = normalizeCanvasLayout(currentLayout);
  const after = normalizeCanvasLayout(afterLayout);
  const next = {
    version: current.version,
    viewport: { ...current.viewport },
    positions: { ...current.positions },
    connections: [...(current.connections || [])],
  };
  for (const id of removed) delete next.positions[id];
  if (groupId && after.positions[groupId]) {
    next.positions[groupId] = { ...after.positions[groupId] };
  }
  const keepConnections = (next.connections || []).filter((connection) => (
    !removed.has(connection.sourceId) && !removed.has(connection.targetId)
  ));
  const restoreConnections = (after.connections || []).filter((connection) => (
    connection.sourceId === groupId || connection.targetId === groupId
  ));
  next.connections = normalizeCanvasConnections(
    [...keepConnections, ...restoreConnections],
    Object.keys(next.positions),
  );
  return next;
}

async function undoStack(token) {
  const record = stackUndoByToken.get(String(token || ''));
  if (!record) return { ok: false, error: 'undo_missing' };
  const currentItems = await getParkedItems();
  const currentLayout = await getCanvasLayout();
  stackRedoByToken.set(record.token, {
    token: record.token,
    afterItems: cloneJson(currentItems) || [],
    afterLayout: cloneJson(currentLayout) || {},
    removedIds: record.removedIds,
    newGroupId: record.newGroupId,
    obsoleteMediaKeys: record.obsoleteMediaKeys,
    createdMediaKeys: record.createdMediaKeys,
  });
  const nextLayout = mergeLayoutForStackUndo(
    record.beforeLayout,
    currentLayout,
    record.removedIds,
    record.newGroupId,
  );
  const committed = await commitItemsAndCanvas(record.beforeItems, nextLayout);
  return {
    ok: true,
    items: committed.items,
    layout: committed.layout,
    groupId: record.newGroupId,
  };
}

async function redoStack(token) {
  const record = stackRedoByToken.get(String(token || ''));
  if (!record) return { ok: false, error: 'redo_missing' };
  const currentLayout = await getCanvasLayout();
  const nextLayout = mergeLayoutForStackRedo(
    record.afterLayout,
    currentLayout,
    record.removedIds,
    record.newGroupId,
  );
  const committed = await commitItemsAndCanvas(record.afterItems, nextLayout);
  return {
    ok: true,
    items: committed.items,
    layout: committed.layout,
    groupId: record.newGroupId,
  };
}

function clearStackUndo() {
  const tokens = [...stackUndoOrder];
  for (const token of tokens) forgetStackUndo(token, { evictMedia: true });
  stackRedoByToken.clear();
  return { ok: true };
}
