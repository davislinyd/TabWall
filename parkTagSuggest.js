/**
 * TabWall editor tag autocomplete.
 *
 * The controller is intentionally independent from the editor modules so the
 * same behavior can be shared by the pre-save, item/batch, and Canvas Note
 * tag fields without coupling their draft state together.
 */
(function (global) {
  'use strict';

  const MAX_SUGGESTIONS = 8;
  const VIEWPORT_GUTTER = 8;
  const DROPDOWN_GAP = 6;

  let ctx = {};
  let fields = [];
  let activeField = null;
  let catalogRows = null;
  let catalogRequest = null;
  let catalogRequestGeneration = -1;
  let catalogGeneration = 0;
  let syncGeneration = 0;
  let repositionFrame = 0;
  let listenersBound = false;

  function bind(next) {
    if (next && typeof next === 'object') ctx = Object.assign(ctx, next);
  }

  function currentLocale() {
    const configured = typeof ctx.getLocale === 'function' ? ctx.getLocale() : '';
    return configured || global.document?.documentElement?.lang || '';
  }

  function compareNames(a, b) {
    try {
      const locale = currentLocale();
      return locale ? a.localeCompare(b, locale) : a.localeCompare(b);
    } catch {
      return a.localeCompare(b);
    }
  }

  function normalizeRows(rows) {
    const byName = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = String(row?.name || '').trim();
      if (!name) continue;
      const countValue = Number(row?.count);
      const count = Number.isFinite(countValue) && countValue > 0 ? countValue : 0;
      const key = name.toLowerCase();
      const previous = byName.get(key);
      if (!previous || count > previous.count) byName.set(key, { name, count });
    }
    return [...byName.values()];
  }

  /**
   * Return editor suggestions for a non-empty query.
   * Exported separately so ranking/filtering can be tested without a DOM.
   */
  function filterTagSuggestions(rows, query, selectedTags = [], limit = MAX_SUGGESTIONS) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const wildcard = needle === '*';
    const selected = new Set(
      (Array.isArray(selectedTags) ? selectedTags : [])
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const max = Number.isFinite(Number(limit))
      ? Math.max(0, Number(limit))
      : MAX_SUGGESTIONS;
    const suggestions = normalizeRows(rows)
      .filter((row) => (wildcard || row.name.toLowerCase().includes(needle)) && !selected.has(row.name.toLowerCase()))
      .sort((a, b) => {
        if (!wildcard) {
          const aName = a.name.toLowerCase();
          const bName = b.name.toLowerCase();
          const aMatchRank = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
          const bMatchRank = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
          if (aMatchRank !== bMatchRank) return aMatchRank - bMatchRank;
        }
        return b.count - a.count || compareNames(a.name, b.name);
      });
    return wildcard ? suggestions : suggestions.slice(0, max);
  }

  function ensureCatalog() {
    if (Array.isArray(catalogRows)) return Promise.resolve(catalogRows);
    if (catalogRequest) {
      if (catalogRequestGeneration === catalogGeneration) return catalogRequest;
      return catalogRequest.then(() => ensureCatalog());
    }

    const requestGeneration = catalogGeneration;
    let request;
    try {
      request = Promise.resolve(
        typeof ctx.sendMessage === 'function'
          ? ctx.sendMessage({ type: 'GET_TAGS' })
          : null,
      );
    } catch {
      request = Promise.resolve(null);
    }
    const pending = request
      .then((response) => {
        const rows = response?.ok ? normalizeRows(response.tags) : [];
        if (requestGeneration === catalogGeneration) catalogRows = rows;
        return rows;
      })
      .catch(() => []);
    catalogRequest = pending;
    catalogRequestGeneration = requestGeneration;
    pending.then(
      () => {
        if (catalogRequest === pending) {
          catalogRequest = null;
          catalogRequestGeneration = -1;
        }
      },
      () => {
        if (catalogRequest === pending) {
          catalogRequest = null;
          catalogRequestGeneration = -1;
        }
      },
    );
    return pending;
  }

  function viewportSize() {
    return {
      width: Number(global.innerWidth) || 0,
      height: Number(global.innerHeight) || 0,
    };
  }

  function positionList(field) {
    if (!field?.list || field.list.hidden || !field.anchor) return;
    const rect = field.anchor.getBoundingClientRect?.();
    if (!rect) return;
    const viewport = viewportSize();
    const width = Math.min(
      Math.max(rect.width || 0, 180),
      Math.max(0, viewport.width - VIEWPORT_GUTTER * 2),
    );
    const measuredHeight = field.list.getBoundingClientRect?.().height || 0;
    const belowTop = (rect.bottom || 0) + DROPDOWN_GAP;
    const aboveTop = (rect.top || 0) - DROPDOWN_GAP - measuredHeight;
    const canPlaceAbove = aboveTop >= VIEWPORT_GUTTER;
    const fitsBelow = belowTop + measuredHeight <= viewport.height - VIEWPORT_GUTTER;
    const top = fitsBelow || !canPlaceAbove
      ? Math.max(VIEWPORT_GUTTER, Math.min(belowTop, viewport.height - measuredHeight - VIEWPORT_GUTTER))
      : aboveTop;
    const left = Math.max(
      VIEWPORT_GUTTER,
      Math.min(rect.left || 0, viewport.width - width - VIEWPORT_GUTTER),
    );
    field.list.style.left = `${Math.round(left)}px`;
    field.list.style.top = `${Math.round(top)}px`;
    field.list.style.width = `${Math.round(width)}px`;
  }

  function scheduleReposition() {
    if (!activeField || repositionFrame) return;
    const requestFrame = global.requestAnimationFrame || ((callback) => global.setTimeout(callback, 0));
    repositionFrame = requestFrame(() => {
      repositionFrame = 0;
      positionList(activeField);
    });
  }

  function hideField(field) {
    if (!field?.list || !field.input) return;
    field.list.hidden = true;
    field.list.replaceChildren();
    field.suggestions = [];
    field.options = [];
    field.activeIndex = -1;
    field.input.setAttribute('aria-expanded', 'false');
    field.input.removeAttribute('aria-activedescendant');
  }

  function closeAll() {
    syncGeneration += 1;
    for (const field of fields) hideField(field);
    activeField = null;
  }

  function setActiveOption(field, index) {
    const options = Array.isArray(field?.options) ? field.options : [];
    const nextIndex = Number.isInteger(index) && index >= 0 && index < options.length ? index : -1;
    field.activeIndex = nextIndex;
    options.forEach((option, optionIndex) => {
      option.setAttribute('aria-selected', optionIndex === nextIndex ? 'true' : 'false');
    });
    if (nextIndex === -1) {
      field.input.removeAttribute('aria-activedescendant');
      return;
    }
    field.input.setAttribute('aria-activedescendant', options[nextIndex].id);
    options[nextIndex].scrollIntoView?.({ block: 'nearest' });
  }

  function moveActiveOption(field, direction) {
    if (activeField !== field || field.list.hidden) return false;
    const options = Array.isArray(field.options) ? field.options : [];
    if (!options.length) return false;
    const current = Number.isInteger(field.activeIndex) && field.activeIndex >= 0 && field.activeIndex < options.length
      ? field.activeIndex
      : -1;
    const nextIndex = direction > 0
      ? (current + 1) % options.length
      : (current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length);
    setActiveOption(field, nextIndex);
    return true;
  }

  function chooseSuggestion(field, index) {
    if (activeField !== field) return false;
    const row = Array.isArray(field.suggestions) ? field.suggestions[index] : null;
    if (!row) return false;
    field.input.value = row.name;
    field.commit?.();
    closeAll();
    field.input.focus();
    return true;
  }

  function renderSuggestions(field, rows) {
    const list = field.list;
    list.replaceChildren();
    field.suggestions = rows;
    field.options = [];
    field.activeIndex = -1;
    rows.forEach((row, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'tag-suggest-row';
      option.id = `${list.id || field.input.id || 'tag-suggest'}-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.tag = row.name;
      option.textContent = row.name;
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => chooseSuggestion(field, index));
      field.options.push(option);
      list.appendChild(option);
    });
    list.hidden = rows.length === 0;
    field.input.setAttribute('aria-expanded', rows.length ? 'true' : 'false');
    if (rows.length) positionList(field);
  }

  function sync(field) {
    if (!field?.input || !field.list) return;
    if (activeField && activeField !== field) hideField(activeField);
    activeField = field;
    const prefix = String(field.input.value || '').trim();
    if (!prefix) {
      closeAll();
      return;
    }
    hideField(field);
    const token = ++syncGeneration;
    const requestGeneration = catalogGeneration;
    ensureCatalog().then((rows) => {
      if (token !== syncGeneration || activeField !== field) return;
      if (requestGeneration !== catalogGeneration) {
        sync(field);
        return;
      }
      const selected = typeof field.getSelected === 'function' ? field.getSelected() : [];
      renderSuggestions(field, filterTagSuggestions(rows, prefix, selected));
    });
  }

  function handleFieldKeydown(field, event) {
    if (event.key === 'Escape' && activeField === field) {
      event.preventDefault();
      event.stopPropagation();
      closeAll();
      return;
    }
    if (event.key === 'ArrowDown' && moveActiveOption(field, 1)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowUp' && moveActiveOption(field, -1)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.key === 'Enter'
      && activeField === field
      && !field.list.hidden
      && field.activeIndex >= 0
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseSuggestion(field, field.activeIndex);
      return;
    }
    // Existing editor handlers commit Enter/Tab by changing input.value
    // programmatically. Close the old result after those handlers run.
    if ((event.key === 'Enter' || event.key === 'Tab') && field.input.value.trim()) {
      global.setTimeout(() => {
        if (!field.input.value.trim()) closeAll();
      }, 0);
    }
  }

  function handleDocumentPointerdown(event) {
    if (!activeField) return;
    if (activeField.anchor?.contains?.(event.target) || activeField.list?.contains?.(event.target)) return;
    closeAll();
  }

  function init(nextFields = []) {
    if (listenersBound) return;
    fields = (Array.isArray(nextFields) ? nextFields : []).filter(
      (field) => field?.input && field?.list,
    );
    for (const field of fields) {
      field.anchor ||= field.input.closest?.('.tag-input') || field.input.parentElement;
      if (field.list.parentNode !== document.body) document.body.appendChild(field.list);
      field.list.hidden = true;
      field.suggestions = [];
      field.options = [];
      field.activeIndex = -1;
      field.list.setAttribute('role', 'listbox');
      field.input.setAttribute('aria-autocomplete', 'list');
      field.input.setAttribute('aria-controls', field.list.id);
      field.input.setAttribute('aria-expanded', 'false');
      field.input.addEventListener('input', () => sync(field));
      field.input.addEventListener('focus', () => sync(field));
      field.input.addEventListener('keydown', (event) => handleFieldKeydown(field, event));
    }
    document.addEventListener('pointerdown', handleDocumentPointerdown, true);
    document.addEventListener('scroll', scheduleReposition, true);
    global.addEventListener?.('resize', scheduleReposition);
    listenersBound = true;
  }

  function invalidate() {
    catalogGeneration += 1;
    catalogRows = null;
    if (activeField) sync(activeField);
  }

  global.TabWallTagSuggest = {
    MAX_SUGGESTIONS,
    bind,
    init,
    closeAll,
    invalidate,
    filterTagSuggestions,
  };
})(typeof self !== 'undefined' ? self : globalThis);
