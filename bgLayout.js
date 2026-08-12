/**
 * TabWall background — canvas layout normalize / persistence.
 * importScripts shared SW scope with background.js.
 */

// ── original background.js L313-705 ──
const LEGACY_DEFAULT_CANVAS_ZOOM = 0.76;
const DEFAULT_CANVAS_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1 });
const DEFAULT_CANVAS_CARD_GAP = 96;
const DEFAULT_CANVAS_CARD_STEP_X = 338;
const DEFAULT_CANVAS_CARD_STEP_Y = 283;
const DEFAULT_CANVAS_DISPLAY_SCALE = 1.1;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function defaultCanvasPosition(index, origin = null) {
  const i = Math.max(0, Number(index) || 0);
  const originX = Number.isFinite(Number(origin?.x)) ? Number(origin.x) : DEFAULT_CANVAS_CARD_GAP;
  const originY = Number.isFinite(Number(origin?.y)) ? Number(origin.y) : DEFAULT_CANVAS_CARD_GAP;
  return {
    x: originX + (i % 4) * DEFAULT_CANVAS_CARD_STEP_X,
    y: originY + Math.floor(i / 4) * DEFAULT_CANVAS_CARD_STEP_Y,
    w: 220,
    h: 170,
    z: i,
  };
}

function normalizeCanvasPosition(raw, fallback) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const base = fallback || defaultCanvasPosition(0);
  return {
    x: clampNumber(value.x, -100000, 100000, base.x),
    y: clampNumber(value.y, -100000, 100000, base.y),
    w: clampNumber(value.w, 160, 640, base.w),
    h: clampNumber(value.h, 120, 560, base.h),
    z: clampNumber(value.z, 0, 1000000, base.z),
  };
}

function hasExplicitCanvasCoordinates(raw) {
  return Boolean(
    raw
      && typeof raw === 'object'
      && !Array.isArray(raw)
      && Number.isFinite(Number(raw.x))
      && Number.isFinite(Number(raw.y))
  );
}

function canvasPositionRect(position) {
  if (!position || typeof position !== 'object') return null;
  return {
    x: Number(position.x) || 0,
    y: Number(position.y) || 0,
    w: Math.max(1, Number(position.w) || 220) * DEFAULT_CANVAS_DISPLAY_SCALE,
    h: Math.max(1, Number(position.h) || 170) * DEFAULT_CANVAS_DISPLAY_SCALE,
  };
}

function canvasPositionsOverlap(left, right) {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

function canvasPositionBounds(positions) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  let count = 0;
  for (const position of Object.values(positions || {})) {
    const rect = canvasPositionRect(position);
    if (!rect) continue;
    bounds.minX = Math.min(bounds.minX, rect.x);
    bounds.minY = Math.min(bounds.minY, rect.y);
    bounds.maxX = Math.max(bounds.maxX, rect.x + rect.w);
    bounds.maxY = Math.max(bounds.maxY, rect.y + rect.h);
    count += 1;
  }
  return count ? bounds : null;
}

function nextAvailableCanvasPosition(positions) {
  const occupied = Object.values(positions || {})
    .map(canvasPositionRect)
    .filter(Boolean);
  const bounds = canvasPositionBounds(positions);
  const origin = bounds ? { x: bounds.minX, y: bounds.minY } : null;
  const maxZ = Object.values(positions || {}).reduce((max, position) => {
    if (!position || typeof position !== 'object') return max;
    return Math.max(max, Number(position.z) || 0);
  }, -1);
  let index = 0;
  while (true) {
    const candidate = defaultCanvasPosition(index++, origin);
    const rect = canvasPositionRect(candidate);
    if (!occupied.some((existing) => canvasPositionsOverlap(rect, existing))) {
      return { ...candidate, z: maxZ + 1 };
    }
  }
}

function normalizeCanvasConnections(rawConnections, validIds = []) {
  const maxCurveOffset = 2000;
  const normalizeCurveOffset = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const x = clampNumber(raw.x, -maxCurveOffset, maxCurveOffset, 0);
    const y = clampNumber(raw.y, -maxCurveOffset, maxCurveOffset, 0);
    return x || y ? { x, y } : null;
  };
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

function normalizeCanvasLayout(raw, itemIds = []) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const ids = new Set((Array.isArray(itemIds) ? itemIds : []).map(String));
  const positions = {};
  const source = value.positions && typeof value.positions === 'object' ? value.positions : {};
  let index = 0;
  if (ids.size) {
    const missing = [];
    for (const id of ids) {
      const fallback = defaultCanvasPosition(index++);
      if (hasExplicitCanvasCoordinates(source[id])) {
        positions[id] = normalizeCanvasPosition(source[id], fallback);
      } else {
        positions[id] = null;
        missing.push({ id, index: index - 1 });
      }
    }
    for (const { id } of missing) {
      positions[id] = nextAvailableCanvasPosition(positions);
    }
  } else {
    for (const [id, position] of Object.entries(source)) {
      positions[String(id)] = normalizeCanvasPosition(position, defaultCanvasPosition(index++));
    }
  }
  const connectionIds = ids.size ? [...ids] : Object.keys(positions);
  return {
    version: CANVAS_LAYOUT_VERSION,
    viewport: {
      x: clampNumber(value.viewport?.x, -100000, 100000, DEFAULT_CANVAS_VIEWPORT.x),
      y: clampNumber(value.viewport?.y, -100000, 100000, DEFAULT_CANVAS_VIEWPORT.y),
      zoom: clampNumber(value.viewport?.zoom, 0.25, 2, DEFAULT_CANVAS_VIEWPORT.zoom),
    },
    positions,
    connections: normalizeCanvasConnections(value.connections, connectionIds),
  };
}

function normalizeCanvasRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
}

function canvasLayoutsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isDefaultCanvasLayout(layout, itemIds = []) {
  const ids = Array.isArray(itemIds) ? itemIds.map(String) : [];
  const normalized = normalizeCanvasLayout(layout, ids);
  const viewport = normalized.viewport;
  if (viewport.x !== DEFAULT_CANVAS_VIEWPORT.x || viewport.y !== DEFAULT_CANVAS_VIEWPORT.y || viewport.zoom !== DEFAULT_CANVAS_VIEWPORT.zoom) {
    return false;
  }
  if (!ids.length) return Object.keys(normalized.positions).length === 0;
  return ids.every((id, index) => canvasLayoutsEqual(normalized.positions[id], defaultCanvasPosition(index)));
}

async function getCanvasLayoutRecord() {
  const [data, rawItems] = await Promise.all([
    chrome.storage.local.get([
      CANVAS_LAYOUT_KEY,
      CANVAS_LAYOUT_REVISION_KEY,
      CANVAS_ZOOM_DEFAULT_MIGRATION_KEY,
      CANVAS_INITIAL_CENTER_MIGRATION_KEY,
    ]),
    getParkedItemsRaw(),
  ]);
  const itemIds = rawItems.map((item) => item.id);
  const raw = data[CANVAS_LAYOUT_KEY];
  let layout = normalizeCanvasLayout(raw, itemIds);
  const revision = normalizeCanvasRevision(data[CANVAS_LAYOUT_REVISION_KEY]);
  const needsMarker = data[CANVAS_ZOOM_DEFAULT_MIGRATION_KEY] !== true;
  const needsRevision = data[CANVAS_LAYOUT_REVISION_KEY] == null;
  if (needsMarker || needsRevision) {
    const legacyZoom = Number(raw?.viewport?.zoom);
    if (needsMarker && Number.isFinite(legacyZoom) && Math.abs(legacyZoom - LEGACY_DEFAULT_CANVAS_ZOOM) < 0.001) {
      layout = normalizeCanvasLayout({
        ...raw,
        viewport: { ...(raw?.viewport || {}), zoom: DEFAULT_CANVAS_VIEWPORT.zoom },
      }, itemIds);
    }
    await chrome.storage.local.set({
      [CANVAS_LAYOUT_KEY]: layout,
      [CANVAS_ZOOM_DEFAULT_MIGRATION_KEY]: true,
      [CANVAS_LAYOUT_REVISION_KEY]: revision,
    });
  }
  const needsInitialCenter = data[CANVAS_INITIAL_CENTER_MIGRATION_KEY] !== true && isDefaultCanvasLayout(layout, itemIds);
  return { layout, revision, needsInitialCenter };
}

async function getCanvasLayout() {
  return (await getCanvasLayoutRecord()).layout;
}

async function setCanvasLayout(layout, itemIds = null) {
  let ids = itemIds;
  if (!Array.isArray(ids)) {
    const items = await getParkedItems();
    ids = items.map((item) => item.id);
  }
  const current = await getCanvasLayoutRecord();
  const normalized = normalizeCanvasLayout(layout, ids);
  await chrome.storage.local.set({
    [CANVAS_LAYOUT_KEY]: normalized,
    [CANVAS_LAYOUT_REVISION_KEY]: current.revision + 1,
    [CANVAS_ZOOM_DEFAULT_MIGRATION_KEY]: true,
    [CANVAS_INITIAL_CENTER_MIGRATION_KEY]: true,
  });
  return normalized;
}

async function syncCanvasLayoutItems(items) {
  const ids = (Array.isArray(items) ? items : []).map((item) => item.id);
  const current = await getCanvasLayoutRecord();
  const layout = normalizeCanvasLayout(current.layout, ids);
  const revision = canvasLayoutsEqual(layout, current.layout) ? current.revision : current.revision + 1;
  await chrome.storage.local.set({
    [CANVAS_LAYOUT_KEY]: layout,
    [CANVAS_LAYOUT_REVISION_KEY]: revision,
    [CANVAS_ZOOM_DEFAULT_MIGRATION_KEY]: true,
    [CANVAS_INITIAL_CENTER_MIGRATION_KEY]: true,
  });
  return layout;
}

