/**
 * TabWall — Service Worker
 * Meta in chrome.storage.local; images in IndexedDB (mediaDb.js)
 */
importScripts('mediaDb.js', 'backupBuild.js');

const Media = self.TabWallMediaDB;
const Build = self.TabWallBackupBuild;
const STORAGE_TABS = 'parkedTabs'; // legacy
const STORAGE_ITEMS = 'parkedItems';
const SETTINGS_KEY = 'settings';
const TAG_CATALOG_KEY = 'tagCatalog';
const DATA_VERSION_KEY = 'dataVersion';
const DATA_VERSION = 4;

const DEFAULT_SHORTCUTS = {
  'save-tab': { alt: true, shift: false, ctrl: false, meta: false, key: 's' },
  'save-group': { alt: true, shift: true, ctrl: false, meta: false, key: 'g' },
  'toggle-park': { alt: true, shift: false, ctrl: false, meta: false, key: 'o' },
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

const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  saveGroupCapture: 'all',
  restoreGroupIn: 'currentWindow',
  shortcuts: { ...DEFAULT_SHORTCUTS },
  autoBackup: { ...DEFAULT_AUTO_BACKUP },
};

const AUTO_BACKUP_ALARM = 'tabwall-auto-backup-schedule';
const AUTO_BACKUP_ONCHANGE_ALARM = 'tabwall-auto-backup-onchange';

let autoBackupRunning = false;

/** Prevent double-fire from chrome.commands + page hotkeys */
const actionLocks = new Map();
const ACTION_DEBOUNCE_MS = 700;

function beginAction(name) {
  const now = Date.now();
  const prev = actionLocks.get(name) || 0;
  if (now - prev < ACTION_DEBOUNCE_MS) return false;
  actionLocks.set(name, now);
  return true;
}

const THUMB = { maxWidth: 480, quality: 0.6 };
const TINY = { maxWidth: 180, quality: 0.4 };
const SNAPSHOT = { maxWidth: null, quality: 0.85 };

let migrationPromise = null;

// ─── Normalize meta (no inline media) ──────────────────────────────

function normalizeTabItem(raw) {
  const hasInlineThumb = typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('data:');
  const hasInlineSnap = typeof raw.snapshot === 'string' && raw.snapshot.startsWith('data:');
  return {
    kind: 'tab',
    id: raw.id || crypto.randomUUID(),
    url: raw.url || '',
    title: raw.title || raw.url || 'Untitled',
    favIconUrl: raw.favIconUrl || '',
    note: typeof raw.note === 'string' ? raw.note : '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    savedAt: raw.savedAt || Date.now(),
    hasThumb: raw.hasThumb === true || hasInlineThumb,
    hasSnap: raw.hasSnap === true || hasInlineSnap,
    // keep inline only during migration pass
    thumbnail: hasInlineThumb ? raw.thumbnail : '',
    snapshot: hasInlineSnap ? raw.snapshot : '',
  };
}

