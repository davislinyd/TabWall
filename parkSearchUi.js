/**
 * TabWall park search UI — tag suggest, scope chip, regex toggle, input debounce.
 * Loaded by park.html after parkSearchQuery.js, before park.js.
 * Call bind() then init() so DOM/state resolve from the park page without
 * embedding page globals in this file.
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let ctx = {};

  let tagSuggestOpen = false;
  /** @type {Array<{ name: string, count: number }>} */
  let tagSuggestRows = [];
  let tagSuggestActive = -1;
  /** @type {Map<string, { name: string, count: number }>|null} */
  let tagSuggestIndex = null;
  let tagSuggestIndexDirty = true;
  const TAG_SUGGEST_LIMIT = 12;

  let searchRenderTimer = null;
  const SEARCH_RENDER_DEBOUNCE_MS = 120;
  let listenersBound = false;

  const SEARCH_TAB_TOKENS = {
    t: 'tag',
    tag: 'tag',
    n: 'note',
    note: 'note',
    g: 'group',
    group: 'group',
    d: 'domain',
    domain: 'domain',
    re: 'regex',
    regex: 'regex',
    a: 'all',
    all: 'all',
  };

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    ctx = Object.assign(ctx, next);
  }

  function markTagSuggestIndexDirty() {
    tagSuggestIndexDirty = true;
  }

  function searchEl() {
    return typeof ctx.getSearchEl === 'function' ? ctx.getSearchEl() : null;
  }
  function searchRegexBtn() {
    return typeof ctx.getSearchRegexBtn === 'function' ? ctx.getSearchRegexBtn() : null;
  }
  function searchWrap() {
    return typeof ctx.getSearchWrap === 'function' ? ctx.getSearchWrap() : null;
  }
  function searchScopeChip() {
    return typeof ctx.getSearchScopeChip === 'function' ? ctx.getSearchScopeChip() : null;
  }
  function searchTagSuggest() {
    return typeof ctx.getSearchTagSuggest === 'function' ? ctx.getSearchTagSuggest() : null;
  }
  function getQuery() {
    return typeof ctx.getQuery === 'function' ? ctx.getQuery() : '';
  }
  function setQuery(q) {
    if (typeof ctx.setQuery === 'function') ctx.setQuery(q);
  }
  function getSearchScope() {
    return typeof ctx.getSearchScope === 'function' ? ctx.getSearchScope() : 'all';
  }
  function setSearchScope(s) {
    if (typeof ctx.setSearchScope === 'function') ctx.setSearchScope(s);
  }
  function getSearchRegex() {
    return typeof ctx.getSearchRegex === 'function' ? Boolean(ctx.getSearchRegex()) : false;
  }
  function getAllTabs() {
    return typeof ctx.getAllTabs === 'function' ? ctx.getAllTabs() : [];
  }
  function t(key, vars) {
    return typeof ctx.t === 'function' ? ctx.t(key, vars) : key;
  }
  function itemTagNames(item) {
    return typeof ctx.itemTagNames === 'function' ? ctx.itemTagNames(item) : [];
  }
  function isTagExpressionMode() {
    return typeof ctx.isTagExpressionMode === 'function' ? ctx.isTagExpressionMode() : false;
  }
  function compileSearchQuery(raw) {
    return typeof ctx.compileSearchQuery === 'function' ? ctx.compileSearchQuery(raw) : { raw: '', re: null, err: null };
  }
  function resetCompiledSearch() {
    if (typeof ctx.resetCompiledSearch === 'function') ctx.resetCompiledSearch();
  }
  function renderGrid() {
    if (typeof ctx.renderGrid === 'function') ctx.renderGrid();
  }
  function saveSettings(partial) {
    return typeof ctx.saveSettings === 'function' ? ctx.saveSettings(partial) : Promise.resolve();
  }

  function searchPlaceholderText() {
    const re = getSearchRegex();
    const scope = getSearchScope();
    if (scope === 'tag') return re ? t('searchPhTagRegex') : t('searchPhTag');
    if (scope === 'note') return re ? t('searchPhNoteRegex') : t('searchPhNote');
    if (scope === 'group') return re ? t('searchPhGroupRegex') : t('searchPhGroup');
    if (scope === 'domain') return re ? t('searchPhDomainRegex') : t('searchPhDomain');
    return re ? t('searchRegexPh') : t('searchPh');
  }

  function syncSearchScopeUi() {
    const scope = getSearchScope();
    const scoped = scope === 'tag' || scope === 'note' || scope === 'group' || scope === 'domain';
    const wrap = searchWrap();
    const chip = searchScopeChip();
    const input = searchEl();
    if (wrap) wrap.classList.toggle('has-scope', scoped);
    if (chip) {
      if (scoped) {
        chip.hidden = false;
        chip.textContent = scope;
        chip.title = t('searchScopeClear');
        chip.setAttribute('aria-label', t('searchScopeClear'));
      } else {
        chip.hidden = true;
        chip.textContent = '';
      }
    }
    if (input) {
      input.placeholder = searchPlaceholderText();
      // "group" chip is wider than "tag"/"note" — pad input so caret is not covered
      if (scoped && chip) {
        requestAnimationFrame(() => {
          const el = searchEl();
          const c = searchScopeChip();
          if (!el || !c || c.hidden) return;
          const w = c.offsetWidth || 0;
          el.style.paddingLeft = `${Math.max(52, w + 16)}px`;
        });
      } else {
        input.style.paddingLeft = '';
      }
    }
    syncTagSuggest();
  }

  // ─── Tag-mode search suggestion dropdown ──────────────────────────

  /** Flat list of every token already in the query (any operator), lowercased. */
  function allTagQueryTokens(raw) {
    return String(raw || '')
      .split(/\s*(?:\|\||&&)\s*/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }

  /** Splits the raw query into alternating {type:'token'|'op', value} entries, preserving exact text. */
  function tokenizeTagQuery(raw) {
    const value = String(raw || '');
    const result = [];
    let lastIndex = 0;
    const opRe = /\s*(\|\||&&)\s*/g;
    let match;
    while ((match = opRe.exec(value))) {
      result.push({ type: 'token', value: value.slice(lastIndex, match.index) });
      result.push({ type: 'op', value: match[1] });
      lastIndex = opRe.lastIndex;
    }
    result.push({ type: 'token', value: value.slice(lastIndex) });
    return result;
  }

  /** Token containing the caret in #search, as exact character offsets for splicing. */
  function currentTagToken() {
    const input = searchEl();
    const value = input ? input.value : '';
    const caret = input ? (input.selectionStart ?? value.length) : value.length;
    const bounds = [0];
    const opRe = /\|\||&&/g;
    let match;
    while ((match = opRe.exec(value))) {
      bounds.push(match.index, match.index + match[0].length);
    }
    bounds.push(value.length);
    for (let i = 0; i < bounds.length; i += 2) {
      const start = bounds[i];
      const end = bounds[i + 1];
      if (caret >= start && caret <= end) return { start, end, text: value.slice(start, end) };
    }
    return { start: value.length, end: value.length, text: '' };
  }

  function buildTagSuggestIndex() {
    const index = new Map();
    for (const item of getAllTabs()) {
      for (const name of itemTagNames(item)) {
        const key = String(name || '').trim();
        if (!key) continue;
        const lower = key.toLowerCase();
        const entry = index.get(lower);
        if (entry) entry.count += 1;
        else index.set(lower, { name: key, count: 1 });
      }
    }
    tagSuggestIndex = index;
    tagSuggestIndexDirty = false;
    return index;
  }

  function ensureTagSuggestIndex() {
    if (tagSuggestIndexDirty || !tagSuggestIndex) return buildTagSuggestIndex();
    return tagSuggestIndex;
  }

  /** Filters+ranks tags for the dropdown: exact > prefix > higher count > locale order. */
  function computeTagSuggestions(prefix) {
    const index = ensureTagSuggestIndex();
    const needle = String(prefix || '').trim().toLowerCase();
    const all = [...index.values()];
    const filtered = needle ? all.filter((tag) => tag.name.toLowerCase().includes(needle)) : all;
    filtered.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (needle) {
        const aExact = aName === needle;
        const bExact = bName === needle;
        if (aExact !== bExact) return aExact ? -1 : 1;
        const aPrefix = aName.startsWith(needle);
        const bPrefix = bName.startsWith(needle);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      }
      if (a.count !== b.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
    return filtered.slice(0, TAG_SUGGEST_LIMIT);
  }

  function renderTagSuggest() {
    const list = searchTagSuggest();
    const input = searchEl();
    if (!list || !input) return;
    list.innerHTML = '';
    const selected = new Set(allTagQueryTokens(input.value));
    if (!tagSuggestRows.length) {
      const empty = document.createElement('div');
      empty.className = 'search-suggest-empty';
      empty.textContent = t('searchTagSuggestEmpty');
      list.appendChild(empty);
    } else {
      tagSuggestRows.forEach((row, i) => {
        const isSelected = selected.has(row.name.toLowerCase());
        const rowEl = document.createElement('div');
        rowEl.className = `search-suggest-row${i === tagSuggestActive ? ' active' : ''}${isSelected ? ' is-selected' : ''}`;
        rowEl.id = `searchTagSuggestRow-${i}`;
        rowEl.setAttribute('role', 'option');
        rowEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        rowEl.title = isSelected ? t('searchTagSuggestRemove') : row.name;

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = row.name;
        rowEl.appendChild(name);

        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(row.count);
        rowEl.appendChild(count);

        const orBtn = document.createElement('button');
        orBtn.type = 'button';
        orBtn.className = 'search-suggest-or';
        orBtn.textContent = '||';
        orBtn.title = t('searchTagSuggestOr');
        orBtn.addEventListener('pointerdown', (e) => e.preventDefault());
        orBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          acceptTagSuggestion(row.name, '||');
        });
        rowEl.appendChild(orBtn);

        rowEl.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in #search
        rowEl.addEventListener('click', () => {
          if (isSelected) removeTagToken(row.name);
          else acceptTagSuggestion(row.name, '&&');
        });
        list.appendChild(rowEl);
      });
    }
    const hint = document.createElement('div');
    hint.className = 'search-suggest-hint';
    hint.textContent = t('searchTagSuggestHint');
    list.appendChild(hint);

    if (tagSuggestActive >= 0) input.setAttribute('aria-activedescendant', `searchTagSuggestRow-${tagSuggestActive}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function openTagSuggest() {
    const list = searchTagSuggest();
    const input = searchEl();
    if (!list || !input || tagSuggestOpen) return;
    tagSuggestOpen = true;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeTagSuggest() {
    const list = searchTagSuggest();
    const input = searchEl();
    if (!list || !input || !tagSuggestOpen) return;
    tagSuggestOpen = false;
    tagSuggestActive = -1;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  /** Single entry point: recomputes suggestions from the caret token and opens/closes as needed. */
  function syncTagSuggest() {
    const list = searchTagSuggest();
    const input = searchEl();
    if (!list || !input) return;
    if (!isTagExpressionMode() || document.activeElement !== input) {
      closeTagSuggest();
      return;
    }
    const { text } = currentTagToken();
    tagSuggestRows = computeTagSuggestions(text);
    tagSuggestActive = -1;
    renderTagSuggest();
    openTagSuggest();
  }

  function moveTagSuggestActive(delta) {
    if (!tagSuggestRows.length) return;
    const list = searchTagSuggest();
    const n = tagSuggestRows.length;
    tagSuggestActive = ((tagSuggestActive + delta) % n + n) % n;
    renderTagSuggest();
    list?.querySelector(`#searchTagSuggestRow-${tagSuggestActive}`)?.scrollIntoView({ block: 'nearest' });
  }

  /** Replaces the caret token with `name` and (when it's the trailing token) appends the operator. */
  function acceptTagSuggestion(name, operator = '&&') {
    const input = searchEl();
    if (!input) return;
    const { start, end } = currentTagToken();
    const value = input.value;
    const before = value.slice(0, start);
    const after = value.slice(end);
    let nextValue;
    let caret;
    if (!after.trim()) {
      nextValue = `${before}${name} ${operator} `;
      caret = nextValue.length;
    } else {
      nextValue = `${before}${name}${after}`;
      caret = before.length + name.length;
    }
    input.value = nextValue;
    input.setSelectionRange(caret, caret);
    setSearchQueryFromInput({ immediate: true });
    syncTagSuggest();
    input.focus();
  }

  /** Removes an already-selected tag token (and one adjacent operator) from the query. */
  function removeTagToken(name) {
    const input = searchEl();
    if (!input) return;
    const lower = String(name || '').trim().toLowerCase();
    const tokens = tokenizeTagQuery(input.value);
    const idx = tokens.findIndex((entry) => entry.type === 'token' && entry.value.trim().toLowerCase() === lower);
    if (idx === -1) return;
    tokens.splice(idx, 1);
    if (idx > 0 && tokens[idx - 1]?.type === 'op') tokens.splice(idx - 1, 1);
    else if (tokens[idx]?.type === 'op') tokens.splice(idx, 1);
    input.value = tokens.map((entry) => entry.value).join('').trim();
    input.setSelectionRange(input.value.length, input.value.length);
    setSearchQueryFromInput({ immediate: true });
    syncTagSuggest();
    input.focus();
  }

  function syncSearchRegexUi() {
    const on = getSearchRegex();
    const btn = searchRegexBtn();
    const input = searchEl();
    if (btn) {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = t('searchRegexTitle');
    }
    if (input) {
      input.placeholder = searchPlaceholderText();
      if (!on) {
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
        input.removeAttribute('title');
      } else {
        applySearchCompileState();
      }
    }
    syncSearchScopeUi();
  }

  function clearSearchInputKeepFocus() {
    const input = searchEl();
    if (!input) return;
    input.value = '';
    setQuery('');
    resetCompiledSearch();
    input.classList.remove('invalid');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('title');
    input.focus();
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
    }
    syncTagSuggest();
  }

  /** Empty query matches everything — no need to rebuild the canvas. */
  function refilterSearchIfNeeded() {
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
    }
    // scope change (e.g. group) must refilter even with empty query
    renderGrid();
  }

  async function applySearchTabToken(token) {
    if (token === 'tag' || token === 'note' || token === 'group' || token === 'domain' || token === 'all') {
      setSearchScope(token === 'all' ? 'all' : token);
      clearSearchInputKeepFocus();
      syncSearchScopeUi();
      refilterSearchIfNeeded();
      return;
    }
    if (token === 'regex') {
      if (!getSearchRegex()) {
        await saveSettings({ searchRegex: true });
      }
      clearSearchInputKeepFocus();
      syncSearchRegexUi();
      refilterSearchIfNeeded();
    }
  }

  /** Initial search mode: scope=all, regex off. Returns true if anything changed. */
  async function resetSearchModesToDefault() {
    let changed = false;
    if (getSearchScope() !== 'all') {
      setSearchScope('all');
      changed = true;
    }
    if (getSearchRegex()) {
      await saveSettings({ searchRegex: false });
      changed = true;
    }
    if (changed) {
      syncSearchRegexUi();
      refilterSearchIfNeeded();
    }
    return changed;
  }

  function isSearchInCustomMode() {
    return getSearchScope() !== 'all' || getSearchRegex();
  }

  function applySearchCompileState() {
    const input = searchEl();
    if (!input) return;
    const q = getQuery();
    if (!getSearchRegex() || !q) {
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
      if (getSearchRegex()) input.removeAttribute('title');
      return;
    }
    const { err } = compileSearchQuery(q);
    if (err) {
      input.classList.add('invalid');
      input.setAttribute('aria-invalid', 'true');
      input.title = err;
    } else {
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
      input.removeAttribute('title');
    }
  }

  function setSearchQueryFromInput({ immediate = false } = {}) {
    const input = searchEl();
    if (!input) return;
    // Keep original case for regex; plain mode lowercases inside matchesQuery
    const next = input.value.trim();
    setQuery(next);
    compileSearchQuery(next);
    applySearchCompileState();
    if (immediate) {
      if (searchRenderTimer) {
        clearTimeout(searchRenderTimer);
        searchRenderTimer = null;
      }
      renderGrid();
      return;
    }
    if (searchRenderTimer) clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(() => {
      searchRenderTimer = null;
      renderGrid();
    }, SEARCH_RENDER_DEBOUNCE_MS);
  }

  function init() {
    if (listenersBound) return;
    listenersBound = true;

    const input = searchEl();
    if (input) {
      input.addEventListener('input', () => {
        setSearchQueryFromInput({ immediate: false });
        syncTagSuggest();
      });
      input.addEventListener('focus', () => syncTagSuggest());
      input.addEventListener('click', () => syncTagSuggest());
      input.addEventListener('keydown', (e) => {
        if (tagSuggestOpen) {
          if (e.isComposing || e.keyCode === 229) return; // IME candidate window open — don't intercept
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            moveTagSuggestActive(e.key === 'ArrowDown' ? 1 : -1);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeTagSuggest();
            return;
          }
          if (
            tagSuggestActive >= 0 &&
            tagSuggestRows[tagSuggestActive] &&
            (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey))
          ) {
            e.preventDefault();
            e.stopPropagation();
            acceptTagSuggestion(tagSuggestRows[tagSuggestActive].name, e.altKey ? '||' : '&&');
            return;
          }
        }

        // Empty field + Backspace/Delete → leave tag/note/regex back to default
        if (
          (e.key === 'Backspace' || e.key === 'Delete') &&
          input.value === '' &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey
        ) {
          if (!isSearchInCustomMode()) return;
          e.preventDefault();
          e.stopPropagation();
          resetSearchModesToDefault();
          return;
        }

        if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
        const token = input.value.trim().toLowerCase();
        const mode = SEARCH_TAB_TOKENS[token];
        if (!mode) return;
        e.preventDefault();
        e.stopPropagation();
        applySearchTabToken(mode);
      });
    }

    document.addEventListener('pointerdown', (e) => {
      if (tagSuggestOpen && !e.target.closest?.('#searchWrap')) closeTagSuggest();
    });

    const chip = searchScopeChip();
    if (chip) {
      chip.addEventListener('click', () => {
        applySearchTabToken('all');
      });
    }

    const regexBtn = searchRegexBtn();
    if (regexBtn) {
      regexBtn.addEventListener('click', async () => {
        await saveSettings({ searchRegex: !getSearchRegex() });
        syncSearchRegexUi();
        compileSearchQuery(getQuery());
        applySearchCompileState();
        refilterSearchIfNeeded();
      });
    }
  }

  global.TabWallSearchUi = {
    bind,
    init,
    markTagSuggestIndexDirty,
    searchPlaceholderText,
    syncSearchScopeUi,
    syncSearchRegexUi,
    clearSearchInputKeepFocus,
    refilterSearchIfNeeded,
    applySearchTabToken,
    resetSearchModesToDefault,
    isSearchInCustomMode,
    applySearchCompileState,
    setSearchQueryFromInput,
    syncTagSuggest,
    closeTagSuggest,
    SEARCH_TAB_TOKENS,
  };
})(typeof self !== 'undefined' ? self : globalThis);
