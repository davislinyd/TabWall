/**
 * TabWall — Service Worker
 * Meta in chrome.storage.local; images in IndexedDB (mediaDb.js)
 */
importScripts('mediaDb.js', 'backupBuild.js', 'noteMedia.js');

const Media = self.TabWallMediaDB;
const Build = self.TabWallBackupBuild;
const NoteMedia = self.TabWallNoteMedia;

// ─── App diagnostic log (ring buffer) ──────────────────────────────
const APP_LOG_MAX = 300;
/** @type {{ t: number, level: string, tag: string, msg: string, detail: string }[]} */
const appLog = [];

function appLogPush(level, tag, msg, detail) {
  const entry = {
    t: Date.now(),
    level: level || 'info',
    tag: String(tag || 'app'),
    msg: String(msg || ''),
    detail: detail != null ? String(detail).slice(0, 800) : '',
  };
  appLog.push(entry);
  while (appLog.length > APP_LOG_MAX) appLog.shift();
  const line = `[TabWall][${entry.tag}] ${entry.msg}${entry.detail ? ' | ' + entry.detail : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  return entry;
}
const STORAGE_TABS = 'parkedTabs'; // legacy
const STORAGE_ITEMS = 'parkedItems';
const SETTINGS_KEY = 'settings';
const TAG_CATALOG_KEY = 'tagCatalog';
const CANVAS_LAYOUT_KEY = 'canvasLayout';
const CANVAS_LAYOUT_REVISION_KEY = 'canvasLayoutRevision';
const CANVAS_ZOOM_DEFAULT_MIGRATION_KEY = 'canvasZoomDefaultMigratedV1';
const CANVAS_INITIAL_CENTER_MIGRATION_KEY = 'canvasInitialCenterMigratedV1';
const CANVAS_LAYOUT_VERSION = 1;
const DATA_VERSION_KEY = 'dataVersion';
const DATA_VERSION = Build?.FORMAT_VERSION || 4;
const DATA_LIMITS = Build?.LIMITS || {
  MAX_URL_LENGTH: 8192,
  MAX_TITLE_LENGTH: 2048,
  MAX_NOTE_LENGTH: 20000,
  MAX_TAG_LENGTH: 128,
  MAX_TAGS: 100,
};

const DEFAULT_AUTO_BACKUP = {
  enabled: false,
  mode: 'lite',
  onChange: true,
  intervalUnit: 'hour', // minute | hour | day
  intervalValue: 24,
  maxKeep: 5,
  subfolder: 'TabWall-Backups', // under Chrome download directory
  folderPath: '', // absolute dir after last successful backup
  lastSuccessAt: 0,
  lastError: '',
  dirtyAt: 0,
};

const AUTO_SAVE_METADATA_MAX_RULES = 50;
const AUTO_SAVE_METADATA_MAX_CONDITIONS = 20;
const AUTO_SAVE_METADATA_OPERATORS = new Set([
  'match',
  'contains',
  'startsWith',
  'endsWith',
  'regex',
]);

const DEFAULT_AUTO_SAVE_METADATA = {
  enabled: false,
  rules: [],
};

const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  saveGroupCapture: 'all',
  restoreGroupIn: 'currentWindow',
  autoBackup: { ...DEFAULT_AUTO_BACKUP },
  autoSaveMetadata: { ...DEFAULT_AUTO_SAVE_METADATA },
};

const AUTO_BACKUP_ALARM = 'tabwall-auto-backup-schedule';
const AUTO_BACKUP_ONCHANGE_ALARM = 'tabwall-auto-backup-onchange';
const PARK_PAGE_PATH = 'park.html';
const STANDALONE_SURFACE = 'standalone';

let autoBackupRunning = false;

/** Prevent rapid duplicate actions from Chrome commands */
const actionLocks = new Map();
const ACTION_DEBOUNCE_MS = 700;

function beginAction(name) {
  const now = Date.now();
  const prev = actionLocks.get(name) || 0;
  if (now - prev < ACTION_DEBOUNCE_MS) return false;
  actionLocks.set(name, now);
  return true;
}

// All storage/media mutations entered from the SW share one FIFO. This keeps
// read-modify-write operations from overwriting each other when several UI
// messages arrive in the same service-worker lifetime.
let mutationTail = Promise.resolve();

function enqueueMutation(task) {
  const run = mutationTail.then(task, task);
  mutationTail = run.catch(() => {});
  return run;
}

const THUMB = { maxWidth: 480, quality: 0.6 };
const TINY = { maxWidth: 180, quality: 0.4 };
const SNAPSHOT = { maxWidth: null, quality: 0.85 };

let migrationPromise = null;

// ─── Normalize meta (no inline media) ──────────────────────────────

function normalizeTabItem(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const hasInlineThumb = typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('data:');
  const hasInlineSnap = typeof raw.snapshot === 'string' && raw.snapshot.startsWith('data:');
  const tags = normalizeTags(raw.tags);
  return {
    kind: 'tab',
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    url: safeText(raw.url, DATA_LIMITS.MAX_URL_LENGTH),
    title: safeText(raw.title || raw.url || 'Untitled', DATA_LIMITS.MAX_TITLE_LENGTH) || 'Untitled',
    favIconUrl: safeText(raw.favIconUrl, 4096),
    pinned: Boolean(raw.pinned),
    note: safeText(raw.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags,
    savedAt: safeTimestamp(raw.savedAt),
    hasThumb: raw.hasThumb === true || hasInlineThumb,
    hasSnap: raw.hasSnap === true || hasInlineSnap,
    // keep inline only during migration pass
    thumbnail: hasInlineThumb ? raw.thumbnail : '',
    snapshot: hasInlineSnap ? raw.snapshot : '',
  };
}

function normalizeGroupItem(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.map((m, i) => {
        m = m && typeof m === 'object' ? m : {};
        const hasInlineThumb = typeof m.thumbnail === 'string' && m.thumbnail.startsWith('data:');
        const hasInlineSnap = typeof m.snapshot === 'string' && m.snapshot.startsWith('data:');
        return {
          id: typeof m.id === 'string' && m.id ? m.id : crypto.randomUUID(),
          url: safeText(m.url, DATA_LIMITS.MAX_URL_LENGTH),
          title: safeText(m.title || m.url || 'Untitled', DATA_LIMITS.MAX_TITLE_LENGTH) || 'Untitled',
          favIconUrl: safeText(m.favIconUrl, 4096),
          pinned: Boolean(m.pinned),
          indexInGroup: typeof m.indexInGroup === 'number' ? m.indexInGroup : i,
          note: safeText(m.note, DATA_LIMITS.MAX_NOTE_LENGTH),
          tags: normalizeTags(m.tags),
          hasThumb: m.hasThumb === true || hasInlineThumb,
          hasSnap: m.hasSnap === true || hasInlineSnap,
          thumbnail: hasInlineThumb ? m.thumbnail : '',
          snapshot: hasInlineSnap ? m.snapshot : '',
        };
      })
    : [];
  const normalizeNote = (value) => normalizeNoteItem(value);
  return {
    kind: 'group',
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: safeText(raw.title, DATA_LIMITS.MAX_TITLE_LENGTH),
    color: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'].includes(raw.color)
      ? raw.color
      : 'grey',
    collapsed: Boolean(raw.collapsed),
    pinned: Boolean(raw.pinned),
    note: safeText(raw.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(raw.tags),
    savedAt: safeTimestamp(raw.savedAt),
    tabs,
    notes: Array.isArray(raw.notes) ? raw.notes.map(normalizeNote).filter(Boolean) : [],
  };
}

function normalizeNoteItem(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.slice(0, Build?.LIMITS?.MAX_NOTE_ATTACHMENTS || 12).map((value) => {
        value = value && typeof value === 'object' ? value : {};
        const mime = typeof value.mime === 'string' && /^image\//i.test(value.mime)
          ? value.mime.slice(0, 128)
          : 'image/jpeg';
        const data = typeof value.data === 'string' ? value.data : '';
        return {
          id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
          name: safeText(value.name || 'image', DATA_LIMITS.MAX_TITLE_LENGTH) || 'image',
          alt: safeText(value.alt, DATA_LIMITS.MAX_NOTE_LENGTH),
          mime,
          size: Math.max(0, Math.round(Number(value.size) || 0)),
          width: Math.max(0, Math.min(100000, Math.round(Number(value.width) || 0))),
          height: Math.max(0, Math.min(100000, Math.round(Number(value.height) || 0))),
          hasData: value.hasData === true || Boolean(data),
          ...(data ? { data } : {}),
          ...(value.__stageNoteId ? { __stageNoteId: value.__stageNoteId } : {}),
          ...(value.__stageAttachmentId ? { __stageAttachmentId: value.__stageAttachmentId } : {}),
        };
      })
    : [];
  return {
    kind: 'note',
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: safeText(raw.title || 'Sticker note', DATA_LIMITS.MAX_TITLE_LENGTH) || 'Sticker note',
    markdown: safeText(raw.markdown, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(raw.tags),
    pinned: Boolean(raw.pinned),
    savedAt: safeTimestamp(raw.savedAt),
    attachments,
    ...(raw.__stageItemId ? { __stageItemId: raw.__stageItemId } : {}),
    ...(raw.__stageGroupId ? { __stageGroupId: raw.__stageGroupId } : {}),
    ...(raw.__stageNoteId ? { __stageNoteId: raw.__stageNoteId } : {}),
  };
}

function safeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maxLength);
}

function safeTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= Date.now() + 86400000 ? n : Date.now();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .map((tag) => safeText(tag, DATA_LIMITS.MAX_TAG_LENGTH).trim())
      .filter(Boolean)
  )].slice(0, DATA_LIMITS.MAX_TAGS);
}

function normalizeAutoSaveCondition(raw) {
  const condition = raw && typeof raw === 'object' ? raw : {};
  return {
    field: condition.field === 'title' ? 'title' : 'domain',
    operator: AUTO_SAVE_METADATA_OPERATORS.has(condition.operator)
      ? condition.operator
      : 'match',
    negate: Boolean(condition.negate),
    value: safeText(condition.value, DATA_LIMITS.MAX_TITLE_LENGTH).trim(),
  };
}

function normalizeAutoSaveRule(raw) {
  const rule = raw && typeof raw === 'object' ? raw : {};
  const conditions = Array.isArray(rule.conditions)
    ? rule.conditions.slice(0, AUTO_SAVE_METADATA_MAX_CONDITIONS).map(normalizeAutoSaveCondition)
    : [];
  return {
    id: typeof rule.id === 'string' && rule.id ? rule.id : crypto.randomUUID(),
    enabled: rule.enabled !== false,
    logic: rule.logic === 'OR' ? 'OR' : 'AND',
    conditions,
    note: safeText(rule.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(rule.tags),
  };
}

function normalizeAutoSaveMetadata(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(source.enabled),
    rules: Array.isArray(source.rules)
      ? source.rules.slice(0, AUTO_SAVE_METADATA_MAX_RULES).map(normalizeAutoSaveRule)
      : [],
  };
}

const LEGACY_DEFAULT_CANVAS_ZOOM = 0.76;
const DEFAULT_CANVAS_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1 });
const DEFAULT_CANVAS_CARD_GAP = 96;
const DEFAULT_CANVAS_CARD_STEP_X = 338;
const DEFAULT_CANVAS_CARD_STEP_Y = 283;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function defaultCanvasPosition(index) {
  const i = Math.max(0, Number(index) || 0);
  return {
    x: DEFAULT_CANVAS_CARD_GAP + (i % 4) * DEFAULT_CANVAS_CARD_STEP_X,
    y: DEFAULT_CANVAS_CARD_GAP + Math.floor(i / 4) * DEFAULT_CANVAS_CARD_STEP_Y,
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
    for (const id of ids) {
      const fallback = defaultCanvasPosition(index++);
      positions[id] = normalizeCanvasPosition(source[id], fallback);
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

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'group' || Array.isArray(raw.tabs)) return normalizeGroupItem(raw);
  if (raw.kind === 'note') return normalizeNoteItem(raw);
  return normalizeTabItem(raw);
}

/** Strip any residual data URLs before persisting meta */
function toStoredMeta(item) {
  if (item.kind === 'group') {
    return {
      kind: 'group',
      id: item.id,
      title: item.title || '',
      color: item.color || 'grey',
      collapsed: Boolean(item.collapsed),
      pinned: Boolean(item.pinned),
      note: item.note || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      savedAt: item.savedAt || Date.now(),
      tabs: (item.tabs || []).map((m) => ({
        id: m.id,
        url: m.url || '',
        title: m.title || '',
        favIconUrl: m.favIconUrl || '',
        pinned: Boolean(m.pinned),
        indexInGroup: m.indexInGroup || 0,
        note: m.note || '',
        tags: Array.isArray(m.tags) ? m.tags : [],
        hasThumb: Boolean(m.hasThumb),
        hasSnap: Boolean(m.hasSnap),
      })),
      notes: (item.notes || []).map((note) => toStoredMeta(note)),
    };
  }
  if (item.kind === 'note') {
    return {
      kind: 'note',
      id: item.id,
      title: item.title || 'Sticker note',
      markdown: item.markdown || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      pinned: Boolean(item.pinned),
      savedAt: item.savedAt || Date.now(),
      attachments: (item.attachments || []).map((attachment) => ({
        id: attachment.id,
        name: attachment.name || 'image',
        alt: attachment.alt || '',
        mime: attachment.mime || 'image/jpeg',
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
        width: Number.isFinite(Number(attachment.width)) ? Number(attachment.width) : 0,
        height: Number.isFinite(Number(attachment.height)) ? Number(attachment.height) : 0,
        hasData: Boolean(attachment.hasData),
      })),
    };
  }
  return {
    kind: 'tab',
    id: item.id,
    url: item.url || '',
    title: item.title || '',
    favIconUrl: item.favIconUrl || '',
    pinned: Boolean(item.pinned),
    note: item.note || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    savedAt: item.savedAt || Date.now(),
    hasThumb: Boolean(item.hasThumb),
    hasSnap: Boolean(item.hasSnap),
  };
}

async function getParkedItemsRaw() {
  const data = await chrome.storage.local.get([STORAGE_ITEMS, STORAGE_TABS]);
  if (Array.isArray(data[STORAGE_ITEMS])) {
    return data[STORAGE_ITEMS].map(normalizeItem).filter(Boolean);
  }
  if (Array.isArray(data[STORAGE_TABS]) && data[STORAGE_TABS].length > 0) {
    return data[STORAGE_TABS].map((t) => normalizeTabItem({ ...t, kind: 'tab' }));
  }
  return [];
}

async function setParkedItems(items, options = {}) {
  const current = await getCanvasLayoutRecord();
  const result = await commitItemsAndCanvas(items, options.canvasLayout ?? current.layout, {
    ...options,
    currentRecord: current,
  });
  return result.items;
}

async function getParkedItems() {
  await ensureMediaMigration();
  const items = await getParkedItemsRaw();
  return items.map(toStoredMeta);
}

async function ensureMediaMigration() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const data = await chrome.storage.local.get([DATA_VERSION_KEY, STORAGE_ITEMS, STORAGE_TABS]);
    if ((data[DATA_VERSION_KEY] || 0) >= DATA_VERSION) return;

    let items = [];
    if (Array.isArray(data[STORAGE_ITEMS]) && data[STORAGE_ITEMS].length) {
      items = data[STORAGE_ITEMS].map(normalizeItem).filter(Boolean);
    } else if (Array.isArray(data[STORAGE_TABS]) && data[STORAGE_TABS].length) {
      items = data[STORAGE_TABS].map((t) => normalizeTabItem({ ...t, kind: 'tab' }));
    }

    for (const item of items) {
      if (item.kind === 'group') {
        for (const m of item.tabs || []) {
          if (m.thumbnail || m.snapshot) {
            const flags = await Media.putFromDataUrls(
              Media.mediaKeyMember(item.id, m.id),
              m.thumbnail,
              m.snapshot
            );
            m.hasThumb = flags.hasThumb || m.hasThumb;
            m.hasSnap = flags.hasSnap || m.hasSnap;
          }
          m.thumbnail = '';
          m.snapshot = '';
        }
        for (const note of item.notes || []) {
          for (const attachment of note.attachments || []) {
            if (attachment.data && Media.putAttachment) {
              const blob = Media.dataUrlToBlob(attachment.data);
              if (blob) {
                await Media.putAttachment(Media.mediaKeyNoteAttachment(note.id, attachment.id), blob);
                attachment.hasData = true;
              }
            }
            delete attachment.data;
          }
        }
      } else if (item.kind === 'note') {
        for (const attachment of item.attachments || []) {
          if (attachment.data && Media.putAttachment) {
            const blob = Media.dataUrlToBlob(attachment.data);
            if (blob) {
              await Media.putAttachment(Media.mediaKeyNoteAttachment(item.id, attachment.id), blob);
              attachment.hasData = true;
            }
          }
          delete attachment.data;
        }
      } else if (item.thumbnail || item.snapshot) {
        const flags = await Media.putFromDataUrls(
          Media.mediaKeyTab(item.id),
          item.thumbnail,
          item.snapshot
        );
        item.hasThumb = flags.hasThumb || item.hasThumb;
        item.hasSnap = flags.hasSnap || item.hasSnap;
        item.thumbnail = '';
        item.snapshot = '';
      }
    }

    await setParkedItems(items);
  })().catch((err) => {
    console.warn('[TabWall] media migration failed:', err);
    migrationPromise = null;
  });
  return migrationPromise;
}

// ─── Settings / tags ───────────────────────────────────────────────

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function normalizeIntervalUnit(u) {
  if (u === 'minute' || u === 'minutes') return 'minute';
  if (u === 'day' || u === 'days') return 'day';
  return 'hour';
}

function intervalValueBounds(unit) {
  if (unit === 'minute') return { min: 10, max: 1440, fallback: 60 };
  if (unit === 'day') return { min: 1, max: 7, fallback: 1 };
  return { min: 1, max: 168, fallback: 24 };
}

/** Sanitize relative path under Chrome's download directory. */
function sanitizeSubfolder(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
  s = s.replace(/^\/+/, '');
  const parts = s
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[?%*:|"<>]/g, '_').replace(/^\.+/, ''));
  s = parts.join('/');
  if (!s) s = 'TabWall-Backups';
  if (s.length > 180) s = s.slice(0, 180);
  return s;
}

function normalizeAutoBackup(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  let unit = normalizeIntervalUnit(o.intervalUnit);
  // Migrate legacy intervalHours
  let valueRaw = o.intervalValue;
  if (valueRaw == null && o.intervalHours != null) {
    unit = 'hour';
    valueRaw = o.intervalHours;
  }
  const bounds = intervalValueBounds(unit);
  // Prefer subfolder; legacy folderName was FS handle basename — use as subfolder hint if no subfolder
  const subfolder = sanitizeSubfolder(
    o.subfolder != null && String(o.subfolder).trim() !== ''
      ? o.subfolder
      : o.folderName || 'TabWall-Backups'
  );
  return {
    enabled: Boolean(o.enabled),
    mode: o.mode === 'full' ? 'full' : 'lite',
    onChange: o.onChange !== false,
    intervalUnit: unit,
    intervalValue: clampInt(valueRaw, bounds.min, bounds.max, bounds.fallback),
    maxKeep: clampInt(o.maxKeep, 1, 99, 5),
    subfolder,
    folderPath: typeof o.folderPath === 'string' ? o.folderPath : '',
    lastSuccessAt: Number(o.lastSuccessAt) || 0,
    lastError: typeof o.lastError === 'string' ? o.lastError : '',
    dirtyAt: Number(o.dirtyAt) || 0,
  };
}

/** Period in minutes for chrome.alarms */
function autoBackupIntervalMinutes(ab) {
  const n = normalizeAutoBackup(ab);
  if (n.intervalUnit === 'minute') return n.intervalValue;
  if (n.intervalUnit === 'day') return n.intervalValue * 24 * 60;
  return n.intervalValue * 60;
}

function dirnameOfLocalPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const normalized = filePath.replace(/[/\\]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx <= 0) return '';
  return normalized.slice(0, idx);
}

function waitForDownloadComplete(downloadId, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, item) => {
      if (settled) return;
      settled = true;
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      } catch {
        // ignore
      }
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(item || null);
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        chrome.downloads.search({ id: downloadId }, (items) => {
          if (chrome.runtime.lastError) {
            finish(new Error(chrome.runtime.lastError.message));
            return;
          }
          finish(null, items && items[0] ? items[0] : null);
        });
      } else if (delta.state?.current === 'interrupted') {
        finish(new Error(delta.error?.current || 'interrupted'));
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const it = items && items[0];
      if (!it) return;
      if (it.state === 'complete') finish(null, it);
      else if (it.state === 'interrupted') finish(new Error(it.error || 'interrupted'));
    });
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
  });
}

/** blob: URLs from MV3 service workers are unreliable for chrome.downloads — use data: */
async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const mime = (blob && blob.type) || 'application/octet-stream';
  return `data:${mime};base64,${btoa(binary)}`;
}

async function downloadBlobAsFile(blob, relativePath) {
  const url = await blobToDataUrl(blob);
  const downloadId = await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: relativePath,
        saveAs: false,
        conflictAction: 'uniquify',
      },
      (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (id == null) {
          reject(new Error('no_download_id'));
          return;
        }
        resolve(id);
      }
    );
  });
  const item = await waitForDownloadComplete(downloadId);
  return { downloadId, item, filename: item?.filename || '' };
}

function normalizeDownloadPath(filePath) {
  const value = String(filePath || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  // Chrome reports Windows download paths with drive letters; comparison is
  // case-insensitive there but remains case-sensitive on macOS/Linux.
  return /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
}

async function pruneDownloadedAutoBackups(mode, keep, { folderPath = '', subfolder = '' } = {}) {
  const keepN = Math.min(99, Math.max(1, Math.round(Number(keep) || 5)));
  const prefix = mode === 'full' ? 'tabwall-auto-full-' : 'tabwall-auto-lite-';
  const expectedFolder = normalizeDownloadPath(folderPath);
  // Without the exact folder observed from a successful download, pruning is
  // unsafe: a basename prefix alone is not a TabWall ownership proof.
  if (!expectedFolder) return;
  let items = [];
  try {
    items = await chrome.downloads.search({
      orderBy: ['-startTime'],
      limit: 200,
      exists: true,
    });
  } catch (err) {
    console.warn('[TabWall] prune search failed:', err);
    return;
  }
  const matched = (items || []).filter((it) => {
    const filename = normalizeDownloadPath(it.filename);
    const slash = filename.lastIndexOf('/');
    const folder = slash >= 0 ? filename.slice(0, slash) : '';
    const base = slash >= 0 ? filename.slice(slash + 1) : filename;
    const isKnownBackupName = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^/]+(?: \\([0-9]+\\))?\\.(?:zip|json)$`, 'i').test(base);
    return folder === expectedFolder && isKnownBackupName;
  });
  // already newest-first from orderBy
  const drop = matched.slice(keepN);
  for (const it of drop) {
    try {
      await new Promise((r) => chrome.downloads.removeFile(it.id, () => r()));
    } catch {
      // ignore
    }
    try {
      await new Promise((r) => chrome.downloads.erase({ id: it.id }, () => r()));
    } catch {
      // ignore
    }
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

function normalizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  // Local shortcut settings were removed; discard the legacy field on the next write.
  delete merged.shortcuts;
  merged.autoBackup = normalizeAutoBackup({
    ...DEFAULT_AUTO_BACKUP,
    ...(merged.autoBackup || {}),
  });
  merged.autoSaveMetadata = normalizeAutoSaveMetadata(merged.autoSaveMetadata);
  return merged;
}

