/*
 * TabWall — Spatial Canvas state and persistence controller
 * Pure state transitions live here so DOM rendering and browser events cannot
 * silently become a second source of truth.
 */
(function (global) {
  'use strict';

  const LAYOUT_VERSION = 1;
  const DEFAULT_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1 });
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2;
  const GRID_SIZE = 24;
  const DEFAULT_CARD_WIDTH = 220;
  const DEFAULT_CARD_HEIGHT = 170;
  const DEFAULT_CARD_DISPLAY_SCALE = 1.1;
  const DEFAULT_CARD_GAP = 96;
  const MAX_CURVE_OFFSET = 2000;
  const DEFAULT_RETRY_DELAYS = Object.freeze([250, 1000, 3000, 10000, 30000]);

  function finite(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function defaultPosition(index = 0) {
    const i = Math.max(0, Number(index) || 0);
    const stepX = Math.round(DEFAULT_CARD_WIDTH * DEFAULT_CARD_DISPLAY_SCALE) + DEFAULT_CARD_GAP;
    const stepY = Math.round(DEFAULT_CARD_HEIGHT * DEFAULT_CARD_DISPLAY_SCALE) + DEFAULT_CARD_GAP;
    return {
      x: 96 + (i % 4) * stepX,
      y: 96 + Math.floor(i / 4) * stepY,
      w: DEFAULT_CARD_WIDTH,
      h: DEFAULT_CARD_HEIGHT,
      z: i,
    };
  }

  function clonePosition(position, fallback = defaultPosition()) {
    const value = position && typeof position === 'object' ? position : {};
    return {
      x: finite(value.x, -100000, 100000, fallback.x),
      y: finite(value.y, -100000, 100000, fallback.y),
      w: finite(value.w, 160, 640, fallback.w),
      h: finite(value.h, 120, 560, fallback.h),
      z: finite(value.z, 0, 1000000, fallback.z),
    };
  }

  function normalizeCurveOffset(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const x = finite(raw.x, -MAX_CURVE_OFFSET, MAX_CURVE_OFFSET, 0);
    const y = finite(raw.y, -MAX_CURVE_OFFSET, MAX_CURVE_OFFSET, 0);
    return x || y ? { x, y } : null;
  }

  function normalizeConnections(rawConnections, validIds = []) {
    const ids = new Set((Array.isArray(validIds) ? validIds : [...(validIds || [])])
      .map((id) => String(id || ''))
      .filter(Boolean));
    const seen = new Set();
    const connections = [];
    for (const entry of Array.isArray(rawConnections) ? rawConnections : []) {
      const sourceId = String(entry?.sourceId || '');
      const targetId = String(entry?.targetId || '');
      if (!sourceId || !targetId || sourceId === targetId) continue;
      if (ids.size && (!ids.has(sourceId) || !ids.has(targetId))) continue;
      const [source, target] = sourceId < targetId
        ? [sourceId, targetId]
        : [targetId, sourceId];
      const key = `${source}\u0000${target}`;
      const curveOffset = normalizeCurveOffset(entry?.curveOffset);
      if (seen.has(key)) {
        if (curveOffset) {
          const existing = connections.find((connection) => (
            connection.sourceId === source && connection.targetId === target
          ));
          if (existing && !existing.curveOffset) existing.curveOffset = curveOffset;
        }
        continue;
      }
      seen.add(key);
      connections.push({
        sourceId: source,
        targetId: target,
        ...(curveOffset ? { curveOffset } : {}),
      });
    }
    connections.sort((left, right) => {
      const sourceOrder = left.sourceId.localeCompare(right.sourceId);
      return sourceOrder || left.targetId.localeCompare(right.targetId);
    });
    return connections;
  }

  function normalizeLayout(raw, items = []) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const itemList = Array.isArray(items) ? items : [];
    const ids = itemList.map((item) => String(item?.id || item)).filter(Boolean);
    const source = value.positions && typeof value.positions === 'object' ? value.positions : {};
    const positions = {};
    const orderedIds = ids.length ? ids : Object.keys(source);
    orderedIds.forEach((id, index) => {
      positions[id] = clonePosition(source[id], defaultPosition(index));
    });
    const connectionIds = orderedIds.length ? orderedIds : Object.keys(positions);
    return {
      version: LAYOUT_VERSION,
      viewport: {
        x: finite(value.viewport?.x, -100000, 100000, DEFAULT_VIEWPORT.x),
        y: finite(value.viewport?.y, -100000, 100000, DEFAULT_VIEWPORT.y),
        zoom: finite(value.viewport?.zoom, MIN_ZOOM, MAX_ZOOM, DEFAULT_VIEWPORT.zoom),
      },
      positions,
      connections: normalizeConnections(value.connections, connectionIds),
    };
  }

  function cloneLayout(layout, items = []) {
    return normalizeLayout(layout, items);
  }

  // Cheap structural copy for layouts that are already known to be normalized
  // (i.e. produced by normalizeLayout/applyOperation). Skips the dedupe/sort/
  // validate work normalizeLayout does, since re-running it on trusted,
  // already-normalized input is pure waste on hot paths like pointer preview.
  function cloneNormalizedLayout(layout) {
    const positions = {};
    for (const id in layout.positions) positions[id] = { ...layout.positions[id] };
    return {
      version: layout.version,
      viewport: { ...layout.viewport },
      positions,
      connections: layout.connections.map((connection) => (
        connection.curveOffset
          ? { ...connection, curveOffset: { ...connection.curveOffset } }
          : { ...connection }
      )),
    };
  }

  function cloneOperation(operation) {
    if (!operation || typeof operation !== 'object') return null;
    const copy = { ...operation };
    if (Array.isArray(operation.ids)) copy.ids = [...operation.ids];
    if (operation.anchorWorld) copy.anchorWorld = { ...operation.anchorWorld };
    if (operation.anchorOffset) copy.anchorOffset = { ...operation.anchorOffset };
    if (operation.positions) {
      copy.positions = Object.fromEntries(
        Object.entries(operation.positions).map(([id, position]) => [id, { ...position }])
      );
    }
    if (Array.isArray(operation.connections)) {
      copy.connections = operation.connections.map((connection) => ({
        ...connection,
        ...(connection?.curveOffset ? { curveOffset: { ...connection.curveOffset } } : {}),
      }));
    }
    return copy;
  }

  function snap(value, grid = GRID_SIZE) {
    return Math.round(Number(value || 0) / grid) * grid;
  }

  function applyOperation(rawLayout, operation, items = []) {
    // rawLayout is always already-normalized here (baseLayout/interaction
    // startLayout), so a cheap structural copy is enough — see
    // cloneNormalizedLayout for the invariant this relies on.
    const next = cloneNormalizedLayout(rawLayout);
    const op = operation && typeof operation === 'object' ? operation : {};
    if (op.type === 'pan') {
      next.viewport.x += Number(op.dx) || 0;
      next.viewport.y += Number(op.dy) || 0;
      return next;
    }
    if (op.type === 'zoom') {
      const zoom = finite(op.zoom, MIN_ZOOM, MAX_ZOOM, next.viewport.zoom);
      if (op.anchorWorld && op.anchorOffset) {
        next.viewport.x = Number(op.anchorWorld.x) - Number(op.anchorOffset.x) / zoom;
        next.viewport.y = Number(op.anchorWorld.y) - Number(op.anchorOffset.y) / zoom;
      }
      next.viewport.zoom = zoom;
      return next;
    }
    if (op.type === 'setViewport') {
      next.viewport = {
        x: finite(op.x, -100000, 100000, next.viewport.x),
        y: finite(op.y, -100000, 100000, next.viewport.y),
        zoom: finite(op.zoom, MIN_ZOOM, MAX_ZOOM, next.viewport.zoom),
      };
      return next;
    }
    if (op.type === 'move') {
      const dx = Number(op.dx) || 0;
      const dy = Number(op.dy) || 0;
      for (const id of op.ids || []) {
        const position = next.positions[id] || defaultPosition(0);
        position.x += dx;
        position.y += dy;
        if (op.snap) {
          position.x = snap(position.x, op.grid || GRID_SIZE);
          position.y = snap(position.y, op.grid || GRID_SIZE);
        }
        next.positions[id] = position;
      }
      return next;
    }
    if (op.type === 'setPositions') {
      for (const [id, position] of Object.entries(op.positions || {})) {
        next.positions[id] = clonePosition(position, next.positions[id] || defaultPosition(0));
      }
      return next;
    }
    if (op.type === 'setConnections') {
      next.connections = normalizeConnections(op.connections, Object.keys(next.positions));
      return next;
    }
    return next;
  }

  function replayOperations(baseLayout, operations, items = []) {
    return (operations || []).reduce(
      (layout, operation) => applyOperation(layout, operation, items),
      cloneLayout(baseLayout, items)
    );
  }

  function layoutsEqual(left, right, items = []) {
    return JSON.stringify(normalizeLayout(left, items)) === JSON.stringify(normalizeLayout(right, items));
  }

  function createCanvasStore(options = {}) {
    const listeners = new Set();
    const sendPatch = typeof options.sendPatch === 'function' ? options.sendPatch : null;
    const onChange = typeof options.onChange === 'function' ? options.onChange : null;
    const retryDelays = Array.isArray(options.retryDelays) && options.retryDelays.length
      ? options.retryDelays.map((delay) => Math.max(0, Number(delay) || 0))
      : [...DEFAULT_RETRY_DELAYS];
    let persistTimer = null;
    let retryTimer = null;
    let inFlight = null;
    let retryIndex = 0;
    let operationSequence = 0;

    const initialItems = Array.isArray(options.items) ? options.items : [];
    const initialLayout = normalizeLayout(options.layout, initialItems);
    const state = {
      items: [...initialItems],
      baseLayout: initialLayout,
      layout: cloneLayout(initialLayout, initialItems),
      viewport: { ...initialLayout.viewport },
      revision: Math.max(0, Math.floor(Number(options.revision) || 0)),
      selectedIds: new Set(),
      interaction: null,
      pendingOperations: [],
      queuedRemote: null,
      sync: { status: 'idle', attempt: 0, error: '' },
    };

    function emit(action) {
      const snapshot = getState();
      onChange?.(snapshot, action);
      for (const listener of listeners) listener(snapshot, action);
    }

    function getState() {
      return {
        items: [...state.items],
        baseLayout: cloneNormalizedLayout(state.baseLayout),
        layout: cloneNormalizedLayout(state.layout),
        viewport: { ...state.viewport },
        revision: state.revision,
        selectedIds: new Set(state.selectedIds),
        interaction: state.interaction ? { ...state.interaction } : null,
        pendingOperations: state.pendingOperations.map(cloneOperation),
        queuedRemote: state.queuedRemote
          ? { layout: cloneLayout(state.queuedRemote.layout, state.items), revision: state.queuedRemote.revision }
          : null,
        sync: { ...state.sync },
      };
    }

    function clearPersistTimers() {
      if (persistTimer) clearTimeout(persistTimer);
      if (retryTimer) clearTimeout(retryTimer);
      persistTimer = null;
      retryTimer = null;
    }

    function recomputeLayout() {
      state.layout = replayOperations(state.baseLayout, state.pendingOperations, state.items);
      state.viewport = { ...state.layout.viewport };
    }

    function setSync(status, error = '', attempt = state.sync.attempt) {
      state.sync = { status, error: String(error || ''), attempt };
    }

    function schedulePersist(delay = 220) {
      if (!sendPatch || !state.pendingOperations.length) return;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        flushPersist().catch(() => {});
      }, Math.max(0, delay));
    }

    function scheduleRetry() {
      if (!sendPatch || !state.pendingOperations.length) return;
      if (retryIndex >= retryDelays.length) {
        setSync('error', state.sync.error || 'canvas_persist_failed', retryIndex);
        emit({ type: 'SYNC_FAILED' });
        return;
      }
      const attempt = retryIndex + 1;
      const delay = retryDelays[retryIndex++];
      setSync('retrying', state.sync.error, attempt);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        flushPersist().catch(() => {});
      }, delay);
      emit({ type: 'SYNC_RETRY', delay, attempt });
    }

    async function flushPersist() {
      if (!sendPatch || inFlight || !state.pendingOperations.length) return;
      const sentOperations = state.pendingOperations.map(cloneOperation);
      const baseRevision = state.revision;
      const layout = cloneLayout(state.layout, state.items);
      inFlight = { baseRevision, count: sentOperations.length };
      setSync('saving', '', retryIndex);
      emit({ type: 'SYNC_START', baseRevision, count: sentOperations.length });
      let response;
      try {
        response = await sendPatch({ layout, baseRevision });
      } catch (error) {
        response = { ok: false, error: String(error?.message || error) };
      }
      const request = inFlight;
      inFlight = null;

      // A remote revision arrived while this request was in flight. Do not
      // acknowledge the old response; replay all local operations on top.
      if (request.baseRevision !== state.revision) {
        if (state.pendingOperations.length) schedulePersist(0);
        return;
      }

      if (response?.ok) {
        state.baseLayout = normalizeLayout(response.layout, state.items);
        state.revision = Math.max(state.revision, Math.floor(Number(response.revision) || state.revision + 1));
        state.pendingOperations.splice(0, request.count);
        recomputeLayout();
        retryIndex = 0;
        setSync(state.pendingOperations.length ? 'dirty' : 'idle');
        emit({ type: 'SYNC_ACK', revision: state.revision, count: request.count });
        if (state.pendingOperations.length) schedulePersist(0);
        return;
      }

      if (response?.error === 'canvas_conflict' && response.layout) {
        applyRemote(response.layout, response.revision);
        retryIndex = 0;
        schedulePersist(0);
        return;
      }

      setSync('error', response?.error || 'canvas_persist_failed', retryIndex);
      emit({ type: 'SYNC_ERROR', error: state.sync.error });
      scheduleRetry();
    }

    function setItems(items) {
      state.items = Array.isArray(items) ? [...items] : [];
      const validIds = new Set(state.items.map((item) => String(item?.id || '')));
      state.selectedIds = new Set([...state.selectedIds].filter((id) => validIds.has(id)));
      state.pendingOperations = state.pendingOperations
        .map((operation) => {
          const next = cloneOperation(operation);
          if (next.type === 'move') next.ids = (next.ids || []).filter((id) => validIds.has(String(id)));
          if (next.type === 'setPositions') {
            next.positions = Object.fromEntries(
              Object.entries(next.positions || {}).filter(([id]) => validIds.has(String(id)))
            );
          }
          if (next.type === 'setConnections') {
            next.connections = normalizeConnections(next.connections, validIds);
          }
          return next;
        })
        .filter((operation) => operation.type !== 'move' || operation.ids.length)
        .filter((operation) => operation.type !== 'setPositions' || Object.keys(operation.positions).length);
      state.baseLayout = normalizeLayout(state.baseLayout, state.items);
      recomputeLayout();
      emit({ type: 'ITEMS_SET' });
    }

    function hydrate(items, layout, revision = 0) {
      clearPersistTimers();
      state.items = Array.isArray(items) ? [...items] : [];
      state.baseLayout = normalizeLayout(layout, state.items);
      state.layout = cloneLayout(state.baseLayout, state.items);
      state.viewport = { ...state.layout.viewport };
      state.revision = Math.max(0, Math.floor(Number(revision) || 0));
      state.pendingOperations = [];
      state.interaction = null;
      state.queuedRemote = null;
      const validIds = new Set(state.items.map((item) => String(item?.id || '')));
      state.selectedIds = new Set([...state.selectedIds].filter((id) => validIds.has(id)));
      retryIndex = 0;
      setSync('idle');
      emit({ type: 'HYDRATE', revision: state.revision });
    }

    function applyRemote(layout, revision = state.revision) {
      const nextRevision = Math.max(0, Math.floor(Number(revision) || 0));
      if (nextRevision < state.revision) return false;
      if (nextRevision === state.revision && !layoutsEqual(layout, state.baseLayout, state.items)) return false;
      if (state.interaction) {
        if (!state.queuedRemote || nextRevision >= state.queuedRemote.revision) {
          state.queuedRemote = { layout: cloneLayout(layout, state.items), revision: nextRevision };
        }
        emit({ type: 'REMOTE_QUEUED', revision: nextRevision });
        return true;
      }
      return applyRemoteNow(layout, nextRevision);
    }

    function applyRemoteNow(layout, revision = state.revision) {
      const nextRevision = Math.max(0, Math.floor(Number(revision) || 0));
      if (nextRevision < state.revision) return false;
      if (nextRevision === state.revision && !layoutsEqual(layout, state.baseLayout, state.items)) return false;
      // chrome.storage.onChanged can echo our own CAS write before the
      // sendMessage response resolves. Treat an identical layout as an ack
      // candidate so the in-flight response cannot replay the same operation.
      if (state.pendingOperations.length && nextRevision > state.revision && layoutsEqual(layout, state.layout, state.items)) {
        state.baseLayout = normalizeLayout(layout, state.items);
        state.revision = nextRevision;
        state.pendingOperations = [];
        setSync('idle');
        emit({ type: 'REMOTE_ACK', revision: nextRevision });
        return true;
      }
      state.baseLayout = normalizeLayout(layout, state.items);
      state.revision = nextRevision;
      recomputeLayout();
      if (state.pendingOperations.length) setSync('dirty');
      else setSync('idle');
      emit({ type: 'REMOTE_LAYOUT', revision: nextRevision });
      if (state.pendingOperations.length && !inFlight) schedulePersist(0);
      return true;
    }

    function drainQueuedRemote() {
      if (state.interaction || !state.queuedRemote) return;
      const remote = state.queuedRemote;
      state.queuedRemote = null;
      applyRemoteNow(remote.layout, remote.revision);
    }

    function setSelection(ids, additive = false) {
      const next = additive ? new Set(state.selectedIds) : new Set();
      const validIds = new Set(state.items.map((item) => String(item?.id || '')));
      for (const id of ids || []) {
        const key = String(id);
        if (validIds.has(key)) next.add(key);
      }
      state.selectedIds = next;
      emit({ type: 'SELECTION_SET' });
    }

    function toggleSelection(id, additive = true) {
      const next = additive ? new Set(state.selectedIds) : new Set();
      const key = String(id || '');
      if (!key || !state.items.some((item) => String(item?.id || '') === key)) return;
      if (additive && next.has(key)) next.delete(key);
      else next.add(key);
      state.selectedIds = next;
      emit({ type: 'SELECTION_TOGGLE', id: key });
    }

    function commitOperation(operation) {
      const op = cloneOperation(operation);
      if (!op?.type) return null;
      op.id = op.id || `canvas-op-${++operationSequence}`;
      state.pendingOperations.push(op);
      recomputeLayout();
      setSync('dirty', '', state.sync.attempt);
      emit({ type: 'OPERATION_COMMIT', operation: op });
      schedulePersist();
      return op;
    }

    function beginPointer(kind, details = {}) {
      state.interaction = {
        kind,
        pointerId: details.pointerId,
        startX: Number(details.startX) || 0,
        startY: Number(details.startY) || 0,
        startLayout: cloneLayout(state.layout, state.items),
        startPositions: Object.fromEntries(
          (details.ids || []).map((id) => [String(id), { ...(state.layout.positions[String(id)] || defaultPosition()) }])
        ),
        moved: false,
      };
      emit({ type: 'POINTER_BEGIN', kind });
    }

    function previewPointer(details = {}) {
      const interaction = state.interaction;
      if (!interaction) return false;
      if (details.moved) interaction.moved = true;
      const dx = Number(details.dx) || 0;
      const dy = Number(details.dy) || 0;
      if (interaction.kind === 'pan') {
        state.layout = applyOperation(interaction.startLayout, { type: 'pan', dx, dy }, state.items);
      } else if (interaction.kind === 'node') {
        state.layout = applyOperation(interaction.startLayout, {
          type: 'move',
          ids: Object.keys(interaction.startPositions),
          dx,
          dy,
        }, state.items);
      }
      state.viewport = { ...state.layout.viewport };
      emit({ type: 'POINTER_PREVIEW', kind: interaction.kind, dx, dy });
      return true;
    }

    function finishPointer({ commit = true, snap = false } = {}) {
      const interaction = state.interaction;
      if (!interaction) return null;
      state.interaction = null;
      if (!commit || !interaction.moved) {
        recomputeLayout();
        emit({ type: 'POINTER_CANCEL', kind: interaction.kind });
        drainQueuedRemote();
        return null;
      }
      let operation = null;
      if (interaction.kind === 'pan') {
        operation = {
          type: 'pan',
          dx: state.layout.viewport.x - interaction.startLayout.viewport.x,
          dy: state.layout.viewport.y - interaction.startLayout.viewport.y,
        };
      } else if (interaction.kind === 'node') {
        const ids = Object.keys(interaction.startPositions);
        const first = ids[0];
        operation = {
          type: 'move',
          ids,
          dx: first ? state.layout.positions[first].x - interaction.startPositions[first].x : 0,
          dy: first ? state.layout.positions[first].y - interaction.startPositions[first].y : 0,
          snap: Boolean(snap),
          grid: GRID_SIZE,
        };
      }
      recomputeLayout();
      if (operation) commitOperation(operation);
      emit({ type: 'POINTER_END', kind: interaction.kind, operation });
      drainQueuedRemote();
      return operation;
    }

    function cancelPointer() {
      if (!state.interaction) return false;
      const kind = state.interaction.kind;
      state.interaction = null;
      recomputeLayout();
      emit({ type: 'POINTER_CANCEL', kind });
      drainQueuedRemote();
      return true;
    }

    function commitPan(dx, dy) {
      const last = state.pendingOperations[state.pendingOperations.length - 1];
      if (!inFlight && !state.interaction && last?.type === 'pan') {
        last.dx = (Number(last.dx) || 0) + (Number(dx) || 0);
        last.dy = (Number(last.dy) || 0) + (Number(dy) || 0);
        recomputeLayout();
        setSync('dirty', '', state.sync.attempt);
        emit({ type: 'OPERATION_COMMIT', operation: cloneOperation(last), coalesced: true });
        schedulePersist();
        return last;
      }
      return commitOperation({ type: 'pan', dx, dy });
    }

    function commitMove(ids, dx, dy, shouldSnap = false) {
      return commitOperation({ type: 'move', ids: [...ids], dx, dy, snap: Boolean(shouldSnap), grid: GRID_SIZE });
    }

    function commitZoom(zoom, anchor = null) {
      const oldZoom = state.layout.viewport.zoom;
      const nextZoom = finite(zoom, MIN_ZOOM, MAX_ZOOM, oldZoom);
      const last = state.pendingOperations[state.pendingOperations.length - 1];
      if (!inFlight && !state.interaction && last?.type === 'zoom') {
        last.zoom = nextZoom;
        if (anchor?.world && anchor?.offset) {
          last.anchorWorld = { ...anchor.world };
          last.anchorOffset = { ...anchor.offset };
        } else {
          delete last.anchorWorld;
          delete last.anchorOffset;
        }
        recomputeLayout();
        setSync('dirty', '', state.sync.attempt);
        emit({ type: 'OPERATION_COMMIT', operation: cloneOperation(last), coalesced: true });
        schedulePersist();
        return last;
      }
      const operation = { type: 'zoom', zoom: nextZoom };
      if (anchor?.world && anchor?.offset) {
        operation.anchorWorld = { ...anchor.world };
        operation.anchorOffset = { ...anchor.offset };
      }
      return commitOperation(operation);
    }

    function commitPositions(positions) {
      return commitOperation({ type: 'setPositions', positions });
    }

    function commitConnections(connections) {
      return commitOperation({ type: 'setConnections', connections });
    }

    function commitViewport(viewport) {
      const current = state.layout.viewport;
      const next = viewport && typeof viewport === 'object' ? viewport : {};
      return commitOperation({
        type: 'setViewport',
        x: finite(next.x, -100000, 100000, current.x),
        y: finite(next.y, -100000, 100000, current.y),
        zoom: finite(next.zoom, MIN_ZOOM, MAX_ZOOM, current.zoom),
      });
    }

    function markSync(status, error = '') {
      setSync(status, error, state.sync.attempt);
      emit({ type: 'SYNC_STATUS', status, error });
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function destroy() {
      clearPersistTimers();
      listeners.clear();
    }

    return {
      getState,
      subscribe,
      setItems,
      hydrate,
      applyRemote,
      setSelection,
      toggleSelection,
      beginPointer,
      previewPointer,
      finishPointer,
      cancelPointer,
      commitPan,
      commitMove,
      commitZoom,
      commitPositions,
      commitConnections,
      commitViewport,
      markSync,
      flush: () => flushPersist(),
      destroy,
    };
  }

  global.TabWallCanvasStore = {
    DEFAULT_VIEWPORT,
    DEFAULT_RETRY_DELAYS,
    MAX_CURVE_OFFSET,
    normalizeLayout,
    normalizeConnections,
    normalizeCurveOffset,
    applyOperation,
    replayOperations,
    createCanvasStore,
  };
})(typeof self !== 'undefined' ? self : globalThis);
