/**
 * TabWall background — settings / auto-backup / export hydrate / image compress entry helpers.
 * importScripts shared SW scope with background.js.
 */

// ── original background.js L875-1274 ──
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
    intervalUnit: unit,
    intervalValue: clampInt(valueRaw, bounds.min, bounds.max, bounds.fallback),
    maxKeep: clampInt(o.maxKeep, 1, 99, 5),
    subfolder,
    folderPath: typeof o.folderPath === 'string' ? o.folderPath : '',
    lastSuccessAt: Number(o.lastSuccessAt) || 0,
    lastError: typeof o.lastError === 'string' ? o.lastError : '',
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

function normalizeWallpaper(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const fit = o.fit === 'fitWidth' || o.fit === 'fitHeight' || o.fit === 'original'
    ? o.fit
    : 'center';
  return {
    enabled: o.enabled === true,
    fit,
    opacity: clampInt(o.opacity, 15, 70, 40),
    blurPx: clampInt(o.blurPx, 0, 32, 16),
    mime: typeof o.mime === 'string' && /^image\/(webp|png|jpeg|jpg)$/i.test(o.mime)
      ? String(o.mime).toLowerCase()
      : '',
    width: clampInt(o.width, 0, 16384, 0),
    height: clampInt(o.height, 0, 16384, 0),
    updatedAt: Number(o.updatedAt) > 0 ? Number(o.updatedAt) : 0,
  };
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
  merged.newTabOverride = merged.newTabOverride !== false;
  if (self.TabWallAi?.normalizeAiSettings) {
    merged.ai = self.TabWallAi.normalizeAiSettings(merged.ai);
  }
  merged.preSaveEdit = merged.preSaveEdit !== false;
  merged.wallpaper = normalizeWallpaper(merged.wallpaper);
  return merged;
}

