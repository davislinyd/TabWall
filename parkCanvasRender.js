/**
 * TabWall park canvas render — node HTML, arrange, minimap DOM, connection render.
 * Loaded by park.html after parkCanvasGeometry.js (and media helpers), before park.js.
 * Call bind() so DOM/state/helpers resolve from the park page.
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let ctx = {};

  /** Shared Maps owned by park.js (same object references). */
  let canvasNodeElements = null;
  let canvasConnectionElements = null;
  let canvasMinimapElements = null;
  let canvasNodeClickSuppressUntil = null;

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    ctx = Object.assign(ctx, next);
    if (next.canvasNodeElements) canvasNodeElements = next.canvasNodeElements;
    if (next.canvasConnectionElements) canvasConnectionElements = next.canvasConnectionElements;
    if (next.canvasMinimapElements) canvasMinimapElements = next.canvasMinimapElements;
    if (next.canvasNodeClickSuppressUntil) canvasNodeClickSuppressUntil = next.canvasNodeClickSuppressUntil;
  }

  function call(name, ...args) {
    const fn = ctx[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }
  function get(name, fallback) {
    if (typeof ctx[name] === 'function') return ctx[name]();
    return ctx[name] !== undefined ? ctx[name] : fallback;
  }

  const Media = () => global.TabWallMediaDB;
  const Build = () => global.TabWallBackupBuild;
  const CanvasGeom = () => global.TabWallCanvasGeometry;

  function t(key, vars) { return typeof ctx.t === 'function' ? ctx.t(key, vars) : key; }
  function escapeHtml(str) { return call('escapeHtml', str); }
  function escapeAttr(str) { return call('escapeAttr', str); }
  function iconSvg(name) { return call('iconSvg', name); }
  function groupCoverHtml(item, opts) { return call('groupCoverHtml', item, opts); }
  function itemTitle(item) { return call('itemTitle', item); }
  function formatSavedAt(ts) { return call('formatSavedAt', ts); }
  function domainOf(url) { return call('domainOf', url); }
  function mediaKeyForItem(item) { return call('mediaKeyForItem', item); }
  function activeCanvasSelection() { return call('activeCanvasSelection') || new Set(); }
  function canvasPositionFor(id, index) { return call('canvasPositionFor', id, index); }
  function canvasStoreSnapshot() { return call('canvasStoreSnapshot'); }
  function canvasNodeWorldRect(node) { return call('canvasNodeWorldRect', node); }
  function getCanvasSearchContext() { return call('getCanvasSearchContext'); }
  function canvasSearchLayoutFor(sc) { return call('canvasSearchLayoutFor', sc); }
  function isCanvasSearchPreviewActive(sc) { return call('isCanvasSearchPreviewActive', sc); }
  function ensureCanvasStore() { return call('ensureCanvasStore'); }
  function updateSavedBadge() { return call('updateSavedBadge'); }
  function syncCanvasIndexUi() { return call('syncCanvasIndexUi'); }
  function updateBatchBar() { return call('updateBatchBar'); }
  function updateCanvasTransform() { return call('updateCanvasTransform'); }
  function updateCanvasNodeSelection() { return call('updateCanvasNodeSelection'); }
  function wireCanvasNodeActions(node) { return call('wireCanvasNodeActions', node); }
  function wireCanvasMedia(img) { return call('wireCanvasMedia', img); }
  function wireFavicon(el) { return call('wireFavicon', el); }
  function appendGroupSearchHits(node, item) { return call('appendGroupSearchHits', node, item); }
  function wireStickerAttachmentImages(root, note) { return call('wireStickerAttachmentImages', root, note); }
  function cancelCanvasNodeClick(id) { return call('cancelCanvasNodeClick', id); }
  function wireCanvasConnectionPath(path, connection, connectionId, zone) {
    return call('wireCanvasConnectionPath', path, connection, connectionId, zone);
  }
  function snapCanvasPosition(position) { return call('snapCanvasPosition', position); }
  function canvasItemById(id) { return call('canvasItemById', id); }

  function getCanvasViewportEl() { return get('canvasViewportEl'); }
  function getCanvasConnectionsEl() { return get('canvasConnectionsEl'); }
  function getCanvasNodesEl() { return get('canvasNodesEl'); }
  function getCanvasMinimap() { return get('canvasMinimap'); }
  function getCanvasMinimapViewport() { return get('canvasMinimapViewport'); }
  function getCanvasDropZone() { return get('canvasDropZone'); }
  function getCanvasLayout() { return get('canvasLayout'); }
  function getCanvasConnectionDragState() { return get('canvasConnectionDragState'); }
  function getCanvasConnectionDraftEl() { return get('canvasConnectionDraftEl'); }
  function setCanvasConnectionDraftEl(el) { call('setCanvasConnectionDraftEl', el); }
  function getCanvasConnectionSourceId() { return get('canvasConnectionSourceId', ''); }
  function getSelectedCanvasConnectionId() { return get('selectedCanvasConnectionId', ''); }
  function setSelectedCanvasConnectionId(id) { call('setSelectedCanvasConnectionId', id); }
  function getCanvasMinimapDragState() { return get('canvasMinimapDragState'); }
  function getCanvasMinimapProjection() { return get('canvasMinimapProjection'); }
  function setCanvasMinimapProjection(p) { call('setCanvasMinimapProjection', p); }
  function getAllTabs() { return get('allTabs', []); }
  function getQuery() { return get('query', ''); }
  function getSettings() { return get('settings', {}); }
  function getThumbObserver() { return get('thumbObserver'); }
  function getCanvasMediaObserver() { return get('canvasMediaObserver'); }
  function getCanvasConnectionHitWidth() { return Number(get('CANVAS_CONNECTION_HIT_WIDTH', 16)); }

  const DEFAULT_CANVAS_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1 });

  // Geometry aliases (single source: parkCanvasGeometry.js)
  function canvasDefaultPosition(index) { return CanvasGeom().canvasDefaultPosition(index); }
  function canvasDisplayPosition(position, fallback) { return CanvasGeom().canvasDisplayPosition(position, fallback); }
  function canvasConnectionId(a, b) { return CanvasGeom().canvasConnectionId(a, b); }
  function canvasConnectionSideForVector(dx, dy) { return CanvasGeom().canvasConnectionSideForVector(dx, dy); }
  function canvasConnectionSideForPoint(rect, point) { return CanvasGeom().canvasConnectionSideForPoint(rect, point); }
  function canvasConnectionHandlePoint(position, side) { return CanvasGeom().canvasConnectionHandlePoint(position, side); }
  function canvasConnectionPathD(s, t, o) { return CanvasGeom().canvasConnectionPathD(s, t, o); }
  function canvasConnectionCurveGeometry(s, t, o) { return CanvasGeom().canvasConnectionCurveGeometry(s, t, o); }
  function canvasConnectionCurveSegments(g) { return CanvasGeom().canvasConnectionCurveSegments(g); }
  function canvasMinimapProjectionFor(n, v, w, h) { return CanvasGeom().canvasMinimapProjectionFor(n, v, w, h); }
  