function normalizeGroupItem(raw) {
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.map((m, i) => {
        const hasInlineThumb = typeof m.thumbnail === 'string' && m.thumbnail.startsWith('data:');
        const hasInlineSnap = typeof m.snapshot === 'string' && m.snapshot.startsWith('data:');
        return {
          id: m.id || crypto.randomUUID(),
          url: m.url || '',
          title: m.title || m.url || 'Untitled',
          favIconUrl: m.favIconUrl || '',
          pinned: Boolean(m.pinned),
          indexInGroup: typeof m.indexInGroup === 'number' ? m.indexInGroup : i,
          note: typeof m.note === 'string' ? m.note : '',
          tags: Array.isArray(m.tags) ? m.tags : [],
          hasThumb: m.hasThumb === true || hasInlineThumb,
          hasSnap: m.hasSnap === true || hasInlineSnap,
          thumbnail: hasInlineThumb ? m.thumbnail : '',
          snapshot: hasInlineSnap ? m.snapshot : '',
        };
      })
    : [];
  return {
    kind: 'group',
    id: raw.id || crypto.randomUUID(),
    title: raw.title || '',
    color: raw.color || 'grey',
    collapsed: Boolean(raw.collapsed),
    note: typeof raw.note === 'string' ? raw.note : '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    savedAt: raw.savedAt || Date.now(),
    tabs,
  };
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'group' || Array.isArray(raw.tabs)) return normalizeGroupItem(raw);
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
    };
  }
  return {
    kind: 'tab',
    id: item.id,
    url: item.url || '',
    title: item.title || '',
    favIconUrl: item.favIconUrl || '',
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

async function setParkedItems(items) {
  const stored = items.map(normalizeItem).filter(Boolean).map(toStoredMeta);
  await chrome.storage.local.set({
    [STORAGE_ITEMS]: stored,
    [DATA_VERSION_KEY]: DATA_VERSION,
  });
  // legacy key: meta only, no images
  const flatTabs = stored
    .filter((i) => i.kind === 'tab')
    .map(({ kind, hasThumb, hasSnap, ...rest }) => rest);
  await chrome.storage.local.set({ [STORAGE_TABS]: flatTabs });
  await markAutoBackupDirty();
  return stored;
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
    await chrome.storage.local.set({ [DATA_VERSION_KEY]: DATA_VERSION });
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

async function pruneDownloadedAutoBackups(mode, keep) {
  const keepN = Math.min(99, Math.max(1, Math.round(Number(keep) || 5)));
  const prefix = mode === 'full' ? 'tabwall-auto-full-' : 'tabwall-auto-lite-';
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
    const base = String(it.filename || '')
      .split(/[/\\]/)
      .pop();
    return base && base.startsWith(prefix);
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
  const merged = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  merged.shortcuts = normalizeShortcuts(merged.shortcuts);
  merged.autoBackup = normalizeAutoBackup({
    ...DEFAULT_AUTO_BACKUP,
    ...(merged.autoBackup || {}),
  });
  return merged;
}

async function patchAutoBackup(partial) {
  const settings = await getSettings();
  const autoBackup = normalizeAutoBackup({ ...settings.autoBackup, ...partial });
  const next = { ...settings, autoBackup };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return autoBackup;
}

async function markAutoBackupDirty() {
  try {
    const settings = await getSettings();
    const ab = settings.autoBackup;
    if (!ab.enabled || !ab.onChange) return;
    await patchAutoBackup({ dirtyAt: Date.now(), lastError: ab.lastError || '' });
    // 0.5 min when allowed; Chrome may clamp to ≥1 min for store installs
    await chrome.alarms.create(AUTO_BACKUP_ONCHANGE_ALARM, { delayInMinutes: 0.5 });
  } catch (err) {
    console.warn('[TabWall] markAutoBackupDirty failed:', err);
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
    const exported = await exportBackup(mode);
    if (!exported?.ok || !exported.backup) {
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
      console.warn('[TabWall] auto backup download failed:', err);
      const detail = String(err?.message || err);
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
      await pruneDownloadedAutoBackups(mode, ab.maxKeep);
    } catch (err) {
      console.warn('[TabWall] prune failed:', err);
    }

    return {
      ok: true,
      filename: built.filename,
      folderPath,
      absoluteFile: downloaded.filename,
    };
  } catch (err) {
    console.warn('[TabWall] runAutoBackup failed:', err);
    await patchAutoBackup({ lastError: 'write_failed' });
    return { ok: false, error: 'write_failed' };
  } finally {
    autoBackupRunning = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_BACKUP_ALARM) {
    runAutoBackup({ reason: 'schedule' }).catch(() => {});
  } else if (alarm.name === AUTO_BACKUP_ONCHANGE_ALARM) {
    runAutoBackup({ reason: 'onchange' }).catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const next = changes.settings.newValue;
  const ab = normalizeAutoBackup(next?.autoBackup);
  syncAutoBackupAlarms(ab).catch(() => {});
});

// Restore schedule after SW wake / install
chrome.runtime.onInstalled.addListener(() => {
  getSettings()
    .then((s) => syncAutoBackupAlarms(s.autoBackup))
    .catch(() => {});
});
chrome.runtime.onStartup?.addListener?.(() => {
  getSettings()
    .then((s) => syncAutoBackupAlarms(s.autoBackup))
    .catch(() => {});
});

async function getTagCatalog() {
  const data = await chrome.storage.local.get(TAG_CATALOG_KEY);
  return Array.isArray(data[TAG_CATALOG_KEY]) ? data[TAG_CATALOG_KEY] : [];
}

async function setTagCatalog(tags) {
  const cleaned = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
  await chrome.storage.local.set({ [TAG_CATALOG_KEY]: cleaned });
  return cleaned;
}

function eachTagOnItem(item, fn) {
  if (Array.isArray(item.tags)) for (const t of item.tags) fn(t);
  if (item.kind === 'group' && Array.isArray(item.tabs)) {
    for (const m of item.tabs) {
      if (Array.isArray(m.tags)) for (const t of m.tags) fn(t);
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
    }
  }
  return n;
}

async function getTagsWithCounts() {
  const names = await collectAllTagNames();
  const items = await getParkedItems();
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

// ─── Media hydrate for export ──────────────────────────────────────

async function hydrateItemMedia(item) {
  if (item.kind === 'group') {
    const tabs = [];
    for (const m of item.tabs || []) {
      const med = await Media.get(Media.mediaKeyMember(item.id, m.id));
      tabs.push({
        ...m,
        thumbnail: med.thumb ? await Media.blobToDataUrl(med.thumb) : '',
        snapshot: med.snap ? await Media.blobToDataUrl(med.snap) : '',
      });
    }
    return { ...item, tabs };
  }
  const med = await Media.get(Media.mediaKeyTab(item.id));
  return {
    ...item,
    thumbnail: med.thumb ? await Media.blobToDataUrl(med.thumb) : '',
    snapshot: med.snap ? await Media.blobToDataUrl(med.snap) : '',
  };
}

async function exportBackup(mode = 'lite') {
  const [parkedItems, settingsData, tagCatalog] = await Promise.all([
    getParkedItems(),
    chrome.storage.local.get(SETTINGS_KEY),
    getTagCatalog(),
  ]);

  let items = parkedItems;
  if (mode === 'full') {
    items = [];
    for (const it of parkedItems) items.push(await hydrateItemMedia(it));
  }

  const parkedTabs = items
    .filter((i) => i.kind === 'tab')
    .map(({ kind, hasThumb, hasSnap, ...rest }) => rest);

  return {
    ok: true,
    backup: {
      format: 'tabwall-backup',
      version: 4,
      media: mode === 'full' ? 'inline' : 'none',
      appVersion: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      parkedItems: items,
      parkedTabs,
      settings: settingsData[SETTINGS_KEY] || {},
      tagCatalog,
    },
  };
}

/** Fresh UUIDs so append never collides with existing items / media keys. */
function remintItemIds(items) {
  return (items || []).map((item) => {
    if (!item) return item;
    if (item.kind === 'group') {
      return {
        ...item,
        id: crypto.randomUUID(),
        tabs: (item.tabs || []).map((m) => ({
          ...m,
          id: crypto.randomUUID(),
        })),
      };
    }
    return { ...item, id: crypto.randomUUID() };
  });
}

async function persistInlineMediaToIdb(items) {
  for (const item of items) {
    if (item.kind === 'group') {
      for (const m of item.tabs || []) {
        if (m.thumbnail || m.snapshot) {
          const flags = await Media.putFromDataUrls(
            Media.mediaKeyMember(item.id, m.id),
            m.thumbnail,
            m.snapshot
          );
          m.hasThumb = flags.hasThumb;
          m.hasSnap = flags.hasSnap;
        }
        m.thumbnail = '';
        m.snapshot = '';
      }
    } else if (item.thumbnail || item.snapshot) {
      const flags = await Media.putFromDataUrls(
        Media.mediaKeyTab(item.id),
        item.thumbnail,
        item.snapshot
      );
      item.hasThumb = flags.hasThumb;
      item.hasSnap = flags.hasSnap;
      item.thumbnail = '';
      item.snapshot = '';
    }
  }
}

/**
 * @param {object} backup
 * @param {{ mode?: 'replace' | 'append' }} opts
 */
async function importBackup(backup, { mode = 'replace' } = {}) {
  if (!backup || backup.format !== 'tabwall-backup') {
    return { ok: false, error: 'invalid_format' };
  }
  let items = [];
  if (Array.isArray(backup.parkedItems)) {
    items = backup.parkedItems.map(normalizeItem).filter(Boolean);
  } else if (Array.isArray(backup.parkedTabs)) {
    items = backup.parkedTabs.map((t) => normalizeTabItem(t));
  } else {
    return { ok: false, error: 'invalid_tabs' };
  }

  const append = mode === 'append';
  if (append) {
    items = remintItemIds(items);
  }

  await persistInlineMediaToIdb(items);

  if (append) {
    const existing = await getParkedItems();
    await setParkedItems([...existing, ...items]);
    const catalog = await getTagCatalog();
    const incoming = Array.isArray(backup.tagCatalog) ? backup.tagCatalog : [];
    await setTagCatalog([...catalog, ...incoming]);
    // Do not overwrite settings on append
    return { ok: true, mode: 'append', added: items.length };
  }

  await setParkedItems(items);
  const payload = {
    [TAG_CATALOG_KEY]: Array.isArray(backup.tagCatalog) ? backup.tagCatalog : [],
    [DATA_VERSION_KEY]: DATA_VERSION,
  };
  if (backup.settings && typeof backup.settings === 'object') {
    payload[SETTINGS_KEY] = backup.settings;
  }
  await chrome.storage.local.set(payload);
  return { ok: true, mode: 'replace', added: items.length };
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
    if (typeof patch.note === 'string' && patch.note.length > 0) updated.note = patch.note;
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
  for (const item of removed) {
    await Media.removeMany(Media.keysForItem(item));
  }
  const next = list.filter((i) => !idSet.has(i.id));
  await setParkedItems(next);
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
  return !isRestrictedUrl(url) && /^https?:\/\//i.test(url);
}

async function flashBadge(text, color = '#ef4444', ms = 2000) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }, ms);
  } catch {
    // ignore
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
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
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    await flashBadge('!');
    return;
  }
  try {
    await sendToTab(tab.id, { type: 'TOGGLE_PARK' });
  } catch (err) {
    console.warn('[TabWall] inject/toggle failed:', err);
    await flashBadge('!');
  }
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
    const thumbBlob = await compressToBlob(dataUrl, tiny ? TINY : THUMB);
    const snapBlob = await compressToBlob(dataUrl, SNAPSHOT);
    return { thumbBlob, snapBlob };
  } catch (err) {
    console.warn('[TabWall] capture failed for tab', tabId, err);
    return { thumbBlob: null, snapBlob: null };
  }
}