async function patchSettings(partial) {
  const current = await getSettings();
  const patch = partial && typeof partial === 'object' ? partial : {};
  // lastSuccessAt / lastError are owned by runAutoBackup. Ignore the legacy
  // change-trigger fields so old settings pages cannot re-enable that path.
  let autoBackupPatch = patch.autoBackup;
  if (autoBackupPatch && typeof autoBackupPatch === 'object') {
    autoBackupPatch = { ...autoBackupPatch };
    delete autoBackupPatch.lastSuccessAt;
    delete autoBackupPatch.dirtyAt;
    delete autoBackupPatch.lastError;
    delete autoBackupPatch.onChange;
  }
  const next = normalizeSettings({
    ...current,
    ...patch,
    autoBackup: autoBackupPatch
      ? { ...current.autoBackup, ...autoBackupPatch }
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
  if (autoBackupPatch) {
    const prev = current.autoBackup;
    const nextAb = next.autoBackup;
    if (
      nextAb.enabled !== prev.enabled ||
      nextAb.intervalUnit !== prev.intervalUnit ||
      nextAb.intervalValue !== prev.intervalValue
    ) {
      await syncAutoBackupAlarms(nextAb);
    }
  }
  // Settings-only writes do not trigger backups; preferences ride along on the
  // next scheduled or manually requested backup.
  return { ok: true, settings: next };
}

async function patchAutoBackup(partial) {
  const settings = await getSettings();
  const autoBackup = normalizeAutoBackup({ ...settings.autoBackup, ...partial });
  const next = { ...settings, autoBackup };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return autoBackup;
}

async function syncAutoBackupAlarms(autoBackup) {
  const ab = normalizeAutoBackup(autoBackup);
  await chrome.alarms.clear(AUTO_BACKUP_ALARM);
  await chrome.alarms.clear(LEGACY_AUTO_BACKUP_ONCHANGE_ALARM);
  if (!ab.enabled) return;
  const periodInMinutes = Math.max(10, autoBackupIntervalMinutes(ab));
  // Align first fire with lastSuccessAt so re-sync (settings write / SW wake)
  // does not restart the full period from "now".
  let delayInMinutes = periodInMinutes;
  if (ab.lastSuccessAt) {
    const elapsedMin = (Date.now() - ab.lastSuccessAt) / 60000;
    delayInMinutes = Math.max(1, periodInMinutes - elapsedMin);
  }
  await chrome.alarms.create(AUTO_BACKUP_ALARM, {
    delayInMinutes: Math.min(delayInMinutes, periodInMinutes),
    periodInMinutes,
  });
}

/**
 * Gate for non-manual auto-backup paths. Manual (reason === 'manual') always
 * proceeds when force or enabled. schedule and local (New Tab catch-up) only
 * proceed when the configured periodic backup is due.
 * @param {object} ab normalizeAutoBackup result
 * @param {{ force?: boolean, reason?: string }} opts
 * @returns {{ run: boolean, skipReason?: string }}
 */
function autoBackupShouldRun(ab, opts = {}) {
  const force = Boolean(opts.force);
  const reason = typeof opts.reason === 'string' && opts.reason ? opts.reason : 'manual';
  const normalized = normalizeAutoBackup(ab);
  const isManual = reason === 'manual';

  if (isManual) {
    if (!force && !normalized.enabled) return { run: false, skipReason: 'disabled' };
    return { run: true };
  }

  if (!normalized.enabled) return { run: false, skipReason: 'disabled' };

  const intervalMs = Math.max(10, autoBackupIntervalMinutes(normalized)) * 60 * 1000;
  const now = Date.now();
  const sinceOk = normalized.lastSuccessAt ? now - normalized.lastSuccessAt : Infinity;
  const dueSchedule = !normalized.lastSuccessAt || sinceOk >= intervalMs;

  if (reason === 'onchange') {
    return { run: false, skipReason: 'onchange_disabled' };
  }

  if (reason === 'schedule') {
    if (!dueSchedule) return { run: false, skipReason: 'not_due' };
    return { run: true };
  }

  // New Tab / park catch-up: only recover a missed periodic backup.
  // First-enable (!lastSuccessAt) waits for the schedule alarm. park.html is
  // also the New Tab page, so treating that state as due downloads a file on
  // tab open.
  if (reason === 'local') {
    const overdue = normalized.lastSuccessAt > 0 && sinceOk >= intervalMs;
    if (!overdue) return { run: false, skipReason: 'not_due' };
    return { run: true };
  }

  // Any other automatic reason follows the periodic schedule.
  if (!dueSchedule) return { run: false, skipReason: 'not_due' };
  return { run: true };
}

/**
 * Auto backup → Chrome Downloads/{subfolder}/…
 * Absolute folder path is taken from DownloadItem.filename after success.
 * @param {{ force?: boolean, reason?: string }} opts
 */
async function runAutoBackup(opts = {}) {
  const force = Boolean(opts.force);
  const reason = typeof opts.reason === 'string' && opts.reason ? opts.reason : 'manual';
  if (autoBackupRunning) return { ok: false, error: 'busy' };
  autoBackupRunning = true;
  try {
    const settings = await getSettings();
    const ab = settings.autoBackup;
    const gate = autoBackupShouldRun(ab, { force, reason });
    if (!gate.run) {
      if (gate.skipReason === 'disabled') return { ok: false, error: 'disabled' };
      return { ok: true, skipped: true, reason: gate.skipReason };
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

// ── original background.js L1812-2874 ──
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

// Cache of media already re-encoded to data URLs for the auto full-backup
// path, keyed by updatedAt so any Media.put*/removeMany call naturally
// invalidates it (a mismatched or missing updatedAt forces a fresh encode).
// Covers Media.get() lookups (tab/group-member thumb+snapshot) only — note
// attachments go through Media.getAttachment(), which doesn't expose
// updatedAt, so they're left out of this cache to avoid widening that API's
// contract for a comparatively small win (see exportBackup/hydrateItemMedia).
const autoBackupMediaCache = new Map(); // mediaKey -> { updatedAt, thumbnail, snapshot }

async function hydrateMediaFields(key) {
  const med = await Media.get(key);
  const cached = autoBackupMediaCache.get(key);
  if (cached && cached.updatedAt === med.updatedAt) {
    return { thumbnail: cached.thumbnail, snapshot: cached.snapshot };
  }
  const thumbnail = med.thumb ? await Media.blobToDataUrl(med.thumb) : '';
  const snapshot = med.snap ? await Media.blobToDataUrl(med.snap) : '';
  autoBackupMediaCache.set(key, { updatedAt: med.updatedAt, thumbnail, snapshot });
  return { thumbnail, snapshot };
}

async function hydrateItemMedia(item) {
  if (item.kind === 'group') {
    const tabs = await mapWithConcurrency(item.tabs || [], 4, async (m) => ({
      ...m,
      ...(await hydrateMediaFields(Media.mediaKeyMember(item.id, m.id))),
    }));
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
  return { ...item, ...(await hydrateMediaFields(Media.mediaKeyTab(item.id))) };
}

async function hydrateWallpaperSettings(settings) {
  const next = settings && typeof settings === 'object' ? { ...settings } : {};
  const wallpaper = normalizeWallpaper(next.wallpaper);
  next.wallpaper = { ...wallpaper };
  if (!wallpaper.enabled || !Media?.getAttachment) return next;
  try {
    const blob = await Media.getAttachment(Media.mediaKeyWallpaper());
    if (blob && Media.blobToDataUrl) {
      next.wallpaper.data = await Media.blobToDataUrl(blob);
    }
  } catch (err) {
    console.warn('[TabWall] wallpaper hydrate failed:', err);
  }
  return next;
}

/**
 * @param {'lite'|'full'} mode
 * @param {{ hydrate?: boolean }} opts hydrate=true inlines media as data URLs (for SW-local full build only; never over message)
 */
async function exportBackup(mode = 'lite', { hydrate = false } = {}) {
  const [parkedItems, settingsData, tagCatalog, canvasLayout, pageAnnotations] = await Promise.all([
    getParkedItems(),
    chrome.storage.local.get(SETTINGS_KEY),
    getTagCatalog(),
    getCanvasLayout(),
    self.TabWallPageAnnotate?.getPageAnnotationsList
      ? self.TabWallPageAnnotate.getPageAnnotationsList()
      : chrome.storage.local.get('pageAnnotations').then((data) => (
        Array.isArray(data.pageAnnotations) ? data.pageAnnotations : []
      )),
  ]);

  let items = parkedItems;
  let media = 'none';
  let settings = settingsData[SETTINGS_KEY] || {};
  if (mode === 'full' && hydrate) {
    items = await mapWithConcurrency(parkedItems, 4, hydrateItemMedia);
    media = 'inline';
    settings = await hydrateWallpaperSettings(settings);
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
      settings,
      tagCatalog,
      canvasLayout,
      pageAnnotations: Array.isArray(pageAnnotations) ? pageAnnotations : [],
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

function remapImportedPageAnnotations(pageAnnotations, items, { append = false } = {}) {
  const topLevelIds = new Set((items || [])
    .filter((item) => item?.kind === 'note')
    .map((item) => item.id));
  const sourceToReminted = new Map((items || [])
    .filter((item) => item?.kind === 'note' && item.__stageItemId)
    .map((item) => [item.__stageItemId, item.id]));
  return (Array.isArray(pageAnnotations) ? pageAnnotations : [])
    .map((raw) => {
      const annotation = self.TabWallPageAnnotate?.normalizePageAnnotation?.(raw);
      if (!annotation) return null;
      const stickers = (annotation.stickers || [])
        .map((sticker) => {
          const noteId = append
            ? sourceToReminted.get(sticker.noteId)
            : (topLevelIds.has(sticker.noteId) ? sticker.noteId : '');
          return noteId ? { ...sticker, noteId } : null;
        })
        .filter(Boolean);
      return self.TabWallPageAnnotate.normalizePageAnnotation({ ...annotation, stickers });
    })
    .filter(Boolean);
}

function mergeImportedPageAnnotations(existing, incoming) {
  const stickers = new Map((existing?.stickers || []).map((sticker) => [sticker.noteId, sticker]));
  for (const sticker of incoming?.stickers || []) stickers.set(sticker.noteId, sticker);
  return self.TabWallPageAnnotate.normalizePageAnnotation({
    ...(existing || {}),
    ...(incoming || {}),
    stickers: [...stickers.values()],
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
    if (typeof collectStackUndoMediaKeys === 'function') {
      for (const key of collectStackUndoMediaKeys()) keep.add(key);
    }
  } catch {
    // undo snapshots are best-effort; never fail item cleanup
  }
  try {
    const settings = await getSettings();
    if (settings?.wallpaper?.enabled && Media.mediaKeyWallpaper) {
      keep.add(Media.mediaKeyWallpaper());
    }
  } catch {
    // settings read is best-effort; never drop keep-set of item media
  }
  try {
    const annotations = self.TabWallPageAnnotate?.getPageAnnotationsList
      ? await self.TabWallPageAnnotate.getPageAnnotationsList()
      : [];
    if (Media.mediaKeyPageInk) {
      for (const annotation of annotations) {
        if (annotation?.id && annotation.hasInk) keep.add(Media.mediaKeyPageInk(annotation.id));
      }
    }
  } catch {
    // page ink cleanup is best-effort; never drop the existing keep-set
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
  const importedPageAnnotations = remapImportedPageAnnotations(backup.pageAnnotations, items, { append });

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
      pageAnnotations: importedPageAnnotations,
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
        if (Array.isArray(backup.pageAnnotations) && self.TabWallPageAnnotate) {
          const existingLive = await self.TabWallPageAnnotate.getPageAnnotationsList();
          const byUrl = new Map(existingLive.map((ann) => [ann.url, ann]));
          for (const next of importedPageAnnotations) {
            if (!next) continue;
            const merged = mergeImportedPageAnnotations(byUrl.get(next.url), next);
            if (merged) byUrl.set(next.url, merged);
          }
          await chrome.storage.local.set({
            [self.TabWallPageAnnotate.PAGE_ANNOTATIONS_KEY]: [...byUrl.values()],
          });
        }
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
      if (self.TabWallPageAnnotate) {
        const incomingLive = importedPageAnnotations;
        await chrome.storage.local.set({
          [self.TabWallPageAnnotate.PAGE_ANNOTATIONS_KEY]: incomingLive,
        });
      }
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
      if (item.kind === 'note') updated.markdown = appendUniqueAutoSaveNote(item.markdown, [patch.note]);
      else updated.note = appendUniqueAutoSaveNote(item.note, [patch.note]);
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
    const removedKeys = removed.flatMap((item) => Media.keysForItem(item));
    await Media.removeMany(removedKeys);
    removedKeys.forEach((key) => autoBackupMediaCache.delete(key));
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
const DRAW_BADGE_TEXT = '✎';
const DRAW_BADGE_COLOR = '#c97858';

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

  const urlIndex = await getParkedUrlIndex();
  const parked = urlIndex.has(normalizeUrlKey(tab.url));
  const live = self.TabWallPageAnnotate?.getPageAnnotation
    ? await self.TabWallPageAnnotate.getPageAnnotation(tab.url)
    : null;
  const drawing = live?.overlayVisible === true;
  if (drawing) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: DRAW_BADGE_COLOR });
    await chrome.action.setBadgeText({ tabId, text: DRAW_BADGE_TEXT });
    return;
  }
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
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs[0]) return tabs[0];
  } catch {
    // Fall through for older Chromium implementations.
  }
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

async function openStandaloneParkTab({ focusReminderId = '' } = {}) {
  const baseUrl = getParkPageUrl(STANDALONE_SURFACE);
  const url = focusReminderId
    ? `${baseUrl}&focusReminder=${encodeURIComponent(String(focusReminderId))}`
    : baseUrl;
  try {
    // tabs.query({ url }) accepts match patterns, not arbitrary URLs with a
    // query string. Query all tabs and compare the extension URL directly so
    // restricted-page fallbacks can still create or focus the standalone UI.
    let matches = [];
    try {
      const tabs = await chrome.tabs.query({ windowType: 'normal' });
      matches = (tabs || []).filter((tab) => {
        const candidate = typeof tab?.url === 'string' ? tab.url : '';
        return focusReminderId
          ? candidate === baseUrl || candidate.startsWith(`${baseUrl}&`)
          : candidate === baseUrl;
      });
    } catch {
      // Reuse is best-effort; still try to create the standalone page.
    }
    const existing = (matches || []).find((tab) => tab?.id != null);
    if (existing) {
      try {
        await chrome.tabs.update(existing.id, { active: true, ...(focusReminderId ? { url } : {}) });
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

async function ensureAiPanelContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AI_PANEL_PING' });
    return true;
  } catch {
    // The static content script is not present on tabs that existed before
    // the extension loaded; inject the small AI surface on demand.
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['aiUiCore.js', 'aiPanel.js'],
    });
    return true;
  } catch (err) {
    console.warn('[TabWall] inject AI panel failed:', err);
    return false;
  }
}

async function notifyAiPanelUnavailable(tab, error = 'restricted_page') {
  const title = 'TabWall AI';
  const message = error === 'restricted_page'
    ? '目前頁面受 Chrome 限制，無法注入 AI 面板。請切換到一般網頁。'
    : '無法在目前頁面開啟 AI 面板。';
  try {
    if (chrome.notifications?.create) {
      await chrome.notifications.create(`tabwall-ai-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title,
        message,
      });
    }
  } catch (notificationError) {
    console.warn('[TabWall] AI panel notification failed:', notificationError);
  }
  return { ok: false, mode: error === 'restricted_page' ? 'restricted' : 'unavailable', error, tabId: tab?.id ?? null };
}

async function openAiPanelOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return notifyAiPanelUnavailable(tab, 'no_active_tab');
  if (isRestrictedUrl(tab.url)) return notifyAiPanelUnavailable(tab, 'restricted_page');
  if (!await ensureAiPanelContentScript(tab.id)) return notifyAiPanelUnavailable(tab, 'inject_failed');
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_AI_PANEL' });
    return { ok: true, mode: 'panel', tabId: tab.id };
  } catch (err) {
    console.warn('[TabWall] open AI panel failed:', err);
    return notifyAiPanelUnavailable(tab, 'open_failed');
  }
}

async function toggleAiPanelOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return notifyAiPanelUnavailable(tab, 'no_active_tab');
  if (isRestrictedUrl(tab.url)) return notifyAiPanelUnavailable(tab, 'restricted_page');
  if (!await ensureAiPanelContentScript(tab.id)) return notifyAiPanelUnavailable(tab, 'inject_failed');
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_AI_PANEL' });
    if (response?.ok === false) return notifyAiPanelUnavailable(tab, 'open_failed');
    return { ok: true, mode: 'panel', tabId: tab.id, open: response?.open };
  } catch (err) {
    console.warn('[TabWall] toggle AI panel failed:', err);
    return notifyAiPanelUnavailable(tab, 'open_failed');
  }
}

async function sendToTab(tabId, message) {
  const ok = await ensureContentScript(tabId);
  if (!ok) throw new Error('inject_failed');
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (response?.ok === false) {
    throw new Error(response.error || 'content_action_failed');
  }
  return response;
}

async function toggleParkOnTab(tab) {
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

async function toggleParkOnActiveTab() {
  return toggleParkOnTab(await getActiveTab());
}

async function getTabById(tabId) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function openParkOnTabTarget(tab) {
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

async function openParkOnActiveTab(targetTabId = null) {
  const tab = targetTabId == null
    ? await getActiveTab()
    : await getTabById(targetTabId);
  return openParkOnTabTarget(tab || await getActiveTab());
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