function canvasThumbHtml(item) {
  if (call('isMediaLocked', item)) {
    const needsPassword = Boolean(item.lockHash);
    const label = t(needsPassword ? 'unlockWithPassword' : 'unlockTap');
    return `<button type="button" class="media-lock-overlay" data-unlock-id="${escapeAttr(item.id)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${iconSvg('lock')}<span>${escapeHtml(label)}</span></button>`;
  }
  if (item.kind === 'group') return groupCoverHtml(item, { canvas: true });
  if (item.kind === 'note') {
    const attachment = item.attachments?.[0];
    if (!attachment) return `<div class="canvas-note-cover">${iconSvg('note')}<span>${escapeHtml(t('noteKind'))}</span></div>`;
    const key = Media().mediaKeyNoteAttachment(item.id, attachment.id);
    return `<img class="canvas-note-cover-image" alt="${escapeAttr(attachment.alt || attachment.name || '')}" data-note-attachment-key="${escapeAttr(key)}" data-note-attachment-id="${escapeAttr(attachment.id)}" />`;
  }
  const preferSnap = item.cardSource === 'image' ? ' data-canvas-prefer-snap="true"' : '';
  return `<img class="canvas-thumb lazy-thumb" alt="" draggable="false" decoding="async" data-media-key="${escapeAttr(mediaKeyForItem(item))}" data-canvas-media="true" data-canvas-has-thumb="${item.hasThumb || item.thumbnail ? 'true' : 'false'}" data-canvas-has-snap="${item.hasSnap || item.snapshot ? 'true' : 'false'}"${preferSnap} />`;
}

function safeNotePreviewHtml(note, className = 'canvas-note-preview') {
  const rendered = Build()?.renderSafeMarkdown
    ? Build().renderSafeMarkdown(note?.markdown || '', note?.attachments || [])
    : escapeHtml(note?.markdown || '');
  return `<div class="${className}">${rendered || `<span class="note-preview">—</span>`}</div>`;
}

