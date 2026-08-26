(function (global) {
  'use strict';
  let env = null;
  function bind(next) { if (next && typeof next === 'object') env = next; }
  function ensureBound(n) { if (!env) throw new Error('TabWallListUi.' + n + ' used before bind()'); }

  /* free-var shims: incomplete env rewrites still call bare park helpers */
  function t(...args) { return env.t(...args); }
  function escapeHtml(...args) { return env.escapeHtml(...args); }
  function escapeAttr(...args) { return env.escapeAttr(...args); }
  function mediaKeyForMember(...args) { return env.mediaKeyForMember(...args); }
  function mediaKeyForItem(...args) { return env.mediaKeyForItem(...args); }
  function syncCanvasSearchViewport(searchContext) { return env.syncCanvasSearchViewport?.(searchContext); }


  function createGroupCard(item) {
    ensureBound('createGroupCard');

      const card = document.createElement('article');
      card.className = 'card group-card';
      card.draggable = false;
      card.dataset.id = item.id;
      card.dataset.kind = 'group';
      card.setAttribute('role', 'listitem');

      const title = itemTitle(item);
      const n = (item.tabs || []).length + (item.notes || []).length;
      const storedOnlyCount = env.countStoredOnlyUrls(item);
      const color = env.GROUP_COLORS[item.color] || env.GROUP_COLORS.grey;
      card.style.setProperty('--group-color', color);
      const note = item.note || '';
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const savedAt = formatSavedAt(item.savedAt);

      const selected = env.selectedIds.has(item.id);
      if (selected) card.classList.add('selected');

      card.innerHTML = `
        <input type="checkbox" class="card-check" ${selected ? 'checked' : ''} aria-label="select" />
        <div class="group-color-bar" style="background:${color}"></div>
        <div class="thumb-wrap">
          ${groupCoverHtml(item)}
          <div class="card-actions">
            <button type="button" class="icon-btn lg edit-btn" title="${escapeAttr(t('edit'))}">${iconSvg('edit')}<span>${escapeHtml(t('edit'))}</span></button>
            <button type="button" class="icon-btn lg members-btn" title="${escapeAttr(t('expandGroup'))}">${iconSvg('members')}<span>${escapeHtml(t('expandGroup'))}</span></button>
            <button type="button" class="icon-btn lg reminder-btn ${item.reminder ? 'active' : ''}" title="${escapeAttr(t('reminderAction'))}">${iconSvg('reminder')}<span>${escapeHtml(t('reminderAction'))}</span></button>
          </div>
          <button type="button" class="pin-btn lock-btn ${item.locked ? 'active' : ''}" aria-pressed="${item.locked ? 'true' : 'false'}" title="${escapeAttr(t(item.locked ? 'unlockAction' : 'lockAction'))}" aria-label="${escapeAttr(t(item.locked ? 'unlockAction' : 'lockAction'))}">${iconSvg(item.locked ? 'unlock' : 'lock')}</button>
          <button type="button" class="pin-btn ${item.pinned ? 'active' : ''}" aria-pressed="${item.pinned ? 'true' : 'false'}" title="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}" aria-label="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}">${iconSvg('pin')}</button>
          <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
          <span class="group-badge">${escapeHtml(t('groupTabs', { n }))}</span>
        </div>
        <div class="meta copy-hit" title="${escapeAttr(t('copyLink'))}">
          <div class="title-row">
            <span class="color-dot" style="background:${color}"></span>
            <div class="title" title="${escapeAttr(title)}">
              ${escapeHtml(title)}
              ${item.reminder ? `<span class="reminder-badge" title="${escapeAttr(t('reminderActive'))}">${iconSvg('reminder')}</span>` : ''}
              ${storedOnlyCount ? `<span class="stored-only-badge">${env.escapeHtml(env.t('storedOnlyShort'))} ×${storedOnlyCount}</span>` : ''}
            </div>
          </div>
          ${originalTitleHtml(item)}
          <div class="url">${escapeHtml(t('groupTabs', { n }))}</div>
          <div class="saved-at">${escapeHtml(t('savedAt', { time: savedAt }))}</div>
          ${note ? `<div class="note-preview">${env.escapeHtml(note)}</div>` : ''}
          ${
            tags.length
              ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
              : ''
          }
        </div>
      `;

      card.querySelectorAll('img.lazy-thumb').forEach((img) => env.observeThumb(img));
      wireMediaLockOverlay(card, item);
      appendGroupSearchHits(card, item);

      card.querySelector('.card-check').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!env.selectMode) env.setSelectMode(true);
        env.handleCardSelectClick(item.id, e);
      });

      bindMetaCopy(card.querySelector('.meta'), item);

      card.querySelector('.lock-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        env.toggleCardLock?.(item);
      });
      card.querySelector('.pin-btn:not(.lock-btn)').addEventListener('click', (e) => {
        e.stopPropagation();
        env.togglePinned(item);
      });
      card.querySelector('.thumb-wrap').addEventListener('click', (e) => {
        if (e.target.closest('.card-actions, .delete-btn, .members-btn, .reminder-btn, .pin-btn, .lock-btn, .card-check, .media-lock-overlay')) return;
        if (env.dragState?.active) return;
        if (env.selectMode || env.isMultiSelectModifier(e)) {
          env.handleCardSelectClick(item.id, e);
        }
        // pure thumb click restore is handled by endCardDrag
      });

      card.querySelector('.members-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        env.openMembersBox(item);
      });

      card.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        env.openEditBox(item);
      });
      card.querySelector('.reminder-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        env.openReminderEditor(item);
      });
      card.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        env.deleteItem(item.id);
      });
      attachCardDrag(card, item);
      return card;

  }

  function createLiveCard(item) {
    ensureBound('createLiveCard');
    const card = document.createElement('article');
    card.className = 'card live-card';
    card.dataset.id = item.id;
    card.dataset.kind = 'live';
    card.setAttribute('role', 'listitem');
    const title = item.title || item.url || 'Untitled';
    const url = item.url || '';
    const note = item.note || '';
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (env.selectedIds.has(item.id)) card.classList.add('selected');
    card.innerHTML = `
      <input type="checkbox" class="card-check" ${env.selectedIds.has(item.id) ? 'checked' : ''} aria-label="select" />
      <div class="thumb-wrap">
        <div class="live-cover">${iconSvg('edit')}<span>${escapeHtml(t('liveBadge'))}</span></div>
        <div class="card-actions">
          <button type="button" class="icon-btn lg edit-btn" title="${escapeAttr(t('edit'))}" aria-label="${escapeAttr(t('edit'))}">${iconSvg('edit')}<span>${escapeHtml(t('edit'))}</span></button>
          <button type="button" class="icon-btn lg park-btn" title="${escapeAttr(t('livePark'))}" aria-label="${escapeAttr(t('livePark'))}">${iconSvg('restore')}<span>${escapeHtml(t('livePark'))}</span></button>
        </div>
        <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
      </div>
      <div class="meta copy-hit" title="${escapeAttr(t('copyLink'))}">
        <div class="title-row">
          ${item.favIconUrl ? `<img class="favicon" alt="" draggable="false" src="${escapeAttr(item.favIconUrl)}" />` : `<span class="favicon-fallback" aria-hidden="true"></span>`}
          <div class="title" title="${escapeAttr(title)}">${escapeHtml(title)} <span class="live-badge">${escapeHtml(t('liveBadge'))}</span></div>
        </div>
        <div class="url" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
        ${note ? `<div class="note-preview" title="${escapeAttr(note)}">${env.escapeHtml(note)}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>` : ''}
      </div>
    `;
    card.querySelector('.card-check').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!env.selectMode) env.setSelectMode(true);
      env.handleCardSelectClick(item.id, e);
    });
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      env.openEditBox(item);
    });
    card.querySelector('.park-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await env.sendMessage({ type: 'PARK_PAGE_ANNOTATION', url: item.url });
      if (res?.ok) await env.loadList();
      else env.showCopyToast(env.t('liveParkFailed'));
    });
    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      env.deleteItem(item.id);
    });
    bindMetaCopy(card.querySelector('.meta'), item);
    card.querySelector('.thumb-wrap').addEventListener('click', (e) => {
      if (e.target.closest('.card-actions, .delete-btn, .edit-btn, .park-btn, .card-check')) return;
      if (env.selectMode) env.handleCardSelectClick(item.id, e);
      else env.restoreItem(item.id);
    });
    return card;
  }

  function createCard(item) {
    ensureBound('createCard');

      if (item.kind === 'group') return createGroupCard(item);
      if (item.kind === 'note') return createRow(item);
      if (item.kind === 'live') return createLiveCard(item);

      const card = document.createElement('article');
      const isImage = env.isImageCard?.(item) || item.cardSource === 'image';
      card.className = isImage ? 'card image-card' : 'card';
      card.draggable = false;
      card.dataset.id = item.id;
      card.dataset.kind = item.kind;
      if (isImage) card.dataset.cardSource = 'image';
      card.setAttribute('role', 'listitem');

      const title = item.title || item.url || (isImage ? env.t('imageCardUntitled') : 'Untitled');
      const url = isImage ? env.t('imageKind') : item.url || '';
      const mediaKey = env.mediaKeyForItem(item);
      const fav = item.favIconUrl || '';
      const storedOnly = env.isStoredOnlyUrl(url);
      const note = item.note || '';
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const savedAt = formatSavedAt(item.savedAt);

      if (env.selectedIds.has(item.id)) card.classList.add('selected');

      card.innerHTML = `
        <input type="checkbox" class="card-check" ${selectedIds.has(item.id) ? 'checked' : ''} aria-label="select" />
        <div class="thumb-wrap">
          ${
            env.isMediaLocked?.(item)
              ? mediaLockOverlayHtml(item)
              : `<img class="thumb lazy-thumb" alt="" draggable="false" decoding="async" data-media-key="${escapeAttr(mediaKey)}" />`
          }
          <div class="card-actions">
            <button type="button" class="icon-btn lg edit-btn" title="${escapeAttr(t('edit'))}" aria-label="${escapeAttr(t('edit'))}">${iconSvg('edit')}<span>${escapeHtml(t('edit'))}</span></button>
            <button type="button" class="icon-btn lg expand-btn" title="${escapeAttr(t('expand'))}" aria-label="${escapeAttr(t('expand'))}">${iconSvg('expand')}<span>${escapeHtml(t('expand'))}</span></button>
            <button type="button" class="icon-btn lg reminder-btn ${item.reminder ? 'active' : ''}" title="${escapeAttr(t('reminderAction'))}" aria-label="${escapeAttr(t('reminderAction'))}">${iconSvg('reminder')}<span>${escapeHtml(t('reminderAction'))}</span></button>
          </div>
          <button type="button" class="pin-btn lock-btn ${item.locked ? 'active' : ''}" aria-pressed="${item.locked ? 'true' : 'false'}" title="${escapeAttr(t(item.locked ? 'unlockAction' : 'lockAction'))}" aria-label="${escapeAttr(t(item.locked ? 'unlockAction' : 'lockAction'))}">${iconSvg(item.locked ? 'unlock' : 'lock')}</button>
          <button type="button" class="pin-btn ${item.pinned ? 'active' : ''}" aria-pressed="${item.pinned ? 'true' : 'false'}" title="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}" aria-label="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}">${iconSvg('pin')}</button>
          <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
        </div>
        <div class="meta copy-hit" title="${escapeAttr(t('copyLink'))}">
          <div class="title-row">
            ${
              fav
                ? `<img class="favicon" alt="" draggable="false" src="${escapeAttr(fav)}" />`
                : `<span class="favicon-fallback" aria-hidden="true"></span>`
            }
            <div class="title" title="${escapeAttr(title)}">
              ${escapeHtml(title)}
              ${item.reminder ? `<span class="reminder-badge" title="${escapeAttr(t('reminderActive'))}">${iconSvg('reminder')}</span>` : ''}
              ${storedOnly ? `<span class="stored-only-badge">${env.escapeHtml(env.t('storedOnlyShort'))}</span>` : ''}
            </div>
          </div>
          ${originalTitleHtml(item)}
          <div class="url" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
          <div class="saved-at">${escapeHtml(t('savedAt', { time: savedAt }))}</div>
          ${note ? `<div class="note-preview" title="${escapeAttr(note)}">${env.escapeHtml(note)}</div>` : ''}
          ${
            tags.length
              ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
              : ''
          }
        </div>
      `;

      wireFavicon(card);
      env.observeThumb(card.querySelector('img.lazy-thumb'));
      wireMediaLockOverlay(card, item);
      card.querySelector('.card-check').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!env.selectMode) env.setSelectMode(true);
        env.handleCardSelectClick(item.id, e);
      });
      card.querySelector('.expand-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.openLightbox(item);
      });
      card.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.openEditBox(item);
      });
      card.querySelector('.reminder-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.openReminderEditor(item);
      });
      card.querySelector('.lock-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.toggleCardLock?.(item);
      });
      card.querySelector('.pin-btn:not(.lock-btn)').addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.togglePinned(item);
      });
      card.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.deleteItem(item.id);
      });
      if (!isImage) bindMetaCopy(card.querySelector('.meta'), item);
      card.querySelector('.thumb-wrap').addEventListener('click', (e) => {
        if (e.target.closest('.card-actions, .delete-btn, .expand-btn, .edit-btn, .reminder-btn, .pin-btn, .lock-btn, .card-check, .media-lock-overlay')) return;
        if (env.dragState?.active) return;
        if (env.selectMode || env.isMultiSelectModifier(e)) {
          env.handleCardSelectClick(item.id, e);
        }
        // pure thumb click restore is handled by endCardDrag
      });
      attachCardDrag(card, item);
      return card;

  }

  function createRow(item) {
    ensureBound('createRow');

      const row = document.createElement('article');
      row.className = `row${item.kind === 'group' ? ' group-row' : ''}${item.kind === 'note' ? ' note-row' : ''}${item.kind === 'live' ? ' live-row' : ''}`;
      row.dataset.id = item.id;
      row.setAttribute('role', 'listitem');

      const isGroup = item.kind === 'group';
      const isNote = item.kind === 'note';
      const isLive = item.kind === 'live';
      const isImage = env.isImageCard?.(item) || item.cardSource === 'image';
      const title = itemTitle(item);
      const url = isGroup
        ? env.t('groupTabs', { n: (item.tabs || []).length + (item.notes || []).length })
        : isNote ? env.t('noteKind') : isLive ? env.t('liveBadge') : isImage ? env.t('imageKind') : item.url || '';
      const mediaKey = isGroup
        ? (() => {
            const m = (item.tabs || []).find((x) => x.hasThumb || x.id) || (item.tabs || [])[0];
            return m ? env.mediaKeyForMember(item.id, m.id) : '';
          })()
        : isNote || isLive ? '' : env.mediaKeyForItem(item);
      const note = isNote
        ? item.contentMode === 'web'
          ? (typeof item.webSource === 'string' && item.webSource.trim() ? item.webSource : env.t('noteWebEmpty'))
          : (item.markdown || '')
        : item.note || '';
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const color = isGroup ? env.GROUP_COLORS[item.color] || env.GROUP_COLORS.grey : null;
      const storedOnlyCount = env.countStoredOnlyUrls(item);

      row.innerHTML = `
        ${
          isNote
            ? `<button type="button" class="row-thumb note-row-thumb" title="${escapeAttr(t('edit'))}" aria-label="${escapeAttr(t('edit'))}">${iconSvg('note')}</button>`
            : isLive
            ? `<button type="button" class="row-thumb live-row-thumb" title="${escapeAttr(t('liveOpen'))}" aria-label="${escapeAttr(t('liveOpen'))}">${iconSvg('edit')}</button>`
            : env.isMediaLocked?.(item)
              ? mediaLockOverlayHtml(item, 'row-thumb')
              : `<img class="row-thumb lazy-thumb" alt="" draggable="false" decoding="async" data-media-key="${escapeAttr(mediaKey)}" title="${escapeAttr(t('restore'))}" />`
        }
        <div class="row-main">
          <div class="title copy-hit" title="${escapeAttr(title)}">
            ${color ? `<span class="color-dot" style="background:${color};display:inline-block;margin-right:6px;vertical-align:middle"></span>` : ''}
            ${escapeHtml(title)}
            ${isLive ? `<span class="live-badge">${escapeHtml(t('liveBadge'))}</span>` : ''}
            ${item.reminder ? `<span class="reminder-badge" title="${escapeAttr(t('reminderActive'))}">${iconSvg('reminder')}</span>` : ''}
            ${storedOnlyCount ? `<span class="stored-only-badge">${env.escapeHtml(env.t('storedOnlyShort'))}${storedOnlyCount > 1 ? ` ×${storedOnlyCount}` : ''}</span>` : ''}
          </div>
          ${originalTitleHtml(item)}
          <div class="url copy-hit" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
          <div class="saved-at">${escapeHtml(t('savedAt', { time: formatSavedAt(item.savedAt) }))}</div>
        </div>
        <div class="row-note" title="${escapeAttr(note)}">${note ? escapeHtml(note) : '—'}</div>
        <div class="row-tags">
          ${
            tags.length
              ? tags.map((tg) => `<span class="tag">${env.escapeHtml(tg)}</span>`).join('')
              : '<span class="note-preview">—</span>'
          }
        </div>
        <div class="row-actions">
          ${isLive ? '' : `<button type="button" class="pin-btn lock-btn ${item.locked ? 'active' : ''}" aria-pressed="${item.locked ? 'true' : 'false'}" title="${escapeAttr(t(item.locked ? 'unlockAction' : 'lockAction'))}" aria-label="${escapeAttr(t(item.locked ? 'unlockAction' : 'lockAction'))}">${iconSvg(item.locked ? 'unlock' : 'lock')}</button>
          <button type="button" class="pin-btn ${item.pinned ? 'active' : ''}" aria-pressed="${item.pinned ? 'true' : 'false'}" title="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}" aria-label="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}">${iconSvg('pin')}</button>`}
          <button type="button" class="icon-btn edit-btn" title="${escapeAttr(t('edit'))}" aria-label="${escapeAttr(t('edit'))}">${iconSvg('edit')}</button>
          ${isLive ? `<button type="button" class="icon-btn park-btn" title="${escapeAttr(t('livePark'))}" aria-label="${escapeAttr(t('livePark'))}">${iconSvg('restore')}</button>` : `<button type="button" class="icon-btn reminder-btn ${item.reminder ? 'active' : ''}" title="${escapeAttr(t('reminderAction'))}" aria-label="${escapeAttr(t('reminderAction'))}">${iconSvg('reminder')}</button>`}
          ${
            isGroup || isNote || isLive
              ? ''
              : `<button type="button" class="icon-btn expand-btn" title="${escapeAttr(t('expand'))}" aria-label="${escapeAttr(t('expand'))}">${iconSvg('expand')}</button>`
          }
          <button type="button" class="icon-btn danger delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
        </div>
      `;

      env.observeThumb(row.querySelector('img.lazy-thumb'));
      wireMediaLockOverlay(row, item);
      if (isGroup) appendGroupSearchHits(row, item);
      row.querySelector('.row-thumb')?.addEventListener('click', (e) => {
        if (e.currentTarget.classList.contains('media-lock-overlay')) return;
        if (env.selectMode || env.isMultiSelectModifier(e)) {
          env.handleCardSelectClick(item.id, e);
          return;
        }
        if (isNote) env.openStickerNoteEditor(item);
        else if (isImage) env.openLightbox(item);
        else env.restoreItem(item.id);
      });
      row.querySelectorAll('.copy-hit').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.search-hits')) return;
          if (env.selectMode || env.isMultiSelectModifier(e)) {
            env.handleCardSelectClick(item.id, e);
            return;
          }
          if (!isNote && !isImage) env.copySavedLink(item);
        });
      });
      if (env.selectedIds.has(item.id)) row.classList.add('selected');
      const expandBtn = row.querySelector('.expand-btn');
      if (expandBtn) {
        expandBtn.addEventListener('click', () => env.openLightbox(item));
      }
      row.querySelector('.edit-btn').addEventListener('click', () => {
        if (isNote) env.openStickerNoteEditor(item);
        else env.openEditBox(item);
      });
      row.querySelector('.park-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await env.sendMessage({ type: 'PARK_PAGE_ANNOTATION', url: item.url });
        if (res?.ok) await env.loadList();
        else env.showCopyToast(env.t('liveParkFailed'));
      });
      row.querySelector('.reminder-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        env.openReminderEditor(item);
      });
      row.querySelector('.lock-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.toggleCardLock?.(item);
      });
      row.querySelector('.pin-btn:not(.lock-btn)')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (env.selectMode) return;
        env.togglePinned(item);
      });
      row.querySelector('.delete-btn').addEventListener('click', () => env.deleteItem(item.id));
      return row;

  }

  function renderGrid() {
    ensureBound('renderGrid');

      // Fresh match cache for this paint (shared by filter + group hit rows)
      env.SearchQuery.beginSearchMatchCache();
      try {
        if (env.settings.viewMode === 'canvas' && !env.canvasSessionFallback) {
          const searchContext = env.getCanvasSearchContext({ includeGroupMatches: true });
          syncCanvasSearchViewport(searchContext);
          env.renderCanvas(searchContext);
          return;
        }
        env.syncCanvasSearchViewport?.({ items: [], queryActive: false });
        env.disconnectCanvasMediaObserver();
        const filtered = env.getVisibleTabs();
        env.updateSavedBadge();

        if (env.allTabs.length === 0) {
          env.disconnectThumbObserver?.();
          renderEmpty({ title: env.t('emptyTitle'), body: env.t('emptyBody') });
          return;
        }
        if (filtered.length === 0) {
          env.disconnectThumbObserver?.();
          renderEmpty({ title: env.t('noResultsTitle'), body: env.t('noResultsBody') });
          return;
        }

        const isList = env.settings.viewMode === 'list' || env.canvasSessionFallback;
        if (env.gridNodeIsList !== isList) {
          // Rare full mode switch — cheap fallback, matches the old always-full-rebuild behavior.
          env.disconnectThumbObserver?.();
          env.gridEl.innerHTML = '';
          env.gridNodeElements.clear();
          env.gridNodeIsList = isList;
        }
        env.applyCardCols(env.settings.cardCols);

        const visibleIds = new Set(filtered.map((item) => item.id));
        for (const [id, node] of env.gridNodeElements) {
          if (!visibleIds.has(id)) env.removeGridNode(id, node);
        }
        env.gridEl.querySelector('.empty')?.remove();

        const frag = document.createDocumentFragment();
        filtered.forEach((item) => {
          const renderKey = env.gridNodeRenderKey(item, isList);
          let node = env.gridNodeElements.get(item.id);
          if (!node || node.dataset.gridRenderKey !== renderKey) {
            const fresh = isList ? createRow(item) : createCard(item);
            fresh.dataset.gridRenderKey = renderKey;
            if (node) node.replaceWith(fresh);
            node = fresh;
            env.gridNodeElements.set(item.id, node);
          }
          if (item.kind === 'group') appendGroupSearchHits(node, item);
          // Moving an existing node through the fragment preserves DOM order
          // without recreating it (same pattern as renderCanvas).
          frag.appendChild(node);
        });
        env.gridEl.appendChild(frag);
        env.updateGridSelectionUi();
      } finally {
        env.SearchQuery.clearSearchMatchCache();
      }

  }

  function renderEmpty(message) {
    ensureBound('renderEmpty');

      env.gridNodeElements.clear();
      env.gridEl.innerHTML = `
        <div class="empty" style="grid-column: 1 / -1">
          <strong>${escapeHtml(message.title)}</strong>
          ${message.body}
        </div>
      `;

  }

  function wireFavicon(root) {
    ensureBound('wireFavicon');

      const favImg = root.querySelector('img.favicon');
      if (!favImg) return;
      favImg.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'favicon-fallback';
        fallback.setAttribute('aria-hidden', 'true');
        favImg.replaceWith(fallback);
      });

  }

  function appendGroupSearchHits(parentEl, group, match = null, searchKey = '') {
    ensureBound('appendGroupSearchHits');

      if (!parentEl || group?.kind !== 'group') return;
      const currentKey = searchKey || JSON.stringify({
        query: env.query,
        scope: env.searchScope,
        regex: Boolean(env.settings.searchRegex),
      });
      if (parentEl.dataset.searchHitsKey === currentKey) return;
      parentEl.dataset.searchHitsKey = currentKey;
      parentEl.querySelector('.search-hits')?.remove();
      if (!env.query) return;

      const { hits, metaHit } = match || env.getGroupSearchMatch(group, env.query);
      if (!hits.length && !metaHit) return;

      const box = document.createElement('div');
      box.className = 'search-hits';
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('pointerdown', (e) => e.stopPropagation());

      if (hits.length) {
        const head = document.createElement('div');
        head.className = 'search-hits-head';
        head.textContent = env.t('searchHitsCount', { n: hits.length });
        box.appendChild(head);

        const show = hits.slice(0, env.SEARCH_HIT_LIMIT);
        for (const m of show) {
          const row = document.createElement('div');
          row.className = 'search-hit';

          const main = document.createElement('button');
          main.type = 'button';
          main.className = 'search-hit-main';
          main.title = m.kind === 'note' ? env.t('edit') : env.t('memberRestore');
          main.innerHTML = `
            <div class="search-hit-title">${escapeHtml(m.title || m.url || '—')}</div>
            <div class="search-hit-url">${escapeHtml(m.kind === 'note' ? (m.markdown || '').slice(0, 160) : (m.url || ''))}</div>
          `;
          main.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (env.selectMode) return;
            if (m.kind === 'note') env.openStickerNoteEditor(m, { groupId: group.id });
            else env.restoreMember(group.id, m.id);
          });

          const actions = document.createElement('div');
          actions.className = 'search-hit-actions';

          const prevBtn = document.createElement('button');
          prevBtn.type = 'button';
          prevBtn.className = 'icon-btn sm';
          prevBtn.title = m.kind === 'note' ? env.t('edit') : env.t('expand');
          prevBtn.innerHTML = iconSvg('expand');
          prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (m.kind === 'note') env.openStickerNoteEditor(m, { groupId: group.id });
            else env.openLightbox(m, { groupId: group.id });
          });

          const restBtn = document.createElement('button');
          restBtn.type = 'button';
          restBtn.className = 'icon-btn sm';
          restBtn.title = m.kind === 'note' ? env.t('delete') : env.t('memberRestore');
          restBtn.innerHTML = iconSvg(m.kind === 'note' ? 'delete' : 'restore');
          restBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (m.kind === 'note') env.deleteGroupNote(group.id, m.id);
            else env.restoreMember(group.id, m.id);
          });

          actions.append(prevBtn, restBtn);
          row.append(main, actions);
          box.appendChild(row);
        }

        if (hits.length > env.SEARCH_HIT_LIMIT) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'search-hits-more';
          more.textContent = env.t('searchHitsMore', { n: hits.length - env.SEARCH_HIT_LIMIT });
          more.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            env.openMembersBox(group);
          });
          box.appendChild(more);
        }
      } else if (metaHit) {
        const head = document.createElement('div');
        head.className = 'search-hits-head meta-only';
        head.textContent = env.t('searchHitGroupMeta');
        box.appendChild(head);
      }

      parentEl.appendChild(box);

  }

  function groupCoverHtml(item, { canvas = false } = {}) {
    ensureBound('groupCoverHtml');

      if (env.isMediaLocked?.(item)) return mediaLockOverlayHtml(item);

      const mediaClass = canvas ? ' canvas-thumb' : '';
      const mediaAttribute = canvas ? ' data-canvas-media="true"' : '';
      const mediaAvailability = (member) => canvas
        ? ` data-canvas-has-thumb="${member.hasThumb || member.thumbnail ? 'true' : 'false'}" data-canvas-has-snap="${member.hasSnap || member.snapshot ? 'true' : 'false'}"`
        : '';
      const imageHtml = (member, className = '') =>
        `<img class="${className}${className ? ' ' : ''}lazy-thumb${mediaClass}" alt="" draggable="false" data-media-key="${escapeAttr(mediaKeyForMember(item.id, member.id))}"${mediaAttribute}${mediaAvailability(member)} />`;
      const members = (item.tabs || []).filter((m) => m.hasThumb || m.thumbnail).slice(0, 4);
      if (members.length === 0) {
        // still try first few for keys even without hasThumb flag (migration)
        const any = (item.tabs || []).slice(0, 4);
        if (!any.length) {
          if (item.notes?.length) {
            return `<div class="canvas-note-cover">${iconSvg('note')}<span>${escapeHtml(t('noteKind'))}</span></div>`;
          }
          return `<div class="group-cover empty-cover"></div>`;
        }
        if (any.length === 1) {
          return imageHtml(any[0], 'thumb');
        }
        return `<div class="group-mosaic mosaic-${Math.min(any.length, 4)}">${any
          .map((m) => imageHtml(m))
          .join('')}</div>`;
      }
      if (members.length === 1) {
        return imageHtml(members[0], 'thumb');
      }
      return `<div class="group-mosaic mosaic-${Math.min(members.length, 4)}">${members
        .map((m) => imageHtml(m))
        .join('')}</div>`;

  }

  function iconSvg(name) {
    ensureBound('iconSvg');

      const paths = {
        edit: '<path d="m4 16.5-.7 3.2 3.2-.7L18.1 7.4a2 2 0 0 0-2.8-2.8L3.7 16.5z"></path><path d="m13.8 6.2 4 4"></path>',
        expand: '<path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"></path>',
        members: '<rect x="4" y="5" width="12" height="14" rx="2"></rect><path d="M8 3h10a2 2 0 0 1 2 2v12M8 9h4M8 13h5"></path>',
        pin: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"></path>',
        delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>',
        restore: '<path d="M5 8h9a5 5 0 1 1-3.5 8.5L8 14"></path><path d="M5 8V4M5 8l4-2"></path>',
        copy: '<rect x="8" y="8" width="11" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"></path>',
        lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
        unlock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0"></path>',
        snapshot: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="12" cy="12" r="3"></circle><path d="M8 5 9.2 3h5.6L16 5"></path>',
        close: '<path d="m6 6 12 12M18 6 6 18"></path>',
        note: '<path d="M5 4h14v16H5z"></path><path d="M8 8h8M8 12h8M8 16h5"></path>',
        reminder: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
      };
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${paths[name] || ''}</svg>`;

  }

  function itemTitle(item) {
    ensureBound('itemTitle');

      const display = typeof item?.displayTitle === 'string' ? item.displayTitle.trim() : '';
      if (display) return display;
      if (item.kind === 'group') return item.title || env.t('unnamedGroup');
      if (item.kind === 'note') return item.title || env.t('noteUntitled');
      if (item.cardSource === 'image') return item.title || env.t('imageCardUntitled');
      return item.title || item.url || 'Untitled';

  }

  function itemOriginalTitle(item) {
    const display = typeof item?.displayTitle === 'string' ? item.displayTitle.trim() : '';
    const original = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!display || !original || display === original) return '';
    if (item?.locked && item?.hideOriginalTitle) return '';
    return original;
  }

  function originalTitleHtml(item) {
    const original = itemOriginalTitle(item);
    if (!original) return '';
    return `<div class="title-original" title="${escapeAttr(original)}">${escapeHtml(original)}</div>`;
  }

  function mediaLockOverlayHtml(item, extraClass = '') {
    if (!env.isMediaLocked?.(item)) return '';
    const needsPassword = Boolean(item.lockHash);
    const label = env.t(needsPassword ? 'unlockWithPassword' : 'unlockTap');
    return `<button type="button" class="media-lock-overlay${extraClass ? ` ${extraClass}` : ''}" data-unlock-id="${escapeAttr(item.id)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${iconSvg('lock')}<span>${escapeHtml(label)}</span></button>`;
  }

  function wireMediaLockOverlay(root, item) {
    root?.querySelectorAll?.('[data-unlock-id]')?.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        env.requestUnlockItem?.(item);
      });
    });
  }

  function formatSavedAt(ts) {
    ensureBound('formatSavedAt');

      if (!ts) return '—';
      try {
        return new Date(ts).toLocaleString(env.settings.locale === 'en' ? 'en' : 'zh-Hant');
      } catch {
        return String(ts);
      }

  }

  function beginCardDrag(state, e) {
    ensureBound('beginCardDrag');

      const { card } = state;
      const rect = card.getBoundingClientRect();
      state.active = true;
      state.offsetX = e.clientX - rect.left;
      state.offsetY = e.clientY - rect.top;

      const placeholder = document.createElement('div');
      placeholder.className = 'card-placeholder';
      placeholder.style.height = `${rect.height}px`;
      // Match card width so grid reflow is stable
      placeholder.style.width = `${rect.width}px`;
      card.parentElement.insertBefore(placeholder, card);
      state.placeholder = placeholder;

      env.gridEl.classList.add('is-dragging');
      card.classList.add('dragging');
      card.style.position = 'fixed';
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      card.style.width = `${rect.width}px`;
      card.style.height = `${rect.height}px`;
      card.style.zIndex = '80';
      card.style.margin = '0';
      // Ensure capture survives after leaving the card bounds
      try {
        if (state.pointerId != null) card.setPointerCapture(state.pointerId);
      } catch {
        // ignore
      }

  }

  async function endCardDrag(e) {
    ensureBound('endCardDrag');

      if (!env.dragState) return;
      const state = env.dragState;
      // Flush while dragState is still set — onCardPointerMove early-returns
      // once dragState is null, so this must run before clearing it.
      flushCardPointerFrame(e);
      env.dragState = null;
      env.detachCardDragListeners(state);

      const clientX = e?.clientX;
      const clientY = e?.clientY;

      try {
        if (e?.pointerId != null) state.card.releasePointerCapture(e.pointerId);
        else if (state.pointerId != null) state.card.releasePointerCapture(state.pointerId);
      } catch {
        // ignore
      }

      if (!state.active) {
        if (env.selectMode) return;
        // setPointerCapture suppresses click — handle short-press here
        if (state.allowClickCopy && state.item) {
          env.copySavedLink(state.item);
          return;
        }
        if (state.allowClickRestore) {
          env.restoreItem(state.id);
        }
        return;
      }

      // Re-check stack target at drop point (dwell optional if still in hotzone)
      let stackTargetId = state.stackTargetId || null;
      if (
        !stackTargetId &&
        typeof clientX === 'number' &&
        typeof clientY === 'number'
      ) {
        const el = env.findStackTargetAt(clientX, clientY, state.card);
        if (el?.dataset?.id && el.dataset.id !== state.id) {
          stackTargetId = el.dataset.id;
        }
      }

      env.cleanupCardDragVisual(state);

      // Drop onto another card → stack / merge into group
      if (stackTargetId && stackTargetId !== state.id) {
        const sourceItem = env.allTabs.find((candidate) => candidate.id === state.id);
        const targetItem = env.allTabs.find((candidate) => candidate.id === stackTargetId);
        if (sourceItem?.kind === 'live' || targetItem?.kind === 'live') {
          env.showCopyToast(t('liveNoStack'));
          return;
        }
        const res = await env.sendMessage({
          type: 'STACK_ITEMS',
          sourceId: state.id,
          targetId: stackTargetId,
        });
        if (res.ok && Array.isArray(res.items)) {
          if (res.undoToken) env.ParkHistory.push({ kind: 'stack', token: res.undoToken });
          env.allTabs = env.normalizeParkedList(res.items);
          renderGrid();
          env.showCopyToast(t('stackMerged'));
          return;
        }
        console.warn('[TabWall] STACK_ITEMS failed', res);
        env.showCopyToast(t('stackFailed'));
        // fall through to reorder if stack failed
      }

      const ids = [...env.gridEl.querySelectorAll('.card')].map((el) => el.dataset.id).filter(Boolean);

      let newAll;
      if (env.query) {
        const idSet = new Set(ids);
        const rest = env.allTabs.filter((t) => !idSet.has(t.id));
        const ordered = ids.map((i) => env.allTabs.find((t) => t.id === i)).filter(Boolean);
        newAll = [...ordered, ...rest];
      } else {
        newAll = ids.map((i) => env.allTabs.find((t) => t.id === i)).filter(Boolean);
        const have = new Set(newAll.map((t) => t.id));
        for (const t of env.allTabs) {
          if (!have.has(t.id)) newAll.push(t);
        }
      }

      env.allTabs = newAll;

      const res = await env.sendMessage({
        type: 'REORDER_ITEMS',
        ids: env.allTabs.map((t) => t.id),
      });
      if (res.ok && Array.isArray(res.items)) env.allTabs = res.items;
      renderGrid();

  }

  function attachCardDrag(card, item) {
    ensureBound('attachCardDrag');

      // Capture phase: thumb / card body can start drag; meta is excluded (copy only)
      card.addEventListener(
        'pointerdown',
        (e) => {
          if (env.selectMode) return;
          if (env.isMultiSelectModifier(e)) return;
          if (env.settings.viewMode === 'list') return;
          if (e.button != null && e.button !== 0) return;
          // Meta / copy-hit: do not capture — copy handled by bindMetaCopy
          if (e.target.closest('.meta, .copy-hit')) return;
          if (
            e.target.closest(
              'button, input, a, .icon-btn, .card-check, .delete-btn, .search-hits, .search-hit'
            )
          ) {
            return;
          }

          // End any prior gesture
          if (env.dragState) {
            env.detachCardDragListeners(env.dragState);
            env.dragState = null;
          }

          const pointerId = e.pointerId;
          e.preventDefault();

          const state = {
            card,
            item,
            id: item.id,
            pointerId,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: 0,
            offsetY: 0,
            placeholder: null,
            active: false,
            stackTargetId: null,
            stackCandidateId: null,
            stackCandidateSince: 0,
            allowClickRestore: Boolean(
              e.target.closest('.thumb-wrap, .thumb, .group-cover, .group-mosaic, .group-badge')
            ),
            allowClickCopy: false,
            onMove: null,
            onUp: null,
          };

          state.onMove = (ev) => {
            if (ev.pointerId !== pointerId) return;
            env.queueCardPointerMove(ev);
          };
          state.onUp = (ev) => {
            if (ev.pointerId !== pointerId) return;
            // endCardDrag flushes the pending queued move (see queueCardPointerMove)
            // and detaches listeners itself, synchronously, before its first await.
            endCardDrag(ev).catch(() => {});
          };

          env.dragState = state;
          window.addEventListener('pointermove', state.onMove, true);
          window.addEventListener('pointerup', state.onUp, true);
          window.addEventListener('pointercancel', state.onUp, true);

          try {
            card.setPointerCapture(pointerId);
          } catch {
            // ignore
          }
        },
        true
      );

  }

  function onCardPointerMove(e) {
    ensureBound('onCardPointerMove');

      if (!env.dragState) return;
      // Ignore multi-touch / wrong pointer
      if (env.dragState.pointerId != null && e.pointerId !== env.dragState.pointerId) return;

      const dx = e.clientX - env.dragState.startX;
      const dy = e.clientY - env.dragState.startY;

      if (!env.dragState.active) {
        if (Math.hypot(dx, dy) < env.DRAG_THRESHOLD) return;
        beginCardDrag(env.dragState, e);
      }

      const { card, offsetX, offsetY, placeholder } = env.dragState;
      if (!card) return;

      card.style.left = `${e.clientX - offsetX}px`;
      card.style.top = `${e.clientY - offsetY}px`;

      // Stack only after a short dwell on the title/meta hot-zone; otherwise keep reordering
      const stacking = updateStackHoverState(env.dragState, e.clientX, e.clientY);
      if (stacking) return;

      if (!placeholder || !placeholder.parentElement) return;

      const before = env.snapshotCardRects();
      const siblings = [...env.gridEl.children].filter((el) => el !== card);
      let insertBefore = null;
      for (const el of siblings) {
        if (el === placeholder) continue;
        const rect = el.getBoundingClientRect();
        const cy = rect.top + rect.height / 2;
        const cx = rect.left + rect.width / 2;
        if (e.clientY < cy || (Math.abs(e.clientY - cy) < rect.height / 2 && e.clientX < cx)) {
          insertBefore = el;
          break;
        }
      }

      const currentNext = placeholder.nextElementSibling;
      const target = insertBefore;
      if (target === placeholder) return;
      // Avoid no-op moves
      if (target == null) {
        if (placeholder.parentElement && placeholder !== env.gridEl.lastElementChild) {
          env.gridEl.appendChild(placeholder);
          env.flipCards(before);
        }
      } else if (currentNext !== target) {
        env.gridEl.insertBefore(placeholder, target);
        env.flipCards(before);
      }

  }

  function updateStackHoverState(state, clientX, clientY) {
    ensureBound('updateStackHoverState');

      const stackEl = env.findStackTargetAt(clientX, clientY, state.card);
      const candId = stackEl?.dataset?.id || null;
      const now = performance.now();

      if (candId !== state.stackCandidateId) {
        state.stackCandidateId = candId;
        state.stackCandidateSince = candId ? now : 0;
        // Not armed until dwell completes
        if (state.stackTargetId) {
          env.clearStackHover();
          state.stackTargetId = null;
        }
        return false;
      }

      if (!candId) {
        if (state.stackTargetId) {
          env.clearStackHover();
          state.stackTargetId = null;
        }
        return false;
      }

      const armed = now - (state.stackCandidateSince || 0) >= env.STACK_DWELL_MS;
      if (armed) {
        if (state.stackTargetId !== candId) {
          env.clearStackHover();
          state.stackTargetId = candId;
          if (stackEl) stackEl.classList.add('stack-hover');
        }
        return true;
      }

      // Hovering but not armed — still reorder
      if (state.stackTargetId) {
        env.clearStackHover();
        state.stackTargetId = null;
      }
      return false;

  }

  function bindMetaCopy(metaEl, item) {
    ensureBound('bindMetaCopy');

      if (!metaEl) return;
      let downX = 0;
      let downY = 0;
      let downId = null;
      let copiedOnUp = false;

      metaEl.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest('.search-hits, button, input')) return;
        downX = e.clientX;
        downY = e.clientY;
        downId = e.pointerId;
        copiedOnUp = false;
      });

      metaEl.addEventListener('pointerup', (e) => {
        if (downId != null && e.pointerId !== downId) return;
        const pid = downId;
        downId = null;
        if (pid == null) return;
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest('.search-hits, button, input')) return;
        if (env.dragState?.active) return;
        if (Math.hypot(e.clientX - downX, e.clientY - downY) >= env.DRAG_THRESHOLD) return;
        if (env.selectMode || env.isMultiSelectModifier(e)) {
          env.handleCardSelectClick(item.id, e);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        copiedOnUp = true;
        env.copySavedLink(item);
      });

      metaEl.addEventListener('click', (e) => {
        if (copiedOnUp) {
          copiedOnUp = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.target.closest('.search-hits, button, input')) return;
        if (env.dragState?.active) return;
        if (env.selectMode || env.isMultiSelectModifier(e)) {
          env.handleCardSelectClick(item.id, e);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        env.copySavedLink(item);
      });

  }

  global.TabWallListUi = { bind, createGroupCard, createCard, createRow, renderGrid, renderEmpty, wireFavicon, appendGroupSearchHits, groupCoverHtml, iconSvg, itemTitle, itemOriginalTitle, formatSavedAt, beginCardDrag, endCardDrag, attachCardDrag, onCardPointerMove, updateStackHoverState, bindMetaCopy };
})(typeof self !== 'undefined' ? self : globalThis);
