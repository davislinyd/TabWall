/**
 * TabWall park canvas geometry — pure zoom / bounds / connection math.
 * Loaded by park.html after canvasStore.js, before park.js.
 * No DOM / store coupling; constants live here as single source for layout math.
 */
(function (global) {
  'use strict';

  const CANVAS_NODE_DISPLAY_SCALE = 1.1;
  const CANVAS_NODE_DEFAULT_WIDTH = 220;
  const CANVAS_NODE_DEFAULT_HEIGHT = 170;
  const CANVAS_DEFAULT_CARD_GAP = 128;
  const CANVAS_DEFAULT_VISIBLE_COLUMNS = 6;
  const CANVAS_CONNECTION_MAX_CURVE_OFFSET = 2000;
  const CANVAS_SEARCH_ZOOM_MAX = 1.8;
  const CANVAS_WHEEL_ZOOM_SENSITIVITY = 0.0015;
  const CANVAS_TRACKPAD_ZOOM_SENSITIVITY = 0.006;
  const CANVAS_WHEEL_ZOOM_FRAME_LIMIT = 120;

  function canvasDefaultPosition(index) {
    const i = Math.max(0, Number(index) || 0);
    const stepX = Math.round(CANVAS_NODE_DEFAULT_WIDTH * CANVAS_NODE_DISPLAY_SCALE) + CANVAS_DEFAULT_CARD_GAP;
    const stepY = Math.round(CANVAS_NODE_DEFAULT_HEIGHT * CANVAS_NODE_DISPLAY_SCALE) + CANVAS_DEFAULT_CARD_GAP;
    return {
      x: CANVAS_DEFAULT_CARD_GAP + (i % 4) * stepX,
      y: CANVAS_DEFAULT_CARD_GAP + Math.floor(i / 4) * stepY,
      w: CANVAS_NODE_DEFAULT_WIDTH,
      h: CANVAS_NODE_DEFAULT_HEIGHT,
      z: i,
    };
  }

  function canvasDisplayPosition(position, fallback = canvasDefaultPosition()) {
    const value = position && typeof position === 'object' ? position : fallback;
    const numeric = (candidate, fallbackValue) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallbackValue;
    return {
      x: numeric(value.x, fallback.x),
      y: numeric(value.y, fallback.y),
      w: Math.max(1, numeric(value.w, fallback.w)) * CANVAS_NODE_DISPLAY_SCALE,
      h: Math.max(1, numeric(value.h, fallback.h)) * CANVAS_NODE_DISPLAY_SCALE,
      z: numeric(value.z, fallback.z),
    };
  }

  function canvasBoundsForItems(items, layout) {
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const position = canvasDisplayPosition(layout.positions?.[item.id] || canvasDefaultPosition(index));
      const x = Number(position.x) || 0;
      const y = Number(position.y) || 0;
      const w = Math.max(1, Number(position.w) || 1);
      const h = Math.max(1, Number(position.h) || 1);
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x + w);
      bounds.maxY = Math.max(bounds.maxY, y + h);
    });
    return Number.isFinite(bounds.minX) ? bounds : null;
  }

  function canvasConnectionId(sourceId, targetId) {
    const [source, target] = String(sourceId) < String(targetId)
      ? [String(sourceId), String(targetId)]
      : [String(targetId), String(sourceId)];
    return `${source}::${target}`;
  }

  function canvasConnectionSideForVector(dx, dy) {
    if (!dx && !dy) return '';
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  }

  function canvasConnectionSideForPoint(rect, point) {
    if (!rect || !point) return '';
    return canvasConnectionSideForVector(
      point.x - (rect.x + rect.w / 2),
      point.y - (rect.y + rect.h / 2),
    );
  }

  /** Pure clamp; always returns {x,y} (never null). */
  function normalizeCanvasCurveOffset(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { x: 0, y: 0 };
    const x = Number.isFinite(Number(raw.x))
      ? Math.min(CANVAS_CONNECTION_MAX_CURVE_OFFSET, Math.max(-CANVAS_CONNECTION_MAX_CURVE_OFFSET, Number(raw.x)))
      : 0;
    const y = Number.isFinite(Number(raw.y))
      ? Math.min(CANVAS_CONNECTION_MAX_CURVE_OFFSET, Math.max(-CANVAS_CONNECTION_MAX_CURVE_OFFSET, Number(raw.y)))
      : 0;
    return { x, y };
  }

  function canvasCubicBezierPoint(points, t) {
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * points.p0.x
        + 3 * inverse ** 2 * t * points.p1.x
        + 3 * inverse * t ** 2 * points.p2.x
        + t ** 3 * points.p3.x,
      y: inverse ** 3 * points.p0.y
        + 3 * inverse ** 2 * t * points.p1.y
        + 3 * inverse * t ** 2 * points.p2.y
        + t ** 3 * points.p3.y,
    };
  }

  function canvasCubicBezierLength(points, endT = 1, steps = 48) {
    const limit = Math.max(0, Math.min(1, endT));
    const count = Math.max(4, Math.ceil(steps * limit));
    let length = 0;
    let previous = points.p0;
    for (let index = 1; index <= count; index += 1) {
      const point = canvasCubicBezierPoint(points, limit * index / count);
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    return length;
  }

  function canvasCubicBezierTAtLength(points, fraction) {
    const total = canvasCubicBezierLength(points);
    if (!total) return fraction;
    const target = total * fraction;
    let low = 0;
    let high = 1;
    for (let index = 0; index < 18; index += 1) {
      const middle = (low + high) / 2;
      if (canvasCubicBezierLength(points, middle) < target) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function canvasCubicBezierSplit(points, t) {
    const lerp = (left, right) => ({
      x: left.x + (right.x - left.x) * t,
      y: left.y + (right.y - left.y) * t,
    });
    const p01 = lerp(points.p0, points.p1);
    const p12 = lerp(points.p1, points.p2);
    const p23 = lerp(points.p2, points.p3);
    const p012 = lerp(p01, p12);
    const p123 = lerp(p12, p23);
    const middle = lerp(p012, p123);
    return {
      left: { p0: points.p0, p1: p01, p2: p012, p3: middle },
      right: { p0: middle, p1: p123, p2: p23, p3: points.p3 },
    };
  }

  function canvasConnectionCurveGeometry(sourcePoint, targetPoint, curveOffset = null) {
    if (!sourcePoint || !targetPoint) return null;
    const dx = targetPoint.x - sourcePoint.x;
    const dy = targetPoint.y - sourcePoint.y;
    const bend = Math.min(120, Math.max(24, Math.hypot(dx, dy) * 0.18));
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const baseControl1 = horizontal
      ? { x: sourcePoint.x + Math.sign(dx) * bend, y: sourcePoint.y }
      : { x: sourcePoint.x, y: sourcePoint.y + Math.sign(dy) * bend };
    const baseControl2 = horizontal
      ? { x: targetPoint.x - Math.sign(dx) * bend, y: targetPoint.y }
      : { x: targetPoint.x, y: targetPoint.y - Math.sign(dy) * bend };
    const offset = normalizeCanvasCurveOffset(curveOffset);
    const controlOffset = { x: offset.x * 4 / 3, y: offset.y * 4 / 3 };
    const control1 = { x: baseControl1.x + controlOffset.x, y: baseControl1.y + controlOffset.y };
    const control2 = { x: baseControl2.x + controlOffset.x, y: baseControl2.y + controlOffset.y };
    const points = { p0: sourcePoint, p1: control1, p2: control2, p3: targetPoint };
    return {
      ...points,
      offset,
      midpoint: canvasCubicBezierPoint(points, 0.5),
      pathD: `M ${sourcePoint.x} ${sourcePoint.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${targetPoint.x} ${targetPoint.y}`,
    };
  }

  function canvasConnectionCurveSegments(geometry) {
    if (!geometry) return [];
    const firstT = canvasCubicBezierTAtLength(geometry, 1 / 3);
    const secondT = canvasCubicBezierTAtLength(geometry, 2 / 3);
    const firstSplit = canvasCubicBezierSplit(geometry, firstT);
    const secondRatio = firstT < 1 ? (secondT - firstT) / (1 - firstT) : 0;
    const secondSplit = canvasCubicBezierSplit(firstSplit.right, Math.max(0, Math.min(1, secondRatio)));
    return [firstSplit.left, secondSplit.left, secondSplit.right].map((segment) => ({
      ...segment,
      pathD: `M ${segment.p0.x} ${segment.p0.y} C ${segment.p1.x} ${segment.p1.y}, ${segment.p2.x} ${segment.p2.y}, ${segment.p3.x} ${segment.p3.y}`,
    }));
  }

  function canvasConnectionPathD(sourcePoint, targetPoint, curveOffset = null) {
    return canvasConnectionCurveGeometry(sourcePoint, targetPoint, curveOffset)?.pathD || '';
  }

  function canvasConnectionHandlePoint(position, side) {
    const centerX = position.x + position.w / 2;
    const centerY = position.y + position.h / 2;
    if (side === 'top') return { x: centerX, y: position.y };
    if (side === 'bottom') return { x: centerX, y: position.y + position.h };
    if (side === 'left') return { x: position.x, y: centerY };
    return { x: position.x + position.w, y: centerY };
  }

  function canvasMinimapProjectionFor(nodeRects, viewportRect, mapWidth, mapHeight) {
    const allRects = [...nodeRects, viewportRect];
    if (!mapWidth || !mapHeight || !allRects.length) return null;
    const minX = Math.min(...allRects.map((rect) => rect.x));
    const minY = Math.min(...allRects.map((rect) => rect.y));
    const maxX = Math.max(...allRects.map((rect) => rect.x + rect.w));
    const maxY = Math.max(...allRects.map((rect) => rect.y + rect.h));
    const padding = Math.max(24, Math.max(maxX - minX, maxY - minY) * 0.06);
    const worldX = minX - padding;
    const worldY = minY - padding;
    const worldWidth = Math.max(1, maxX - minX + padding * 2);
    const worldHeight = Math.max(1, maxY - minY + padding * 2);
    const scale = Math.min((mapWidth - 2) / worldWidth, (mapHeight - 2) / worldHeight);
    return {
      mapWidth,
      mapHeight,
      worldX,
      worldY,
      worldWidth,
      worldHeight,
      scale,
      offsetX: (mapWidth - worldWidth * scale) / 2 - worldX * scale,
      offsetY: (mapHeight - worldHeight * scale) / 2 - worldY * scale,
    };
  }

  function canvasWheelZoomFactor(deltaY, sensitivity = CANVAS_WHEEL_ZOOM_SENSITIVITY) {
    const bounded = Math.max(-CANVAS_WHEEL_ZOOM_FRAME_LIMIT, Math.min(CANVAS_WHEEL_ZOOM_FRAME_LIMIT, Number(deltaY) || 0));
    return Math.exp(-bounded * sensitivity);
  }

  function canvasWheelZoomSensitivity(event) {
    return event?.ctrlKey && (Number(event?.deltaMode) || 0) === 0
      ? CANVAS_TRACKPAD_ZOOM_SENSITIVITY
      : CANVAS_WHEEL_ZOOM_SENSITIVITY;
  }

  /** Zoom so `columns` default-size cards (plus gaps) fit in the viewport width. */
  function canvasZoomToFitCardColumns(viewportWidth, options = {}) {
    const columns = Math.max(1, Number(options.columns) || CANVAS_DEFAULT_VISIBLE_COLUMNS);
    const padding = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 24;
    const minZoom = Number.isFinite(Number(options.minZoom)) ? Number(options.minZoom) : 0.25;
    const maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : 2;
    const displayWidth = CANVAS_NODE_DEFAULT_WIDTH * CANVAS_NODE_DISPLAY_SCALE;
    const contentWidth = columns * displayWidth + (columns - 1) * CANVAS_DEFAULT_CARD_GAP;
    const available = Math.max(1, Number(viewportWidth) || 0) - padding * 2;
    if (!(available > 0) || !(contentWidth > 0)) return minZoom;
    return Math.min(maxZoom, Math.max(minZoom, available / contentWidth));
  }

  /** Compute a centered viewport for transient canvas search results. */
  function canvasSearchViewportForBounds(viewportWidth, viewportHeight, bounds, options = {}) {
    const width = Number(viewportWidth) || 0;
    const height = Number(viewportHeight) || 0;
    if (!(width > 0) || !(height > 0) || !bounds || typeof bounds !== 'object') return null;
    const minX = Number(bounds.minX);
    const minY = Number(bounds.minY);
    const maxX = Number(bounds.maxX);
    const maxY = Number(bounds.maxY);
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null;

    const padding = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 24;
    const minZoom = Number.isFinite(Number(options.minZoom)) ? Number(options.minZoom) : 0.25;
    const maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : CANVAS_SEARCH_ZOOM_MAX;
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const availableWidth = Math.max(1, width - padding * 2);
    const availableHeight = Math.max(1, height - padding * 2);
    const requestedZoom = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
    const zoom = Math.min(maxZoom, Math.max(minZoom, requestedZoom));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return {
      x: centerX - width / (2 * zoom),
      y: centerY - height / (2 * zoom),
      zoom,
    };
  }

  global.TabWallCanvasGeometry = {
    CANVAS_NODE_DISPLAY_SCALE,
    CANVAS_NODE_DEFAULT_WIDTH,
    CANVAS_NODE_DEFAULT_HEIGHT,
    CANVAS_DEFAULT_CARD_GAP,
    CANVAS_DEFAULT_VISIBLE_COLUMNS,
    CANVAS_CONNECTION_MAX_CURVE_OFFSET,
    CANVAS_SEARCH_ZOOM_MAX,
    CANVAS_WHEEL_ZOOM_SENSITIVITY,
    CANVAS_TRACKPAD_ZOOM_SENSITIVITY,
    CANVAS_WHEEL_ZOOM_FRAME_LIMIT,
    canvasDefaultPosition,
    canvasDisplayPosition,
    canvasBoundsForItems,
    canvasConnectionId,
    canvasConnectionSideForVector,
    canvasConnectionSideForPoint,
    normalizeCanvasCurveOffset,
    canvasConnectionCurveGeometry,
    canvasCubicBezierPoint,
    canvasCubicBezierLength,
    canvasCubicBezierTAtLength,
    canvasCubicBezierSplit,
    canvasConnectionCurveSegments,
    canvasConnectionPathD,
    canvasConnectionHandlePoint,
    canvasMinimapProjectionFor,
    canvasWheelZoomFactor,
    canvasWheelZoomSensitivity,
    canvasZoomToFitCardColumns,
    canvasSearchViewportForBounds,
  };
})(typeof self !== 'undefined' ? self : globalThis);