async function patchSettings(partial) {
  const current = await getSettings();
  const patch = partial && typeof partial === 'object' ? partial : {};
  const next = normalizeSettings({
    ...current,
    ...patch,
    autoBackup: patch.autoBackup
      ? { ...current.autoBackup, ...patch.autoBackup }
      : current.autoBackup,
    autoSaveMetadata: patch.autoSaveMetadata
      ? {
          ...current.autoSaveMetadata,
          ...patch.autoSaveMetadata,
          rules: Array.isArray(patch.autoSaveMetadata.rules)
            ? patch.autoSaveMetadata.rules
            : current.autoSaveMetadata.rules,
        }
      : current.autoSaveMetadata,
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  if (patch.autoBackup) await syncAutoBackupAlarms(next.autoBackup);
  await markAutoBackupDirty();
  return { ok: true, settings: next };
}

let autoBackupDirtyWriting = false;

async function patchAutoBackup(partial) {
  const settings = await getSettings();
  const autoBackup = normalizeAutoBackup({ ...settings.autoBackup, ...partial });
  const next = { ...settings, autoBackup };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return autoBackup;
}

async function markAutoBackupDirty() {
  if (autoBackupDirtyWriting) return;
  autoBackupDirtyWriting = true;
  try {
    const settings = await getSettings();
    const ab = settings.autoBackup;
    if (!ab.enabled || !ab.onChange) return;
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...settings,
        autoBackup: normalizeAutoBackup({ ...ab, dirtyAt: Date.now(), lastError: ab.lastError || '' }),
      },
    });
    // 0.5 min when allowed; Chrome may clamp to ≥1 min for store installs
    await chrome.alarms.create(AUTO_BACKUP_ONCHANGE_ALARM, { delayInMinutes: 0.5 });
  } catch (err) {
    console.warn('[TabWall] markAutoBackupDirty failed:', err);
  } finally {
    autoBackupDirtyWriting = false;
  }
}

async function syncAutoBackupAlarms(autoBackup) {
  const ab = normalizeAutoBackup(autoBackup);
  await chrome.alarms.clear(AUTO_BACKUP_ALARM);
  if (ab.enabled) {
    const periodInMinutes = Math.max(10, autoBackupIntervalMinutes(ab));
    await chrome.alarms.create(AUTO_BACKUP_ALARM, {
      delayInMinutes: Math.min(periodInMinutes, 60),
      periodInMinutes,
    });
  }
}

/**
 * Auto backup → Chrome Downloads/{subfolder}/…
 * Absolute folder path is taken from DownloadItem.filename after success.
 * @param {{ force?: boolean, reason?: string }} opts
 */
async function runAutoBackup(opts = {}) {
  const force = Boolean(opts.force);
  if (autoBackupRunning) return { ok: false, error: 'busy' };
  autoBackupRunning = true;
  try {
    const settings = await getSettings();
    const ab = settings.autoBackup;
    if (!force && !ab.enabled) return { ok: false, error: 'disabled' };
    if (!force && opts.reason === 'onchange' && ab.onChange && !ab.dirtyAt) {
      return { ok: true, skipped: true };
    }

    if (!Build || typeof Build.buildLiteBlob !== 'function') {
      await patchAutoBackup({ lastError: 'build_failed' });
      return { ok: false, error: 'build_failed' };
    }

    const mode = ab.mode === 'full' ? 'full' : 'lite';
    // Auto full must hydrate in SW (no park page). Manual full export hydrates in park.
    const exported = await exportBackup(mode, { hydrate: mode === 'full' });
    if (!exported?.ok || !exported.backup) {
      appLogPush('error', 'autoBackup', 'export_failed');
      await patchAutoBackup({ lastError: 'export_failed' });
      return { ok: false, error: 'export_failed' };
    }

    let built;
    try {
      built =
        mode === 'full'
          ? Build.buildFullZipBlob(exported.backup, { auto: true })
          : Build.buildLiteBlob(exported.backup, { auto: true });
    } catch (err) {
      console.warn('[TabWall] auto backup build failed:', err);
      await patchAutoBackup({ lastError: 'build_failed' });
      return { ok: false, error: 'build_failed' };
    }

    const subfolder = sanitizeSubfolder(ab.subfolder);
    const relative = `${subfolder}/${built.filename}`;
    let downloaded;
    try {
      downloaded = await downloadBlobAsFile(built.blob, relative);
    } catch (err) {
      const detail = String(err?.message || err);
      appLogPush('error', 'autoBackup', 'download failed', detail);
      await patchAutoBackup({ lastError: 'write_failed' });
      return { ok: false, error: 'write_failed', detail };
    }

    // Always prefer path from this download (clears stale FS-access paths)
    const folderPath = dirnameOfLocalPath(downloaded.filename) || '';
    await patchAutoBackup({
      lastSuccessAt: Date.now(),
      lastError: '',
      dirtyAt: 0,
      subfolder,
      folderPath,
    });

    try {
      await pruneDownloadedAutoBackups(mode, ab.maxKeep, { folderPath, subfolder });
    } catch (err) {
      appLogPush('warn', 'autoBackup', 'prune failed', err?.message || err);
    }

    appLogPush(
      'info',
      'autoBackup',
      'ok',
      `file=${built.filename} path=${folderPath || '—'} mode=${mode}`
    );

    return {
      ok: true,
      filename: built.filename,
      folderPath,
      absoluteFile: downloaded.filename,
    };
  } catch (err) {
    appLogPush('error', 'autoBackup', 'runAutoBackup failed', err?.message || err);
    await patchAutoBackup({ lastError: 'write_failed' });
    return { ok: false, error: 'write_failed' };
  } finally {
    autoBackupRunning = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_BACKUP_ALARM) {
    enqueueMutation(() => runAutoBackup({ reason: 'schedule' })).catch(() => {});
  } else if (alarm.name === AUTO_BACKUP_ONCHANGE_ALARM) {
    enqueueMutation(() => runAutoBackup({ reason: 'onchange' })).catch(() => {});
  }
});

chrome.tabs.onActivated?.addListener?.(({ tabId }) => {
  return refreshTabBadge(tabId).catch(() => {});
});

chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
  if (!changeInfo?.url && changeInfo?.status !== 'complete') return;
  return refreshTabBadge(tab || tabId).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const tasks = [];
  if (changes.settings) {
    const next = changes.settings.newValue;
    const ab = normalizeAutoBackup(next?.autoBackup);
    tasks.push(syncAutoBackupAlarms(ab));
  }
  if (changes[STORAGE_ITEMS] || changes[STORAGE_TABS]) {
    tasks.push(refreshActiveTabBadge());
  }
  return Promise.all(tasks).catch(() => {});
});

// Restore schedule after SW wake / install
chrome.runtime.onInstalled.addListener(() => {
  return Promise.all([
    getSettings().then((s) => syncAutoBackupAlarms(s.autoBackup)),
    refreshActiveTabBadge(),
  ]).catch(() => {});
});
chrome.runtime.onStartup?.addListener?.(() => {
  return Promise.all([
    getSettings().then((s) => syncAutoBackupAlarms(s.autoBackup)),
    refreshActiveTabBadge(),
  ]).catch(() => {});
});

async function getTagCatalog() {
  const data = await chrome.storage.local.get(TAG_CATALOG_KEY);
  return Array.isArray(data[TAG_CATALOG_KEY]) ? data[TAG_CATALOG_KEY] : [];
}

async function setTagCatalog(tags) {
  const cleaned = [...new Set(
    (Array.isArray(tags) ? tags : [])
      .map((t) => safeText(String(t), DATA_LIMITS.MAX_TAG_LENGTH).trim())
      .filter(Boolean)
  )].slice(0, Build?.LIMITS?.MAX_TAG_CATALOG || 2000);
  await chrome.storage.local.set({ [TAG_CATALOG_KEY]: cleaned });
  await markAutoBackupDirty();
  return cleaned;
}

function eachTagOnItem(item, fn) {
  if (Array.isArray(item.tags)) for (const t of item.tags) fn(t);
  if (item.kind === 'group' && Array.isArray(item.tabs)) {
    for (const m of item.tabs) {
      if (Array.isArray(m.tags)) for (const t of m.tags) fn(t);
    }
    for (const note of item.notes || []) {
      if (Array.isArray(note.tags)) for (const t of note.tags) fn(t);
    }
  }
}

