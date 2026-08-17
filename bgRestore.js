/**
 * TabWall background — dedupe + restore/delete.
 * importScripts shared SW scope with background.js.
 */

// ── original background.js L2875-3159 ──
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

const PENDING_PRESAVE_KEY = 'pendingPreSaveEdit';

async function setPendingPreSave(pending) {
  const payload = { ...pending, createdAt: Date.now() };
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ [PENDING_PRESAVE_KEY]: payload });
    } else {
      await chrome.storage.local.set({ [PENDING_PRESAVE_KEY]: payload });
    }
  } catch {
    await chrome.storage.local.set({ [PENDING_PRESAVE_KEY]: payload });
  }
  return payload;
}

async function getPendingPreSave() {
  let data = {};
  try {
    if (chrome.storage.session) {
      data = await chrome.storage.session.get(PENDING_PRESAVE_KEY);
    }
  } catch {
    data = {};
  }
  if (!data[PENDING_PRESAVE_KEY]) {
    data = await chrome.storage.local.get(PENDING_PRESAVE_KEY);
  }
  const pending = data[PENDING_PRESAVE_KEY];
  if (!pending || typeof pending !== 'object') return null;
  if (Date.now() - (pending.createdAt || 0) > PENDING_TTL_MS) {
    await clearPendingPreSave();
    return null;
  }
  return pending;
}

async function clearPendingPreSave() {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.remove(PENDING_PRESAVE_KEY);
    }
  } catch {
    // ignore
  }
  await chrome.storage.local.remove(PENDING_PRESAVE_KEY);
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

// ── original background.js L4097-4380 ──
// ─── Restore / delete ──────────────────────────────────────────────

async function cleanupCreatedTabs(tabIds, windowId = null) {
  const ids = [...new Set((tabIds || []).filter((id) => id != null))];
  let canRemoveWindow = false;
  if (windowId != null && chrome.windows?.get) {
    try {
      const win = await chrome.windows.get(windowId, { populate: true });
      const tabs = Array.isArray(win?.tabs) ? win.tabs : [];
      canRemoveWindow = tabs.length > 0 && tabs.every((tab) => ids.includes(tab.id));
    } catch {
      // Leave the window open when its remaining tabs cannot be verified safely.
    }
  }
  if (ids.length) {
    try {
      await chrome.tabs.remove(ids);
    } catch (err) {
      appLogPush('warn', 'rollback', 'tab cleanup failed', err?.message || err);
    }
  }
  if (canRemoveWindow && chrome.windows?.remove) {
    try {
      await chrome.windows.remove(windowId);
    } catch {
      // The window may already have closed with its last tab.
    }
  }
}

async function getCreatedWindowTab(win) {
  const direct = Array.isArray(win?.tabs)
    ? win.tabs.find((tab) => tab?.id != null)
    : null;
  if (direct) return direct;
  if (win?.id == null || !chrome.windows?.get) return null;
  try {
    const populated = await chrome.windows.get(win.id, { populate: true });
    return Array.isArray(populated?.tabs)
      ? populated.tabs.find((tab) => tab?.id != null) || null
      : null;
  } catch {
    return null;
  }
}

function restoreResult(list, item, { created = 0, reused = 0, skipped = 0 } = {}) {
  return {
    ok: true,
    kept: true,
    remaining: list.length,
    created,
    reused,
    skipped,
    notesRemaining: item.kind === 'group' ? (item.notes || []).length : 0,
  };
}

function groupIdForTab(tab) {
  const id = Number(tab?.groupId);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

function chooseOpenTab(openTabs, url, usedIds = new Set(), preferredWindowId = null) {
  const key = normalizeUrlKey(url);
  if (!key) return null;
  const matches = (openTabs || [])
    .filter((tab) => (
      tab?.id != null
      && !usedIds.has(tab.id)
      && normalizeUrlKey(tab.url) === key
    ));
  matches.sort((left, right) => {
    const leftScore = (preferredWindowId != null && left.windowId === preferredWindowId ? 4 : 0)
      + (left.active ? 2 : 0);
    const rightScore = (preferredWindowId != null && right.windowId === preferredWindowId ? 4 : 0)
      + (right.active ? 2 : 0);
    return rightScore - leftScore;
  });
  return matches[0] || null;
}

async function getLastFocusedWindowId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs?.[0]?.windowId ?? null;
  } catch {
    return null;
  }
}

