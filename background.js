/**
 * TabWall — Service Worker
 */

const STORAGE_KEY = 'parkedTabs';
const SETTINGS_KEY = 'settings';
const MAX_THUMB_WIDTH = 360;
const JPEG_QUALITY = 0.5;
const DEFAULT_SETTINGS = { afterSave: 'close' }; // 'close' | 'keep'

// ─── Storage ───────────────────────────────────────────────────────

async function getParkedTabs() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function setParkedTabs(tabs) {
  await chrome.storage.local.set({ [STORAGE_KEY]: tabs });
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

// ─── Image compression ─────────────────────────────────────────────

async function compressImage(dataUrl, maxWidth = MAX_THUMB_WIDTH, quality = JPEG_QUALITY) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  let width = bitmap.width;
  let height = bitmap.height;
  if (width > maxWidth) {
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

/** 在當前分頁注入／切換前景浮層（不另開視窗） */
async function toggleParkOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    console.warn('[TabWall] Cannot inject overlay on this page:', tab?.url);
    await flashBadge('!');
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PARK' });
    return;
  } catch {
    // content script not present
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

// ─── Save tab ──────────────────────────────────────────────────────

async function saveCurrentTab(tab) {
  if (!tab || tab.id == null) {
    await flashBadge('!');
    return;
  }
  if (isRestrictedUrl(tab.url)) {
    console.warn('[TabWall] Cannot capture restricted page:', tab.url);
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
  try {
    thumbnail = await compressImage(dataUrl);
  } catch (err) {
    console.warn('[TabWall] compressImage failed:', err);
    await flashBadge('!');
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    url: tab.url,
    title: tab.title || tab.url || 'Untitled',
    favIconUrl: tab.favIconUrl || '',
    thumbnail,
    savedAt: Date.now(),
  };

  const list = await getParkedTabs();
  list.unshift(entry);
  await setParkedTabs(list);

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

// ─── Messages ──────────────────────────────────────────────────────

async function restoreTab(id) {
  const list = await getParkedTabs();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return { ok: false, error: 'not_found' };

  const item = list[idx];
  list.splice(idx, 1);
  await setParkedTabs(list);

  try {
    await chrome.tabs.create({ url: item.url, active: true });
  } catch (err) {
    list.splice(idx, 0, item);
    await setParkedTabs(list);
    return { ok: false, error: String(err) };
  }
  return { ok: true, remaining: list.length };
}

async function deleteTab(id) {
  const list = await getParkedTabs();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return { ok: false, error: 'not_found' };
  await setParkedTabs(next);
  return { ok: true, remaining: next.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case 'GET_PARKED_TABS':
        return { ok: true, tabs: await getParkedTabs() };
      case 'RESTORE_TAB':
        return restoreTab(message.id);
      case 'DELETE_TAB':
        return deleteTab(message.id);
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
  if (command === 'toggle-park') {
    await toggleParkOnActiveTab();
  }
});

chrome.action.onClicked.addListener(async () => {
  await toggleParkOnActiveTab();
});