async function collectAllTagNames() {
  const catalog = await getTagCatalog();
  const items = await getParkedItems();
  const set = new Set(catalog);
  for (const item of items) {
    eachTagOnItem(item, (t) => {
      const name = String(t).trim();
      if (name) set.add(name);
    });
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function countTagUsage(items, name) {
  let n = 0;
  for (const item of items) {
    if (Array.isArray(item.tags) && item.tags.includes(name)) n++;
    if (item.kind === 'group' && Array.isArray(item.tabs)) {
      for (const m of item.tabs) {
        if (Array.isArray(m.tags) && m.tags.includes(name)) n++;
      }
      for (const note of item.notes || []) {
        if (Array.isArray(note.tags) && note.tags.includes(name)) n++;
      }
    }
  }
  return n;
}

async function getTagsWithCounts() {
  const [catalog, items] = await Promise.all([getTagCatalog(), getParkedItems()]);
  const namesSet = new Set(catalog);
  for (const item of items) eachTagOnItem(item, (tag) => namesSet.add(String(tag).trim()));
  const names = [...namesSet].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  return names.map((name) => ({ name, count: countTagUsage(items, name) }));
}

function mapTagsInItem(item, mapFn) {
  const next = { ...item };
  if (Array.isArray(item.tags)) next.tags = mapFn(item.tags);
  if (item.kind === 'group' && Array.isArray(item.tabs)) {
    next.tabs = item.tabs.map((m) => ({
      ...m,
      tags: Array.isArray(m.tags) ? mapFn(m.tags) : [],
    }));
    next.notes = (item.notes || []).map((note) => ({
      ...note,
      tags: Array.isArray(note.tags) ? mapFn(note.tags) : [],
    }));
  }
  return next;
}

async function addTag(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: 'empty' };
  const catalog = await getTagCatalog();
  if (!catalog.includes(n)) {
    catalog.push(n);
    await setTagCatalog(catalog);
  }
  return { ok: true, tags: await getTagsWithCounts() };
}

async function renameTag(from, to) {
  const oldName = String(from || '').trim();
  const newName = String(to || '').trim();
  if (!oldName || !newName) return { ok: false, error: 'empty' };
  if (oldName === newName) return { ok: true, tags: await getTagsWithCounts() };

  const catalog = await getTagCatalog();
  const nextCatalog = catalog.filter((t) => t !== oldName);
  if (!nextCatalog.includes(newName)) nextCatalog.push(newName);
  await setTagCatalog(nextCatalog);

  const list = await getParkedItems();
  let changed = false;
  const next = list.map((item) => {
    let hit = false;
    eachTagOnItem(item, (t) => {
      if (t === oldName) hit = true;
    });
    if (!hit) return item;
    changed = true;
    return mapTagsInItem(item, (tags) =>
      tags.map((t) => (t === oldName ? newName : t)).filter((t, i, arr) => arr.indexOf(t) === i)
    );
  });
  if (changed) await setParkedItems(next);
  return { ok: true, tags: await getTagsWithCounts() };
}

async function deleteTag(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: 'empty' };
  const catalog = await getTagCatalog();
  await setTagCatalog(catalog.filter((t) => t !== n));
  const list = await getParkedItems();
  let changed = false;
  const next = list.map((item) => {
    let hit = false;
    eachTagOnItem(item, (t) => {
      if (t === n) hit = true;
    });
    if (!hit) return item;
    changed = true;
    return mapTagsInItem(item, (tags) => tags.filter((t) => t !== n));
  });
  if (changed) await setParkedItems(next);
  return { ok: true, tags: await getTagsWithCounts() };
}

async function mergeTagsIntoCatalog(tags) {
  if (!Array.isArray(tags) || !tags.length) return;
  const catalog = await getTagCatalog();
  let catChanged = false;
  for (const tag of tags) {
    const name = String(tag).trim();
    if (name && !catalog.includes(name)) {
      catalog.push(name);
      catChanged = true;
    }
  }
  if (catChanged) await setTagCatalog(catalog);
}

async function updateGroupMember(groupId, memberId, patch) {
  const list = await getParkedItems();
  const gIdx = list.findIndex((t) => t.id === groupId && t.kind === 'group');
  if (gIdx === -1) return { ok: false, error: 'not_found' };
  const group = { ...list[gIdx], tabs: [...(list[gIdx].tabs || [])] };
  const mIdx = group.tabs.findIndex((m) => m.id === memberId);
  if (mIdx === -1) return { ok: false, error: 'member_not_found' };
  const member = { ...group.tabs[mIdx] };
  if (typeof patch.note === 'string') member.note = patch.note;
  if (Array.isArray(patch.tags)) {
    member.tags = patch.tags
      .map((t) => String(t).trim())
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i);
    await mergeTagsIntoCatalog(member.tags);
  }
  group.tabs[mIdx] = member;
  list[gIdx] = group;
  await setParkedItems(list);
  return { ok: true, item: group, member };
}

function noteIndexInList(list, noteId, groupId = '') {
  if (groupId) {
    const groupIndex = list.findIndex((item) => item.id === groupId && item.kind === 'group');
    if (groupIndex < 0) return null;
    const noteIndex = (list[groupIndex].notes || []).findIndex((note) => note.id === noteId);
    return noteIndex < 0 ? null : { groupIndex, noteIndex };
  }
  const itemIndex = list.findIndex((item) => item.id === noteId && item.kind === 'note');
  return itemIndex < 0 ? null : { itemIndex };
}

function rewriteNoteAttachmentTokens(markdown, idMap) {
  return String(markdown || '').replace(
    /(!\[[^\]\n]*\]\(attachment:\/\/)([A-Za-z0-9_-]{1,128})(\))/g,
    (full, prefix, id, suffix) => `${prefix}${idMap.get(id) || id}${suffix}`
  );
}

function remintNote(note, { groupId = '', sourceItemId = '' } = {}) {
  const sourceNoteId = note.id;
  const attachmentMap = new Map();
  const attachments = (note.attachments || []).map((attachment) => {
    const sourceAttachmentId = attachment.id;
    const id = crypto.randomUUID();
    attachmentMap.set(sourceAttachmentId, id);
    return {
      ...attachment,
      id,
      __stageNoteId: sourceNoteId,
      __stageAttachmentId: sourceAttachmentId,
    };
  });
  return {
    ...note,
    id: crypto.randomUUID(),
    markdown: rewriteNoteAttachmentTokens(note.markdown, attachmentMap),
    attachments,
    ...(sourceItemId ? { __stageItemId: sourceItemId } : {}),
    ...(groupId ? { __stageGroupId: groupId, __stageNoteId: sourceNoteId } : {}),
  };
}

function validateNoteMutation(note) {
  if (!Build?.validateBackup) return '';
  const validation = Build.validateBackup({
    format: 'tabwall-backup',
    version: DATA_VERSION,
    media: 'inline',
    parkedItems: [note],
    parkedTabs: [],
    settings: {},
    tagCatalog: [],
  });
  return validation?.ok ? '' : validation?.error || 'invalid_note';
}

function fallbackAttachmentSize(attachment) {
  const size = Number(attachment?.size);
  return Number.isInteger(size) && size > 0 ? size : 0;
}

async function attachmentBytesForNote(note) {
  return mapWithConcurrency(note?.attachments || [], 4, async (attachment) => {
    if (!attachment || (attachment.hasData !== true && !attachment.data)) return 0;
    try {
      const blob = await Media.getAttachment?.(Media.mediaKeyNoteAttachment(note.id, attachment.id));
      const size = Number(blob?.size);
      if (Number.isFinite(size) && size >= 0) return size;
    } catch {
      // Metadata remains a safe fallback for legacy rows or test stores.
    }
    return fallbackAttachmentSize(attachment);
  }).then((sizes) => sizes.reduce((total, size) => total + size, 0));
}

async function attachmentUsageForItems(items, focusNoteId = '', focusGroupId = '') {
  const notes = [];
  for (const item of items || []) {
    if (item.kind === 'group') {
      for (const note of item.notes || []) notes.push({ note, groupId: item.id });
    } else if (item.kind === 'note') {
      notes.push({ note: item, groupId: '' });
    }
  }
  const values = await Promise.all(notes.map(async ({ note, groupId }) => ({
    note,
    groupId,
    bytes: await attachmentBytesForNote(note),
  })));
  const focus = values.find(({ note, groupId }) => (
    note.id === focusNoteId && groupId === String(focusGroupId || '')
  ));
  return {
    usedBytes: values.reduce((total, value) => total + value.bytes, 0),
    noteBytes: focus?.bytes || 0,
    noteId: focus?.note.id || '',
    groupId: focus?.groupId || '',
  };
}

async function checkAttachmentQuota(items, focusNoteId = '', focusGroupId = '') {
  const usage = await attachmentUsageForItems(items, focusNoteId, focusGroupId);
  const noteOver = usage.noteId && usage.noteBytes > (Build?.LIMITS?.NOTE_ATTACHMENT_QUOTA_BYTES || 96 * 1024 * 1024);
  const totalOver = usage.usedBytes > (Build?.LIMITS?.TOTAL_ATTACHMENT_QUOTA_BYTES || 512 * 1024 * 1024);
  if (noteOver || totalOver) {
    return {
      ok: false,
      error: 'attachment_quota_exceeded',
      usedBytes: usage.usedBytes,
      maxBytes: Build?.LIMITS?.TOTAL_ATTACHMENT_QUOTA_BYTES || 512 * 1024 * 1024,
      noteBytes: usage.noteBytes,
      noteMaxBytes: Build?.LIMITS?.NOTE_ATTACHMENT_QUOTA_BYTES || 96 * 1024 * 1024,
    };
  }
  return {
    ok: true,
    usedBytes: usage.usedBytes,
    maxBytes: Build?.LIMITS?.TOTAL_ATTACHMENT_QUOTA_BYTES || 512 * 1024 * 1024,
    noteBytes: usage.noteBytes,
    noteMaxBytes: Build?.LIMITS?.NOTE_ATTACHMENT_QUOTA_BYTES || 96 * 1024 * 1024,
  };
}

async function getAttachmentUsage(noteId = '', groupId = '') {
  const items = await getParkedItems();
  const usage = await attachmentUsageForItems(items, String(noteId || ''), String(groupId || ''));
  return {
    ok: true,
    usedBytes: usage.usedBytes,
    maxBytes: Build?.LIMITS?.TOTAL_ATTACHMENT_QUOTA_BYTES || 512 * 1024 * 1024,
    noteBytes: usage.noteBytes,
    noteMaxBytes: Build?.LIMITS?.NOTE_ATTACHMENT_QUOTA_BYTES || 96 * 1024 * 1024,
  };
}

async function normalizeInlineNoteAttachment(attachment, blob) {
  if (!NoteMedia?.normalizeBlob) throw new Error('note_media_unavailable');
  const normalized = await NoteMedia.normalizeBlob(blob);
  Object.assign(attachment, {
    mime: normalized.mime,
    size: normalized.size,
    width: normalized.width,
    height: normalized.height,
    hasData: true,
  });
  return normalized.blob;
}

async function createNote(raw, position = null) {
  const note = normalizeNoteItem({ ...(raw || {}), kind: 'note' });
  const list = await getParkedItems();
  const idAlreadyUsed = list.some((item) => (
    item.id === note.id
    || (item.kind === 'group' && (
      (item.tabs || []).some((member) => member.id === note.id)
      || (item.notes || []).some((member) => member.id === note.id)
    ))
  ));
  if (idAlreadyUsed) note.id = crypto.randomUUID();
  const validationError = validateNoteMutation(note);
  if (validationError) return { ok: false, error: validationError };
  let writtenKeys = new Set();
  try {
    writtenKeys = await persistInlineMediaToIdb([note], { preserveMissingAttachments: true });
    const normalizedValidationError = validateNoteMutation(note);
    if (normalizedValidationError) throw new Error(normalizedValidationError);
    const quota = await checkAttachmentQuota([...list, note], note.id, '');
    if (!quota.ok) {
      await Media.removeMany(Media.keysForItem(note));
      return quota;
    }
  } catch (err) {
    if (writtenKeys.size) await Media.removeMany([...writtenKeys]).catch(() => {});
    const errorCode = String(err?.code || err?.message || '');
    return {
      ok: false,
      error: errorCode === 'attachment_quota_exceeded' || errorCode.startsWith('note_image_')
        ? errorCode
        : 'media_write_failed',
      detail: String(err?.message || err),
    };
  }
  try {
    const layout = await getCanvasLayout();
    if (position && typeof position === 'object') {
      layout.positions = { ...(layout.positions || {}) };
      layout.positions[note.id] = normalizeCanvasPosition(position, defaultCanvasPosition(list.length));
    }
    list.push(note);
    await setParkedItems(list, { canvasLayout: layout });
  } catch (err) {
    if (writtenKeys.size) await Media.removeMany([...writtenKeys]).catch(() => {});
    return {
      ok: false,
      error: 'storage_write_failed',
      detail: String(err?.message || err),
    };
  }
  await mergeTagsIntoCatalog(note.tags);
  return { ok: true, item: toStoredMeta(note) };
}

async function updateNote(noteId, patch = {}, groupId = '') {
  const list = await getParkedItems();
  const location = noteIndexInList(list, noteId, groupId);
  if (!location) return { ok: false, error: 'not_found' };
  const current = location.groupIndex != null
    ? list[location.groupIndex].notes[location.noteIndex]
    : list[location.itemIndex];
  const nextNote = normalizeNoteItem({
    ...current,
    ...patch,
    kind: 'note',
    id: current.id,
    attachments: Array.isArray(patch.attachments) ? patch.attachments : current.attachments,
  });
  const validationError = validateNoteMutation(nextNote);
  if (validationError) return { ok: false, error: validationError };
  let writtenKeys = new Set();
  try {
    if ((nextNote.attachments || []).some((attachment) => attachment.data)) {
      writtenKeys = await persistInlineMediaToIdb([nextNote], { preserveMissingAttachments: true });
    }
    const normalizedValidationError = validateNoteMutation(nextNote);
    if (normalizedValidationError) throw new Error(normalizedValidationError);
    const previewList = [...list];
    if (location.groupIndex != null) {
      previewList[location.groupIndex] = {
        ...previewList[location.groupIndex],
        notes: [...(previewList[location.groupIndex].notes || [])],
      };
      previewList[location.groupIndex].notes[location.noteIndex] = nextNote;
    } else {
      previewList[location.itemIndex] = nextNote;
    }
    const quota = await checkAttachmentQuota(previewList, nextNote.id, groupId);
    if (!quota.ok) {
      if (writtenKeys.size) await Media.removeMany([...writtenKeys]).catch(() => {});
      return quota;
    }
  } catch (err) {
    if (writtenKeys.size) await Media.removeMany([...writtenKeys]).catch(() => {});
    const errorCode = String(err?.code || err?.message || '');
    return {
      ok: false,
      error: errorCode === 'attachment_quota_exceeded' || errorCode.startsWith('note_image_')
        ? errorCode
        : 'media_write_failed',
      detail: String(err?.message || err),
    };
  }
  const oldKeys = new Set(Media.keysForItem(current));
  const newKeys = new Set(Media.keysForItem(nextNote));
  if (location.groupIndex != null) {
    const group = { ...list[location.groupIndex], notes: [...(list[location.groupIndex].notes || [])] };
    group.notes[location.noteIndex] = nextNote;
    list[location.groupIndex] = group;
  } else {
    list[location.itemIndex] = nextNote;
  }
  try {
    await setParkedItems(list);
  } catch (err) {
    if (writtenKeys.size) await Media.removeMany([...writtenKeys]).catch(() => {});
    return {
      ok: false,
      error: 'storage_write_failed',
      detail: String(err?.message || err),
    };
  }
  await mergeTagsIntoCatalog(nextNote.tags);
  try {
    await Media.removeMany([...oldKeys].filter((key) => !newKeys.has(key)));
  } catch (err) {
    appLogPush('warn', 'note', 'attachment cleanup deferred', err?.message || err);
  }
  return {
    ok: true,
    item: toStoredMeta(nextNote),
    group: location.groupIndex != null ? list[location.groupIndex] : null,
  };
}

async function deleteNote(noteId, groupId = '') {
  const list = await getParkedItems();
  const location = noteIndexInList(list, noteId, groupId);
  if (!location) return { ok: false, error: 'not_found' };
  let removed;
  if (location.groupIndex != null) {
    const group = { ...list[location.groupIndex], notes: [...(list[location.groupIndex].notes || [])] };
    [removed] = group.notes.splice(location.noteIndex, 1);
    list[location.groupIndex] = group;
  } else {
    [removed] = list.splice(location.itemIndex, 1);
  }
  await setParkedItems(list);
  try {
    await Media.removeMany(Media.keysForItem(removed));
  } catch (err) {
    appLogPush('warn', 'note', 'attachment cleanup deferred', err?.message || err);
  }
  return { ok: true, remaining: list.length };
}

// ─── Media hydrate for export ──────────────────────────────────────

async function mapWithConcurrency(values, limit, mapper) {
  const list = Array.isArray(values) ? values : [];
  const result = new Array(list.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= list.length) return;
      result[index] = await mapper(list[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), list.length || 1) }, worker)
  );
  return result;
}

