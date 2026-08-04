/**
 * TabWall — Service Worker
 * Meta in chrome.storage.local; images in IndexedDB (mediaDb.js)
 */
importScripts('mediaDb.js');

const Media = self.TabWallMediaDB;
const STORAGE_TABS = 'parkedTabs'; // legacy
const STORAGE_ITEMS = 'parkedItems';
const SETTINGS_KEY = 'settings';
const TAG_CATALOG_KEY = 'tagCatalog';
const DATA_VERSION_KEY = 'dataVersion';
const DATA_VERSION = 4;

const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  saveGroupCapture: 'all',
  restoreGroupIn: 'currentWindow',
};

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

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

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

async function importBackup(backup) {
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

  // Move any inline media into IDB
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

  await setParkedItems(items);
  const payload = {
    [TAG_CATALOG_KEY]: Array.isArray(backup.tagCatalog) ? backup.tagCatalog : [],
    [DATA_VERSION_KEY]: DATA_VERSION,
  };
  if (backup.settings && typeof backup.settings === 'object') {
    payload[SETTINGS_KEY] = backup.settings;
  }
  await chrome.storage.local.set(payload);
  return { ok: true };
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

async function toggleParkOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    await flashBadge('!');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PARK' });
    return;
  } catch {
    // inject
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PARK' });
  } catch (err) {
    console.warn('[TabWall] inject/toggle failed:', err);
    await flashBadge('!');
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

// ─── Save tab ──────────────────────────────────────────────────────

async function saveCurrentTab(tab) {
  if (!tab || tab.id == null) {
    await flashBadge('!');
    return;
  }
  if (isRestrictedUrl(tab.url)) {
    await flashBadge('!');
    return;
  }

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (err) {
    console.warn('[TabWall] captureVisibleTab failed:', err);
    await flashBadge('!');
    return;
  }

  let thumbBlob;
  let snapBlob;
  try {
    thumbBlob = await compressToBlob(dataUrl, THUMB);
    snapBlob = await compressToBlob(dataUrl, SNAPSHOT);
  } catch (err) {
    console.warn('[TabWall] compress failed:', err);
    await flashBadge('!');
    return;
  }

  const id = crypto.randomUUID();
  await Media.putFromBlobs(Media.mediaKeyTab(id), thumbBlob, snapBlob);

  const entry = {
    kind: 'tab',
    id,
    url: tab.url,
    title: tab.title || tab.url || 'Untitled',
    favIconUrl: tab.favIconUrl || '',
    note: '',
    tags: [],
    savedAt: Date.now(),
    hasThumb: Boolean(thumbBlob),
    hasSnap: Boolean(snapBlob),
  };

  const list = await getParkedItems();
  list.unshift(entry);
  await setParkedItems(list);

  const { afterSave } = await getSettings();
  if (afterSave === 'close') {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (err) {
      console.warn('[TabWall] tabs.remove failed:', err);
    }
  }
  await flashBadge(String(Math.min(list.length, 99)), '#3b82f6', 1500);
}

// ─── Save group ────────────────────────────────────────────────────

async function saveActiveGroup() {
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
      const { thumbBlob, snapBlob } = await captureTabBlobs(tab.windowId, m.id);
      const flags = await Media.putFromBlobs(
        Media.mediaKeyMember(groupId, memberId),
        thumbBlob,
        snapBlob
      );
      hasThumb = flags.hasThumb;
      hasSnap = flags.hasSnap;
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
        return importBackup(message.backup);
      case 'BATCH_UPDATE_ITEMS':
        return batchUpdateItems(message.ids, {
          note: message.note,
          tags: message.tags,
          tagMode: message.tagMode,
        });
      case 'BATCH_DELETE_ITEMS':
        return batchDeleteItems(message.ids);
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
  if (command === 'save-tab') {
    await saveCurrentTab(await getActiveTab());
    return;
  }
  if (command === 'save-group') {
    await saveActiveGroup();
    return;
  }
  if (command === 'toggle-park') {
    await toggleParkOnActiveTab();
  }
});

chrome.action.onClicked.addListener(async () => {
  await toggleParkOnActiveTab();
});

// Kick migration early
ensureMediaMigration().catch(() => {});
