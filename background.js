/**
 * TabWall — Service Worker
 * Meta in chrome.storage.local; images in IndexedDB (mediaDb.js)
 */
importScripts('mediaDb.js', 'backupBuild.js');

const Media = self.TabWallMediaDB;
const Build = self.TabWallBackupBuild;

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

const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  saveGroupCapture: 'all',
  restoreGroupIn: 'currentWindow',
  autoBackup: { ...DEFAULT_AUTO_BACKUP },
};

const AUTO_BACKUP_ALARM = 'tabwall-auto-backup-schedule';
const AUTO_BACKUP_ONCHANGE_ALARM = 'tabwall-auto-backup-onchange';

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
  return {
    kind: 'group',
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: safeText(raw.title, DATA_LIMITS.MAX_TITLE_LENGTH),
    color: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'].includes(raw.color)
      ? raw.color
      : 'grey',
    collapsed: Boolean(raw.collapsed),
    note: safeText(raw.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(raw.tags),
    savedAt: safeTimestamp(raw.savedAt),
    tabs,
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

async function setParkedItems(items, options = {}) {
  const stored = items.map(normalizeItem).filter(Boolean).map(toStoredMeta);
  const payload = {
    [STORAGE_ITEMS]: stored,
    [STORAGE_TABS]: stored
      .filter((i) => i.kind === 'tab')
      .map(({ kind, hasThumb, hasSnap, ...rest }) => rest),
    [DATA_VERSION_KEY]: DATA_VERSION,
  };
  if (Array.isArray(options.tagCatalog)) payload[TAG_CATALOG_KEY] = options.tagCatalog;
  if (options.settings && typeof options.settings === 'object') payload[SETTINGS_KEY] = options.settings;
  await chrome.storage.local.set(payload);
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
    return { ...item, tabs };
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
  const [parkedItems, settingsData, tagCatalog] = await Promise.all([
    getParkedItems(),
    chrome.storage.local.get(SETTINGS_KEY),
    getTagCatalog(),
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
      };
    }
    return { ...item, id: crypto.randomUUID(), __stageItemId: item.id };
  });
}