async function hydrateItemMedia(item) {
  if (item.kind === 'group') {
    const tabs = await mapWithConcurrency(item.tabs || [], 4, async (m) => {
      const med = await Media.get(Media.mediaKeyMember(item.id, m.id));
      return {
        ...m,
        thumbnail: med.thumb ? await Media.blobToDataUrl(med.thumb) : '',
        snapshot: med.snap ? await Media.blobToDataUrl(med.snap) : '',
      };
    });
    const notes = await mapWithConcurrency(item.notes || [], 4, async (note) => ({
      ...note,
      attachments: await mapWithConcurrency(note.attachments || [], 4, async (attachment) => {
        const blob = await Media.getAttachment?.(Media.mediaKeyNoteAttachment(note.id, attachment.id));
        return {
          ...attachment,
          data: blob ? await Media.blobToDataUrl(blob) : '',
          hasData: Boolean(blob) || attachment.hasData === true,
        };
      }),
    }));
    return { ...item, tabs, notes };
  }
  if (item.kind === 'note') {
    return {
      ...item,
      attachments: await mapWithConcurrency(item.attachments || [], 4, async (attachment) => {
        const blob = await Media.getAttachment?.(Media.mediaKeyNoteAttachment(item.id, attachment.id));
        return {
          ...attachment,
          data: blob ? await Media.blobToDataUrl(blob) : '',
          hasData: Boolean(blob) || attachment.hasData === true,
        };
      }),
    };
  }
  const med = await Media.get(Media.mediaKeyTab(item.id));
  return {
    ...item,
    thumbnail: med.thumb ? await Media.blobToDataUrl(med.thumb) : '',
    snapshot: med.snap ? await Media.blobToDataUrl(med.snap) : '',
  };
}

/**
 * @param {'lite'|'full'} mode
 * @param {{ hydrate?: boolean }} opts hydrate=true inlines media as data URLs (for SW-local full build only; never over message)
 */
async function exportBackup(mode = 'lite', { hydrate = false } = {}) {
  const [parkedItems, settingsData, tagCatalog, canvasLayout] = await Promise.all([
    getParkedItems(),
    chrome.storage.local.get(SETTINGS_KEY),
    getTagCatalog(),
    getCanvasLayout(),
  ]);

  let items = parkedItems;
  let media = 'none';
  if (mode === 'full' && hydrate) {
    items = await mapWithConcurrency(parkedItems, 4, hydrateItemMedia);
    media = 'inline';
  } else if (mode === 'full') {
    // Meta only — park hydrates from IDB to avoid huge extension messages
    media = 'idb';
  }

  const parkedTabs = items
    .filter((i) => i.kind === 'tab')
    .map(({ kind, hasThumb, hasSnap, ...rest }) => rest);

  appLogPush('info', 'export', `exportBackup mode=${mode} hydrate=${hydrate}`, `items=${items.length}`);

  return {
    ok: true,
    backup: {
      format: 'tabwall-backup',
      version: DATA_VERSION,
      media,
      appVersion: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      parkedItems: items,
      parkedTabs,
      settings: settingsData[SETTINGS_KEY] || {},
      tagCatalog,
      canvasLayout,
    },
  };
}

/** Fresh UUIDs so append never collides with existing items / media keys. */
function remintItemIds(items) {
  return (items || []).map((item) => {
    if (!item) return item;
    if (item.kind === 'group') {
      const sourceGroupId = item.id;
      return {
        ...item,
        id: crypto.randomUUID(),
        __stageGroupId: sourceGroupId,
        tabs: (item.tabs || []).map((m) => ({
          ...m,
          id: crypto.randomUUID(),
          __stageGroupId: sourceGroupId,
          __stageMemberId: m.id,
        })),
        notes: (item.notes || []).map((note) => remintNote(note, { groupId: sourceGroupId })),
      };
    }
    if (item.kind === 'note') return remintNote(item, { sourceItemId: item.id });
    return { ...item, id: crypto.randomUUID(), __stageItemId: item.id };
  });
}

async function persistInlineMediaToIdb(items, { preserveMissingAttachments = false } = {}) {
  const writtenKeys = new Set();
  try {
    for (const item of items) {
      if (item.kind === 'group') {
        for (const m of item.tabs || []) {
          if (m.thumbnail || m.snapshot) {
            const key = Media.mediaKeyMember(item.id, m.id);
            const flags = await Media.putFromDataUrls(key, m.thumbnail, m.snapshot);
            m.hasThumb = flags.hasThumb;
            m.hasSnap = flags.hasSnap;
            if (flags.hasThumb || flags.hasSnap) writtenKeys.add(key);
          } else {
            m.hasThumb = false;
            m.hasSnap = false;
          }
          m.thumbnail = '';
          m.snapshot = '';
        }
        for (const note of item.notes || []) {
          for (const attachment of note.attachments || []) {
            const key = Media.mediaKeyNoteAttachment(note.id, attachment.id);
            const sourceBlob = attachment.data ? Media.dataUrlToBlob(attachment.data) : null;
            if (attachment.data && !sourceBlob) throw new Error('invalid_attachment');
            if (attachment.hasData === true && !sourceBlob && !preserveMissingAttachments) {
              throw new Error('import_missing_media');
            }
            if (sourceBlob) {
              const blob = await normalizeInlineNoteAttachment(attachment, sourceBlob);
              await Media.putAttachment(key, blob);
              attachment.hasData = true;
              writtenKeys.add(key);
            } else if (!preserveMissingAttachments) {
              attachment.hasData = false;
            }
            delete attachment.data;
          }
        }
      } else if (item.kind === 'note') {
        for (const attachment of item.attachments || []) {
          const key = Media.mediaKeyNoteAttachment(item.id, attachment.id);
          const sourceBlob = attachment.data ? Media.dataUrlToBlob(attachment.data) : null;
          if (attachment.data && !sourceBlob) throw new Error('invalid_attachment');
          if (attachment.hasData === true && !sourceBlob && !preserveMissingAttachments) {
            throw new Error('import_missing_media');
          }
          if (sourceBlob) {
            const blob = await normalizeInlineNoteAttachment(attachment, sourceBlob);
            await Media.putAttachment(key, blob);
            attachment.hasData = true;
            writtenKeys.add(key);
          } else if (!preserveMissingAttachments) {
            attachment.hasData = false;
          }
          delete attachment.data;
        }
      } else if (item.thumbnail || item.snapshot) {
        const key = Media.mediaKeyTab(item.id);
        const flags = await Media.putFromDataUrls(key, item.thumbnail, item.snapshot);
        item.hasThumb = flags.hasThumb;
        item.hasSnap = flags.hasSnap;
        if (flags.hasThumb || flags.hasSnap) writtenKeys.add(key);
        item.thumbnail = '';
        item.snapshot = '';
      } else {
        item.hasThumb = false;
        item.hasSnap = false;
      }
    }
  } catch (err) {
    try {
      await Media.removeMany([...writtenKeys]);
    } catch {
      // best effort rollback
    }
    throw err;
  }
  return writtenKeys;
}

function isValidImportStageId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_-]+$/.test(value);
}

function stageSourceKey(item, member = null) {
  if (member?.__stageAttachmentId) {
    const noteId = member.__stageNoteId || member.noteId || member.id;
    return Media.mediaKeyNoteAttachment(noteId, member.__stageAttachmentId);
  }
  if (member?.kind === 'note' || member?.attachments) {
    const noteId = member.__stageNoteId || member.id;
    return Media.mediaKeyNoteAttachment(noteId, member.attachmentId || member.id);
  }
  if (member) {
    const groupId = member.__stageGroupId || item.__stageGroupId || item.id;
    const memberId = member.__stageMemberId || member.id;
    return Media.mediaKeyMember(groupId, memberId);
  }
  return Media.mediaKeyTab(item.__stageItemId || item.id);
}

function stageNoteAttachmentKey(item, note, attachment) {
  const noteId = attachment.__stageNoteId || note.__stageNoteId || note.id;
  const attachmentId = attachment.__stageAttachmentId || attachment.id;
  return Media.mediaKeyNoteAttachment(noteId, attachmentId);
}

async function normalizeStagedNoteAttachment(attachment, blob) {
  if (!blob || typeof blob.size !== 'number' || !NoteMedia?.normalizeBlob) {
    throw new Error('note_media_unavailable');
  }
  const normalized = await NoteMedia.normalizeBlob(blob);
  Object.assign(attachment, {
    mime: normalized.mime,
    size: normalized.size,
    width: normalized.width,
    height: normalized.height,
  });
  return normalized.blob;
}

async function persistStagedMediaToIdb(stageId, items) {
  if (!Media?.getImportStage || !Media?.putFromBlobs) {
    throw new Error('import_stage_unavailable');
  }
  const staged = await Media.getImportStage(stageId);
  const writtenKeys = new Set();
  try {
    for (const item of items) {
      if (item.kind === 'group') {
        for (const member of item.tabs || []) {
          const key = Media.mediaKeyMember(item.id, member.id);
          const row = staged.get(stageSourceKey(item, member));
          if ((member.hasThumb && !row?.thumb) || (member.hasSnap && !row?.snap)) {
            throw new Error('import_stage_missing_media');
          }
          if (row && (row.thumb || row.snap)) {
            const flags = await Media.putFromBlobs(key, row.thumb, row.snap);
            member.hasThumb = flags.hasThumb;
            member.hasSnap = flags.hasSnap;
            if (flags.hasThumb || flags.hasSnap) writtenKeys.add(key);
          } else {
            member.hasThumb = false;
            member.hasSnap = false;
          }
          member.thumbnail = '';
          member.snapshot = '';
        }
        for (const note of item.notes || []) {
          for (const attachment of note.attachments || []) {
            const key = Media.mediaKeyNoteAttachment(note.id, attachment.id);
            const row = staged.get(stageNoteAttachmentKey(item, note, attachment));
            if (attachment.hasData && !row?.attachment) throw new Error('import_stage_missing_media');
            if (row?.attachment) {
              const normalizedBlob = await normalizeStagedNoteAttachment(attachment, row.attachment);
              await Media.putAttachment(key, normalizedBlob);
              attachment.hasData = true;
              writtenKeys.add(key);
            } else {
              attachment.hasData = false;
            }
            delete attachment.data;
          }
        }
      } else if (item.kind === 'note') {
        for (const attachment of item.attachments || []) {
          const key = Media.mediaKeyNoteAttachment(item.id, attachment.id);
          const row = staged.get(stageNoteAttachmentKey(item, item, attachment));
          if (attachment.hasData && !row?.attachment) throw new Error('import_stage_missing_media');
          if (row?.attachment) {
            const normalizedBlob = await normalizeStagedNoteAttachment(attachment, row.attachment);
            await Media.putAttachment(key, normalizedBlob);
            attachment.hasData = true;
            writtenKeys.add(key);
          } else {
            attachment.hasData = false;
          }
          delete attachment.data;
        }
      } else {
        const key = Media.mediaKeyTab(item.id);
        const row = staged.get(stageSourceKey(item));
        if ((item.hasThumb && !row?.thumb) || (item.hasSnap && !row?.snap)) {
          throw new Error('import_stage_missing_media');
        }
        if (row && (row.thumb || row.snap)) {
          const flags = await Media.putFromBlobs(key, row.thumb, row.snap);
          item.hasThumb = flags.hasThumb;
          item.hasSnap = flags.hasSnap;
          if (flags.hasThumb || flags.hasSnap) writtenKeys.add(key);
        } else {
          item.hasThumb = false;
          item.hasSnap = false;
        }
        item.thumbnail = '';
        item.snapshot = '';
      }
    }
  } catch (err) {
    try {
      await Media.removeMany([...writtenKeys]);
    } catch {
      // best effort rollback
    }
    throw err;
  }
  return writtenKeys;
}

function mediaKeysForItems(items) {
  const keys = new Set();
  for (const item of items || []) {
    for (const key of Media.keysForItem(item)) keys.add(key);
  }
  return keys;
}

async function cleanupOrphanMedia(items = null) {
  if (!Media?.removeOrphans) return [];
  const list = items || (await getParkedItems());
  const keep = new Set();
  for (const item of list) {
    if (item.kind === 'group') {
      for (const member of item.tabs || []) {
        if (member.hasThumb || member.hasSnap) keep.add(Media.mediaKeyMember(item.id, member.id));
      }
      for (const note of item.notes || []) {
        for (const attachment of note.attachments || []) {
          if (attachment.hasData) keep.add(Media.mediaKeyNoteAttachment(note.id, attachment.id));
        }
      }
    } else if (item.kind === 'note') {
      for (const attachment of item.attachments || []) {
        if (attachment.hasData) keep.add(Media.mediaKeyNoteAttachment(item.id, attachment.id));
      }
    } else if (item.hasThumb || item.hasSnap) {
      keep.add(Media.mediaKeyTab(item.id));
    }
  }
  try {
    return await Media.removeOrphans([...keep]);
  } catch (err) {
    console.warn('[TabWall] media orphan cleanup failed:', err);
    return [];
  }
}

/**
 * @param {object} backup
 * @param {{ mode?: 'replace' | 'append', importId?: string }} opts
 */
async function importBackup(backup, { mode = 'replace', importId = '' } = {}) {
  const prepared = Build?.prepareImportedBackup?.(backup);
  if (!prepared?.ok) return prepared || { ok: false, error: 'invalid_format' };
  backup = prepared.backup;
  const warnings = prepared.warnings || {};
  const stageId = importId ? String(importId) : '';
  if (stageId && !isValidImportStageId(stageId)) {
    return { ok: false, error: 'invalid_import_stage', warnings };
  }
  const validation = Build?.validateBackup?.(backup, {
    allowStoredOnlyUrls: Boolean(prepared.allowStoredOnlyUrls),
  });
  if (!validation?.ok) return { ...validation, warnings };
  const fail = (result) => ({ ...result, warnings });
  let items = [];
  if (Array.isArray(backup.parkedItems)) {
    items = backup.parkedItems.map(normalizeItem).filter(Boolean);
  } else if (Array.isArray(backup.parkedTabs)) {
    items = backup.parkedTabs.map((t) => normalizeTabItem(t));
  } else {
    return fail({ ok: false, error: 'invalid_tabs' });
  }

  const append = mode === 'append';
  const existing = await getParkedItems();
  const existingCanvasLayout = append ? await getCanvasLayout() : null;
  const incomingCanvasLayout = backup.canvasLayout;
  if (append) {
    items = remintItemIds(items);
  }

  let writtenKeys;
  let metadataCommitted = false;
  try {
    try {
      writtenKeys = stageId
        ? await persistStagedMediaToIdb(stageId, items)
        : await persistInlineMediaToIdb(items);
    } catch (err) {
      return fail({ ok: false, error: 'media_write_failed', detail: String(err?.message || err) });
    }

    const normalizedBackup = {
      ...backup,
      media: 'idb',
      parkedItems: items,
      canvasLayout: append ? undefined : backup.canvasLayout,
      parkedTabs: items
        .filter((item) => item.kind === 'tab')
        .map(({ kind, ...rest }) => rest),
    };
    const normalizedValidation = Build?.validateBackup?.(normalizedBackup, {
      allowStoredOnlyUrls: Boolean(prepared.allowStoredOnlyUrls),
    });
    if (!normalizedValidation?.ok) {
      await Media.removeMany([...writtenKeys]).catch(() => {});
      return fail(normalizedValidation);
    }
    const quota = await checkAttachmentQuota(
      append ? [...existing, ...items] : items,
      '',
      ''
    );
    if (!quota.ok) {
      await Media.removeMany([...writtenKeys]).catch(() => {});
      return fail(quota);
    }

    try {
      if (append) {
        const combined = [...existing, ...items];
        await setParkedItems(combined, {
          canvasLayout: mergeAppendedCanvasLayout(existingCanvasLayout, incomingCanvasLayout, items, combined),
          canvasInitialCenterMigrated: true,
        });
        metadataCommitted = true;
        const catalog = await getTagCatalog();
        const incoming = Array.isArray(backup.tagCatalog) ? backup.tagCatalog : [];
        await setTagCatalog([...catalog, ...incoming]);
        await cleanupOrphanMedia([...existing, ...items]);
        // Do not overwrite settings on append
        return { ok: true, mode: 'append', added: items.length, warnings };
      }

      const oldKeys = mediaKeysForItems(existing);
      const tagCatalog = Array.isArray(backup.tagCatalog) ? backup.tagCatalog : [];
      const importedSettings = backup.settings && typeof backup.settings === 'object'
        ? normalizeSettings(backup.settings)
        : undefined;
      await setParkedItems(items, {
        tagCatalog,
        settings: importedSettings,
        canvasLayout: backup.canvasLayout && typeof backup.canvasLayout === 'object'
          ? backup.canvasLayout
          : undefined,
        canvasInitialCenterMigrated: true,
      });
      metadataCommitted = true;
      const staleKeys = [...oldKeys].filter((key) => !writtenKeys.has(key));
      try {
        await Media.removeMany(staleKeys);
      } catch (err) {
        console.warn('[TabWall] replace media cleanup failed:', err);
      }
      await cleanupOrphanMedia(items);
      return { ok: true, mode: 'replace', added: items.length, warnings };
    } catch (err) {
      // Metadata was not committed when this branch fails before setParkedItems;
      // remove newly written blobs so a retry cannot inherit partial media.
      if (!metadataCommitted) {
        try {
          await Media.removeMany([...writtenKeys]);
        } catch {
          // best effort rollback
        }
      }
      return fail({ ok: false, error: 'import_commit_failed', detail: String(err?.message || err) });
    }
  } finally {
    if (stageId && Media?.removeImportStage) {
      try {
        await Media.removeImportStage(stageId);
      } catch (err) {
        console.warn('[TabWall] import stage cleanup failed:', err);
      }
    }
  }
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname || url;
  } catch {
    return url || 'Untitled';
  }
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Distinct placeholder for manually entered cards (thumb + full snap).
 * SVG data URL — works in service worker without canvas.
 */
