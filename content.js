/**
 * TabWall — Content shell
 * 全屏 blur 背景 + 置中約 95% 面板（iframe park UI）
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
  let iframeReady = false;

  function destroy() {
    if (pendingConflict) {
      try {
        chrome.runtime.sendMessage({ type: 'RESOLVE_SAVE_CONFLICT', decision: 'cancel' }, () => {});
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
        background: rgba(15, 23, 42, 0.5);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }
      .panel {
        width: 95vw;
        height: 95vh;
        max-width: 95vw;
        max-height: 95vh;
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.25);
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
        background: #0b1220;
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
      if (event.data?.type === 'TABWALL_PARK_READY') {
        iframeReady = true;
        flushPendingConflict();
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

  function toggle() {
    if (isOpen) destroy();
    else open();
  }

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
    if (message?.type === 'CLOSE_PARK') {
      destroy();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
