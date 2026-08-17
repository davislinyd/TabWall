/**
 * TabWall quick search — Option/Alt+/ palette on any page.
 * Content script + park.html. Does not open the full wall.
 */
(function (global) {
  'use strict';

  const MAX_RESULTS = 12;
  const HOST_ID = 'tabwall-quick-search-host';
  const SCOPE_TOKENS = {
    tag: 'tag',
    t: 'tag',
    group: 'group',
    g: 'group',
    note: 'note',
    n: 'note',
    nn: 'reminder',
    noti: 'reminder',
    domain: 'domain',
    d: 'domain',
    all: 'all',
    a: 'all',
  };

  function resolveScopeToken(raw) {
    return SCOPE_TOKENS[String(raw || '').trim().toLowerCase()] || '';
  }

  function normalizeScope(scope) {
    if (scope === 'tag' || scope === 'group' || scope === 'note' || scope === 'reminder' || scope === 'domain' || scope === 'all') {
      return scope;
    }
    return resolveScopeToken(scope) || 'all';
  }

  function itemMatchesScope(item, scope) {
    if (!item) return false;
    const next = normalizeScope(scope);
    if (next === 'group') return item.kind === 'group';
    if (next === 'note') return item.kind === 'note';
    if (next === 'reminder') return Boolean(item.reminder);
    if (next === 'domain') return item.kind === 'tab' || item.kind === 'group';
    return true;
  }

  function haystackScope(scope) {
    const next = normalizeScope(scope);
    if (next === 'domain' || next === 'note' || next === 'reminder' || next === 'group') return next;
    return 'all';
  }

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

  function rankItems(items, query, searchQuery, scope) {
    const SQ = searchQuery || global.TabWallSearchQuery;
    const activeScope = normalizeScope(scope);
    const list = (Array.isArray(items) ? items : []).filter((item) => itemMatchesScope(item, activeScope));
    const q = String(query || '').trim();
    if (!q) {
      return list
        .slice()
        .sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0))
        .slice(0, MAX_RESULTS);
    }
    if (activeScope === 'tag') {
      if (SQ && typeof SQ.itemTagNames === 'function' && typeof SQ.tagsMatchQuery === 'function') {
        return list.filter((item) => SQ.tagsMatchQuery(SQ.itemTagNames(item), q)).slice(0, MAX_RESULTS);
      }
      const lower = q.toLowerCase();
      return list
        .filter((item) => (item.tags || []).some((tag) => String(tag).toLowerCase().includes(lower)))
        .slice(0, MAX_RESULTS);
    }
    if (!SQ || typeof SQ.itemHaystack !== 'function' || typeof SQ.matchesPlainQuery !== 'function') {
      const lower = q.toLowerCase();
      return list
        .filter((item) => {
          const hay = [item.title, item.displayTitle, item.url, item.note, item.markdown, item.reminder?.message, ...(item.tags || [])].join(' ').toLowerCase();
          return hay.includes(lower);
        })
        .slice(0, MAX_RESULTS);
    }
    const hayScope = haystackScope(activeScope);
    return list
      .filter((item) => SQ.matchesPlainQuery(SQ.itemHaystack(item, hayScope), q))
      .slice(0, MAX_RESULTS);
  }

  function previewMember(item) {
    if (!item || item.kind !== 'group') return null;
    const members = Array.isArray(item.tabs) ? item.tabs : [];
    return members.find((member) => member.hasSnap) || members.find((member) => member.hasThumb) || members[0] || null;
  }

  function mediaKeyForPreview(item) {
    if (!item || item.kind === 'note') return '';
    if (item.kind === 'group') {
      const member = previewMember(item);
      return item.id && member?.id ? `g:${item.id}:${member.id}` : '';
    }
    return item.id ? `t:${item.id}` : '';
  }

  function previewMediaKind(item) {
    if (!item || item.locked) return '';
    if (item.kind === 'group') {
      const member = previewMember(item);
      if (!member) return '';
      if (member.hasSnap) return 'snap';
      if (member.hasThumb) return 'thumb';
      return '';
    }
    if (item.hasSnap) return 'snap';
    if (item.hasThumb) return 'thumb';
    return '';
  }

  function previewFields(item) {
    if (!item) {
      return {
        title: '',
        url: '',
        note: '',
        tags: [],
        savedAt: 0,
        kind: '',
        mediaKey: '',
        mediaKind: '',
        members: [],
      };
    }
    return {
      title: (item.displayTitle && String(item.displayTitle).trim()) || item.title || item.url || '',
      url: item.kind === 'group' || item.kind === 'note' ? '' : item.url || '',
      note: item.kind === 'note' ? item.markdown || item.note || '' : item.note || '',
      tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
      savedAt: Number(item.savedAt) || 0,
      kind: item.kind || '',
      mediaKey: mediaKeyForPreview(item),
      mediaKind: previewMediaKind(item),
      members: item.kind === 'group'
        ? (item.tabs || []).map((member) => ({
            id: member.id || '',
            title: (member.displayTitle && String(member.displayTitle).trim()) || member.title || member.url || '',
            url: member.url || '',
          }))
        : [],
    };
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
      placeholder: '搜尋…  tag / group / note / nn / noti / domain + Tab',
      empty: '沒有符合的結果',
      label: 'TabWall 搜尋',
      group: '群組',
      note: '便利貼',
      reminder: '提醒',
      tag: 'tag',
      domain: '網域',
      noSnap: '無快照',
      restoreHint: 'Enter 或雙擊還原並保留卡片',
      noteHint: '便利貼無法還原分頁',
      phTag: '搜尋 tag…  && 且、|| 或',
      phGroup: '搜尋群組名稱或成員…',
      phNote: '搜尋便利貼…',
      phReminder: '搜尋提醒文字或卡片…',
      phDomain: '搜尋網域…',
    },
    en: {
      placeholder: 'Search…  tag / group / note / nn / noti / domain + Tab',
      empty: 'No matching results',
      label: 'TabWall search',
      group: 'Group',
      note: 'Note',
      reminder: 'Reminder',
      tag: 'tag',
      domain: 'Domain',
      noSnap: 'No snapshot',
      restoreHint: 'Enter or double-click to restore and keep the card',
      noteHint: 'Notes cannot restore a tab',
      phTag: 'Search tags…  && AND, || OR',
      phGroup: 'Search group name or members…',
      phNote: 'Search notes…',
      phReminder: 'Search reminder text or cards…',
      phDomain: 'Search domains…',
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
    let detailEl = null;
    let items = [];
    let results = [];
    let selected = 0;
    let scope = 'all';
    let loadGen = 0;
    let previewGen = 0;
    let chipEl = null;

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
      detailEl = null;
      chipEl = null;
      items = [];
      results = [];
      selected = 0;
      scope = 'all';
      previewGen += 1;
    }

    function placeholderForScope() {
      const text = copy();
      if (scope === 'tag') return text.phTag;
      if (scope === 'group') return text.phGroup;
      if (scope === 'note') return text.phNote;
      if (scope === 'reminder') return text.phReminder;
      if (scope === 'domain') return text.phDomain;
      return text.placeholder;
    }

    function syncScopeChip() {
      if (!chipEl || !inputEl) return;
      const scoped = scope !== 'all';
      chipEl.hidden = !scoped;
      chipEl.textContent = scoped ? scope : '';
      inputEl.placeholder = placeholderForScope();
      inputEl.style.paddingLeft = scoped ? '72px' : '';
    }

    function setScope(next) {
      scope = normalizeScope(next);
      syncScopeChip();
      applyQuery(inputEl ? inputEl.value : '');
    }

    function rowLabel(item) {
      if (scope === 'reminder') return item.reminder?.message || copy().reminder;
      if (item.kind === 'group') {
        const n = (item.tabs || []).length;
        return n ? `${copy().group} · ${n}` : copy().group;
      }
      if (item.kind === 'note') return copy().note;
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
          const icon = item.kind === 'group' || item.kind === 'note'
            ? '<span class="fav fav-empty"></span>'
            : item.favIconUrl
              ? `<img class="fav" src="${escapeHtml(item.favIconUrl)}" alt="" width="16" height="16">`
              : '<span class="fav fav-empty"></span>';
          return `<button type="button" class="row" data-index="${index}" aria-selected="${index === selected ? 'true' : 'false'}">${icon}<span class="meta"><span class="title">${escapeHtml((item.displayTitle && String(item.displayTitle).trim()) || item.title || item.url || '')}</span><span class="sub">${escapeHtml(rowLabel(item))}</span></span></button>`;
        })
        .join('');
      listEl.querySelectorAll('img.fav').forEach((img) => {
        img.addEventListener('error', () => {
          img.replaceWith(Object.assign(global.document.createElement('span'), { className: 'fav fav-empty' }));
        });
      });
    }

    function renderDetail() {
      if (!detailEl) return;
      const text = copy();
      const item = results[selected];
      if (!item) {
        previewGen += 1;
        detailEl.innerHTML = `<div class="empty">${escapeHtml(text.empty)}</div>`;
        return;
      }
      const fields = previewFields(item);
      const tags = fields.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
      const members = fields.members
        .slice(0, 8)
        .map((member) => `<div class="member">${escapeHtml(member.title)}</div>`)
        .join('');
      const when = fields.savedAt ? new Date(fields.savedAt).toLocaleString() : '';
      const snapInner = fields.mediaKind
        ? '<img class="snap-img" alt="">'
        : `<div class="snap-empty">${escapeHtml(text.noSnap)}</div>`;
      detailEl.innerHTML = `
        <div class="snap">${snapInner}</div>
        <div class="detail-body">
          <div class="detail-title">${escapeHtml(fields.title)}</div>
          ${fields.url ? `<div class="detail-url">${escapeHtml(fields.url)}</div>` : ''}
          ${when ? `<div class="detail-time">${escapeHtml(when)}</div>` : ''}
          ${fields.note ? `<div class="detail-note">${escapeHtml(fields.note)}</div>` : ''}
          ${tags ? `<div class="tags">${tags}</div>` : ''}
          ${members ? `<div class="members">${members}</div>` : ''}
          <div class="hint">${escapeHtml(item.kind === 'note' ? text.noteHint : text.restoreHint)}</div>
        </div>
      `;
      const img = detailEl.querySelector('.snap-img');
      if (!img || !fields.mediaKey || !fields.mediaKind) return;
      const gen = ++previewGen;
      sendMessage({ type: 'GET_MEDIA', key: fields.mediaKey, kind: fields.mediaKind }).then((res) => {
        if (gen !== previewGen || !isOpen() || !img.isConnected) return;
        if (res.ok && res.dataUrl) {
          img.src = res.dataUrl;
          return;
        }
        img.replaceWith(Object.assign(global.document.createElement('div'), {
          className: 'snap-empty',
          textContent: text.noSnap,
        }));
      });
    }

    function renderAll() {
      renderList();
      renderDetail();
    }

    function applyQuery(raw) {
      results = rankItems(items, raw, global.TabWallSearchQuery, scope);
      selected = 0;
      renderAll();
    }

    function selectIndex(index) {
      if (!results.length) return;
      selected = Math.max(0, Math.min(results.length - 1, index));
      renderAll();
      const row = listEl?.querySelector(`.row[data-index="${selected}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    }

    function moveSelection(delta) {
      if (!results.length) return;
      selectIndex((selected + delta + results.length) % results.length);
    }

    async function restoreSelected() {
      const item = results[selected];
      if (!item?.id || item.kind === 'note' || item.cardSource === 'image') return;
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
          padding: 10vh 12px 24px;
          background: rgba(16, 17, 16, 0.42);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans TC', 'Helvetica Neue', Arial, sans-serif;
        }
        .panel {
          width: min(920px, calc(100vw - 24px));
          max-height: min(72vh, 640px);
          display: flex;
          flex-direction: column;
          background: #f6f1e6;
          color: #2e2b27;
          border: 1px solid rgba(46, 43, 39, 0.2);
          border-radius: 3px;
          box-shadow: 0 18px 40px rgba(16, 17, 16, 0.28);
          overflow: hidden;
        }
        .search-bar { position: relative; }
        .scope-chip {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          border: 0;
          border-radius: 2px;
          padding: 2px 7px;
          background: rgba(198, 111, 89, 0.18);
          color: #2e2b27;
          font: inherit;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
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
        .body {
          display: grid;
          grid-template-columns: minmax(220px, 2fr) minmax(280px, 3fr);
          min-height: 0;
          flex: 1;
        }
        .list {
          min-height: 260px;
          max-height: min(56vh, 520px);
          overflow: auto;
          border-right: 1px solid rgba(46, 43, 39, 0.12);
        }
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
        .row:hover { background: rgba(198, 111, 89, 0.08); }
        .row[aria-selected="true"] { background: rgba(198, 111, 89, 0.16); }
        .fav { width: 16px; height: 16px; flex-shrink: 0; object-fit: contain; }
        .fav-empty { border-radius: 2px; background: rgba(46, 43, 39, 0.12); }
        .meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sub { font-size: 11px; color: #777067; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .empty { padding: 18px 16px; font-size: 13px; color: #777067; }
        .detail { min-width: 0; max-height: min(56vh, 520px); overflow: auto; }
        .snap {
          aspect-ratio: 16 / 10;
          background: rgba(46, 43, 39, 0.06);
          overflow: hidden;
        }
        .snap-img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .snap-empty {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: #777067;
        }
        .detail-body { padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 8px; }
        .detail-title { font-size: 15px; font-weight: 700; line-height: 1.35; }
        .detail-url, .detail-time, .hint { font-size: 11px; color: #777067; word-break: break-all; }
        .detail-note { font-size: 13px; line-height: 1.45; white-space: pre-wrap; }
        .tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .tag {
          padding: 2px 7px;
          border-radius: 2px;
          background: rgba(198, 111, 89, 0.14);
          font-size: 11px;
        }
        .members { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #4a4641; }
      `;

      const backdrop = global.document.createElement('div');
      backdrop.className = 'backdrop';
      backdrop.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(text.label)}"><div class="search-bar"><button type="button" class="scope-chip" hidden></button><input class="input" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(text.placeholder)}"></div><div class="body"><div class="list" role="listbox"></div><aside class="detail"></aside></div></div>`;
      shadow.append(style, backdrop);
      global.document.documentElement.appendChild(hostEl);

      inputEl = shadow.querySelector('.input');
      listEl = shadow.querySelector('.list');
      detailEl = shadow.querySelector('.detail');
      chipEl = shadow.querySelector('.scope-chip');
      const panel = shadow.querySelector('.panel');
      scope = 'all';
      syncScopeChip();

      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) close();
      });
      chipEl.addEventListener('click', () => {
        setScope('all');
        inputEl.focus();
      });
      panel.addEventListener('click', (event) => {
        const row = event.target.closest?.('.row');
        if (!row) return;
        selectIndex(Number(row.dataset.index) || 0);
      });
      panel.addEventListener('dblclick', (event) => {
        const row = event.target.closest?.('.row');
        if (!row) return;
        selected = Number(row.dataset.index) || 0;
        event.preventDefault();
        restoreSelected();
      });
      inputEl.addEventListener('input', () => applyQuery(inputEl.value));
      inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
          const token = resolveScopeToken(inputEl.value);
          if (token) {
            event.preventDefault();
            inputEl.value = '';
            setScope(token);
            return;
          }
        }
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
    resolveScopeToken,
    normalizeScope,
    itemMatchesScope,
    mediaKeyForPreview,
    previewFields,
  };

  if (global.document) installUi();
})(typeof window !== 'undefined' ? window : self);
