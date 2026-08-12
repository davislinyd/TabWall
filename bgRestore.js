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

