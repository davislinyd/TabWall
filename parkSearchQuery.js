/**
 * TabWall park search query — pure match / compile helpers.
 * Loaded by park.html before park.js. Call bind() so scope/regex/query
 * resolve from park page state without DOM coupling.
 */
(function (global) {
  'use strict';

  const MAX_SEARCH_REGEX_LENGTH = 512;

  /** @type {{ raw: string, re: RegExp|null, err: string|null }} */
  let compiledSearch = { raw: '', re: null, err: null };
  /** @type {{ raw: string, or: string[][] }} */
  let compiledTagQuery = { raw: '', or: [] };
  /** @type {Map<string, { hits: any[], metaHit: boolean }> | null} */
  let searchMatchCache = null;

  /** @type {{ getSearchScope: () => string, getSearchRegex: () => boolean, getQuery: () => string }} */
  let ctx = {
    getSearchScope: () => 'all',
    getSearchRegex: () => false,
    getQuery: () => '',
  };

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    ctx = {
      getSearchScope: typeof next.getSearchScope === 'function' ? next.getSearchScope : ctx.getSearchScope,
      getSearchRegex: typeof next.getSearchRegex === 'function' ? next.getSearchRegex : ctx.getSearchRegex,
      getQuery: typeof next.getQuery === 'function' ? next.getQuery : ctx.getQuery,
    };
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function parseRegexInput(raw) {
    const s = String(raw || '');
    // /pattern/flags form (flags: only gimsuyv)
    const m = /^\/((?:\\\/|[^/])+)\/([gimsuyv]*)$/.exec(s);
    if (m) {
      return { source: m[1], flags: m[2] || 'i' };
    }
    return { source: s, flags: 'i' };
  }

  function resetCompiledSearch() {
    compiledSearch = { raw: '', re: null, err: null };
    return compiledSearch;
  }

  function getCompiledSearch() {
    return compiledSearch;
  }

  function compileSearchQuery(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      compiledSearch = { raw: '', re: null, err: null };
      return compiledSearch;
    }
    if (!ctx.getSearchRegex()) {
      compiledSearch = { raw: trimmed, re: null, err: null };
      return compiledSearch;
    }
    if (trimmed.length > MAX_SEARCH_REGEX_LENGTH) {
      compiledSearch = { raw: trimmed, re: null, err: `pattern_too_long_${MAX_SEARCH_REGEX_LENGTH}` };
      return compiledSearch;
    }
    try {
      const { source, flags } = parseRegexInput(trimmed);
      // Drop sticky/global to avoid lastIndex side effects on repeated .test
      const safeFlags = flags.replace(/[gy]/g, '');
      const re = new RegExp(source, safeFlags || 'i');
      compiledSearch = { raw: trimmed, re, err: null };
    } catch (err) {
      compiledSearch = { raw: trimmed, re: null, err: String(err?.message || err) };
    }
    return compiledSearch;
  }

  function itemHaystack(item, scope = ctx.getSearchScope()) {
    if (scope === 'reminder') {
      if (!item?.reminder) return '';
      return [
        item.reminder.message || '',
        item.title || '',
        item.displayTitle || '',
        item.url || '',
      ].join(' ');
    }
    if (scope === 'domain') {
      // Hostname only: standalone tabs + group member tabs (not notes).
      if (item.kind === 'note') return '';
      if (item.kind === 'group') {
        return (item.tabs || []).map((m) => domainOf(m.url)).filter(Boolean).join(' ');
      }
      return domainOf(item.url);
    }
    if (scope === 'group') {
      // Only group cards; name + member tabs (title/url/domain)
      if (item.kind !== 'group') return '';
      const parts = [item.title || '', item.displayTitle || ''];
      for (const m of item.tabs || []) {
        parts.push(m.title || '', m.displayTitle || '', m.url || '', domainOf(m.url));
      }
      for (const note of item.notes || []) {
        parts.push(note.title || '', note.displayTitle || '', note.markdown || '', ...(note.tags || []));
      }
      return parts.join(' ');
    }
    if (scope === 'tag') {
      if (item.kind === 'group') {
        const parts = [...(Array.isArray(item.tags) ? item.tags : [])];
        for (const m of item.tabs || []) {
          if (Array.isArray(m.tags)) parts.push(...m.tags);
        }
        for (const note of item.notes || []) {
          if (Array.isArray(note.tags)) parts.push(...note.tags);
        }
        return parts.join(' ');
      }
      return (Array.isArray(item.tags) ? item.tags : []).join(' ');
    }
    if (scope === 'note') {
      if (item.kind === 'group') {
        const parts = [item.note || ''];
        for (const m of item.tabs || []) parts.push(m.note || '');
        for (const note of item.notes || []) parts.push(note.title || '', note.displayTitle || '', note.markdown || '');
        return parts.join(' ');
      }
      if (item.kind === 'note') return [item.title || '', item.displayTitle || '', item.markdown || ''].join(' ');
      return item.note || '';
    }
    if (item.kind === 'group') {
      const parts = [
        item.title || '',
        item.displayTitle || '',
        item.note || '',
        ...(Array.isArray(item.tags) ? item.tags : []),
      ];
      for (const m of item.tabs || []) {
        parts.push(
          m.title || '',
          m.displayTitle || '',
          m.url || '',
          domainOf(m.url),
          m.note || '',
          ...(Array.isArray(m.tags) ? m.tags : [])
        );
      }
      for (const note of item.notes || []) {
        parts.push(note.title || '', note.displayTitle || '', note.markdown || '', ...(Array.isArray(note.tags) ? note.tags : []));
        for (const attachment of note.attachments || []) parts.push(attachment.name || '', attachment.alt || '');
      }
      return parts.join(' ');
    }
    if (item.kind === 'note') {
      if (scope === 'tag') return (item.tags || []).join(' ');
      if (scope === 'note') return [item.title || '', item.displayTitle || '', item.markdown || ''].join(' ');
      return [
        item.title || '',
        item.displayTitle || '',
        item.markdown || '',
        ...(Array.isArray(item.tags) ? item.tags : []),
        ...(item.attachments || []).flatMap((attachment) => [attachment.name || '', attachment.alt || '']),
      ].join(' ');
    }
    return [
      item.title || '',
      item.displayTitle || '',
      item.url || '',
      domainOf(item.url),
      item.note || '',
      ...(Array.isArray(item.tags) ? item.tags : []),
    ].join(' ');
  }

  /** Tag-mode search is active only when scoped to 'tag' and regex mode is off
   * (regex's `|` would otherwise collide with the `||` operator). */
  function isTagExpressionMode() {
    return ctx.getSearchScope() === 'tag' && !ctx.getSearchRegex();
  }

  /**
   * Tag-mode query grammar — deliberately different from matchesPlainQuery:
   * only `&&`/`||` are operators, whitespace stays part of a tag name (tag
   * names may contain spaces, e.g. "個人 專案").
   * `query := orGroup ("||" orGroup)*`, `orGroup := token ("&&" token)*`.
   */
  function parseTagQuery(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { raw: trimmed, or: [] };
    const or = trimmed
      .split(/\s*\|\|\s*/)
      .map((group) =>
        group
          .split(/\s*&&\s*/)
          .map((token) => token.trim().toLowerCase())
          .filter(Boolean)
      )
      .filter((group) => group.length);
    return { raw: trimmed, or };
  }

  function compileTagQuery(raw) {
    if (compiledTagQuery.raw !== raw) compiledTagQuery = parseTagQuery(raw);
    return compiledTagQuery;
  }

  /** Case-insensitive substring match of each token against the item's tag names. */
  function tagsMatchQuery(tagNames, q) {
    const { or } = compileTagQuery(q);
    if (!or.length) return true;
    const lowered = (tagNames || []).map((name) => String(name || '').toLowerCase());
    return or.some((group) => group.every((token) => lowered.some((name) => name.includes(token))));
  }

  /** Array-returning mirror of itemHaystack's scope==='tag' branch. */
  function itemTagNames(item) {
    if (!item) return [];
    if (item.kind === 'group') {
      const names = [...(Array.isArray(item.tags) ? item.tags : [])];
      for (const m of item.tabs || []) {
        if (Array.isArray(m.tags)) names.push(...m.tags);
      }
      for (const note of item.notes || []) {
        if (Array.isArray(note.tags)) names.push(...note.tags);
      }
      return names;
    }
    return Array.isArray(item.tags) ? item.tags : [];
  }

  /** Array-returning mirror of memberHaystack's scope==='tag' branch. */
  function memberTagNames(member) {
    return Array.isArray(member?.tags) ? member.tags : [];
  }

  /** Array-returning mirror of groupMetaHaystack's scope==='tag' branch. */
  function groupMetaTagNames(group) {
    return [
      ...(Array.isArray(group?.tags) ? group.tags : []),
      ...(group?.notes || []).flatMap((note) => note.tags || []),
    ];
  }

  /**
   * Plain search: case-insensitive.
   * - `||`  OR between groups
   * - `&&` or whitespace  AND within a group
   * Examples: `grafana||zabbix`  |  `grafana zabbix`  |  `grafana&&zabbix`
   */
  function matchesPlainQuery(hay, q) {
    const hayLower = String(hay).toLowerCase();
    const raw = String(q || '').trim();
    if (!raw) return true;

    const orGroups = raw
      .split(/\s*\|\|\s*/)
      .map((g) => g.trim())
      .filter(Boolean);
    if (!orGroups.length) return true;

    return orGroups.some((group) => {
      const terms = group
        .split(/\s*&&\s*|\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (!terms.length) return true;
      return terms.every((term) => hayLower.includes(term));
    });
  }

  function textMatchesQuery(text, q) {
    if (!q) return true;
    if (ctx.getSearchRegex()) {
      const compiled =
        compiledSearch.raw === q ? compiledSearch : compileSearchQuery(q);
      if (!compiled.re) return false;
      compiled.re.lastIndex = 0;
      return compiled.re.test(String(text || ''));
    }
    return matchesPlainQuery(text, q);
  }

  function memberHaystack(member, scope = ctx.getSearchScope()) {
    if (!member) return '';
    if (scope === 'domain') {
      if (member.kind === 'note') return '';
      return domainOf(member.url);
    }
    if (scope === 'group') {
      if (member.kind === 'note') return [member.title || '', member.markdown || ''].join(' ');
      return [member.title || '', member.url || '', domainOf(member.url)].join(' ');
    }
    if (scope === 'tag') {
      return (Array.isArray(member.tags) ? member.tags : []).join(' ');
    }
    if (scope === 'note') {
      return member.kind === 'note' ? [member.title || '', member.markdown || ''].join(' ') : member.note || '';
    }
    return [
      member.title || '',
      member.url || '',
      domainOf(member.url),
      member.note || '',
      ...(Array.isArray(member.tags) ? member.tags : []),
      ...(member.kind === 'note' ? (member.attachments || []).flatMap((attachment) => [attachment.name || '', attachment.alt || '']) : []),
    ].join(' ');
  }

  function groupMetaHaystack(group, scope = ctx.getSearchScope()) {
    if (scope === 'domain') {
      // Group title is not a domain; hits come only from member tabs.
      return '';
    }
    if (scope === 'group') {
      return group.title || '';
    }
    if (scope === 'tag') {
      return [
        ...(Array.isArray(group.tags) ? group.tags : []),
        ...(group.notes || []).flatMap((note) => note.tags || []),
      ].join(' ');
    }
    if (scope === 'note') {
      return [group.note || '', ...(group.notes || []).flatMap((note) => [note.title || '', note.markdown || ''])].join(' ');
    }
    return [
      group.title || '',
      group.note || '',
      ...(Array.isArray(group.tags) ? group.tags : []),
      ...(group.notes || []).flatMap((note) => [note.title || '', note.markdown || '', ...(note.tags || [])]),
    ].join(' ');
  }

  function getMatchingMembers(group, q = ctx.getQuery()) {
    if (!q || !group || group.kind !== 'group') return [];
    const members = [...(group.tabs || []), ...(group.notes || [])];
    if (isTagExpressionMode()) return members.filter((m) => tagsMatchQuery(memberTagNames(m), q));
    return members.filter((m) => textMatchesQuery(memberHaystack(m), q));
  }

  function groupMetaMatches(group, q = ctx.getQuery()) {
    if (!q || !group || group.kind !== 'group') return false;
    if (isTagExpressionMode()) return tagsMatchQuery(groupMetaTagNames(group), q);
    return textMatchesQuery(groupMetaHaystack(group), q);
  }

  function beginSearchMatchCache() {
    searchMatchCache = new Map();
    return searchMatchCache;
  }

  function clearSearchMatchCache() {
    searchMatchCache = null;
  }

  function getGroupSearchMatch(group, q = ctx.getQuery()) {
    if (!group || group.kind !== 'group') return { hits: [], metaHit: false };
    if (searchMatchCache && searchMatchCache.has(group.id)) {
      return searchMatchCache.get(group.id);
    }
    const metaHit = !q ? false : groupMetaMatches(group, q);
    const hits = !q ? [] : getMatchingMembers(group, q);
    const result = { hits, metaHit };
    if (searchMatchCache) searchMatchCache.set(group.id, result);
    return result;
  }

  function matchesQuery(item, q) {
    const scope = ctx.getSearchScope();
    if (!q) {
      // Empty query: scoped modes still restrict card kinds
      if (scope === 'group') return item?.kind === 'group';
      if (scope === 'domain') return item?.kind === 'tab' || item?.kind === 'group' || item?.kind === 'live';
      if (scope === 'reminder') return Boolean(item?.reminder);
      return true;
    }
    if (scope === 'group') {
      if (item?.kind !== 'group') return false;
      const { hits, metaHit } = getGroupSearchMatch(item, q);
      return metaHit || hits.length > 0;
    }
    if (scope === 'domain') {
      if (item?.kind === 'note') return false;
      if (item?.kind === 'group') {
        const { hits, metaHit } = getGroupSearchMatch(item, q);
        return metaHit || hits.length > 0;
      }
    }
    if (isTagExpressionMode()) return tagsMatchQuery(itemTagNames(item), q);
    const hay = itemHaystack(item);
    return textMatchesQuery(hay, q);
  }

  global.TabWallSearchQuery = {
    MAX_SEARCH_REGEX_LENGTH,
    bind,
    domainOf,
    parseRegexInput,
    resetCompiledSearch,
    getCompiledSearch,
    compileSearchQuery,
    itemHaystack,
    isTagExpressionMode,
    parseTagQuery,
    compileTagQuery,
    tagsMatchQuery,
    itemTagNames,
    memberTagNames,
    groupMetaTagNames,
    matchesPlainQuery,
    textMatchesQuery,
    memberHaystack,
    groupMetaHaystack,
    getMatchingMembers,
    groupMetaMatches,
    beginSearchMatchCache,
    clearSearchMatchCache,
    getGroupSearchMatch,
    matchesQuery,
  };
})(typeof self !== 'undefined' ? self : globalThis);