function canvasNodeActionEntries(item) {
  if (!item) return [];
  const sessionUnlocked = Boolean(item.locked && !call('isMediaLocked', item));
  const lockEntry = item.locked
    ? { action: sessionUnlocked ? 'relock' : 'unlock', label: t(sessionUnlocked ? 'lockAction' : 'unlockAction'), icon: sessionUnlocked ? 'lock' : 'unlock' }
    : { action: 'lock', label: t('lockAction'), icon: 'lock' };
  if (item.kind === 'group') {
    return [
      { action: 'restore', label: t('restoreGroup'), icon: 'restore' },
      { action: 'members', label: t('expandGroup'), icon: 'members' },
      { action: 'edit', label: t('edit'), icon: 'edit' },
      { action: 'reminder', label: t('reminderAction'), icon: 'reminder' },
      lockEntry,
      { action: 'pin', label: t(item.pinned ? 'unpin' : 'pin'), icon: 'pin' },
      { action: 'delete', label: t('delete'), icon: 'delete' },
    ];
  }
  if (item.kind === 'note') {
    return [
      { action: 'edit', label: t('edit'), icon: 'edit' },
      { action: 'reminder', label: t('reminderAction'), icon: 'reminder' },
      lockEntry,
      { action: 'pin', label: t(item.pinned ? 'unpin' : 'pin'), icon: 'pin' },
      { action: 'delete', label: t('delete'), icon: 'delete' },
    ];
  }
  if (item.cardSource === 'image') {
    return [
      { action: 'snapshot', label: t('canvasSnapshot'), icon: 'snapshot' },
      { action: 'edit', label: t('edit'), icon: 'edit' },
      { action: 'reminder', label: t('reminderAction'), icon: 'reminder' },
      lockEntry,
      { action: 'pin', label: t(item.pinned ? 'unpin' : 'pin'), icon: 'pin' },
      { action: 'delete', label: t('delete'), icon: 'delete' },
    ];
  }
  return [
    { action: 'restore', label: t('restore'), icon: 'restore' },
    { action: 'snapshot', label: t('canvasSnapshot'), icon: 'snapshot' },
    { action: 'edit', label: t('edit'), icon: 'edit' },
    { action: 'reminder', label: t('reminderAction'), icon: 'reminder' },
    { action: 'copy', label: t('copyLink'), icon: 'copy' },
    lockEntry,
    { action: 'pin', label: t(item.pinned ? 'unpin' : 'pin'), icon: 'pin' },
    { action: 'delete', label: t('delete'), icon: 'delete' },
  ];
}

