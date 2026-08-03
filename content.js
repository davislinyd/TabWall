/**
 * TabWall — Content Script
 * 當前頁前景浮層：全屏虛化背景 + 約 90% 照片牆面板
 */

(() => {
  if (window.__tabWallInjected) return;
  window.__tabWallInjected = true;

  const ROOT_ID = 'tabwall-root';
  const SETTINGS_KEY = 'settings';
  const DEFAULT_SETTINGS = { afterSave: 'close' };

  let isOpen = false;
  let rootEl = null;
  let shadow = null;
  let escHandler = null;
  let storageListener = null;

  // ─── Messaging / storage ─────────────────────────────────────────

  function sendMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'empty_response' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  }

  async function saveSettings(partial) {
    const next = { ...(await loadSettings()), ...partial };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/`/g, '&#96;');
  }

  // ─── Styles ──────────────────────────────────────────────────────

  const STYLES = `
    :host, * { box-sizing: border-box; }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC",
        "Helvetica Neue", Arial, sans-serif;
      color: #f1f5f9;
      animation: fadeIn 0.16s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .panel {
      width: 90vw;
      height: 90vh;
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      background: #0b1220;
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
      overflow: hidden;
      animation: panelIn 0.18s ease-out;
    }

    @keyframes panelIn {
      from { opacity: 0; transform: scale(0.97) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
    }

    .brand {
      display: flex;
      align-items: baseline;
      gap: 12px;
      min-width: 0;
    }

    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: #f8fafc;
    }

    .count {
      font-size: 13px;
      color: #94a3b8;
      white-space: nowrap;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(15, 23, 42, 0.7);
      color: #e2e8f0;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn:hover {
      background: rgba(51, 65, 85, 0.95);
      border-color: rgba(148, 163, 184, 0.5);
    }

    .btn.active {
      border-color: rgba(96, 165, 250, 0.6);
      color: #60a5fa;
    }

    .settings {
      display: none;
      flex-shrink: 0;
      padding: 12px 18px 14px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      background: #111827;
    }

    .settings.open { display: block; }

    .settings h2 {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .setting-label {
      font-size: 13px;
      color: #e2e8f0;
      margin-bottom: 8px;
    }

    .radios {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
    }

    .radios label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #94a3b8;
      cursor: pointer;
    }

    .radios input { accent-color: #60a5fa; }
    .radios label:has(input:checked) { color: #f1f5f9; }

    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 18px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 14px;
    }

    .empty {
      max-width: 420px;
      margin: 10vh auto 0;
      text-align: center;
      padding: 36px 20px;
      border: 1px dashed rgba(148, 163, 184, 0.3);
      border-radius: 14px;
      color: #94a3b8;
      line-height: 1.6;
      font-size: 14px;
    }

    .empty strong {
      display: block;
      color: #e2e8f0;
      font-size: 16px;
      margin-bottom: 8px;
    }

    kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: #1e293b;
    }

    .card {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      background: #0f172a;
      border: 1px solid rgba(148, 163, 184, 0.2);
      cursor: pointer;
      aspect-ratio: 16 / 11;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
      transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
      outline: none;
    }

    .card:hover, .card:focus-visible {
      transform: translateY(-3px) scale(1.015);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);
      border-color: rgba(96, 165, 250, 0.55);
    }

    .thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      background: #1e293b;
    }

    .caption {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: linear-gradient(transparent, rgba(2, 6, 23, 0.9) 35%);
      pointer-events: none;
    }

    .favicon, .favicon-fallback {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      border-radius: 2px;
      background: #334155;
      object-fit: contain;
    }

    .url {
      min-width: 0;
      flex: 1;
      font-size: 12px;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow: 0 1px 2px rgba(0,0,0,.6);
    }

    .delete-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.75);
      color: #f8fafc;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transform: scale(0.92);
      transition: opacity 0.15s, transform 0.15s, background 0.15s;
      z-index: 2;
    }

    .card:hover .delete-btn,
    .card:focus-within .delete-btn {
      opacity: 1;
      transform: scale(1);
    }

    .delete-btn:hover { background: #ef4444; }
  `;

  // ─── Overlay lifecycle ───────────────────────────────────────────

  function destroyOverlay() {
    if (escHandler) {
      document.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
    if (storageListener) {
      chrome.storage.onChanged.removeListener(storageListener);
      storageListener = null;
    }
    if (rootEl) {
      rootEl.remove();
      rootEl = null;
      shadow = null;
    }
    isOpen = false;
  }

  function closePark() {
    destroyOverlay();
  }

  function ensureRoot() {
    if (rootEl && shadow) return;
    rootEl = document.createElement('div');
    rootEl.id = ROOT_ID;
    rootEl.setAttribute('data-tabwall', '1');
    shadow = rootEl.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(rootEl);
  }

  function createCard(item, onListChange) {
    const card = document.createElement('article');
    card.className = 'card';
    card.tabIndex = 0;
    card.dataset.id = item.id;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `還原：${item.title || item.url}`);

    const title = item.title || item.url || 'Untitled';
    const url = item.url || '';
    const thumb = item.thumbnail || '';
    const fav = item.favIconUrl || '';

    card.innerHTML = `
      <img class="thumb" alt="${escapeAttr(title)}" src="${escapeAttr(thumb)}" />
      <button type="button" class="delete-btn" title="刪除" aria-label="刪除暫存">×</button>
      <div class="caption" title="${escapeAttr(title)}">
        ${
          fav
            ? `<img class="favicon" alt="" src="${escapeAttr(fav)}" />`
            : `<span class="favicon-fallback" aria-hidden="true"></span>`
        }
        <span class="url">${escapeHtml(url)}</span>
      </div>
    `;

    const favImg = card.querySelector('img.favicon');
    if (favImg) {
      favImg.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'favicon-fallback';
        fallback.setAttribute('aria-hidden', 'true');
        favImg.replaceWith(fallback);
      });
    }

    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const res = await sendMessage({ type: 'DELETE_TAB', id: item.id });
      if (res.ok) onListChange();
    });

    const restore = async () => {
      const res = await sendMessage({ type: 'RESTORE_TAB', id: item.id });
      if (res.ok) {
        closePark();
      }
    };

    card.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      restore();
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        restore();
      }
    });

    return card;
  }

  async function renderList(gridEl, countEl) {
    const res = await sendMessage({ type: 'GET_PARKED_TABS' });
    const tabs = res.ok && Array.isArray(res.tabs) ? res.tabs : [];

    gridEl.innerHTML = '';
    if (tabs.length === 0) {
      countEl.textContent = '0 個暫存分頁';
      gridEl.innerHTML = `
        <div class="empty" style="grid-column: 1 / -1">
          <strong>尚無暫存分頁</strong>
          在網頁按下 <kbd>Option</kbd>/<kbd>Alt</kbd>+<kbd>S</kbd> 即可截圖並加入 TabWall。
        </div>
      `;
      return;
    }

    countEl.textContent = `${tabs.length} 個暫存分頁`;
    const frag = document.createDocumentFragment();
    const refresh = () => renderList(gridEl, countEl);
    tabs.forEach((item) => frag.appendChild(createCard(item, refresh)));
    gridEl.appendChild(frag);
  }

  async function openPark() {
    ensureRoot();
    isOpen = true;

    shadow.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'TabWall 照片牆');

    const panel = document.createElement('div');
    panel.className = 'panel';

    // header
    const header = document.createElement('header');
    header.innerHTML = `
      <div class="brand">
        <h1>TabWall</h1>
        <span class="count">—</span>
      </div>
      <div class="actions"></div>
    `;
    const countEl = header.querySelector('.count');
    const actions = header.querySelector('.actions');

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'btn';
    settingsBtn.textContent = '設定';
    settingsBtn.setAttribute('aria-expanded', 'false');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn';
    closeBtn.textContent = '關閉';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePark();
    });

    actions.append(settingsBtn, closeBtn);

    // settings
    const settings = document.createElement('section');
    settings.className = 'settings';
    settings.innerHTML = `
      <h2>儲存分頁後的行為</h2>
      <div class="setting-label">按下儲存快捷鍵（Option/Alt+S）後：</div>
      <div class="radios">
        <label><input type="radio" name="afterSave" value="close" /> 關閉該分頁</label>
        <label><input type="radio" name="afterSave" value="keep" /> 不額外執行動作（僅儲存）</label>
      </div>
    `;

    const current = await loadSettings();
    const checked = settings.querySelector(`input[value="${current.afterSave}"]`)
      || settings.querySelector('input[value="close"]');
    if (checked) checked.checked = true;

    settings.querySelectorAll('input[name="afterSave"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) await saveSettings({ afterSave: input.value });
      });
    });

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = settings.classList.toggle('open');
      settingsBtn.classList.toggle('active', open);
      settingsBtn.setAttribute('aria-expanded', String(open));
    });

    // body + grid
    const body = document.createElement('div');
    body.className = 'body';
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.setAttribute('role', 'list');
    body.appendChild(grid);

    panel.append(header, settings, body);
    backdrop.appendChild(panel);
    shadow.appendChild(backdrop);

    await renderList(grid, countEl);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePark();
    });

    panel.addEventListener('click', (e) => e.stopPropagation());

    escHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePark();
      }
    };
    document.addEventListener('keydown', escHandler, true);

    storageListener = (changes, area) => {
      if (area === 'local' && changes.parkedTabs && isOpen) {
        renderList(grid, countEl);
      }
    };
    chrome.storage.onChanged.addListener(storageListener);
  }

  async function togglePark() {
    if (isOpen) closePark();
    else await openPark();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TOGGLE_PARK') {
      togglePark()
        .then(() => sendResponse({ ok: true, open: isOpen }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message?.type === 'CLOSE_PARK') {
      closePark();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
