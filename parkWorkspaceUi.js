(function (global) {
  'use strict';
  let env = null;
  function bind(next) { if (next && typeof next === 'object') env = next; }
  function ensureBound(n) { if (!env) throw new Error('TabWallWorkspaceUi.' + n + ' used before bind()'); }

  /* free-var shims: incomplete extract rewrites still call bare park helpers */
  function t(...args) { return env.t(...args); }
  function escapeHtml(...args) { return env.escapeHtml(...args); }
  function escapeAttr(...args) { return env.escapeAttr(...args); }
  function formatSavedAt(...args) { return env.formatSavedAt(...args); }
  function iconSvg(...args) { return env.iconSvg(...args); }
  function itemTitle(...args) { return env.itemTitle(...args); }
  function domainOf(...args) { return env.domainOf(...args); }


  function renderMembersList(group) {
    ensureBound('renderMembersList');

      const members = [
        ...(group.tabs || []).map((member) => ({ ...member, kind: 'tab' })),
        ...(group.notes || []).map((note) => ({ ...note, kind: 'note' })),
      ].sort(
        (a, b) => (a.indexInGroup || 0) - (b.indexInGroup || 0)
      );
      env.membersList.innerHTML = '';
      if (members.length === 0) {
        env.membersList.innerHTML = `<div class="tag-manage-empty">—</div>`;
        return;
      }
      members.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'member-row';
        row.dataset.memberId = m.id;
        const isNote = m.kind === 'note';
        const storedOnly = !isNote && env.isStoredOnlyUrl(m.url);
        const note = isNote ? m.markdown || '' : m.note || '';
        const tags = Array.isArray(m.tags) ? m.tags : [];
        const mKey = isNote && m.attachments?.[0]
          ? env.Media.mediaKeyNoteAttachment(m.id, m.attachments[0].id)
          : env.mediaKeyForMember(group.id, m.id);
        row.innerHTML = `
          ${
            isNote
              ? `<div class="member-thumb note-member-thumb">${env.iconSvg('note')}</div>`
              : env.isMediaLocked?.(group) || env.isMediaLocked?.(m)
                ? `<button type="button" class="member-thumb media-lock-overlay" data-unlock-id="${escapeAttr((env.isMediaLocked?.(m) ? m : group).id)}">${env.iconSvg('lock')}</button>`
                : `<img class="member-thumb lazy-thumb" alt="" data-media-key="${escapeAttr(mKey)}" />`
          }
          <div class="member-body">
            <div class="member-title" title="${escapeAttr(itemTitle(m))}">
              ${escapeHtml(itemTitle(m))}
              ${storedOnly ? `<span class="stored-only-badge">${env.escapeHtml(env.t('storedOnlyShort'))}</span>` : ''}
              ${env.itemOriginalTitle?.(m) ? `<div class="title-original">${escapeHtml(env.itemOriginalTitle(m))}</div>` : ''}
            </div>
            <div class="member-url" title="${escapeAttr(isNote ? t('noteKind') : m.url || '')}">${escapeHtml(isNote ? t('noteKind') : m.url || '')}</div>
            ${storedOnly ? `<div class="note-preview">${env.escapeHtml(env.t('storedOnly'))}</div>` : ''}
            ${note ? `<div class="note-preview">${env.escapeHtml(note)}</div>` : ''}
            ${
              tags.length
                ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
                : ''
            }
            <div class="member-actions">
              <button type="button" class="btn snap-btn">${escapeHtml(t('memberSnapshot'))}</button>
              <button type="button" class="btn edit-m-btn">${escapeHtml(isNote ? t('edit') : t('memberEdit'))}</button>
              ${isNote
                ? `<button type="button" class="btn danger delete-note-m-btn">${env.escapeHtml(env.t('delete'))}</button>`
                : `<button type="button" class="btn primary restore-m-btn" ${storedOnly ? `disabled title="${escapeAttr(t('storedOnly'))}"` : ''}>${env.escapeHtml(env.t('memberRestore'))}</button>`}
            </div>
          </div>
        `;
        env.observeThumb(row.querySelector('img.lazy-thumb'));
        const unlockTarget = env.isMediaLocked?.(m) ? m : env.isMediaLocked?.(group) ? group : null;
        row.querySelector('[data-unlock-id]')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (unlockTarget) env.requestUnlockItem?.(unlockTarget);
        });
        const openMemberSnap = () => {
          if (isNote) {
            env.openStickerNoteEditor(m, { groupId: group.id });
            return;
          }
          if (unlockTarget) {
            env.requestUnlockItem?.(unlockTarget);
            return;
          }
          openLightbox(
            {
              ...m,
              id: m.id,
              title: itemTitle(m),
              url: m.url,
              hasSnap: m.hasSnap,
              hasThumb: m.hasThumb,
            },
            { groupId: group.id }
          );
        };
        row.querySelector('.snap-btn').addEventListener('click', openMemberSnap);
        row.querySelector('.member-thumb')?.addEventListener('click', openMemberSnap);
        row.querySelector('.edit-m-btn').addEventListener('click', () => {
          if (isNote) env.openStickerNoteEditor(m, { groupId: group.id });
          else openMemberEditBox(group.id, m);
        });
        row.querySelector('.restore-m-btn')?.addEventListener('click', async () => {
          await env.restoreMember(group.id, m.id);
          const g = env.allTabs.find((x) => x.id === group.id);
          if (!g) closeMembersBox();
          else renderMembersList(g);
        });
        row.querySelector('.delete-note-m-btn')?.addEventListener('click', async () => {
          await env.deleteGroupNote(group.id, m.id);
        });
        env.membersList.appendChild(row);
      });

  }

  function openMembersBox(group) {
    ensureBound('openMembersBox');

      closeAllFloatsExcept('members');
      env.membersGroupId = group.id;
      const color = env.GROUP_COLORS[group.color] || env.GROUP_COLORS.grey;
      env.membersTitle.innerHTML = `<span class="color-dot" style="background:${color};display:inline-block;margin-right:6px;vertical-align:middle"></span>${escapeHtml(itemTitle(group))} · ${escapeHtml(t('groupTabs', { n: (group.tabs || []).length + (group.notes || []).length }))}`;
      renderMembersList(group);
      env.membersBox.classList.add('open');
      env.membersBox.setAttribute('aria-hidden', 'false');
      env.placeMembersBoxCentered();
      syncFloatBackdrop();

  }

  function closeMembersBox() {
    ensureBound('closeMembersBox');

      env.membersGroupId = null;
      env.membersBox.classList.remove('open');
      env.membersBox.setAttribute('aria-hidden', 'true');
      env.membersList.innerHTML = '';
      syncFloatBackdrop();

  }

  function renderDedupeClusters() {
    ensureBound('renderDedupeClusters');

      if (!env.dedupeClustersEl) return;
      env.dedupeClustersEl.innerHTML = '';
      if (!env.dedupeState.length) {
        env.dedupeClustersEl.innerHTML = `<div class="dedupe-empty">${escapeHtml(t('dedupeNoDupes'))}</div>`;
        if (env.dedupeStatus) env.dedupeStatus.textContent = env.t('dedupeNoDupes');
        return;
      }
      if (env.dedupeStatus) {
        env.dedupeStatus.textContent = env.t('dedupeCount', { n: env.dedupeState.length });
      }

      env.dedupeState.forEach((cluster, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'dedupe-cluster';
        wrap.dataset.idx = String(idx);

        const tools = document.createElement('div');
        tools.className = 'cluster-tools';
        const mkBtn = (label, mode) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn' + (cluster.mode === mode ? ' primary' : '');
          b.textContent = label;
          b.addEventListener('click', () => {
            env.setClusterKeepMode(cluster, mode);
            renderDedupeClusters();
          });
          return b;
        };
        tools.append(
          mkBtn(env.t('dedupeKeepAll'), 'all'),
          mkBtn(env.t('dedupeKeepNewest'), 'newest'),
          mkBtn(env.t('dedupeKeepOldest'), 'oldest')
        );

        const urlEl = document.createElement('div');
        urlEl.className = 'cluster-url';
        urlEl.textContent = `${cluster.url} · ${t('dedupeCount', { n: cluster.items.length })}`;

        wrap.appendChild(urlEl);
        wrap.appendChild(tools);

        for (const it of cluster.items) {
          const row = document.createElement('div');
          row.className = 'dedupe-item';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = cluster.keepIds.has(it.id);
          cb.addEventListener('change', () => {
            cluster.mode = 'manual';
            if (cb.checked) cluster.keepIds.add(it.id);
            else cluster.keepIds.delete(it.id);
            // ensure at least one kept
            if (cluster.keepIds.size === 0) {
              cb.checked = true;
              cluster.keepIds.add(it.id);
            }
          });
          row.appendChild(cb);
          appendDedupeThumb(row, it);
          const body = document.createElement('div');
          body.className = 'di-body';
          body.innerHTML = `
            <div class="di-title">${escapeHtml(it.title || '—')}</div>
            <div class="di-meta">${escapeHtml(t('dedupeSavedAt', { t: formatSavedAt(it.savedAt) }))}</div>
          `;
          row.appendChild(body);
          appendDedupePreviewBtn(row, it);
          wrap.appendChild(row);
        }

        env.dedupeClustersEl.appendChild(wrap);
      });
      env.centerDedupeBox();

  }

  async function openDedupeBox() {
    ensureBound('openDedupeBox');

      if (!env.dedupeBox) return;
      closeAllFloatsExcept('dedupe');
      env.closeSettingsBox(false);
      env.dedupeBox.classList.add('open');
      env.dedupeBox.setAttribute('aria-hidden', 'false');
      syncFloatBackdrop();
      env.centerDedupeBox();
      await runDedupeScan();
      requestAnimationFrame(() => {
        env.centerDedupeBox();
        requestAnimationFrame(() => env.centerDedupeBox());
      });

  }

  function closeDedupeBox(sync = true) {
    ensureBound('closeDedupeBox');

      if (!env.dedupeBox) return;
      env.dedupeBox.classList.remove('open');
      env.dedupeBox.setAttribute('aria-hidden', 'true');
      if (sync) syncFloatBackdrop();

  }

  async function runDedupeScan() {
    ensureBound('runDedupeScan');

      if (env.dedupeStatus) env.dedupeStatus.textContent = '…';
      const res = await env.sendMessage({ type: 'SCAN_DUPLICATES' });
      const clusters = res?.ok && Array.isArray(res.clusters) ? res.clusters : [];
      env.dedupeState = clusters.map((c) => {
        const cluster = {
          url: c.url,
          items: Array.isArray(c.items) ? c.items : [],
          mode: 'newest',
          keepIds: new Set(),
        };
        env.setClusterKeepMode(cluster, 'newest');
        return cluster;
      });
      renderDedupeClusters();
      requestAnimationFrame(() => env.centerDedupeBox());

  }

  async function applyDedupeChoices() {
    ensureBound('applyDedupeChoices');

      const ops = env.dedupeState
        .filter((c) => c.keepIds.size > 0 && c.keepIds.size < c.items.length)
        .map((c) => ({ url: c.url, keepIds: [...c.keepIds] }));

      if (!ops.length) {
        if (env.dedupeStatus) env.dedupeStatus.textContent = env.t('dedupeApplyNone');
        return;
      }

      const res = await env.sendMessage({ type: 'APPLY_DEDUPE', ops });
      if (res?.ok) {
        if (env.dedupeStatus) env.dedupeStatus.textContent = env.t('dedupeApplyOk', { n: res.deleted || 0 });
        await loadList();
        await runDedupeScan();
      } else if (env.dedupeStatus) {
        env.dedupeStatus.textContent = res?.error || 'error';
      }

  }

  function initDedupeUi() {
    ensureBound('initDedupeUi');

      initConflictUi();
      initPreSaveUi();
      env.openDedupeBtn?.addEventListener('click', async () => {
        await openDedupeBox();
      });
      env.dedupeCloseX?.addEventListener('click', () => closeDedupeBox());
      env.dedupeRescanBtn?.addEventListener('click', () => runDedupeScan());
      env.dedupeApplyBtn?.addEventListener('click', () => applyDedupeChoices());
      if (env.dedupeDrag && env.dedupeBox) setupFloatDrag(env.dedupeDrag, env.dedupeBox);

  }

  function collectGroupMembers(group) {
    return [
      ...(group.tabs || []).map((member) => ({ ...member, kind: 'tab' })),
      ...(group.notes || []).map((note) => ({ ...note, kind: 'note' })),
    ].sort((a, b) => (a.indexInGroup || 0) - (b.indexInGroup || 0));
  }

  function buildGroupMemberNavList(group) {
    ensureBound('buildGroupMemberNavList');
    return (group.tabs || [])
      .slice()
      .sort((a, b) => (a.indexInGroup || 0) - (b.indexInGroup || 0))
      .map((m) => ({
        key: `m:${group.id}:${m.id}`,
        mediaKey: env.mediaKeyForMember(group.id, m.id),
        title: itemTitle(m),
        originalTitle: env.itemOriginalTitle?.(m) || '',
        url: m.url || '',
        hasSnap: Boolean(m.hasSnap || m.snapshot),
        hasThumb: Boolean(m.hasThumb || m.thumbnail),
        lockItem: m,
        groupLockItem: group,
        restore: { type: 'member', groupId: group.id, memberId: m.id },
        fromOverview: true,
      }));
  }

  function setLightboxChrome({
    showNav = false,
    showBack = false,
    showManage = false,
    restoreKey = 'restore',
    counterText = '—',
  } = {}) {
    if (env.lbPrev) env.lbPrev.hidden = !showNav;
    if (env.lbNext) env.lbNext.hidden = !showNav;
    if (env.lbBack) env.lbBack.hidden = !showBack;
    if (env.lbManageMembers) env.lbManageMembers.hidden = !showManage;
    if (env.lbRestore) {
      env.lbRestore.dataset.i18n = restoreKey;
      env.lbRestore.textContent = env.t(restoreKey);
    }
    if (env.lbCounter) env.lbCounter.textContent = counterText;
  }

  function renderGroupOverviewGrid(group) {
    ensureBound('renderGroupOverviewGrid');
    const members = collectGroupMembers(group);
    if (!members.length) {
      env.lbGroupMosaic.innerHTML = `<div class="lb-group-empty">—</div>`;
      return;
    }
    const cells = members.map((m) => {
      const isNote = m.kind === 'note';
      const titleText = itemTitle(m);
      const subText = isNote ? t('noteKind') : (m.url || '');
      if (isNote) {
        return `<button type="button" class="lb-group-cell" data-kind="note" data-member-id="${escapeAttr(m.id)}">
          <div class="lb-group-cell-media is-note">${env.iconSvg('note')}</div>
          <div class="lb-group-cell-title" title="${escapeAttr(titleText)}">${escapeHtml(titleText)}</div>
          <div class="lb-group-cell-sub">${escapeHtml(subText)}</div>
        </button>`;
      }
      const mKey = env.mediaKeyForMember(group.id, m.id);
      const hasMedia = Boolean(m.hasThumb || m.thumbnail || m.hasSnap || m.snapshot);
      const mediaLocked = env.isMediaLocked?.(group) || env.isMediaLocked?.(m);
      const media = mediaLocked
        ? `<div class="lb-group-cell-media media-lock-overlay">${env.iconSvg('lock')}</div>`
        : hasMedia
          ? `<img class="lb-group-cell-media lazy-thumb" alt="" draggable="false" data-media-key="${escapeAttr(mKey)}" />`
          : `<div class="lb-group-cell-media is-placeholder" aria-hidden="true"></div>`;
      return `<button type="button" class="lb-group-cell" data-kind="tab" data-member-id="${escapeAttr(m.id)}">
        ${media}
        <div class="lb-group-cell-title" title="${escapeAttr(titleText)}">${escapeHtml(titleText)}</div>
        <div class="lb-group-cell-sub" title="${escapeAttr(subText)}">${escapeHtml(subText)}</div>
      </button>`;
    }).join('');
    env.lbGroupMosaic.innerHTML = `<div class="lb-group-grid">${cells}</div>`;
    env.lbGroupMosaic.querySelectorAll('img.lazy-thumb').forEach((img) => env.observeThumb(img));
  }

  function bindGroupOverviewClicks(groupId) {
    if (!env.lbGroupMosaic) return;
    env.lbGroupMosaic.onclick = (e) => {
      const cell = e.target.closest?.('.lb-group-cell');
      if (!cell || !env.lbGroupMosaic.contains(cell)) return;
      const group = env.allTabs.find((x) => x.id === groupId);
      if (!group || group.kind !== 'group') return;
      const memberId = cell.dataset.memberId;
      const kind = cell.dataset.kind;
      if (kind === 'note') {
        const note = (group.notes || []).find((n) => n.id === memberId);
        if (!note) return;
        closeLightbox();
        env.openStickerNoteEditor(note, { groupId: group.id });
        return;
      }
      const list = buildGroupMemberNavList(group);
      const index = list.findIndex((entry) => entry.restore.memberId === memberId);
      if (index < 0) return;
      showLightboxEntry(list[index], index, list);
    };
  }

  function backToGroupOverview() {
    ensureBound('backToGroupOverview');
    const groupId = env.expandedMeta?.groupId;
    if (!groupId) return false;
    const group = env.allTabs.find((x) => x.id === groupId);
    if (!group || group.kind !== 'group') return false;
    openCanvasGroupLightbox(group);
    return true;
  }

  function handleLightboxEscape() {
    ensureBound('handleLightboxEscape');
    if (!env.lightbox?.classList.contains('open')) return false;
    if (env.expandedMeta?.fromOverview && env.expandedMeta?.groupId) {
      return backToGroupOverview();
    }
    closeLightbox();
    return true;
  }

  async function showLightboxEntry(entry, index, list) {
    ensureBound('showLightboxEntry');

      env.expandedId = entry.restore.type === 'member' ? entry.restore.memberId : entry.restore.id;
      env.expandedMeta =
        entry.restore.type === 'member'
          ? {
              type: 'member',
              groupId: entry.restore.groupId,
              fromOverview: Boolean(entry.fromOverview),
            }
          : null;
      env.lightboxNav = { list, index };
      env.lbTitle.textContent = entry.title;
      if (entry.originalTitle) {
        env.lbUrl.textContent = entry.originalTitle + (entry.url ? ` · ${entry.url}` : '');
      } else {
        env.lbUrl.textContent = entry.url;
      }
      env.lbImage.hidden = false;
      if (env.lbGroupMosaic) {
        env.lbGroupMosaic.hidden = true;
        env.lbGroupMosaic.replaceChildren();
        env.lbGroupMosaic.onclick = null;
      }
      setLightboxChrome({
        showNav: list.length > 1,
        showBack: Boolean(entry.fromOverview && entry.restore?.type === 'member'),
        showManage: false,
        restoreKey: 'restore',
        counterText: list.length ? `${index + 1} / ${list.length}` : '—',
      });
      env.lightbox.classList.add('open');
      env.lightbox.setAttribute('aria-hidden', 'false');

      // placeholder thumb then full snap
      const prevSrc = env.lbImage.src;
      if (prevSrc && prevSrc.startsWith('blob:') && ![...env.snapCache.values()].includes(prevSrc)) {
        // keep snap cache; don't revoke mid-nav of cached
      }

      const lockSource = lightboxLockSource(entry);
      if (env.lbLockOverlay) {
        if (lockSource) {
          const label = env.t(lockSource.lockHash ? 'unlockWithPassword' : 'unlockTap');
          env.lbLockOverlay.hidden = false;
          env.lbLockOverlay.innerHTML = `${env.iconSvg('lock')}<span>${escapeHtml(label)}</span>`;
          env.lbLockOverlay.onclick = () => env.requestUnlockItem?.(lockSource);
          env.lbImage.removeAttribute('src');
          env.lbSnapHint.hidden = true;
          return;
        }
        env.lbLockOverlay.hidden = true;
        env.lbLockOverlay.onclick = null;
      }

      let shownSnap = false;
      if (entry.mediaKey && env.snapCache.has(entry.mediaKey)) {
        env.lbImage.src = env.snapCache.get(entry.mediaKey);
        env.lbSnapHint.hidden = true;
        shownSnap = true;
      } else {
        // show thumb first
        if (entry.mediaKey && entry.hasThumb) {
          const thumbUrl = await env.fetchMediaUrl(entry.mediaKey, 'thumb');
          if (thumbUrl && env.lightboxNav?.index === index) env.lbImage.src = thumbUrl;
        } else {
          env.lbImage.removeAttribute('src');
        }
        env.lbSnapHint.hidden = !entry.hasSnap;
        if (entry.mediaKey && entry.hasSnap) {
          const snapUrl = await env.fetchMediaUrl(entry.mediaKey, 'snap');
          if (snapUrl && env.lightboxNav?.index === index) {
            env.cacheSnap(entry.mediaKey, snapUrl);
            env.lbImage.src = snapUrl;
            env.lbSnapHint.hidden = true;
            shownSnap = true;
          }
        }
      }

      if (!shownSnap && !env.lbImage.getAttribute('src')) {
        env.lbSnapHint.hidden = false;
      }

      // prefetch neighbors
      const n = list.length;
      if (n > 1) {
        for (const d of [-1, 1]) {
          const ni = (index + d + n) % n;
          const ne = list[ni];
          if (ne?.mediaKey && ne.hasSnap && !env.snapCache.has(ne.mediaKey)) {
            env.fetchMediaUrl(ne.mediaKey, 'snap').then((url) => {
              if (url) env.cacheSnap(ne.mediaKey, url);
            });
          }
        }
      }

  }

  function openLightbox(item, meta = null) {
    ensureBound('openLightbox');

      if (item?.kind === 'group') {
        openCanvasGroupLightbox(item);
        return;
      }

      // When opening a group member from members panel, prefer group-scoped nav.
      if (meta?.groupId) {
        const group = env.allTabs.find((x) => x.id === meta.groupId);
        if (group?.kind === 'group') {
          const list = buildGroupMemberNavList(group).map((entry) => ({
            ...entry,
            fromOverview: Boolean(meta.fromOverview),
          }));
          const index = list.findIndex((e) => e.restore.memberId === item.id);
          if (index >= 0) {
            showLightboxEntry(list[index], index, list);
            return;
          }
        }
      }

      const list = buildLightboxNavList();
      let index = 0;
      if (meta?.groupId) {
        index = list.findIndex(
          (e) =>
            e.restore.type === 'member' &&
            e.restore.groupId === meta.groupId &&
            e.restore.memberId === item.id
        );
      } else {
        index = list.findIndex((e) => e.restore.type === 'tab' && e.restore.id === item.id);
      }
      if (index < 0) {
        const entry = {
          key: 'solo',
          mediaKey: meta?.groupId
            ? env.mediaKeyForMember(meta.groupId, item.id)
            : env.mediaKeyForItem(item),
          title: itemTitle(item),
          originalTitle: env.itemOriginalTitle?.(item) || '',
          url: item.url || '',
          hasSnap: Boolean(item.hasSnap || item.snapshot),
          hasThumb: Boolean(item.hasThumb || item.thumbnail),
          lockItem: item,
          restore: meta?.groupId
            ? { type: 'member', groupId: meta.groupId, memberId: item.id }
            : { type: 'tab', id: item.id },
        };
        showLightboxEntry(entry, 0, [entry]);
        return;
      }
      showLightboxEntry(list[index], index, list);

  }

  function openCanvasGroupLightbox(group) {
    ensureBound('openCanvasGroupLightbox');

      if (!group || group.kind !== 'group' || !env.lbGroupMosaic) return;
      const memberCount = (group.tabs || []).length + (group.notes || []).length;
      env.expandedId = group.id;
      env.expandedMeta = { type: 'group' };
      env.lightboxNav = null;
      env.lbTitle.textContent = env.itemTitle(group);
      env.lbUrl.textContent = env.t('groupTabs', { n: memberCount });
      setLightboxChrome({
        showNav: false,
        showBack: false,
        showManage: true,
        restoreKey: 'restoreGroup',
        counterText: memberCount ? String(memberCount) : '—',
      });
      env.lbImage.removeAttribute('src');
      env.lbImage.hidden = true;
      env.lbSnapHint.hidden = true;
      renderGroupOverviewGrid(group);
      bindGroupOverviewClicks(group.id);
      env.lbGroupMosaic.hidden = false;
      env.lightbox.classList.add('open');
      env.lightbox.setAttribute('aria-hidden', 'false');

  }

  function navigateLightbox(delta) {
    ensureBound('navigateLightbox');

      if (!env.lightboxNav || !env.lightboxNav.list.length) return;
      const n = env.lightboxNav.list.length;
      const next = (env.lightboxNav.index + delta + n) % n;
      showLightboxEntry(env.lightboxNav.list[next], next, env.lightboxNav.list);

  }

  function closeLightbox() {
    ensureBound('closeLightbox');

      env.expandedId = null;
      env.expandedMeta = null;
      env.lightboxNav = null;
      env.lightbox.classList.remove('open');
      env.lightbox.setAttribute('aria-hidden', 'true');
      env.lbImage.hidden = false;
      env.lbImage.removeAttribute('src');
      if (env.lbGroupMosaic) {
        env.lbGroupMosaic.hidden = true;
        env.lbGroupMosaic.replaceChildren();
        env.lbGroupMosaic.onclick = null;
      }
      setLightboxChrome({
        showNav: true,
        showBack: false,
        showManage: false,
        restoreKey: 'restore',
        counterText: '—',
      });

  }

  function buildLightboxNavList() {
    ensureBound('buildLightboxNavList');

      const list = [];
      for (const item of env.getVisibleTabs()) {
        if (item.kind === 'group') {
          for (const m of item.tabs || []) {
            list.push({
              key: `m:${item.id}:${m.id}`,
              mediaKey: env.mediaKeyForMember(item.id, m.id),
              title: itemTitle(m),
              originalTitle: env.itemOriginalTitle?.(m) || '',
              url: m.url || '',
              hasSnap: Boolean(m.hasSnap || m.snapshot),
              hasThumb: Boolean(m.hasThumb || m.thumbnail),
              lockItem: m,
              groupLockItem: item,
              restore: { type: 'member', groupId: item.id, memberId: m.id },
            });
          }
        } else {
          list.push({
            key: `t:${item.id}`,
            mediaKey: env.mediaKeyForItem(item),
            title: itemTitle(item),
            originalTitle: env.itemOriginalTitle?.(item) || '',
            url: item.url || '',
            hasSnap: Boolean(item.hasSnap || item.snapshot),
            hasThumb: Boolean(item.hasThumb || item.thumbnail),
            lockItem: item,
            restore: { type: 'tab', id: item.id },
          });
        }
      }
      return list;

  }

  function renderTagManager() {
    ensureBound('renderTagManager');

      const q = env.tagFilter.trim().toLowerCase();
      const list = env.tagStats.filter((t) => !q || t.name.toLowerCase().includes(q));
      env.tagManageList.innerHTML = '';

      if (list.length === 0) {
        env.tagManageList.innerHTML = `<div class="tag-manage-empty">${escapeHtml(t('tagEmpty'))}</div>`;
        return;
      }

      list.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'tag-chip-card';
        row.innerHTML = `
          <button type="button" class="name tag-filter-btn" title="${escapeAttr(t('tagApplyFilter'))}" aria-label="${escapeAttr(t('tagApplyFilter'))}">${escapeHtml(item.name)}</button>
          <span class="count">${escapeHtml(String(item.count))}</span>
          <button type="button" class="chip-btn rename-btn" title="${escapeAttr(t('rename'))}">${iconSvg('edit')}</button>
          <button type="button" class="chip-btn delete-btn" title="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
        `;

        row.querySelector('.tag-filter-btn').addEventListener('click', () => {
          env.searchScope = 'tag';
          env.searchEl.value = item.name;
          env.setSearchQueryFromInput({ immediate: true });
          env.syncSearchScopeUi();
          closeTagsBox();
        });

        row.querySelector('.rename-btn').addEventListener('click', async () => {
          const next = window.prompt(t('tagRenamePrompt'), item.name);
          if (next == null) return;
          const name = next.trim();
          if (!name || name === item.name) return;
          const res = await env.sendMessage({ type: 'RENAME_TAG', from: item.name, to: name });
          if (res.ok) {
            env.tagStats = res.tags || [];
            env.invalidateTagSuggest?.();
            renderTagManager();
            await loadList();
          }
        });

        row.querySelector('.delete-btn').addEventListener('click', async () => {
          if (!window.confirm(t('tagDeleteConfirm', { name: item.name }))) return;
          const res = await env.sendMessage({ type: 'DELETE_TAG', name: item.name });
          if (res.ok) {
            env.tagStats = res.tags || [];
            env.invalidateTagSuggest?.();
            renderTagManager();
            await loadList();
          }
        });

        env.tagManageList.appendChild(row);
      });

  }

  async function refreshTagManager() {
    ensureBound('refreshTagManager');

      const res = await env.sendMessage({ type: 'GET_TAGS' });
      env.tagStats = res.ok && Array.isArray(res.tags) ? res.tags : [];
      env.markTagSuggestIndexDirty();
      env.invalidateTagSuggest?.();
      renderTagManager();

  }

  async function addTagFromManager() {
    ensureBound('addTagFromManager');

      const name = env.tagAddInput.value.trim();
      if (!name) return;
      const res = await env.sendMessage({ type: 'ADD_TAG', name });
      if (res.ok) {
        env.tagAddInput.value = '';
        env.tagStats = res.tags || [];
        env.invalidateTagSuggest?.();
        renderTagManager();
      }

  }

  function updateBatchBar() {
    ensureBound('updateBatchBar');

      const isCanvasUi = env.settings.viewMode === 'canvas' && !env.canvasSessionFallback;
      const selection = isCanvasUi ? env.activeCanvasSelection() : env.selectedIds;
      const n = selection.size;
      const connectionSelected = isCanvasUi && Boolean(env.selectedCanvasConnectionId);
      env.batchCount.textContent = env.t('batchCount', { n });
      if (isCanvasUi) {
        if (env.canvasContextBar) {
          const hasCanvasAction = connectionSelected || n > 0;
          env.canvasContextBar.classList.toggle('open', hasCanvasAction);
          env.canvasContextBar.setAttribute('aria-hidden', hasCanvasAction ? 'false' : 'true');
          const itemsLabel = env.canvasContextBar.querySelector('[data-canvas-selection-items]');
          const connectionLabel = env.canvasContextBar.querySelector('[data-canvas-selection-connection]');
          if (itemsLabel) itemsLabel.hidden = connectionSelected;
          if (connectionLabel) connectionLabel.hidden = !connectionSelected;
          const count = env.canvasContextBar.querySelector('[data-canvas-selection-count]');
          if (count && !connectionSelected) count.textContent = env.t('batchCount', { n });
          const selectedItem = !connectionSelected && n === 1 ? env.canvasItemById([...selection][0]) : null;
          const snapshotButton = env.canvasContextBar.querySelector('[data-canvas-action="snapshot"]');
          const membersButton = env.canvasContextBar.querySelector('[data-canvas-action="members"]');
          const editButton = env.canvasContextBar.querySelector('[data-canvas-action="edit"]');
          const restoreButton = env.canvasContextBar.querySelector('[data-canvas-action="restore"]');
          const pinButton = env.canvasContextBar.querySelector('[data-canvas-action="pin"]');
          const stackButton = env.canvasContextBar.querySelector('[data-canvas-action="stack"]');
          const deleteButton = env.canvasContextBar.querySelector('[data-canvas-action="delete"]');
          const deleteConnectionButton = env.canvasContextBar.querySelector('[data-canvas-action="delete-connection"]');
          if (snapshotButton) snapshotButton.hidden = connectionSelected || selectedItem?.kind !== 'tab';
          if (membersButton) membersButton.hidden = connectionSelected || selectedItem?.kind !== 'group';
          if (editButton) editButton.hidden = connectionSelected || n < 1;
          if (restoreButton) {
            restoreButton.hidden = connectionSelected || (n === 1 && (
              selectedItem?.kind === 'note'
              || (selectedItem?.kind === 'group' && !(selectedItem.tabs || []).length)
            ));
          }
          if (pinButton) pinButton.hidden = connectionSelected;
          if (stackButton) stackButton.hidden = connectionSelected;
          if (deleteButton) deleteButton.hidden = connectionSelected;
          if (deleteConnectionButton) deleteConnectionButton.hidden = !connectionSelected;
        }
        if (env.canvasDropZone) env.canvasDropZone.hidden = connectionSelected || n < 2;
        env.batchBar.classList.remove('open');
        env.batchBar.setAttribute('aria-hidden', 'true');
        return;
      }
      if (env.selectMode && n > 0) {
        env.batchBar.classList.add('open');
        env.batchBar.setAttribute('aria-hidden', 'false');
      } else {
        env.batchBar.classList.remove('open');
        env.batchBar.setAttribute('aria-hidden', 'true');
      }
      if (env.batchRestore) {
        const selectedItems = [...selection].map((id) => env.allTabs.find((item) => item.id === id)).filter(Boolean);
        const restorable = selectedItems.some((item) => (
          (item.kind === 'tab' && item.cardSource !== 'image')
          || (item.kind === 'group' && (item.tabs || []).some((member) => member.cardSource !== 'image'))
        ));
        env.batchRestore.hidden = !restorable;
      }

  }

  function setSelectMode(on) {
    ensureBound('setSelectMode');

      env.selectMode = on;
      document.body.classList.toggle('select-mode', on);
      env.selectModeBtn.classList.toggle('active', on);
      env.selectModeBtn.textContent = on ? env.t('selectModeOn') : env.t('selectMode');
      if (!on) {
        if (env.settings.viewMode === 'canvas') env.ensureCanvasStore()?.setSelection([]);
        else env.selectedIds.clear();
        env.lastAnchorId = null;
      }
      updateBatchBar();
      env.renderGrid();

  }

  function toggleSelect(id) {
    ensureBound('toggleSelect');

      if (env.settings.viewMode === 'canvas') {
        env.ensureCanvasStore()?.toggleSelection(id, true);
        env.lastAnchorId = id;
        return;
      }
      if (env.selectedIds.has(id)) env.selectedIds.delete(id);
      else env.selectedIds.add(id);
      env.lastAnchorId = id;
      updateBatchBar();
      const root = env.settings.viewMode === 'canvas' ? env.canvasNodesEl : env.gridEl;
      const card = root?.querySelector(`[data-id="${id.replace(/"/g, '')}"]`);
      if (card) {
        card.classList.toggle('selected', env.selectedIds.has(id));
        const check = card.querySelector('.card-check');
        if (check) check.checked = env.selectedIds.has(id);
      }

  }

  async function restoreItem(id) {
    ensureBound('restoreItem');

      return env.withUiActionLock(`restore:${id}`, async () => {
        const item = env.allTabs.find((t) => t.id === id);
        if (item?.kind === 'live') {
          const res = await env.sendMessage({ type: 'OPEN_OR_FOCUS_URL', url: item.url });
          if (!res?.ok) env.showCopyToast(env.t('liveOpenFailed'));
          return res;
        }
        if (item?.kind === 'note') {
          env.openStickerNoteEditor(item);
          return { ok: false, error: 'note_not_restorable' };
        }
        if (item?.cardSource === 'image') {
          env.openLightbox(item);
          return { ok: false, error: 'image_not_restorable' };
        }
        if (item?.kind !== 'group' && env.isStoredOnlyUrl(item?.url)) {
          env.showCopyToast(t('restoreRestricted'));
          return { ok: false, error: 'restricted_url' };
        }
        if (item?.kind === 'group') {
          const n = (item.tabs || []).length;
          const title = env.itemTitle(item);
          if (!window.confirm(t('restoreGroupConfirm', { title, n }))) return { ok: false, error: 'cancelled' };
        }
        const type = item?.kind === 'group' ? 'RESTORE_GROUP' : 'RESTORE_TAB';
        const res = await env.sendMessage({ type, id });
        if (res.ok) {
          if (env.expandedId === id) closeLightbox();
          if (env.editingId === id) closeEditBox();
          if (env.membersGroupId === id) closeMembersBox();
          env.renderGrid();
          if (res.skipped) env.showCopyToast(t('restoreSkipped', { n: res.skipped }));
        } else if (res.error === 'restricted_url' || res.error === 'no_restorable_urls') {
          env.showCopyToast(t('restoreRestricted'));
        }
        return res;
      });

  }

  async function deleteItem(id) {
    ensureBound('deleteItem');

      return env.withUiActionLock(`delete:${id}`, async () => {
        const item = env.allTabs.find((candidate) => candidate.id === id);
        const res = item?.kind === 'live'
          ? await env.sendMessage({ type: 'DELETE_PAGE_ANNOTATION', url: item.url, clearInk: true })
          : await env.sendMessage({ type: 'DELETE_ITEM', id });
        if (res.ok) {
          env.allTabs = env.allTabs.filter((t) => t.id !== id);
          if (env.expandedId === id) closeLightbox();
          if (env.editingId === id) closeEditBox();
          env.renderGrid();
        }
        return res;
      });

  }

  function normalizeNotePageLocationRows(result) {
    const byNoteId = new Map();
    if (!result?.ok || !Array.isArray(result.locations)) return byNoteId;
    for (const row of result.locations) {
      const noteId = typeof row?.noteId === 'string' ? row.noteId.trim() : '';
      if (!noteId || !Array.isArray(row.pages)) continue;
      const seen = new Set();
      const pages = [];
      for (const page of row.pages) {
        const url = typeof page?.url === 'string' ? page.url.trim() : '';
        if (!url || seen.has(url)) continue;
        seen.add(url);
        pages.push({
          url,
          title: typeof page.title === 'string' && page.title.trim() ? page.title.trim() : url,
        });
      }
      if (pages.length) byNoteId.set(noteId, pages);
    }
    return byNoteId;
  }

  function attachNotePageLocations(items, result) {
    const byNoteId = normalizeNotePageLocationRows(result);
    return (items || []).map((item) => item?.kind === 'note'
      ? { ...item, pageLocations: byNoteId.get(item.id) || [] }
      : item);
  }

  async function openCanvasNoteSources(item) {
    ensureBound('openCanvasNoteSources');
    if (!item || item.kind !== 'note' || env.isMediaLocked?.(item)) return;
    const pages = Array.isArray(item.pageLocations) ? item.pageLocations : [];
    if (!pages.length) return;
    if (!env.canvasNoteSourcesDialog || !env.canvasNoteSourcesList) return;
    const openPage = async (url) => {
      const result = await env.sendMessage({ type: 'OPEN_NEW_TAB_URL', url });
      if (!result?.ok) env.showCopyToast(env.t('notePageSourceOpenFailed'));
      return result;
    };
    if (pages.length === 1) {
      await openPage(pages[0].url);
      return;
    }
    closeAllFloatsExcept('canvasNoteSources');
    if (env.canvasNoteSourcesTitle) env.canvasNoteSourcesTitle.textContent = env.t('notePageSources');
    if (env.canvasNoteSourcesHint) env.canvasNoteSourcesHint.textContent = env.t('notePageSourcesCount', { n: pages.length });
    env.canvasNoteSourcesList.innerHTML = pages.map((page) => {
      const title = page.title || page.url;
      const domain = domainOf(page.url) || page.url;
      return `<button type="button" class="canvas-note-source-row" data-note-page-url="${escapeAttr(page.url)}">
        <span class="canvas-note-source-row-title">${escapeHtml(title)}</span>
        <span class="canvas-note-source-row-url">${escapeHtml(domain)}</span>
      </button>`;
    }).join('');
    env.canvasNoteSourcesList.querySelectorAll('[data-note-page-url]').forEach((button) => {
      button.addEventListener('click', async () => {
        const result = await openPage(button.dataset.notePageUrl || '');
        if (result?.ok) closeCanvasNoteSources();
      });
    });
    env.canvasNoteSourcesDialog.classList.add('open');
    env.canvasNoteSourcesDialog.setAttribute('aria-hidden', 'false');
    env.syncFloatBackdrop();
    env.canvasNoteSourcesClose?.focus({ preventScroll: true });
  }

  function closeCanvasNoteSources(sync = true) {
    ensureBound('closeCanvasNoteSources');
    env.canvasNoteSourcesDialog?.classList.remove('open');
    env.canvasNoteSourcesDialog?.setAttribute('aria-hidden', 'true');
    if (env.canvasNoteSourcesList) env.canvasNoteSourcesList.innerHTML = '';
    if (sync) env.syncFloatBackdrop();
  }

  async function loadList() {
    ensureBound('loadList');
    env.closeTagSuggest?.();

    const previousItems = env.allTabs;
    const previousCanvasSessionFallback = env.canvasSessionFallback;
    const previousCanvasNeedsInitialCenter = env.canvasNeedsInitialCenter;
    const renderExistingListSafely = () => {
      if (!Array.isArray(env.allTabs) || env.allTabs.length === 0) return;
      if (env.settings.viewMode === 'canvas' && !env.canvasSessionFallback) return;
      try {
        env.renderGrid();
      } catch (err) {
        env.uiLog('warn', 'load', 'existing items render failed', err?.message || err);
      }
    };

    try {
      const generation = ++env.canvasLoadGeneration;
      const [itemsResult, layoutResult, liveResult, locationsResult] = await Promise.allSettled([
        env.sendMessage({ type: 'GET_PARKED_ITEMS' }),
        env.sendMessage({ type: 'GET_CANVAS_LAYOUT' }),
        env.sendMessage({ type: 'LIST_PAGE_ANNOTATIONS' }),
        env.sendMessage({ type: 'GET_NOTE_PAGE_LOCATIONS' }),
      ]);
      if (generation !== env.canvasLoadGeneration) return false;

      const res = itemsResult.status === 'fulfilled' ? itemsResult.value : null;
      const layoutRes = layoutResult.status === 'fulfilled' ? layoutResult.value : null;
      const itemsError = itemsResult.status === 'rejected'
        ? itemsResult.reason?.message || String(itemsResult.reason)
        : res?.error || 'invalid_response';
      if (!res?.ok || (!Array.isArray(res.items) && !Array.isArray(res.tabs))) {
        if (env.loadStatusEl) env.loadStatusEl.textContent = env.t('loadFailed');
        env.uiLog('error', 'load', 'parked items unavailable', itemsError);
        renderExistingListSafely();
        return false;
      }
      const raw =
        Array.isArray(res.items)
          ? res.items
          : Array.isArray(res.tabs)
            ? res.tabs
            : [];
      const liveRaw = liveResult.status === 'fulfilled' && liveResult.value?.ok && Array.isArray(liveResult.value.items)
        ? liveResult.value.items
        : [];
      const locationsResponse = locationsResult.status === 'fulfilled' ? locationsResult.value : null;
      const parkedItems = attachNotePageLocations(env.normalizeParkedList(raw), locationsResponse);
      const liveItems = liveRaw.length ? env.normalizeParkedList(liveRaw) : [];
      const nextItems = liveItems.length ? [...liveItems, ...parkedItems] : parkedItems;
      if (!Array.isArray(nextItems)) throw new Error('invalid_normalized_items');
      env.markTagSuggestIndexDirty();
      env.invalidateTagSuggest?.();
      env.pruneAttachmentUrlCache(nextItems);
      env.allTabs = nextItems;
      if (env.loadStatusEl) env.loadStatusEl.textContent = '';

      const layoutAvailable = Boolean(layoutRes?.ok);
      const shouldFallbackCanvas = !layoutAvailable && env.settings.viewMode === 'canvas';
      if (shouldFallbackCanvas) {
        // Keep pending CanvasStore operations while making the list the safe
        // presentation when the optional remote layout is unavailable.
        env.canvasSessionFallback = true;
        env.canvasNeedsInitialCenter = false;
      }

      let layoutSyncError = null;
      try {
        const store = env.ensureCanvasStore();
        const current = store?.getState?.();
        if (store && (current?.pendingOperations?.length || current?.interaction)) {
          env.canvasNeedsInitialCenter = false;
          store.setItems(env.allTabs);
          if (layoutAvailable) store.applyRemote(layoutRes.layout, layoutRes.revision);
        } else if (store) {
          store.hydrate(
            env.allTabs,
            layoutAvailable ? layoutRes.layout : env.canvasLayout,
            layoutAvailable ? layoutRes.revision : current?.revision || 0,
          );
          env.canvasNeedsInitialCenter = Boolean(layoutAvailable && layoutRes.needsInitialCenter);
        }
      } catch (err) {
        layoutSyncError = err;
        env.uiLog('warn', 'canvas', 'layout sync failed', err?.message || err);
      }

      if ((shouldFallbackCanvas || layoutSyncError) && env.settings.viewMode === 'canvas') {
        env.canvasSessionFallback = true;
        env.canvasNeedsInitialCenter = false;
        env.applyViewMode('list');
        env.renderGrid();
        env.uiLog(
          'warn',
          'canvas',
          'layout unavailable',
          layoutRes?.error || (layoutResult.status === 'rejected' ? layoutResult.reason?.message : null) || 'invalid_response',
        );
        return false;
      }

      env.canvasSessionFallback = false;
      env.applyViewMode(env.settings.viewMode);
      env.renderCanvasStackIndex();
      env.renderGrid();
      env.scheduleInitialCanvasCenter();
      return true;
    } catch (err) {
      env.allTabs = previousItems;
      env.canvasSessionFallback = previousCanvasSessionFallback;
      env.canvasNeedsInitialCenter = previousCanvasNeedsInitialCenter;
      if (env.loadStatusEl) env.loadStatusEl.textContent = env.t('loadFailed');
      env.uiLog('error', 'load', 'loadList failed', err?.message || err);
      renderExistingListSafely();
      return false;
    }
  }

  function initConflictUi() {
    ensureBound('initConflictUi');

      if (!env.conflictModal) return;
      env.conflictCancel?.addEventListener('click', () => resolveConflict('cancel'));
      env.conflictReplace?.addEventListener('click', () => resolveConflict('replace'));
      env.conflictKeepBoth?.addEventListener('click', () => resolveConflict('keep-both'));
      env.conflictModal.addEventListener('click', (e) => {
        if (e.target === env.conflictModal) resolveConflict('cancel');
      });

  }

  function openConflictModal(conflict) {
    ensureBound('openConflictModal');

      if (!env.conflictModal || !conflict) return;
      env.conflictIncomingTitle.textContent = conflict.title || conflict.url || '—';
      env.conflictIncomingUrl.textContent = conflict.url || '—';
      env.conflictMatchList.innerHTML = '';
      const matches = Array.isArray(conflict.matches) ? conflict.matches : [];
      for (const m of matches) {
        const li = document.createElement('li');
        appendDedupeThumb(li, m);
        const body = document.createElement('div');
        body.className = 'di-body';
        body.innerHTML = `
          <div class="di-title">${escapeHtml(m.title || m.url || '—')}</div>
          <div class="di-meta">${escapeHtml(t('dedupeSavedAt', { t: formatSavedAt(m.savedAt) }))}</div>
        `;
        li.appendChild(body);
        appendDedupePreviewBtn(li, m);
        env.conflictMatchList.appendChild(li);
      }
      env.conflictModal.classList.add('open');
      env.conflictModal.setAttribute('aria-hidden', 'false');

  }

  function closeConflictModal() {
    ensureBound('closeConflictModal');

      if (!env.conflictModal) return;
      env.conflictModal.classList.remove('open');
      env.conflictModal.setAttribute('aria-hidden', 'true');

  }

  async function resolveConflict(decision) {
    ensureBound('resolveConflict');

      closeConflictModal();
      const res = await env.sendMessage({ type: 'RESOLVE_SAVE_CONFLICT', decision });
      if (decision !== 'cancel') {
        await loadList();
      }
      if (res && !res.ok && res.error === 'no_pending') {
        // expired — ignore
      }

  }

  function openPreSaveModal(preSave) {
    ensureBound('openPreSaveModal');

      if (!env.preSaveModal || !preSave) return;
      env.preSaveContext = preSave;
      env.preSaveTitle.textContent = preSave.title || preSave.url || '—';
      env.preSaveUrl.textContent = preSave.url || '—';
      env.preSaveNote.value = preSave.note || '';
      env.preSaveTagList = Array.isArray(preSave.tags) ? [...preSave.tags] : [];
      if (env.preSaveTagDraft) env.preSaveTagDraft.value = '';
      renderPreSaveChips();
      if (env.preSaveError) env.preSaveError.textContent = '';
      if (env.preSaveConfirm) {
        env.preSaveConfirm.disabled = false;
        env.preSaveConfirm.textContent = env.t(preSave.afterSave === 'close' ? 'presaveSaveAndClose' : 'presaveSaveKeep');
      }
      if (env.preSaveCancel) env.preSaveCancel.disabled = false;
      env.preSaveModal.classList.add('open');
      env.preSaveModal.setAttribute('aria-hidden', 'false');
      setTimeout(() => env.preSaveNote.focus(), 0);

  }

  function closePreSaveModal() {
    ensureBound('closePreSaveModal');

      if (!env.preSaveModal) return;
      env.closeTagSuggest?.();
      env.preSaveModal.classList.remove('open');
      env.preSaveModal.setAttribute('aria-hidden', 'true');
      env.preSaveContext = null;
      env.preSaveTagList = [];

  }

  async function confirmPreSave() {
    ensureBound('confirmPreSave');

      if (!env.preSaveContext) return;
      commitPreSaveTagDraft();
      const note = env.preSaveNote.value;
      const tags = [...env.preSaveTagList];
      if (env.preSaveConfirm) env.preSaveConfirm.disabled = true;
      if (env.preSaveCancel) env.preSaveCancel.disabled = true;
      if (env.preSaveError) env.preSaveError.textContent = '';
      // Inside the content-script overlay, the host hides the overlay before
      // capturing the screenshot then destroys it on success — closePreSaveModal()
      // isn't called here so the modal stays visible (with a usable error state)
      // if the save fails.
      if (env.postToParent({ type: 'TABWALL_PRESAVE_COMMIT', note, tags })) return;
      // Standalone fallback (no host overlay to hide) — resolve directly.
      const res = await env.sendMessage({ type: 'RESOLVE_PRESAVE_EDIT', decision: 'save', note, tags });
      if (res?.ok) {
        closePreSaveModal();
        await loadList();
        return;
      }
      if (env.preSaveConfirm) env.preSaveConfirm.disabled = false;
      if (env.preSaveCancel) env.preSaveCancel.disabled = false;
      if (env.preSaveError) env.preSaveError.textContent = env.t('presaveFailed');

  }

  function cancelPreSave() {
    ensureBound('cancelPreSave');

      closePreSaveModal();
      if (!env.postToParent({ type: 'TABWALL_PRESAVE_CANCEL' })) {
        env.sendMessage({ type: 'RESOLVE_PRESAVE_EDIT', decision: 'cancel' });
      }

  }

  function initPreSaveUi() {
    ensureBound('initPreSaveUi');

      if (!env.preSaveModal) return;
      env.preSaveCancel?.addEventListener('click', () => cancelPreSave());
      env.preSaveConfirm?.addEventListener('click', () => confirmPreSave());
      env.preSaveModal.addEventListener('click', (e) => {
        if (e.target === env.preSaveModal) cancelPreSave();
      });
      env.preSaveTagDraft?.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' || e.key === 'Enter') {
          if (env.preSaveTagDraft.value.trim()) {
            e.preventDefault();
            commitPreSaveTagDraft();
          }
          if (e.key === 'Enter') e.preventDefault();
          return;
        }
        if (e.key === 'Backspace' && !env.preSaveTagDraft.value && env.preSaveTagList.length) {
          e.preventDefault();
          env.preSaveTagList.pop();
          renderPreSaveChips();
        }
      });

  }

  function renderPreSaveChips() {
    ensureBound('renderPreSaveChips');

      if (!env.preSaveChips) return;
      env.preSaveChips.innerHTML = '';
      env.preSaveTagList.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = `${escapeHtml(tag)} <button type="button" aria-label="remove">${iconSvg('close')}</button>`;
        chip.querySelector('button').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = env.preSaveTagList.indexOf(tag);
          if (currentIndex === -1) return;
          env.preSaveTagList.splice(currentIndex, 1);
          renderPreSaveChips();
        });
        env.preSaveChips.appendChild(chip);
      });

  }

  function commitPreSaveTagDraft() {
    ensureBound('commitPreSaveTagDraft');

      if (!env.preSaveTagDraft) return false;
      const raw = env.preSaveTagDraft.value.trim();
      if (!raw) return false;
      if (!env.preSaveTagList.includes(raw)) env.preSaveTagList.push(raw);
      env.preSaveTagDraft.value = '';
      renderPreSaveChips();
      env.sendMessage({ type: 'ADD_TAG', name: raw }).then(() => {
        env.invalidateTagSuggest?.();
        if (env.tagsBox.classList.contains('open')) refreshTagManager();
      });
      return true;

  }

  function appendDedupeThumb(parent, item) {
    ensureBound('appendDedupeThumb');

      const mediaKey = env.mediaKeyForItem({ id: item.id, kind: 'tab' });
      if (item.hasThumb || item.hasSnap) {
        const img = document.createElement('img');
        img.className = 'dedupe-thumb lazy-thumb';
        img.alt = '';
        img.draggable = false;
        img.dataset.mediaKey = mediaKey;
        parent.appendChild(img);
        env.observeThumb(img);
      } else {
        const ph = document.createElement('span');
        ph.className = 'dedupe-thumb placeholder';
        ph.setAttribute('aria-hidden', 'true');
        parent.appendChild(ph);
      }

  }

  function appendDedupePreviewBtn(parent, item) {
    ensureBound('appendDedupePreviewBtn');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn dedupe-preview-btn';
      btn.title = env.t('expand');
      btn.setAttribute('aria-label', env.t('expand'));
      btn.innerHTML = env.iconSvg('expand');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLightbox({
          kind: 'tab',
          id: item.id,
          title: item.title || item.url || 'Untitled',
          url: item.url || '',
          hasThumb: Boolean(item.hasThumb),
          hasSnap: Boolean(item.hasSnap),
          savedAt: item.savedAt || 0,
        });
      });
      parent.appendChild(btn);

  }

  function renderEditChips() {
    ensureBound('renderEditChips');

      env.editChips.innerHTML = '';
      env.editTagList.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = `${escapeHtml(tag)} <button type="button" aria-label="remove">${iconSvg('close')}</button>`;
        chip.querySelector('button').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = env.editTagList.indexOf(tag);
          if (currentIndex === -1) return;
          env.editTagList.splice(currentIndex, 1);
          renderEditChips();
        });
        env.editChips.appendChild(chip);
      });

  }

  function commitTagDraft() {
    ensureBound('commitTagDraft');

      const raw = env.editTagDraft.value.trim();
      if (!raw) return false;
      if (!env.editTagList.includes(raw)) env.editTagList.push(raw);
      env.editTagDraft.value = '';
      renderEditChips();
      // ensure catalog knows this tag
      env.sendMessage({ type: 'ADD_TAG', name: raw }).then(() => {
        env.invalidateTagSuggest?.();
        if (env.tagsBox.classList.contains('open')) refreshTagManager();
      });
      return true;

  }

  function openBatchEdit(ids) {
    ensureBound('openBatchEdit');

      const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
      if (!list.length) return;
      env.editingId = 'batch';
      env.editContext = { type: 'batch', ids: list };
      env.editHeading.textContent = env.t('batchEditHeading');
      env.editItemTitle.textContent = env.t('batchCount', { n: list.length });
      env.editSub.textContent = env.t('batchEditSub');
      fillEditTitleLockFields(null, { hidden: true });
      env.editNote.value = '';
      env.editTagList = [];
      env.editTagDraft.value = '';
      renderEditChips();
      env.editBox.classList.add('open');
      env.editBox.setAttribute('aria-hidden', 'false');
      placeEditBoxCentered();
      syncFloatBackdrop();
      setTimeout(() => env.editNote.focus(), 0);

  }

  function openEditBox(item) {
    ensureBound('openEditBox');

      env.editingId = item.id;
      env.editContext = {
        type: 'item',
        hasPassword: Boolean(item.lockHash),
        originalTitle: item.title || '',
      };
      env.editHeading.textContent = env.t('editHeading');
      env.editItemTitle.textContent = env.itemTitle(item);
      env.editSub.textContent =
        item.kind === 'group'
          ? env.t('groupTabs', { n: (item.tabs || []).length })
          : item.url || '';
      fillEditTitleLockFields(item, { hidden: item.kind === 'live' });
      env.editNote.value = item.note || '';
      env.editTagList = Array.isArray(item.tags) ? [...item.tags] : [];
      env.editTagDraft.value = '';
      renderEditChips();
      env.editBox.classList.add('open');
      env.editBox.setAttribute('aria-hidden', 'false');
      placeEditBoxCentered();
      syncFloatBackdrop();
      setTimeout(() => env.editNote.focus(), 0);

  }

  function closeEditBox() {
    ensureBound('closeEditBox');

      env.closeTagSuggest?.();
      env.editingId = null;
      env.editContext = null;
      env.editTagList = [];
      env.editBox.classList.remove('open');
      env.editBox.setAttribute('aria-hidden', 'true');
      syncFloatBackdrop();

  }

  function lightboxLockSource(entry) {
    if (entry?.lockItem && env.isMediaLocked?.(entry.lockItem)) return entry.lockItem;
    if (entry?.groupLockItem && env.isMediaLocked?.(entry.groupLockItem)) return entry.groupLockItem;
    return null;
  }

  function fillEditTitleLockFields(item, { hidden = false } = {}) {
    const titleLabel = env.editDisplayTitle?.closest('label');
    const lockToggle = env.editLockEnabled?.closest('label');
    if (titleLabel) titleLabel.hidden = hidden;
    if (lockToggle) lockToggle.hidden = hidden;
    if (env.editDisplayTitle) {
      env.editDisplayTitle.value = hidden ? '' : (item?.displayTitle || '');
    }
    if (env.editOriginalTitle) {
      const original = hidden ? '' : (item?.title || '');
      env.editOriginalTitle.hidden = hidden || !original;
      env.editOriginalTitle.textContent = original
        ? `${env.t('editOriginalTitle')}：${original}`
        : '';
    }
    if (env.editLockEnabled) env.editLockEnabled.checked = Boolean(!hidden && item?.locked);
    if (env.editHideOriginalTitle) {
      env.editHideOriginalTitle.checked = Boolean(
        !hidden && item?.locked && item?.displayTitle && item?.hideOriginalTitle
      );
    }
    if (env.editLockPassword) env.editLockPassword.value = '';
    if (env.editLockPasswordConfirm) env.editLockPasswordConfirm.value = '';
    syncEditLockFields();
    if (hidden && env.editLockFields) env.editLockFields.hidden = true;
  }

  function syncEditLockFields() {
    if (!env.editLockFields || !env.editLockEnabled) return;
    const locked = Boolean(env.editLockEnabled.checked);
    const displayTitle = String(env.editDisplayTitle?.value || '').trim();
    const originalTitle = String(env.editContext?.originalTitle || '').trim();
    const hasCustomDisplayTitle = Boolean(displayTitle && displayTitle !== originalTitle);
    env.editLockFields.hidden = !locked;
    if (env.editHideOriginalTitle) {
      const canHide = locked && hasCustomDisplayTitle;
      env.editHideOriginalTitle.disabled = !canHide;
      if (!canHide) env.editHideOriginalTitle.checked = false;
    }
  }

  function finishUnlockDialog(ok) {
    const waiter = env.unlockWaiter;
    env.unlockWaiter = null;
    if (env.unlockBox) {
      env.unlockBox.classList.remove('open');
      env.unlockBox.setAttribute('aria-hidden', 'true');
    }
    if (env.unlockPassword) env.unlockPassword.value = '';
    if (env.unlockError) {
      env.unlockError.hidden = true;
      env.unlockError.textContent = '';
    }
    syncFloatBackdrop();
    waiter?.resolve?.(Boolean(ok));
  }

  function closeUnlockDialog() {
    ensureBound('closeUnlockDialog');
    finishUnlockDialog(false);
  }

  function openUnlockDialog(item) {
    ensureBound('openUnlockDialog');
    if (!env.unlockBox) return Promise.resolve(false);
    if (env.unlockWaiter) finishUnlockDialog(false);
    env.unlockContext = item;
    return new Promise((resolve) => {
      env.unlockWaiter = { resolve };
      if (env.unlockError) {
        env.unlockError.hidden = true;
        env.unlockError.textContent = '';
      }
      if (env.unlockPassword) env.unlockPassword.value = '';
      env.unlockBox.classList.add('open');
      env.unlockBox.setAttribute('aria-hidden', 'false');
      syncFloatBackdrop();
      setTimeout(() => env.unlockPassword?.focus(), 0);
    });
  }

  async function submitUnlockDialog() {
    ensureBound('submitUnlockDialog');
    const item = env.unlockContext;
    if (!item) return finishUnlockDialog(false);
    const ok = await env.verifyLockPassword?.(
      env.unlockPassword?.value || '',
      item.lockSalt || '',
      item.lockHash || ''
    );
    if (!ok) {
      if (env.unlockError) {
        env.unlockError.hidden = false;
        env.unlockError.textContent = env.t('unlockFailed');
      }
      return;
    }
    env.sessionUnlockedIds.add(item.id);
    finishUnlockDialog(true);
    env.renderGrid?.();
    if (env.lightbox?.classList.contains('open') && env.lightboxNav) {
      const { list, index } = env.lightboxNav;
      showLightboxEntry(list[index], index, list);
    }
  }

  async function requestUnlockItem(item) {
    ensureBound('requestUnlockItem');
    if (!item?.locked) return true;
    if (env.sessionUnlockedIds.has(item.id)) return true;
    if (!item.lockHash) {
      env.sessionUnlockedIds.add(item.id);
      env.renderGrid?.();
      if (env.lightbox?.classList.contains('open') && env.lightboxNav) {
        const { list, index } = env.lightboxNav;
        showLightboxEntry(list[index], index, list);
      }
      return true;
    }
    return openUnlockDialog(item);
  }

  async function persistItemLock(item, patch) {
    if (item.kind === 'note') {
      return env.sendMessage({
        type: 'UPDATE_NOTE',
        noteId: item.id,
        patch,
      });
    }
    return env.sendMessage({
      type: 'UPDATE_ITEM',
      id: item.id,
      ...patch,
    });
  }

  async function toggleCardLock(item) {
    ensureBound('toggleCardLock');
    if (!item) return;
    if (!item.locked) {
      const res = await persistItemLock(item, { locked: true, lockSalt: '', lockHash: '' });
      if (res?.ok) {
        item.locked = true;
        delete item.lockSalt;
        delete item.lockHash;
        const updated = res.item || res.tab || item;
        const idx = env.allTabs.findIndex((candidate) => candidate.id === item.id);
        if (idx !== -1) env.allTabs[idx] = { ...env.allTabs[idx], ...updated, locked: true };
        env.renderGrid?.();
      }
      return;
    }
    if (env.isMediaLocked(item)) {
      await requestUnlockItem(item);
      return;
    }
    env.sessionUnlockedIds.delete(item.id);
    env.renderGrid?.();
  }

  function openMemberEditBox(groupId, member) {
    ensureBound('openMemberEditBox');

      env.editingId = member.id;
      env.editContext = {
        type: 'member',
        groupId,
        memberId: member.id,
        hasPassword: Boolean(member.lockHash),
        originalTitle: member.title || '',
      };
      env.editHeading.textContent = env.t('editMemberHeading');
      env.editItemTitle.textContent = itemTitle(member);
      env.editSub.textContent = member.url || '';
      fillEditTitleLockFields(member);
      env.editNote.value = member.note || '';
      env.editTagList = Array.isArray(member.tags) ? [...member.tags] : [];
      env.editTagDraft.value = '';
      renderEditChips();
      env.editBox.classList.add('open');
      env.editBox.setAttribute('aria-hidden', 'false');
      placeEditBoxCentered();
      syncFloatBackdrop();
      setTimeout(() => env.editNote.focus(), 0);

  }

  function placeEditBoxCentered() {
    ensureBound('placeEditBoxCentered');

      const w = env.editBox.offsetWidth || 400;
      const h = env.editBox.offsetHeight || 320;
      env.editBox.style.left = `${Math.max(16, Math.round((window.innerWidth - w) / 2))}px`;
      env.editBox.style.top = `${Math.max(16, Math.round((window.innerHeight - h) / 2))}px`;

  }

  function setupFloatDrag(handle, box) {
    ensureBound('setupFloatDrag');

      if (!handle || !box) return;
      if (box.matches('#settingsBox, #tagsBox, #helpBox, #dedupeBox, #remindersBox')) return;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let origLeft = 0;
      let origTop = 0;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = box.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        box.style.left = `${Math.min(window.innerWidth - box.offsetWidth - 8, Math.max(8, origLeft + e.clientX - startX))}px`;
        box.style.top = `${Math.min(window.innerHeight - 40, Math.max(8, origTop + e.clientY - startY))}px`;
      });
      const end = (e) => {
        if (!dragging) return;
        dragging = false;
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);

  }

  function anyFloatOpen() {
    ensureBound('anyFloatOpen');

      return (
        env.settingsBox.classList.contains('open') ||
        env.tagsBox.classList.contains('open') ||
        (env.aiBox && env.aiBox.classList.contains('open')) ||
        env.helpBox.classList.contains('open') ||
        env.editBox.classList.contains('open') ||
        (env.unlockBox && env.unlockBox.classList.contains('open')) ||
        env.membersBox.classList.contains('open') ||
        (env.stickerNoteBox && env.stickerNoteBox.classList.contains('open')) ||
        (env.dedupeBox && env.dedupeBox.classList.contains('open')) ||
        (env.remindersBox && env.remindersBox.classList.contains('open')) ||
        (env.importPickBox && env.importPickBox.classList.contains('open')) ||
        (env.canvasStackDialog && env.canvasStackDialog.classList.contains('open')) ||
        (env.canvasNoteSourcesDialog && env.canvasNoteSourcesDialog.classList.contains('open'))
      );

  }

  function syncFloatBackdrop() {
    ensureBound('syncFloatBackdrop');

      if (anyFloatOpen()) {
        env.floatBackdrop.classList.add('open');
        env.floatBackdrop.setAttribute('aria-hidden', 'false');
      } else {
        env.floatBackdrop.classList.remove('open');
        env.floatBackdrop.setAttribute('aria-hidden', 'true');
      }

  }

  function closeAllFloatsExcept(except) {
    ensureBound('closeAllFloatsExcept');

      if (except !== 'settings') env.closeSettingsBox(false);
      if (except !== 'tags') closeTagsBox(false);
      if (except !== 'ai') env.closeAiBox?.(false);
      if (except !== 'help') closeHelpBox(false);
      if (except !== 'edit') closeEditBox();
      if (except !== 'unlock') closeUnlockDialog();
      if (except !== 'members') closeMembersBox();
      if (except !== 'stickerNote') env.closeStickerNoteEditor();
      if (except !== 'dedupe') closeDedupeBox(false);
      if (except !== 'reminders') env.closeRemindersBox?.();
      if (except !== 'importPick') env.closeImportPickBox(false);
      if (except !== 'canvasStack') env.closeCanvasStackDialog();
      if (except !== 'canvasNoteSources') closeCanvasNoteSources(false);
      syncFloatBackdrop();

  }

  function placeFloatBox(el) {
    ensureBound('placeFloatBox');

      const w = el.offsetWidth || 440;
      const h = el.offsetHeight || 360;
      el.style.left = `${Math.max(16, Math.round((window.innerWidth - w) / 2))}px`;
      el.style.top = `${Math.max(16, Math.round((window.innerHeight - h) / 2))}px`;

  }

  async function openTagsBox() {
    ensureBound('openTagsBox');

      closeAllFloatsExcept('tags');
      env.tagsBox.classList.add('open');
      env.tagsBox.setAttribute('aria-hidden', 'false');
      env.tagsBtn.classList.add('active');
      positionTagsBoxUnderButton();
      syncFloatBackdrop();
      await refreshTagManager();
      env.tagSearch.focus();

  }

  function closeTagsBox(sync = true) {
    ensureBound('closeTagsBox');

      env.tagsBox.classList.remove('open');
      env.tagsBox.setAttribute('aria-hidden', 'true');
      env.tagsBtn.classList.remove('active');
      if (sync) syncFloatBackdrop();

  }

  function openHelpBox() {
    ensureBound('openHelpBox');

      closeAllFloatsExcept('help');
      env.helpBox.classList.add('open');
      env.helpBox.setAttribute('aria-hidden', 'false');
      env.helpBtn.classList.add('active');
      syncFloatBackdrop();

  }

  function closeHelpBox(sync = true) {
    ensureBound('closeHelpBox');

      env.helpBox.classList.remove('open');
      env.helpBox.setAttribute('aria-hidden', 'true');
      env.helpBtn.classList.remove('active');
      if (sync) syncFloatBackdrop();

  }

  function positionTagsBoxUnderButton() {
    ensureBound('positionTagsBoxUnderButton');

      if (!env.tagsBtn || !env.tagsBox) return;
      const rect = env.tagsBtn.getBoundingClientRect();
      const w = env.tagsBox.offsetWidth || 360;
      const h = env.tagsBox.offsetHeight || 420;
      const left = Math.min(window.innerWidth - w - 8, Math.max(8, Math.round(rect.right - w)));
      const top = Math.min(window.innerHeight - h - 8, Math.max(8, Math.round(rect.bottom + 8)));
      env.tagsBox.style.left = `${left}px`;
      env.tagsBox.style.top = `${top}px`;
      env.tagsBox.style.right = 'auto';
      env.tagsBox.style.bottom = 'auto';
      env.tagsBox.style.transform = 'none';

  }

  function parseImageCardPosition(raw) {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object') return null;
      const x = Number(value.x);
      const y = Number(value.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y, w: Number(value.w) || undefined, h: Number(value.h) || undefined };
    } catch {
      return null;
    }
  }

  function collectImageFiles(fileList, extraItems) {
    ensureBound('collectImageFiles');
    const files = [];
    const seen = new Set();
    const add = (file) => {
      if (!file || seen.has(file)) return;
      if (!env.NoteMedia?.identifyImageKind?.(file, file.name)) return;
      seen.add(file);
      files.push(file);
    };
    for (const file of fileList || []) add(file);
    for (const item of extraItems || []) {
      if (item?.kind === 'file' && env.NoteMedia?.identifyImageKind?.({ type: item.type }, '')) {
        add(item.getAsFile?.());
      }
    }
    return files;
  }

  function pickImageCardFiles(position = null) {
    ensureBound('pickImageCardFiles');
    const input = env.imageCardFile || global.document?.getElementById?.('imageCardFile');
    if (!input) return;
    input.value = '';
    input.dataset.position = position ? JSON.stringify({
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
    }) : '';
    input.click();
  }

  async function createImageCardsFromFiles(files, position = null) {
    ensureBound('createImageCardsFromFiles');
    const list = collectImageFiles(files);
    if (!list.length) {
      env.showCopyToast(env.t('noteImageUnsupportedType'));
      return { ok: false, added: 0 };
    }
    const maxFiles = env.NoteMedia?.LIMITS?.MAX_CARD_FILES || 8;
    if (list.length > maxFiles) {
      env.showCopyToast(env.t('imageCardTooMany'));
      return { ok: false, added: 0 };
    }
    env.showCopyToast(env.t('imageCardProcessing'));
    let added = 0;
    let lastError = '';
    for (let index = 0; index < list.length; index++) {
      const file = list[index];
      try {
        if (!env.NoteMedia?.normalizeCardMedia) throw new Error('note_media_unavailable');
        const media = await env.NoteMedia.normalizeCardMedia(file, { name: file.name });
        const thumb = await env.Media.blobToDataUrl(media.thumbBlob);
        const snap = await env.Media.blobToDataUrl(media.snapBlob);
        const nextPosition = position && typeof position === 'object'
          ? { ...position, x: Number(position.x) + index * 28, y: Number(position.y) + index * 28 }
          : null;
        const res = await env.sendMessage({
          type: 'CREATE_IMAGE_CARD',
          title: media.title || env.t('imageCardUntitled'),
          position: nextPosition,
          thumbnail: thumb,
          snapshot: snap,
        });
        if (res?.ok) added++;
        else lastError = res?.error || 'imageCardFailed';
      } catch (err) {
        lastError = err;
      }
    }
    if (added) await env.loadList();
    if (added) env.showCopyToast(env.t('imageCardOk', { n: added }));
    else env.showCopyToast(env.formatNoteMediaError(lastError) || env.t('imageCardFailed'));
    return { ok: added > 0, added };
  }

  function initQuickCaptureUi() {
    ensureBound('initQuickCaptureUi');

      env.syncQuickCaptureAvailability();
      env.quickAddBtn?.addEventListener('click', () => requestQuickCapture('tab'));
      env.quickAddTabMenu?.addEventListener('click', () => requestQuickCapture('tab'));
      env.quickAddGroupMenu?.addEventListener('click', () => requestQuickCapture('group'));
      env.quickAddUrlMenu?.addEventListener('click', () => requestQuickCapture('url'));
      env.quickAddImageMenu?.addEventListener('click', (event) => {
        event.stopPropagation();
        env.closeQuickMenus?.();
        pickImageCardFiles();
      });
      const imageCardFile = env.imageCardFile || global.document?.getElementById?.('imageCardFile');
      imageCardFile?.addEventListener('change', () => {
        const position = parseImageCardPosition(imageCardFile.dataset.position);
        imageCardFile.dataset.position = '';
        createImageCardsFromFiles(imageCardFile.files, position);
        imageCardFile.value = '';
      });
      env.canvasOrganizeBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = Boolean(env.canvasOrganizePanel && env.canvasOrganizePanel.hidden);
        env.toggleHeaderPopover(env.canvasOrganizeBtn, env.canvasOrganizePanel, open);
      });
      env.manualAddTopBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = Boolean(env.manualAddPanel && env.manualAddPanel.hidden);
        env.toggleHeaderPopover(env.manualAddTopBtn, env.manualAddPanel, open);
      });
      env.quickAddMenuBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = Boolean(env.quickAddMenu && env.quickAddMenu.hidden);
        env.closeQuickMenus();
        if (env.quickAddMenu && open) {
          env.quickAddMenu.hidden = false;
          env.quickAddMenuBtn.setAttribute('aria-expanded', 'true');
        }
      });
      env.moreToolsBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = Boolean(env.moreToolsMenu && env.moreToolsMenu.hidden);
        env.closeQuickMenus();
        if (env.moreToolsMenu && open) {
          env.moreToolsMenu.hidden = false;
          env.moreToolsBtn.setAttribute('aria-expanded', 'true');
        }
      });
      document.addEventListener('pointerdown', (event) => {
        if (!event.target.closest?.('#quickAddWrap, #moreToolsMenu, #moreToolsBtn, #canvasOrganizeWrap, #manualAddWrap')) {
          env.closeQuickMenus();
        }
      });

  }

  async function requestQuickCapture(kind) {
    ensureBound('requestQuickCapture');

      env.closeQuickMenus();
      if (kind === 'url') {
        env.openManualAddPanel();
        return;
      }
      if (kind === 'tab' && !env.PARENT_ORIGIN) {
        env.showCopyToast(env.t('quickAddSelf'));
        return;
      }
      if (kind === 'tab' && env.PARENT_ORIGIN) {
        if (!env.postToParent({ type: 'TABWALL_SAVE_ACTIVE' })) {
          env.showCopyToast(env.t('quickAddNoTarget'));
        }
        return;
      }
      const result = await env.sendMessage({ type: 'SAVE_ACTIVE_GROUP' });
      await handleQuickCaptureResult(result);

  }

  async function handleQuickCaptureResult(result) {
    ensureBound('handleQuickCaptureResult');

      if (!result) return;
      if (!result.ok) {
        env.showCopyToast(quickCaptureErrorText(result.error));
        return;
      }
      if (result.presave) {
        // Pre-save edit panel is about to open in this same overlay — nothing saved yet.
        return;
      }
      if (result.conflict) {
        env.showCopyToast(env.t('quickAddSaved'));
        return;
      }
      env.showCopyToast(result.tabCount ? env.t('quickAddGroupSaved') : env.t('quickAddSaved'));
      await loadList();

  }

  function quickCaptureErrorText(error) {
    ensureBound('quickCaptureErrorText');

      switch (String(error || '')) {
        case 'self_tab':
          return env.t('quickAddSelf');
        case 'restricted_url':
          return env.t('quickAddRestricted');
        case 'not_in_group':
          return env.t('quickAddNoGroup');
        case 'no_tab':
          return env.t('quickAddNoTarget');
        default:
          return env.t('quickAddFailed', { error: error || 'unknown' });
      }

  }

  global.TabWallWorkspaceUi = {
    bind,
    renderMembersList,
    openMembersBox,
    closeMembersBox,
    renderDedupeClusters,
    openDedupeBox,
    closeDedupeBox,
    runDedupeScan,
    applyDedupeChoices,
    initDedupeUi,
    showLightboxEntry,
    openLightbox,
    openCanvasGroupLightbox,
    openCanvasNoteSources,
    closeCanvasNoteSources,
    navigateLightbox,
    closeLightbox,
    backToGroupOverview,
    handleLightboxEscape,
    buildGroupMemberNavList,
    buildLightboxNavList,
    renderTagManager,
    refreshTagManager,
    addTagFromManager,
    updateBatchBar,
    setSelectMode,
    toggleSelect,
    restoreItem,
    deleteItem,
    loadList,
    initConflictUi,
    openConflictModal,
    closeConflictModal,
    resolveConflict,
    openPreSaveModal,
    closePreSaveModal,
    confirmPreSave,
    cancelPreSave,
    initPreSaveUi,
    renderPreSaveChips,
    commitPreSaveTagDraft,
    appendDedupeThumb,
    appendDedupePreviewBtn,
    renderEditChips,
    commitTagDraft,
    openEditBox,
    openBatchEdit,
    closeEditBox,
    openMemberEditBox,
    fillEditTitleLockFields,
    syncEditLockFields,
    openUnlockDialog,
    closeUnlockDialog,
    submitUnlockDialog,
    requestUnlockItem,
    toggleCardLock,
    placeEditBoxCentered,
    setupFloatDrag,
    anyFloatOpen,
    syncFloatBackdrop,
    closeAllFloatsExcept,
    placeFloatBox,
    openTagsBox,
    closeTagsBox,
    openHelpBox,
    closeHelpBox,
    positionTagsBoxUnderButton,
    initQuickCaptureUi,
    collectImageFiles,
    pickImageCardFiles,
    createImageCardsFromFiles,
    requestQuickCapture,
    handleQuickCaptureResult,
    quickCaptureErrorText,
  };
})(typeof self !== 'undefined' ? self : globalThis);