function canvasNodeHtml(item) {
  const title = itemTitle(item);
  const selected = activeCanvasSelection().has(item.id);
  const position = canvasDisplayPosition(canvasPositionFor(item.id));
  const pin = item.pinned ? `<span class="canvas-pin" title="${escapeAttr(t('pinnedOnly'))}" aria-label="${escapeAttr(t('pinnedOnly'))}">${iconSvg('pin')}</span>` : '';
  const isNote = item.kind === 'note';
  const isImage = item.cardSource === 'image';
  const groupColors = get('GROUP_COLORS', {}) || {};
  const groupColor = item.kind === 'group' ? (groupColors[item.color] || groupColors.grey || '#9ca3af') : '';
  const meta = item.kind === 'group'
    ? t('groupTabs', { n: (item.tabs || []).length + (item.notes || []).length })
    : isNote
      ? `${t('noteKind')} · ${formatSavedAt(item.savedAt)} · ${t('noteCount', { n: (item.attachments || []).length })}`
      : isImage
        ? `${t('imageKind')} · ${formatSavedAt(item.savedAt)}`
        : `${domainOf(item.url)} · ${formatSavedAt(item.savedAt)}`;
  const actionHtml = canvasNodeActionEntries(item)
    .map(({ action, label, icon }) => `<button type="button" class="canvas-node-action${action === 'delete' ? ' danger' : ''}" data-canvas-node-action="${action}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${iconSvg(icon)}</button>`)
    .join('');
  const linkHandles = [
    ['top', 'canvasLinkHandleTop'],
    ['right', 'canvasLinkHandleRight'],
    ['bottom', 'canvasLinkHandleBottom'],
    ['left', 'canvasLinkHandleLeft'],
  ].map(([side, labelKey]) => `<button type="button" class="canvas-link-handle canvas-link-handle-${side}" data-canvas-link-handle="${side}" tabindex="-1" title="${escapeAttr(t(labelKey))}" aria-label="${escapeAttr(t(labelKey))}"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>`).join('');
  const groupStyle = groupColor ? `;--group-color:${escapeAttr(groupColor)}` : '';
  return `
    <article class="canvas-node${item.kind === 'group' ? ' canvas-group' : ''}${isNote ? ' canvas-note' : ''}${isImage ? ' canvas-image' : ''}${selected ? ' selected' : ''}"
      data-id="${escapeAttr(item.id)}" data-kind="${escapeAttr(item.kind)}"${isImage ? ' data-card-source="image"' : ''} role="button" tabindex="0"
      aria-selected="${selected ? 'true' : 'false'}" title="${escapeAttr(t('canvasNodeHint'))}" style="left:${position.x}px;top:${position.y}px;width:${position.w}px;min-height:${position.h}px;z-index:${Math.round(position.z || 0)}${groupStyle}">
      <div class="canvas-node-thumb" title="${escapeAttr(t('canvasNodeHint'))}">${canvasThumbHtml(item)}</div>
      <div class="canvas-node-copy">
        <div class="canvas-node-title">
          ${item.kind === 'group' ? `<span class="color-dot" style="background:${escapeAttr(groupColor)}"></span>` : ''}
          ${item.kind === 'tab' && item.favIconUrl ? `<img class="favicon" alt="" draggable="false" src="${escapeAttr(item.favIconUrl)}" />` : ''}
          <span>${escapeHtml(title)}</span>${item.reminder ? `<span class="reminder-badge" title="${escapeAttr(t('reminderActive'))}">${iconSvg('reminder')}</span>` : ''}${pin}
        </div>
        ${(() => {
          const original = call('itemOriginalTitle', item);
          return original ? `<div class="title-original" title="${escapeAttr(original)}">${escapeHtml(original)}</div>` : '';
        })()}
        <div class="canvas-node-meta">${escapeHtml(meta)}</div>
        ${isNote && !call('isMediaLocked', item) ? safeNotePreviewHtml(item) : !isNote && item.note ? `<div class="canvas-node-note">${escapeHtml(item.note)}</div>` : ''}
        ${item.tags?.length ? `<div class="canvas-node-tags">${item.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</div>` : ''}
      </div>
      <div class="canvas-node-actions" aria-label="${escapeAttr(title)}">${actionHtml}</div>
      <div class="canvas-link-handles" aria-label="${escapeAttr(t('canvasLink'))}">${linkHandles}</div>
    </article>`;
}

function canvasConnectionDomHandlePoint(id, side) {
  const handle = canvasNodeElements.get(id)?.querySelector(`[data-canvas-link-handle="${side}"]`);
  const viewportRect = getCanvasViewportEl()?.getBoundingClientRect();
  const handleRect = handle?.getBoundingClientRect();
  if (!viewportRect || !handleRect) return null;
  const viewport = canvasStoreSnapshot().layout?.viewport || getCanvasLayout().viewport;
  const zoom = viewport.zoom || 1;
  return {
    x: (handleRect.left + handleRect.width / 2 - viewportRect.left) / zoom + viewport.x,
    y: (handleRect.top + handleRect.height / 2 - viewportRect.top) / zoom + viewport.y,
  };
}

function canvasConnectionHandlePointForId(id, position, side) {
  return canvasConnectionDomHandlePoint(id, side) || canvasConnectionHandlePoint(position, side);
}

function canvasConnectionHandlePointForCursor(rect, point, id = '') {
  const side = canvasConnectionSideForPoint(rect, point);
  return side ? canvasConnectionHandlePointForId(id, rect, side) : null;
}

function canvasConnectionPosition(id) {
  const node = canvasNodeElements.get(id);
  const measured = node?.isConnected ? canvasNodeWorldRect(node) : null;
  if (measured && measured.w > 0 && measured.h > 0) return measured;
  const searchContext = getCanvasSearchContext();
  const layout = isCanvasSearchPreviewActive(searchContext)
    ? canvasSearchLayoutFor(searchContext)
    : (canvasStoreSnapshot().layout || getCanvasLayout());
  const position = layout?.positions?.[id];
  return position ? canvasDisplayPosition(position) : null;
}

function canvasConnectionHandlePoints(source, target, sourceId = '', targetId = '') {
  if (!source || !target) return null;
  const sourceSide = canvasConnectionSideForVector(
    target.x + target.w / 2 - (source.x + source.w / 2),
    target.y + target.h / 2 - (source.y + source.h / 2),
  );
  if (!sourceSide) return null;
  const targetSide = sourceSide === 'right'
    ? 'left'
    : sourceSide === 'left'
      ? 'right'
      : sourceSide === 'bottom'
        ? 'top'
        : 'bottom';
  return {
    source: canvasConnectionHandlePointForId(sourceId, source, sourceSide),
    target: canvasConnectionHandlePointForId(targetId, target, targetSide),
  };
}

function renderCanvasConnectionDraft() {
  const state = getCanvasConnectionDragState();
  if (!getCanvasConnectionsEl() || !state || state.kind === 'curve') {
    if (getCanvasConnectionDraftEl()) {
      getCanvasConnectionDraftEl().remove();
      setCanvasConnectionDraftEl(null);
    }
    return;
  }
  let sourcePoint;
  let targetPoint;
  if (state.targetId) {
    const sourceId = state.kind === 'handle'
      ? state.sourceId
      : state.movingEndpoint === 'sourceId' ? state.targetId : state.fixedId;
    const targetId = state.kind === 'handle'
      ? state.targetId
      : state.movingEndpoint === 'targetId' ? state.targetId : state.fixedId;
    const source = canvasConnectionPosition(sourceId);
    const target = canvasConnectionPosition(targetId);
    const points = source && target
      ? canvasConnectionHandlePoints(source, target, sourceId, targetId)
      : null;
    sourcePoint = points?.source;
    targetPoint = points?.target;
  } else if (state.kind === 'handle') {
    sourcePoint = state.startPoint;
    targetPoint = state.currentPoint;
  } else {
    const fixed = canvasConnectionPosition(state.fixedId);
    if (!fixed) {
      if (getCanvasConnectionDraftEl()) {
        getCanvasConnectionDraftEl().remove();
        setCanvasConnectionDraftEl(null);
      }
      return;
    }
    sourcePoint = state.movingEndpoint === 'sourceId'
      ? state.currentPoint
      : canvasConnectionHandlePointForCursor(fixed, state.currentPoint, state.fixedId);
    targetPoint = state.movingEndpoint === 'sourceId'
      ? canvasConnectionHandlePointForCursor(fixed, state.currentPoint, state.fixedId)
      : state.currentPoint;
  }
  const d = canvasConnectionPathD(sourcePoint, targetPoint);
  if (!d) {
    if (getCanvasConnectionDraftEl()) {
      getCanvasConnectionDraftEl().remove();
      setCanvasConnectionDraftEl(null);
    }
    return;
  }
  if (getCanvasConnectionDraftEl()) {
    getCanvasConnectionDraftEl().setAttribute('d', d);
  } else {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'canvas-connection-draft');
    path.setAttribute('d', d);
    getCanvasConnectionsEl().appendChild(path);
    setCanvasConnectionDraftEl(path);
  }
}

