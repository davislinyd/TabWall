(function (global) {
  'use strict';
  let env = null;
  function bind(next) { if (next && typeof next === 'object') env = next; }
  function ensureBound(n) { if (!env) throw new Error('TabWallCanvasInteraction.' + n + ' used before bind()'); }

  function beginCanvasConnectionDrag({
  event,
  kind,
  zone = '',
  movingEndpoint = '',
  sourceId = '',
  side = '',
  connection = null,
  connectionId = '',
}) {
    ensureBound('beginCanvasConnectionDrag');

      if (!env.canvasViewportEl || env.canvasConnectionDragState || event?.button !== 0) return;
      const point = env.canvasPointFromEvent(event);
      let state;
      if (kind === 'handle') {
        const source = env.canvasConnectionPosition(sourceId);
        if (!source) return;
        state = {
          kind,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          sourceId,
          movingId: sourceId,
          side,
          startPoint: env.canvasConnectionHandlePointForId(sourceId, source, side),
          currentPoint: point,
          targetId: '',
          moved: false,
        };
      } else if (kind === 'curve') {
        const source = env.canvasConnectionPosition(connection?.sourceId);
        const target = env.canvasConnectionPosition(connection?.targetId);
        if (!connection || !source || !target) return;
        state = {
          kind,
          zone,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          connectionId,
          connection: { ...connection },
          sourceId: connection.sourceId,
          targetId: '',
          fixedId: connection.targetId,
          startPoint: point,
          currentPoint: point,
          initialCurveOffset: env.normalizeCanvasCurveOffset(connection.curveOffset),
          curveOffset: env.normalizeCanvasCurveOffset(connection.curveOffset),
          moved: false,
        };
      } else {
        const source = env.canvasConnectionPosition(connection?.sourceId);
        const target = env.canvasConnectionPosition(connection?.targetId);
        if (!connection || !source || !target) return;
        const sourceCenter = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
        const targetCenter = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
        const sourceDistance = Math.hypot(point.x - sourceCenter.x, point.y - sourceCenter.y);
        const targetDistance = Math.hypot(point.x - targetCenter.x, point.y - targetCenter.y);
        const resolvedMovingEndpoint = movingEndpoint === 'sourceId' || movingEndpoint === 'targetId'
          ? movingEndpoint
          : sourceDistance <= targetDistance ? 'sourceId' : 'targetId';
        const movingId = connection[resolvedMovingEndpoint];
        const fixedId = connection[resolvedMovingEndpoint === 'sourceId' ? 'targetId' : 'sourceId'];
        state = {
          kind,
          zone,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          connectionId,
          connection: { ...connection },
          movingEndpoint: resolvedMovingEndpoint,
          movingId,
          fixedId,
          startPoint: point,
          currentPoint: point,
          targetId: '',
          moved: false,
        };
      }
      env.canvasConnectionDragState = state;
      try {
        env.canvasViewportEl.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic or cancelled pointer events may not have an active capture target.
      }
      env.canvasViewportEl.classList.add('is-connection-dragging');
      updateCanvasNodeSelection();
      env.renderCanvasConnections();
      event.preventDefault();

  }

  function updateCanvasConnectionDrag(event) {
    ensureBound('updateCanvasConnectionDrag');

      const state = env.canvasConnectionDragState;
      if (!state || state.pointerId !== event.pointerId) return;
      const point = env.canvasPointFromEvent(event);
      state.currentPoint = point;
      if (Math.hypot(event.clientX - (state.startClientX ?? event.clientX), event.clientY - (state.startClientY ?? event.clientY)) >= env.DRAG_THRESHOLD) {
        state.moved = true;
      }
      if (!state.moved && Math.hypot(point.x - state.startPoint.x, point.y - state.startPoint.y) * (env.canvasLayout.viewport.zoom || 1) >= env.DRAG_THRESHOLD) {
        state.moved = true;
      }
      if (state.kind === 'curve') {
        const zoom = env.canvasStoreSnapshot().layout?.viewport?.zoom || 1;
        const dx = point.x - state.startPoint.x;
        const dy = point.y - state.startPoint.y;
        state.curveOffset = env.normalizeCanvasCurveOffset({
          x: state.initialCurveOffset.x + dx,
          y: state.initialCurveOffset.y + dy,
        });
        state.targetId = '';
        if (Math.hypot(dx, dy) * zoom < env.DRAG_THRESHOLD) state.curveOffset = state.initialCurveOffset;
      } else {
        state.targetId = state.moved
          ? canvasConnectionDragTarget(event, state.movingId || state.sourceId, state.fixedId || '')
          : '';
      }
      updateCanvasNodeSelection();
      env.renderCanvasConnections();
      event.preventDefault();

  }

  function commitCanvasConnectionDrag() {
    ensureBound('commitCanvasConnectionDrag');

      const state = env.canvasConnectionDragState;
      if (!state?.moved) return false;
      const current = env.canvasStoreSnapshot().layout?.connections || [];
      if (state.kind === 'curve') {
        const next = current.map((connection) => {
          if (env.canvasConnectionId(connection.sourceId, connection.targetId) !== state.connectionId) return connection;
          const curveOffset = env.normalizeCanvasCurveOffset(state.curveOffset);
          return {
            sourceId: connection.sourceId,
            targetId: connection.targetId,
            ...(curveOffset.x || curveOffset.y ? { curveOffset } : {}),
          };
        });
        if (!next.some((connection) => env.canvasConnectionId(connection.sourceId, connection.targetId) === state.connectionId)) return false;
        env.canvasStore?.commitConnections(next);
        return true;
      }
      if (!state.targetId) return false;
      if (state.kind === 'handle') {
        if (state.targetId === state.sourceId) return false;
        env.canvasStore?.commitConnections([...current, { sourceId: state.sourceId, targetId: state.targetId }]);
        return true;
      }
      if (state.targetId === state.fixedId || state.targetId === state.movingId) return false;
      const next = current.map((connection) => {
        if (env.canvasConnectionId(connection.sourceId, connection.targetId) !== state.connectionId) return connection;
        return {
          sourceId: state.movingEndpoint === 'sourceId' ? state.targetId : state.fixedId,
          targetId: state.movingEndpoint === 'targetId' ? state.targetId : state.fixedId,
        };
      });
      env.canvasStore?.commitConnections(next);
      return true;

  }

  function endCanvasConnectionDrag(event = null, commit = true) {
    ensureBound('endCanvasConnectionDrag');

      const state = env.canvasConnectionDragState;
      if (!state || (event && state.pointerId !== event.pointerId)) return;
      if (event) updateCanvasConnectionDrag(event);
      const moved = state.moved;
      const connectionId = state.connectionId;
      const shouldSelect = commit && !moved && Boolean(connectionId);
      if (commit) commitCanvasConnectionDrag();
      if (moved && connectionId) env.canvasConnectionClickSuppressUntil.set(connectionId, Date.now() + 300);
      try {
        env.canvasViewportEl?.releasePointerCapture?.(state.pointerId);
      } catch {
        // ignore
      }
      env.canvasConnectionDragState = null;
      env.canvasViewportEl?.classList.remove('is-connection-dragging');
      if (shouldSelect) {
        selectCanvasConnection(connectionId);
        return;
      }
      updateCanvasNodeSelection();
      env.renderCanvasConnections();

  }

  function cancelCanvasConnectionDrag() {
    ensureBound('cancelCanvasConnectionDrag');

      endCanvasConnectionDrag(null, false);

  }

  function resetCanvasConnectionCurve(connectionId) {
    ensureBound('resetCanvasConnectionCurve');

      if (!connectionId) return;
      cancelCanvasConnectionDrag();
      const current = env.canvasStoreSnapshot().layout?.connections || [];
      let changed = false;
      const next = current.map((connection) => {
        if (env.canvasConnectionId(connection.sourceId, connection.targetId) !== connectionId) return connection;
        if (!connection.curveOffset) return connection;
        changed = true;
        return { sourceId: connection.sourceId, targetId: connection.targetId };
      });
      env.selectedCanvasConnectionId = '';
      env.canvasConnectionSourceId = '';
      if (changed) env.canvasStore?.commitConnections(next);
      else env.renderCanvasConnections();
      updateCanvasNodeSelection();
      env.updateBatchBar();

  }

  function selectCanvasConnection(connectionId) {
    ensureBound('selectCanvasConnection');

      env.selectedCanvasConnectionId = connectionId || '';
      env.canvasConnectionSourceId = '';
      if (env.selectedCanvasConnectionId) env.ensureCanvasStore()?.setSelection([]);
      updateCanvasNodeSelection();
      env.renderCanvasConnections();
      env.canvasViewportEl?.focus?.({ preventScroll: true });
      env.updateBatchBar();

  }

  function clearCanvasConnectionSelection() {
    ensureBound('clearCanvasConnectionSelection');

      env.selectedCanvasConnectionId = '';
      env.canvasConnectionSourceId = '';
      updateCanvasNodeSelection();
      env.renderCanvasConnections();
      env.updateBatchBar();

  }

  function deleteCanvasConnection(connectionId = env.selectedCanvasConnectionId) {
    ensureBound('deleteCanvasConnection');

      if (!connectionId) return;
      const state = env.canvasStoreSnapshot();
      const connections = (state.layout.connections || []).filter(
        (connection) => env.canvasConnectionId(connection.sourceId, connection.targetId) !== connectionId
      );
      env.selectedCanvasConnectionId = '';
      const store = env.ensureCanvasStore();
      if (store) store.commitConnections(connections);
      else env.renderCanvasConnections();
      updateCanvasNodeSelection();
      env.updateBatchBar();

  }

  function handleCanvasConnectionNodeClick(id) {
    ensureBound('handleCanvasConnectionNodeClick');

      if (!id) {
        env.canvasConnectionSourceId = '';
        updateCanvasNodeSelection();
        return;
      }
      if (env.canvasConnectionSourceId === id) {
        env.canvasConnectionSourceId = '';
        updateCanvasNodeSelection();
        return;
      }
      if (!env.canvasConnectionSourceId) {
        env.canvasConnectionSourceId = id;
        env.selectedCanvasConnectionId = '';
        updateCanvasNodeSelection();
        env.renderCanvasConnections();
        env.updateBatchBar();
        return;
      }
      const sourceId = env.canvasConnectionSourceId;
      const targetId = id;
      const state = env.canvasStoreSnapshot();
      const next = [...(state.layout.connections || []), { sourceId, targetId }];
      env.canvasConnectionSourceId = '';
      env.selectedCanvasConnectionId = '';
      env.canvasStore?.commitConnections(next);

  }

  function handleCanvasConnectionClick(event, connectionId) {
    ensureBound('handleCanvasConnectionClick');

      event.preventDefault();
      event.stopPropagation();
      const suppressedUntil = env.canvasConnectionClickSuppressUntil.get(connectionId) || 0;
      if (suppressedUntil) {
        env.canvasConnectionClickSuppressUntil.delete(connectionId);
        if (Date.now() <= suppressedUntil) return;
      }
      selectCanvasConnection(connectionId);

  }

  function handleCanvasConnectionDoubleClick(event, connectionId) {
    ensureBound('handleCanvasConnectionDoubleClick');

      event.preventDefault();
      event.stopPropagation();
      resetCanvasConnectionCurve(connectionId);

  }

  function setCanvasConnectionZoneHover(connectionId, zone, active) {
    ensureBound('setCanvasConnectionZoneHover');

      const paths = env.canvasConnectionsEl?.querySelectorAll('.canvas-connection-zone-highlight, .canvas-connection');
      paths?.forEach((path) => {
        if (path.dataset.connectionId !== connectionId) return;
        if (path.classList.contains('canvas-connection-zone-highlight')) {
          path.classList.toggle('is-visible', active && path.dataset.connectionZone === zone);
        } else {
          path.classList.toggle(`zone-hover-${zone}`, active);
        }
      });

  }

  function detectCanvasConnectionDoublePointerDown(connectionId, event) {
    ensureBound('detectCanvasConnectionDoublePointerDown');

      const now = Date.now();
      const previous = env.canvasConnectionPointerDownAt.get(connectionId) || 0;
      if (previous && now - previous <= env.CANVAS_NODE_CLICK_DELAY) {
        env.canvasConnectionPointerDownAt.delete(connectionId);
        event.preventDefault();
        event.stopPropagation();
        env.canvasConnectionClickSuppressUntil.set(connectionId, now + env.CANVAS_NODE_CLICK_DELAY);
        resetCanvasConnectionCurve(connectionId);
        return true;
      }
      env.canvasConnectionPointerDownAt.set(connectionId, now);
      setTimeout(() => {
        if ((env.canvasConnectionPointerDownAt.get(connectionId) || 0) === now) {
          env.canvasConnectionPointerDownAt.delete(connectionId);
        }
      }, env.CANVAS_NODE_CLICK_DELAY + 40);
      return false;

  }

  function wireCanvasConnectionPath(path, connection, connectionId, zone = '') {
    ensureBound('wireCanvasConnectionPath');

      if (zone) {
        path.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || event.isPrimary === false) return;
          if (detectCanvasConnectionDoublePointerDown(connectionId, event)) return;
          event.preventDefault();
          event.stopPropagation();
          // Path elements are now created once and reused across renders (see
          // renderCanvasConnections), so the closed-over `connection` can be
          // stale if curveOffset changed since creation — look up the live one.
          const live = (env.canvasStoreSnapshot().layout?.connections || []).find(
            (c) => env.canvasConnectionId(c.sourceId, c.targetId) === connectionId
          ) || connection;
          beginCanvasConnectionDrag({
            event,
            kind: zone === 'curve' ? 'curve' : 'edge',
            zone,
            movingEndpoint: zone === 'source' ? 'sourceId' : zone === 'target' ? 'targetId' : '',
            connection: live,
            connectionId,
          });
        });
        path.addEventListener('pointerenter', () => setCanvasConnectionZoneHover(connectionId, zone, true));
        path.addEventListener('pointerleave', () => setCanvasConnectionZoneHover(connectionId, zone, false));
      }
      path.addEventListener('click', (event) => handleCanvasConnectionClick(event, connectionId));
      path.addEventListener('dblclick', (event) => handleCanvasConnectionDoubleClick(event, connectionId));
      path.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteCanvasConnection(connectionId);
        }
      });

  }

  function wireCanvasLinkHandles(node) {
    ensureBound('wireCanvasLinkHandles');

      node?.querySelectorAll('[data-canvas-link-handle]').forEach((handle) => {
        handle.tabIndex = 0;
        handle.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || event.isPrimary === false) return;
          event.preventDefault();
          event.stopPropagation();
          beginCanvasConnectionDrag({
            event,
            kind: 'handle',
            sourceId: node.dataset.id,
            side: handle.dataset.canvasLinkHandle || 'right',
          });
        });
        handle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      });

  }

  function wireCanvasNodeActions(node) {
    ensureBound('wireCanvasNodeActions');

      if (!node || node.dataset.canvasWired === '1') return;
      const item = env.canvasItemById(node.dataset.id);
      if (!item) return;
      node.dataset.canvasWired = '1';
      wireCanvasLinkHandles(node);
      node.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.detail === 0 || isCanvasControlTarget(event.target)) return;
        if (env.isMultiSelectModifier(event)) {
          cancelCanvasNodeClick(item.id);
          return;
        }
        if (env.canvasActiveTool !== 'select') return;
        const suppressedUntil = env.canvasNodeClickSuppressUntil.get(item.id) || 0;
        if (suppressedUntil) {
          env.canvasNodeClickSuppressUntil.delete(item.id);
          if (Date.now() <= suppressedUntil) return;
        }
        if (event.detail > 1) {
          cancelCanvasNodeClick(item.id);
          return;
        }
        scheduleCanvasNodePreview(item);
      });
      node.querySelectorAll('[data-canvas-node-action]').forEach((button) => {
        button.addEventListener('pointerdown', (event) => event.stopPropagation());
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await runCanvasNodeAction(item.id, button.dataset.canvasNodeAction || '');
        });
      });

  }

  function updateCanvasNodeSelection() {
    ensureBound('updateCanvasNodeSelection');

      const selection = env.activeCanvasSelection();
      for (const [id, node] of env.canvasNodeElements) {
        const active = selection.has(id);
        node.classList.toggle('selected', active);
        node.classList.toggle('connection-source', env.canvasConnectionSourceId === id);
        node.classList.toggle('connection-target', Boolean(env.canvasConnectionDragState?.targetId === id && env.canvasConnectionDragState?.sourceId !== id));
        node.setAttribute('aria-selected', active ? 'true' : 'false');
      }

  }

  function beginCanvasPointer(event, kind, id = '') {
    ensureBound('beginCanvasPointer');

      if (event.button != null && event.button !== 0 && !(kind === 'pan' && event.button === 1)) return;
      const point = env.canvasPointFromEvent(event);
      if (kind === 'node') {
        cancelCanvasNodeClick(id);
        env.canvasNodeClickSuppressUntil.delete(id);
        env.canvasSelectNode(id, event);
      }
      const ids = kind === 'node' ? [...env.activeCanvasSelection()] : [];
      const searchPreview = kind === 'node' && env.isCanvasSearchPreviewActive();
      let searchIds = [];
      let searchStartPositions = {};
      if (searchPreview) {
        const searchContext = env.getCanvasSearchContext();
        const renderLayout = env.canvasSearchLayoutFor(searchContext);
        const visibleIds = new Set(searchContext.items.map((item) => item.id));
        searchIds = ids.filter((selectedId) => visibleIds.has(selectedId) && renderLayout.positions?.[selectedId]);
        searchStartPositions = Object.fromEntries(
          searchIds.map((selectedId) => [selectedId, { ...renderLayout.positions[selectedId] }])
        );
      } else {
        env.ensureCanvasStore()?.beginPointer(kind, {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          ids,
        });
      }
      env.canvasPointerState = {
        kind,
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startPoint: point,
        moved: false,
        selectionAdditive: Boolean(event.metaKey || event.ctrlKey || event.shiftKey),
        initialSelection: [...env.activeCanvasSelection()],
        searchPreview,
        searchIds,
        searchStartPositions,
      };
      env.canvasInteractionGeneration += 1;
      env.canvasViewportEl?.setPointerCapture?.(event.pointerId);
      env.canvasViewportEl?.classList.toggle('is-panning', kind === 'pan');
      if (kind !== 'node') event.preventDefault();

  }

  function updateCanvasPointer(event) {
    ensureBound('updateCanvasPointer');

      env.canvasLastPointerEvent = event;
      env.canvasQueuedPointerEvent = event;
      if (env.canvasPointerRaf) return;
      const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
      env.canvasPointerRaf = schedule(() => {
        env.canvasPointerRaf = 0;
        const next = env.canvasQueuedPointerEvent;
        env.canvasQueuedPointerEvent = null;
        if (next) applyCanvasPointer(next);
      });

  }

  async function endCanvasPointer(event) {
    ensureBound('endCanvasPointer');

      const state = env.canvasPointerState;
      if (!state || state.pointerId !== event.pointerId) return;
      env.flushCanvasPointerFrame(event);
      if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= env.DRAG_THRESHOLD) state.moved = true;
      const pointerGeneration = env.canvasInteractionGeneration;
      const finalPoint = env.canvasPointFromEvent(event);
      const operation = state.searchPreview
        ? null
        : env.ensureCanvasStore()?.finishPointer({
            commit: state.moved,
            snap: state.kind === 'node' && env.canvasSnapToGrid,
          });
      if (state.searchPreview) env.finishCanvasSearchPointer(state, state.moved);
      env.clearCanvasPointerUi(event.pointerId);
      if (state.kind === 'node') {
        if (state.moved) {
          cancelCanvasNodeClick(state.id);
          suppressCanvasNodeClick(state.id);
        }
        if (!state.moved) {
          const item = env.canvasItemById(state.id);
          if (item && env.canvasActiveTool === 'select' && !state.selectionAdditive) scheduleCanvasNodePreview(item);
          updateCanvasNodeSelection();
          env.updateBatchBar();
          return;
        }
        if (state.searchPreview) {
          updateCanvasNodeSelection();
          env.updateBatchBar();
          return;
        }
        let stacked = false;
        if (env.activeCanvasSelection().size === 1) {
          const targetId = env.canvasTargetAt(finalPoint, state.id);
          if (targetId) {
            await env.ensureCanvasStore()?.flush?.();
            if (pointerGeneration !== env.canvasInteractionGeneration) return;
            const result = await env.sendMessage({ type: 'STACK_ITEMS', sourceId: state.id, targetId });
            if (result?.ok) {
              stacked = true;
              env.ensureCanvasStore()?.setSelection([]);
              env.selectMode = false;
              await env.loadList();
            }
          }
        }
        if (!stacked) env.ensureCanvasStore()?.flush?.();
        updateCanvasNodeSelection();
        env.updateBatchBar();
      } else if (state.kind === 'pan' && state.moved) {
        env.ensureCanvasStore()?.flush?.();
      }

  }

  function syncCanvasNodeDragFx(state, event) {
    const nodes = env.canvasNodeElements;
    if (!nodes) return;
    const dragging = Boolean(state?.kind === 'node' && state.moved);
    let dragIds = new Set();
    if (dragging) {
      if (state.searchPreview && state.searchIds?.length) dragIds = new Set(state.searchIds);
      else {
        const selection = env.activeCanvasSelection?.();
        if (selection) dragIds = new Set(selection);
      }
    }
    let hoverId = '';
    if (dragging && dragIds.size === 1 && event) {
      hoverId = env.canvasTargetAt(env.canvasPointFromEvent(event), state.id) || '';
    }
    nodes.forEach((node, id) => {
      node.classList.toggle('dragging', dragIds.has(id));
      node.classList.toggle('stack-hover', Boolean(hoverId && id === hoverId));
    });
  }

  let tiltedCanvasNode = null;

  function clearCanvasNodeTilt() {
    if (!tiltedCanvasNode) return;
    tiltedCanvasNode.style.removeProperty('--tilt-x');
    tiltedCanvasNode.style.removeProperty('--tilt-y');
    tiltedCanvasNode.classList.remove('is-tilting');
    tiltedCanvasNode = null;
  }

  function updateCanvasNodeTilt(event) {
    if (document.documentElement.dataset.fx !== 'cinematic') {
      clearCanvasNodeTilt();
      return;
    }
    if (env.canvasPointerState?.kind === 'node' && env.canvasPointerState.moved) {
      clearCanvasNodeTilt();
      return;
    }
    const node = event.target.closest?.('.canvas-node');
    if (!node || node.classList.contains('dragging')) {
      clearCanvasNodeTilt();
      return;
    }
    if (tiltedCanvasNode && tiltedCanvasNode !== node) clearCanvasNodeTilt();
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
    const py = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
    node.style.setProperty('--tilt-x', `${(-py * 8).toFixed(2)}deg`);
    node.style.setProperty('--tilt-y', `${(px * 8).toFixed(2)}deg`);
    node.classList.add('is-tilting');
    tiltedCanvasNode = node;
  }

  function applyCanvasPointer(event) {
    ensureBound('applyCanvasPointer');

      const state = env.canvasPointerState;
      if (!state || state.pointerId !== event.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (Math.hypot(dx, dy) >= env.DRAG_THRESHOLD) state.moved = true;
      if (state.kind === 'node') {
        const zoom = env.canvasStoreSnapshot().layout.viewport.zoom || 1;
        if (state.searchPreview) {
          env.applyCanvasSearchPointerPreview(state, dx / zoom, dy / zoom);
          syncCanvasNodeDragFx(state, event);
          return;
        }
        env.ensureCanvasStore()?.previewPointer({ dx: dx / zoom, dy: dy / zoom, moved: state.moved });
        syncCanvasNodeDragFx(state, event);
        return;
      }
      if (state.kind === 'pan') {
        const zoom = env.canvasStoreSnapshot().layout.viewport.zoom || 1;
        env.ensureCanvasStore()?.previewPointer({ dx: -dx / zoom, dy: -dy / zoom, moved: state.moved });
        return;
      }
      if (state.kind === 'lasso') {
        const current = env.canvasPointFromEvent(event);
        const x = Math.min(state.startPoint.x, current.x);
        const y = Math.min(state.startPoint.y, current.y);
        const w = Math.abs(current.x - state.startPoint.x);
        const h = Math.abs(current.y - state.startPoint.y);
        if (env.canvasSelectionEl) {
          env.canvasSelectionEl.hidden = false;
          env.canvasSelectionEl.style.left = `${x}px`;
          env.canvasSelectionEl.style.top = `${y}px`;
          env.canvasSelectionEl.style.width = `${w}px`;
          env.canvasSelectionEl.style.height = `${h}px`;
        }
        const ids = [...env.canvasNodeElements.keys()]
          .map((id) => ({ id, rect: env.canvasNodeWorldRectFromState(id) }))
          .filter(({ rect }) => rect && rect.x < x + w && rect.x + rect.w > x && rect.y < y + h && rect.y + rect.h > y)
          .map(({ id }) => id)
          .filter(Boolean);
        const nextSelection = state.selectionAdditive
          ? [...new Set([...state.initialSelection, ...ids])]
          : ids;
        env.setCanvasSelection(nextSelection);
      }

  }

  function handleCanvasMiddleClick(event) {
    ensureBound('handleCanvasMiddleClick');

      if (event.button !== 1) return;
      if (isCanvasControlTarget(event.target)) {
        env.clearCanvasMiddleClickSequence();
        return;
      }
      event.preventDefault();
      const now = Date.now();
      if (env.canvasLastMiddleClickAt && now - env.canvasLastMiddleClickAt <= env.CANVAS_MIDDLE_CLICK_DELAY) {
        env.clearCanvasMiddleClickSequence();
        env.resetCanvasView();
        return;
      }
      env.clearCanvasMiddleClickSequence();
      env.canvasLastMiddleClickAt = now;
      env.canvasMiddleClickTimer = setTimeout(env.clearCanvasMiddleClickSequence, env.CANVAS_MIDDLE_CLICK_DELAY);

  }

  function beginCanvasMinimapDrag(event) {
    ensureBound('beginCanvasMinimapDrag');

      if (!env.canvasMinimapViewport || event.button !== 0 || !event.isPrimary || env.canvasMinimapDragState) return;
      env.renderCanvasMinimap(env.getCanvasVisibleTabs());
      const projection = env.canvasMinimapProjection;
      if (!projection) return;
      const viewport = env.canvasStoreSnapshot().layout.viewport;
      env.canvasMinimapDragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startViewport: { ...viewport },
        projection,
      };
      env.canvasMinimap.classList.add('is-dragging');
      env.canvasMinimapViewport.setPointerCapture?.(event.pointerId);
      env.ensureCanvasStore()?.beginPointer('pan', {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      });
      event.preventDefault();
      event.stopPropagation();

  }

  function updateCanvasMinimapDrag(event) {
    ensureBound('updateCanvasMinimapDrag');

      const state = env.canvasMinimapDragState;
      if (!state || state.pointerId !== event.pointerId) return;
      const dx = (event.clientX - state.startX) / Math.max(0.0001, state.projection.scale);
      const dy = (event.clientY - state.startY) / Math.max(0.0001, state.projection.scale);
      env.ensureCanvasStore()?.previewPointer({ dx, dy, moved: Math.hypot(dx, dy) >= 1 });
      event.preventDefault();

  }

  function endCanvasMinimapDrag({ event = null, commit = true } = {}) {
    ensureBound('endCanvasMinimapDrag');

      const state = env.canvasMinimapDragState;
      if (!state) return;
      if (event && event.pointerId !== state.pointerId) return;
      env.ensureCanvasStore()?.finishPointer({ commit });
      try {
        env.canvasMinimapViewport?.releasePointerCapture?.(state.pointerId);
      } catch {
        // ignore
      }
      env.canvasMinimapDragState = null;
      env.canvasMinimapProjection = null;
      env.canvasMinimap?.classList.remove('is-dragging');
      env.renderCanvasMinimap(env.getCanvasVisibleTabs());
      if (commit) env.ensureCanvasStore()?.flush?.();

  }

  function initCanvasInteractions() {
    ensureBound('initCanvasInteractions');

      if (!env.canvasViewportEl) return;
      env.canvasViewportEl.addEventListener('contextmenu', (event) => {
        const node = event.target.closest?.('.canvas-node');
        if (node) {
          event.preventDefault();
          const id = node.dataset.id || '';
          if (!id) return;
          env.ensureCanvasStore()?.setSelection([id]);
          updateCanvasNodeSelection();
          env.updateBatchBar();
          env.openCanvasContextMenu(event.clientX, event.clientY, { mode: 'node', itemId: id });
          return;
        }
        if (isCanvasControlTarget(event.target)) return;
        event.preventDefault();
        env.openCanvasContextMenu(event.clientX, event.clientY, {
          mode: 'blank',
          worldPoint: env.canvasPointFromEvent(event),
        });
      });
      env.canvasContextMenu?.addEventListener('click', (event) => {
        const btn = event.target.closest?.('[data-canvas-ctx]');
        if (!btn || !env.canvasContextMenu.contains(btn)) return;
        event.preventDefault();
        env.handleCanvasContextMenuAction(btn.dataset.canvasCtx || '');
      });
      document.addEventListener('pointerdown', (event) => {
        if (!env.isCanvasContextMenuOpen()) return;
        if (event.target.closest?.('#canvasContextMenu')) return;
        env.closeCanvasContextMenu();
      }, true);
      env.canvasViewportEl.addEventListener('pointerdown', (event) => {
        if (env.isCanvasContextMenuOpen() && !event.target.closest?.('#canvasContextMenu')) {
          env.closeCanvasContextMenu();
        }
        if (event.button === 1) {
          handleCanvasMiddleClick(event);
          if (!isCanvasControlTarget(event.target)) beginCanvasPointer(event, 'pan');
          return;
        }
        env.clearCanvasMiddleClickSequence();
        if (isCanvasControlTarget(event.target)) return;
        const node = event.target.closest?.('.canvas-node');
        if (event.button === 0 && !node && (env.selectedCanvasConnectionId || env.canvasConnectionSourceId)) {
          clearCanvasConnectionSelection();
        }
        if (env.canvasNotePlacementArmed && event.button === 0) {
          if (node) return;
          event.preventDefault();
          env.placeStickerNoteAt(env.canvasPointFromEvent(event));
          return;
        }
        if (env.canvasActiveTool === 'link') {
          if (event.button !== 0) return;
          handleCanvasConnectionNodeClick(node?.dataset.id || '');
          event.preventDefault();
          return;
        }
        if (node && env.canvasActiveTool === 'select' && !env.canvasSpacePressed) {
          beginCanvasPointer(event, 'node', node.dataset.id);
          node.focus({ preventScroll: true });
          return;
        }
        if (env.canvasActiveTool === 'area') {
          beginCanvasPointer(event, 'lasso');
          return;
        }
        if (env.canvasActiveTool === 'select' || env.canvasSpacePressed) {
          beginCanvasPointer(event, 'pan');
        }
      });
      env.canvasViewportEl.addEventListener('pointermove', updateCanvasPointer);
      env.canvasViewportEl.addEventListener('pointermove', updateCanvasNodeTilt);
      env.canvasViewportEl.addEventListener('pointerleave', clearCanvasNodeTilt);
      env.canvasViewportEl.addEventListener('pointerup', endCanvasPointer);
      env.canvasViewportEl.addEventListener('pointercancel', env.cancelCanvasPointer);
      env.canvasViewportEl.addEventListener('lostpointercapture', () => {
        if (env.canvasPointerState) env.cancelCanvasPointer();
        if (env.canvasConnectionDragState) cancelCanvasConnectionDrag();
      });
      window.addEventListener('blur', () => {
        env.cancelCanvasPointer();
        cancelCanvasConnectionDrag();
      });
      env.canvasMinimapViewport?.addEventListener('pointerdown', beginCanvasMinimapDrag);
      window.addEventListener('pointermove', updateCanvasMinimapDrag, true);
      window.addEventListener('pointermove', updateCanvasConnectionDrag, true);
      window.addEventListener('pointerup', (event) => endCanvasMinimapDrag({ event }), true);
      window.addEventListener('pointerup', (event) => endCanvasConnectionDrag(event), true);
      window.addEventListener('pointercancel', (event) => endCanvasMinimapDrag({ event, commit: false }), true);
      window.addEventListener('pointercancel', (event) => endCanvasConnectionDrag(event, false), true);
      env.canvasMinimapViewport?.addEventListener('lostpointercapture', () => {
        if (env.canvasMinimapDragState) endCanvasMinimapDrag({ commit: false });
      });
      window.addEventListener('blur', () => endCanvasMinimapDrag({ commit: false }));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') env.cancelCanvasPointer();
        if (document.visibilityState !== 'visible') cancelCanvasConnectionDrag();
        if (document.visibilityState !== 'visible') endCanvasMinimapDrag({ commit: false });
      });
      env.canvasViewportEl.addEventListener('wheel', (event) => {
        if (isCanvasWheelControlTarget(event.target)) return;
        const { dx, dy } = normalizeCanvasWheelDelta(event);
        if (!dx && !dy) return;
        env.closeCanvasContextMenu();
        const modifierZoom = Boolean(event.ctrlKey || event.metaKey) && dy !== 0;
        event.preventDefault();
        if (modifierZoom) {
          scheduleCanvasWheelZoom(event, dy);
          return;
        }
        flushCanvasWheelZoom();
        const zoom = env.canvasStoreSnapshot().layout.viewport.zoom || env.DEFAULT_CANVAS_VIEWPORT.zoom;
        env.ensureCanvasStore()?.commitPan(dx / zoom, dy / zoom);
      }, { passive: false });
      const refreshCanvasGeometry = () => {
        if (env.settings.viewMode !== 'canvas' || env.canvasSessionFallback) return;
        env.renderCanvasMinimap(env.getCanvasVisibleTabs());
        env.scheduleInitialCanvasCenter();
      };
      window.addEventListener('resize', refreshCanvasGeometry);
      if (typeof ResizeObserver === 'function') {
        env.canvasGeometryObserver = new ResizeObserver(refreshCanvasGeometry);
        env.canvasGeometryObserver.observe(env.canvasViewportEl);
        if (env.canvasMinimap) env.canvasGeometryObserver.observe(env.canvasMinimap);
      }
      env.canvasViewportEl.addEventListener('dblclick', (event) => {
        if (event.button !== 0 || isCanvasControlTarget(event.target)) return;
        const node = event.target.closest?.('.canvas-node');
        const id = node?.dataset.id || env.canvasTargetAt(env.canvasPointFromEvent(event));
        if (id) {
          cancelCanvasNodeClick(id);
          env.restoreItem(id);
        } else {
          env.setCanvasActiveTool(env.canvasActiveTool === 'area' ? 'select' : 'area');
          env.canvasViewportEl.focus({ preventScroll: true });
        }
      });
      env.canvasViewportEl.addEventListener('keydown', (event) => {
        const focusedConnection = event.target.closest?.('.canvas-connection');
        if (focusedConnection && (event.key === 'Delete' || event.key === 'Backspace')) {
          event.preventDefault();
          deleteCanvasConnection(focusedConnection.dataset.connectionId || '');
          return;
        }
        const focusedNode = event.target.closest?.('.canvas-node');
        if (focusedNode && event.target === focusedNode) {
          if (event.key === 'Enter') {
            event.preventDefault();
            env.restoreItem(focusedNode.dataset.id);
            return;
          }
          if (event.key === ' ' || event.code === 'Space') {
            event.preventDefault();
            env.canvasSelectNode(focusedNode.dataset.id, event);
            return;
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            env.deleteItem(focusedNode.dataset.id);
            return;
          }
        }
        if (event.key === 'Escape') {
          if (env.isCanvasContextMenuOpen()) {
            event.preventDefault();
            env.closeCanvasContextMenu();
            return;
          }
          if (env.canvasNotePlacementArmed) {
            event.preventDefault();
            env.resetCanvasNotePlacement();
            return;
          }
          if (env.canvasZoomMenu && !env.canvasZoomMenu.hidden) {
            event.preventDefault();
            event.stopPropagation();
            env.closeCanvasZoomMenu();
            return;
          }
          cancelCanvasConnectionDrag();
          clearCanvasConnectionSelection();
          env.ensureCanvasStore()?.setSelection([]);
          updateCanvasNodeSelection();
          env.updateBatchBar();
          return;
        }
        if (event.key === 'Enter' && env.activeCanvasSelection().size === 1) {
          event.preventDefault();
          env.restoreItem([...env.activeCanvasSelection()][0]);
          return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && env.selectedCanvasConnectionId) {
          event.preventDefault();
          deleteCanvasConnection();
          return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && env.activeCanvasSelection().size) {
          event.preventDefault();
          env.batchDelete?.click();
          return;
        }
        if (event.key.startsWith('Arrow') && env.activeCanvasSelection().size) {
          event.preventDefault();
          const amount = event.shiftKey ? 24 : 8;
          const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
          const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
          env.canvasMoveSelected(dx, dy);
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.code !== 'Space' || env.isTypingTarget(event.target)) return;
        env.canvasSpacePressed = true;
        if (document.activeElement === env.canvasViewportEl) event.preventDefault();
      });
      document.addEventListener('keyup', (event) => {
        if (event.code === 'Space') env.canvasSpacePressed = false;
      });
      document.querySelectorAll('[data-canvas-tool]').forEach((button) => {
        button.addEventListener('click', () => {
          env.setCanvasActiveTool(button.dataset.canvasTool || 'select');
        });
      });
      env.canvasAddNoteBtn?.addEventListener('click', env.armCanvasNotePlacement);
      env.canvasViewportEl.classList.toggle('is-link-tool', env.canvasActiveTool === 'link');
      updateCanvasNodeSelection();
      document.getElementById('canvasZoomOut')?.addEventListener('click', () => env.setCanvasZoom(env.canvasStoreSnapshot().layout.viewport.zoom - 0.1));
      document.getElementById('canvasZoomIn')?.addEventListener('click', () => env.setCanvasZoom(env.canvasStoreSnapshot().layout.viewport.zoom + 0.1));
      document.getElementById('canvasResetView')?.addEventListener('click', env.resetCanvasView);
      if (env.canvasZoomSlider) {
        env.canvasZoomSlider.min = String(env.CANVAS_ZOOM_MIN);
        env.canvasZoomSlider.max = String(env.CANVAS_ZOOM_MAX);
        env.canvasZoomSlider.step = String(env.CANVAS_ZOOM_STEP);
        env.canvasZoomSlider.addEventListener('input', (event) => env.setCanvasZoom(event.currentTarget.value));
      }
      env.canvasZoomValueWrap?.addEventListener('pointerenter', () => {
        env.canvasZoomValueWrap.dataset.pointerOutside = 'false';
      });
      env.canvasZoomValueWrap?.addEventListener('pointerleave', () => {
        env.canvasZoomValueWrap.dataset.pointerOutside = 'true';
      });
      env.canvasZoomValue?.addEventListener('click', (event) => {
        event.stopPropagation();
        env.toggleCanvasZoomMenu();
      });
      env.canvasZoomMenu?.querySelectorAll('[data-canvas-zoom-action]').forEach((button) => {
        button.addEventListener('click', () => env.applyCanvasZoomAction(button.dataset.canvasZoomAction || ''));
      });
      document.addEventListener('pointerdown', (event) => {
        if (!event.target.closest?.('#canvasZoomValueWrap')) {
          env.closeCanvasZoomMenu();
          if (env.canvasZoomValueWrap) env.canvasZoomValueWrap.dataset.pointerOutside = 'true';
        }
      });
      document.getElementById('canvasAllBtn')?.addEventListener('click', () => env.setCanvasIndexFilter('all'));
      document.getElementById('canvasUnsortedBtn')?.addEventListener('click', () => env.setCanvasIndexFilter('unsorted'));
      document.getElementById('canvasPinnedBtn')?.addEventListener('click', () => env.setCanvasIndexFilter('pinned'));
      document.querySelectorAll('[data-canvas-action]').forEach((button) => {
        button.addEventListener('click', () => env.canvasAction(button.dataset.canvasAction));
      });
      env.canvasStackConfirm?.addEventListener('click', env.createCanvasStackFromSelection);
      env.canvasStackCancel?.addEventListener('click', env.closeCanvasStackDialog);
      env.canvasStackTitle?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') env.createCanvasStackFromSelection();
      });
      env.canvasDropZone?.addEventListener('click', env.openCanvasStackDialog);

  }

  function normalizeCanvasWheelDelta(event) {
    ensureBound('normalizeCanvasWheelDelta');

      const mode = Number(event?.deltaMode) || 0;
      const unit = mode === 1
        ? 16
        : mode === 2
          ? Math.max(1, env.canvasViewportEl?.clientHeight || 800)
          : 1;
      const limit = 480;
      const clampDelta = (value) => Math.max(-limit, Math.min(limit, (Number(value) || 0) * unit));
      return { dx: clampDelta(event?.deltaX), dy: clampDelta(event?.deltaY) };

  }

  function scheduleCanvasWheelZoom(event, deltaY) {
    ensureBound('scheduleCanvasWheelZoom');

      const sensitivity = env.canvasWheelZoomSensitivity(event);
      const normalizedDelta = deltaY * (sensitivity / env.CANVAS_WHEEL_ZOOM_SENSITIVITY);
      const state = env.canvasZoomWheelState || { deltaY: 0, clientX: null, clientY: null };
      state.deltaY = Math.max(
        -env.CANVAS_WHEEL_ZOOM_FRAME_LIMIT,
        Math.min(env.CANVAS_WHEEL_ZOOM_FRAME_LIMIT, state.deltaY + normalizedDelta)
      );
      state.clientX = event.clientX;
      state.clientY = event.clientY;
      env.canvasZoomWheelState = state;
      if (env.canvasZoomWheelFrame) return;
      const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 16);
      env.canvasZoomWheelFrame = schedule(() => {
        env.canvasZoomWheelFrame = 0;
        flushCanvasWheelZoom();
      });

  }

  function flushCanvasWheelZoom() {
    ensureBound('flushCanvasWheelZoom');

      if (env.canvasZoomWheelFrame) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(env.canvasZoomWheelFrame);
        else clearTimeout(env.canvasZoomWheelFrame);
        env.canvasZoomWheelFrame = 0;
      }
      const state = env.canvasZoomWheelState;
      env.canvasZoomWheelState = null;
      if (!state?.deltaY) return;
      const currentZoom = env.canvasStoreSnapshot().layout.viewport.zoom || env.DEFAULT_CANVAS_VIEWPORT.zoom;
      env.setCanvasZoom(
        currentZoom * env.canvasWheelZoomFactor(state.deltaY),
        state.clientX,
        state.clientY
      );

  }

  function canvasConnectionDragTarget(event, excludeId, fixedId = '') {
    ensureBound('canvasConnectionDragTarget');

      const targetId = env.canvasTargetAt(env.canvasPointFromEvent(event), excludeId);
      return targetId && targetId !== fixedId ? targetId : '';

  }

  function suppressCanvasNodeClick(id) {
    ensureBound('suppressCanvasNodeClick');

      if (!id) return;
      env.canvasNodeClickSuppressUntil.set(id, Date.now() + env.CANVAS_NODE_CLICK_DELAY);

  }

  function scheduleCanvasNodePreview(item) {
    ensureBound('scheduleCanvasNodePreview');

      if (!item?.id) return;
      cancelCanvasNodeClick(item.id);
      const timer = setTimeout(() => {
        env.canvasNodeClickTimers.delete(item.id);
        const current = env.canvasItemById(item.id);
        if (!current) return;
        if (current.kind === 'group') env.openCanvasGroupLightbox(current);
        else if (current.kind === 'note') env.openStickerNoteEditor(current);
        else env.openLightbox(current);
      }, env.CANVAS_NODE_CLICK_DELAY);
      env.canvasNodeClickTimers.set(item.id, timer);

  }

  function cancelCanvasNodeClick(id) {
    ensureBound('cancelCanvasNodeClick');

      const timer = env.canvasNodeClickTimers.get(id);
      if (timer) clearTimeout(timer);
      env.canvasNodeClickTimers.delete(id);

  }

  async function runCanvasNodeAction(id, action) {
    ensureBound('runCanvasNodeAction');

      const item = env.canvasItemById(id);
      if (!item || !action) return;
      if (action === 'restore') await env.restoreItem(item.id);
      else if (action === 'snapshot') {
        if (item.kind === 'group') env.openCanvasGroupLightbox(item);
        else env.openLightbox(item);
      }
      else if (action === 'copy') await env.copySavedLink(item);
      else if (action === 'members') env.openMembersBox(item);
      else if (action === 'edit') {
        if (item.kind === 'note') env.openStickerNoteEditor(item);
        else env.openEditBox(item);
      }
      else if (action === 'pin') await env.togglePinned(item);
      else if (action === 'delete') await env.deleteItem(item.id);

  }

  function isCanvasControlTarget(target) {
    ensureBound('isCanvasControlTarget');

      return Boolean(
        target?.closest?.(
          'button, input, select, textarea, label, a, [contenteditable="true"], .canvas-context-bar, #canvasContextMenu, .canvas-minimap, .canvas-zoom-controls, .canvas-node-actions, .canvas-connection, .canvas-connection-hit, .canvas-link-handle, .search-hits'
        )
      );

  }

  function isCanvasWheelControlTarget(target) {
    ensureBound('isCanvasWheelControlTarget');

      return Boolean(
        target?.closest?.(
          'button, input, select, textarea, label, a, [contenteditable="true"], .canvas-context-bar, .canvas-minimap, .canvas-zoom-controls, .canvas-node-actions, .canvas-connection, .canvas-connection-hit, .canvas-link-handle, .search-hits'
        )
      );

  }

  global.TabWallCanvasInteraction = { bind, beginCanvasConnectionDrag, updateCanvasConnectionDrag, commitCanvasConnectionDrag, endCanvasConnectionDrag, cancelCanvasConnectionDrag, resetCanvasConnectionCurve, selectCanvasConnection, clearCanvasConnectionSelection, deleteCanvasConnection, handleCanvasConnectionNodeClick, handleCanvasConnectionClick, handleCanvasConnectionDoubleClick, setCanvasConnectionZoneHover, detectCanvasConnectionDoublePointerDown, wireCanvasConnectionPath, wireCanvasLinkHandles, wireCanvasNodeActions, updateCanvasNodeSelection, beginCanvasPointer, updateCanvasPointer, endCanvasPointer, applyCanvasPointer, handleCanvasMiddleClick, beginCanvasMinimapDrag, updateCanvasMinimapDrag, endCanvasMinimapDrag, initCanvasInteractions, normalizeCanvasWheelDelta, scheduleCanvasWheelZoom, flushCanvasWheelZoom, canvasConnectionDragTarget, suppressCanvasNodeClick, scheduleCanvasNodePreview, cancelCanvasNodeClick, runCanvasNodeAction, isCanvasControlTarget, isCanvasWheelControlTarget };
})(typeof self !== 'undefined' ? self : globalThis);
