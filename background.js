/**
 * TabWall — Service Worker
 * Single-tab park + Tab Group park/restore
 */

const STORAGE_TABS = 'parkedTabs'; // legacy
const STORAGE_ITEMS = 'parkedItems';
const SETTINGS_KEY = 'settings';
const TAG_CATALOG_KEY = 'tagCatalog';

const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  saveGroupCapture: 'all', // all | none | activeOnly
  restoreGroupIn: 'currentWindow', // currentWindow | newWindow
};

const THUMB = { maxWidth: 360, quality: 0.5 };
const SNAPSHOT = { maxWidth: null, quality: 0.85 };

// ─── Storage: parked items + migration ─────────────────────────────

function normalizeTabItem(raw) {
  return {
    kind: 'tab',
    id: raw.id || crypto.randomUUID(),
    url: raw.url || '',
    title: raw.title || raw.url || 'Untitled',
    favIconUrl: raw.favIconUrl || '',
    thumbnail: raw.thumbnail || '',
    snapshot: raw.snapshot || '',
    note: typeof raw.note === 'string' ? raw.note : '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    savedAt: raw.savedAt || Date.now(),
  };
}

function normalizeGroupItem(raw) {
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.map((m, i) => ({
        id: m.id || crypto.randomUUID(),
        url: m.url || '',
        title: m.title || m.url || 'Untitled',
        favIconUrl: m.favIconUrl || '',
        thumbnail: m.thumbnail || '',
        snapshot: m.snapshot || '',
        pinned: Boolean(m.pinned),
        indexInGroup: typeof m.indexInGroup === 'number' ? m.indexInGroup : i,
        note: typeof m.note === 'string' ? m.note : '',
        tags: Array.isArray(m.tags) ? m.tags : [],
      }))
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

async function getParkedItems() {
  const data = await chrome.storage.local.get([STORAGE_ITEMS, STORAGE_TABS]);
  if (Array.isArray(data[STORAGE_ITEMS]) && data[STORAGE_ITEMS].length > 0) {
    return data[STORAGE_ITEMS].map(normalizeItem).filter(Boolean);
  }
  // migrate legacy parkedTabs
  if (Array.isArray(data[STORAGE_TABS]) && data[STORAGE_TABS].length > 0) {
    const items = data[STORAGE_TABS].map((t) => normalizeTabItem({ ...t, kind: 'tab' }));
    await setParkedItems(items);
    return items;
  }
  if (Array.isArray(data[STORAGE_ITEMS])) return [];
  return [];
}

async function setParkedItems(items) {
  const normalized = items.map(normalizeItem).filter(Boolean);
  // dual-write flat tabs for legacy consumers / partial backup compat
  const flatTabs = normalized
    .filter((i) => i.kind === 'tab')
    .map(({ kind, ...rest }) => rest);
  await chrome.storage.local.set({
    [STORAGE_ITEMS]: normalized,
    [STORAGE_TABS]: flatTabs,
  });
  return normalized;
}

/** @deprecated use getParkedItems — returns tab-shaped entries only for old callers */
async function getParkedTabs() {
  const items = await getParkedItems();
  return items
    .filter((i) => i.kind === 'tab')
    .map(({ kind, ...rest }) => rest);
}

async function setParkedTabs(tabs) {
  // merge: replace all tab-kind items, keep groups
  const items = await getParkedItems();
  const groups = items.filter((i) => i.kind === 'group');
  const nextTabs = tabs.map((t) => normalizeTabItem(t));
  await setParkedItems([...nextTabs, ...groups]);
}

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
  if (Array.isArray(item.tags)) {
    for (const t of item.tags) fn(t);
  }
  if (item.kind === 'group' && Array.isArray(item.tabs)) {
    for (const m of item.tabs) {
      if (Array.isArray(m.tags)) {
        for (const t of m.tags) fn(t);
      }
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
  return names.map((name) => ({
    name,
    count: countTagUsage(items, name),
  }));
}

function mapTagsInItem(item, mapFn) {
  const next = { ...item };
  if (Array.isArray(item.tags)) {
    next.tags = mapFn(item.tags);
  }
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
      tags
        .map((t) => (t === oldName ? newName : t))
        .filter((t, i, arr) => arr.indexOf(t) === i)
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
  if (!Array.isArray(tags) || tags.length === 0) return;
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

function stripMediaFromItems(items) {
  return items.map((item) => {
    if (item.kind === 'group') {
      return {
        ...item,
        tabs: (item.tabs || []).map((m) => ({
          ...m,
          thumbnail: '',
          snapshot: '',
        })),
      };
    }
    return { ...item, thumbnail: '', snapshot: '' };
  });
}

async function exportBackup(mode = 'lite') {
  const [parkedItems, settingsData, tagCatalog] = await Promise.all([
    getParkedItems(),
    chrome.storage.local.get(SETTINGS_KEY),
    getTagCatalog(),
  ]);
  const items = mode === 'full' ? parkedItems : stripMediaFromItems(parkedItems);
  const parkedTabs = items
    .filter((i) => i.kind === 'tab')
    .map(({ kind, ...rest }) => rest);
  return {
    ok: true,
    backup: {
      format: 'tabwall-backup',
      version: 3,
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
  await setParkedItems(items);
  const payload = {
    [TAG_CATALOG_KEY]: Array.isArray(backup.tagCatalog) ? backup.tagCatalog : [],
  };
  if (backup.settings && typeof backup.settings === 'object') {
    payload[SETTINGS_KEY] = backup.settings;
  }
  await chrome.storage.local.set(payload);
  return { ok: true };
}

async function batchUpdateItems(ids, patch) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'empty_ids' };
  const idSet = new Set(ids);
  const list = await getParkedItems();
  const tagMode = patch.tagMode === 'replace' ? 'replace' : 'merge';
  let changed = 0;
  const next = list.map((item) => {
    if (!idSet.has(item.id)) return item;
    changed++;
    const updated = { ...item };
    if (typeof patch.note === 'string' && patch.note.length > 0) {
      updated.note = patch.note;
    }
    if (Array.isArray(patch.tags)) {
      const incoming = patch.tags
        .map((t) => String(t).trim())
        .filter(Boolean)
        .filter((t, i, arr) => arr.indexOf(t) === i);
      if (tagMode === 'replace') {
        updated.tags = incoming;
      } else {
        const set = new Set([...(item.tags || []), ...incoming]);
        updated.tags = [...set];
      }
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
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'empty_ids' };
  const idSet = new Set(ids);
  const list = await getParkedItems();
  const next = list.filter((i) => !idSet.has(i.id));
  await setParkedItems(next);
  return { ok: true, remaining: next.length };
}

// ─── Image compression ─────────────────────────────────────────────

async function compressImage(dataUrl, opts = {}) {
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
  const compressedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return blobToDataUrl(compressedBlob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
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

// ─── Overlay toggle ────────────────────────────────────────────────

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

// ─── Capture helpers ───────────────────────────────────────────────

async function captureTabImages(windowId, tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await waitTabComplete(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    const thumbnail = await compressImage(dataUrl, THUMB);
    const snapshot = await compressImage(dataUrl, SNAPSHOT);
    return { thumbnail, snapshot };
  } catch (err) {
    console.warn('[TabWall] capture failed for tab', tabId, err);
    return { thumbnail: '', snapshot: '' };
  }
}

// ─── Save single tab ───────────────────────────────────────────────

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

  let thumbnail;
  let snapshot;
  try {
    thumbnail = await compressImage(dataUrl, THUMB);
    snapshot = await compressImage(dataUrl, SNAPSHOT);
  } catch (err) {
    console.warn('[TabWall] compressImage failed:', err);
    await flashBadge('!');
    return;
  }

  const entry = normalizeTabItem({
    id: crypto.randomUUID(),
    url: tab.url,
    title: tab.title || tab.url || 'Untitled',
    favIconUrl: tab.favIconUrl || '',
    thumbnail,
    snapshot,
    note: '',
    tags: [],
    savedAt: Date.now(),
  });

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
    console.warn('[TabWall] Active tab is not in a group');
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
  if (members.length === 0) {
    await flashBadge('!');
    return { ok: false, error: 'empty_group' };
  }

  const settings = await getSettings();
  const captureMode = settings.saveGroupCapture || 'all';
  const originalActiveId = tab.id;

  await flashBadge('…', '#3b82f6', 60000);

  const groupTabs = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    let thumbnail = '';
    let snapshot = '';
    const shouldCapture =
      captureMode === 'all' ||
      (captureMode === 'activeOnly' && m.id === originalActiveId);

    if (shouldCapture && !isRestrictedUrl(m.url)) {
      await flashBadge(`${i + 1}/${members.length}`, '#3b82f6', 60000);
      const imgs = await captureTabImages(tab.windowId, m.id);
      thumbnail = imgs.thumbnail;
      snapshot = imgs.snapshot;
    }

    groupTabs.push({
      id: crypto.randomUUID(),
      url: m.url || '',
      title: m.title || m.url || 'Untitled',
      favIconUrl: m.favIconUrl || '',
      thumbnail,
      snapshot,
      pinned: Boolean(m.pinned),
      indexInGroup: i,
      note: '',
      tags: [],
    });
  }

  // restore focus to original if still open
  try {
    await chrome.tabs.update(originalActiveId, { active: true });
  } catch {
    // may have been closed mid-way — ignore
  }

  const groupItem = normalizeGroupItem({
    id: crypto.randomUUID(),
    title: meta.title || '',
    color: meta.color || 'grey',
    collapsed: Boolean(meta.collapsed),
    note: '',
    tags: [],
    savedAt: Date.now(),
    tabs: groupTabs,
  });

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

// ─── Restore ───────────────────────────────────────────────────────

async function restoreTab(id) {
  const list = await getParkedItems();
  const idx = list.findIndex((t) => t.id === id && t.kind === 'tab');
  if (idx === -1) {
    // try any kind tab-shaped
    const idx2 = list.findIndex((t) => t.id === id);
    if (idx2 === -1 || list[idx2].kind === 'group') return { ok: false, error: 'not_found' };
  }
  const i = list.findIndex((t) => t.id === id);
  const item = list[i];
  if (item.kind === 'group') return restoreGroup(id);

  list.splice(i, 1);
  await setParkedItems(list);
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

  let windowId;
  if (settings.restoreGroupIn === 'newWindow') {
    // create window with first restorable url
    const first = members.find((m) => isRestorableUrl(m.url));
    if (!first) return { ok: false, error: 'no_restorable_urls' };
    const win = await chrome.windows.create({ url: first.url, focused: true });
    windowId = win.id;
    const createdIds = [];
    const firstTab = win.tabs && win.tabs[0];
    if (firstTab?.id != null) createdIds.push(firstTab.id);

    for (const m of members) {
      if (m === first) continue;
      if (!isRestorableUrl(m.url)) continue;
      const t = await chrome.tabs.create({
        url: m.url,
        active: false,
        windowId,
      });
      createdIds.push(t.id);
    }

    if (createdIds.length === 0) return { ok: false, error: 'no_restorable_urls' };
    const groupId = await chrome.tabs.group({
      tabIds: createdIds,
      createProperties: { windowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: item.title || '',
      color: item.color || 'grey',
      collapsed: Boolean(item.collapsed),
    });
  } else {
    const createdIds = [];
    let skipped = 0;
    for (const m of members) {
      if (!isRestorableUrl(m.url)) {
        skipped++;
        continue;
      }
      const t = await chrome.tabs.create({ url: m.url, active: false });
      createdIds.push(t.id);
      windowId = t.windowId;
    }
    if (createdIds.length === 0) return { ok: false, error: 'no_restorable_urls' };

    const groupId = await chrome.tabs.group({ tabIds: createdIds });
    await chrome.tabGroups.update(groupId, {
      title: item.title || '',
      color: item.color || 'grey',
      collapsed: Boolean(item.collapsed),
    });
    // focus first tab
    try {
      await chrome.tabs.update(createdIds[0], { active: true });
    } catch {
      // ignore
    }
    list.splice(idx, 1);
    await setParkedItems(list);
    return { ok: true, remaining: list.length, skipped };
  }

  list.splice(idx, 1);
  await setParkedItems(list);
  return { ok: true, remaining: list.length };
}

async function restoreGroupMember(groupId, memberId) {
  const list = await getParkedItems();
  const gIdx = list.findIndex((t) => t.id === groupId && t.kind === 'group');
  if (gIdx === -1) return { ok: false, error: 'not_found' };
  const group = list[gIdx];
  const mIdx = (group.tabs || []).findIndex((m) => m.id === memberId);
  if (mIdx === -1) return { ok: false, error: 'member_not_found' };
  const member = group.tabs[mIdx];
  if (!isRestorableUrl(member.url)) return { ok: false, error: 'restricted_url' };

  try {
    await chrome.tabs.create({ url: member.url, active: true });
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  group.tabs.splice(mIdx, 1);
  if (group.tabs.length === 0) {
    list.splice(gIdx, 1);
  } else {
    list[gIdx] = group;
  }
  await setParkedItems(list);
  return { ok: true, remaining: list.length };
}

async function deleteItem(id) {
  const list = await getParkedItems();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return { ok: false, error: 'not_found' };
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
  return { ok: true, items: next, tabs: next.filter((i) => i.kind === 'tab') };
}

// ─── Messages ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case 'GET_PARKED_ITEMS':
        return { ok: true, items: await getParkedItems() };
      case 'GET_PARKED_TABS': {
        // backward compatible: return all items as "tabs" field for park.js migration
        const items = await getParkedItems();
        return { ok: true, tabs: items, items };
      }
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

// ─── Commands & action ─────────────────────────────────────────────

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