function canvasConnectionRenderOffset(connection, connectionId) {
  const state = getCanvasConnectionDragState();
  if (state?.kind === 'curve' && state.connectionId === connectionId) return state.curveOffset;
  return connection?.curveOffset;
}

function renderCanvasConnections(searchContext = getCanvasSearchContext()) {
  if (!getCanvasConnectionsEl()) return;
  const zones = ['source', 'curve', 'target'];
  const visibleIds = new Set(searchContext.items.map((item) => item.id));
  const layout = canvasStoreSnapshot().layout || getCanvasLayout();
  const connections = layout.connections || [];
  const connectionIds = new Set(connections.map((connection) => canvasConnectionId(connection.sourceId, connection.targetId)));
  if (getSelectedCanvasConnectionId() && !connectionIds.has(getSelectedCanvasConnectionId())) setSelectedCanvasConnectionId('');
  const seenIds = new Set();
  for (const connection of connections) {
    if (!visibleIds.has(connection.sourceId) || !visibleIds.has(connection.targetId)) continue;
    const source = canvasConnectionPosition(connection.sourceId);
    const target = canvasConnectionPosition(connection.targetId);
    if (!source || !target) continue;
    const points = canvasConnectionHandlePoints(source, target, connection.sourceId, connection.targetId);
    if (!points) continue;
    const id = canvasConnectionId(connection.sourceId, connection.targetId);
    const geometry = canvasConnectionCurveGeometry(
      points.source,
      points.target,
      canvasConnectionRenderOffset(connection, id),
    );
    if (!geometry) continue;
    const segments = canvasConnectionCurveSegments(geometry);
    const related = searchContext.queryActive
      && (searchContext.relatedIds.has(connection.sourceId) || searchContext.relatedIds.has(connection.targetId));
    const classes = `canvas-connection${getSelectedCanvasConnectionId() === id ? ' selected' : ''}${related ? ' search-related' : ''}${getCanvasConnectionSourceId() && (getCanvasConnectionSourceId() === connection.sourceId || getCanvasConnectionSourceId() === connection.targetId) ? ' source' : ''}${geometry.offset.x || geometry.offset.y ? ' curved' : ''}${getCanvasConnectionDragState()?.kind === 'curve' && getCanvasConnectionDragState().connectionId === id ? ' dragging' : ''}`;
    const ariaLabel = `${canvasItemById(connection.sourceId)?.title || connection.sourceId} ↔ ${canvasItemById(connection.targetId)?.title || connection.targetId}`;
    seenIds.add(id);

    let group = canvasConnectionElements.get(id);
    if (!group) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.dataset.connectionId = id;
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      wireCanvasConnectionPath(path, connection, id);
      getCanvasConnectionsEl().appendChild(path);

      const highlights = [];
      const hits = [];
      for (const zone of zones) {
        const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        highlight.setAttribute('class', `canvas-connection-zone-highlight ${zone}`);
        highlight.setAttribute('aria-hidden', 'true');
        highlight.dataset.connectionId = id;
        highlight.dataset.connectionZone = zone;
        getCanvasConnectionsEl().appendChild(highlight);
        highlights.push(highlight);

        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hit.setAttribute('class', `canvas-connection-hit ${zone}`);
        hit.setAttribute('stroke-width', String(getCanvasConnectionHitWidth()));
        hit.setAttribute('aria-hidden', 'true');
        hit.dataset.connectionId = id;
        hit.dataset.connectionZone = zone;
        wireCanvasConnectionPath(hit, connection, id, zone);
        getCanvasConnectionsEl().appendChild(hit);
        hits.push(hit);
      }
      group = { path, highlights, hits, flow: null };
      canvasConnectionElements.set(id, group);
    }

    // Existing elements are only patched here — listeners stay attached from
    // creation (see wireCanvasConnectionPath's live-connection lookup for why
    // that's still correct when curveOffset changes without id changing).
    group.path.setAttribute('d', geometry.pathD);
    group.path.setAttribute('class', classes);
    group.path.setAttribute('aria-label', ariaLabel);
    if (!group.flow) {
      const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      flow.setAttribute('aria-hidden', 'true');
      flow.dataset.connectionId = id;
      getCanvasConnectionsEl().appendChild(flow);
      group.flow = flow;
    }
    group.flow.setAttribute('d', geometry.pathD);
    group.flow.setAttribute(
      'class',
      getSelectedCanvasConnectionId() === id ? 'canvas-connection-flow is-visible' : 'canvas-connection-flow'
    );
    zones.forEach((zone, index) => {
      group.highlights[index].setAttribute('d', segments[index].pathD);
      group.hits[index].setAttribute('d', segments[index].pathD);
    });
  }

  for (const [id, group] of canvasConnectionElements) {
    if (seenIds.has(id)) continue;
    group.path.remove();
    group.highlights.forEach((el) => el.remove());
    group.hits.forEach((el) => el.remove());
    group.flow?.remove();
    canvasConnectionElements.delete(id);
  }

  renderCanvasConnectionDraft();
}

