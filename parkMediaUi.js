/**
 * TabWall park media UI — thumb / snap / attachment URL cache + lazy load.
 * Loaded by park.html after mediaDb.js, before park.js.
 * Call bind() so DOM/state/sendMessage resolve from the park page without
 * embedding page globals in this file.
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let ctx = {};

  const Media = () => global.TabWallMediaDB;

  /** @type {Set<string>} */
  const liveObjectUrls = new Set();
  const pendingObjectUrlRevokes = new Set();
  /** @type {Map<string, string>} snap dataUrl/blob url cache */
  const snapCache = new Map();
  const SNAP_CACHE_MAX = 12;
  /** @type {Map<string, string>} note attachment blob URL cache */
  const attachmentUrlCache = new Map();
  const ATTACHMENT_URL_CACHE_MAX = 8;
  /** @type {Map<string, Promise<string>>} */
  const mediaFetches = new Map();
  /** @type {Set<string>} */
  const canvasPendingMediaUrls = new Set();

  /** Reuse thumb blob URLs across re-renders (search typing). */
  const THUMB_URL_CACHE_MAX = 100;
  /** @type {Map<string, string>} */
  const thumbUrlCache = new Map();

  let thumbObserver = null;
  let canvasMediaObserver = null;
  let canvasMediaQualityRaf = 0;

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    ctx = Object.assign(ctx, next);
  }

  function sendMessage(payload) {
    return typeof ctx.sendMessage === 'function'
      ? ctx.sendMessage(payload)
      : Promise.resolve({ ok: false, error: 'no_sendMessage' });
  }
  function canvasViewportEl() {
    return typeof ctx.getCanvasViewportEl === 'function' ? ctx.getCanvasViewportEl() : null;
  }
  function canvasNodesEl() {
    return typeof ctx.getCanvasNodesEl === 'function' ? ctx.getCanvasNodesEl() : null;
  }
  function canvasZoom() {
    if (typeof ctx.getCanvasZoom === 'function') {
      const z = Number(ctx.getCanvasZoom());
      return Number.isFinite(z) && z > 0 ? z : 1;
    }
    return 1;
  }
  function getAllTabs() {
    return typeof ctx.getAllTabs === 'function' ? ctx.getAllTabs() : [];
  }
  function t(key, vars) {
    return typeof ctx.t === 'function' ? ctx.t(key, vars) : key;
  }

  function mediaFetchKey(key, kind) {
    return `${kind}:${key}`;
  }

  function isMediaUrlInUse(url) {
    if (!url) return false;
    if (canvasPendingMediaUrls.has(url)) return true;
    return [...document.images].some((img) => img.isConnected && img.src === url);
  }

  function trackObjectUrl(url) {
    if (url && String(url).startsWith('blob:')) liveObjectUrls.add(url);
    return url;
  }

  function revokeObjectUrl(url) {
    if (url && String(url).startsWith('blob:') && liveObjectUrls.has(url)) {
      if (isMediaUrlInUse(url)) {
        pendingObjectUrlRevokes.add(url);
        setTimeout(() => {
          if (!pendingObjectUrlRevokes.has(url)) return;
          pendingObjectUrlRevokes.delete(url);
          revokeObjectUrl(url);
        }, 1000);
        return;
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      liveObjectUrls.delete(url);
    }
  }

  function cacheSnap(key, url) {
    if (snapCache.has(key)) {
      const old = snapCache.get(key);
      if (old !== url) revokeObjectUrl(old);
    }
    snapCache.set(key, url);
    while (snapCache.size > SNAP_CACHE_MAX) {
      const first = [...snapCache.keys()].find((candidate) => {
        const cached = snapCache.get(candidate);
        return !isMediaUrlInUse(cached) && !mediaFetches.has(mediaFetchKey(candidate, 'snap'));
      });
      if (first == null) break;
      revokeObjectUrl(snapCache.get(first));
      snapCache.delete(first);
    }
  }

  function cacheThumbUrl(key, url) {
    if (!key || !url) return url;
    if (thumbUrlCache.has(key)) {
      const old = thumbUrlCache.get(key);
      if (old !== url) revokeObjectUrl(old);
      thumbUrlCache.delete(key);
    }
    thumbUrlCache.set(key, url);
    while (thumbUrlCache.size > THUMB_URL_CACHE_MAX) {
      const first = [...thumbUrlCache.keys()].find((candidate) => {
        const cached = thumbUrlCache.get(candidate);
        return !isMediaUrlInUse(cached) && !mediaFetches.has(mediaFetchKey(candidate, 'thumb'));
      });
      if (first == null) break;
      revokeObjectUrl(thumbUrlCache.get(first));
      thumbUrlCache.delete(first);
    }
    return url;
  }

  function cacheAttachmentUrl(key, url) {
    if (!key || !url) return url;
    if (attachmentUrlCache.has(key)) {
      const old = attachmentUrlCache.get(key);
      if (old !== url) revokeObjectUrl(old);
      attachmentUrlCache.delete(key);
    }
    attachmentUrlCache.set(key, url);
    while (attachmentUrlCache.size > ATTACHMENT_URL_CACHE_MAX) {
      const firstEvictable = [...attachmentUrlCache.keys()].find((candidate) => {
        const cached = attachmentUrlCache.get(candidate);
        return !isMediaUrlInUse(cached) && !mediaFetches.has(mediaFetchKey(candidate, 'attachment'));
      });
      const first = firstEvictable
        ?? [...attachmentUrlCache.keys()].find((candidate) => !mediaFetches.has(mediaFetchKey(candidate, 'attachment')))
        ?? attachmentUrlCache.keys().next().value;
      if (first == null) break;
      const oldUrl = attachmentUrlCache.get(first);
      attachmentUrlCache.delete(first);
      revokeObjectUrl(oldUrl);
    }
    return url;
  }

  function fetchMediaUrl(key, kind) {
    if (!key) return Promise.resolve('');
    if (kind === 'thumb' && thumbUrlCache.has(key)) {
      return Promise.resolve(thumbUrlCache.get(key) || '');
    }
    if (kind === 'snap' && snapCache.has(key)) {
      return Promise.resolve(snapCache.get(key) || '');
    }
    if (kind === 'attachment' && attachmentUrlCache.has(key)) {
      const url = attachmentUrlCache.get(key) || '';
      attachmentUrlCache.delete(key);
      attachmentUrlCache.set(key, url);
      return Promise.resolve(url);
    }
    const requestKey = mediaFetchKey(key, kind);
    const existing = mediaFetches.get(requestKey);
    if (existing) return existing;
    const mediaDb = Media();
    const request = (async () => {
      if (!mediaDb) {
        const res = await sendMessage({ type: 'GET_MEDIA', key, kind });
        const url = res.ok ? res.dataUrl || '' : '';
        if (kind === 'thumb' && url) cacheThumbUrl(key, url);
        if (kind === 'snap' && url) cacheSnap(key, url);
        if (kind === 'attachment' && url) cacheAttachmentUrl(key, url);
        return url;
      }
      try {
        const blob = kind === 'attachment'
          ? await mediaDb.getAttachment?.(key)
          : await mediaDb.getPart(key, kind === 'snap' ? 'snap' : 'thumb');
        if (!blob) return '';
        const url = trackObjectUrl(URL.createObjectURL(blob));
        if (kind === 'thumb') cacheThumbUrl(key, url);
        if (kind === 'snap') cacheSnap(key, url);
        if (kind === 'attachment') cacheAttachmentUrl(key, url);
        return url;
      } catch {
        const res = await sendMessage({ type: 'GET_MEDIA', key, kind });
        const url = res.ok ? res.dataUrl || '' : '';
        if (kind === 'thumb' && url) cacheThumbUrl(key, url);
        if (kind === 'snap' && url) cacheSnap(key, url);
        if (kind === 'attachment' && url) cacheAttachmentUrl(key, url);
        return url;
      }
    })();
    mediaFetches.set(requestKey, request);
    request.finally(() => {
      if (mediaFetches.get(requestKey) === request) mediaFetches.delete(requestKey);
    }).catch(() => {});
    return request;
  }

  /** True lazy-load via IntersectionObserver + thumb cache. */
  function getThumbObserver() {
    if (thumbObserver) return thumbObserver;
    if (typeof IntersectionObserver === 'undefined') return null;
    thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target;
          thumbObserver.unobserve(img);
          if (img.dataset.canvasMedia === 'true') wireCanvasMedia(img);
          else loadThumbInto(img);
        }
      },
      { root: null, rootMargin: '240px 0px', threshold: 0.01 }
    );
    return thumbObserver;
  }

  function disconnectThumbObserver() {
    thumbObserver?.disconnect?.();
  }

  function unobserveThumb(img) {
    getThumbObserver()?.unobserve?.(img);
  }

  function getCanvasMediaObserver() {
    if (canvasMediaObserver) return canvasMediaObserver;
    const viewport = canvasViewportEl();
    if (typeof IntersectionObserver === 'undefined' || !viewport) return null;
    canvasMediaObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target;
          canvasMediaObserver.unobserve(img);
          if (img.dataset.noteAttachmentKey) loadStickerAttachmentInto(img);
          else loadCanvasMediaInto(img);
        }
      },
      { root: viewport, rootMargin: '320px', threshold: 0.01 }
    );
    return canvasMediaObserver;
  }

  function disconnectCanvasMediaObserver() {
    try {
      canvasMediaObserver?.disconnect?.();
    } catch {
      // ignore
    }
    canvasMediaObserver = null;
  }

  function probeCanvasMediaUrl(url) {
    if (!url || typeof Image === 'undefined') return Promise.resolve(Boolean(url));
    canvasPendingMediaUrls.add(url);
    return new Promise((resolve) => {
      const probe = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        canvasPendingMediaUrls.delete(url);
        resolve(ok);
      };
      probe.onload = () => finish(true);
      probe.onerror = () => finish(false);
      probe.src = url;
      if (typeof probe.decode === 'function') {
        probe.decode().then(() => finish(true)).catch(() => finish(false));
      }
    });
  }

  function forgetCachedMediaUrl(key, kind, url) {
    const cache = kind === 'snap'
      ? snapCache
      : kind === 'attachment' ? attachmentUrlCache : thumbUrlCache;
    if (cache.get(key) !== url) return;
    cache.delete(key);
    revokeObjectUrl(url);
  }

  function pruneAttachmentUrlCache(items) {
    const list = items !== undefined ? items : getAllTabs();
    const keep = new Set();
    const mediaDb = Media();
    for (const item of list || []) {
      const notes = item.kind === 'group' ? item.notes || [] : item.kind === 'note' ? [item] : [];
      for (const note of notes) {
        for (const attachment of note.attachments || []) {
          keep.add(
            mediaDb
              ? mediaDb.mediaKeyNoteAttachment(note.id, attachment.id)
              : `n:${note.id}:${attachment.id}`
          );
        }
      }
    }
    for (const [key, url] of attachmentUrlCache) {
      if (keep.has(key)) continue;
      attachmentUrlCache.delete(key);
      revokeObjectUrl(url);
    }
  }

  function loadThumbInto(img) {
    if (!img) return;
    const key = img.dataset.mediaKey;
    if (!key || img.dataset.loaded === '1') return;
    img.dataset.loaded = '1';
    if (thumbUrlCache.has(key)) {
      img.src = thumbUrlCache.get(key);
      return;
    }
    fetchMediaUrl(key, 'thumb').then((url) => {
      if (url && img.isConnected) img.src = url;
    });
  }

  function canvasPreferredMediaKind() {
    return canvasZoom() > 1 ? 'snap' : 'thumb';
  }

  function canvasMediaKindForImage(img) {
    if (img?.dataset.canvasPreferSnap === 'true' && img.dataset.canvasHasSnap !== 'false') {
      return 'snap';
    }
    const preferred = canvasPreferredMediaKind();
    return preferred === 'snap' && img?.dataset.canvasHasSnap === 'false' ? 'thumb' : preferred;
  }

  function loadCanvasMediaInto(img) {
    if (!img) return;
    const key = img.dataset.mediaKey;
    if (!key) return;
    const preferred = canvasMediaKindForImage(img);
    const fallback = preferred === 'snap'
      ? 'thumb'
      : img.dataset.canvasHasSnap === 'true' ? 'snap' : '';
    const token = String((Number(img.dataset.canvasLoadToken) || 0) + 1);
    img.dataset.canvasLoadToken = token;
    img.dataset.canvasLoadingKind = preferred;
    (async () => {
      let loadedKind = preferred;
      let preferredFailed = false;
      let url = await fetchMediaUrl(key, preferred);
      if (url && !(await probeCanvasMediaUrl(url))) {
        if (preferred === 'snap') forgetCachedMediaUrl(key, 'snap', url);
        preferredFailed = preferred === 'snap';
        url = '';
      }
      if (!url) {
        loadedKind = fallback;
        url = fallback ? await fetchMediaUrl(key, fallback) : '';
        if (url && !(await probeCanvasMediaUrl(url))) {
          if (fallback === 'snap') forgetCachedMediaUrl(key, 'snap', url);
          url = '';
        }
      }
      if (img.dataset.canvasLoadToken !== token) return;
      if (preferredFailed) img.dataset.canvasSnapState = 'unavailable';
      if (!url) {
        if (preferred === 'snap') img.dataset.canvasSnapState = 'unavailable';
        delete img.dataset.canvasLoadingKind;
        return;
      }
      if (!img.isConnected) return;
      img.src = url;
      img.dataset.canvasLoadedKind = loadedKind;
      if (loadedKind === 'snap') delete img.dataset.canvasSnapState;
      delete img.dataset.canvasLoadingKind;
    })().catch(() => {
      if (img.dataset.canvasLoadToken === token) delete img.dataset.canvasLoadingKind;
    });
  }

  function loadStickerAttachmentInto(img) {
    if (!img) return;
    const key = img.dataset.noteAttachmentKey;
    if (!key || img.dataset.noteAttachmentLoaded === '1' || img.dataset.noteAttachmentLoading === '1') return;
    img.dataset.noteAttachmentLoading = '1';
    fetchMediaUrl(key, 'attachment').then((url) => {
      if (!img.isConnected) return;
      if (url) {
        img.src = url;
        img.dataset.noteAttachmentLoaded = '1';
      } else if (img.dataset.attachmentId) {
        img.replaceWith(Object.assign(document.createElement('span'), {
          className: 'note-attachment-missing',
          textContent: t('noteAttachmentMissing'),
        }));
      }
      delete img.dataset.noteAttachmentLoading;
    }).catch(() => {
      if (img.isConnected) delete img.dataset.noteAttachmentLoading;
    });
  }

  function observeStickerAttachment(img) {
    if (!img || !img.dataset.noteAttachmentKey) return;
    if (attachmentUrlCache.has(img.dataset.noteAttachmentKey)) {
      const key = img.dataset.noteAttachmentKey;
      const url = attachmentUrlCache.get(key);
      attachmentUrlCache.delete(key);
      attachmentUrlCache.set(key, url);
      img.src = url;
      img.dataset.noteAttachmentLoaded = '1';
      return;
    }
    const observer = getCanvasMediaObserver();
    if (!observer) {
      loadStickerAttachmentInto(img);
      return;
    }
    const viewportRect = canvasViewportEl()?.getBoundingClientRect?.();
    const imageRect = img.getBoundingClientRect?.();
    const margin = 320;
    if (!img.isConnected) {
      observer.observe(img);
      return;
    }
    const isNearViewport = Boolean(
      viewportRect && imageRect &&
      imageRect.bottom >= viewportRect.top - margin &&
      imageRect.top <= viewportRect.bottom + margin &&
      imageRect.right >= viewportRect.left - margin &&
      imageRect.left <= viewportRect.right + margin
    );
    observer.unobserve(img);
    if (isNearViewport) loadStickerAttachmentInto(img);
    else observer.observe(img);
  }

  function loadCanvasThumbFallback(img) {
    if (!img) return;
    const key = img.dataset.mediaKey;
    if (!key) return;
    const token = String((Number(img.dataset.canvasLoadToken) || 0) + 1);
    img.dataset.canvasLoadToken = token;
    img.dataset.canvasLoadingKind = 'thumb';
    fetchMediaUrl(key, 'thumb').then(async (url) => {
      if (!url || !(await probeCanvasMediaUrl(url))) {
        if (img.dataset.canvasLoadToken === token) delete img.dataset.canvasLoadingKind;
        return;
      }
      if (img.dataset.canvasLoadToken !== token || !img.isConnected) return;
      img.src = url;
      img.dataset.canvasLoadedKind = 'thumb';
      delete img.dataset.canvasLoadingKind;
    }).catch(() => {
      if (img.dataset.canvasLoadToken === token) delete img.dataset.canvasLoadingKind;
    });
  }

  function observeCanvasMedia(img) {
    if (!img) return;
    const key = img.dataset.mediaKey;
    if (!key) return;
    const preferred = canvasMediaKindForImage(img);
    const previousPreferred = img.dataset.canvasPreferredKind;
    img.dataset.canvasPreferredKind = preferred;
    if (previousPreferred !== preferred) delete img.dataset.canvasSnapState;
    if (
      img.dataset.canvasLoadedKind === preferred ||
      img.dataset.canvasLoadingKind === preferred
    ) {
      return;
    }
    if (preferred === 'snap' && img.dataset.canvasSnapState === 'unavailable') return;
    const obs = getCanvasMediaObserver();
    if (!obs) {
      loadCanvasMediaInto(img);
      return;
    }
    obs.unobserve(img);
    const viewportRect = canvasViewportEl()?.getBoundingClientRect?.();
    const imageRect = img.getBoundingClientRect?.();
    const margin = 320;
    const isNearViewport = Boolean(
      viewportRect && imageRect &&
      imageRect.bottom >= viewportRect.top - margin &&
      imageRect.top <= viewportRect.bottom + margin &&
      imageRect.right >= viewportRect.left - margin &&
      imageRect.left <= viewportRect.right + margin
    );
    if (isNearViewport) loadCanvasMediaInto(img);
    else obs.observe(img);
  }

  function refreshCanvasMediaQuality() {
    canvasNodesEl()?.querySelectorAll('img[data-canvas-media="true"]').forEach(wireCanvasMedia);
  }

  function scheduleCanvasMediaQualityRefresh() {
    if (canvasMediaQualityRaf) return;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);
    canvasMediaQualityRaf = schedule(() => {
      canvasMediaQualityRaf = 0;
      refreshCanvasMediaQuality();
    });
  }

  function handleCanvasMediaError(img) {
    if (!img || img.dataset.canvasLoadedKind !== 'snap') return;
    const key = img.dataset.mediaKey;
    const failedUrl = img.currentSrc || img.src;
    forgetCachedMediaUrl(key, 'snap', failedUrl);
    img.dataset.canvasSnapState = 'unavailable';
    delete img.dataset.canvasLoadedKind;
    loadCanvasThumbFallback(img);
  }

  function wireCanvasMedia(img) {
    if (!img) return;
    if (img.dataset.canvasMediaWired !== 'true') {
      img.dataset.canvasMediaWired = 'true';
      img.addEventListener('error', () => handleCanvasMediaError(img));
    }
    thumbObserver?.unobserve?.(img);
    observeCanvasMedia(img);
  }

  function observeThumb(img) {
    if (!img) return;
    const key = img.dataset.mediaKey;
    if (!key || img.dataset.loaded === '1') return;
    // Cache hit: paint immediately (no flash on search re-render)
    if (thumbUrlCache.has(key)) {
      img.dataset.loaded = '1';
      img.src = thumbUrlCache.get(key);
      return;
    }
    const obs = getThumbObserver();
    if (!obs) {
      loadThumbInto(img);
      return;
    }
    obs.observe(img);
  }

  function mediaKeyForItem(item) {
    if (!item) return '';
    if (item.kind === 'group') return '';
    const mediaDb = Media();
    return mediaDb ? mediaDb.mediaKeyTab(item.id) : `t:${item.id}`;
  }

  function mediaKeyForMember(groupId, memberId) {
    const mediaDb = Media();
    return mediaDb ? mediaDb.mediaKeyMember(groupId, memberId) : `g:${groupId}:${memberId}`;
  }

  global.TabWallMediaUi = {
    bind,
    snapCache,
    cacheSnap,
    fetchMediaUrl,
    disconnectThumbObserver,
    wireCanvasMedia,
    observeThumb,
    observeStickerAttachment,
    unobserveThumb,
    disconnectCanvasMediaObserver,
    pruneAttachmentUrlCache,
    refreshCanvasMediaQuality,
    scheduleCanvasMediaQualityRefresh,
    mediaKeyForItem,
    mediaKeyForMember,
  };
})(typeof self !== 'undefined' ? self : globalThis);