async function focusOpenTab(tab) {
  if (tab?.id == null) throw new Error('tab_not_found');
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId != null && chrome.windows?.update) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return tab;
}

async function createRestoreTab(url, { active = false, windowId = null } = {}) {
  const info = { url, active };
  if (windowId != null) info.windowId = windowId;
  return chrome.tabs.create(info);
}

async function rollbackMovedTabs(movedTabs) {
  for (const moved of [...(movedTabs || [])].reverse()) {
    if (moved?.tabId == null) continue;
    if (moved.moved && moved.originalWindowId != null) {
      try {
        const move = { windowId: moved.originalWindowId };
        if (Number.isInteger(moved.originalIndex)) move.index = moved.originalIndex;
        await chrome.tabs.move([moved.tabId], move);
      } catch (err) {
        appLogPush('warn', 'rollback', 'tab move rollback failed', err?.message || err);
      }
    }
    if (moved.originalGroupId != null && chrome.tabs.group) {
      try {
        await chrome.tabs.group({ tabIds: [moved.tabId], groupId: moved.originalGroupId });
      } catch (err) {
        appLogPush('warn', 'rollback', 'tab group rollback failed', err?.message || err);
      }
    } else if (moved.originalGroupId == null && chrome.tabs.ungroup) {
      try {
        await chrome.tabs.ungroup([moved.tabId]);
      } catch (err) {
        appLogPush('warn', 'rollback', 'tab ungroup rollback failed', err?.message || err);
      }
    }
  }
}

function commonExistingGroupId(resolved) {
  if (!resolved.length || resolved.some((entry) => !entry.reused)) return null;
  const ids = resolved.map((entry) => groupIdForTab(entry.tab));
  if (ids.some((id) => id == null)) return null;
  return ids.every((id) => id === ids[0]) ? ids[0] : null;
}

async function updateRestoredGroup(groupId, item) {
  await chrome.tabGroups.update(groupId, {
    title: item.title || '',
    color: item.color || 'grey',
    collapsed: Boolean(item.collapsed),
  });
}

