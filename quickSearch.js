/**
 * TabWall quick search — Option/Alt+/ palette on any page.
 * Content script + park.html. Does not open the full wall.
 */
(function (global) {
  'use strict';

  const MAX_RESULTS = 12;
  const HOST_ID = 'tabwall-quick-search-host';

  function isQuickSearchHotkey(event) {
    return Boolean(
      event &&
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      event.code === 'Slash'
    );
  }

  function restorableItems(items) {
    return (Array.isArray(items) ? items : []).filter((item) => item && item.kind !== 'note');
  }

  function rankItems(items, query, searchQuery) {
    const SQ = searchQuery || global.TabWallSearchQuery;
    const list = restorableItems(items);
    const q = String(query || '').trim();
    if (!q) {
      return list
        .slice()
        .sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0))
        .slice(0, MAX_RESULTS);
    }
    if (!SQ || typeof SQ.itemHaystack !== 'function' || typeof SQ.matchesPlainQuery !== 'function') {
      const lower = q.toLowerCase();
      return list
        .filter((item) => {
          const hay = [item.title, item.url, item.note, ...(item.tags || [])].join(' ').toLowerCase();
          return hay.includes(lower);
        })
        .slice(0, MAX_RESULTS);
    }
    return list.filter((item) => SQ.matchesPlainQuery(SQ.itemHaystack(item, 'all'), q)).slice(0, MAX_RESULTS);
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const COPY = {
    zh: {
      placeholder: '搜尋已存分頁…',
      empty: '沒有符合的結果',
      label: 'TabWall 搜尋',
      group: '群組',
    },
    en: {
      placeholder: 'Search parked tabs…',
      empty: 'No matching results',
      label: 'TabWall search',
      group: 'Group',
    },
  };

  function copy() {
    const lang = String(global.document?.documentElement?.lang || global.navigator?.language || 'zh');
    return lang.toLowerCase().startsWith('en') ? COPY.en : COPY.zh;
  }

  function sendMessage(payload) {
    return new Promise((resolve) => {
      try {
        if (!global.chrome?.runtime?.sendMessage) {
          resolve({ ok: false, error: 'no_runtime' });
          return;
        }
        global.chrome.runtime.sendMessage(payload, (response) => {
          if (global.chrome.runtime.lastError) {
            resolve({ ok: false, error: global.chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'empty_response' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function installUi() {
    if (!global.document || global.__tabWallQuickSearchInstalled) return;
    global.__tabWallQuickSearchInstalled = true;

    let hostEl = null;
    let shadow = null;
    let inputEl = null;
    let listEl = null;
    let items = [];
    let results = [];
    let selected = 0;
    let loadGen = 0;

    function isOpen() {
      return Boolean(hostEl && hostEl.isConnected);
    }

    function close() {
      if (!hostEl) return;
      hostEl.remove();
      hostEl = null;
      shadow = null;
      inputEl = null;
      listEl = null;
      items = [];
      results = [];
      selected = 0;
    }

    function rowLabel(item) {
      if (item.kind === 'group') {
        const n = (item.tabs || []).length;
        return n ? `${copy().group} · ${n}` : copy().group;
      }
      return domainOf(item.url) || item.url || '';
    }

    function renderList() {
      if (!listEl) return;
      const text = copy();
      if (!results.length) {
        listEl.innerHTML = `<div class="empty">${escapeHtml(text.empty)}</div>`;
        return;
      }
      listEl.innerHTML = results
        .map((item, index) => {
          const icon = item.kind === 'group'
            ? '<span class="fav fav-empty"></span>'
            : item.favIconUrl
              ? `<img class="fav" src="${escapeHtml(item.favIconUrl)}" alt="" width="16" height="16">`
              : '<span class="fav fav-empty"></span>';
          return `<button type="button" class="row" data-index="${index}" aria-selected="${index === selected ? 'true' : 'false'}">${icon}<span class="meta"><span class="title">${escapeHtml(item.title || item.url || '')}</span><span class="sub">${escapeHtml(rowLabel(item))}</span></span></button>`;
        })
        .join('');
      listEl.querySelectorAll('img.fav').forEach((img) => {
        img.addEventListener('error', () => {
          img.replaceWith(Object.assign(global.document.createElement('span'), { className: 'fav fav-empty' }));
        });
      });
    }

    function applyQuery(raw) {
      results = rankItems(items, raw, global.TabWallSearchQuery);
      selected = 0;
      renderList();
    }

    function moveSelection(delta) {
      if (!results.length) return;
      selected = (selected + delta + results.length) % results.length;
      renderList();
      const row = listEl?.querySelector(`.row[data-index="${selected}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    }

    async function restoreSelected() {
      const item = results[selected];
      if (!item?.id) return;
      close();
      const type = item.kind === 'group' ? 'RESTORE_GROUP' : 'RESTORE_TAB';
      await sendMessage({ type, id: item.id });
    }

    async function open() {
      if (isOpen()) {
        inputEl?.focus();
        inputEl?.select();
        return;
      }

      const text = copy();
      hostEl = global.document.createElement('div');
      hostEl.id = HOST_ID;
      hostEl.setAttribute('data-tabwall-quick-search', '1');
      shadow = hostEl.attachShadow({ mode: 'open' });
      const style = global.document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 16vh 12px 24px;
          background: rgba(16, 17, 16, 0.42);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans TC', 'Helvetica Neue', Arial, sans-serif;
        }
        .panel {
          width: min(560px, 100%);
          background: #f6f1e6;
          color: #2e2b27;
          border: 1px solid rgba(46, 43, 39, 0.2);
          border-radius: 3px;
          box-shadow: 0 18px 40px rgba(16, 17, 16, 0.28);
          overflow: hidden;
        }
        .input {
          width: 100%;
          border: 0;
          border-bottom: 1px solid rgba(46, 43, 39, 0.14);
          padding: 14px 16px;
          font: inherit;
          font-size: 16px;
          outline: none;
          background: transparent;
          color: inherit;
        }
        .list { max-height: min(48vh, 380px); overflow: auto; }
        .row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 9px 14px;
          border: 0;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .row[aria-selected="true"], .row:hover { background: rgba(198, 111, 89, 0.14); }
        .fav { width: 16px; height: 16px; flex-shrink: 0; object-fit: contain; }
        .fav-empty { border-radius: 2px; background: rgba(46, 43, 39, 0.12); }
        .meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sub { font-size: 11px; color: #777067; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .empty { padding: 18px 16px; font-size: 13px; color: #777067; }
      `;

      const backdrop = global.document.createElement('div');
      backdrop.className = 'backdrop';
      backdrop.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(text.label)}"><input class="input" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(text.placeholder)}"><div class="list" role="listbox"></div></div>`;
      shadow.append(style, backdrop);
      global.document.documentElement.appendChild(hostEl);

      inputEl = shadow.querySelector('.input');
      listEl = shadow.querySelector('.list');
      const panel = shadow.querySelector('.panel');

      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) close();
      });
      panel.addEventListener('mousedown', (event) => {
        const row = event.target.closest?.('.row');
        if (!row) return;
        selected = Number(row.dataset.index) || 0;
        event.preventDefault();
        restoreSelected();
      });
      inputEl.addEventListener('input', () => applyQuery(inputEl.value));
      inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(-1);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          restoreSelected();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      });

      applyQuery('');
      inputEl.focus();

      const gen = ++loadGen;
      const res = await sendMessage({ type: 'GET_PARKED_ITEMS' });
      if (gen !== loadGen || !isOpen()) return;
      items = res.ok && Array.isArray(res.items) ? res.items : [];
      applyQuery(inputEl.value);
    }

    function onKeydown(event) {
      if (!isQuickSearchHotkey(event)) {
        if (isOpen() && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (isOpen()) close();
      else open();
    }

    global.document.addEventListener('keydown', onKeydown, true);
  }

  global.TabWallQuickSearch = {
    MAX_RESULTS,
    isQuickSearchHotkey,
    rankItems,
    restorableItems,
  };

  if (global.document) installUi();
})(typeof window !== 'undefined' ? window : self);
