/**
 * TabWall — Content shell
 * 低對比遮罩 + 全視窗畫布（iframe park UI）
 */

(() => {
  if (window.__tabWallInjected) return;
  window.__tabWallInjected = true;

  const ROOT_ID = 'tabwall-root';
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('park.html')).origin;
  let isOpen = false;
  let rootEl = null;
  let shadow = null;
  let messageHandler = null;
  let keyHandler = null;
  let iframeEl = null;
  /** @type {object|null} */
  let pendingConflict = null;
  /** @type {object|null} */
  let pendingPreSave = null;
  let iframeReady = false;

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
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: rgba(32, 38, 41, 0.2);
      }
      .panel {
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
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
      if (event.data?.type === 'TABWALL_PARK_READY') {
        iframeReady = true;
        flushPendingConflict();
        flushPendingPreSave();
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

  function toggle() {
    if (isOpen) destroy();
    else open();
  }

  let quickRoot = null;
  let quickTimer = 0;
  let quickHits = [];
  let quickIndex = 0;

  function closeQuickSearch() {
    if (quickTimer) clearTimeout(quickTimer);
    quickTimer = 0;
    quickHits = [];
    quickIndex = 0;
    if (quickRoot) {
      quickRoot.remove();
      quickRoot = null;
    }
  }

  function restoreQuickHit(hit, openWall) {
    if (!hit?.id) return;
    if (openWall) {
      chrome.runtime.sendMessage({ type: 'OPEN_PARK_ACTIVE', focusId: hit.id }, () => {});
      closeQuickSearch();
      return;
    }
    const type = hit.kind === 'group' ? 'RESTORE_GROUP' : 'RESTORE_TAB';
    chrome.runtime.sendMessage({ type, id: hit.id }, () => {});
    closeQuickSearch();
  }

  function renderQuickHits() {
    const list = quickRoot?.querySelector('.qs-list');
    if (!list) return;
    list.replaceChildren();
    quickHits.forEach((hit, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'qs-row' + (index === quickIndex ? ' active' : '');
      row.dataset.index = String(index);
      const title = document.createElement('strong');
      title.textContent = hit.title || hit.url || hit.id;
      const meta = document.createElement('span');
      meta.textContent = hit.kind === 'note' ? (hit.markdown || hit.note || '') : (hit.url || hit.note || '');
      row.append(title, meta);
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        restoreQuickHit(hit, event.shiftKey);
      });
      list.appendChild(row);
    });
  }

  function queryQuickSearch(raw) {
    if (quickTimer) clearTimeout(quickTimer);
    quickTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'SEARCH_PARKED', query: raw, limit: 8 }, (res) => {
        quickHits = Array.isArray(res?.hits) ? res.hits : [];
        quickIndex = 0;
        renderQuickHits();
      });
    }, 80);
  }

  function openQuickSearch() {
    if (isOpen) {
      focusParkSearch();
      return;
    }
    if (quickRoot) {
      quickRoot.querySelector('input')?.focus();
      return;
    }
    quickRoot = document.createElement('div');
    quickRoot.id = 'tabwall-quick-search';
    const shadow = quickRoot.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .qs {
          position: fixed; inset: 18vh 0 auto; z-index: 2147483647;
          display: flex; justify-content: center; pointer-events: none;
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .qs-panel {
          pointer-events: auto; width: min(520px, calc(100vw - 32px));
          border: 1px solid rgba(232,225,210,.18); border-radius: 10px;
          background: #12141a; color: #eee8dc;
          box-shadow: 0 24px 70px rgba(0,0,0,.45);
        }
        input {
          width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid rgba(232,225,210,.12);
          background: transparent; color: inherit; padding: 14px 16px; font: inherit; outline: none;
        }
        .qs-list { display: grid; max-height: 320px; overflow: auto; padding: 6px; }
        .qs-row {
          display: grid; gap: 2px; width: 100%; text-align: left; border: 0; border-radius: 7px;
          background: transparent; color: inherit; padding: 8px 10px; cursor: pointer;
        }
        .qs-row.active, .qs-row:hover { background: rgba(232,225,210,.08); }
        .qs-row span { color: #a39c91; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      </style>
      <div class="qs"><div class="qs-panel">
        <input type="search" placeholder="Search parked tabs…" autocomplete="off" spellcheck="false" />
        <div class="qs-list"></div>
      </div></div>
    `;
    const input = shadow.querySelector('input');
    input.addEventListener('input', () => queryQuickSearch(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeQuickSearch();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        quickIndex = Math.min(quickHits.length - 1, quickIndex + 1);
        renderQuickHits();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        quickIndex = Math.max(0, quickIndex - 1);
        renderQuickHits();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        restoreQuickHit(quickHits[quickIndex], event.shiftKey);
      }
    });
    document.documentElement.appendChild(quickRoot);
    input.focus();
  }

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key !== '/' && event.code !== 'Slash') return;
    event.preventDefault();
    event.stopPropagation();
    if (quickRoot) closeQuickSearch();
    else openQuickSearch();
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    if (message?.type === 'CLOSE_PARK') {
      destroy();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'TOGGLE_QUICK_SEARCH') {
      try {
        if (quickRoot) closeQuickSearch();
        else openQuickSearch();
        sendResponse({ ok: true, open: Boolean(quickRoot) });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return false;
    }
    return false;
  });
})();
