/**
 * TabWall background — live page annotations (tags / notes / overlay).
 * Data stays out of parkedItems. importScripts shared SW scope.
 */
(function (global) {
  const PAGE_ANNOTATIONS_KEY = 'pageAnnotations';
  const FALLBACK_LIMITS = {
    MAX_URL_LENGTH: 8192,
    MAX_TITLE_LENGTH: 2048,
    MAX_NOTE_LENGTH: 20000,
    MAX_TAG_LENGTH: 128,
    MAX_TAGS: 100,
  };
  const PAGE_STICKER_LIMITS = Object.freeze({
    MAX_COUNT: 100,
    MIN_WIDTH: 160,
    MAX_WIDTH: 640,
    MIN_HEIGHT: 120,
    MAX_HEIGHT: 560,
    MAX_COORDINATE: 10000000,
    MAX_Z_INDEX: 1000000,
  });

  function limits() {
    return typeof DATA_LIMITS === 'object' && DATA_LIMITS ? DATA_LIMITS : FALLBACK_LIMITS;
  }

  function annotateSafeText(value, maxLength) {
    if (typeof safeText === 'function') return safeText(value, maxLength);
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maxLength);
  }

  function annotateUrlKey(url) {
    if (typeof normalizeUrlKey === 'function') return normalizeUrlKey(url);
    return typeof url === 'string' ? url : '';
  }

  function annotateTags(tags) {
    if (typeof normalizeTags === 'function') return normalizeTags(tags);
    if (!Array.isArray(tags)) return [];
    const cap = limits();
    return [...new Set(
      tags
        .map((tag) => annotateSafeText(tag, cap.MAX_TAG_LENGTH).trim())
        .filter(Boolean)
    )].slice(0, cap.MAX_TAGS);
  }

  function annotateTimestamp(value) {
    if (typeof safeTimestamp === 'function') return safeTimestamp(value);
    const n = Number(value);
    const now = Date.now();
    return Number.isFinite(n) && n > 0 && n <= now + 86400000 ? n : now;
  }

  function newAnnotationId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      // fall through
    }
    return `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function clampPageStickerNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function normalizePageSticker(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const noteId = annotateSafeText(src.noteId, 128).trim();
    if (!noteId) return null;
    return {
      noteId,
      x: clampPageStickerNumber(src.x, 0, PAGE_STICKER_LIMITS.MAX_COORDINATE, 0),
      y: clampPageStickerNumber(src.y, 0, PAGE_STICKER_LIMITS.MAX_COORDINATE, 0),
      w: clampPageStickerNumber(src.w, PAGE_STICKER_LIMITS.MIN_WIDTH, PAGE_STICKER_LIMITS.MAX_WIDTH, 240),
      h: clampPageStickerNumber(src.h, PAGE_STICKER_LIMITS.MIN_HEIGHT, PAGE_STICKER_LIMITS.MAX_HEIGHT, 180),
      z: clampPageStickerNumber(src.z, 0, PAGE_STICKER_LIMITS.MAX_Z_INDEX, 0),
    };
  }

  function normalizePageStickers(value) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(value) ? value : []) {
      const sticker = normalizePageSticker(raw);
      if (!sticker || seen.has(sticker.noteId)) continue;
      seen.add(sticker.noteId);
      result.push(sticker);
      if (result.length >= PAGE_STICKER_LIMITS.MAX_COUNT) break;
    }
    return result;
  }

  function normalizePageAnnotation(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const cap = limits();
    const url = annotateSafeText(annotateUrlKey(src.url), cap.MAX_URL_LENGTH);
    if (!url) return null;
    return {
      id: typeof src.id === 'string' && src.id ? src.id : newAnnotationId(),
      url,
      title: annotateSafeText(src.title || '', cap.MAX_TITLE_LENGTH),
      favIconUrl: annotateSafeText(src.favIconUrl, 4096),
      note: annotateSafeText(src.note, cap.MAX_NOTE_LENGTH),
      tags: annotateTags(src.tags),
      overlayVisible: src.overlayVisible === true,
      hasInk: src.hasInk === true,
      stickers: normalizePageStickers(src.stickers),
      updatedAt: annotateTimestamp(src.updatedAt),
    };
  }

  function pageAnnotationHasMeta(ann) {
    return Boolean(ann && (String(ann.note || '').trim() || (Array.isArray(ann.tags) && ann.tags.length)));
  }

  function pageAnnotationIsKeepable(ann) {
    return Boolean(ann && (pageAnnotationHasMeta(ann) || ann.hasInk || ann.overlayVisible
      || (Array.isArray(ann.stickers) && ann.stickers.length)));
  }

  function mergeAnnotationNotes(a, b) {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (!left) return right;
    if (!right) return left;
    if (left === right || left.includes(right)) return left;
    if (right.includes(left)) return right;
    return `${left}\n${right}`;
  }

  function mergeAnnotationTags(a, b) {
    return annotateTags([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
  }

  function mergeLiveIntoSaveMeta(live, base) {
    const seed = base && typeof base === 'object' ? base : {};
    return {
      note: mergeAnnotationNotes(live?.note, seed.note),
      tags: mergeAnnotationTags(live?.tags, seed.tags),
    };
  }

  function findParkedTabForUrl(url, items) {
    const key = annotateUrlKey(url);
    if (!key) return null;
    for (const item of items || []) {
      if (item?.kind === 'tab' && annotateUrlKey(item.url) === key) {
        return { kind: 'tab', item };
      }
      if (item?.kind === 'group') {
        for (const member of item.tabs || []) {
          if (annotateUrlKey(member.url) === key) {
            return { kind: 'member', group: item, member };
          }
        }
      }
    }
    return null;
  }

  function liveWallVisible(ann, parkedItems) {
    if (!ann) return false;
    if (!pageAnnotationHasMeta(ann) && !ann.hasInk && !(ann.stickers || []).length) return false;
    return !findParkedTabForUrl(ann.url, parkedItems);
  }

  function consumeAnnotationMeta(ann) {
    if (!ann) return null;
    const next = normalizePageAnnotation({
      ...ann,
      note: '',
      tags: [],
      updatedAt: Date.now(),
    });
    return pageAnnotationIsKeepable(next) ? next : null;
  }

  function toLiveWallItem(ann) {
    if (!ann) return null;
    return {
      kind: 'live',
      id: ann.id,
      url: ann.url,
      title: ann.title || ann.url || '',
      favIconUrl: ann.favIconUrl || '',
      note: ann.note || '',
      tags: Array.isArray(ann.tags) ? ann.tags.slice() : [],
      hasInk: ann.hasInk === true,
      overlayVisible: ann.overlayVisible === true,
      stickerCount: Array.isArray(ann.stickers) ? ann.stickers.length : 0,
      savedAt: ann.updatedAt || Date.now(),
    };
  }

  async function getPageAnnotationsList() {
    const data = await chrome.storage.local.get(PAGE_ANNOTATIONS_KEY);
    const raw = data[PAGE_ANNOTATIONS_KEY];
    return (Array.isArray(raw) ? raw : []).map(normalizePageAnnotation).filter(Boolean);
  }

  async function setPageAnnotationsList(list) {
    const cleaned = (list || [])
      .map(normalizePageAnnotation)
      .filter(Boolean)
      .filter(pageAnnotationIsKeepable);
    await chrome.storage.local.set({ [PAGE_ANNOTATIONS_KEY]: cleaned });
    return cleaned;
  }

  async function getPageAnnotation(url) {
    const key = annotateUrlKey(url);
    if (!key) return null;
    const list = await getPageAnnotationsList();
    return list.find((item) => item.url === key) || null;
  }

  async function replacePageAnnotation(url, next) {
    const key = annotateUrlKey(url);
    const list = await getPageAnnotationsList();
    const idx = list.findIndex((item) => item.url === key);
    const keep = next && pageAnnotationIsKeepable(next) ? next : null;
    if (keep) {
      if (idx >= 0) list[idx] = keep;
      else list.unshift(keep);
    } else if (idx >= 0) {
      list.splice(idx, 1);
    }
    await setPageAnnotationsList(list);
    return keep;
  }

  async function consumePageAnnotationOnPark(url) {
    const current = await getPageAnnotation(url);
    if (!current) return null;
    return replacePageAnnotation(url, consumeAnnotationMeta(current));
  }

  async function deletePageAnnotation(url, { clearInk = true } = {}) {
    const current = await getPageAnnotation(url);
    if (!current) return { ok: true, removed: false };
    if (clearInk && current.id && typeof Media !== 'undefined' && Media?.remove) {
      try {
        await Media.remove(Media.mediaKeyPageInk ? Media.mediaKeyPageInk(current.id) : `ink:${current.id}`);
      } catch {
        // ignore
      }
    }
    await replacePageAnnotation(url, null);
    return { ok: true, removed: true, id: current.id };
  }

  async function getPageAnnotationView(url) {
    const key = annotateUrlKey(url);
    const items = typeof getParkedItems === 'function' ? await getParkedItems() : [];
    const parked = findParkedTabForUrl(key, items);
    const live = await getPageAnnotation(key);
    if (parked?.kind === 'tab') {
      return {
        ok: true,
        source: 'parked',
        annotation: {
          id: parked.item.id,
          url: parked.item.url,
          title: parked.item.title || '',
          favIconUrl: parked.item.favIconUrl || '',
          note: parked.item.note || '',
          tags: Array.isArray(parked.item.tags) ? parked.item.tags : [],
          overlayVisible: live?.overlayVisible === true,
          hasInk: live?.hasInk === true,
        },
        parkedId: parked.item.id,
      };
    }
    if (parked?.kind === 'member') {
      return {
        ok: true,
        source: 'parked',
        annotation: {
          id: parked.member.id,
          url: parked.member.url,
          title: parked.member.title || '',
          favIconUrl: parked.member.favIconUrl || '',
          note: parked.member.note || '',
          tags: Array.isArray(parked.member.tags) ? parked.member.tags : [],
          overlayVisible: live?.overlayVisible === true,
          hasInk: live?.hasInk === true,
        },
        groupId: parked.group.id,
        memberId: parked.member.id,
      };
    }
    if (live) return { ok: true, source: 'live', annotation: live };
    return {
      ok: true,
      source: 'none',
      annotation: {
        id: '',
        url: key,
        title: '',
        favIconUrl: '',
        note: '',
        tags: [],
        overlayVisible: false,
        hasInk: false,
      },
    };
  }

  async function upsertPageAnnotation(patch) {
    const url = annotateUrlKey(patch?.url);
    if (!url) return { ok: false, error: 'invalid_url' };
    const items = typeof getParkedItems === 'function' ? await getParkedItems() : [];
    const parked = findParkedTabForUrl(url, items);
    const existing = await getPageAnnotation(url);
    const writingMeta = patch.note !== undefined || patch.tags !== undefined;

    if (parked && writingMeta) {
      const note = patch.note !== undefined
        ? annotateSafeText(patch.note, limits().MAX_NOTE_LENGTH)
        : (parked.kind === 'member' ? parked.member.note : parked.item.note);
      const tags = patch.tags !== undefined
        ? annotateTags(patch.tags)
        : (parked.kind === 'member' ? parked.member.tags : parked.item.tags);
      if (parked.kind === 'member' && typeof updateGroupMember === 'function') {
        await updateGroupMember(parked.group.id, parked.member.id, { note, tags });
      } else if (typeof updateItem === 'function') {
        await updateItem(parked.item.id, { note, tags });
      }
    }

    const next = normalizePageAnnotation({
      ...(existing || { url, id: newAnnotationId() }),
      url,
      title: patch.title !== undefined ? patch.title : (existing?.title || ''),
      favIconUrl: patch.favIconUrl !== undefined ? patch.favIconUrl : (existing?.favIconUrl || ''),
      note: parked && writingMeta ? '' : (patch.note !== undefined ? patch.note : (existing?.note || '')),
      tags: parked && writingMeta ? [] : (patch.tags !== undefined ? patch.tags : (existing?.tags || [])),
      overlayVisible: patch.overlayVisible !== undefined ? patch.overlayVisible : existing?.overlayVisible,
      hasInk: patch.hasInk !== undefined ? patch.hasInk : existing?.hasInk,
      updatedAt: Date.now(),
    });

    const kept = await replacePageAnnotation(url, next);
    if (!parked && kept && pageAnnotationHasMeta(kept) && typeof mergeTagsIntoCatalog === 'function') {
      await mergeTagsIntoCatalog(kept.tags);
    }
    const view = await getPageAnnotationView(url);
    return { ...view, upserted: true };
  }

  async function listVisiblePageAnnotations() {
    const items = typeof getParkedItems === 'function' ? await getParkedItems() : [];
    const list = await getPageAnnotationsList();
    return list.filter((ann) => liveWallVisible(ann, items)).map(toLiveWallItem).filter(Boolean);
  }

  async function collectLiveTagNames(into) {
    const set = into instanceof Set ? into : new Set();
    const list = await getPageAnnotationsList();
    for (const ann of list) {
      for (const tag of ann.tags || []) {
        const name = String(tag).trim();
        if (name) set.add(name);
      }
    }
    return set;
  }

  async function getPageInk(url) {
    const ann = await getPageAnnotation(url);
    if (!ann?.id || typeof Media === 'undefined' || !Media?.getInk) {
      return { ok: true, strokes: [], annotation: ann };
    }
    const strokes = await Media.getInk(Media.mediaKeyPageInk(ann.id));
    return { ok: true, strokes: Array.isArray(strokes) ? strokes : [], annotation: ann };
  }

  async function putPageInk(url, strokes, tabMeta = {}) {
    const key = annotateUrlKey(url);
    if (!key) return { ok: false, error: 'invalid_url' };
    const existing = await getPageAnnotation(key);
    const next = normalizePageAnnotation({
      ...(existing || { url: key, id: newAnnotationId() }),
      url: key,
      title: tabMeta.title !== undefined ? tabMeta.title : (existing?.title || ''),
      favIconUrl: tabMeta.favIconUrl !== undefined ? tabMeta.favIconUrl : (existing?.favIconUrl || ''),
      overlayVisible: tabMeta.overlayVisible !== undefined ? tabMeta.overlayVisible : existing?.overlayVisible,
      hasInk: Array.isArray(strokes) && strokes.length > 0,
      updatedAt: Date.now(),
    });
    const kept = await replacePageAnnotation(key, next);
    if (kept?.id && typeof Media !== 'undefined' && Media?.putInk) {
      await Media.putInk(Media.mediaKeyPageInk(kept.id), Array.isArray(strokes) ? strokes : []);
    }
    return { ok: true, annotation: kept, strokeCount: Array.isArray(strokes) ? strokes.length : 0 };
  }

  function pageStickerNoteProjection(note) {
    if (!note || note.kind !== 'note') return null;
    const projection = {
      kind: 'note',
      id: note.id,
      title: note.title || 'Sticker note',
      displayTitle: note.displayTitle || '',
      markdown: note.markdown || '',
      contentMode: note.contentMode === 'web' ? 'web' : 'markdown',
      webSource: note.webSource || '',
      tags: Array.isArray(note.tags) ? note.tags.slice() : [],
      pinned: Boolean(note.pinned),
      savedAt: note.savedAt || Date.now(),
      attachments: (note.attachments || []).map((attachment) => ({
        id: attachment.id,
        name: attachment.name || 'image',
        alt: attachment.alt || '',
        mime: attachment.mime || 'image/jpeg',
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
        width: Number.isFinite(Number(attachment.width)) ? Number(attachment.width) : 0,
        height: Number.isFinite(Number(attachment.height)) ? Number(attachment.height) : 0,
        hasData: Boolean(attachment.hasData),
      })),
      locked: Boolean(note.locked),
      lockHash: note.lockHash || '',
      hideOriginalTitle: Boolean(note.hideOriginalTitle),
    };
    const reminder = typeof normalizeReminder === 'function' ? normalizeReminder(note.reminder) : null;
    if (reminder) projection.reminder = reminder;
    return projection;
  }

  function findTopLevelStickerNote(items, noteId) {
    const id = String(noteId || '');
    const topLevel = (items || []).find((item) => item?.kind === 'note' && item.id === id);
    if (topLevel) return { note: topLevel };
    const nested = (items || []).some((item) => item?.kind === 'group'
      && (item.notes || []).some((note) => note?.id === id));
    return nested ? { error: 'invalid_note_scope' } : { error: 'not_found' };
  }

  async function getPageStickers(url) {
    const key = annotateUrlKey(url);
    if (!key) return { ok: false, error: 'invalid_url', url: '', stickers: [] };
    const annotation = await getPageAnnotation(key);
    const items = typeof getParkedItems === 'function' ? await getParkedItems() : [];
    const stickers = [];
    for (const placement of annotation?.stickers || []) {
      const found = findTopLevelStickerNote(items, placement.noteId);
      if (!found.note) continue;
      const note = pageStickerNoteProjection(found.note);
      if (note) stickers.push({ ...placement, note });
    }
    return { ok: true, url: key, stickers, annotationId: annotation?.id || '' };
  }

  async function ensurePageStickerNote(noteId) {
    const items = typeof getParkedItems === 'function' ? await getParkedItems() : [];
    const found = findTopLevelStickerNote(items, noteId);
    return found.note ? { ok: true, note: found.note } : { ok: false, error: found.error };
  }

  async function writePageSticker(url, noteId, placement, { requireExisting = false } = {}) {
    const key = annotateUrlKey(url);
    if (!key) return { ok: false, error: 'invalid_url' };
    const noteResult = await ensurePageStickerNote(noteId);
    if (!noteResult.ok) return noteResult;
    const nextPlacement = normalizePageSticker({ ...placement, noteId });
    if (!nextPlacement) return { ok: false, error: 'invalid_sticker' };
    const existing = await getPageAnnotation(key);
    const current = normalizePageStickers(existing?.stickers);
    const index = current.findIndex((item) => item.noteId === nextPlacement.noteId);
    if (requireExisting && index < 0) return { ok: false, error: 'not_found' };
    if (index >= 0) current[index] = nextPlacement;
    else current.push(nextPlacement);
    if (current.length > PAGE_STICKER_LIMITS.MAX_COUNT) {
      return { ok: false, error: 'too_many_stickers' };
    }
    const next = normalizePageAnnotation({
      ...(existing || { url: key, id: newAnnotationId() }),
      url: key,
      stickers: current,
      updatedAt: Date.now(),
    });
    const kept = await replacePageAnnotation(key, next);
    return { ...(await getPageStickers(key)), upserted: true, annotation: kept };
  }

  async function createPageSticker(url, noteId, placement) {
    return writePageSticker(url, noteId, placement);
  }

  async function updatePageSticker(url, noteId, patch) {
    return writePageSticker(url, noteId, patch, { requireExisting: true });
  }

  async function deletePageSticker(url, noteId) {
    const key = annotateUrlKey(url);
    if (!key) return { ok: false, error: 'invalid_url' };
    const noteResult = await ensurePageStickerNote(noteId);
    if (!noteResult.ok) return noteResult;
    const existing = await getPageAnnotation(key);
    const current = normalizePageStickers(existing?.stickers);
    const next = current.filter((item) => item.noteId !== String(noteId || ''));
    if (next.length === current.length) return { ok: true, removed: false, ...(await getPageStickers(key)) };
    const kept = await replacePageAnnotation(key, normalizePageAnnotation({
      ...existing,
      url: key,
      stickers: next,
      updatedAt: Date.now(),
    }));
    return { ...(await getPageStickers(key)), removed: true, annotation: kept };
  }

  async function removePageStickerReferences(noteId) {
    const id = String(noteId || '');
    if (!id) return { ok: true, removed: 0 };
    const list = await getPageAnnotationsList();
    let removed = 0;
    const next = list.map((annotation) => {
      const stickers = (annotation.stickers || []).filter((item) => item.noteId !== id);
      removed += (annotation.stickers || []).length - stickers.length;
      return stickers.length === (annotation.stickers || []).length
        ? annotation
        : normalizePageAnnotation({ ...annotation, stickers, updatedAt: Date.now() });
    });
    if (removed) await setPageAnnotationsList(next);
    return { ok: true, removed };
  }

  async function getNotePageLocations() {
    const [items, annotations] = await Promise.all([
      typeof getParkedItems === 'function' ? getParkedItems() : [],
      getPageAnnotationsList(),
    ]);
    const topLevelNoteIds = new Set((items || [])
      .filter((item) => item?.kind === 'note' && item.id)
      .map((item) => item.id));
    const byNoteId = new Map();
    for (const annotation of annotations || []) {
      for (const sticker of annotation.stickers || []) {
        if (!topLevelNoteIds.has(sticker.noteId)) continue;
        const pages = byNoteId.get(sticker.noteId) || [];
        if (pages.some((page) => page.url === annotation.url)) continue;
        pages.push({
          url: annotation.url,
          title: annotation.title || annotation.url,
        });
        byNoteId.set(sticker.noteId, pages);
      }
    }
    return {
      ok: true,
      locations: [...byNoteId.entries()].map(([noteId, pages]) => ({ noteId, pages })),
    };
  }

  const api = {
    PAGE_ANNOTATIONS_KEY,
    PAGE_STICKER_LIMITS,
    normalizePageAnnotation,
    normalizePageSticker,
    normalizePageStickers,
    pageAnnotationHasMeta,
    pageAnnotationIsKeepable,
    mergeAnnotationNotes,
    mergeAnnotationTags,
    mergeLiveIntoSaveMeta,
    findParkedTabForUrl,
    liveWallVisible,
    consumeAnnotationMeta,
    toLiveWallItem,
    getPageAnnotationsList,
    getPageAnnotation,
    getPageAnnotationView,
    upsertPageAnnotation,
    consumePageAnnotationOnPark,
    deletePageAnnotation,
    listVisiblePageAnnotations,
    collectLiveTagNames,
    getPageInk,
    putPageInk,
    pageStickerNoteProjection,
    getPageStickers,
    createPageSticker,
    updatePageSticker,
    deletePageSticker,
    removePageStickerReferences,
    getNotePageLocations,
  };

  global.TabWallPageAnnotate = api;
})(typeof self !== 'undefined' ? self : globalThis);

async function toggleAnnotateOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: 'no_tab' };
  if (isRestrictedUrl(tab.url)) return { ok: false, error: 'restricted_url' };
  try {
    const response = await sendToTab(tab.id, { type: 'TOGGLE_ANNOTATE' });
    return { ok: true, open: response?.open, tabId: tab.id };
  } catch (err) {
    console.warn('[TabWall] toggle annotate failed:', err);
    return { ok: false, error: String(err) };
  }
}

async function notifyPageAnnotationUrlChanged(tabId, url) {
  if (!tabId || isRestrictedUrl(url)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PAGE_ANNOTATION_URL_CHANGED', url: url || '' });
  } catch {
    // content script may be missing on this navigation
  }
}

async function openOrFocusUrl(url) {
  const key = typeof normalizeUrlKey === 'function' ? normalizeUrlKey(url) : String(url || '');
  if (!key) return { ok: false, error: 'invalid_url' };
  try {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((tab) => (
      typeof normalizeUrlKey === 'function' ? normalizeUrlKey(tab.url) : tab.url
    ) === key);
    if (match) {
      await chrome.tabs.update(match.id, { active: true });
      if (match.windowId != null) await chrome.windows.update(match.windowId, { focused: true });
      return { ok: true, tabId: match.id, focused: true };
    }
    const created = await chrome.tabs.create({ url: key });
    return { ok: true, tabId: created?.id, created: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function openUrlInNewTab(url) {
  const key = typeof normalizeUrlKey === 'function' ? normalizeUrlKey(url) : String(url || '');
  if (!key) return { ok: false, error: 'invalid_url' };
  try {
    const created = await chrome.tabs.create({ url: key, active: true });
    return { ok: true, tabId: created?.id, created: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function parkPageAnnotation(url) {
  const live = await self.TabWallPageAnnotate.getPageAnnotation(url);
  const tabLike = {
    url: live?.url || url,
    title: live?.title || url || 'Untitled',
    favIconUrl: live?.favIconUrl || '',
  };
  if (!tabLike.url) return { ok: false, error: 'invalid_url' };
  return commitSaveTab(tabLike, { afterSave: 'keep' });
}