function manualPlaceholderDataUrl({ title, url }) {
  const label = '手動輸入 · Manual';
  const t = escapeXml(String(title || 'URL').slice(0, 42));
  let host = '';
  try {
    host = new URL(url || '').hostname || '';
  } catch {
    host = '';
  }
  const sub = escapeXml((host || String(url || '')).slice(0, 48));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#334155"/>
    </pattern>
  </defs>
  <rect width="960" height="600" fill="url(#bg)"/>
  <rect width="960" height="600" fill="url(#dots)" opacity="0.55"/>
  <rect x="48" y="48" width="864" height="504" rx="28" fill="none" stroke="#60a5fa" stroke-width="3" stroke-dasharray="14 10" opacity="0.9"/>
  <rect x="360" y="168" width="240" height="72" rx="14" fill="#1d4ed8" opacity="0.35"/>
  <text x="480" y="214" text-anchor="middle" fill="#93c5fd" font-family="system-ui,-apple-system,sans-serif" font-size="28" font-weight="700">${escapeXml(label)}</text>
  <text x="480" y="300" text-anchor="middle" fill="#e2e8f0" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="600">${t}</text>
  <text x="480" y="348" text-anchor="middle" fill="#94a3b8" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="22">${sub}</text>
  <text x="480" y="500" text-anchor="middle" fill="#64748b" font-family="system-ui,-apple-system,sans-serif" font-size="18">no live screenshot</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function attachManualPlaceholders(items) {
  for (const item of items) {
    if (item.kind === 'group') {
      for (const m of item.tabs || []) {
        const dataUrl = manualPlaceholderDataUrl({
          title: m.title || titleFromUrl(m.url),
          url: m.url,
        });
        const flags = await Media.putFromDataUrls(
          Media.mediaKeyMember(item.id, m.id),
          dataUrl,
          dataUrl
        );
        m.hasThumb = flags.hasThumb;
        m.hasSnap = flags.hasSnap;
        m.thumbnail = '';
        m.snapshot = '';
      }
    } else {
      const dataUrl = manualPlaceholderDataUrl({
        title: item.title || titleFromUrl(item.url),
        url: item.url,
      });
      const flags = await Media.putFromDataUrls(Media.mediaKeyTab(item.id), dataUrl, dataUrl);
      item.hasThumb = flags.hasThumb;
      item.hasSnap = flags.hasSnap;
      item.thumbnail = '';
      item.snapshot = '';
    }
  }
}

/** Normalize a line into https URL or null. */
function parseUrlLine(line) {
  let s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;
  // strip common markdown link wrappers: [text](url) or <url>
  const md = s.match(/^\[[^\]]*\]\((https?:\/\/[^)\s]+)\)\s*$/i);
  if (md) s = md[1];
  const angle = s.match(/^<(https?:\/\/[^>]+)>\s*$/i);
  if (angle) s = angle[1];
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Parse bulk text into parked items.
 * #GROUP:Name ... #GROUP:Name wraps members into a group titled Name.
 */
function parseUrlTextToItems(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  let openGroup = null; // { title, tabs: [] }
  let skipped = 0;
  const now = Date.now();

  const flushGroup = () => {
    if (!openGroup) return;
    if (openGroup.tabs.length) {
      items.push(
        normalizeGroupItem({
          kind: 'group',
          title: openGroup.title,
          color: 'grey',
          savedAt: now,
          tabs: openGroup.tabs,
        })
      );
    }
    openGroup = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const gMatch = line.match(/^#GROUP:\s*(.+?)\s*$/i);
    if (gMatch) {
      const name = gMatch[1].trim();
      if (!name) {
        skipped++;
        continue;
      }
      if (openGroup && openGroup.title.toLowerCase() === name.toLowerCase()) {
        flushGroup();
      } else {
        if (openGroup) flushGroup();
        openGroup = { title: name, tabs: [] };
      }
      continue;
    }

    const url = parseUrlLine(line);
    if (!url) {
      skipped++;
      continue;
    }
    const member = {
      id: crypto.randomUUID(),
      url,
      title: titleFromUrl(url),
      favIconUrl: '',
      pinned: false,
      note: '',
      tags: [],
      hasThumb: false,
      hasSnap: false,
    };
    if (openGroup) {
      member.indexInGroup = openGroup.tabs.length;
      openGroup.tabs.push(member);
    } else {
      items.push(
        normalizeTabItem({
          kind: 'tab',
          url,
          title: titleFromUrl(url),
          savedAt: now,
        })
      );
    }
  }
  if (openGroup) flushGroup();
  return { items, skipped };
}

async function createFromUrlText(text) {
  const { items, skipped } = parseUrlTextToItems(text);
  if (!items.length) {
    return { ok: false, error: 'empty', added: 0, skipped };
  }
  await attachManualPlaceholders(items);
  const existing = await getParkedItems();
  await setParkedItems([...existing, ...items]);
  return { ok: true, added: items.length, skipped };
}

async function batchUpdateItems(ids, patch) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'empty_ids' };
  const idSet = new Set(ids);
  const list = await getParkedItems();
  const tagMode = patch.tagMode === 'replace' ? 'replace' : 'merge';
  let changed = 0;
  const next = list.map((item) => {
    if (!idSet.has(item.id)) return item;
    changed++;
    const updated = { ...item };
    if (typeof patch.note === 'string' && patch.note.length > 0) {
      if (item.kind === 'note') updated.markdown = patch.note;
      else updated.note = patch.note;
    }
    if (Array.isArray(patch.tags)) {
      const incoming = patch.tags
        .map((t) => String(t).trim())
        .filter(Boolean)
        .filter((t, i, arr) => arr.indexOf(t) === i);
      if (tagMode === 'replace') updated.tags = incoming;
      else updated.tags = [...new Set([...(item.tags || []), ...incoming])];
    }
    return updated;
  });
  if (changed) {
    if (Array.isArray(patch.tags)) await mergeTagsIntoCatalog(patch.tags);
    await setParkedItems(next);
  }
  return { ok: true, updated: changed, items: next };
}

async function batchDeleteItems(ids) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'empty_ids' };
  const idSet = new Set(ids);
  const list = await getParkedItems();
  const removed = list.filter((i) => idSet.has(i.id));
  const next = list.filter((i) => !idSet.has(i.id));
  await setParkedItems(next);
  try {
    await Media.removeMany(removed.flatMap((item) => Media.keysForItem(item)));
  } catch (err) {
    console.warn('[TabWall] batch media remove deferred:', err);
  }
  return { ok: true, remaining: next.length };
}

// ─── Image compression → Blob ──────────────────────────────────────

async function compressToBlob(dataUrl, opts = {}) {
  const maxWidth = opts.maxWidth ?? null;
  const quality = opts.quality ?? 0.5;
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  let width = bitmap.width;
  let height = bitmap.height;
  if (maxWidth && width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('OffscreenCanvas 2D context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

async function compressDataUrlToBlobs(dataUrl, { tiny = false } = {}) {
  const response = await fetch(dataUrl);
  const sourceBlob = await response.blob();
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const toBlob = async (opts) => {
      const maxWidth = opts.maxWidth ?? null;
      const quality = opts.quality ?? 0.5;
      let width = bitmap.width;
      let height = bitmap.height;
      if (maxWidth && width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
      ctx.drawImage(bitmap, 0, 0, width, height);
      return canvas.convertToBlob({ type: 'image/jpeg', quality });
    };
    const [thumbBlob, snapBlob] = await Promise.all([
      toBlob(tiny ? TINY : THUMB),
      toBlob(SNAPSHOT),
    ]);
    return { thumbBlob, snapBlob };
  } finally {
    bitmap.close();
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  const blocked = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'devtools://',
    'view-source:',
    'chrome-search://',
    'chrome-untrusted://',
    'brave://',
  ];
  if (blocked.some((p) => lower.startsWith(p))) return true;
  try {
    const u = new URL(url);
    if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return true;
    if (u.hostname === 'chromewebstore.google.com') return true;
  } catch {
    return true;
  }
  return false;
}

function isRestorableUrl(url) {
  const status = Build?.classifyUrl?.(url) || (/^https?:\/\//i.test(url) ? 'restorable' : 'invalid');
  return !isRestrictedUrl(url) && status === 'restorable';
}

const PARKED_BADGE_TEXT = '✓';
const PARKED_BADGE_COLOR = '#16a34a';

async function refreshTabBadge(tabOrId) {
  let tab = tabOrId;
  if (typeof tabOrId === 'number') {
    try {
      tab = await chrome.tabs.get(tabOrId);
    } catch {
      return;
    }
  }
  const tabId = tab?.id;
  if (tabId == null) return;

  const items = await getParkedItemsRaw();
  const parked = hasParkedTabUrl(tab.url, items);
  if (parked) {
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: PARKED_BADGE_COLOR,
    });
  }
  await chrome.action.setBadgeText({
    tabId,
    text: parked ? PARKED_BADGE_TEXT : '',
  });
}

async function refreshActiveTabBadge() {
  return refreshTabBadge(await getActiveTab());
}

async function flashBadge(text, color = '#ef4444', ms = 2000) {
  try {
    const tab = await getActiveTab();
    const target = tab?.id != null ? { tabId: tab.id } : {};
    await chrome.action.setBadgeBackgroundColor({ ...target, color });
    await chrome.action.setBadgeText({ ...target, text });
    setTimeout(() => {
      const restore = tab?.id != null
        ? refreshTabBadge(tab.id)
        : refreshActiveTabBadge();
      restore.catch(() => {});
    }, ms);
  } catch {
    // ignore
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function getParkPageUrl(surface = '') {
  const url = chrome.runtime.getURL(PARK_PAGE_PATH);
  return surface ? `${url}?surface=${encodeURIComponent(surface)}` : url;
}

function isOwnParkPageUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  const base = getParkPageUrl();
  return url === base || url.startsWith(`${base}?`);
}

async function openStandaloneParkTab() {
  const url = getParkPageUrl(STANDALONE_SURFACE);
  try {
    const matches = await chrome.tabs.query({ url });
    const existing = (matches || []).find((tab) => tab?.id != null);
    if (existing) {
      try {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId != null && chrome.windows?.update) {
          try {
            await chrome.windows.update(existing.windowId, { focused: true });
          } catch {
            // The tab can still be activated when its window cannot be focused.
          }
        }
        return { ok: true, mode: 'standalone', reused: true, tabId: existing.id };
      } catch {
        // The matching tab may have closed between query and update; create a new one.
      }
    }
    const created = await chrome.tabs.create({ url, active: true });
    return { ok: true, mode: 'standalone', created: true, tabId: created?.id ?? null };
  } catch (err) {
    console.warn('[TabWall] standalone page open failed:', err);
    await flashBadge('!');
    return { ok: false, error: String(err?.message || err) };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitTabComplete(tabId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        await sleep(120);
        return tab;
      }
    } catch {
      return null;
    }
    await sleep(100);
  }
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch {
    // inject
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return true;
  } catch (err) {
    console.warn('[TabWall] inject content failed:', err);
    return false;
  }
}

async function sendToTab(tabId, message) {
  const ok = await ensureContentScript(tabId);
  if (!ok) throw new Error('inject_failed');
  return chrome.tabs.sendMessage(tabId, message);
}

async function toggleParkOnActiveTab() {
  const tab = await getActiveTab();
  if (tab?.url && isOwnParkPageUrl(tab.url)) {
    return { ok: true, mode: 'already-open', tabId: tab.id ?? null };
  }
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    return openStandaloneParkTab();
  }
  try {
    await sendToTab(tab.id, { type: 'TOGGLE_PARK' });
    return { ok: true, mode: 'overlay', tabId: tab.id };
  } catch (err) {
    console.warn('[TabWall] inject/toggle failed:', err);
    return openStandaloneParkTab();
  }
}

async function openParkOnActiveTab() {
  const tab = await getActiveTab();
  if (tab?.url && isOwnParkPageUrl(tab.url)) {
    return { ok: true, mode: 'already-open', tabId: tab.id ?? null };
  }
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    return openStandaloneParkTab();
  }
  if (await openParkOnTab(tab.id)) {
    return { ok: true, mode: 'overlay', tabId: tab.id };
  }
  return openStandaloneParkTab();
}

async function openParkOnTab(tabId, extraMessage = null) {
  try {
    await sendToTab(tabId, { type: 'OPEN_PARK' });
    if (extraMessage) {
      // allow iframe to boot
      await sleep(120);
      await sendToTab(tabId, extraMessage);
    }
    return true;
  } catch (err) {
    console.warn('[TabWall] openPark failed:', err);
    return false;
  }
}

async function captureTabBlobs(windowId, tabId, { tiny = false } = {}) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await waitTabComplete(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    return await compressDataUrlToBlobs(dataUrl, { tiny });
  } catch (err) {
    console.warn('[TabWall] capture failed for tab', tabId, err);
    return { thumbBlob: null, snapBlob: null };
  }
}

// ─── Dedup helpers ─────────────────────────────────────────────────

const PENDING_CONFLICT_KEY = 'pendingSaveConflict';
const PENDING_TTL_MS = 10 * 60 * 1000;
const RESTORE_HINTS_KEY = 'restoreSaveHints';

/** Exact URL key (full string including query/hash). */
function normalizeUrlKey(url) {
  return typeof url === 'string' ? url : '';
}

function hasParkedTabUrl(url, items) {
  const key = normalizeUrlKey(url);
  if (!key) return false;
  return (items || []).some((item) => {
    if (!item) return false;
    if (item.kind === 'tab') return normalizeUrlKey(item.url) === key;
    if (item.kind !== 'group') return false;
    return (item.tabs || []).some((member) => normalizeUrlKey(member?.url) === key);
  });
}

function tabMatchSummary(item) {
  return {
    id: item.id,
    kind: 'tab',
    title: item.title || item.url || 'Untitled',
    url: item.url || '',
    savedAt: item.savedAt || 0,
    hasThumb: Boolean(item.hasThumb),
    hasSnap: Boolean(item.hasSnap),
    note: item.note || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
  };
}

function findTabDuplicates(url, items) {
  const key = normalizeUrlKey(url);
  if (!key) return [];
  return (items || [])
    .filter((i) => i && i.kind === 'tab' && normalizeUrlKey(i.url) === key)
    .map(tabMatchSummary);
}

function scanDuplicateClusters(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item || item.kind !== 'tab') continue;
    const key = normalizeUrlKey(item.url);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tabMatchSummary(item));
  }
  const clusters = [];
  for (const [url, list] of map.entries()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    clusters.push({ url, items: list });
  }
  clusters.sort((a, b) => b.items.length - a.items.length);
  return clusters;
}

async function setPendingConflict(pending) {
  const payload = { ...pending, createdAt: Date.now() };
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ [PENDING_CONFLICT_KEY]: payload });
    } else {
      await chrome.storage.local.set({ [PENDING_CONFLICT_KEY]: payload });
    }
  } catch {
    await chrome.storage.local.set({ [PENDING_CONFLICT_KEY]: payload });
  }
  return payload;
}

async function getPendingConflict() {
  let data = {};
  try {
    if (chrome.storage.session) {
      data = await chrome.storage.session.get(PENDING_CONFLICT_KEY);
    }
  } catch {
    data = {};
  }
  if (!data[PENDING_CONFLICT_KEY]) {
    data = await chrome.storage.local.get(PENDING_CONFLICT_KEY);
  }
  const pending = data[PENDING_CONFLICT_KEY];
  if (!pending || typeof pending !== 'object') return null;
  if (Date.now() - (pending.createdAt || 0) > PENDING_TTL_MS) {
    await clearPendingConflict();
    return null;
  }
  return pending;
}

