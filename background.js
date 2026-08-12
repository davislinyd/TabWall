/**
 * TabWall — Service Worker
 * Meta in chrome.storage.local; images in IndexedDB (mediaDb.js)
 */
importScripts('mediaDb.js', 'backupBuild.js', 'noteMedia.js');
// Domain slices (shared SW global scope — function decls resolve across files)
importScripts('bgNormalize.js', 'bgLayout.js', 'bgBackup.js', 'bgRestore.js');

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
  preSaveEdit: true,
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

// In-memory cache of every parked URL (tab items + group member URLs), kept
// in sync by commitItemsAndCanvas (the sole writer of STORAGE_ITEMS) and by
// storage.onChanged (defensive, in case something else ever writes it).
// Avoids a full storage read + normalize + nested scan on every tab event.
let parkedUrlIndex = null;

function buildParkedUrlIndex(items) {
  const set = new Set();
  for (const item of items || []) {
    if (!item) continue;
    if (item.kind === 'tab' && item.url) set.add(normalizeUrlKey(item.url));
    else if (item.kind === 'group') {
      for (const member of item.tabs || []) {
        if (member?.url) set.add(normalizeUrlKey(member.url));
      }
    }
  }
  return set;
}

async function getParkedUrlIndex() {
  if (parkedUrlIndex) return parkedUrlIndex;
  parkedUrlIndex = buildParkedUrlIndex(await getParkedItemsRaw());
  return parkedUrlIndex;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_BACKUP_ALARM) {
    enqueueMutation(() => runAutoBackup({ reason: 'schedule' })).catch(() => {});
  } else if (alarm.name === AUTO_BACKUP_ONCHANGE_ALARM) {
    autoBackupAlarmPending = false;
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
    const nextAb = normalizeAutoBackup(changes.settings.newValue?.autoBackup);
    const prevAb = normalizeAutoBackup(changes.settings.oldValue?.autoBackup);
    autoBackupFlagsCache = { enabled: nextAb.enabled, onChange: nextAb.onChange };
    // Only re-create the periodic alarm when schedule-relevant fields change.
    // dirtyAt / lastSuccessAt / folderPath writes used to reset delay every
    // edit and after each backup, which could align schedule with onchange.
    const scheduleChanged =
      nextAb.enabled !== prevAb.enabled ||
      nextAb.intervalUnit !== prevAb.intervalUnit ||
      nextAb.intervalValue !== prevAb.intervalValue;
    if (scheduleChanged) {
      tasks.push(syncAutoBackupAlarms(nextAb));
    }
  }
  if (changes[STORAGE_ITEMS]) {
    // Defensive resync in case something bypasses commitItemsAndCanvas —
    // newValue is already delivered with the event, so this costs no I/O.
    const nextItems = Array.isArray(changes[STORAGE_ITEMS].newValue)
      ? changes[STORAGE_ITEMS].newValue.map(normalizeItem).filter(Boolean)
      : [];
    parkedUrlIndex = buildParkedUrlIndex(nextItems);
  } else if (changes[STORAGE_TABS]) {
    parkedUrlIndex = null; // legacy-only path; rebuilt lazily on next access
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
 * Computes the default note/tags a tab would be saved with: auto-save-metadata
 * rules layered on top of any matching restore hint. Shared by the pre-save
 * edit panel (to pre-fill it) and commitSaveTab (to fall back to it when the
 * user never overrides it), so the two can never drift apart.
 */
async function computeSaveMetadata(tabLike) {
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
  return { metadata, restoreHint, settings };
}

/**
 * Commit a parked tab from a live chrome.tabs Tab (or pending snapshot fields).
 * @param {object} tabLike - { id?, windowId?, url, title, favIconUrl }
 * @param {{ replaceMatchIds?: string[], afterSave?: 'keep'|'close', metaOverride?: { note?: string, tags?: string[] } }} opts
 */
async function commitSaveTab(tabLike, opts = {}) {
  const replaceMatchIds = opts.replaceMatchIds || [];
  const { metadata: computedMetadata, restoreHint, settings } = await computeSaveMetadata(tabLike);
  // A user-confirmed pre-save edit wins outright — do not re-apply auto-save
  // rules on top of it, or a tag the user deliberately removed would reappear.
  const metadata = opts.metaOverride
    ? {
        note: safeText(opts.metaOverride.note, DATA_LIMITS.MAX_NOTE_LENGTH),
        tags: normalizeTags(opts.metaOverride.tags),
      }
    : computedMetadata;
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

    return await openPreSaveEdit(tab, { afterSave });
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

/**
 * Shows the "edit note/tags before saving" panel on the tab's own page via
 * the content-script overlay (mirrors openParkOnTab/SHOW_SAVE_CONFLICT).
 * Degrades straight to commitSaveTab — never drops a save — when the
 * feature is off, there is no host tab to draw on, the URL is restricted,
 * or the overlay fails to inject.
 */
async function openPreSaveEdit(tabLike, opts = {}) {
  if (tabLike.id == null || isRestrictedUrl(tabLike.url)) {
    return commitSaveTab(tabLike, opts);
  }
  const { metadata, settings } = await computeSaveMetadata(tabLike);
  if (settings.preSaveEdit === false) {
    return commitSaveTab(tabLike, opts);
  }
  await setPendingPreSave({
    tabId: tabLike.id,
    windowId: tabLike.windowId,
    url: tabLike.url,
    title: tabLike.title || tabLike.url || 'Untitled',
    favIconUrl: tabLike.favIconUrl || '',
    afterSave: opts.afterSave,
    replaceMatchIds: opts.replaceMatchIds || [],
    note: metadata.note,
    tags: metadata.tags,
  });
  const opened = await openParkOnTab(tabLike.id, {
    type: 'SHOW_PRESAVE_EDIT',
    preSave: {
      title: tabLike.title || tabLike.url || 'Untitled',
      url: tabLike.url || '',
      favIconUrl: tabLike.favIconUrl || '',
      note: metadata.note,
      tags: metadata.tags,
      afterSave: normalizeAfterSaveMode(opts.afterSave, settings.afterSave),
      matchCount: (opts.replaceMatchIds || []).length,
    },
  });
  if (!opened) {
    await clearPendingPreSave();
    return commitSaveTab(tabLike, opts);
  }
  await flashBadge('✎', '#3b82f6', 2000);
  return { ok: true, presave: true };
}

/** Resolves the pre-save edit panel: 'cancel' discards, 'save' commits with the user's note/tags. */
async function resolvePreSaveEdit(decision, note, tags, senderTabId) {
  const pending = await getPendingPreSave();
  if (!pending) return { ok: false, error: 'no_pending' };
  if (senderTabId != null && pending.tabId != null && senderTabId !== pending.tabId) {
    return { ok: false, error: 'stale_presave' };
  }
  if (decision === 'cancel') {
    await clearPendingPreSave();
    if (pending.tabId != null) {
      try {
        await refreshTabBadge(pending.tabId);
      } catch {
        // ignore
      }
    }
    return { ok: true, cancelled: true };
  }

  const tabLike = {
    id: pending.tabId,
    windowId: pending.windowId,
    url: pending.url,
    title: pending.title,
    favIconUrl: pending.favIconUrl,
  };
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

  // Clear before commit — a mid-commit SW restart must not replay this.
  await clearPendingPreSave();
  return commitSaveTab(tabLike, {
    replaceMatchIds: pending.replaceMatchIds || [],
    afterSave: pending.afterSave,
    metaOverride: { note, tags },
  });
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
  await clearPendingConflict();
  return openPreSaveEdit(tabLike, {
    replaceMatchIds,
    afterSave: pending.afterSave,
  });
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
  'RESOLVE_PRESAVE_EDIT',
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
      case 'GET_PENDING_PRESAVE': {
        const pending = await getPendingPreSave();
        if (!pending) return { ok: true, preSave: null };
        return {
          ok: true,
          preSave: {
            title: pending.title,
            url: pending.url,
            favIconUrl: pending.favIconUrl,
            note: pending.note || '',
            tags: pending.tags || [],
            afterSave: pending.afterSave,
            matchCount: (pending.replaceMatchIds || []).length,
          },
        };
      }
      case 'RESOLVE_PRESAVE_EDIT':
        return resolvePreSaveEdit(message.decision || 'cancel', message.note, message.tags, sender?.tab?.id ?? null);
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
    autoBackupShouldRun,
    runAutoBackup,
    normalizeAutoBackup,
    autoBackupIntervalMinutes,
    getSettings,
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
    refreshTabBadge,
    refreshActiveTabBadge,
    flashBadge,
    commitSaveTab,
    computeSaveMetadata,
    openPreSaveEdit,
    resolvePreSaveEdit,
    getPendingPreSave,
    setPendingPreSave,
    clearPendingPreSave,
    saveCurrentTab,
    saveActiveTab,
    resolveSaveConflict,
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
