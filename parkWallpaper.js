/**
 * TabWall wallpaper — custom static background for park.html.
 * Blob in IndexedDB (w:background); metadata on settings.wallpaper.
 */
(function (global) {
  'use strict';

  const FITS = Object.freeze(['center', 'fitWidth', 'fitHeight', 'original']);
  const DEFAULT = Object.freeze({
    enabled: false,
    fit: 'center',
    opacity: 40,
    blurPx: 16,
    mime: '',
    width: 0,
    height: 0,
    updatedAt: 0,
  });

  /** @type {Record<string, any>|null} */
  let env = null;
  let objectUrl = '';

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    env = next;
  }

  function clampInt(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
  }

  function normalizeWallpaper(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const fit = FITS.includes(o.fit) ? o.fit : DEFAULT.fit;
    return {
      enabled: o.enabled === true,
      fit,
      opacity: clampInt(o.opacity, 15, 70, DEFAULT.opacity),
      blurPx: clampInt(o.blurPx, 0, 32, DEFAULT.blurPx),
      mime: typeof o.mime === 'string' && /^image\/(webp|png|jpeg|jpg)$/i.test(o.mime)
        ? String(o.mime).toLowerCase()
        : '',
      width: clampInt(o.width, 0, 16384, 0),
      height: clampInt(o.height, 0, 16384, 0),
      updatedAt: Number(o.updatedAt) > 0 ? Number(o.updatedAt) : 0,
    };
  }

  function mediaKey() {
    return env?.Media?.mediaKeyWallpaper?.() || 'w:background';
  }

  function revokeUrl() {
    if (!objectUrl) return;
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
    objectUrl = '';
  }

  function layerEl() {
    return global.document?.getElementById?.('wallBg') || null;
  }

  function imageEl(layer) {
    return layer?.querySelector?.('.wall-bg-image') || null;
  }

  function paint(wallpaper, url) {
    const doc = global.document;
    if (!doc?.documentElement) return;
    const enabled = Boolean(wallpaper?.enabled && url);
    doc.documentElement.classList.toggle('has-wallpaper', enabled);
    doc.body?.classList.toggle('has-wallpaper', enabled);
    if (doc.body) {
      if (enabled) doc.body.dataset.wallpaperFit = wallpaper.fit;
      else delete doc.body.dataset.wallpaperFit;
    }
    const layer = layerEl();
    if (!layer) return;
    layer.hidden = !enabled;
    layer.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    if (enabled) {
      layer.style.setProperty('--wall-opacity', String(wallpaper.opacity / 100));
      layer.style.setProperty('--wall-blur', `${wallpaper.blurPx}px`);
    } else {
      layer.style.removeProperty('--wall-opacity');
      layer.style.removeProperty('--wall-blur');
    }
    const img = imageEl(layer);
    if (img) img.style.backgroundImage = enabled ? `url("${url}")` : '';
    const preview = doc.getElementById('settingsWallpaperPreview');
    if (preview) {
      preview.style.backgroundImage = url ? `url("${url}")` : '';
      preview.classList.toggle('is-empty', !url);
    }
    const removeBtn = doc.getElementById('settingsWallpaperRemove');
    if (removeBtn) removeBtn.disabled = !enabled;
  }

  function syncControls(wallpaper) {
    const doc = global.document;
    if (!doc) return;
    const next = normalizeWallpaper(wallpaper ?? env?.settings?.wallpaper);
    const fitRadio =
      doc.querySelector(`#settings input[name="wallpaperFit"][value="${next.fit}"]`)
      || doc.querySelector('#settings input[name="wallpaperFit"][value="center"]');
    if (fitRadio) fitRadio.checked = true;
    const blur = doc.getElementById('settingsWallpaperBlur');
    const blurValue = doc.getElementById('settingsWallpaperBlurValue');
    if (blur) blur.value = String(next.blurPx);
    if (blurValue) blurValue.textContent = String(next.blurPx);
    const opacity = doc.getElementById('settingsWallpaperOpacity');
    const opacityValue = doc.getElementById('settingsWallpaperOpacityValue');
    if (opacity) opacity.value = String(next.opacity);
    if (opacityValue) opacityValue.textContent = String(next.opacity);
    const removeBtn = doc.getElementById('settingsWallpaperRemove');
    if (removeBtn) removeBtn.disabled = !next.enabled;
  }

  function setStatus(text) {
    const el = global.document?.getElementById?.('settingsWallpaperStatus');
    if (el) el.textContent = text || '';
  }

  async function apply(wallpaper) {
    const next = normalizeWallpaper(wallpaper ?? env?.settings?.wallpaper);
    if (!next.enabled) {
      revokeUrl();
      paint(next, '');
      syncControls(next);
      return next;
    }
    if (!objectUrl) {
      let blob = null;
      try {
        blob = await env?.Media?.getAttachment?.(mediaKey());
      } catch {
        blob = null;
      }
      if (!blob) {
        paint({ ...next, enabled: false }, '');
        syncControls(next);
        return next;
      }
      objectUrl = URL.createObjectURL(blob);
    }
    paint(next, objectUrl);
    syncControls(next);
    return next;
  }

  async function setFromFile(file) {
    if (!env?.NoteMedia?.normalizeBlob) throw new Error('note_image_invalid');
    const normalized = await env.NoteMedia.normalizeBlob(file);
    if (!normalized?.blob) throw new Error('note_image_invalid');
    await env.Media.putAttachment(mediaKey(), normalized.blob);
    revokeUrl();
    objectUrl = URL.createObjectURL(normalized.blob);
    const current = normalizeWallpaper(env.settings?.wallpaper);
    return {
      ...current,
      enabled: true,
      mime: normalized.mime || normalized.blob.type || 'image/webp',
      width: normalized.width || 0,
      height: normalized.height || 0,
      updatedAt: Date.now(),
    };
  }

  async function clear() {
    revokeUrl();
    try {
      await env?.Media?.remove?.(mediaKey());
    } catch {
      // best effort
    }
    const next = { ...DEFAULT };
    paint(next, '');
    syncControls(next);
    return next;
  }

  async function hydrateForExport(settings) {
    const next = settings && typeof settings === 'object' ? { ...settings } : {};
    const wallpaper = normalizeWallpaper(next.wallpaper);
    next.wallpaper = { ...wallpaper };
    if (!wallpaper.enabled) return next;
    let blob = null;
    try {
      blob = await env?.Media?.getAttachment?.(mediaKey());
    } catch {
      blob = null;
    }
    if (!blob || !env?.Media?.blobToDataUrl) return next;
    next.wallpaper.data = await env.Media.blobToDataUrl(blob);
    return next;
  }

  async function persistFromDataUrl(dataUrl) {
    const blob = env?.Media?.dataUrlToBlob?.(dataUrl);
    if (!blob) return false;
    await env.Media.putAttachment(mediaKey(), blob);
    revokeUrl();
    return true;
  }

  function blobSize() {
    return env?.Media?.getAttachment?.(mediaKey())
      .then((blob) => (blob && Number.isFinite(blob.size) ? blob.size : 0))
      .catch(() => 0);
  }

  global.TabWallWallpaper = {
    bind,
    DEFAULT,
    FITS,
    normalizeWallpaper,
    apply,
    setFromFile,
    clear,
    hydrateForExport,
    persistFromDataUrl,
    syncControls,
    setStatus,
    blobSize,
    mediaKey,
  };
})(typeof self !== 'undefined' ? self : globalThis);
