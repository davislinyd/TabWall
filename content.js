/**
 * TabWall — Content shell
 * 全屏 blur 背景 + 置中約 95% 面板（iframe park UI）
 */

(() => {
  if (window.__tabWallInjected) return;
  window.__tabWallInjected = true;

  const ROOT_ID = 'tabwall-root';
  let isOpen = false;
  let rootEl = null;
  let shadow = null;
  let messageHandler = null;
  let keyHandler = null;
  let iframeEl = null;

  function destroy() {
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
  }

  function focusParkSearch() {
    if (!iframeEl?.contentWindow) return;
    try {
      iframeEl.focus();
      iframeEl.contentWindow.postMessage({ type: 'TABWALL_FOCUS_SEARCH' }, '*');
    } catch {
      // ignore
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;

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
        animation: fade 0.07s ease-out;
      }
      @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
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
        animation: panelIn 0.08s ease-out;
      }
      @keyframes panelIn {
        from { opacity: 0; transform: scale(0.97) translateY(8px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
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
      try {
        iframe.focus();
      } catch {
        // ignore
      }
    });

    // Esc / / 在宿主頁 focus 時也能作用
    keyHandler = (e) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        const active = document.activeElement;
        if (active === iframe) return; // park 內優先處理
        e.preventDefault();
        e.stopPropagation();
        destroy();
        return;
      }

      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const active = document.activeElement;
        const tag = active && active.tagName;
        // 宿主頁輸入中不攔截；iframe 內由 park 處理，但若 focus 不在 iframe 則轉發
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) {
          if (active !== iframe) return;
        }
        if (active === iframe) {
          // park.js 自己處理；若其未 focus 到 search，仍補送 message
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
      if (event.data?.type === 'TABWALL_CLOSE') destroy();
    };
    window.addEventListener('message', messageHandler);
  }

  function toggle() {
    if (isOpen) destroy();
    else open();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TOGGLE_PARK') {
      try {
        toggle();
        sendResponse({ ok: true, open: isOpen });
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
