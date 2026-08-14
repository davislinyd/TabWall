(function (global) {
  'use strict';
  let env = null;
  function bind(next) { if (next && typeof next === 'object') env = next; }
  function ensureBound(n) { if (!env) throw new Error('TabWallAppHelpers.' + n + ' used before bind()'); }

  /* free-var shims: incomplete extract rewrites still call bare park helpers */
  function escapeHtml(...args) { return env.escapeHtml(...args); }
  function escapeAttr(...args) { return env.escapeAttr(...args); }
  function itemTitle(...args) { return env.itemTitle(...args); }


  function getParentOrigin() {
    // Pre-bind safe: only window/document (used for PARENT_ORIGIN at park.js load).
      try {
        const ancestor = window.location.ancestorOrigins?.[0];
        if (ancestor) return new URL(ancestor).origin;
      } catch {
        // fall through to referrer
      }
      try {
        return document.referrer ? new URL(document.referrer).origin : '';
      } catch {
        return '';
      }

  }

  function uiLog(level, tag, msg, detail) {
    ensureBound('uiLog');

      const entry = {
        t: Date.now(),
        level: level || 'info',
        tag: String(tag || 'ui'),
        msg: String(msg || ''),
        detail: detail != null ? String(detail).slice(0, 800) : '',
      };
      env.uiLogBuffer.push(entry);
      while (env.uiLogBuffer.length > env.UI_LOG_MAX) env.uiLogBuffer.shift();
      const line = `[TabWall][${entry.tag}] ${entry.msg}${entry.detail ? ' | ' + entry.detail : ''}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
      // Best-effort forward to SW buffer
      sendMessage({
        type: 'LOG',
        level: entry.level,
        tag: entry.tag,
        msg: entry.msg,
        detail: entry.detail,
      }).catch(() => {});
      return entry;

  }

  async function refreshDiagLogPanel() {
    ensureBound('refreshDiagLogPanel');

      if (!env.diagLogText) return;
      const res = await sendMessage({ type: 'GET_LOGS' });
      const swLogs = res?.ok && Array.isArray(res.logs) ? res.logs : [];
      const merged = [...swLogs, ...env.uiLogBuffer].sort((a, b) => a.t - b.t);
      // Dedupe near-identical consecutive lines
      const lines = [];
      let prev = '';
      for (const e of merged) {
        const line = env.formatLogEntry(e);
        if (line === prev) continue;
        lines.push(line);
        prev = line;
      }
      env.diagLogText.value = lines.length ? lines.join('\n') : env.t('diagLogEmpty');
      if (env.diagLogStatus) env.diagLogStatus.textContent = '';

  }

  function canvasStoreSnapshot() {
    ensureBound('canvasStoreSnapshot');

      return env.canvasStore?.getState?.() || {
        items: env.allTabs,
        layout: env.canvasLayout,
        baseLayout: env.canvasLayout,
        viewport: { ...env.canvasLayout.viewport },
        viewportPreview: null,
        revision: 0,
        selectedIds: new Set(env.selectedIds),
        interaction: null,
        pendingOperations: [],
        sync: { status: 'idle', attempt: 0, error: '' },
      };

  }

  function updateCanvasSyncStatus(sync = canvasStoreSnapshot().sync) {
    ensureBound('updateCanvasSyncStatus');

      const el = document.getElementById('canvasSyncStatus');
      if (!el) return;
      const labels = {
        dirty: '未同步',
        saving: '儲存中',
        retrying: '重試中',
        error: '同步失敗',
      };
      el.textContent = labels[sync?.status] || '';
      if (sync?.status) el.dataset.state = sync.status;
      else delete el.dataset.state;
      if (sync?.error) el.title = String(sync.error);
      else el.removeAttribute('title');

  }

  function handleCanvasStoreChange(snapshot, action = {}) {
    ensureBound('handleCanvasStoreChange');

      env.canvasLayout = snapshot.layout;
      if (env.settings.viewMode === 'canvas') env.selectedIds = new Set(snapshot.selectedIds);
      updateCanvasSyncStatus(snapshot.sync);
      const fullRender = new Set(['ITEMS_SET', 'HYDRATE', 'REMOTE_LAYOUT']).has(action.type);
      if (fullRender && env.settings.viewMode === 'canvas' && !env.canvasSessionFallback) env.renderCanvas();
      else if (env.settings.viewMode === 'canvas' && !env.canvasSessionFallback) {
        env.updateCanvasTransform();
        if (action.type === 'VIEWPORT_PREVIEW' || action.type === 'VIEWPORT_PREVIEW_CLEAR') {
          return;
        }
        const searchContext = getCanvasSearchContext();
        const renderLayout = env.canvasSearchLayoutFor(searchContext);
        env.updateCanvasNodePositions(snapshot, searchContext);
        env.updateCanvasNodeSelection();
        env.renderCanvasConnections(searchContext, renderLayout);
        env.renderCanvasMinimap(searchContext.items, renderLayout);
        env.updateBatchBar();
        if (action.type === 'OPERATION_COMMIT' || action.type === 'SYNC_ERROR' || action.type === 'SYNC_FAILED') {
          if (action.operation?.type === 'zoom') env.scheduleCanvasMediaQualityRefresh();
          else env.refreshCanvasMediaQuality();
        }
      }

  }

  function ensureCanvasStore() {
    ensureBound('ensureCanvasStore');

      if (env.canvasStore || !env.CanvasStoreApi?.createCanvasStore) return env.canvasStore;
      env.canvasStore = env.CanvasStoreApi.createCanvasStore({
        items: env.allTabs,
        layout: env.canvasLayout,
        sendPatch: ({ layout, baseRevision }) => sendMessage({
          type: 'PATCH_CANVAS_LAYOUT',
          layout,
          baseRevision,
        }),
        onChange: handleCanvasStoreChange,
      });
      return env.canvasStore;

  }

  async function closeStandaloneTab() {
    ensureBound('closeStandaloneTab');

      try {
        const tab = await chrome.tabs.getCurrent();
        if (tab?.id != null) {
          await chrome.tabs.remove(tab.id);
          return;
        }
      } catch {
        // Fall back to window.close below.
      }
      try {
        window.close();
      } catch {
        // ignore
      }

  }

  function requestHostClose() {
    ensureBound('requestHostClose');

      if (window.parent && window.parent !== window) {
        try {
          if (env.postToParent({ type: 'TABWALL_CLOSE' })) return;
        } catch {
          // ignore
        }
        try {
          window.close();
        } catch {
          // ignore
        }
        return;
      }
      closeStandaloneTab();

  }

  function sendMessage(payload) {
      // Pre-bind safe: chrome.runtime only.
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            const result = response || { ok: false, error: 'empty_response' };
            env?.ParkHistory?.noteMessageResult?.(payload?.type, result);
            resolve(result);
          });
        } catch (err) {
          resolve({ ok: false, error: String(err) });
        }
      });

  }

  function syncQuickCaptureAvailability() {
    ensureBound('syncQuickCaptureAvailability');

      const hasHost = Boolean(env.PARENT_ORIGIN);
      if (env.quickAddBtn) {
        env.quickAddBtn.disabled = !hasHost;
        env.quickAddBtn.title = hasHost ? env.t('quickAddTab') : env.t('quickAddSelf');
        env.quickAddBtn.setAttribute('aria-label', env.t('quickAddTab'));
      }
      if (env.quickAddTabMenu) {
        env.quickAddTabMenu.disabled = !hasHost;
        env.quickAddTabMenu.title = hasHost ? env.t('quickAddTab') : env.t('quickAddSelf');
      }
      if (env.quickAddGroupMenu) {
        env.quickAddGroupMenu.disabled = !hasHost;
        env.quickAddGroupMenu.title = hasHost ? env.t('quickAddGroup') : env.t('quickAddSelf');
      }

  }

  function setClusterKeepMode(cluster, mode) {
    ensureBound('setClusterKeepMode');

      cluster.mode = mode;
      const items = cluster.items || [];
      cluster.keepIds = new Set();
      if (mode === 'all') {
        for (const it of items) cluster.keepIds.add(it.id);
        return;
      }
      if (!items.length) return;
      const sorted = [...items].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      if (mode === 'newest') {
        cluster.keepIds.add(sorted[sorted.length - 1].id);
      } else if (mode === 'oldest') {
        cluster.keepIds.add(sorted[0].id);
      } else if (mode === 'manual') {
        // keep whatever checkboxes currently say — default all checked if empty
        for (const it of items) cluster.keepIds.add(it.id);
      }

  }

  function sortTabs(list, sortBy) {
    ensureBound('sortTabs');

      const arr = [...list];
      switch (env.normalizeSortBy(sortBy)) {
        case 'group-first':
          return arr.sort((a, b) => {
            const rank = (item) => item.kind === 'group' ? 0 : item.kind === 'note' ? 1 : 2;
            const ga = rank(a);
            const gb = rank(b);
            if (ga !== gb) return ga - gb;
            return (b.savedAt || 0) - (a.savedAt || 0);
          });
        case 'domain':
          return arr.sort((a, b) => {
            const da = a.kind === 'group' || a.kind === 'note' ? '' : env.domainOf(a.url);
            const db = b.kind === 'group' || b.kind === 'note' ? '' : env.domainOf(b.url);
            return da.localeCompare(db) || (b.savedAt || 0) - (a.savedAt || 0);
          });
        case 'newest':
        default:
          return arr.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      }

  }

  function copyTextFallback(text) {
    ensureBound('copyTextFallback');

      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;

  }

  async function copySavedLink(item) {
    ensureBound('copySavedLink');

      const text = env.linkTextForItem(item);
      if (!text) {
        showCopyToast(env.t('copyFailed'));
        return;
      }
      // Prefer sync fallback first while still in the user-gesture stack (iframe-safe)
      if (copyTextFallback(text)) {
        showCopyToast(env.t('copied'));
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          showCopyToast(env.t('copied'));
          return;
        }
      } catch {
        // fall through
      }
      showCopyToast(env.t('copyFailed'));

  }

  function showCopyToast(msg) {
    ensureBound('showCopyToast');

      let el = document.getElementById('copyToast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'copyToast';
        el.className = 'copy-toast';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.classList.add('show');
      if (env.copyToastTimer) clearTimeout(env.copyToastTimer);
      env.copyToastTimer = setTimeout(() => {
        el.classList.remove('show');
      }, 1400);

  }

  function handleCardSelectClick(itemId, e) {
    ensureBound('handleCardSelectClick');

      if (!e) {
        if (!env.selectMode) env.setSelectMode(true);
        env.toggleSelect(itemId);
        env.lastAnchorId = itemId;
        return;
      }
      const visible = env.getVisibleTabs();
      const ids = visible.map((x) => x.id);
      const idx = ids.indexOf(itemId);
      if (e.shiftKey && env.lastAnchorId) {
        const a = ids.indexOf(env.lastAnchorId);
        if (a >= 0 && idx >= 0) {
          if (!env.selectMode) env.setSelectMode(true);
          const lo = Math.min(a, idx);
          const hi = Math.max(a, idx);
          for (let i = lo; i <= hi; i++) env.selectedIds.add(ids[i]);
          env.updateBatchBar();
          env.renderGrid();
          return;
        }
      }
      // ⌘/Ctrl toggle, Shift 起點, 或已在選擇模式：切換此項
      if (env.selectMode || e.metaKey || e.ctrlKey || e.shiftKey) {
        if (!env.selectMode) env.setSelectMode(true);
        env.toggleSelect(itemId);
        env.lastAnchorId = itemId;
      }

  }

  function getCanvasSearchContext() {
    ensureBound('getCanvasSearchContext');

      const queryActive = Boolean(String(env.query || '').trim());
      const directItems = env.getVisibleTabs().filter(env.canvasItemPassesIndexFilter);
      const directIds = new Set(directItems.map((item) => item.id));
      const relatedIds = new Set();
      if (queryActive && directIds.size) {
        const layout = canvasStoreSnapshot().layout || env.canvasLayout;
        for (const connection of layout.connections || []) {
          if (directIds.has(connection.sourceId)) relatedIds.add(connection.targetId);
          if (directIds.has(connection.targetId)) relatedIds.add(connection.sourceId);
        }
      }
      relatedIds.forEach((id) => {
        if (directIds.has(id)) relatedIds.delete(id);
      });
      const relatedItems = queryActive
        ? sortTabs(
            env.allTabs.filter((item) => (
              (!env.pinnedOnly || item.pinned === true)
              && env.canvasItemPassesIndexFilter(item)
              && relatedIds.has(item.id)
              && !directIds.has(item.id)
            )),
            env.normalizeSortBy(env.settings.sortBy)
          )
        : [];
      return {
        items: [...directItems, ...relatedItems],
        directIds,
        relatedIds: new Set(relatedItems.map((item) => item.id)),
        queryActive,
      };

  }

  function canvasSearchLayoutFor(searchContext = getCanvasSearchContext()) {
    ensureBound('canvasSearchLayoutFor');

      const state = canvasStoreSnapshot();
      const layout = state.layout || env.canvasLayout;
      if (!env.isCanvasSearchPreviewActive(searchContext)) {
        env.canvasSearchPreview = null;
        return layout;
      }

      const key = env.canvasSearchPreviewKey(searchContext);
      if (!env.canvasSearchPreview || env.canvasSearchPreview.key !== key) {
        env.canvasSearchPreview = {
          key,
          revision: state.revision,
          positions: env.arrangeCanvasGrid(searchContext.items, layout),
          mode: 'grid',
        };
      } else {
        env.canvasSearchPreview.revision = state.revision;
      }

      return {
        ...layout,
        positions: {
          ...(layout.positions || {}),
          ...env.canvasSearchPreview.positions,
        },
      };

  }

  function syncCanvasIndexUi() {
    ensureBound('syncCanvasIndexUi');

      const allButton = document.getElementById('canvasAllBtn');
      const unsortedButton = document.getElementById('canvasUnsortedBtn');
      const pinnedButton = document.getElementById('canvasPinnedBtn');
      const buttons = [allButton, unsortedButton, pinnedButton, ...document.querySelectorAll('[data-canvas-stack-filter]')].filter(Boolean);
      buttons.forEach((button) => button.classList.remove('active'));
      const active = env.canvasIndexFilter === 'unsorted'
        ? unsortedButton
        : env.canvasIndexFilter === 'pinned'
          ? pinnedButton
          : env.canvasIndexFilter.startsWith('stack:')
            ? document.querySelector(`[data-canvas-stack-filter="${CSS.escape(canvasIndexFilter.slice(6))}"]`)
            : allButton;
      active?.classList.add('active');
      const count = document.querySelector('[data-canvas-count]');
      if (count) count.textContent = String(env.getCanvasVisibleTabs().length);

  }

  function renderCanvasStackIndex() {
    ensureBound('renderCanvasStackIndex');

      const root = document.getElementById('canvasStackIndex');
      if (!root) return;
      const groups = env.allTabs.filter((item) => item.kind === 'group');
      if (env.canvasIndexFilter.startsWith('stack:') && !groups.some((group) => group.id === env.canvasIndexFilter.slice(6))) {
        env.canvasIndexFilter = 'all';
      }
      root.innerHTML = groups
        .map((group) => `<button type="button" data-canvas-stack-filter="${escapeAttr(group.id)}" title="${escapeAttr(itemTitle(group))}">${escapeHtml(itemTitle(group))}</button>`)
        .join('');
      root.querySelectorAll('[data-canvas-stack-filter]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.canvasStackFilter || '';
          env.setCanvasIndexFilter(`stack:${id}`, id);
        });
      });
      syncCanvasIndexUi();

  }

  function focusCanvasItem(id) {
    ensureBound('focusCanvasItem');

      if (!env.canvasViewportEl || !id) return;
      const item = env.allTabs.find((candidate) => candidate.id === id);
      if (!item) return;
      const rect = env.canvasViewportEl.getBoundingClientRect?.();
      const width = env.canvasViewportEl.clientWidth || rect?.width || 0;
      const height = env.canvasViewportEl.clientHeight || rect?.height || 0;
      if (!width || !height) return;
      const state = canvasStoreSnapshot();
      const searchContext = env.getCanvasSearchContext();
      const layout = env.isCanvasSearchPreviewActive(searchContext)
        ? env.canvasSearchLayoutFor(searchContext)
        : state.layout;
      const position = env.canvasDisplayPosition(
        layout.positions?.[id] || env.canvasDefaultPosition(env.allTabs.indexOf(item)),
      );
      const zoom = Math.max(0.25, Number(state.layout.viewport.zoom) || env.DEFAULT_CANVAS_VIEWPORT.zoom);
      const itemWidth = Math.max(1, Number(position.w) || 1);
      const itemHeight = Math.max(1, Number(position.h) || 1);
      const viewport = {
        x: Number(position.x) + itemWidth / 2 - width / (2 * zoom),
        y: Number(position.y) + itemHeight / 2 - height / (2 * zoom),
        zoom,
      };
      if (env.canvasSearchViewportState) ensureCanvasStore()?.previewViewport(viewport);
      else ensureCanvasStore()?.commitViewport(viewport);

  }

  async function restoreMember(groupId, memberId) {
    ensureBound('restoreMember');

      return env.withUiActionLock(`restore-member:${groupId}:${memberId}`, async () => {
        const group = env.allTabs.find((item) => item.id === groupId && item.kind === 'group');
        const member = group?.tabs?.find((item) => item.id === memberId);
        if (env.isStoredOnlyUrl(member?.url)) {
          showCopyToast(env.t('restoreRestricted'));
          return { ok: false, error: 'restricted_url' };
        }
        const res = await sendMessage({
          type: 'RESTORE_GROUP_MEMBER',
          groupId,
          memberId,
        });
        if (res.ok) await env.loadList();
        else if (res.error === 'restricted_url') showCopyToast(env.t('restoreRestricted'));
        return res;
      });

  }

  function flipCards(beforeMap) {
    ensureBound('flipCards');

      const cards = [...env.gridEl.querySelectorAll('.card:not(.dragging)')];
      cards.forEach((card) => {
        const prev = beforeMap.get(card);
        if (!prev) return;
        const next = card.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (!dx && !dy) return;
        card.style.transition = 'none';
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          card.style.transition = '';
          card.style.transform = '';
        });
      });

  }

  function findStackTargetAt(clientX, clientY, excludeCard) {
    ensureBound('findStackTargetAt');

      const cards = [...env.gridEl.querySelectorAll('.card')].filter(
        (el) => el !== excludeCard && !el.classList.contains('dragging') && !el.classList.contains('card-placeholder')
      );
      // Prefer topmost card under point (last in paint order among hits)
      let hit = null;
      for (const el of cards) {
        const meta = el.querySelector('.meta');
        if (!meta) continue;
        const rect = meta.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          hit = el;
        }
      }
      return hit;

  }

  function cleanupCardDragVisual(state) {
    ensureBound('cleanupCardDragVisual');

      const { card, placeholder } = state;
      env.clearStackHover();
      card.classList.remove('dragging');
      env.gridEl.classList.remove('is-dragging');
      card.style.position = '';
      card.style.left = '';
      card.style.top = '';
      card.style.width = '';
      card.style.height = '';
      card.style.zIndex = '';
      card.style.margin = '';
      card.style.transform = '';
      if (placeholder?.parentElement) {
        placeholder.parentElement.insertBefore(card, placeholder);
        placeholder.remove();
      }

  }

  function normalizeParkedList(raw) {
    ensureBound('normalizeParkedList');

      return (Array.isArray(raw) ? raw : []).map((item) => {
        if (item.kind === 'group' || Array.isArray(item.tabs)) {
          return {
            ...item,
            kind: 'group',
            pinned: Boolean(item.pinned),
            note: typeof item.note === 'string' ? item.note : '',
            tags: Array.isArray(item.tags) ? item.tags : [],
            tabs: Array.isArray(item.tabs) ? item.tabs : [],
            notes: Array.isArray(item.notes) ? item.notes.map(normalizeNoteProjection) : [],
          };
        }
        if (item.kind === 'note') return normalizeNoteProjection(item);
        return {
          ...item,
          kind: 'tab',
          pinned: Boolean(item.pinned),
          note: typeof item.note === 'string' ? item.note : '',
          tags: Array.isArray(item.tags) ? item.tags : [],
        };
      });

  }

  function normalizeNoteProjection(item) {
    ensureBound('normalizeNoteProjection');

      return {
        ...item,
        kind: 'note',
        title: typeof item?.title === 'string' && item.title ? item.title : env.t('noteUntitled'),
        markdown: typeof item?.markdown === 'string' ? item.markdown : '',
        pinned: Boolean(item?.pinned),
        savedAt: Number(item?.savedAt) || Date.now(),
        tags: Array.isArray(item?.tags) ? item.tags : [],
        attachments: Array.isArray(item?.attachments)
          ? item.attachments.map((attachment) => ({
              ...attachment,
              id: String(attachment?.id || ''),
              name: typeof attachment?.name === 'string' ? attachment.name : 'image',
              alt: typeof attachment?.alt === 'string' ? attachment.alt : '',
              hasData: attachment?.hasData === true,
            }))
          : [],
      };

  }

  function detachCardDragListeners(state) {
    ensureBound('detachCardDragListeners');

      if (!state?.onMove) return;
      window.removeEventListener('pointermove', state.onMove, true);
      window.removeEventListener('pointerup', state.onUp, true);
      window.removeEventListener('pointercancel', state.onUp, true);
      state.onMove = null;
      state.onUp = null;
      if (env.cardPointerRaf) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(env.cardPointerRaf);
        else clearTimeout(env.cardPointerRaf);
        env.cardPointerRaf = 0;
      }
      env.cardQueuedPointerEvent = null;

  }

  async function togglePinned(item) {
    ensureBound('togglePinned');

      const next = !Boolean(item?.pinned);
      const res = await env.withUiActionLock(`pin:${item?.id || ''}`, () =>
        item?.kind === 'note'
          ? sendMessage({ type: 'UPDATE_NOTE', noteId: item.id, patch: { pinned: next } })
          : sendMessage({ type: 'UPDATE_ITEM', id: item.id, pinned: next })
      );
      if (!res?.ok) {
        showCopyToast(env.t('pinFailed'));
        return;
      }
      const stored = env.allTabs.find((candidate) => candidate.id === item.id);
      if (stored) stored.pinned = next;
      showCopyToast(env.t(next ? 'pinnedOn' : 'pinnedOff'));
      env.renderGrid();

  }

  function normalizeCanvasLayoutLocal(raw, items = env.allTabs) {
    ensureBound('normalizeCanvasLayoutLocal');

      const value = raw && typeof raw === 'object' ? raw : {};
      const itemList = Array.isArray(items) ? items : [];
      const source = value.positions && typeof value.positions === 'object' ? value.positions : {};
      const positions = {};
      let index = 0;
      const finite = (v, min, max, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
      };
      for (const item of itemList) {
        const id = String(item.id);
        const rawPosition = source[id];
        const fallback = env.canvasDefaultPosition(index++);
        const p = rawPosition && typeof rawPosition === 'object' ? rawPosition : {};
        positions[id] = {
          x: finite(p.x, -100000, 100000, fallback.x),
          y: finite(p.y, -100000, 100000, fallback.y),
          w: finite(p.w, 160, 640, fallback.w),
          h: finite(p.h, 120, 560, fallback.h),
          z: finite(p.z, 0, 1000000, fallback.z),
        };
      }
      if (!itemList.length) {
        for (const [id, rawPosition] of Object.entries(source)) {
          const fallback = env.canvasDefaultPosition(index++);
          const p = rawPosition && typeof rawPosition === 'object' ? rawPosition : {};
          positions[id] = {
            x: finite(p.x, -100000, 100000, fallback.x),
            y: finite(p.y, -100000, 100000, fallback.y),
            w: finite(p.w, 160, 640, fallback.w),
            h: finite(p.h, 120, 560, fallback.h),
            z: finite(p.z, 0, 1000000, fallback.z),
          };
        }
      }
      const validIds = Object.keys(positions);
      const connections = env.CanvasStoreApi?.normalizeConnections
        ? env.CanvasStoreApi.normalizeConnections(value.connections, validIds)
        : normalizeCanvasConnectionsLocal(value.connections, validIds);
      return {
        version: env.CANVAS_LAYOUT_VERSION,
        viewport: {
          x: finite(value.viewport?.x, -100000, 100000, env.DEFAULT_CANVAS_VIEWPORT.x),
          y: finite(value.viewport?.y, -100000, 100000, env.DEFAULT_CANVAS_VIEWPORT.y),
          zoom: finite(value.viewport?.zoom, 0.25, 2, env.DEFAULT_CANVAS_VIEWPORT.zoom),
        },
        positions,
        connections,
      };

  }

  function normalizeCanvasConnectionsLocal(rawConnections, validIds = []) {
    ensureBound('normalizeCanvasConnectionsLocal');

      const ids = new Set(validIds.map(String));
      const seen = new Set();
      const result = [];
      const normalizeCurveOffset = (raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const x = Number.isFinite(Number(raw.x))
          ? Math.min(env.CANVAS_CONNECTION_MAX_CURVE_OFFSET, Math.max(-env.CANVAS_CONNECTION_MAX_CURVE_OFFSET, Number(raw.x)))
          : 0;
        const y = Number.isFinite(Number(raw.y))
          ? Math.min(env.CANVAS_CONNECTION_MAX_CURVE_OFFSET, Math.max(-env.CANVAS_CONNECTION_MAX_CURVE_OFFSET, Number(raw.y)))
          : 0;
        return x || y ? { x, y } : null;
      };
      for (const connection of Array.isArray(rawConnections) ? rawConnections : []) {
        let sourceId = String(connection?.sourceId || '');
        let targetId = String(connection?.targetId || '');
        if (!sourceId || !targetId || sourceId === targetId) continue;
        if (ids.size && (!ids.has(sourceId) || !ids.has(targetId))) continue;
        if (sourceId > targetId) [sourceId, targetId] = [targetId, sourceId];
        const key = `${sourceId}\u0000${targetId}`;
        const curveOffset = normalizeCurveOffset(connection?.curveOffset);
        if (seen.has(key)) {
          const existing = result.find((entry) => entry.sourceId === sourceId && entry.targetId === targetId);
          if (existing && !existing.curveOffset && curveOffset) existing.curveOffset = curveOffset;
          continue;
        }
        seen.add(key);
        result.push({ sourceId, targetId, ...(curveOffset ? { curveOffset } : {}) });
      }
      return result.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.targetId.localeCompare(b.targetId));

  }

  function wireStickerAttachmentImages(root, note) {
    ensureBound('wireStickerAttachmentImages');

      if (!root || !note) return;
      const attachments = new Map((note.attachments || []).map((attachment) => [attachment.id, attachment]));
      root.querySelectorAll('[data-note-attachment-key], [data-attachment-id]').forEach((img) => {
        const id = img.dataset.noteAttachmentId || img.dataset.attachmentId;
        const attachment = attachments.get(id);
        const key = img.dataset.noteAttachmentKey || (attachment ? env.Media.mediaKeyNoteAttachment(note.id, attachment.id) : '');
        if (!key) return;
        img.dataset.noteAttachmentKey = key;
        env.observeStickerAttachment(img);
      });

  }

  function canvasSelectNode(id, event) {
    ensureBound('canvasSelectNode');

      if (env.selectedCanvasConnectionId) {
        env.selectedCanvasConnectionId = '';
        env.renderCanvasConnections();
        env.updateBatchBar();
      }
      const additive = Boolean(event?.metaKey || event?.ctrlKey || event?.shiftKey);
      const selection = env.activeCanvasSelection();
      if (additive) ensureCanvasStore()?.toggleSelection(id, true);
      else if (!selection.has(id) || selection.size > 1) ensureCanvasStore()?.setSelection([id]);
      env.selectMode = env.activeCanvasSelection().size > 0;
      env.lastAnchorId = id;

  }

  function moveCanvasSearchPreview(ids, dx, dy, { snap = false } = {}) {
    ensureBound('moveCanvasSearchPreview');

      const searchContext = getCanvasSearchContext();
      if (!env.isCanvasSearchPreviewActive(searchContext)) return false;
      canvasSearchLayoutFor(searchContext);
      if (!env.canvasSearchPreview) return false;
      let changed = false;
      for (const id of ids || []) {
        const current = env.canvasSearchPreview.positions[id];
        if (!current) continue;
        const next = {
          ...current,
          x: current.x + (Number(dx) || 0),
          y: current.y + (Number(dy) || 0),
        };
        if (snap) env.snapCanvasPosition(next);
        env.canvasSearchPreview.positions[id] = next;
        changed = true;
      }
      if (changed) env.refreshCanvasSearchPreview(searchContext.items);
      return changed;

  }

  function applyCanvasSearchPointerPreview(state, dx, dy) {
    ensureBound('applyCanvasSearchPointerPreview');

      if (!state?.searchPreview) return false;
      const searchContext = getCanvasSearchContext();
      if (!env.isCanvasSearchPreviewActive(searchContext)) return false;
      canvasSearchLayoutFor(searchContext);
      if (!env.canvasSearchPreview) return false;
      let changed = false;
      for (const id of state.searchIds || []) {
        const start = state.searchStartPositions?.[id];
        if (!start) continue;
        env.canvasSearchPreview.positions[id] = {
          ...start,
          x: start.x + (Number(dx) || 0),
          y: start.y + (Number(dy) || 0),
        };
        changed = true;
      }
      if (changed) env.refreshCanvasSearchPreview(searchContext.items);
      return changed;

  }

  function finishCanvasSearchPointer(state, commit = true) {
    ensureBound('finishCanvasSearchPointer');

      if (!state?.searchPreview || !env.canvasSearchPreview) return;
      const searchContext = getCanvasSearchContext();
      if (!env.isCanvasSearchPreviewActive(searchContext)) return;
      if (!commit) {
        for (const id of state.searchIds || []) {
          const start = state.searchStartPositions?.[id];
          if (start) env.canvasSearchPreview.positions[id] = { ...start };
        }
      } else if (env.canvasSnapToGrid) {
        for (const id of state.searchIds || []) {
          const position = env.canvasSearchPreview.positions[id];
          if (position) env.snapCanvasPosition(position);
        }
      }
      env.refreshCanvasSearchPreview(searchContext.items);

  }

  function canvasMoveSelected(dx, dy) {
    ensureBound('canvasMoveSelected');

      const searchContext = getCanvasSearchContext();
      if (env.isCanvasSearchPreviewActive(searchContext)) {
        moveCanvasSearchPreview(
          env.canvasSearchPreviewSelectedIds(searchContext),
          dx,
          dy,
          { snap: env.canvasSnapToGrid },
        );
        return;
      }
      ensureCanvasStore()?.commitMove([...env.activeCanvasSelection()], dx, dy, env.canvasSnapToGrid);

  }

  function arrangeCanvas(mode = '') {
    ensureBound('arrangeCanvas');

      if (mode !== 'grid' && mode !== 'align') return;
      const searchContext = getCanvasSearchContext();
      if (env.isCanvasSearchPreviewActive(searchContext)) {
        const layout = canvasSearchLayoutFor(searchContext);
        env.canvasSearchPreview.positions = mode === 'grid'
          ? env.arrangeCanvasGrid(searchContext.items, layout)
          : env.arrangeCanvasAlign(searchContext.items, layout);
        env.canvasSearchPreview.mode = mode;
        env.refreshCanvasSearchPreview(searchContext.items);
        return;
      }
      const items = sortTabs(env.allTabs, env.normalizeSortBy(env.settings.sortBy));
      const layout = canvasStoreSnapshot().layout || env.canvasLayout;
      const positions = mode === 'grid'
        ? env.arrangeCanvasGrid(items, layout)
        : env.arrangeCanvasAlign(items, layout);
      ensureCanvasStore()?.commitPositions(positions);

  }

  function canvasNodeWorldRect(node, options = {}) {
    ensureBound('canvasNodeWorldRect');

      const viewportRect = options.viewportRect || env.canvasViewportEl?.getBoundingClientRect();
      const nodeRect = node?.getBoundingClientRect();
      if (!viewportRect || !nodeRect) return null;
      const viewport = options.viewport || canvasStoreSnapshot().layout?.viewport || env.canvasLayout.viewport;
      const zoom = viewport.zoom || 1;
      return {
        x: (nodeRect.left - viewportRect.left) / zoom + viewport.x,
        y: (nodeRect.top - viewportRect.top) / zoom + viewport.y,
        w: nodeRect.width / zoom,
        h: nodeRect.height / zoom,
        z: Number(node.style.zIndex) || 0,
      };

  }

  function canvasTargetAt(point, excludeId = '') {
    ensureBound('canvasTargetAt');

      const nodes = [...env.canvasNodeElements.keys()]
        .map((id) => ({ id, rect: env.canvasNodeWorldRectFromState(id) }))
        .filter(({ id, rect }) => id && id !== excludeId && rect)
        .sort((a, b) => b.rect.z - a.rect.z);
      for (const { id, rect } of nodes) {
        if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
          return id;
        }
      }
      return '';

  }

  function resetCanvasView() {
    ensureBound('resetCanvasView');

      const { width, height } = env.canvasViewportSize();
      const state = canvasStoreSnapshot();
      const bounds = env.canvasBoundsForItems(env.allTabs, state.layout || env.canvasLayout);
      const zoom = env.canvasZoomToFitCardColumns(width, {
        padding: env.CANVAS_FIT_PADDING,
        minZoom: env.CANVAS_ZOOM_MIN,
        maxZoom: env.CANVAS_ZOOM_MAX,
      });
      if (!width || !height || !bounds) {
        const viewport = { ...env.DEFAULT_CANVAS_VIEWPORT, zoom };
        if (env.canvasSearchViewportState) ensureCanvasStore()?.previewViewport(viewport);
        else ensureCanvasStore()?.commitViewport(viewport);
        return;
      }
      const viewport = {
        x: (bounds.minX + bounds.maxX) / 2 - width / (2 * zoom),
        y: (bounds.minY + bounds.maxY) / 2 - height / (2 * zoom),
        zoom,
      };
      if (env.canvasSearchViewportState) ensureCanvasStore()?.previewViewport(viewport);
      else ensureCanvasStore()?.commitViewport(viewport);

  }

  function cancelCanvasPointer() {
    ensureBound('cancelCanvasPointer');

      const state = env.canvasPointerState;
      if (!state) return;
      env.flushCanvasPointerFrame();
      if (state.kind === 'node' && state.moved) {
        env.cancelCanvasNodeClick(state.id);
        env.suppressCanvasNodeClick(state.id);
      }
      if (state.searchPreview) finishCanvasSearchPointer(state, false);
      else if (state.searchViewportPreview) ensureCanvasStore()?.previewViewport(state.searchViewportStart, { deferRender: true });
      else ensureCanvasStore()?.cancelPointer();
      env.clearCanvasPointerUi(state.pointerId);

  }

  function setCanvasActiveTool(nextTool) {
    ensureBound('setCanvasActiveTool');

      env.canvasActiveTool = nextTool === 'area' || nextTool === 'link' || nextTool === 'note'
        ? nextTool
        : 'select';
      env.canvasNotePlacementArmed = env.canvasActiveTool === 'note';
      env.canvasView?.classList.toggle('is-note-placement', env.canvasNotePlacementArmed);
      document.querySelectorAll('[data-canvas-tool]').forEach((tool) => {
        const active = tool.dataset.canvasTool === env.canvasActiveTool;
        tool.classList.toggle('active', active);
        tool.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      env.canvasViewportEl?.classList.toggle('is-link-tool', env.canvasActiveTool === 'link');
      env.updateCanvasNodeSelection();
      if (env.canvasActiveTool !== 'link') {
        env.cancelCanvasConnectionDrag();
        env.canvasConnectionSourceId = '';
        env.updateCanvasNodeSelection();
        env.renderCanvasConnections();
      }

  }

  function gridNodeRenderKey(item, isList) {
    ensureBound('gridNodeRenderKey');

      return JSON.stringify({
        isList,
        id: item.id,
        kind: item.kind,
        title: item.title,
        displayTitle: item.displayTitle || '',
        locked: Boolean(item.locked),
        lockHash: item.lockHash || '',
        unlocked: Boolean(env.sessionUnlockedIds?.has(item.id)),
        url: item.url,
        note: item.note,
        tags: item.tags,
        pinned: item.pinned,
        savedAt: item.savedAt,
        reminder: item.reminder || null,
        favIconUrl: item.favIconUrl,
        markdown: item.kind === 'note' ? item.markdown : undefined,
        attachments: item.kind === 'note'
          ? (item.attachments || []).map((attachment) => [attachment.id, attachment.name, attachment.alt, attachment.hasData])
          : undefined,
        tabs: item.kind === 'group'
          ? (item.tabs || []).map((member) => [
            member.id,
            member.title,
            member.displayTitle || '',
            member.url,
            member.hasThumb,
            member.hasSnap,
            Boolean(member.locked),
            Boolean(env.sessionUnlockedIds?.has(member.id)),
          ])
          : undefined,
        notes: item.kind === 'group'
          ? (item.notes || []).map((note) => [note.id, note.title, note.markdown, note.tags, note.attachments?.length])
          : undefined,
        query: env.query,
        locale: env.settings.locale,
      });

  }

  function bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(hex) {
    const clean = String(hex || '');
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function normalizeDisplayTitleValue(value, originalTitle) {
    const display = String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    const original = String(originalTitle || '').trim();
    if (!display || display === original) return '';
    return display.slice(0, 2048);
  }

  async function hashLockPassword(password, saltHex) {
    const salt = saltHex && /^[0-9a-f]{32}$/i.test(saltHex)
      ? saltHex.toLowerCase()
      : bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const encoded = new TextEncoder().encode(String(password || ''));
    const saltBytes = hexToBytes(salt);
    const payload = new Uint8Array(saltBytes.length + 1 + encoded.length);
    payload.set(saltBytes, 0);
    payload[saltBytes.length] = 0;
    payload.set(encoded, saltBytes.length + 1);
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return { salt, hash: bytesToHex(new Uint8Array(digest)) };
  }

  async function verifyLockPassword(password, saltHex, hashHex) {
    if (!saltHex || !hashHex) return String(password || '') === '';
    const { hash } = await hashLockPassword(password, saltHex);
    return hash === String(hashHex).toLowerCase();
  }

  async function collectLockPatchFromFields({ locked, password, confirm, hasPassword } = {}) {
    if (!locked) return { locked: false };
    const pw = String(password || '');
    const confirmPw = String(confirm || '');
    if (pw || confirmPw) {
      if (pw !== confirmPw) return { error: 'lockPasswordMismatch' };
      if (!pw) return { locked: true, lockSalt: '', lockHash: '' };
      const { salt, hash } = await hashLockPassword(pw);
      return { locked: true, lockSalt: salt, lockHash: hash };
    }
    if (hasPassword) return { locked: true };
    return { locked: true, lockSalt: '', lockHash: '' };
  }

  function isItemMediaLocked(item, unlockedIds) {
    if (!item?.locked) return false;
    return !unlockedIds?.has?.(item.id);
  }

  function classifyStoredUrl(url) {
    ensureBound('classifyStoredUrl');
    if (env.Build?.classifyUrl) return env.Build.classifyUrl(url, { allowStoredOnly: true });
    if (/^https?:\/\//i.test(String(url || ''))) return 'restorable';
    if (/^file:/i.test(String(url || ''))) return 'stored_only';
    return 'invalid';
  }

  function isStoredOnlyUrl(url) {
    return classifyStoredUrl(url) === 'stored_only';
  }

  function isImageCard(item) {
    return item?.kind === 'tab' && item.cardSource === 'image';
  }

  function countStoredOnlyUrls(items) {
    const list = Array.isArray(items) ? items : items ? [items] : [];
    return list.reduce((count, item) => {
      if (Array.isArray(item?.tabs)) {
        return count + item.tabs.filter((member) => isStoredOnlyUrl(member?.url)).length;
      }
      return count + (isStoredOnlyUrl(item?.url) ? 1 : 0);
    }, 0);
  }

  function formatNoteBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${Math.round(bytes)} B`;
  }

  function formatNoteMediaError(error) {
    ensureBound('formatNoteMediaError');
    const code = typeof error === 'string' ? error : error?.code || error?.message || '';
    const key = {
      note_image_source_too_large: 'noteImageSourceTooLarge',
      note_image_decode_too_large: 'noteImageDecodeTooLarge',
      note_image_output_too_large: 'noteImageOutputTooLarge',
      note_image_too_many: 'noteImageTooMany',
      attachment_quota_exceeded: 'noteImageQuotaExceeded',
      note_image_unsupported_type: 'noteImageUnsupportedType',
      note_image_heic_unsupported: 'noteImageHeicUnsupported',
      note_image_svg_unsupported: 'noteImageSvgUnsupported',
    }[code];
    return key ? env.t(key) : env.t('noteImageInvalid');
  }

  function postToParent(payload) {
    ensureBound('postToParent');
    if (!env.PARENT_ORIGIN || !window.parent || window.parent === window) return false;
    try {
      window.parent.postMessage(payload, env.PARENT_ORIGIN);
      return true;
    } catch {
      return false;
    }
  }

  function scheduleLoadList() {
    ensureBound('scheduleLoadList');

      if (env.loadListTimer) clearTimeout(env.loadListTimer);
      env.loadListTimer = setTimeout(() => {
        env.loadListTimer = null;
        env.loadList().catch((err) => {
          if (env.loadStatusEl) env.loadStatusEl.textContent = env.t('loadFailed');
          uiLog('error', 'load', 'exception', err?.message || err);
          if (env.settings.viewMode === 'canvas') {
            env.canvasSessionFallback = true;
            env.applyViewMode('list');
            env.renderGrid();
          }
        });
      }, 150);

  }

  global.TabWallAppHelpers = { bind, getParentOrigin, uiLog, classifyStoredUrl, isStoredOnlyUrl, isImageCard, countStoredOnlyUrls, formatNoteBytes, formatNoteMediaError, postToParent,  refreshDiagLogPanel, canvasStoreSnapshot, updateCanvasSyncStatus, handleCanvasStoreChange, ensureCanvasStore, closeStandaloneTab, requestHostClose, sendMessage, syncQuickCaptureAvailability, setClusterKeepMode, sortTabs, copyTextFallback, copySavedLink, showCopyToast, handleCardSelectClick, getCanvasSearchContext, canvasSearchLayoutFor, syncCanvasIndexUi, renderCanvasStackIndex, focusCanvasItem, restoreMember, flipCards, findStackTargetAt, cleanupCardDragVisual, normalizeParkedList, normalizeNoteProjection, detachCardDragListeners, togglePinned, normalizeCanvasLayoutLocal, normalizeCanvasConnectionsLocal, wireStickerAttachmentImages, canvasSelectNode, moveCanvasSearchPreview, applyCanvasSearchPointerPreview, finishCanvasSearchPointer, canvasMoveSelected, arrangeCanvas, canvasNodeWorldRect, canvasTargetAt, resetCanvasView, cancelCanvasPointer, setCanvasActiveTool, gridNodeRenderKey, scheduleLoadList, normalizeDisplayTitleValue, hashLockPassword, verifyLockPassword, collectLockPatchFromFields, isItemMediaLocked };
})(typeof self !== 'undefined' ? self : globalThis);