async function clearPendingConflict() {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.remove(PENDING_CONFLICT_KEY);
    }
  } catch {
    // ignore
  }
  await chrome.storage.local.remove(PENDING_CONFLICT_KEY);
}

function normalizeRestoreHint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'group' ? 'group' : 'tab';
  if (kind === 'group') {
    const groupId = Number(raw.groupId);
    if (!Number.isInteger(groupId) || groupId < 0) return null;
    return {
      kind,
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      groupId,
      note: safeText(raw.note, DATA_LIMITS.MAX_NOTE_LENGTH),
      tags: normalizeTags(raw.tags),
    };
  }
  const url = safeText(raw.url, DATA_LIMITS.MAX_URL_LENGTH);
  if (!url) return null;
  return {
    kind,
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    url,
    note: safeText(raw.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(raw.tags),
  };
}

async function getRestoreHints() {
  let data = {};
  try {
    if (chrome.storage.session) {
      data = await chrome.storage.session.get(RESTORE_HINTS_KEY);
    }
  } catch {
    data = {};
  }
  if (!data[RESTORE_HINTS_KEY]) {
    data = await chrome.storage.local.get(RESTORE_HINTS_KEY);
  }
  return Array.isArray(data[RESTORE_HINTS_KEY])
    ? data[RESTORE_HINTS_KEY].map(normalizeRestoreHint).filter(Boolean)
    : [];
}

async function setRestoreHints(hints) {
  const cleaned = (Array.isArray(hints) ? hints : [])
    .map(normalizeRestoreHint)
    .filter(Boolean);
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ [RESTORE_HINTS_KEY]: cleaned });
      return;
    }
  } catch {
    // Fall back to local storage when session storage is unavailable.
  }
  await chrome.storage.local.set({ [RESTORE_HINTS_KEY]: cleaned });
}

function restoreHintForItem(item) {
  const hint = normalizeRestoreHint(item);
  return hint ? { ...hint, id: crypto.randomUUID() } : null;
}

function restoreGroupHintForItem(groupId, item) {
  const hint = normalizeRestoreHint({
    kind: 'group',
    groupId,
    note: item?.note,
    tags: item?.tags,
  });
  return hint ? { ...hint, id: crypto.randomUUID() } : null;
}

async function rememberRestoreHints(items) {
  const additions = (Array.isArray(items) ? items : [])
    .map(restoreHintForItem)
    .filter(Boolean);
  if (!additions.length) return;
  const hints = await getRestoreHints();
  await setRestoreHints([...hints, ...additions]);
}

async function rememberRestoreGroupHint(groupId, item) {
  const addition = restoreGroupHintForItem(groupId, item);
  if (!addition) return;
  const hints = await getRestoreHints();
  const next = hints.filter(
    (hint) => !(hint.kind === 'group' && hint.groupId === addition.groupId)
  );
  await setRestoreHints([...next, addition]);
}

async function findRestoreHint(url) {
  const key = normalizeUrlKey(url);
  if (!key) return null;
  const hints = await getRestoreHints();
  for (let i = hints.length - 1; i >= 0; i--) {
    if (hints[i].kind !== 'group' && normalizeUrlKey(hints[i].url) === key) {
      return hints[i];
    }
  }
  return null;
}

async function findRestoreGroupHint(groupId) {
  const key = Number(groupId);
  if (!Number.isInteger(key) || key < 0) return null;
  const hints = await getRestoreHints();
  for (let i = hints.length - 1; i >= 0; i--) {
    if (hints[i].kind === 'group' && hints[i].groupId === key) {
      return hints[i];
    }
  }
  return null;
}

async function consumeRestoreHint(id) {
  if (!id) return;
  const hints = await getRestoreHints();
  const index = hints.findIndex((hint) => hint.id === id);
  if (index === -1) return;
  hints.splice(index, 1);
  await setRestoreHints(hints);
}

async function deleteTabItemsByIds(ids) {
  if (!ids?.length) return 0;
  const idSet = new Set(ids);
  const list = await getParkedItems();
  const removed = list.filter((i) => idSet.has(i.id) && i.kind === 'tab');
  const next = list.filter((i) => !idSet.has(i.id));
  await setParkedItems(next);
  try {
    await Media.removeMany(removed.flatMap((item) => Media.keysForItem(item)));
  } catch (err) {
    console.warn('[TabWall] media remove deferred:', err);
  }
  return removed.length;
}

// ─── Save tab ──────────────────────────────────────────────────────

function autoSaveMetadataSource(tabLike, field) {
  if (field === 'title') return typeof tabLike?.title === 'string' ? tabLike.title : '';
  try {
    return new URL(String(tabLike?.url || '')).hostname;
  } catch {
    return '';
  }
}

function matchesAutoSaveCondition(tabLike, rawCondition) {
  const condition = normalizeAutoSaveCondition(rawCondition);
  const source = autoSaveMetadataSource(tabLike, condition.field);
  const value = condition.value;
  if (!source || !value) return false;

  let matched = false;
  if (condition.operator === 'regex') {
    try {
      matched = new RegExp(value, 'i').test(source);
    } catch {
      return false;
    }
  } else {
    const sourceLower = source.toLowerCase();
    const valueLower = value.toLowerCase();
    if (condition.operator === 'contains') matched = sourceLower.includes(valueLower);
    else if (condition.operator === 'startsWith') matched = sourceLower.startsWith(valueLower);
    else if (condition.operator === 'endsWith') matched = sourceLower.endsWith(valueLower);
    else matched = sourceLower === valueLower;
  }
  return condition.negate ? !matched : matched;
}

function matchesAutoSaveRule(tabLike, rawRule) {
  const rule = normalizeAutoSaveRule(rawRule);
  if (!rule.enabled || !rule.conditions.length) return false;
  const results = rule.conditions.map((condition) => matchesAutoSaveCondition(tabLike, condition));
  return rule.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

function appendUniqueAutoSaveNote(baseNote, additions) {
  let note = safeText(baseNote, DATA_LIMITS.MAX_NOTE_LENGTH);
  const seen = new Set(
    note
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  for (const addition of additions || []) {
    for (const line of String(addition || '').split(/\r?\n/)) {
      const value = line.trim();
      if (!value || seen.has(value)) continue;
      if (note && !note.endsWith('\n')) note += '\n';
      note += value;
      seen.add(value);
    }
  }
  return note.slice(0, DATA_LIMITS.MAX_NOTE_LENGTH);
}

function applyAutoSaveMetadata(tabLike, base = {}, rawSettings = DEFAULT_AUTO_SAVE_METADATA) {
  const metadata = normalizeAutoSaveMetadata(rawSettings);
  let note = safeText(base.note, DATA_LIMITS.MAX_NOTE_LENGTH);
  let tags = normalizeTags(base.tags);
  if (!metadata.enabled) return { note, tags };

  const matchedNotes = [];
  for (const rule of metadata.rules) {
    if (!matchesAutoSaveRule(tabLike, rule)) continue;
    if (rule.note) matchedNotes.push(rule.note);
    tags = normalizeTags([...tags, ...rule.tags]);
  }
  note = appendUniqueAutoSaveNote(note, matchedNotes);
  return { note, tags };
}

function normalizeAfterSaveMode(value, fallback = 'close') {
  if (value === 'keep' || value === 'close') return value;
  return fallback === 'keep' ? 'keep' : 'close';
}

/**
 * Commit a parked tab from a live chrome.tabs Tab (or pending snapshot fields).
 * @param {object} tabLike - { id?, windowId?, url, title, favIconUrl }
 * @param {{ replaceMatchIds?: string[], afterSave?: 'keep'|'close' }} opts
 */
async function commitSaveTab(tabLike, opts = {}) {
  const replaceMatchIds = opts.replaceMatchIds || [];
  const restoreHint = await findRestoreHint(tabLike.url);
  const settings = await getSettings();
  const metadata = applyAutoSaveMetadata(
    tabLike,
    {
      note: restoreHint?.note || '',
      tags: restoreHint?.tags || [],
    },
    settings.autoSaveMetadata
  );
  if (replaceMatchIds.length) {
    await deleteTabItemsByIds(replaceMatchIds);
  }

  let dataUrl = null;
  if (tabLike.windowId != null) {
    try {
      if (tabLike.id != null) {
        try {
          await chrome.tabs.update(tabLike.id, { active: true });
        } catch {
          // ignore
        }
      }
      dataUrl = await chrome.tabs.captureVisibleTab(tabLike.windowId, { format: 'png' });
    } catch (err) {
      console.warn('[TabWall] captureVisibleTab failed:', err);
    }
  }

  let thumbBlob = null;
  let snapBlob = null;
  if (dataUrl) {
    try {
      ({ thumbBlob, snapBlob } = await compressDataUrlToBlobs(dataUrl));
    } catch (err) {
      console.warn('[TabWall] compress failed:', err);
    }
  }

  const id = crypto.randomUUID();
  let hasThumb = false;
  let hasSnap = false;
  try {
    const flags = await Media.putFromBlobs(Media.mediaKeyTab(id), thumbBlob, snapBlob);
    hasThumb = flags.hasThumb;
    hasSnap = flags.hasSnap;
  } catch (err) {
    console.warn('[TabWall] media put failed:', err);
  }

  const entry = {
    kind: 'tab',
    id,
    url: tabLike.url || '',
    title: tabLike.title || tabLike.url || 'Untitled',
    favIconUrl: tabLike.favIconUrl || '',
    pinned: false,
    note: metadata.note,
    tags: metadata.tags,
    savedAt: Date.now(),
    hasThumb,
    hasSnap,
  };

  const list = await getParkedItems();
  list.unshift(entry);
  await setParkedItems(list);
  await mergeTagsIntoCatalog(entry.tags);
  try {
    await consumeRestoreHint(restoreHint?.id);
  } catch (err) {
    console.warn('[TabWall] restore hint cleanup failed:', err);
  }

  const afterSave = normalizeAfterSaveMode(opts.afterSave, settings.afterSave);
  if (afterSave === 'close' && tabLike.id != null) {
    try {
      await chrome.tabs.remove(tabLike.id);
    } catch (err) {
      console.warn('[TabWall] tabs.remove failed:', err);
    }
  }
  await flashBadge(String(Math.min(list.length, 99)), '#3b82f6', 1500);
  return { ok: true, id, remaining: list.length };
}

async function saveCurrentTab(tab, opts = {}) {
  if (!beginAction('save-tab')) return { ok: false, error: 'debounced' };
  try {
    if (!tab || tab.id == null) {
      await flashBadge('!');
      return { ok: false, error: 'no_tab' };
    }
    if (isRestrictedUrl(tab.url)) {
      await flashBadge('!');
      return { ok: false, error: 'restricted_url' };
    }

    const settings = await getSettings();
    const afterSave = normalizeAfterSaveMode(opts.afterSave, settings.afterSave);
    const items = await getParkedItems();
    const matches = findTabDuplicates(tab.url, items);
    if (matches.length > 0) {
      const pending = await setPendingConflict({
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title || tab.url || 'Untitled',
        favIconUrl: tab.favIconUrl || '',
        matches,
        afterSave,
      });
      await flashBadge('?', '#f59e0b', 2500);
      const hostTabId = tab.id;
      await openParkOnTab(hostTabId, {
        type: 'SHOW_SAVE_CONFLICT',
        conflict: {
          url: pending.url,
          title: pending.title,
          favIconUrl: pending.favIconUrl,
          matches: pending.matches,
        },
      });
      return { ok: true, conflict: true, matchCount: matches.length };
    }

    return await commitSaveTab(tab, { afterSave });
  } catch (err) {
    console.warn('[TabWall] saveCurrentTab failed:', err);
    await flashBadge('!');
    return { ok: false, error: String(err) };
  }
}

async function saveActiveTab(opts = {}) {
  const tab = await getActiveTab();
  if (isOwnParkPageUrl(tab?.url)) {
    await flashBadge('!');
    return { ok: false, error: 'self_tab' };
  }
  return saveCurrentTab(tab, opts);
}

async function resolveSaveConflict(decision) {
  const pending = await getPendingConflict();
  if (!pending) {
    return { ok: false, error: 'no_pending' };
  }
  if (decision === 'cancel') {
    await clearPendingConflict();
    return { ok: true, cancelled: true };
  }

  const tabLike = {
    id: pending.tabId,
    windowId: pending.windowId,
    url: pending.url,
    title: pending.title,
    favIconUrl: pending.favIconUrl,
  };

  // Verify tab still exists; if closed, still save URL meta without capture window
  if (pending.tabId != null) {
    try {
      const live = await chrome.tabs.get(pending.tabId);
      tabLike.windowId = live.windowId;
      tabLike.url = live.url || tabLike.url;
      tabLike.title = live.title || tabLike.title;
      tabLike.favIconUrl = live.favIconUrl || tabLike.favIconUrl;
    } catch {
      tabLike.id = null;
      tabLike.windowId = null;
    }
  }

  const replaceMatchIds =
    decision === 'replace' ? (pending.matches || []).map((m) => m.id) : [];

  // Avoid debounce blocking the follow-up commit
  actionLocks.delete('save-tab');
  const result = await commitSaveTab(tabLike, {
    replaceMatchIds,
    afterSave: pending.afterSave,
  });
  await clearPendingConflict();
  return result;
}

async function applyDedupe(ops) {
  if (!Array.isArray(ops) || !ops.length) {
    return { ok: false, error: 'no_ops' };
  }
  const list = await getParkedItems();
  const toDelete = new Set();
  for (const op of ops) {
    const url = normalizeUrlKey(op.url);
    const keep = new Set(Array.isArray(op.keepIds) ? op.keepIds : []);
    if (!url || keep.size === 0) continue;
    for (const item of list) {
      if (item.kind !== 'tab') continue;
      if (normalizeUrlKey(item.url) !== url) continue;
      if (!keep.has(item.id)) toDelete.add(item.id);
    }
  }
  if (toDelete.size === 0) {
    return { ok: true, deleted: 0, items: list };
  }
  const deleted = await deleteTabItemsByIds([...toDelete]);
  const next = await getParkedItems();
  return { ok: true, deleted, items: next };
}

// ─── Stack / merge parked items into groups ────────────────────────

async function rekeyMedia(oldKey, newKey, mediaState = null) {
  if (!oldKey || !newKey || oldKey === newKey) return;
  const row = await Media.get(oldKey);
  if (row?.thumb || row?.snap) {
    await Media.put(newKey, { thumb: row.thumb || null, snap: row.snap || null });
    mediaState?.created?.add(newKey);
  }
}

async function tabItemToMember(tabItem, groupId, indexInGroup, mediaState) {
  const memberId = crypto.randomUUID();
  const oldKey = Media.mediaKeyTab(tabItem.id);
  const newKey = Media.mediaKeyMember(groupId, memberId);
  await rekeyMedia(oldKey, newKey, mediaState);
  return {
    id: memberId,
    url: tabItem.url || '',
    title: tabItem.title || tabItem.url || 'Untitled',
    favIconUrl: tabItem.favIconUrl || '',
    pinned: false,
    indexInGroup,
    note: typeof tabItem.note === 'string' ? tabItem.note : '',
    tags: Array.isArray(tabItem.tags) ? tabItem.tags : [],
    hasThumb: Boolean(tabItem.hasThumb),
    hasSnap: Boolean(tabItem.hasSnap),
  };
}

async function rekeyGroupMembers(group, newGroupId, startIndex, mediaState) {
  const members = [];
  let idx = startIndex;
  for (const m of group.tabs || []) {
    const memberId = crypto.randomUUID();
    if (group.id !== newGroupId) {
      await rekeyMedia(
        Media.mediaKeyMember(group.id, m.id),
        Media.mediaKeyMember(newGroupId, memberId),
        mediaState
      );
    }
    members.push({
      id: memberId,
      url: m.url || '',
      title: m.title || m.url || 'Untitled',
      favIconUrl: m.favIconUrl || '',
      pinned: Boolean(m.pinned),
      indexInGroup: idx++,
      note: typeof m.note === 'string' ? m.note : '',
      tags: Array.isArray(m.tags) ? m.tags : [],
      hasThumb: Boolean(m.hasThumb),
      hasSnap: Boolean(m.hasSnap),
    });
  }
  return members;
}

function replaceListKeepingOrder(list, removeIds, insertAtId, insertItem) {
  const remove = new Set(removeIds);
  const next = [];
  let inserted = false;
  for (const item of list) {
    if (remove.has(item.id)) {
      if (item.id === insertAtId && !inserted) {
        next.push(insertItem);
        inserted = true;
      }
      continue;
    }
    next.push(item);
  }
  if (!inserted) next.unshift(insertItem);
  return next;
}

/**
 * Stack source onto target (iOS-folder style).
 * tab+tab → new group; tab+group / group+tab → add tab; group+group → merge into target.
 */
async function stackItems(sourceId, targetId, options = {}) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return { ok: false, error: 'invalid_ids' };
  }
  const list = await getParkedItems();
  const source = list.find((i) => i.id === sourceId);
  const target = list.find((i) => i.id === targetId);
  if (!source || !target) return { ok: false, error: 'not_found' };
  const canvasBefore = await getCanvasLayout();

  const srcGroup = source.kind === 'group';
  const tgtGroup = target.kind === 'group';
  const mediaState = { created: new Set() };
  const obsoleteMediaKeys = new Set();
  const markObsolete = (item) => {
    for (const key of Media.keysForItem(item)) {
      // Note attachments keep their note id when a note moves into a Stack.
      if (!key.startsWith('n:')) obsoleteMediaKeys.add(key);
    }
  };
  const finalize = async (next, groupId, anchors, removedIds) => {
    await commitItemsAndCanvas(
      next,
      remapCanvasLayout(canvasBefore, removedIds, groupId, anchors),
    );
    if (!options.deferMediaCleanup) {
      try {
        await Media.removeMany([...obsoleteMediaKeys]);
      } catch (err) {
        appLogPush('warn', 'stack', 'old media cleanup deferred', err?.message || err);
      }
    }
  };

  try {
    // tab/note → tab/note : create a mixed Canvas/Chrome Stack.
    if (!srcGroup && !tgtGroup) {
      const groupId = crypto.randomUUID();
      markObsolete(source);
      markObsolete(target);
      const tabs = [];
      const notes = [];
      if (target.kind === 'tab') tabs.push(await tabItemToMember(target, groupId, tabs.length, mediaState));
      else if (target.kind === 'note') notes.push(target);
      if (source.kind === 'tab') tabs.push(await tabItemToMember(source, groupId, tabs.length, mediaState));
      else if (source.kind === 'note') notes.push(source);
      const group = {
        kind: 'group',
        id: groupId,
        title: target.title || source.title || '',
        color: 'grey',
        collapsed: false,
        pinned: false,
        note: '',
        tags: [],
        savedAt: Date.now(),
        tabs,
        notes,
      };
      const next = replaceListKeepingOrder(list, [sourceId, targetId], targetId, group);
      await finalize(next, groupId, [targetId, sourceId], [sourceId, targetId]);
      return { ok: true, items: next, groupId };
    }

    // tab → group : add tab into group
    if (!srcGroup && tgtGroup) {
      markObsolete(source);
      const updated = source.kind === 'note'
        ? {
            ...target,
            notes: [...(target.notes || []), source],
            savedAt: Date.now(),
          }
        : {
            ...target,
            tabs: [
              ...(target.tabs || []),
              await tabItemToMember(source, target.id, (target.tabs || []).length, mediaState),
            ],
            savedAt: Date.now(),
          };
      const next = list
        .map((i) => (i.id === target.id ? updated : i))
        .filter((i) => i.id !== source.id);
      await finalize(next, target.id, [target.id, sourceId], [sourceId]);
      return { ok: true, items: next, groupId: target.id };
    }

    // group → tab : add tab into group, place group where tab was
    if (srcGroup && !tgtGroup) {
      markObsolete(target);
      const updated = target.kind === 'note'
        ? {
            ...source,
            notes: [...(source.notes || []), target],
            savedAt: Date.now(),
          }
        : {
            ...source,
            tabs: [
              ...(source.tabs || []),
              await tabItemToMember(target, source.id, (source.tabs || []).length, mediaState),
            ],
            savedAt: Date.now(),
          };
      const next = replaceListKeepingOrder(list, [sourceId, targetId], targetId, updated);
      await finalize(next, source.id, [source.id, targetId], [targetId]);
      return { ok: true, items: next, groupId: source.id };
    }

    // group → group : merge source members into target
    if (srcGroup && tgtGroup) {
      markObsolete(source);
      const extra = await rekeyGroupMembers(source, target.id, (target.tabs || []).length, mediaState);
      const updated = {
        ...target,
        tabs: [...(target.tabs || []), ...extra],
        notes: [...(target.notes || []), ...(source.notes || [])],
        savedAt: Date.now(),
      };
      const next = list
        .map((i) => (i.id === target.id ? updated : i))
        .filter((i) => i.id !== source.id);
      await finalize(next, target.id, [target.id, sourceId], [sourceId]);
      return { ok: true, items: next, groupId: target.id };
    }

    return { ok: false, error: 'unsupported' };
  } catch (err) {
    try {
      await Media.removeMany([...mediaState.created]);
    } catch {
      // best effort rollback of copied media
    }
    console.warn('[TabWall] stackItems failed:', err);
    return { ok: false, error: String(err) };
  }
}