async function persistInlineMediaToIdb(items) {
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
  if (member) {
    const groupId = member.__stageGroupId || item.__stageGroupId || item.id;
    const memberId = member.__stageMemberId || member.id;
    return Media.mediaKeyMember(groupId, memberId);
  }
  return Media.mediaKeyTab(item.__stageItemId || item.id);
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

    try {
      if (append) {
        await setParkedItems([...existing, ...items]);
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
      await setParkedItems(items, { tagCatalog, settings: importedSettings });
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

/**
 * Commit a parked tab from a live chrome.tabs Tab (or pending snapshot fields).
 * @param {object} tabLike - { id?, windowId?, url, title, favIconUrl }
 * @param {{ replaceMatchIds?: string[] }} opts
 */
async function commitSaveTab(tabLike, opts = {}) {
  const replaceMatchIds = opts.replaceMatchIds || [];
  const restoreHint = await findRestoreHint(tabLike.url);
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
    note: restoreHint?.note || '',
    tags: Array.isArray(restoreHint?.tags) ? restoreHint.tags : [],
    savedAt: Date.now(),
    hasThumb,
    hasSnap,
  };

  const list = await getParkedItems();
  list.unshift(entry);
  await setParkedItems(list);
  try {
    await consumeRestoreHint(restoreHint?.id);
  } catch (err) {
    console.warn('[TabWall] restore hint cleanup failed:', err);
  }

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
  const mediaState = { created: new Set() };
  const obsoleteMediaKeys = new Set();
  const markObsolete = (item) => {
    for (const key of Media.keysForItem(item)) obsoleteMediaKeys.add(key);
  };
  const finalize = async (next) => {
    await setParkedItems(next);
    try {
      await Media.removeMany([...obsoleteMediaKeys]);
    } catch (err) {
      appLogPush('warn', 'stack', 'old media cleanup deferred', err?.message || err);
    }
  };

  try {
    // tab → tab : create stack at target position
    if (!srcGroup && !tgtGroup) {
      const groupId = crypto.randomUUID();
      markObsolete(source);
      markObsolete(target);
      const mTarget = await tabItemToMember(target, groupId, 0, mediaState);
      const mSource = await tabItemToMember(source, groupId, 1, mediaState);
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
      await finalize(next);
      return { ok: true, items: next, groupId };
    }

    // tab → group : add tab into group
    if (!srcGroup && tgtGroup) {
      markObsolete(source);
      const member = await tabItemToMember(source, target.id, (target.tabs || []).length, mediaState);
      const updated = {
        ...target,
        tabs: [...(target.tabs || []), member],
        savedAt: Date.now(),
      };
      const next = list
        .map((i) => (i.id === target.id ? updated : i))
        .filter((i) => i.id !== source.id);
      await finalize(next);
      return { ok: true, items: next, groupId: target.id };
    }

    // group → tab : add tab into group, place group where tab was
    if (srcGroup && !tgtGroup) {
      markObsolete(target);
      const member = await tabItemToMember(target, source.id, (source.tabs || []).length, mediaState);
      const updated = {
        ...source,
        tabs: [...(source.tabs || []), member],
        savedAt: Date.now(),
      };
      const next = replaceListKeepingOrder(list, [sourceId, targetId], targetId, updated);
      await finalize(next);
      return { ok: true, items: next, groupId: source.id };
    }

    // group → group : merge source members into target
    if (srcGroup && tgtGroup) {
      markObsolete(source);
      const extra = await rekeyGroupMembers(source, target.id, (target.tabs || []).length, mediaState);
      const updated = {
        ...target,
        tabs: [...(target.tabs || []), ...extra],
        savedAt: Date.now(),
      };
      const next = list
        .map((i) => (i.id === target.id ? updated : i))
        .filter((i) => i.id !== source.id);
      await finalize(next);
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
      note: restoreGroupHint?.note || '',
      tags: Array.isArray(restoreGroupHint?.tags) ? restoreGroupHint.tags : [],
      savedAt: Date.now(),
      tabs: groupTabs,
    };

    const list = await getParkedItems();
    list.unshift(groupItem);
    await setParkedItems(list);
    try {
      await consumeRestoreHint(restoreGroupHint?.id);
    } catch (err) {
      console.warn('[TabWall] group restore hint cleanup failed:', err);
    }

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

async function handleCommandAction(action) {
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
    await Media.removeMany(Media.keysForItem(item));
  } catch (err) {
    // Metadata is already committed; retain correctness and let orphan GC retry.
    appLogPush('warn', 'restore', 'media cleanup deferred', err?.message || err);
  }
  return { ok: true, remaining: next.length };
}

async function restoreTab(id) {
  const list = await getParkedItems();
  const i = list.findIndex((t) => t.id === id);
  if (i === -1) return { ok: false, error: 'not_found' };
  const item = list[i];
  if (item.kind === 'group') return restoreGroup(id);
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

const MUTATING_MESSAGE_TYPES = new Set([
  'RESTORE_TAB',
  'RESTORE_GROUP',
  'RESTORE_GROUP_MEMBER',
  'UPDATE_GROUP_MEMBER',
  'DELETE_TAB',
  'DELETE_ITEM',
  'UPDATE_TAB',
  'UPDATE_ITEM',
  'REORDER_TABS',
  'REORDER_ITEMS',
  'STACK_ITEMS',
  'SAVE_ACTIVE_GROUP',
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

chrome.action.onClicked.addListener(async () => {
  await enqueueMutation(() => toggleParkOnActiveTab());
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
    commitSaveTab,
    saveCurrentTab,
    saveActiveGroup,
    restoreTab,
    restoreGroup,
    restoreGroupMember,
  };
}

// Kick migration early
ensureMediaMigration()
  .then(async () => {
    await Media.removeExpiredImportStages?.();
    await cleanupOrphanMedia();
  })
  .catch((err) => console.warn('[TabWall] startup media cleanup failed:', err));