function updateCanvasNodePositions(snapshot = canvasStoreSnapshot(), searchContext = getCanvasSearchContext()) {
  const layout = isCanvasSearchPreviewActive(searchContext)
    ? canvasSearchLayoutFor(searchContext)
    : (snapshot.layout || getCanvasLayout());
  const positions = layout.positions || {};
  for (const [id, node] of canvasNodeElements) {
    const position = positions[id] ? canvasDisplayPosition(positions[id]) : null;
    if (!position) continue;
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
    node.style.width = `${position.w}px`;
    node.style.minHeight = `${position.h}px`;
    node.style.zIndex = String(Math.round(position.z || 0));
  }
}

function renderCanvasMinimap(items, renderLayout = null) {
  if (!getCanvasMinimap()) return;
  const map = getCanvasMinimap().querySelector('.canvas-minimap-world');
  if (!map) return;
  const frame = getCanvasMinimapViewport() || map.querySelector('.canvas-minimap-viewport');
  const mapRect = map.getBoundingClientRect?.();
  const mapWidth = map.clientWidth || mapRect?.width || 0;
  const mapHeight = map.clientHeight || mapRect?.height || 0;
  const layout = renderLayout || canvasSearchLayoutFor();
  const zoom = Math.max(0.25, Number(layout.viewport?.zoom) || DEFAULT_CANVAS_VIEWPORT.zoom);
  const viewportWidth = Math.max(1, getCanvasViewportEl()?.clientWidth || getCanvasViewportEl()?.getBoundingClientRect?.().width || mapWidth);
  const viewportHeight = Math.max(1, getCanvasViewportEl()?.clientHeight || getCanvasViewportEl()?.getBoundingClientRect?.().height || mapHeight);
  const nodeRects = (Array.isArray(items) ? items : []).map((item, index) => {
    const position = canvasDisplayPosition(layout.positions?.[item.id] || canvasDefaultPosition(index));
    return {
      id: String(item.id),
      kind: item.kind,
      x: Number(position.x) || 0,
      y: Number(position.y) || 0,
      w: Math.max(1, Number(position.w) || 1),
      h: Math.max(1, Number(position.h) || 1),
    };
  });
  const viewportRect = {
    x: Number(layout.viewport?.x) || 0,
    y: Number(layout.viewport?.y) || 0,
    w: viewportWidth / zoom,
    h: viewportHeight / zoom,
  };
  if (!getCanvasMinimapDragState()) {
    setCanvasMinimapProjection(canvasMinimapProjectionFor(nodeRects, viewportRect, mapWidth, mapHeight));
  }
  const projection = getCanvasMinimapDragState()?.projection || getCanvasMinimapProjection();
  if (!projection) {
    for (const [id, element] of canvasMinimapElements) {
      element.remove();
      canvasMinimapElements.delete(id);
    }
    if (frame) frame.hidden = true;
    return;
  }
  const toMinimapRect = (rect) => ({
    left: rect.x * projection.scale + projection.offsetX,
    top: rect.y * projection.scale + projection.offsetY,
    width: Math.max(2, rect.w * projection.scale),
    height: Math.max(2, rect.h * projection.scale),
  });
  const selection = activeCanvasSelection();
  const visibleIds = new Set(nodeRects.map((rect) => rect.id));
  for (const [id, element] of canvasMinimapElements) {
    if (visibleIds.has(id)) continue;
    element.remove();
    canvasMinimapElements.delete(id);
  }
  for (const rect of nodeRects) {
    let element = canvasMinimapElements.get(rect.id);
    if (!element) {
      element = document.createElement('span');
      element.className = 'minimap-node';
      element.dataset.minimapId = rect.id;
      canvasMinimapElements.set(rect.id, element);
      map.appendChild(element);
    }
    element.className = `minimap-node${rect.kind === 'group' ? ' group' : ''}${selection.has(rect.id) ? ' selected' : ''}`;
    const mapped = toMinimapRect(rect);
    element.style.left = `${mapped.left}px`;
    element.style.top = `${mapped.top}px`;
    element.style.width = `${mapped.width}px`;
    element.style.height = `${mapped.height}px`;
  }
  if (frame) {
    const mapped = toMinimapRect(viewportRect);
    frame.hidden = false;
    frame.style.left = `${Math.max(0, mapped.left)}px`;
    frame.style.top = `${Math.max(0, mapped.top)}px`;
    frame.style.width = `${Math.min(projection.mapWidth, mapped.width)}px`;
    frame.style.height = `${Math.min(projection.mapHeight, mapped.height)}px`;
  }
}

function canvasNodeRenderKey(item) {
  const unlockedIds = get('sessionUnlockedIds');
  return JSON.stringify({
    id: item.id,
    kind: item.kind,
    title: item.title,
    displayTitle: item.displayTitle || '',
    locked: Boolean(item.locked),
    lockHash: item.lockHash || '',
    unlocked: Boolean(unlockedIds?.has?.(item.id)),
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
      ])
      : undefined,
    notes: item.kind === 'group'
      ? (item.notes || []).map((note) => [note.id, note.title, note.markdown, note.tags, note.attachments?.length])
      : undefined,
    query: getQuery(),
    locale: getSettings().locale,
  });
}