// ─── Dedup helpers ─────────────────────────────────────────────────

const PENDING_CONFLICT_KEY = 'pendingSaveConflict';
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Exact URL key (full string including query/hash). */
function normalizeUrlKey(url) {
  return typeof url === 'string' ? url : '';
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

async function deleteTabItemsByIds(ids) {
  if (!ids?.length) return 0;
  const idSet = new Set(ids);
  const list = await getParkedItems();
  const removed = list.filter((i) => idSet.has(i.id) && i.kind === 'tab');
  for (const item of removed) {
    try {
      await Media.removeMany(Media.keysForItem(item));
    } catch (err) {
      console.warn('[TabWall] media remove failed:', err);
    }
  }
  const next = list.filter((i) => !idSet.has(i.id));
  await setParkedItems(next);
  return removed.length;
}

// ─── Save tab ──────────────────────────────────────────────────────

/**
 * Commit a parked tab from a live chrome.tabs Tab (or pending snapshot fields).
 * @param {object} tabLike - { id?, windowId?, url, title, favIconUrl }
 * @param {{ replaceMatchIds?: string[] }} opts
 */
async function commitSaveTab(tabLike, opts = {}) {
  const replaceMatchIds = opts.replaceMatchIds || [];
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
      thumbBlob = await compressToBlob(dataUrl, THUMB);
      snapBlob = await compressToBlob(dataUrl, SNAPSHOT);
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
    note: '',
    tags: [],
    savedAt: Date.now(),
    hasThumb,
    hasSnap,
  };

  const list = await getParkedItems();
  list.unshift(entry);
  await setParkedItems(list);

  const { afterSave } = await getSettings();
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

async function saveCurrentTab(tab) {
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

    return await commitSaveTab(tab);
  } catch (err) {
    console.warn('[TabWall] saveCurrentTab failed:', err);
    await flashBadge('!');
    return { ok: false, error: String(err) };
  }
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
  const result = await commitSaveTab(tabLike, { replaceMatchIds });
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

async function rekeyMedia(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return;
  try {
    const row = await Media.get(oldKey);
    if (row?.thumb || row?.snap) {
      await Media.put(newKey, { thumb: row.thumb || null, snap: row.snap || null });
    }
    await Media.remove(oldKey);
  } catch (err) {
    console.warn('[TabWall] rekeyMedia failed', oldKey, '→', newKey, err);
  }
}

async function tabItemToMember(tabItem, groupId, indexInGroup) {
  const memberId = crypto.randomUUID();
  const oldKey = Media.mediaKeyTab(tabItem.id);
  const newKey = Media.mediaKeyMember(groupId, memberId);
  await rekeyMedia(oldKey, newKey);
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

async function rekeyGroupMembers(group, newGroupId, startIndex) {
  const members = [];
  let idx = startIndex;
  for (const m of group.tabs || []) {
    const memberId = m.id || crypto.randomUUID();
    if (group.id !== newGroupId) {
      await rekeyMedia(
        Media.mediaKeyMember(group.id, m.id),
        Media.mediaKeyMember(newGroupId, memberId)
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
async function stackItems(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return { ok: false, error: 'invalid_ids' };
  }
  const list = await getParkedItems();
  const source = list.find((i) => i.id === sourceId);
  const target = list.find((i) => i.id === targetId);
  if (!source || !target) return { ok: false, error: 'not_found' };

  const srcGroup = source.kind === 'group';
  const tgtGroup = target.kind === 'group';

  try {
    // tab → tab : create stack at target position
    if (!srcGroup && !tgtGroup) {
      const groupId = crypto.randomUUID();
      const mTarget = await tabItemToMember(target, groupId, 0);
      const mSource = await tabItemToMember(source, groupId, 1);
      const group = {
        kind: 'group',
        id: groupId,
        title: target.title || source.title || '',
        color: 'grey',
        collapsed: false,
        note: '',
        tags: [],
        savedAt: Date.now(),
        tabs: [mTarget, mSource],
      };
      const next = replaceListKeepingOrder(list, [sourceId, targetId], targetId, group);
      await setParkedItems(next);
      return { ok: true, items: next, groupId };
    }

    // tab → group : add tab into group
    if (!srcGroup && tgtGroup) {
      const member = await tabItemToMember(source, target.id, (target.tabs || []).length);
      const updated = {
        ...target,
        tabs: [...(target.tabs || []), member],
        savedAt: Date.now(),
      };
      const next = list
        .map((i) => (i.id === target.id ? updated : i))
        .filter((i) => i.id !== source.id);
      await setParkedItems(next);
      return { ok: true, items: next, groupId: target.id };
    }

    // group → tab : add tab into group, place group where tab was
    if (srcGroup && !tgtGroup) {
      const member = await tabItemToMember(target, source.id, (source.tabs || []).length);
      const updated = {
        ...source,
        tabs: [...(source.tabs || []), member],
        savedAt: Date.now(),
      };
      const next = replaceListKeepingOrder(list, [sourceId, targetId], targetId, updated);
      await setParkedItems(next);
      return { ok: true, items: next, groupId: source.id };
    }

    // group → group : merge source members into target
    if (srcGroup && tgtGroup) {
      const extra = await rekeyGroupMembers(source, target.id, (target.tabs || []).length);
      const updated = {
        ...target,
        tabs: [...(target.tabs || []), ...extra],
        savedAt: Date.now(),
      };
      const next = list
        .map((i) => (i.id === target.id ? updated : i))
        .filter((i) => i.id !== source.id);
      await setParkedItems(next);
      return { ok: true, items: next, groupId: target.id };
    }

    return { ok: false, error: 'unsupported' };
  } catch (err) {
    console.warn('[TabWall] stackItems failed:', err);
    return { ok: false, error: String(err) };
  }
}

// ─── Save group ────────────────────────────────────────────────────

async function saveActiveGroup() {
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

      groupTabs.push({
        id: memberId,
        url: m.url || '',
        title: m.title || m.url || 'Untitled',
        favIconUrl: m.favIconUrl || '',
        pinned: Boolean(m.pinned),
        indexInGroup: i,
        note: '',
        tags: [],
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
      note: '',
      tags: [],
      savedAt: Date.now(),
      tabs: groupTabs,
    };

    const list = await getParkedItems();
    list.unshift(groupItem);
    await setParkedItems(list);

    if ((settings.afterSaveGroup || 'close') === 'close') {
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

async function handleHotkeyAction(action) {
  if (action === 'save-tab') {
    return saveCurrentTab(await getActiveTab());
  }
  if (action === 'save-group') {
    return saveActiveGroup();
  }
  if (action === 'toggle-park') {
    if (!beginAction('toggle-park')) return { ok: false, error: 'debounced' };
    await toggleParkOnActiveTab();
    return { ok: true };
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

function normalizeShortcuts(raw) {
  const base = {
    'save-tab': { ...DEFAULT_SHORTCUTS['save-tab'] },
    'save-group': { ...DEFAULT_SHORTCUTS['save-group'] },
    'toggle-park': { ...DEFAULT_SHORTCUTS['toggle-park'] },
  };
  if (!raw || typeof raw !== 'object') return base;
  for (const name of Object.keys(base)) {
    const s = raw[name];
    if (!s || typeof s !== 'object' || !s.key) continue;
    base[name] = {
      alt: Boolean(s.alt),
      shift: Boolean(s.shift),
      ctrl: Boolean(s.ctrl),
      meta: Boolean(s.meta),
      key: String(s.key).toLowerCase(),
    };
  }
  return base;
}

// ─── Restore / delete ──────────────────────────────────────────────

async function restoreTab(id) {
  const list = await getParkedItems();
  const i = list.findIndex((t) => t.id === id);
  if (i === -1) return { ok: false, error: 'not_found' };
  const item = list[i];
  if (item.kind === 'group') return restoreGroup(id);

  list.splice(i, 1);
  await setParkedItems(list);
  await Media.remove(Media.mediaKeyTab(id));
  try {
    await chrome.tabs.create({ url: item.url, active: true });
  } catch (err) {
    list.splice(i, 0, item);
    await setParkedItems(list);
    return { ok: false, error: String(err) };
  }
  return { ok: true, remaining: list.length };
}

async function restoreGroup(id) {
  const list = await getParkedItems();
  const idx = list.findIndex((t) => t.id === id && t.kind === 'group');
  if (idx === -1) return { ok: false, error: 'not_found' };

  const item = list[idx];
  const settings = await getSettings();
  const members = [...(item.tabs || [])].sort(
    (a, b) => (a.indexInGroup || 0) - (b.indexInGroup || 0)
  );

  const finish = async (skipped = 0) => {
    await Media.removeMany(Media.keysForItem(item));
    list.splice(idx, 1);
    await setParkedItems(list);
    return { ok: true, remaining: list.length, skipped };
  };

  if (settings.restoreGroupIn === 'newWindow') {
    const first = members.find((m) => isRestorableUrl(m.url));
    if (!first) return { ok: false, error: 'no_restorable_urls' };
    const win = await chrome.windows.create({ url: first.url, focused: true });
    const windowId = win.id;
    const createdIds = [];
    const firstTab = win.tabs && win.tabs[0];
    if (firstTab?.id != null) createdIds.push(firstTab.id);
    for (const m of members) {
      if (m === first) continue;
      if (!isRestorableUrl(m.url)) continue;
      const t = await chrome.tabs.create({ url: m.url, active: false, windowId });
      createdIds.push(t.id);
    }
    if (!createdIds.length) return { ok: false, error: 'no_restorable_urls' };
    const groupId = await chrome.tabs.group({
      tabIds: createdIds,
      createProperties: { windowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: item.title || '',
      color: item.color || 'grey',
      collapsed: Boolean(item.collapsed),
    });
    return finish(0);
  }

  const createdIds = [];
  let skipped = 0;
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
  return finish(skipped);
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

  try {
    await chrome.tabs.create({ url: member.url, active: true });
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  await Media.remove(Media.mediaKeyMember(groupId, memberId));
  group.tabs.splice(mIdx, 1);
  if (!group.tabs.length) {
    list.splice(gIdx, 1);
  } else {
    list[gIdx] = group;
  }
  await setParkedItems(list);
  return { ok: true, remaining: list.length };
}

async function deleteItem(id) {
  const list = await getParkedItems();
  const item = list.find((t) => t.id === id);
  if (!item) return { ok: false, error: 'not_found' };
  await Media.removeMany(Media.keysForItem(item));
  const next = list.filter((t) => t.id !== id);
  await setParkedItems(next);
  return { ok: true, remaining: next.length };
}

async function updateItem(id, patch) {
  const list = await getParkedItems();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return { ok: false, error: 'not_found' };
  const item = { ...list[idx] };
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
  const part = kind === 'snap' ? 'snap' : 'thumb';
  const blob = await Media.getPart(key, part);
  if (!blob) return { ok: true, dataUrl: '', key, kind: part };
  const dataUrl = await Media.blobToDataUrl(blob);
  return { ok: true, dataUrl, key, kind: part };
}

// ─── Messages ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      case 'DELETE_TAB':
      case 'DELETE_ITEM':
        return deleteItem(message.id);
      case 'UPDATE_TAB':
      case 'UPDATE_ITEM':
        return updateItem(message.id, { note: message.note, tags: message.tags });
      case 'REORDER_TABS':
      case 'REORDER_ITEMS':
        return reorderItems(message.ids);
      case 'STACK_ITEMS':
        return stackItems(message.sourceId, message.targetId);
      case 'SAVE_ACTIVE_GROUP':
        return saveActiveGroup();
      case 'GET_TAGS':
        return { ok: true, tags: await getTagsWithCounts() };
      case 'ADD_TAG':
        return addTag(message.name);
      case 'RENAME_TAG':
        return renameTag(message.from, message.to);
      case 'DELETE_TAG':
        return deleteTag(message.name);
      case 'EXPORT_BACKUP':
        return exportBackup(message.mode === 'full' ? 'full' : 'lite');
      case 'IMPORT_BACKUP':
        return importBackup(message.backup, {
          mode: message.mode === 'append' ? 'append' : 'replace',
        });
      case 'CREATE_FROM_URL_TEXT':
        return createFromUrlText(message.text || '');
      case 'AUTO_BACKUP_RUN':
        return runAutoBackup({ force: Boolean(message.force), reason: message.reason || 'manual' });
      case 'AUTO_BACKUP_SYNC_ALARMS': {
        const settings = await getSettings();
        await syncAutoBackupAlarms(settings.autoBackup);
        return { ok: true };
      }
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
      case 'HOTKEY':
        return handleHotkeyAction(message.action);
      case 'GET_COMMANDS':
        return getCommandsStatus();
      case 'GET_SHORTCUTS': {
        const settings = await getSettings();
        return { ok: true, shortcuts: normalizeShortcuts(settings.shortcuts) };
      }
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
  handle()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    await handleHotkeyAction(command);
  } catch (err) {
    console.warn('[TabWall] onCommand failed:', err);
  }
});

chrome.action.onClicked.addListener(async () => {
  await toggleParkOnActiveTab();
});

// Kick migration early
ensureMediaMigration().catch(() => {});