async function commitItemsAndCanvas(items, layout, options = {}) {
  const stored = (Array.isArray(items) ? items : [])
    .map(normalizeItem)
    .filter(Boolean)
    .map(toStoredMeta);
  const current = options.currentRecord || await getCanvasLayoutRecord();
  const normalized = normalizeCanvasLayout(
    layout == null ? current.layout : layout,
    stored.map((item) => item.id)
  );
  const revision = canvasLayoutsEqual(normalized, current.layout) ? current.revision : current.revision + 1;
  const initialCenterMigrated = options.canvasInitialCenterMigrated === true
    || !current.needsInitialCenter
    || !isDefaultCanvasLayout(normalized, stored.map((item) => item.id));
  const payload = {
    [STORAGE_ITEMS]: stored,
    [STORAGE_TABS]: stored
      .filter((item) => item.kind === 'tab')
      .map(({ kind, hasThumb, hasSnap, ...rest }) => rest),
    [DATA_VERSION_KEY]: DATA_VERSION,
    [CANVAS_LAYOUT_KEY]: normalized,
    [CANVAS_LAYOUT_REVISION_KEY]: revision,
    [CANVAS_ZOOM_DEFAULT_MIGRATION_KEY]: true,
    [CANVAS_INITIAL_CENTER_MIGRATION_KEY]: initialCenterMigrated,
  };
  if (Array.isArray(options.tagCatalog)) payload[TAG_CATALOG_KEY] = options.tagCatalog;
  if (options.settings && typeof options.settings === 'object') payload[SETTINGS_KEY] = options.settings;
  await chrome.storage.local.set(payload);
  parkedUrlIndex = buildParkedUrlIndex(stored); // `stored` is already normalized — no extra I/O
  await markAutoBackupDirty();
  return { items: stored, layout: normalized, revision };
}

async function patchCanvasLayout(layout, baseRevision = null) {
  const current = await getCanvasLayoutRecord();
  if (baseRevision != null && normalizeCanvasRevision(baseRevision) !== current.revision) {
    return {
      ok: false,
      error: 'canvas_conflict',
      layout: current.layout,
      revision: current.revision,
    };
  }
  const items = await getParkedItemsRaw();
  const normalized = normalizeCanvasLayout(layout, items.map((item) => item.id));
  const revision = current.revision + 1;
  await chrome.storage.local.set({
    [CANVAS_LAYOUT_KEY]: normalized,
    [CANVAS_LAYOUT_REVISION_KEY]: revision,
    [CANVAS_ZOOM_DEFAULT_MIGRATION_KEY]: true,
    [CANVAS_INITIAL_CENTER_MIGRATION_KEY]: true,
  });
  return { ok: true, layout: normalized, revision };
}

function remapCanvasLayout(layout, removedIds, newId, anchorIds = []) {
  const next = normalizeCanvasLayout(layout);
  const anchors = Array.isArray(anchorIds) ? anchorIds : [];
  const anchor = anchors.map((id) => next.positions[id]).find(Boolean);
  const removed = new Set((removedIds || []).map(String));
  const remapId = (id) => removed.has(id) && newId ? String(newId) : id;
  next.connections = normalizeCanvasConnections(
    next.connections.map((connection) => {
      const sourceId = remapId(connection.sourceId);
      const targetId = remapId(connection.targetId);
      const remapped = sourceId !== connection.sourceId || targetId !== connection.targetId;
      return {
        sourceId,
        targetId,
        ...(!remapped && connection.curveOffset ? { curveOffset: connection.curveOffset } : {}),
      };
    }),
    [...Object.keys(next.positions).filter((id) => !removed.has(id)), ...(newId ? [String(newId)] : [])],
  );
  for (const id of removed) delete next.positions[id];
  if (newId && anchor) next.positions[newId] = { ...anchor };
  next.connections = normalizeCanvasConnections(next.connections, Object.keys(next.positions));
  return next;
}

function mergeAppendedCanvasLayout(baseLayout, incomingLayout, incomingItems, allItems) {
  const ids = (Array.isArray(allItems) ? allItems : []).map((item) => item.id);
  const next = normalizeCanvasLayout(baseLayout, ids);
  const sourcePositions = incomingLayout?.positions && typeof incomingLayout.positions === 'object'
    ? incomingLayout.positions
    : {};
  let index = Object.keys(next.positions).length;
  const incomingIdMap = new Map();
  for (const item of incomingItems || []) {
    const sourceId = item.__stageItemId || item.__stageGroupId;
    if (sourceId) incomingIdMap.set(String(sourceId), String(item.id));
    const source = sourceId ? sourcePositions[sourceId] : null;
    if (source) {
      next.positions[item.id] = normalizeCanvasPosition({
        ...source,
        x: Number(source.x) + 420,
        y: Number(source.y) + 120,
      }, defaultCanvasPosition(index));
    }
    index += 1;
  }
  const incomingConnections = Array.isArray(incomingLayout?.connections)
    ? incomingLayout.connections.map((connection) => ({
        sourceId: incomingIdMap.get(String(connection?.sourceId || '')) || String(connection?.sourceId || ''),
        targetId: incomingIdMap.get(String(connection?.targetId || '')) || String(connection?.targetId || ''),
        ...(connection?.curveOffset ? { curveOffset: connection.curveOffset } : {}),
      }))
    : [];
  next.connections = normalizeCanvasConnections(
    [...next.connections, ...incomingConnections],
    ids,
  );
  return next;
}