function createCanvasNodeElement(item, renderKey = canvasNodeRenderKey(item)) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = canvasNodeHtml(item);
  const node = wrapper.firstElementChild;
  if (item.kind === 'group') appendGroupSearchHits(node, item);
  node.dataset.canvasRenderKey = renderKey;
  wireCanvasNodeActions(node);
  node.querySelectorAll('[data-unlock-id]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      call('requestUnlockItem', item);
    });
  });
  node.querySelectorAll('img[data-canvas-media="true"]').forEach(wireCanvasMedia);
  node.querySelectorAll('img.favicon').forEach((img) => wireFavicon(img.parentElement));
  return node;
}

function removeCanvasNode(id, node) {
  cancelCanvasNodeClick(id);
  canvasNodeClickSuppressUntil.delete(id);
  node?.querySelectorAll('img[data-canvas-media="true"]').forEach((img) => {
    getThumbObserver()?.unobserve?.(img);
    getCanvasMediaObserver()?.unobserve?.(img);
  });
  node?.querySelectorAll('[data-note-attachment-key], [data-attachment-id]').forEach((img) => {
    getCanvasMediaObserver()?.unobserve?.(img);
  });
  node?.remove();
  canvasNodeElements.delete(id);
}

function renderCanvas() {
  if (!getCanvasNodesEl()) return;
  ensureCanvasStore();
  const searchContext = getCanvasSearchContext();
  const renderLayout = canvasSearchLayoutFor(searchContext);
  const filtered = searchContext.items;
  const visibleIds = new Set(filtered.map((item) => item.id));
  updateSavedBadge();
  syncCanvasIndexUi();
  if (getCanvasDropZone()) getCanvasDropZone().hidden = activeCanvasSelection().size < 2;

  for (const [id, node] of canvasNodeElements) {
    if (!visibleIds.has(id)) removeCanvasNode(id, node);
  }

  const empty = getCanvasNodesEl().querySelector('.canvas-empty');
  if (!getAllTabs().length || !filtered.length) {
    for (const [id, node] of canvasNodeElements) removeCanvasNode(id, node);
    if (!empty) {
      const message = document.createElement('div');
      message.className = 'canvas-empty';
      message.innerHTML = `<strong>${escapeHtml(t(getAllTabs().length ? 'noResultsTitle' : 'emptyTitle'))}</strong><span>${escapeHtml(t(getAllTabs().length ? 'noResultsBody' : 'emptyBody'))}</span>`;
      getCanvasNodesEl().appendChild(message);
    } else {
      empty.querySelector('strong').textContent = t(getAllTabs().length ? 'noResultsTitle' : 'emptyTitle');
      empty.querySelector('span').textContent = t(getAllTabs().length ? 'noResultsBody' : 'emptyBody');
    }
    updateCanvasTransform();
    renderCanvasConnections(searchContext);
    renderCanvasMinimap(filtered);
    updateBatchBar();
    return;
  }
  empty?.remove();

  const fragment = document.createDocumentFragment();
  filtered.forEach((item, index) => {
    let node = canvasNodeElements.get(item.id);
    const renderKey = canvasNodeRenderKey(item);
    if (!node || node.dataset.canvasRenderKey !== renderKey) {
      const replacement = createCanvasNodeElement(item, renderKey);
      if (node) node.replaceWith(replacement);
      node = replacement;
      canvasNodeElements.set(item.id, node);
    }
    const position = canvasDisplayPosition(renderLayout.positions[item.id] || canvasDefaultPosition(index));
    node.dataset.id = item.id;
    node.dataset.kind = item.kind;
    node.classList.toggle('canvas-group', item.kind === 'group');
    node.classList.toggle('canvas-note', item.kind === 'note');
    node.classList.toggle('search-direct', searchContext.queryActive && searchContext.directIds.has(item.id));
    node.classList.toggle('search-related', searchContext.queryActive && searchContext.relatedIds.has(item.id));
    const savedAt = Number(item.savedAt) || 0;
    if (savedAt && Date.now() - savedAt < 1800 && node.dataset.justSavedAt !== String(savedAt)) {
      node.dataset.justSavedAt = String(savedAt);
      node.classList.add('just-saved');
      global.setTimeout(() => node.classList.remove('just-saved'), 500);
    }
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
    node.style.width = `${position.w}px`;
    node.style.minHeight = `${position.h}px`;
    node.style.zIndex = String(Math.round(position.z || 0));
    // Moving an existing node through the fragment keeps DOM order without
    // recreating its listeners, focus target, or media loader state.
    fragment.appendChild(node);
  });
  getCanvasNodesEl().appendChild(fragment);
  filtered.forEach((item) => {
    if (item.kind !== 'note') return;
    const node = canvasNodeElements.get(item.id);
    if (node) wireStickerAttachmentImages(node, item);
  });
  updateCanvasTransform();
  updateCanvasNodePositions(canvasStoreSnapshot(), searchContext);
  updateCanvasNodeSelection();
  renderCanvasConnections(searchContext);
  getCanvasNodesEl().querySelectorAll('img[data-canvas-media="true"]').forEach(wireCanvasMedia);
  renderCanvasMinimap(filtered, renderLayout);
  updateBatchBar();
}

