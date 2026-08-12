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
  const CANVAS_DEFAULT_CARD_GAP = 96;
  const CANVAS_CONNECTION_MAX_CURVE_OFFSET = 2000;
  const CANVAS_WHEEL_ZOOM_SENSITIVITY = 0.0015;
  const CANVAS_TRACKPAD_ZOOM_SENSITIVITY = 0.006;
  const CANVAS_WHEEL_ZOOM_FRAME_LIMIT = 120;
  const CANVAS_PERSPECTIVE = 1400;
  const CANVAS_DEPTH_MIN = -400;
  const CANVAS_DEPTH_MAX = 400;
  const CANVAS_DEPTH_STEP = 24;
  const CANVAS_TILT_FAR_DEG = 18;
  const CANVAS_TILT_NEAR_DEG = 2;

  function canvasDefaultPosition(index) {
    const i = Math.max(0, Number(index) || 0);
    const stepX = Math.round(CANVAS_NODE_DEFAULT_WIDTH * CANVAS_NODE_DISPLAY_SCALE) + CANVAS_DEFAULT_CARD_GAP;
    const stepY = Math.round(CANVAS_NODE_DEFAULT_HEIGHT * CANVAS_NODE_DISPLAY_SCALE) + CANVAS_DEFAULT_CARD_GAP;
    return {
      x: 96 + (i % 4) * stepX,
      y: 96 + Math.floor(i / 4) * stepY,
      w: CANVAS_NODE_DEFAULT_WIDTH,
      h: CANVAS_NODE_DEFAULT_HEIGHT,
      z: i,
      depth: 0,
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
      depth: numeric(value.depth, fallback.depth ?? 0),
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

  function normalizeCanvasDepth(value, fallback = 0) {
    const n = Number(value);
    const base = Number.isFinite(n) ? n : (Number.isFinite(Number(fallback)) ? Number(fallback) : 0);
    return Math.min(CANVAS_DEPTH_MAX, Math.max(CANVAS_DEPTH_MIN, Math.round(base / CANVAS_DEPTH_STEP) * CANVAS_DEPTH_STEP));
  }

  function cameraTiltForZoom(zoom, quiet = false) {
    if (quiet) return 0;
    const t = Math.max(0, Math.min(1, ((Number(zoom) || 1) - 0.45) / 0.7));
    return CANVAS_TILT_FAR_DEG * (1 - t) + CANVAS_TILT_NEAR_DEG * t;
  }

  function canvasCameraState(viewport, viewSize, options = {}) {
    const zoom = Number(viewport?.zoom) || 1;
    const tiltDeg = cameraTiltForZoom(zoom, options.quiet === true);
    return {
      x: Number(viewport?.x) || 0,
      y: Number(viewport?.y) || 0,
      zoom,
      tiltDeg,
      tilt: tiltDeg * Math.PI / 180,
      width: Math.max(0, Number(viewSize?.width) || 0),
      height: Math.max(0, Number(viewSize?.height) || 0),
      perspective: CANVAS_PERSPECTIVE,
    };
  }

  function projectCanvasPoint(world, camera) {
    if (!world || !camera || !camera.zoom) return null;
    const ox = camera.width / 2;
    const oy = camera.height / 2;
    const px = (Number(world.x) - camera.x) * camera.zoom;
    const py = (Number(world.y) - camera.y) * camera.zoom;
    const pz = (Number(world.depth) || 0) * camera.zoom;
    const cos = Math.cos(camera.tilt);
    const sin = Math.sin(camera.tilt);
    const y0 = py - oy;
    const y1 = y0 * cos - pz * sin;
    const z1 = y0 * sin + pz * cos;
    const denom = camera.perspective - z1;
    if (Math.abs(denom) < 1e-6) return null;
    const k = camera.perspective / denom;
    return { x: ox + k * (px - ox), y: oy + k * y1 };
  }

  function unprojectCanvasPoint(screen, camera, depth = 0) {
    if (!screen || !camera || !camera.zoom) return null;
    const ox = camera.width / 2;
    const oy = camera.height / 2;
    const cos = Math.cos(camera.tilt);
    const sin = Math.sin(camera.tilt);
    const pz = (Number(depth) || 0) * camera.zoom;
    const dy = Number(screen.y) - oy;
    const denomU = camera.perspective * cos + dy * sin;
    if (Math.abs(denomU) < 1e-6) return null;
    const u = (dy * (camera.perspective - pz * cos) + camera.perspective * pz * sin) / denomU;
    const z1 = u * sin + pz * cos;
    const kDenom = camera.perspective - z1;
    if (Math.abs(kDenom) < 1e-6) return null;
    const k = camera.perspective / kDenom;
    if (Math.abs(k) < 1e-6) return null;
    const px = ox + (Number(screen.x) - ox) / k;
    return {
      x: px / camera.zoom + camera.x,
      y: (u + oy) / camera.zoom + camera.y,
    };
  }

  function canvasConnectionAdjacency(connections) {
    const adj = new Map();
    const add = (from, to) => {
      if (!adj.has(from)) adj.set(from, new Set());
      adj.get(from).add(to);
    };
    for (const connection of Array.isArray(connections) ? connections : []) {
      const sourceId = String(connection?.sourceId || '');
      const targetId = String(connection?.targetId || '');
      if (!sourceId || !targetId || sourceId === targetId) continue;
      add(sourceId, targetId);
      add(targetId, sourceId);
    }
    return adj;
  }

  function canvasIslandIds(startId, connections) {
    const origin = String(startId || '');
    if (!origin) return [];
    const adj = canvasConnectionAdjacency(connections);
    const seen = new Set([origin]);
    const queue = [origin];
    while (queue.length) {
      const id = queue.shift();
      for (const next of adj.get(id) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return [...seen];
  }

  function applyCanvasIslandDepth(positions, ids, depth) {
    const next = { ...(positions || {}) };
    const value = normalizeCanvasDepth(depth);
    for (const id of ids || []) {
      const key = String(id || '');
      if (!key || !next[key]) continue;
      next[key] = { ...next[key], depth: value };
    }
    return next;
  }

  function mergeCanvasIslandDepth(positions, connections, sourceId, targetId) {
    const targetDepth = normalizeCanvasDepth(positions?.[targetId]?.depth);
    const ids = new Set([
      ...canvasIslandIds(sourceId, connections),
      ...canvasIslandIds(targetId, connections),
    ]);
    return applyCanvasIslandDepth(positions, ids, targetDepth);
  }

  function unifyCanvasIslandDepths(positions, connections) {
    const next = { ...(positions || {}) };
    const seen = new Set();
    for (const id of Object.keys(next)) {
      if (seen.has(id)) continue;
      const island = canvasIslandIds(id, connections).filter((member) => next[member]);
      island.forEach((member) => seen.add(member));
      if (island.length < 2) {
        if (next[id]) next[id] = { ...next[id], depth: normalizeCanvasDepth(next[id].depth) };
        continue;
      }
      const counts = new Map();
      for (const member of island) {
        const depth = normalizeCanvasDepth(next[member]?.depth);
        counts.set(depth, (counts.get(depth) || 0) + 1);
      }
      let chosen = normalizeCanvasDepth(next[island.slice().sort()[0]]?.depth);
      let best = -1;
      for (const [depth, count] of counts) {
        if (count > best || (count === best && depth < chosen)) {
          best = count;
          chosen = depth;
        }
      }
      for (const member of island) next[member] = { ...next[member], depth: chosen };
    }
    return next;
  }

  function pickCanvasNodeAtScreen(screen, camera, rects) {
    let best = '';
    let bestZ = -Infinity;
    for (const entry of Array.isArray(rects) ? rects : []) {
      const depth = Number(entry.depth) || 0;
      const point = unprojectCanvasPoint(screen, camera, depth);
      if (!point) continue;
      if (
        point.x < entry.x
        || point.y < entry.y
        || point.x > entry.x + entry.w
        || point.y > entry.y + entry.h
      ) continue;
      if (depth >= bestZ) {
        bestZ = depth;
        best = String(entry.id || '');
      }
    }
    return best;
  }

  global.TabWallCanvasGeometry = {
    CANVAS_NODE_DISPLAY_SCALE,
    CANVAS_NODE_DEFAULT_WIDTH,
    CANVAS_NODE_DEFAULT_HEIGHT,
    CANVAS_DEFAULT_CARD_GAP,
    CANVAS_CONNECTION_MAX_CURVE_OFFSET,
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
    CANVAS_PERSPECTIVE,
    CANVAS_DEPTH_MIN,
    CANVAS_DEPTH_MAX,
    CANVAS_DEPTH_STEP,
    CANVAS_TILT_FAR_DEG,
    CANVAS_TILT_NEAR_DEG,
    normalizeCanvasDepth,
    cameraTiltForZoom,
    canvasCameraState,
    projectCanvasPoint,
    unprojectCanvasPoint,
    canvasIslandIds,
    applyCanvasIslandDepth,
    mergeCanvasIslandDepth,
    unifyCanvasIslandDepths,
    pickCanvasNodeAtScreen,
  };
})(typeof self !== 'undefined' ? self : globalThis);
