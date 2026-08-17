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
      updatedAt: annotateTimestamp(src.updatedAt),
    };
  }

  function pageAnnotationHasMeta(ann) {
    return Boolean(ann && (String(ann.note || '').trim() || (Array.isArray(ann.tags) && ann.tags.length)));
  }

  function pageAnnotationIsKeepable(ann) {
    return Boolean(ann && (pageAnnotationHasMeta(ann) || ann.hasInk || ann.overlayVisible));
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
    if (!pageAnnotationHasMeta(ann) && !ann.hasInk) return false;
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

  const api = {
    PAGE_ANNOTATIONS_KEY,
    normalizePageAnnotation,
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