function canvasWorldViewportCenter() {
  const state = canvasStoreSnapshot();
  const viewport = state.layout?.viewport || DEFAULT_CANVAS_VIEWPORT;
  const rect = getCanvasViewportEl()?.getBoundingClientRect?.();
  const width = Math.max(1, getCanvasViewportEl()?.clientWidth || rect?.width || 1000);
  const height = Math.max(1, getCanvasViewportEl()?.clientHeight || rect?.height || 700);
  const zoom = Math.max(0.25, Number(viewport.zoom) || DEFAULT_CANVAS_VIEWPORT.zoom);
  return {
    x: (Number(viewport.x) || 0) + width / (2 * zoom),
    y: (Number(viewport.y) || 0) + height / (2 * zoom),
  };
}

function canvasArrangementEntries(items, layout = canvasStoreSnapshot().layout) {
  return items.map((item, index) => {
    const position = {
      ...(layout.positions?.[item.id] || canvasDefaultPosition(index)),
    };
    return { item, position, display: canvasDisplayPosition(position) };
  });
}

function arrangeCanvasGrid(items, layout) {
  const entries = canvasArrangementEntries(items, layout);
  if (!entries.length) return {};
  const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.ceil(entries.length / columns);
  const gapX = CanvasGeom().CANVAS_DEFAULT_CARD_GAP;
  const gapY = CanvasGeom().CANVAS_DEFAULT_CARD_GAP;
  const defaultWidth = CanvasGeom().CANVAS_NODE_DEFAULT_WIDTH * CanvasGeom().CANVAS_NODE_DISPLAY_SCALE;
  const defaultHeight = CanvasGeom().CANVAS_NODE_DEFAULT_HEIGHT * CanvasGeom().CANVAS_NODE_DISPLAY_SCALE;
  const slotWidth = Math.max(...entries.map(({ display }) => display.w), defaultWidth) + gapX;
  const slotHeight = Math.max(...entries.map(({ display }) => display.h), defaultHeight) + gapY;
  const boardWidth = columns * slotWidth - gapX;
  const boardHeight = rows * slotHeight - gapY;
  const center = canvasWorldViewportCenter();
  const positions = {};

  entries.forEach(({ item, position, display }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    position.x = center.x - boardWidth / 2 + column * slotWidth + (slotWidth - gapX - display.w) / 2;
    position.y = center.y - boardHeight / 2 + row * slotHeight + (slotHeight - gapY - display.h) / 2;
    position.z = index;
    snapCanvasPosition(position);
    positions[item.id] = position;
  });
  return positions;
}

function arrangeCanvasAlign(items, layout) {
  const entries = canvasArrangementEntries(items, layout);
  if (!entries.length) return {};
  const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.ceil(entries.length / columns);
  const gapX = CanvasGeom().CANVAS_DEFAULT_CARD_GAP;
  const gapY = CanvasGeom().CANVAS_DEFAULT_CARD_GAP;
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  entries.forEach(({ display }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], display.w);
    rowHeights[row] = Math.max(rowHeights[row], display.h);
  });
  const boardWidth = columnWidths.reduce((sum, width) => sum + width, 0) + gapX * (columns - 1);
  const boardHeight = rowHeights.reduce((sum, height) => sum + height, 0) + gapY * (rows - 1);
  const center = canvasWorldViewportCenter();
  const positions = {};
  entries.forEach(({ item, position }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const xOffset = columnWidths.slice(0, column).reduce((sum, width) => sum + width + gapX, 0);
    const yOffset = rowHeights.slice(0, row).reduce((sum, height) => sum + height + gapY, 0);
    position.x = center.x - boardWidth / 2 + xOffset;
    position.y = center.y - boardHeight / 2 + yOffset;
    position.z = index;
    snapCanvasPosition(position);
    positions[item.id] = position;
  });
  return positions;
}

  global.TabWallCanvasRender = {
    bind,
    canvasThumbHtml,
    safeNotePreviewHtml,
    canvasNodeActionEntries,
    canvasNodeHtml,
    canvasConnectionDomHandlePoint,
    canvasConnectionHandlePointForId,
    canvasConnectionHandlePointForCursor,
    canvasConnectionPosition,
    canvasConnectionHandlePoints,
    renderCanvasConnectionDraft,
    canvasConnectionRenderOffset,
    renderCanvasConnections,
    updateCanvasNodePositions,
    renderCanvasMinimap,
    canvasNodeRenderKey,
    createCanvasNodeElement,
    removeCanvasNode,
    renderCanvas,
    canvasWorldViewportCenter,
    canvasArrangementEntries,
    arrangeCanvasGrid,
    arrangeCanvasAlign,
  };
})(typeof self !== 'undefined' ? self : globalThis);
