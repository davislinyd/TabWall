(function (global) {
  'use strict';
  let env = null;
  function bind(next) { if (next && typeof next === 'object') env = next; }
  function ensureBound(n) { if (!env) throw new Error('TabWallCanvasChrome.' + n + ' used before bind()'); }

  function setCanvasZoom(next, clientX = null, clientY = null) {
    ensureBound('setCanvasZoom');

      const state = env.canvasStoreSnapshot();
      const oldZoom = state.layout.viewport.zoom;
      const zoom = Math.min(env.CANVAS_ZOOM_MAX, Math.max(env.CANVAS_ZOOM_MIN, Number(next) || oldZoom));
      if (zoom === oldZoom) return;
      const rect = env.canvasViewportEl?.getBoundingClientRect();
      let anchor = null;
      if (rect) {
        const offset = clientX != null && clientY != null
          ? { x: clientX - rect.left, y: clientY - rect.top }
          : { x: rect.width / 2, y: rect.height / 2 };
        anchor = {
          world: {
            x: offset.x / oldZoom + state.layout.viewport.x,
            y: offset.y / oldZoom + state.layout.viewport.y,
          },
          offset,
        };
      }
      if (env.canvasSearchViewportState) {
        const nextViewport = anchor?.world && anchor?.offset
          ? {
              x: anchor.world.x - anchor.offset.x / zoom,
              y: anchor.world.y - anchor.offset.y / zoom,
              zoom,
            }
          : { ...state.layout.viewport, zoom };
        env.ensureCanvasStore()?.previewViewport(nextViewport);
      } else {
        env.canvasStore?.commitZoom(zoom, anchor);
      }

  }

  function canvasFitViewport(mode) {
    ensureBound('canvasFitViewport');

      if (mode !== 'width' && mode !== 'screen') return false;
      const { width, height } = canvasViewportSize();
      const searchContext = env.getCanvasSearchContext();
      const items = searchContext.items;
      if (!width || !height || !items.length) return false;
      const layout = env.canvasSearchLayoutFor(searchContext);
      const bounds = env.canvasBoundsForItems(items, layout);
      if (!bounds) return false;
      const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
      const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
      const availableWidth = Math.max(1, width - env.CANVAS_FIT_PADDING * 2);
      const availableHeight = Math.max(1, height - env.CANVAS_FIT_PADDING * 2);
      const widthZoom = availableWidth / contentWidth;
      const heightZoom = availableHeight / contentHeight;
      const requestedZoom = mode === 'width' ? widthZoom : Math.min(widthZoom, heightZoom);
      const zoom = Math.min(env.CANVAS_ZOOM_MAX, Math.max(env.CANVAS_ZOOM_MIN, requestedZoom));
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const viewport = {
        x: centerX - width / (2 * zoom),
        y: centerY - height / (2 * zoom),
        zoom,
      };
      if (env.canvasSearchViewportState) env.ensureCanvasStore()?.previewViewport(viewport);
      else env.ensureCanvasStore()?.commitViewport(viewport);
      return true;

  }

  function sameViewport(left, right) {
    return left && right
      && Math.abs((Number(left.x) || 0) - (Number(right.x) || 0)) < 0.001
      && Math.abs((Number(left.y) || 0) - (Number(right.y) || 0)) < 0.001
      && Math.abs((Number(left.zoom) || 0) - (Number(right.zoom) || 0)) < 0.001;
  }

  /** Focus transient search cards while preserving the pre-search viewport. */
  function syncCanvasSearchViewport(searchContext = env.getCanvasSearchContext()) {
    ensureBound('syncCanvasSearchViewport');

      const active = env.isCanvasSearchPreviewActive(searchContext);
      const saved = env.canvasSearchViewportState;
      const currentState = env.canvasStoreSnapshot();
      if (!active) {
        if (!saved) return false;
        env.canvasSearchViewportState = null;
        env.ensureCanvasStore()?.clearViewportPreview({ deferRender: true });
        return true;
      }

      const key = env.canvasSearchPreviewKey(searchContext);
      const currentViewport = currentState.layout?.viewport || env.DEFAULT_CANVAS_VIEWPORT;
      const state = saved || {
        searchKey: '',
      };
      if (!saved) env.canvasSearchViewportState = state;
      if (state.searchKey === key && currentState.viewportPreview) return false;

      const rect = env.canvasViewportEl?.getBoundingClientRect?.();
      const width = env.canvasViewportEl?.clientWidth || rect?.width || 0;
      const height = env.canvasViewportEl?.clientHeight || rect?.height || 0;
      state.searchKey = key;
      if (!width || !height || !searchContext.items.length) {
        env.ensureCanvasStore()?.clearViewportPreview({ deferRender: true });
        return true;
      }
      const layout = env.canvasSearchLayoutFor(searchContext);
      const bounds = env.canvasBoundsForItems(searchContext.items, layout);
      const viewport = env.canvasSearchViewportForBounds(width, height, bounds, {
        padding: env.CANVAS_FIT_PADDING,
        minZoom: env.CANVAS_ZOOM_MIN,
        maxZoom: env.CANVAS_SEARCH_ZOOM_MAX,
      });
      if (!viewport) return false;

      env.canvasSearchViewportState = state;
      if (!sameViewport(currentViewport, viewport)) env.ensureCanvasStore()?.previewViewport(viewport, { deferRender: true });
      return true;

  }

  function canvasPointFromEvent(event) {
    ensureBound('canvasPointFromEvent');

      const rect = env.canvasViewportEl?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const { viewport } = env.canvasLayout;
      const zoom = viewport.zoom || env.DEFAULT_CANVAS_VIEWPORT.zoom;
      return {
        x: (event.clientX - rect.left) / zoom + viewport.x,
        y: (event.clientY - rect.top) / zoom + viewport.y,
      };

  }

  function updateCanvasTransform() {
    ensureBound('updateCanvasTransform');

      const { x, y, zoom } = env.canvasLayout.viewport;
      if (env.canvasWorldEl && env.canvasWorldScaleEl) {
        env.canvasWorldScaleEl.style.zoom = String(zoom);
        env.canvasWorldEl.style.transform = `translate(${-x * zoom}px, ${-y * zoom}px)`;
      }
      if (env.canvasViewportEl) {
        env.canvasViewportEl.style.setProperty('--fx-grid-x', `${(-x * 0.15).toFixed(2)}px`);
        env.canvasViewportEl.style.setProperty('--fx-grid-y', `${(-y * 0.15).toFixed(2)}px`);
      }
      if (env.canvasZoomValue) env.canvasZoomValue.textContent = `${Math.round(zoom * 100)}%`;
      if (env.canvasZoomSlider) env.canvasZoomSlider.value = String(zoom);
      if (env.canvasMinimap) env.canvasMinimap.dataset.zoom = String(zoom);

  }

  function canvasViewportSize() {
    ensureBound('canvasViewportSize');

      const rect = env.canvasViewportEl?.getBoundingClientRect?.();
      return {
        width: Math.max(0, env.canvasViewportEl?.clientWidth || rect?.width || 0),
        height: Math.max(0, env.canvasViewportEl?.clientHeight || rect?.height || 0),
      };

  }

  function closeCanvasZoomMenu({ restoreFocus = false } = {}) {
    ensureBound('closeCanvasZoomMenu');

      if (!env.canvasZoomMenu || !env.canvasZoomValueWrap || !env.canvasZoomValue) return;
      env.canvasZoomMenu.hidden = true;
      env.canvasZoomValueWrap.dataset.menuOpen = 'false';
      env.canvasZoomValue.setAttribute('aria-expanded', 'false');
      if (restoreFocus) env.canvasZoomValue.focus({ preventScroll: true });

  }

  function toggleCanvasZoomMenu() {
    ensureBound('toggleCanvasZoomMenu');

      if (!env.canvasZoomMenu || !env.canvasZoomValueWrap || !env.canvasZoomValue) return;
      const open = env.canvasZoomMenu.hidden;
      env.canvasZoomMenu.hidden = !open;
      env.canvasZoomValueWrap.dataset.menuOpen = open ? 'true' : 'false';
      env.canvasZoomValue.setAttribute('aria-expanded', open ? 'true' : 'false');

  }

  function applyCanvasZoomAction(action) {
    ensureBound('applyCanvasZoomAction');

      if (action === 'reset') env.resetCanvasView();
      else canvasFitViewport(action);
      closeCanvasZoomMenu({ restoreFocus: true });

  }

  function canvasSixCardZoom(viewportWidth) {
    return env.canvasZoomToFitCardColumns(viewportWidth, {
      padding: env.CANVAS_FIT_PADDING,
      minZoom: env.CANVAS_ZOOM_MIN,
      maxZoom: env.CANVAS_ZOOM_MAX,
    });
  }

  function centerCanvasInitialView() {
    ensureBound('centerCanvasInitialView');

      if (env.settings.viewMode !== 'canvas' || env.canvasSessionFallback || !env.canvasViewportEl) return;
      if (!env.canvasNeedsInitialCenter) return;
      const width = env.canvasViewportEl.clientWidth || env.canvasViewportEl.getBoundingClientRect?.().width || 0;
      const height = env.canvasViewportEl.clientHeight || env.canvasViewportEl.getBoundingClientRect?.().height || 0;
      if (!width || !height) return;
      const state = env.canvasStoreSnapshot();
      if (state.pendingOperations?.length || state.interaction) {
        env.canvasNeedsInitialCenter = false;
        return;
      }
      const zoom = canvasSixCardZoom(width);
      if (!env.allTabs.length) {
        return;
      }
      const bounds = env.canvasBoundsForItems(env.allTabs, state.layout);
      if (!bounds) {
        return;
      }
      const viewport = {
        x: (bounds.minX + bounds.maxX) / 2 - width / (2 * zoom),
        y: (bounds.minY + bounds.maxY) / 2 - height / (2 * zoom),
        zoom,
      };
      const store = env.ensureCanvasStore?.();
      if (!store) return;
      if (env.canvasSearchViewportState) store.previewViewport(viewport);
      else store.commitViewport(viewport);
      env.canvasNeedsInitialCenter = false;

  }

  function scheduleInitialCanvasCenter() {
    ensureBound('scheduleInitialCanvasCenter');

      const shouldRun = Boolean(env.canvasNeedsInitialCenter);
      if (!shouldRun || env.canvasInitialCenterRaf) return;
      const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
      env.canvasInitialCenterRaf = schedule(() => {
        env.canvasInitialCenterRaf = 0;
        centerCanvasInitialView();
      });

  }

  function canvasRailResizeDraft(event, state) {
    ensureBound('canvasRailResizeDraft');

      const rawWidth = state.startWidth + event.clientX - state.startX;
      const collapsed = rawWidth < env.CANVAS_RAIL_COLLAPSE_THRESHOLD;
      return {
        // Keep the last valid expanded width while the preview is collapsed so
        // the toggle can restore the user's previous working width.
        canvasRailWidth: collapsed ? env.normalizeCanvasRailWidth(state.startWidth) : env.normalizeCanvasRailWidth(rawWidth),
        canvasRailCollapsed: collapsed,
      };

  }

  function scheduleCanvasRailResizePreview() {
    ensureBound('scheduleCanvasRailResizePreview');

      if (env.canvasRailResizeFrame) return;
      const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 16);
      env.canvasRailResizeFrame = schedule(() => {
        env.canvasRailResizeFrame = 0;
        const state = env.canvasRailResizeState;
        if (!state) return;
        env.applyCanvasRailUi({
          width: state.width,
          collapsed: state.collapsed,
        });
      });

  }

  function flushCanvasRailResizePreview() {
    ensureBound('flushCanvasRailResizePreview');

      if (env.canvasRailResizeFrame) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(env.canvasRailResizeFrame);
        else clearTimeout(env.canvasRailResizeFrame);
        env.canvasRailResizeFrame = 0;
      }
      const state = env.canvasRailResizeState;
      if (state) {
        env.applyCanvasRailUi({
          width: state.width,
          collapsed: state.collapsed,
        });
      }

  }

  function updateCanvasRailResize(event) {
    ensureBound('updateCanvasRailResize');

      const state = env.canvasRailResizeState;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      const next = canvasRailResizeDraft(event, state);
      state.width = next.canvasRailWidth;
      state.collapsed = next.canvasRailCollapsed;
      scheduleCanvasRailResizePreview();

  }

  function endCanvasRailResize({ commit = true } = {}) {
    ensureBound('endCanvasRailResize');

      const state = env.canvasRailResizeState;
      if (!state) return;
      flushCanvasRailResizePreview();
      env.canvasRailResizeState = null;
      env.canvasView?.classList.remove('is-rail-resizing');
      try {
        if (state.pointerId != null) env.canvasRailResize?.releasePointerCapture?.(state.pointerId);
      } catch {
        // ignore
      }
      if (!commit) {
        env.applyCanvasRailUi();
        return;
      }
      env.commitCanvasRailState(state.width, state.collapsed);

  }

  function handleCanvasRailKeydown(event) {
    ensureBound('handleCanvasRailKeydown');

      if (!env.canvasRailResize) return;
      const collapsed = env.settings.canvasRailCollapsed === true;
      const width = env.normalizeCanvasRailWidth(env.settings.canvasRailWidth);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        env.commitCanvasRailState(width, !collapsed);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        env.commitCanvasRailState(width, true);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        env.commitCanvasRailState(env.CANVAS_RAIL_MAX_WIDTH, false);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      if (collapsed) {
        if (event.key === 'ArrowRight') env.commitCanvasRailState(width, false);
        return;
      }
      const delta = event.key === 'ArrowRight' ? env.CANVAS_RAIL_KEYBOARD_STEP : -env.CANVAS_RAIL_KEYBOARD_STEP;
      const nextWidth = width + delta;
      if (nextWidth < env.CANVAS_RAIL_COLLAPSE_THRESHOLD) {
        env.commitCanvasRailState(width, true);
      } else {
        env.commitCanvasRailState(nextWidth, false);
      }

  }

  function cancelCanvasRailResize() {
    ensureBound('cancelCanvasRailResize');

      endCanvasRailResize({ commit: false });

  }

  function initCanvasRailResize() {
    ensureBound('initCanvasRailResize');

      if (!env.canvasRailResize || !env.canvasRailToggle) return;
      env.canvasRailResize.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !event.isPrimary || env.settings.canvasRailCollapsed || env.canvasRailResizeState) return;
        event.preventDefault();
        env.canvasRailResizeState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: env.normalizeCanvasRailWidth(env.settings.canvasRailWidth),
          width: env.normalizeCanvasRailWidth(env.settings.canvasRailWidth),
          collapsed: false,
        };
        env.canvasView?.classList.add('is-rail-resizing');
        try {
          env.canvasRailResize.setPointerCapture?.(event.pointerId);
        } catch {
          // ignore
        }
      });
      window.addEventListener('pointermove', updateCanvasRailResize, true);
      window.addEventListener('pointerup', (event) => {
        if (env.canvasRailResizeState?.pointerId === event.pointerId) endCanvasRailResize();
      }, true);
      window.addEventListener('pointercancel', (event) => {
        if (env.canvasRailResizeState?.pointerId === event.pointerId) cancelCanvasRailResize();
      }, true);
      env.canvasRailResize.addEventListener('lostpointercapture', cancelCanvasRailResize);
      env.canvasRailResize.addEventListener('keydown', handleCanvasRailKeydown);
      env.canvasRailToggle.addEventListener('click', () => {
        env.commitCanvasRailState(env.settings.canvasRailWidth, env.settings.canvasRailCollapsed !== true);
      });
      window.addEventListener('blur', cancelCanvasRailResize);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') cancelCanvasRailResize();
      });

  }

  function openCanvasStackDialog() {
    ensureBound('openCanvasStackDialog');

      if (env.activeCanvasSelection().size < 2) {
        env.showCopyToast(env.t('canvasNeedTwo'));
        return;
      }
      if (!env.canvasStackDialog) return;
      env.closeAllFloatsExcept('canvasStack');
      env.canvasStackDialog.classList.add('open');
      env.canvasStackDialog.setAttribute('aria-hidden', 'false');
      if (env.canvasStackTitle) {
        env.canvasStackTitle.value = '';
        setTimeout(() => env.canvasStackTitle.focus(), 0);
      }
      env.syncFloatBackdrop();

  }

  function closeCanvasStackDialog() {
    ensureBound('closeCanvasStackDialog');

      env.canvasStackDialog?.classList.remove('open');
      env.canvasStackDialog?.setAttribute('aria-hidden', 'true');
      env.syncFloatBackdrop();

  }

  async function createCanvasStackFromSelection() {
    ensureBound('createCanvasStackFromSelection');

      const ids = [...env.activeCanvasSelection()];
      const title = env.canvasStackTitle?.value?.trim() || env.t('canvasNewStack');
      closeCanvasStackDialog();
      const res = await env.sendMessage({ type: 'CREATE_STACK', ids, title });
      if (!res?.ok) {
        env.showCopyToast(env.t('stackFailed'));
        return;
      }
      if (res.undoToken) env.ParkHistory.push({ kind: 'stack', token: res.undoToken });
      env.ensureCanvasStore()?.setSelection([]);
      await env.loadList();
      env.showCopyToast(env.t('stackMerged'));

  }

  async function canvasAction(action) {
    ensureBound('canvasAction');

      if (action === 'delete-connection') {
        env.deleteCanvasConnection();
        return;
      }
      const ids = [...env.activeCanvasSelection()];
      if (!ids.length) return;
      if (action === 'restore') {
        if (ids.length === 1) await env.restoreItem(ids[0]);
        else env.batchRestore?.click();
        return;
      }
      if (action === 'snapshot' && ids.length === 1) {
        const item = env.allTabs.find((candidate) => candidate.id === ids[0]);
        if (item?.kind === 'tab') env.openLightbox(item);
        return;
      }
      if ((action === 'lock' || action === 'unlock' || action === 'relock') && ids.length === 1) {
        const item = env.allTabs.find((candidate) => candidate.id === ids[0]);
        if (item) await env.toggleCardLock?.(item);
        return;
      }
      if (action === 'edit') {
        if (ids.length > 1) {
          env.openBatchEdit(ids);
          return;
        }
        if (ids.length === 1) {
          const item = env.allTabs.find((candidate) => candidate.id === ids[0]);
          if (item?.kind === 'note') env.openStickerNoteEditor(item);
          else if (item) env.openEditBox(item);
        }
        return;
      }
      if (action === 'members' && ids.length === 1) {
        const item = env.allTabs.find((candidate) => candidate.id === ids[0]);
        if (item?.kind === 'group') env.openMembersBox(item);
        return;
      }
      if (action === 'pin') {
        for (const id of ids) {
          const item = env.allTabs.find((candidate) => candidate.id === id);
          if (item) await env.togglePinned(item);
        }
        return;
      }
      if (action === 'stack') {
        openCanvasStackDialog();
        return;
      }
      if (action === 'delete') {
        env.batchDelete?.click();
      }

  }

  function canvasBlankContextMenuEntries() {
    ensureBound('canvasBlankContextMenuEntries');

      return [
        { action: 'sort-date', label: env.t('canvasCtxSortDate') },
        { action: 'arrange-align', label: env.t('canvasCtxArrangeAlign') },
        { action: 'backup-lite', label: env.t('canvasCtxBackup') },
        { action: 'add-note', label: env.t('canvasCtxAddNote') },
        { action: 'add-image', label: env.t('canvasCtxAddImage') },
      ];

  }

  function renderCanvasContextMenuItems(mode, item) {
    ensureBound('renderCanvasContextMenuItems');

      if (!env.canvasContextMenu) return;
      env.canvasContextMenu.innerHTML = '';
      const entries = mode === 'node'
        ? env.canvasNodeActionEntries(item).map(({ action, label }) => ({
          action,
          label,
          danger: action === 'delete',
        }))
        : canvasBlankContextMenuEntries();
      for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.dataset.canvasCtx = entry.action;
        button.textContent = entry.label;
        if (entry.danger) button.classList.add('danger');
        env.canvasContextMenu.appendChild(button);
      }

  }

  function openCanvasContextMenu(clientX, clientY, options = {}) {
    ensureBound('openCanvasContextMenu');

      if (!env.canvasContextMenu) return;
      const mode = options.mode === 'node' ? 'node' : 'blank';
      const itemId = mode === 'node' ? String(options.itemId || '') : '';
      const item = itemId ? env.canvasItemById(itemId) : null;
      if (mode === 'node' && !item) return;
      env.canvasContextMenuState = {
        mode,
        itemId,
        worldPoint: options.worldPoint
          ? { x: options.worldPoint.x, y: options.worldPoint.y }
          : null,
      };
      renderCanvasContextMenuItems(mode, item);
      env.canvasContextMenu.hidden = false;
      env.canvasContextMenu.setAttribute('aria-hidden', 'false');
      // Measure after unhide so we can clamp within the window.
      const rect = env.canvasContextMenu.getBoundingClientRect();
      const pad = 8;
      const left = Math.max(pad, Math.min(clientX, window.innerWidth - rect.width - pad));
      const top = Math.max(pad, Math.min(clientY, window.innerHeight - rect.height - pad));
      env.canvasContextMenu.style.left = `${Math.round(left)}px`;
      env.canvasContextMenu.style.top = `${Math.round(top)}px`;
      env.canvasContextMenu.querySelector('button[role="menuitem"]')?.focus?.({ preventScroll: true });

  }

  function closeCanvasContextMenu() {
    ensureBound('closeCanvasContextMenu');

      if (!env.canvasContextMenu) return;
      env.canvasContextMenu.hidden = true;
      env.canvasContextMenu.setAttribute('aria-hidden', 'true');
      env.canvasContextMenu.innerHTML = '';
      env.canvasContextMenuState = { mode: 'blank', itemId: '', worldPoint: null };

  }

  async function handleCanvasContextMenuAction(action) {
    ensureBound('handleCanvasContextMenuAction');

      const state = {
        mode: env.canvasContextMenuState.mode,
        itemId: env.canvasContextMenuState.itemId,
        worldPoint: env.canvasContextMenuState.worldPoint
          ? { ...env.canvasContextMenuState.worldPoint }
          : null,
      };
      closeCanvasContextMenu();
      if (state.mode === 'node') {
        await env.runCanvasNodeAction(state.itemId, action);
        return;
      }
      switch (action) {
        case 'sort-date': {
          const sortBy = env.normalizeSortBy('newest');
          if (env.sortByEl) env.sortByEl.value = sortBy;
          env.settings.sortBy = sortBy;
          await env.saveSettings({ sortBy });
          env.renderGrid();
          env.showCopyToast(env.t('canvasCtxSortedDate'));
          break;
        }
        case 'arrange-align':
          env.arrangeCanvas('align');
          break;
        case 'backup-lite':
          await env.exportLiteBackup({ toast: true });
          break;
        case 'add-note':
          env.placeStickerNoteAt(state.worldPoint || env.canvasWorldViewportCenter());
          break;
        case 'add-image':
          env.pickImageCardFiles(state.worldPoint || env.canvasWorldViewportCenter());
          break;
        default:
          break;
      }

  }

  global.TabWallCanvasChrome = { bind, setCanvasZoom, canvasFitViewport, syncCanvasSearchViewport, canvasPointFromEvent, updateCanvasTransform, canvasViewportSize, closeCanvasZoomMenu, toggleCanvasZoomMenu, applyCanvasZoomAction, centerCanvasInitialView, scheduleInitialCanvasCenter, canvasRailResizeDraft, scheduleCanvasRailResizePreview, flushCanvasRailResizePreview, updateCanvasRailResize, endCanvasRailResize, handleCanvasRailKeydown, cancelCanvasRailResize, initCanvasRailResize, openCanvasStackDialog, closeCanvasStackDialog, createCanvasStackFromSelection, canvasAction, canvasBlankContextMenuEntries, renderCanvasContextMenuItems, openCanvasContextMenu, closeCanvasContextMenu, handleCanvasContextMenuAction };
})(typeof self !== 'undefined' ? self : globalThis);