async function createStack(ids, title = '') {
  const uniqueIds = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
  if (uniqueIds.length < 2) return { ok: false, error: 'need_two_items' };
  const initial = await getParkedItems();
  if (uniqueIds.some((id) => !initial.some((item) => item.id === id))) {
    return { ok: false, error: 'not_found' };
  }
  const initialLayout = await getCanvasLayout();
  const mediaState = { created: new Set() };
  const obsoleteMediaKeys = new Set();
  const markObsolete = (item) => {
    for (const key of Media.keysForItem(item)) {
      if (!key.startsWith('n:')) obsoleteMediaKeys.add(key);
    }
  };

  try {
    let workingLayout = initialLayout;
    let list = initial;
    let targetId = uniqueIds[0];
    for (const sourceId of uniqueIds.slice(1)) {
      const source = list.find((item) => item.id === sourceId);
      const target = list.find((item) => item.id === targetId);
      if (!source || !target || source.id === target.id) return { ok: false, error: 'not_found' };
      const srcGroup = source.kind === 'group';
      const tgtGroup = target.kind === 'group';
      let next;
      let groupId;
      let anchors;
      let removedIds;

      if (!srcGroup && !tgtGroup) {
        groupId = crypto.randomUUID();
        markObsolete(source);
        markObsolete(target);
        const tabs = [];
        const notes = [];
        if (target.kind === 'tab') tabs.push(await tabItemToMember(target, groupId, tabs.length, mediaState));
        else if (target.kind === 'note') notes.push(target);
        if (source.kind === 'tab') tabs.push(await tabItemToMember(source, groupId, tabs.length, mediaState));
        else if (source.kind === 'note') notes.push(source);
        const group = {
          kind: 'group', id: groupId, title: target.title || source.title || '', color: 'grey',
          collapsed: false, pinned: false, note: '', tags: [], savedAt: Date.now(),
          tabs,
          notes,
        };
        next = replaceListKeepingOrder(list, [source.id, target.id], target.id, group);
        anchors = [target.id, source.id];
        removedIds = [source.id, target.id];
      } else if (!srcGroup && tgtGroup) {
        groupId = target.id;
        markObsolete(source);
        const updated = source.kind === 'note'
          ? { ...target, notes: [...(target.notes || []), source], savedAt: Date.now() }
          : {
              ...target,
              tabs: [
                ...(target.tabs || []),
                await tabItemToMember(source, groupId, (target.tabs || []).length, mediaState),
              ],
              savedAt: Date.now(),
            };
        next = list.map((item) => (item.id === target.id ? updated : item)).filter((item) => item.id !== source.id);
        anchors = [target.id, source.id];
        removedIds = [source.id];
      } else if (srcGroup && !tgtGroup) {
        groupId = source.id;
        markObsolete(target);
        const updated = target.kind === 'note'
          ? { ...source, notes: [...(source.notes || []), target], savedAt: Date.now() }
          : {
              ...source,
              tabs: [
                ...(source.tabs || []),
                await tabItemToMember(target, groupId, (source.tabs || []).length, mediaState),
              ],
              savedAt: Date.now(),
            };
        next = replaceListKeepingOrder(list, [source.id, target.id], target.id, updated);
        anchors = [source.id, target.id];
        removedIds = [target.id];
      } else if (srcGroup && tgtGroup) {
        groupId = target.id;
        markObsolete(source);
        const extra = await rekeyGroupMembers(source, groupId, (target.tabs || []).length, mediaState);
        const updated = {
          ...target,
          tabs: [...(target.tabs || []), ...extra],
          notes: [...(target.notes || []), ...(source.notes || [])],
          savedAt: Date.now(),
        };
        next = list.map((item) => (item.id === target.id ? updated : item)).filter((item) => item.id !== source.id);
        anchors = [target.id, source.id];
        removedIds = [source.id];
      } else {
        return { ok: false, error: 'unsupported' };
      }

      workingLayout = remapCanvasLayout(workingLayout, removedIds, groupId, anchors);
      list = next;
      targetId = groupId;
    }

    const target = list.find((item) => item.id === targetId);
    if (!target) return { ok: false, error: 'not_found' };
    const nextTitle = safeText(title, DATA_LIMITS.MAX_TITLE_LENGTH).trim() || '新 Stack';
    const next = list.map((item) => (item.id === targetId ? { ...item, title: nextTitle } : item));
    // Metadata and the final canvas layout are committed together. If this
    // write fails, no partial multi-select result is observable.
    await commitItemsAndCanvas(next, workingLayout);
    await cleanupOrphanMedia(next);
    return { ok: true, groupId: targetId, item: next.find((item) => item.id === targetId) };
  } catch (err) {
    try {
      await Media.removeMany([...mediaState.created]);
    } catch {
      // best effort rollback of copied media
    }
    console.warn('[TabWall] CREATE_STACK failed:', err);
    return { ok: false, error: String(err) };
  }
}

// ─── Save group ────────────────────────────────────────────────────

async function saveActiveGroup(opts = {}) {
  if (!beginAction('save-group')) return { ok: false, error: 'debounced' };
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      await flashBadge('!');
      return { ok: false, error: 'no_tab' };
    }

    const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1;
    if (tab.groupId == null || tab.groupId === none) {
      await flashBadge('!');
      return { ok: false, error: 'not_in_group' };
    }

    let meta;
    try {
      meta = await chrome.tabGroups.get(tab.groupId);
    } catch (err) {
      console.warn('[TabWall] tabGroups.get failed:', err);
      await flashBadge('!');
      return { ok: false, error: 'group_get_failed' };
    }
    const restoreGroupHint = await findRestoreGroupHint(tab.groupId);

    const members = await chrome.tabs.query({
      windowId: tab.windowId,
      groupId: tab.groupId,
    });
    members.sort((a, b) => a.index - b.index);
    if (!members.length) {
      await flashBadge('!');
      return { ok: false, error: 'empty_group' };
    }

    const settings = await getSettings();
    const afterSaveGroup = normalizeAfterSaveMode(opts.afterSaveGroup, settings.afterSaveGroup);
    const captureMode = settings.saveGroupCapture || 'all';
    const originalActiveId = tab.id;
    const groupId = crypto.randomUUID();

    await flashBadge('…', '#3b82f6', 60000);

    const groupTabs = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      let hasThumb = false;
      let hasSnap = false;
      const memberId = crypto.randomUUID();
      const shouldCapture =
        captureMode === 'all' ||
        (captureMode === 'activeOnly' && m.id === originalActiveId);

      if (shouldCapture && !isRestrictedUrl(m.url)) {
        await flashBadge(`${i + 1}/${members.length}`, '#3b82f6', 60000);
        try {
          const { thumbBlob, snapBlob } = await captureTabBlobs(tab.windowId, m.id);
          const flags = await Media.putFromBlobs(
            Media.mediaKeyMember(groupId, memberId),
            thumbBlob,
            snapBlob
          );
          hasThumb = flags.hasThumb;
          hasSnap = flags.hasSnap;
        } catch (err) {
          console.warn('[TabWall] group member media failed:', err);
        }
      }

      const metadata = applyAutoSaveMetadata(
        {
          url: m.url || '',
          title: m.title || m.url || '',
        },
        { note: '', tags: [] },
        settings.autoSaveMetadata
      );

      groupTabs.push({
        id: memberId,
        url: m.url || '',
        title: m.title || m.url || 'Untitled',
        favIconUrl: m.favIconUrl || '',
        pinned: Boolean(m.pinned),
        indexInGroup: i,
        note: metadata.note,
        tags: metadata.tags,
        hasThumb,
        hasSnap,
      });
    }

    try {
      await chrome.tabs.update(originalActiveId, { active: true });
    } catch {
      // ignore
    }

    const groupItem = {
      kind: 'group',
      id: groupId,
      title: meta.title || '',
      color: meta.color || 'grey',
      collapsed: Boolean(meta.collapsed),
      note: restoreGroupHint?.note || '',
      tags: Array.isArray(restoreGroupHint?.tags) ? restoreGroupHint.tags : [],
      pinned: false,
      savedAt: Date.now(),
      tabs: groupTabs,
    };

    const list = await getParkedItems();
    list.unshift(groupItem);
    await setParkedItems(list);
    await mergeTagsIntoCatalog(groupTabs.flatMap((member) => member.tags || []));
    try {
      await consumeRestoreHint(restoreGroupHint?.id);
    } catch (err) {
      console.warn('[TabWall] group restore hint cleanup failed:', err);
    }

    if (afterSaveGroup === 'close') {
      const ids = members.map((m) => m.id).filter((id) => id != null);
      try {
        await chrome.tabs.remove(ids);
      } catch (err) {
        console.warn('[TabWall] close group tabs failed:', err);
      }
    }

    await flashBadge(String(Math.min(list.length, 99)), '#3b82f6', 1500);
    return { ok: true, id: groupItem.id, tabCount: groupTabs.length };
  } catch (err) {
    console.warn('[TabWall] saveActiveGroup failed:', err);
    await flashBadge('!');
    return { ok: false, error: String(err) };
  }
}

async function handleCommandAction(action) {
  if (action === 'save-tab') {
    return saveCurrentTab(await getActiveTab());
  }
  if (action === 'save-group') {
    return saveActiveGroup();
  }
  if (action === 'save-keep') {
    const tab = await getActiveTab();
    const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1;
    if (tab?.groupId != null && tab.groupId !== none) {
      return saveActiveGroup({ afterSaveGroup: 'keep' });
    }
    return saveActiveTab({ afterSave: 'keep' });
  }
  if (action === 'toggle-park') {
    if (!beginAction('toggle-park')) return { ok: false, error: 'debounced' };
    return toggleParkOnActiveTab();
  }
  return { ok: false, error: 'unknown_action' };
}

async function getCommandsStatus() {
  try {
    const list = await chrome.commands.getAll();
    return {
      ok: true,
      commands: list.map((c) => ({
        name: c.name,
        description: c.description || '',
        shortcut: c.shortcut || '',
      })),
    };
  } catch (err) {
    return { ok: false, error: String(err), commands: [] };
  }
}

// ─── Restore / delete ──────────────────────────────────────────────

async function cleanupCreatedTabs(tabIds, windowId = null) {
  const ids = [...new Set((tabIds || []).filter((id) => id != null))];
  if (ids.length) {
    try {
      await chrome.tabs.remove(ids);
    } catch (err) {
      appLogPush('warn', 'rollback', 'tab cleanup failed', err?.message || err);
    }
  }
  if (windowId != null && chrome.windows?.remove) {
    try {
      await chrome.windows.remove(windowId);
    } catch {
      // The window may already have closed with its last tab.
    }
  }
}

async function commitRestoredItem(
  list,
  index,
  item,
  createdIds,
  windowId = null,
  restoredGroupId = null
) {
  const next = list.filter((entry) => entry.id !== item.id);
  const remainingNotes = item.kind === 'group' ? (item.notes || []) : [];
  if (remainingNotes.length) {
    next.splice(Math.min(index, next.length), 0, {
      ...item,
      tabs: [],
      notes: remainingNotes,
      savedAt: Date.now(),
    });
  }
  try {
    await setParkedItems(next);
  } catch (err) {
    await cleanupCreatedTabs(createdIds, windowId);
    return { ok: false, error: String(err?.message || err) };
  }
  if (item.kind === 'tab') {
    try {
      await rememberRestoreHints([item]);
    } catch (err) {
      console.warn('[TabWall] restore hint save failed:', err);
    }
  } else if (restoredGroupId != null) {
    try {
      await rememberRestoreGroupHint(restoredGroupId, item);
    } catch (err) {
      console.warn('[TabWall] group restore hint save failed:', err);
    }
  }
  try {
    const tabMediaKeys = item.kind === 'group'
      ? (item.tabs || []).map((member) => Media.mediaKeyMember(item.id, member.id))
      : Media.keysForItem(item);
    await Media.removeMany(tabMediaKeys);
  } catch (err) {
    // Metadata is already committed; retain correctness and let orphan GC retry.
    appLogPush('warn', 'restore', 'media cleanup deferred', err?.message || err);
  }
  return { ok: true, remaining: next.length, notesRemaining: remainingNotes.length };
}

