/**
 * TabWall — Content shell
 * 低對比遮罩 + 98% 畫布（iframe park UI），其餘 2% 為原頁模糊框
 */

(() => {
  const INJECTED_MARKER = '__tabWallInjected';
  const runtimeIdentity = (() => {
    try {
      const version = chrome.runtime.getManifest?.()?.version || '';
      return `${chrome.runtime.id || ''}@${version}`;
    } catch {
      return '';
    }
  })();
  const previousInstance = window[INJECTED_MARKER];
  try {
    if (previousInstance?.active === true) previousInstance.dispose?.();
  } catch {
    // A stale content-script instance may belong to a reloaded extension.
  }

  const ROOT_ID = 'tabwall-root';
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('park.html')).origin;
  let isOpen = false;
  let rootEl = null;
  let shadow = null;
  let messageHandler = null;
  let runtimeMessageHandler = null;
  let keyHandler = null;
  let iframeEl = null;
  /** @type {object|null} */
  let pendingConflict = null;
  /** @type {object|null} */
  let pendingPreSave = null;
  let pendingPageStickerEditor = null;
  let pendingPageStickerReminder = null;
  let iframeReady = false;
  let previousActiveElement = null;

  function restorePreviousFocus() {
    const target = previousActiveElement;
    previousActiveElement = null;
    if (!target || typeof target.focus !== 'function') return;
    try {
      target.focus({ preventScroll: true });
    } catch {
      try {
        target.focus();
      } catch {
        // ignore
      }
    }
  }

  function destroy() {
    if (pendingConflict) {
      try {
        chrome.runtime.sendMessage({ type: 'RESOLVE_SAVE_CONFLICT', decision: 'cancel' }, () => {});
      } catch {
        // ignore
      }
    }
    if (pendingPreSave) {
      try {
        chrome.runtime.sendMessage({ type: 'RESOLVE_PRESAVE_EDIT', decision: 'cancel' }, () => {});
      } catch {
        // ignore
      }
    }
    if (messageHandler) {
      window.removeEventListener('message', messageHandler);
      messageHandler = null;
    }
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler, true);
      keyHandler = null;
    }
    if (rootEl) {
      rootEl.remove();
      rootEl = null;
      shadow = null;
    }
    iframeEl = null;
    isOpen = false;
    iframeReady = false;
    pendingConflict = null;
    pendingPreSave = null;
    pendingPageStickerEditor = null;
    pendingPageStickerReminder = null;
    restorePreviousFocus();
  }

  function dispose() {
    destroy();
    if (runtimeMessageHandler) {
      try {
        chrome.runtime.onMessage.removeListener(runtimeMessageHandler);
      } catch {
        // ignore stale extension contexts
      }
      runtimeMessageHandler = null;
    }
    if (window[INJECTED_MARKER]?.dispose === dispose) {
      delete window[INJECTED_MARKER];
    }
  }

  function focusParkSearch() {
    if (!iframeEl?.contentWindow) return;
    try {
      iframeEl.focus();
      iframeEl.contentWindow.postMessage({ type: 'TABWALL_FOCUS_SEARCH' }, EXTENSION_ORIGIN);
    } catch {
      // ignore
    }
  }

  function postToPark(payload) {
    if (!iframeEl?.contentWindow) return false;
    try {
      iframeEl.contentWindow.postMessage(payload, EXTENSION_ORIGIN);
      return true;
    } catch {
      return false;
    }
  }

  function flushPendingConflict() {
    if (!pendingConflict || !iframeReady) return;
    postToPark({ type: 'TABWALL_SAVE_CONFLICT', conflict: pendingConflict });
  }

  function flushPendingPreSave() {
    if (!pendingPreSave || !iframeReady) return;
    postToPark({ type: 'TABWALL_PRESAVE_EDIT', preSave: pendingPreSave });
  }

  function flushPendingPageStickerEditor() {
    if (!pendingPageStickerEditor || !iframeReady) return;
    const payload = pendingPageStickerEditor;
    pendingPageStickerEditor = null;
    postToPark({
      type: 'TABWALL_OPEN_PAGE_STICKER_EDITOR',
      ...payload,
    });
  }

  function flushPendingPageStickerReminder() {
    if (!pendingPageStickerReminder || !iframeReady) return;
    const payload = pendingPageStickerReminder;
    pendingPageStickerReminder = null;
    postToPark({
      type: 'TABWALL_OPEN_PAGE_STICKER_REMINDER',
      ...payload,
    });
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      const schedule = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 0);
      schedule(() => schedule(resolve));
    });
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const result = chrome.runtime.lastError
            ? { ok: false, error: chrome.runtime.lastError.message }
            : response || { ok: false, error: 'empty_response' };
          resolve(result);
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function sendSaveMessage() {
    return sendRuntimeMessage({ type: 'SAVE_TAB_FROM_CONTENT' });
  }

  async function saveActiveWithoutOverlay() {
    const overlay = rootEl;
    const previousVisibility = overlay?.style?.visibility || '';
    if (overlay) overlay.style.visibility = 'hidden';
    let result;
    try {
      await waitForPaint();
      result = await sendSaveMessage();
    } catch (err) {
      result = { ok: false, error: String(err) };
    } finally {
      if (overlay && rootEl === overlay) overlay.style.visibility = previousVisibility;
    }
    postToPark({ type: 'TABWALL_SAVE_RESULT', result });
  }

  /** Hides the overlay so captureVisibleTab shoots the real page, then commits the pre-save edit. */
  async function commitPreSaveWithoutOverlay(note, tags) {
    const overlay = rootEl;
    const previousVisibility = overlay?.style?.visibility || '';
    pendingPreSave = null; // a destroy() triggered mid-flight must not also send a cancel
    if (overlay) overlay.style.visibility = 'hidden';
    let result;
    try {
      await waitForPaint();
      result = await sendRuntimeMessage({ type: 'RESOLVE_PRESAVE_EDIT', decision: 'save', note, tags });
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
    if (result?.ok) {
      destroy();
      return;
    }
    if (overlay && rootEl === overlay) overlay.style.visibility = previousVisibility;
    postToPark({ type: 'TABWALL_PRESAVE_RESULT', result });
  }

  async function cancelPreSave() {
    pendingPreSave = null;
    try {
      await sendRuntimeMessage({ type: 'RESOLVE_PRESAVE_EDIT', decision: 'cancel' });
    } catch {
      // ignore
    }
    destroy();
  }

  function open() {
    if (isOpen) return;
    previousActiveElement = document.activeElement;
    isOpen = true;
    iframeReady = false;

    rootEl = document.createElement('div');
    rootEl.id = ROOT_ID;
    rootEl.setAttribute('data-tabwall', '1');
    shadow = rootEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host, * { box-sizing: border-box; }
      .shell {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: rgba(32, 38, 41, 0.28);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }
      .panel {
        width: 98%;
        height: 98%;
        max-width: 98%;
        max-height: 98%;
        border-radius: 0;
        overflow: hidden;
        border: 0;
        box-shadow: none;
        background: #e8ecee;
      }
      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        background: transparent;
      }

    `;

    const shell = document.createElement('div');
    shell.className = 'shell';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-label', 'TabWall');

    const panel = document.createElement('div');
    panel.className = 'panel';

    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('park.html');
    iframe.title = 'TabWall';
    iframe.allow = 'clipboard-read; clipboard-write';
    iframeEl = iframe;

    panel.appendChild(iframe);
    shell.appendChild(panel);
    shadow.append(style, shell);
    document.documentElement.appendChild(rootEl);

    shell.addEventListener('click', (e) => {
      if (e.target === shell) destroy();
    });

    iframe.addEventListener('load', () => {
      iframeReady = true;
      try {
        iframe.focus();
      } catch {
        // ignore
      }
      flushPendingConflict();
      flushPendingPreSave();
      flushPendingPageStickerEditor();
      flushPendingPageStickerReminder();
    });

    keyHandler = (e) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        const active = document.activeElement;
        if (active === iframe) return;
        e.preventDefault();
        e.stopPropagation();
        destroy();
        return;
      }

      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const active = document.activeElement;
        const tag = active && active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) {
          if (active !== iframe) return;
        }
        if (active === iframe) {
          focusParkSearch();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        focusParkSearch();
      }
    };
    document.addEventListener('keydown', keyHandler, true);

    messageHandler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.origin !== EXTENSION_ORIGIN) return;
      if (event.data?.type === 'TABWALL_CLOSE') destroy();
      if (event.data?.type === 'TABWALL_SAVE_ACTIVE') {
        saveActiveWithoutOverlay();
      }
      if (event.data?.type === 'TABWALL_PRESAVE_COMMIT') {
        commitPreSaveWithoutOverlay(event.data.note, event.data.tags);
      }
      if (event.data?.type === 'TABWALL_PRESAVE_CANCEL') {
        cancelPreSave();
      }
      if (event.data?.type === 'TABWALL_PAGE_STICKER_SAVED') {
        window.postMessage({
          type: 'TABWALL_PAGE_STICKER_CHANGED',
          url: event.data.url || '',
          noteId: event.data.noteId || '',
        }, '*');
        destroy();
      }
      if (event.data?.type === 'TABWALL_PAGE_STICKER_CHANGED') {
        window.postMessage({
          type: 'TABWALL_PAGE_STICKER_CHANGED',
          url: event.data.url || '',
          noteId: event.data.noteId || '',
        }, '*');
      }
      if (event.data?.type === 'TABWALL_PAGE_STICKER_CANCEL') {
        destroy();
      }
      if (event.data?.type === 'TABWALL_PARK_READY') {
        iframeReady = true;
        flushPendingConflict();
        flushPendingPreSave();
        flushPendingPageStickerEditor();
        flushPendingPageStickerReminder();
      }
    };
    window.addEventListener('message', messageHandler);
  }

  function ensureOpen() {
    if (!isOpen) open();
  }

  function showSaveConflict(conflict) {
    pendingConflict = conflict || null;
    ensureOpen();
    if (iframeReady) flushPendingConflict();
  }

  function showPreSaveEdit(preSave) {
    pendingPreSave = preSave || null;
    ensureOpen();
    if (iframeReady) flushPendingPreSave();
  }

  function showPageStickerEditor(payload) {
    pendingPageStickerEditor = payload || null;
    ensureOpen();
    if (iframeReady) flushPendingPageStickerEditor();
  }

  function showPageStickerReminder(payload) {
    pendingPageStickerReminder = payload || null;
    ensureOpen();
    if (iframeReady) flushPendingPageStickerReminder();
  }

  function toggle() {
    if (isOpen) destroy();
    else open();
  }

  runtimeMessageHandler = (message, _sender, sendResponse) => {
    if (message?.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'TOGGLE_PARK') {
      try {
        toggle();
        sendResponse({ ok: true, open: isOpen });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return false;
    }
    if (message?.type === 'OPEN_PARK') {
      try {
        ensureOpen();
        sendResponse({ ok: true, open: isOpen });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return false;
    }
    if (message?.type === 'SHOW_SAVE_CONFLICT') {
      try {
        showSaveConflict(message.conflict);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return false;
    }
    if (message?.type === 'SHOW_PRESAVE_EDIT') {
      try {
        showPreSaveEdit(message.preSave);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return false;
    }
    if (message?.type === 'OPEN_PAGE_STICKER_EDITOR') {
      try {
        showPageStickerEditor({
          url: message.url || '',
          noteId: message.noteId || '',
          placement: message.placement || null,
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return false;
    }
    if (message?.type === 'OPEN_PAGE_STICKER_REMINDER') {
      try {
        showPageStickerReminder({
          url: message.url || '',
          noteId: message.noteId || '',
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return false;
    }
    if (message?.type === 'CLOSE_PARK') {
      destroy();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(runtimeMessageHandler);
  window[INJECTED_MARKER] = {
    active: true,
    runtimeIdentity,
    dispose,
  };
})();