async function restoreTab(id) {
  const list = await getParkedItems();
  const i = list.findIndex((t) => t.id === id);
  if (i === -1) return { ok: false, error: 'not_found' };
  const item = list[i];
  if (item.kind === 'group') return restoreGroup(id);
  if (item.kind === 'note') return { ok: false, error: 'note_not_restorable' };
  if (item.cardSource === 'image') return { ok: false, error: 'image_not_restorable' };
  if (!isRestorableUrl(item.url)) return { ok: false, error: 'restricted_url' };

  try {
    const openTabs = await chrome.tabs.query({});
    const existing = chooseOpenTab(openTabs, item.url);
    if (existing) {
      await focusOpenTab(existing);
      return restoreResult(list, item, { reused: 1 });
    }
    await createRestoreTab(item.url, { active: true });
    return restoreResult(list, item, { created: 1 });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
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

  const restorableMembers = members.filter(
    (member) => member.cardSource !== 'image' && isRestorableUrl(member.url)
  );
  const skipped = members.length - restorableMembers.length;
  if (!restorableMembers.length) return { ok: false, error: 'no_restorable_urls' };

  let openTabs;
  let preferredWindowId = null;
  try {
    openTabs = await chrome.tabs.query({});
    preferredWindowId = await getLastFocusedWindowId();
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }

  const usedIds = new Set();
  const resolved = restorableMembers.map((member) => {
    const existing = chooseOpenTab(openTabs, member.url, usedIds, preferredWindowId);
    if (!existing) return { member, reused: false, tab: null };
    usedIds.add(existing.id);
    return { member, reused: true, tab: existing };
  });

  const existingGroupId = commonExistingGroupId(resolved);
  if (existingGroupId != null) {
    try {
      await updateRestoredGroup(existingGroupId, item);
      await focusOpenTab(resolved[0].tab);
      return restoreResult(list, item, {
        reused: resolved.length,
        skipped,
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  const createdIds = [];
  const movedTabs = [];
  const reorderExisting = resolved.length > 1;
  let windowId = settings.restoreGroupIn === 'newWindow' ? null : preferredWindowId;
  let placeholderId = null;
  try {
    if (settings.restoreGroupIn === 'newWindow') {
      const win = await chrome.windows.create({ focused: true });
      windowId = win.id;
      const placeholder = await getCreatedWindowTab(win);
      placeholderId = placeholder?.id ?? null;
      if (windowId == null || placeholderId == null) throw new Error('window_tab_not_found');
    } else if (windowId == null) {
      windowId = resolved.find((entry) => entry.reused)?.tab?.windowId ?? null;
    }

    for (const entry of resolved) {
      if (entry.reused) {
        const original = {
          tabId: entry.tab.id,
          originalWindowId: entry.tab.windowId,
          originalIndex: entry.tab.index,
          originalGroupId: groupIdForTab(entry.tab),
          moved: false,
        };
        movedTabs.push(original);
        if (
          windowId != null
          && entry.tab.windowId != null
          && (entry.tab.windowId !== windowId || reorderExisting)
        ) {
          const moved = await chrome.tabs.move([entry.tab.id], {
            windowId,
            index: -1,
          });
          original.moved = true;
          entry.tab = Array.isArray(moved) && moved[0]
            ? moved[0]
            : { ...entry.tab, windowId };
        }
        continue;
      }

      let tab;
      if (placeholderId != null) {
        tab = await chrome.tabs.update(placeholderId, {
          url: entry.member.url,
          active: false,
        });
        tab = tab || { id: placeholderId, url: entry.member.url, windowId };
        placeholderId = null;
      } else {
        tab = await createRestoreTab(entry.member.url, { active: false, windowId });
      }
      if (tab?.id == null) throw new Error('tab_create_failed');
      entry.tab = tab;
      entry.created = true;
      createdIds.push(tab.id);
      if (windowId == null && tab.windowId != null) windowId = tab.windowId;
    }

    const tabIds = resolved.map((entry) => entry.tab?.id).filter((tabId) => tabId != null);
    if (!tabIds.length) throw new Error('no_restorable_urls');
    const groupOptions = windowId != null
      ? { tabIds, createProperties: { windowId } }
      : { tabIds };
    const groupId = await chrome.tabs.group(groupOptions);
    await updateRestoredGroup(groupId, item);
    if (placeholderId != null) {
      try {
        await chrome.tabs.remove(placeholderId);
      } catch (err) {
        appLogPush('warn', 'restore', 'window placeholder cleanup failed', err?.message || err);
      }
      placeholderId = null;
    }
    await focusOpenTab(resolved[0].tab);
    return restoreResult(list, item, {
      created: resolved.filter((entry) => entry.created).length,
      reused: resolved.filter((entry) => entry.reused).length,
      skipped,
    });
  } catch (err) {
    await rollbackMovedTabs(movedTabs);
    const cleanupIds = placeholderId == null ? createdIds : [...createdIds, placeholderId];
    await cleanupCreatedTabs(cleanupIds, settings.restoreGroupIn === 'newWindow' ? windowId : null);
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
  if (member.cardSource === 'image') return { ok: false, error: 'image_not_restorable' };
  if (!isRestorableUrl(member.url)) return { ok: false, error: 'restricted_url' };

  try {
    const openTabs = await chrome.tabs.query({});
    const existing = chooseOpenTab(openTabs, member.url);
    if (existing) {
      await focusOpenTab(existing);
      return restoreResult(list, group, { reused: 1 });
    }
    await createRestoreTab(member.url, { active: true });
    return restoreResult(list, group, { created: 1 });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function deleteItem(id) {
  const list = await getParkedItems();
  const item = list.find((t) => t.id === id);
  if (!item) return { ok: false, error: 'not_found' };
  const next = list.filter((t) => t.id !== id);
  await setParkedItems(next);
  try {
    const removedKeys = Media.keysForItem(item);
    await Media.removeMany(removedKeys);
    removedKeys.forEach((key) => autoBackupMediaCache.delete(key));
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
  applyDisplayTitlePatch(item, patch);
  applyLockPatch(item, patch);
  applyHideOriginalTitlePatch(item, patch);
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