async function restoreTab(id) {
  const list = await getParkedItems();
  const i = list.findIndex((t) => t.id === id);
  if (i === -1) return { ok: false, error: 'not_found' };
  const item = list[i];
  if (item.kind === 'group') return restoreGroup(id);
  if (item.kind === 'note') return { ok: false, error: 'note_not_restorable' };
  if (!isRestorableUrl(item.url)) return { ok: false, error: 'restricted_url' };

  let tab;
  try {
    tab = await chrome.tabs.create({ url: item.url, active: true });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  return commitRestoredItem(list, i, item, tab?.id != null ? [tab.id] : []);
}

async function restoreGroup(id) {
  const list = await getParkedItems();
  const idx = list.findIndex((t) => t.id === id && t.kind === 'group');
  if (idx === -1) return { ok: false, error: 'not_found' };

  const item = list[idx];
  if (!(item.tabs || []).length) return { ok: false, error: 'notes_only' };
  const settings = await getSettings();
  const members = [...(item.tabs || [])].sort(
    (a, b) => (a.indexInGroup || 0) - (b.indexInGroup || 0)
  );

  if (settings.restoreGroupIn === 'newWindow') {
    const first = members.find((m) => isRestorableUrl(m.url));
    if (!first) return { ok: false, error: 'no_restorable_urls' };
    const createdIds = [];
    let windowId = null;
    try {
      const win = await chrome.windows.create({ url: first.url, focused: true });
      windowId = win.id;
      const firstTab = win.tabs && win.tabs[0];
      if (firstTab?.id != null) createdIds.push(firstTab.id);
      for (const m of members) {
        if (m === first) continue;
        if (!isRestorableUrl(m.url)) continue;
        const t = await chrome.tabs.create({ url: m.url, active: false, windowId });
        createdIds.push(t.id);
      }
      if (!createdIds.length) throw new Error('no_restorable_urls');
      const groupId = await chrome.tabs.group({
        tabIds: createdIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, {
        title: item.title || '',
        color: item.color || 'grey',
        collapsed: Boolean(item.collapsed),
      });
      const result = await commitRestoredItem(
        list,
        idx,
        item,
        createdIds,
        windowId,
        groupId
      );
      if (!result.ok) return result;
      return { ...result, skipped: members.filter((m) => !isRestorableUrl(m.url)).length };
    } catch (err) {
      await cleanupCreatedTabs(createdIds, windowId);
      return { ok: false, error: String(err?.message || err) };
    }
  }

  const createdIds = [];
  let skipped = 0;
  try {
    for (const m of members) {
      if (!isRestorableUrl(m.url)) {
        skipped++;
        continue;
      }
      const t = await chrome.tabs.create({ url: m.url, active: false });
      createdIds.push(t.id);
    }
    if (!createdIds.length) return { ok: false, error: 'no_restorable_urls' };
    const groupId = await chrome.tabs.group({ tabIds: createdIds });
    await chrome.tabGroups.update(groupId, {
      title: item.title || '',
      color: item.color || 'grey',
      collapsed: Boolean(item.collapsed),
    });
    try {
      await chrome.tabs.update(createdIds[0], { active: true });
    } catch {
      // ignore
    }
    const result = await commitRestoredItem(list, idx, item, createdIds, null, groupId);
    return result.ok ? { ...result, skipped } : result;
  } catch (err) {
    await cleanupCreatedTabs(createdIds);
    return { ok: false, error: String(err?.message || err) };
  }
}

async function restoreGroupMember(groupId, memberId) {
  const list = await getParkedItems();
  const gIdx = list.findIndex((t) => t.id === groupId && t.kind === 'group');
  if (gIdx === -1) return { ok: false, error: 'not_found' };
  const group = { ...list[gIdx], tabs: [...(list[gIdx].tabs || [])] };
  const mIdx = group.tabs.findIndex((m) => m.id === memberId);
  if (mIdx === -1) return { ok: false, error: 'member_not_found' };
  const member = group.tabs[mIdx];
  if (!isRestorableUrl(member.url)) return { ok: false, error: 'restricted_url' };

  let created;
  try {
    created = await chrome.tabs.create({ url: member.url, active: true });
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  group.tabs.splice(mIdx, 1);
  const nextList = [...list];
  if (!group.tabs.length) {
    nextList.splice(gIdx, 1);
  } else {
    nextList[gIdx] = group;
  }
  try {
    await setParkedItems(nextList);
  } catch (err) {
    await cleanupCreatedTabs(created?.id != null ? [created.id] : []);
    return { ok: false, error: String(err?.message || err) };
  }
  try {
    await rememberRestoreHints([member]);
  } catch (err) {
    console.warn('[TabWall] restore hint save failed:', err);
  }
  try {
    await Media.remove(Media.mediaKeyMember(groupId, memberId));
  } catch (err) {
    appLogPush('warn', 'restore', 'member media cleanup deferred', err?.message || err);
  }
  return { ok: true, remaining: nextList.length };
}

async function deleteItem(id) {
  const list = await getParkedItems();
  const item = list.find((t) => t.id === id);
  if (!item) return { ok: false, error: 'not_found' };
  const next = list.filter((t) => t.id !== id);
  await setParkedItems(next);
  try {
    await Media.removeMany(Media.keysForItem(item));
  } catch (err) {
    appLogPush('warn', 'delete', 'media cleanup deferred', err?.message || err);
  }
  return { ok: true, remaining: next.length };
}

async function updateItem(id, patch) {
  const list = await getParkedItems();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return { ok: false, error: 'not_found' };
  const item = { ...list[idx] };
  if (typeof patch.pinned === 'boolean') item.pinned = patch.pinned;
  if (typeof patch.note === 'string') item.note = patch.note;
  if (Array.isArray(patch.tags)) {
    item.tags = patch.tags
      .map((t) => String(t).trim())
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i);
    await mergeTagsIntoCatalog(item.tags);
  }
  list[idx] = item;
  await setParkedItems(list);
  return { ok: true, item, tab: item };
}

async function reorderItems(ids) {
  if (!Array.isArray(ids)) return { ok: false, error: 'invalid_ids' };
  const list = await getParkedItems();
  const map = new Map(list.map((t) => [t.id, t]));
  const next = [];
  for (const id of ids) {
    const item = map.get(id);
    if (item) {
      next.push(item);
      map.delete(id);
    }
  }
  for (const item of map.values()) next.push(item);
  await setParkedItems(next);
  return { ok: true, items: next };
}

async function getMediaMessage(key, kind) {
  if (kind === 'attachment') {
    const blob = await Media.getAttachment?.(key);
    return {
      ok: true,
      dataUrl: blob ? await Media.blobToDataUrl(blob) : '',
      key,
      kind: 'attachment',
    };
  }
  const part = kind === 'snap' ? 'snap' : 'thumb';
  const blob = await Media.getPart(key, part);
  if (!blob) return { ok: true, dataUrl: '', key, kind: part };
  const dataUrl = await Media.blobToDataUrl(blob);
  return { ok: true, dataUrl, key, kind: part };
}

// ─── Messages ──────────────────────────────────────────────────────

const MUTATING_MESSAGE_TYPES = new Set([
  'RESTORE_TAB',
  'RESTORE_GROUP',
  'RESTORE_GROUP_MEMBER',
  'UPDATE_GROUP_MEMBER',
  'CREATE_NOTE',
  'UPDATE_NOTE',
  'DELETE_NOTE',
  'DELETE_TAB',
  'DELETE_ITEM',
  'UPDATE_TAB',
  'UPDATE_ITEM',
  'REORDER_TABS',
  'REORDER_ITEMS',
  'STACK_ITEMS',
  'PATCH_CANVAS_LAYOUT',
  'CREATE_STACK',
  'SAVE_ACTIVE_TAB',
  'SAVE_TAB_FROM_CONTENT',
  'SAVE_ACTIVE_GROUP',
  'OPEN_PARK_ACTIVE',
  'ADD_TAG',
  'RENAME_TAG',
  'DELETE_TAG',
  'IMPORT_BACKUP',
  'CREATE_FROM_URL_TEXT',
  'AUTO_BACKUP_RUN',
  'PATCH_SETTINGS',
  'BATCH_UPDATE_ITEMS',
  'BATCH_DELETE_ITEMS',
  'RESOLVE_SAVE_CONFLICT',
  'APPLY_DEDUPE',
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case 'GET_PARKED_ITEMS':
        return { ok: true, items: await getParkedItems() };
      case 'GET_PARKED_TABS': {
        const items = await getParkedItems();
        return { ok: true, tabs: items, items };
      }
      case 'GET_MEDIA':
        return getMediaMessage(message.key, message.kind || 'thumb');
      case 'GET_ATTACHMENT_USAGE':
        return getAttachmentUsage(message.noteId || '', message.groupId || '');
      case 'GET_CANVAS_LAYOUT':
        return { ok: true, ...(await getCanvasLayoutRecord()) };
      case 'RESTORE_TAB':
        return restoreTab(message.id);
      case 'RESTORE_GROUP':
        return restoreGroup(message.id);
      case 'RESTORE_GROUP_MEMBER':
        return restoreGroupMember(message.groupId, message.memberId);
      case 'UPDATE_GROUP_MEMBER':
        return updateGroupMember(message.groupId, message.memberId, {
          note: message.note,
          tags: message.tags,
        });
      case 'CREATE_NOTE':
        return createNote(message.note || message.item, message.position);
      case 'UPDATE_NOTE':
        return updateNote(message.noteId || message.id, message.patch || message.note || {}, message.groupId || '');
      case 'DELETE_NOTE':
        return deleteNote(message.noteId || message.id, message.groupId || '');
      case 'DELETE_TAB':
      case 'DELETE_ITEM':
        return deleteItem(message.id);
      case 'UPDATE_TAB':
      case 'UPDATE_ITEM':
        return updateItem(message.id, {
          note: message.note,
          tags: message.tags,
          pinned: message.pinned,
        });
      case 'REORDER_TABS':
      case 'REORDER_ITEMS':
        return reorderItems(message.ids);
      case 'STACK_ITEMS':
        return stackItems(message.sourceId, message.targetId);
      case 'PATCH_CANVAS_LAYOUT':
        return patchCanvasLayout(message.layout, message.baseRevision);
      case 'CREATE_STACK':
        return createStack(message.ids, message.title);
      case 'SAVE_ACTIVE_TAB':
        return saveActiveTab({ afterSave: message.afterSave });
      case 'SAVE_TAB_FROM_CONTENT':
        return saveCurrentTab(sender?.tab || null);
      case 'SAVE_ACTIVE_GROUP':
        return saveActiveGroup({ afterSaveGroup: message.afterSaveGroup });
      case 'OPEN_PARK_ACTIVE':
        return openParkOnActiveTab();
      case 'GET_TAGS':
        return { ok: true, tags: await getTagsWithCounts() };
      case 'ADD_TAG':
        return addTag(message.name);
      case 'RENAME_TAG':
        return renameTag(message.from, message.to);
      case 'DELETE_TAG':
        return deleteTag(message.name);
      case 'EXPORT_BACKUP':
        // Never hydrate over the wire — full ZIP is assembled in park from IDB.
        return exportBackup(message.mode === 'full' ? 'full' : 'lite', { hydrate: false });
      case 'IMPORT_BACKUP': {
        let res;
        try {
          res = await importBackup(message.backup, {
            mode: message.mode === 'append' ? 'append' : 'replace',
            importId: message.importId || '',
          });
        } finally {
          if (message.importId && Media?.removeImportStage) {
            await Media.removeImportStage(String(message.importId)).catch(() => {});
          }
        }
        appLogPush(
          res.ok ? 'info' : 'error',
          'import',
          res.ok ? `ok mode=${res.mode} added=${res.added}` : `fail ${res.error}`,
          ''
        );
        return res;
      }
      case 'CREATE_FROM_URL_TEXT': {
        const res = await createFromUrlText(message.text || '');
        appLogPush(
          res.ok ? 'info' : 'warn',
          'manualAdd',
          res.ok ? `added=${res.added} skipped=${res.skipped}` : `empty skipped=${res.skipped}`,
          ''
        );
        return res;
      }
      case 'LOG':
        appLogPush(message.level || 'info', message.tag || 'ui', message.msg || '', message.detail);
        return { ok: true };
      case 'GET_LOGS':
        return { ok: true, logs: appLog.slice() };
      case 'CLEAR_LOGS':
        appLog.length = 0;
        appLogPush('info', 'log', 'cleared');
        return { ok: true };
      case 'AUTO_BACKUP_RUN':
        return runAutoBackup({ force: Boolean(message.force), reason: message.reason || 'manual' });
      case 'AUTO_BACKUP_SYNC_ALARMS': {
        const settings = await getSettings();
        await syncAutoBackupAlarms(settings.autoBackup);
        return { ok: true };
      }
      case 'PATCH_SETTINGS':
        return patchSettings(message.partial);
      case 'AUTO_BACKUP_SHOW_FOLDER': {
        try {
          if (chrome.downloads?.showDefaultFolder) {
            chrome.downloads.showDefaultFolder();
            return { ok: true };
          }
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
        return { ok: false, error: 'unsupported' };
      }
      case 'BATCH_UPDATE_ITEMS':
        return batchUpdateItems(message.ids, {
          note: message.note,
          tags: message.tags,
          tagMode: message.tagMode,
        });
      case 'BATCH_DELETE_ITEMS':
        return batchDeleteItems(message.ids);
      case 'GET_COMMANDS':
        return getCommandsStatus();
      case 'OPEN_SHORTCUTS_PAGE':
        await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        return { ok: true };
      case 'GET_PENDING_CONFLICT': {
        const pending = await getPendingConflict();
        if (!pending) return { ok: true, conflict: null };
        return {
          ok: true,
          conflict: {
            url: pending.url,
            title: pending.title,
            favIconUrl: pending.favIconUrl,
            matches: pending.matches || [],
          },
        };
      }
      case 'RESOLVE_SAVE_CONFLICT':
        return resolveSaveConflict(message.decision || 'cancel');
      case 'SCAN_DUPLICATES': {
        const items = await getParkedItems();
        return { ok: true, clusters: scanDuplicateClusters(items) };
      }
      case 'APPLY_DEDUPE': {
        const res = await applyDedupe(message.ops);
        if (res.ok) {
          await flashBadge(String(Math.min((res.items || []).length, 99)), '#3b82f6', 1500);
        }
        return res;
      }
      default:
        return { ok: false, error: 'unknown_type' };
    }
  };
  const task = MUTATING_MESSAGE_TYPES.has(message?.type)
    ? enqueueMutation(handle)
    : handle();
  task
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    await enqueueMutation(() => handleCommandAction(command));
  } catch (err) {
    console.warn('[TabWall] onCommand failed:', err);
  }
});

if (globalThis.__TABWALL_TEST__) {
  globalThis.TabWallBackgroundTest = {
    DATA_VERSION,
    enqueueMutation,
    getParkedItems,
    setParkedItems,
    importBackup,
    pruneDownloadedAutoBackups,
    stackItems,
    createStack,
    getCanvasLayout,
    getCanvasLayoutRecord,
    setCanvasLayout,
    patchCanvasLayout,
    normalizeCanvasLayout,
    remapCanvasLayout,
    mergeAppendedCanvasLayout,
    commitItemsAndCanvas,
    normalizeAutoSaveMetadata,
    matchesAutoSaveCondition,
    matchesAutoSaveRule,
    applyAutoSaveMetadata,
    hasParkedTabUrl,
    refreshTabBadge,
    refreshActiveTabBadge,
    flashBadge,
    commitSaveTab,
    saveCurrentTab,
    saveActiveTab,
    updateItem,
    createNote,
    updateNote,
    deleteNote,
    getAttachmentUsage,
    normalizeNoteItem,
    remintItemIds,
    saveActiveGroup,
    restoreTab,
    restoreGroup,
    restoreGroupMember,
    toggleParkOnActiveTab,
    openParkOnActiveTab,
    openStandaloneParkTab,
    handleCommandAction,
  };
}

refreshActiveTabBadge().catch(() => {});

// Kick migration early
ensureMediaMigration()
  .then(async () => {
    await Media.removeExpiredImportStages?.();
    await cleanupOrphanMedia();
  })
  .catch((err) => console.warn('[TabWall] startup media cleanup failed:', err));
