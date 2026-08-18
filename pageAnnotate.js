/**
 * TabWall — page drawing overlay. Shadow DOM only; does not mutate the host page.
 */
(function (global) {
  const MAX_STROKES = 500;
  const MAX_POINTS = 2000;
  const MAX_TEXT_LENGTH = 2000;
  const MIN_POINT_DIST = 1.5;
  const HIGHLIGHT_SNAP_DEG = 12;
  const HIGHLIGHT_ALPHA = 0.38;
  const HIT_PAD = 8;
  const FAB_SIZE = 40;
  const TOOLBAR_HANDLE_SIZE = 32;
  const CHROME_GAP = 8;
  const FALLBACK_TOOLBAR_WIDTH = 560;
  const FALLBACK_TOOLBAR_HEIGHT = 40;
  const COLORS = ['#c97858', '#1f2937', '#dc2626', '#2563eb', '#16a34a', '#eab308'];
  const CHROME_KEY = 'pageAnnotateChrome';
  const DEFAULT_CHROME_INSET = 24;

  function newObjectId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      // fall through
    }
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function safeHexColor(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  }

  function safeText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maxLength);
  }

  function safeMarkdownUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw) || typeof URL !== 'function') return '';
    try {
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function splitMarkdownUrl(value) {
    let url = String(value || '');
    let trailing = '';
    while (/[.,!?;:)，。！？；：、]$/.test(url)) {
      trailing = `${url.slice(-1)}${trailing}`;
      url = url.slice(0, -1);
    }
    return { url, trailing };
  }

  function appendInlineMarkdown(parent, source) {
    const text = String(source || '');
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_/gi;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      if (match[1] != null) {
        const href = safeMarkdownUrl(match[2]);
        if (!href) {
          parent.append(document.createTextNode(match[0]));
        } else {
          const link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = match[1];
          link.addEventListener('click', (event) => event.stopPropagation());
          parent.append(link);
        }
      } else if (match[3] != null) {
        const split = splitMarkdownUrl(match[3]);
        const href = safeMarkdownUrl(split.url);
        if (!href) {
          parent.append(document.createTextNode(match[0]));
        } else {
          const link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = split.url;
          link.addEventListener('click', (event) => event.stopPropagation());
          parent.append(link, document.createTextNode(split.trailing));
        }
      } else if (match[4] != null) {
        const code = document.createElement('code');
        code.textContent = match[4];
        parent.append(code);
      } else if (match[5] != null || match[6] != null) {
        const strong = document.createElement('strong');
        strong.textContent = match[5] ?? match[6];
        parent.append(strong);
      } else if (match[7] != null) {
        const del = document.createElement('del');
        del.textContent = match[7];
        parent.append(del);
      } else {
        const em = document.createElement('em');
        em.textContent = match[8] ?? match[9];
        parent.append(em);
      }
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }

  function appendMarkdownBlocks(parent, source) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    let list = null;
    let listType = '';
    const closeList = () => {
      list = null;
      listType = '';
    };
    for (const line of lines) {
      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (heading) {
        closeList();
        const element = document.createElement(`h${heading[1].length}`);
        appendInlineMarkdown(element, heading[2]);
        parent.append(element);
      } else if (unordered || ordered) {
        const nextType = unordered ? 'ul' : 'ol';
        if (!list || listType !== nextType) {
          closeList();
          listType = nextType;
          list = document.createElement(nextType);
          parent.append(list);
        }
        const item = document.createElement('li');
        appendInlineMarkdown(item, (unordered || ordered)[1]);
        list.append(item);
      } else if (!line.trim()) {
        closeList();
        const blank = document.createElement('div');
        blank.className = 'markdown-blank';
        blank.textContent = '\u00a0';
        parent.append(blank);
      } else {
        closeList();
        const paragraph = document.createElement('div');
        paragraph.className = 'markdown-line';
        appendInlineMarkdown(paragraph, line);
        parent.append(paragraph);
      }
    }
  }

  function downsamplePoints(points) {
    const src = Array.isArray(points) ? points : [];
    const out = [];
    for (const raw of src) {
      const x = Number(raw?.x);
      const y = Number(raw?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const point = { x, y };
      const prev = out[out.length - 1];
      if (prev) {
        const dx = point.x - prev.x;
        const dy = point.y - prev.y;
        if ((dx * dx) + (dy * dy) < MIN_POINT_DIST * MIN_POINT_DIST) continue;
      }
      out.push(point);
      if (out.length >= MAX_POINTS) break;
    }
    return out;
  }

  function normalizeStroke(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const points = downsamplePoints(src.points);
    if (points.length < 2) return null;
    const tool = src.tool === 'eraser' ? 'eraser' : 'pen';
    return {
      id: typeof src.id === 'string' && src.id ? src.id : newObjectId(),
      kind: 'stroke',
      tool,
      color: safeHexColor(src.color, '#c97858'),
      width: clamp(Math.round(Number(src.width) || 3), 1, 24),
      points,
    };
  }

  function snapHighlightLine(x1, y1, x2, y2) {
    const a = Number(x1);
    const b = Number(y1);
    const c = Number(x2);
    const d = Number(y2);
    if (![a, b, c, d].every(Number.isFinite)) return null;
    const dx = c - a;
    const dy = d - b;
    if (dx === 0 && dy === 0) return null;
    const deg = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
    if (deg < HIGHLIGHT_SNAP_DEG) return { x1: a, y1: b, x2: c, y2: b };
    return { x1: a, y1: b, x2: c, y2: d };
  }

  function normalizeLine(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const snapped = snapHighlightLine(src.x1, src.y1, src.x2, src.y2);
    if (!snapped) return null;
    return {
      id: typeof src.id === 'string' && src.id ? src.id : newObjectId(),
      kind: 'line',
      tool: 'highlight',
      color: safeHexColor(src.color, '#eab308'),
      width: clamp(Math.round(Number(src.width) || 16), 4, 48),
      x1: snapped.x1,
      y1: snapped.y1,
      x2: snapped.x2,
      y2: snapped.y2,
    };
  }

  function normalizeShape(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const shape = ['line', 'circle', 'rect'].includes(src.shape) ? src.shape : '';
    const x1 = Number(src.x1);
    const y1 = Number(src.y1);
    const x2 = Number(src.x2);
    const y2 = Number(src.y2);
    if (!shape || ![x1, y1, x2, y2].every(Number.isFinite)) return null;
    if (shape === 'line' ? (x1 === x2 && y1 === y2) : (x1 === x2 || y1 === y2)) return null;
    return {
      id: typeof src.id === 'string' && src.id ? src.id : newObjectId(),
      kind: 'shape',
      shape,
      tool: shape,
      color: safeHexColor(src.color, '#c97858'),
      width: clamp(Math.round(Number(src.width) || 3), 1, 24),
      x1,
      y1,
      x2,
      y2,
      constrainCircle: shape === 'circle' && src.constrainCircle === true,
    };
  }

  function normalizeText(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const x = Number(src.x);
    const y = Number(src.y);
    const text = safeText(src.text, MAX_TEXT_LENGTH);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !text.trim()) return null;
    const fontSize = clamp(Math.round(Number(src.fontSize) || 16), 10, 64);
    const measured = measureTextBox(text, fontSize);
    const w = Number(src.w);
    const h = Number(src.h);
    return {
      id: typeof src.id === 'string' && src.id ? src.id : newObjectId(),
      kind: 'text',
      tool: 'text',
      x,
      y,
      w: Number.isFinite(w) && w > 0 ? w : measured.w,
      h: Number.isFinite(h) && h > 0 ? h : measured.h,
      text,
      color: safeHexColor(src.color, '#1f2937'),
      fontSize,
    };
  }

  function objectKind(raw) {
    if (!raw || typeof raw !== 'object') return '';
    if (raw.kind === 'shape' || ['line', 'circle', 'rect'].includes(raw.shape)) return 'shape';
    if (raw.kind === 'line' || raw.kind === 'text' || raw.kind === 'stroke') return raw.kind;
    if (raw.tool === 'highlight' || (raw.x1 != null && raw.x2 != null)) return 'line';
    if (raw.tool === 'text' || typeof raw.text === 'string') return 'text';
    return 'stroke';
  }

  function normalizeObject(raw) {
    const kind = objectKind(raw);
    if (kind === 'shape') return normalizeShape(raw);
    if (kind === 'line') return normalizeLine(raw);
    if (kind === 'text') return normalizeText(raw);
    return normalizeStroke(raw);
  }

  function normalizeObjects(list) {
    return (Array.isArray(list) ? list : []).map(normalizeObject).filter(Boolean).slice(-MAX_STROKES);
  }

  function shapeGeometry(obj) {
    const shape = obj?.shape;
    const x1 = Number(obj?.x1);
    const y1 = Number(obj?.y1);
    const sourceX2 = Number(obj?.x2);
    const sourceY2 = Number(obj?.y2);
    if (!['line', 'circle', 'rect'].includes(shape) || ![x1, y1, sourceX2, sourceY2].every(Number.isFinite)) return null;
    if (shape === 'line') return { shape, x1, y1, x2: sourceX2, y2: sourceY2 };
    let x2 = sourceX2;
    let y2 = sourceY2;
    if (shape === 'circle' && obj.constrainCircle === true) {
      const dx = sourceX2 - x1;
      const dy = sourceY2 - y1;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      x2 = x1 + (dx === 0 ? (dy < 0 ? -size : size) : Math.sign(dx) * size);
      y2 = y1 + (dy === 0 ? (dx < 0 ? -size : size) : Math.sign(dy) * size);
    }
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    return {
      shape,
      x1,
      y1,
      x2,
      y2,
      x,
      y,
      w,
      h,
      cx: x + w / 2,
      cy: y + h / 2,
      rx: w / 2,
      ry: h / 2,
    };
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = (dx * dx) + (dy * dy);
    if (len2 <= 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function measureTextBox(text, fontSize, measure) {
    const size = Number(fontSize) || 16;
    const lines = String(text || '').split('\n');
    let width = 24;
    for (const line of lines) {
      const raw = line.length ? line : ' ';
      const w = typeof measure === 'function'
        ? Number(measure(raw)) || 0
        : Math.max(1, raw.length) * size * 0.7;
      if (w > width) width = w;
    }
    return {
      w: Math.max(24, Math.ceil(width + 8)),
      h: Math.max(size, Math.ceil(lines.length * size * 1.3)),
    };
  }

  function textBounds(obj) {
    const fontSize = Number(obj?.fontSize) || 16;
    if (Number.isFinite(obj?.w) && Number.isFinite(obj?.h) && obj.w > 0 && obj.h > 0) {
      return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    }
    const box = measureTextBox(obj?.text, fontSize);
    return { x: obj.x, y: obj.y, w: box.w, h: box.h };
  }

  function translateObject(obj, dx, dy) {
    if (!obj) return obj;
    const x = Number(dx) || 0;
    const y = Number(dy) || 0;
    if (!x && !y) return obj;
    if (obj.kind === 'text') return { ...obj, x: obj.x + x, y: obj.y + y };
    if (obj.kind === 'line') {
      return {
        ...obj,
        x1: obj.x1 + x,
        y1: obj.y1 + y,
        x2: obj.x2 + x,
        y2: obj.y2 + y,
      };
    }
    if (obj.kind === 'shape') {
      return {
        ...obj,
        x1: obj.x1 + x,
        y1: obj.y1 + y,
        x2: obj.x2 + x,
        y2: obj.y2 + y,
      };
    }
    if (Array.isArray(obj.points)) {
      return {
        ...obj,
        points: obj.points.map((point) => ({ x: point.x + x, y: point.y + y })),
      };
    }
    return obj;
  }

  function snapshotObjects(list) {
    return (Array.isArray(list) ? list : []).map((item) => ({ ...item, points: item.points ? item.points.map((point) => ({ ...point })) : item.points }));
  }

  function createUndoStack(limit = 40) {
    const items = [];
    return {
      push(snapshot) {
        items.push(snapshot);
        while (items.length > limit) items.shift();
      },
      pop() {
        return items.length ? items.pop() : null;
      },
      get length() {
        return items.length;
      },
    };
  }

  function strokeBounds(obj) {
    const pts = obj.points || [];
    if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = pts[0].x;
    let minY = pts[0].y;
    let maxX = pts[0].x;
    let maxY = pts[0].y;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = (obj.width || 3) / 2 + 2;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  function lineBounds(obj) {
    const pad = (obj.width || 16) / 2 + 2;
    const minX = Math.min(obj.x1, obj.x2);
    const minY = Math.min(obj.y1, obj.y2);
    const maxX = Math.max(obj.x1, obj.x2);
    const maxY = Math.max(obj.y1, obj.y2);
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  function shapeBounds(obj) {
    const geometry = shapeGeometry(obj);
    if (!geometry) return null;
    const pad = (obj.width || 3) / 2 + 2;
    if (geometry.shape === 'line') {
      const minX = Math.min(geometry.x1, geometry.x2);
      const minY = Math.min(geometry.y1, geometry.y2);
      const maxX = Math.max(geometry.x1, geometry.x2);
      const maxY = Math.max(geometry.y1, geometry.y2);
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    return {
      x: geometry.x - pad,
      y: geometry.y - pad,
      w: geometry.w + pad * 2,
      h: geometry.h + pad * 2,
    };
  }

  function objectBounds(obj) {
    if (!obj) return null;
    if (obj.kind === 'text') return textBounds(obj);
    if (obj.kind === 'line') return lineBounds(obj);
    if (obj.kind === 'shape') return shapeBounds(obj);
    return strokeBounds(obj);
  }

  function distToRectOutline(px, py, box) {
    const outsideX = Math.max(box.x - px, 0, px - (box.x + box.w));
    const outsideY = Math.max(box.y - py, 0, py - (box.y + box.h));
    if (outsideX || outsideY) return Math.hypot(outsideX, outsideY);
    return Math.min(px - box.x, box.x + box.w - px, py - box.y, box.y + box.h - py);
  }

  function distToEllipseOutline(px, py, geometry) {
    if (geometry.rx <= 0 || geometry.ry <= 0) return Infinity;
    const normalized = Math.hypot(
      (px - geometry.cx) / geometry.rx,
      (py - geometry.cy) / geometry.ry,
    );
    return Math.abs(normalized - 1) * Math.min(geometry.rx, geometry.ry);
  }

  function hitTestShape(obj, point) {
    const geometry = shapeGeometry(obj);
    if (!geometry) return Infinity;
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (![x, y].every(Number.isFinite)) return Infinity;
    if (geometry.shape === 'line') {
      return distToSegment(x, y, geometry.x1, geometry.y1, geometry.x2, geometry.y2) - (obj.width || 3) / 2;
    }
    const distance = geometry.shape === 'rect'
      ? distToRectOutline(x, y, geometry)
      : distToEllipseOutline(x, y, geometry);
    return distance - (obj.width || 3) / 2;
  }

  function hitTestObject(obj, point, pad = HIT_PAD) {
    if (!obj || !point) return Infinity;
    const x = Number(point.x);
    const y = Number(point.y);
    if (obj.kind === 'text') {
      const box = textBounds(obj);
      if (x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad) {
        return 0;
      }
      return Infinity;
    }
    if (obj.kind === 'line') {
      return distToSegment(x, y, obj.x1, obj.y1, obj.x2, obj.y2) - (obj.width || 16) / 2;
    }
    if (obj.kind === 'shape') return hitTestShape(obj, point);
    const pts = obj.points || [];
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const d = distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      if (d < best) best = d;
    }
    return best - (obj.width || 3) / 2;
  }

  function resolveOverlayVisible(stored, sessionHint) {
    if (sessionHint === true) return true;
    if (sessionHint === false) return false;
    return stored === true;
  }

  function toolbarModeForCollapsed(collapsed) {
    return collapsed ? 'view' : 'pen';
  }

  function clampChromeAnchor(anchorX, anchorY, viewportWidth, viewportHeight, iconSize = FAB_SIZE, gap = CHROME_GAP) {
    const width = Math.max(Number(viewportWidth) || 0, iconSize + gap * 2);
    const height = Math.max(Number(viewportHeight) || 0, iconSize + gap * 2);
    const maxX = Math.max(gap, width - iconSize - gap);
    const maxY = Math.max(gap, height - iconSize - gap);
    const rawX = Number(anchorX);
    const rawY = Number(anchorY);
    return {
      x: clamp(Number.isFinite(rawX) ? rawX : maxX, gap, maxX),
      y: clamp(Number.isFinite(rawY) ? rawY : gap, gap, maxY),
    };
  }

  function resolveChromeLayout({
    anchorX = 0,
    anchorY = 0,
    viewportWidth = 0,
    viewportHeight = 0,
    iconSize = FAB_SIZE,
    panelWidth = FALLBACK_TOOLBAR_WIDTH,
    horizontalWidth = panelWidth,
    panelHeight = FALLBACK_TOOLBAR_HEIGHT,
    gap = CHROME_GAP,
  } = {}) {
    const width = Math.max(Number(viewportWidth) || 0, iconSize + gap * 2);
    const height = Math.max(Number(viewportHeight) || 0, iconSize + gap * 2);
    const anchor = clampChromeAnchor(anchorX, anchorY, width, height, iconSize, gap);
    const measuredPanelWidth = Number(panelWidth);
    const measuredHorizontalWidth = Number(horizontalWidth);
    const toolbarWidth = Math.max(
      iconSize,
      Number.isFinite(measuredPanelWidth) && measuredPanelWidth > 0
        ? measuredPanelWidth
        : FALLBACK_TOOLBAR_WIDTH,
    );
    const fitWidth = Math.max(
      iconSize,
      Number.isFinite(measuredHorizontalWidth) && measuredHorizontalWidth > 0
        ? measuredHorizontalWidth
        : toolbarWidth,
    );
    const measuredPanelHeight = Number(panelHeight);
    const toolbarHeight = Math.max(
      iconSize,
      Number.isFinite(measuredPanelHeight) && measuredPanelHeight > 0
        ? measuredPanelHeight
        : FALLBACK_TOOLBAR_HEIGHT,
    );
    const leftAvailable = anchor.x + iconSize - gap;
    const rightAvailable = width - anchor.x - gap;
    const fitsLeft = fitWidth <= leftAvailable;
    const fitsRight = fitWidth <= rightAvailable;
    const side = fitsLeft && fitsRight
      ? (leftAvailable > rightAvailable ? 'left' : 'right')
      : fitsLeft
        ? 'left'
        : 'right';
    const needsVertical = !fitsLeft && !fitsRight;

    if (!needsVertical) {
      const left = side === 'left' ? anchor.x + iconSize - toolbarWidth : anchor.x;
      const top = clamp(anchor.y, gap, Math.max(gap, height - toolbarHeight - gap));
      return {
        orientation: 'horizontal',
        side,
        verticalDirection: '',
        anchorX: anchor.x,
        anchorY: anchor.y,
        left: clamp(left, gap, Math.max(gap, width - toolbarWidth - gap)),
        top,
        width: toolbarWidth,
        height: toolbarHeight,
      };
    }

    const below = height - anchor.y - iconSize - gap;
    const above = anchor.y - gap;
    const verticalDirection = below >= toolbarHeight || below >= above ? 'down' : 'up';
    const verticalTop = verticalDirection === 'down'
      ? anchor.y
      : anchor.y + iconSize - toolbarHeight;
    const left = side === 'left' ? anchor.x + iconSize - toolbarWidth : anchor.x;
    return {
      orientation: 'vertical',
      side,
      verticalDirection,
      anchorX: anchor.x,
      anchorY: anchor.y,
      left: clamp(left, gap, Math.max(gap, width - toolbarWidth - gap)),
      top: clamp(verticalTop, gap, Math.max(gap, height - toolbarHeight - gap)),
      width: toolbarWidth,
      height: toolbarHeight,
    };
  }

  function hitTestObjects(list, point, pad = HIT_PAD) {
    let best = null;
    let bestDist = pad;
    for (let i = (list || []).length - 1; i >= 0; i--) {
      const obj = list[i];
      const dist = hitTestObject(obj, point, pad);
      if (dist <= bestDist) {
        best = obj;
        bestDist = Math.min(dist, 0);
        if (dist <= 0) return obj;
      }
    }
    return best;
  }

  global.TabWallPageInk = {
    MAX_STROKES,
    MAX_POINTS,
    MAX_TEXT_LENGTH,
    HIGHLIGHT_SNAP_DEG,
    downsamplePoints,
    normalizeStroke,
    normalizeLine,
    normalizeShape,
    normalizeText,
    normalizeObject,
    normalizeObjects,
    snapHighlightLine,
    shapeGeometry,
    hitTestObject,
    hitTestObjects,
    objectBounds,
    textBounds,
    measureTextBox,
    safeMarkdownUrl,
    translateObject,
    snapshotObjects,
    createUndoStack,
    resolveOverlayVisible,
    toolbarModeForCollapsed,
    clampChromeAnchor,
    resolveChromeLayout,
    canvasScrollTransform,
    DEFAULT_COLLAPSED: true,
  };

  if (typeof document === 'undefined' || !document.documentElement) return;
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  try {
    if (location.protocol === 'chrome-extension:') return;
  } catch {
    return;
  }

  const MARKER = '__tabWallPageAnnotate';
  try {
    if (global[MARKER]?.dispose) global[MARKER].dispose();
  } catch {
    // stale instance from extension reload
  }
  for (const staleRoot of document.querySelectorAll('[data-tabwall-annotate="1"]')) {
    staleRoot.remove();
  }

  const ROOT_ID = 'tabwall-annotate-root';
  const zh = /zh/i.test(navigator.language || '');
  const copy = zh
    ? {
      select: '選',
      pen: '筆',
      highlight: '螢',
      line: '直線',
      circle: '圓圈',
      rectangle: '方框',
      text: '字',
      eraser: '擦',
      view: '檢視',
      del: '刪除',
      clear: '清除',
      expandTools: '展開繪圖工具',
      collapseTools: '收合繪圖工具',
      hide: '關閉圖層',
      undo: '復原',
    }
    : {
      select: 'Pick',
      pen: 'Pen',
      highlight: 'Mark',
      line: 'Line',
      circle: 'Circle',
      rectangle: 'Box',
      text: 'Text',
      eraser: 'Erase',
      view: 'View',
      del: 'Delete',
      clear: 'Clear',
      expandTools: 'Expand drawing tools',
      collapseTools: 'Collapse drawing tools',
      hide: 'Hide layer',
      undo: 'Undo',
    };

  let rootEl = null;
  let shadow = null;
  let canvas = null;
  let ctx = null;
  let toolbar = null;
  let toolsEl = null;
  let chromeHandle = null;
  let fab = null;
  let textLayer = null;
  let hoverId = '';
  let textEditor = null;
  let visible = false;
  let tool = 'pen';
  let color = COLORS[0];
  let width = 3;
  let objects = [];
  let current = null;
  let selectedId = '';
  let editingId = '';
  let persistTimer = 0;
  let persistChain = Promise.resolve();
  let inkLoaded = false;
  let dragObj = null;
  const undoStack = createUndoStack(40);
  let chromeTimer = 0;
  let parkBlocked = false;
  let runtimeHandler = null;
  let keyHandler = null;
  let resizeObserver = null;
  let mutationObserver = null;
  let barPos = { x: null, y: null, collapsed: true };
  let dragBar = null;
  let lastToggleAt = 0;

  function pageUrl() {
    try {
      return location.href;
    } catch {
      return '';
    }
  }

  function sendRuntime(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          resolve(chrome.runtime.lastError ? { ok: false } : (response || { ok: false }));
        });
      } catch {
        resolve({ ok: false });
      }
    });
  }

  function pageSize() {
    const doc = document.documentElement;
    const body = document.body;
    return {
      w: Math.max(doc.scrollWidth, body?.scrollWidth || 0, window.innerWidth || 0, 1),
      h: Math.max(doc.scrollHeight, body?.scrollHeight || 0, window.innerHeight || 0, 1),
    };
  }

  function pointerToDoc(event) {
    return { x: event.pageX, y: event.pageY };
  }

  function canvasScrollTransform(scrollX, scrollY) {
    const x = Number(scrollX);
    const y = Number(scrollY);
    const offsetX = Number.isFinite(x) ? x : 0;
    const offsetY = Number.isFinite(y) ? y : 0;
    return `translate(${-offsetX}px, ${-offsetY}px)`;
  }

  function paintStroke(obj, context) {
    if (!obj?.points || obj.points.length < 2) return;
    context.save();
    context.globalCompositeOperation = obj.tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = obj.tool === 'eraser' ? 'rgba(0,0,0,1)' : obj.color;
    context.lineWidth = obj.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(obj.points[0].x, obj.points[0].y);
    for (let i = 1; i < obj.points.length; i++) context.lineTo(obj.points[i].x, obj.points[i].y);
    context.stroke();
    context.restore();
  }

  function paintLine(obj, context) {
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = HIGHLIGHT_ALPHA;
    context.strokeStyle = obj.color;
    context.lineWidth = obj.width;
    context.lineCap = 'butt';
    context.beginPath();
    context.moveTo(obj.x1, obj.y1);
    context.lineTo(obj.x2, obj.y2);
    context.stroke();
    context.restore();
  }

  function paintShape(obj, context) {
    const geometry = shapeGeometry(obj);
    if (!geometry) return;
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.strokeStyle = obj.color;
    context.lineWidth = obj.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (geometry.shape === 'line') {
      context.moveTo(geometry.x1, geometry.y1);
      context.lineTo(geometry.x2, geometry.y2);
    } else if (geometry.shape === 'rect') {
      context.rect(geometry.x, geometry.y, geometry.w, geometry.h);
    } else {
      context.ellipse(geometry.cx, geometry.cy, geometry.rx, geometry.ry, 0, 0, Math.PI * 2);
    }
    context.stroke();
    context.restore();
  }

  function paintText(obj, context) {
    if (obj.id === editingId || textLayer) return;
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = obj.color;
    context.font = `${obj.fontSize}px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textBaseline = 'top';
    const lines = String(obj.text || '').split('\n');
    lines.forEach((line, index) => {
      context.fillText(line, obj.x, obj.y + index * obj.fontSize * 1.3);
    });
    context.restore();
  }

  function renderTextObjects() {
    if (!textLayer) return;
    textLayer.replaceChildren();
    for (const obj of objects) {
      if (obj.kind !== 'text' || obj.id === editingId) continue;
      const view = document.createElement('div');
      view.className = 'text-render';
      view.classList.toggle('is-editable', tool === 'view');
      view.dataset.objectId = obj.id;
      view.style.left = `${obj.x}px`;
      view.style.top = `${obj.y}px`;
      view.style.width = `${Math.max(80, Number(obj.w) || 80)}px`;
      view.style.minHeight = `${Math.max(1, Number(obj.h) || obj.fontSize || 16)}px`;
      view.style.color = obj.color;
      view.style.fontSize = `${obj.fontSize || 16}px`;
      appendMarkdownBlocks(view, obj.text);
      view.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startTextEdit(obj);
      });
      textLayer.appendChild(view);
    }
  }

  function paintSelection(obj, context, hover = false) {
    const box = objectBounds(obj);
    if (!box) return;
    context.save();
    context.setLineDash(hover ? [2, 4] : [4, 3]);
    context.strokeStyle = hover ? 'rgba(37, 99, 235, 0.45)' : '#2563eb';
    context.lineWidth = 1;
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.restore();
  }

  function paintObject(obj, context) {
    if (!obj) return;
    if (obj.kind === 'line') paintLine(obj, context);
    else if (obj.kind === 'shape') paintShape(obj, context);
    else if (obj.kind === 'text') paintText(obj, context);
    else paintStroke(obj, context);
  }

  function redraw() {
    if (!ctx || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const obj of objects) paintObject(obj, ctx);
    if (current) paintObject(current, ctx);
    const hover = hoverId && hoverId !== selectedId
      ? objects.find((obj) => obj.id === hoverId)
      : null;
    if (hover) paintSelection(hover, ctx, true);
    const selected = objects.find((obj) => obj.id === selectedId);
    if (selected) paintSelection(selected, ctx, false);
    renderTextObjects();
  }

  function syncCanvasSize() {
    if (!canvas) return;
    const { w, h } = pageSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (textLayer) {
      textLayer.style.width = `${w}px`;
      textLayer.style.height = `${h}px`;
    }
    const nextW = Math.max(1, Math.round(w * dpr));
    const nextH = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    syncCanvasScroll();
    redraw();
  }

  function syncCanvasScroll() {
    const transform = canvasScrollTransform(window.scrollX, window.scrollY);
    if (canvas) canvas.style.transform = transform;
    if (textLayer) textLayer.style.transform = transform;
    if (textEditor) textEditor.style.transform = transform;
  }

  function capturing() {
    return visible && !parkBlocked && ['pen', 'eraser', 'highlight', 'line', 'circle', 'rect', 'text'].includes(tool);
  }

  function defaultFabLeft() {
    return Math.max(CHROME_GAP, window.innerWidth - FAB_SIZE - DEFAULT_CHROME_INSET);
  }

  function defaultFabTop() {
    return Math.max(CHROME_GAP, Math.round((window.innerHeight - FAB_SIZE) / 2));
  }

  function chromeLeft() {
    return barPos.x == null ? defaultFabLeft() : barPos.x;
  }

  function chromeTop() {
    return Number.isFinite(barPos.y) ? barPos.y : defaultFabTop();
  }

  function toolbarDimensions() {
    const rect = toolbar?.getBoundingClientRect?.();
    let horizontalWidth = rect?.width || 0;
    if (toolbar && !toolbar.hidden && toolbar.classList.contains('is-vertical')) {
      const className = toolbar.className;
      toolbar.classList.remove('is-vertical', 'opens-up', 'opens-down');
      horizontalWidth = toolbar.getBoundingClientRect().width || horizontalWidth;
      toolbar.className = className;
    }
    return {
      width: Math.max(rect?.width || 0, toolbar?.hidden ? FALLBACK_TOOLBAR_WIDTH : FAB_SIZE),
      horizontalWidth: Math.max(horizontalWidth, FALLBACK_TOOLBAR_WIDTH),
      height: Math.max(rect?.height || 0, toolbar?.hidden ? FALLBACK_TOOLBAR_HEIGHT : FAB_SIZE),
    };
  }

  function clampBar() {
    if (barPos.x == null) {
      applyChromePosition();
      return;
    }
    const anchor = clampChromeAnchor(
      barPos.x,
      barPos.y,
      window.innerWidth,
      window.innerHeight,
    );
    barPos.x = anchor.x;
    barPos.y = anchor.y;
    applyChromePosition();
  }

  function applyChromePosition() {
    const anchor = clampChromeAnchor(
      chromeLeft(),
      chromeTop(),
      window.innerWidth,
      window.innerHeight,
    );
    const dimensions = toolbarDimensions();
    const layout = resolveChromeLayout({
      anchorX: anchor.x,
      anchorY: anchor.y,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      panelWidth: dimensions.width,
      horizontalWidth: dimensions.horizontalWidth,
      panelHeight: dimensions.height,
    });
    if (toolbar) {
      toolbar.style.left = `${layout.left}px`;
      toolbar.style.top = `${layout.top}px`;
      toolbar.style.transform = 'none';
      toolbar.classList.toggle('is-vertical', layout.orientation === 'vertical');
      toolbar.classList.toggle('opens-left', layout.side === 'left');
      toolbar.classList.toggle('opens-right', layout.side === 'right');
      toolbar.classList.toggle('opens-up', layout.verticalDirection === 'up');
      toolbar.classList.toggle('opens-down', layout.verticalDirection === 'down');
      toolbar.dataset.chromeOrientation = layout.orientation;
      toolbar.dataset.chromeSide = layout.side;
      toolbar.dataset.chromeVerticalDirection = layout.verticalDirection;
    }
    if (fab) {
      fab.style.left = `${anchor.x}px`;
      fab.style.top = `${anchor.y}px`;
    }
  }

  function applyBarChrome() {
    if (!toolbar || !fab) return;
    const show = visible && !parkBlocked;
    toolbar.hidden = !show || barPos.collapsed;
    fab.hidden = !show || !barPos.collapsed;
    toolbar.classList.toggle('collapsed', barPos.collapsed);
    applyChromePosition();
    requestAnimationFrame(clampBar);
  }

  function scheduleChromePersist() {
    window.clearTimeout(chromeTimer);
    chromeTimer = window.setTimeout(() => {
      try {
        chrome.storage.local.set({
          [CHROME_KEY]: {
            x: barPos.x,
            y: barPos.y,
          },
        });
      } catch {
        // ignore
      }
    }, 200);
  }

  async function loadBarChrome() {
    try {
      const data = await chrome.storage.local.get(CHROME_KEY);
      const raw = data[CHROME_KEY];
      if (raw && typeof raw === 'object') {
        const x = Number(raw.x);
        const y = Number(raw.y);
        barPos = {
          x: Number.isFinite(x) ? x : null,
          y: Number.isFinite(y) ? y : null,
          collapsed: true,
        };
        tool = toolbarModeForCollapsed(true);
      }
    } catch {
      // ignore
    }
    applyBarChrome();
  }

  function syncChrome() {
    if (!rootEl) return;
    canvas.style.display = visible ? 'block' : 'none';
    canvas.style.pointerEvents = capturing() ? 'auto' : 'none';
    if (textLayer) textLayer.hidden = !visible || parkBlocked;
    const chromeLabel = barPos.collapsed ? copy.expandTools : copy.collapseTools;
    for (const handle of [chromeHandle, fab]) {
      if (!handle) continue;
      handle.title = chromeLabel;
      handle.setAttribute('aria-label', chromeLabel);
      handle.setAttribute('aria-expanded', barPos.collapsed ? 'false' : 'true');
    }
    for (const button of toolbar.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', button.dataset.tool === tool ? 'true' : 'false');
    }
    applyBarChrome();
  }

  const OPEN_HINT_KEY = 'pageAnnotateOpenUrls';

  async function writeOpenHint(open) {
    const url = pageUrl();
    if (!url || !chrome.storage?.session) return;
    try {
      const data = await chrome.storage.session.get(OPEN_HINT_KEY);
      const map = data[OPEN_HINT_KEY] && typeof data[OPEN_HINT_KEY] === 'object'
        ? { ...data[OPEN_HINT_KEY] }
        : {};
      map[url] = open === true;
      await chrome.storage.session.set({ [OPEN_HINT_KEY]: map });
    } catch {
      // session storage may be unavailable
    }
  }

  async function readOpenHint() {
    const url = pageUrl();
    if (!url || !chrome.storage?.session) return null;
    try {
      const data = await chrome.storage.session.get(OPEN_HINT_KEY);
      const map = data[OPEN_HINT_KEY];
      if (!map || typeof map !== 'object') return null;
      if (map[url] === true) return true;
      if (Object.prototype.hasOwnProperty.call(map, url) && map[url] === false) return false;
      return null;
    } catch {
      return null;
    }
  }

  function persistOverlayVisible(open) {
    writeOpenHint(open);
    sendRuntime({
      type: 'UPSERT_PAGE_ANNOTATION',
      url: pageUrl(),
      title: document.title || '',
      overlayVisible: open,
    });
  }

  function pushUndo() {
    undoStack.push(snapshotObjects(objects));
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    closeTextEditor({ save: false });
    objects = normalizeObjects(prev);
    selectedId = '';
    current = null;
    dragObj = null;
    redraw();
    schedulePersist();
  }

  function focusLayer() {
    if (!toolbar || textEditor) return;
    toolbar.tabIndex = -1;
    try {
      toolbar.focus({ preventScroll: true });
    } catch {
      try { toolbar.focus(); } catch { /* ignore */ }
    }
  }

  function measureCurrentText(text, fontSize) {
    const size = Number(fontSize) || 16;
    if (ctx && typeof ctx.measureText === 'function') {
      const prev = ctx.font;
      ctx.font = `${size}px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const box = measureTextBox(text, size, (line) => ctx.measureText(line).width);
      ctx.font = prev;
      return box;
    }
    return measureTextBox(text, size);
  }

  function schedulePersist() {
    window.clearTimeout(persistTimer);
    persistTimer = 0;
    const payload = {
      type: 'PUT_PAGE_INK',
      url: pageUrl(),
      title: document.title || '',
      overlayVisible: visible,
      strokes: snapshotObjects(objects),
    };
    persistChain = persistChain
      .catch(() => {})
      .then(() => sendRuntime(payload));
  }

  function closeTextEditor({ save = true } = {}) {
    if (!textEditor) return;
    const id = editingId;
    const raw = textEditor.innerText || '';
    const x = Number(textEditor.dataset.x);
    const y = Number(textEditor.dataset.y);
    textEditor.remove();
    textEditor = null;
    editingId = '';
    if (save) {
      const prev = objects.find((obj) => obj.id === id);
      const next = normalizeText({
        id: id || newObjectId(),
        x,
        y,
        text: raw,
        color: prev?.color || color,
        fontSize: prev?.fontSize || 16,
      });
      if (next) {
        const sized = { ...next, ...measureCurrentText(next.text, next.fontSize) };
        pushUndo();
        objects = normalizeObjects(objects.filter((obj) => obj.id !== sized.id).concat(sized));
        selectedId = sized.id;
        schedulePersist();
      } else if (id) {
        if (objects.some((obj) => obj.id === id)) pushUndo();
        objects = objects.filter((obj) => obj.id !== id);
        if (selectedId === id) selectedId = '';
        schedulePersist();
      }
    }
    redraw();
  }

  function exitTextEditToView() {
    tool = 'view';
    closeTextEditor({ save: true });
    syncChrome();
  }

  function startTextEdit(obj) {
    closeTextEditor({ save: true });
    const item = obj || { id: newObjectId(), x: 0, y: 0, text: '', color, fontSize: 16 };
    editingId = item.id;
    selectedId = item.id;
    textEditor = document.createElement('div');
    textEditor.className = 'text-edit';
    textEditor.contentEditable = 'true';
    textEditor.setAttribute('role', 'textbox');
    textEditor.setAttribute('aria-multiline', 'true');
    textEditor.setAttribute('aria-label', copy.text);
    textEditor.spellcheck = false;
    textEditor.dataset.x = String(item.x);
    textEditor.dataset.y = String(item.y);
    textEditor.style.left = `${item.x}px`;
    textEditor.style.top = `${item.y}px`;
    textEditor.style.transform = canvasScrollTransform(window.scrollX, window.scrollY);
    textEditor.style.color = item.color || color;
    textEditor.style.fontSize = `${item.fontSize || 16}px`;
    textEditor.textContent = item.text || '';
    const stopEditorKeyboard = (event) => {
      if (event.type === 'keydown' && event.key === 'Escape') {
        event.preventDefault();
        exitTextEditToView();
      }
      event.stopPropagation();
    };
    ['keydown', 'keypress', 'keyup'].forEach((type) => textEditor.addEventListener(type, stopEditorKeyboard));
    textEditor.addEventListener('blur', () => closeTextEditor({ save: true }));
    shadow.appendChild(textEditor);
    redraw();
    setTimeout(() => textEditor?.focus(), 0);
  }

  async function loadForCurrentUrl() {
    closeTextEditor({ save: false });
    inkLoaded = false;
    const [view, ink, hint] = await Promise.all([
      sendRuntime({ type: 'GET_PAGE_ANNOTATION', url: pageUrl() }),
      sendRuntime({ type: 'GET_PAGE_INK', url: pageUrl() }),
      readOpenHint(),
    ]);
    if (ink?.ok) objects = normalizeObjects(ink.strokes);
    inkLoaded = Boolean(ink?.ok);
    const stored = view?.ok ? view.annotation?.overlayVisible === true : null;
    visible = resolveOverlayVisible(stored, hint);
    setToolbarCollapsed(true, { render: false });
    current = null;
    selectedId = '';
    hoverId = '';
    dragObj = null;
    syncCanvasSize();
    syncChrome();
  }

  function setToolbarCollapsed(collapsed, { render = true } = {}) {
    barPos.collapsed = Boolean(collapsed);
    tool = toolbarModeForCollapsed(barPos.collapsed);
    if (barPos.collapsed) {
      closeTextEditor({ save: true });
      current = null;
      dragObj = null;
      selectedId = '';
      hoverId = '';
    }
    if (render) syncChrome();
  }

  function toggleToolbar() {
    if (!visible || parkBlocked) return barPos.collapsed;
    setToolbarCollapsed(!barPos.collapsed);
    return barPos.collapsed;
  }

  function setVisible(next) {
    visible = Boolean(next);
    setToolbarCollapsed(true, { render: false });
    syncChrome();
    persistOverlayVisible(visible);
  }

  function toggleVisible() {
    const now = Date.now();
    if (now - lastToggleAt < 400) return visible;
    lastToggleAt = now;
    setVisible(!visible);
    return visible;
  }

  function highlightWidth() {
    return clamp(Math.max(width * 4, 16), 8, 48);
  }

  function beginSelectDrag(hit, point) {
    selectedId = hit.id;
    dragObj = {
      id: hit.id,
      lastX: point.x,
      lastY: point.y,
      moved: false,
    };
    focusLayer();
  }

  function onPointerDown(event) {
    if (!capturing() || event.button !== 0) return;
    if (event.target === textEditor) return;
    const point = pointerToDoc(event);
    const hit = hitTestObjects(objects, point);
    if (hit) {
      event.preventDefault();
      closeTextEditor({ save: true });
      if (hit.kind === 'text' && event.detail >= 2 && (tool === 'pen' || tool === 'text')) {
        startTextEdit(hit);
        return;
      }
      beginSelectDrag(hit, point);
      redraw();
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    event.preventDefault();
    selectedId = '';
    dragObj = null;
    hoverId = '';
    if (tool === 'text') {
      startTextEdit({ id: newObjectId(), x: point.x, y: point.y, text: '', color, fontSize: 16 });
      return;
    }
    if (tool === 'highlight') {
      current = {
        id: newObjectId(),
        kind: 'line',
        tool: 'highlight',
        color,
        width: highlightWidth(),
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
      };
    } else if (['line', 'circle', 'rect'].includes(tool)) {
      current = {
        id: newObjectId(),
        kind: 'shape',
        shape: tool,
        tool,
        color,
        width,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        constrainCircle: tool === 'circle' && event.shiftKey,
      };
    } else {
      current = {
        id: newObjectId(),
        kind: 'stroke',
        tool,
        color,
        width: tool === 'eraser' ? Math.max(width * 3, 12) : width,
        points: [point],
      };
    }
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const point = pointerToDoc(event);
    if (dragObj) {
      const dx = point.x - dragObj.lastX;
      const dy = point.y - dragObj.lastY;
      if (!dx && !dy) return;
      if (!dragObj.moved) {
        pushUndo();
        dragObj.moved = true;
      }
      objects = objects.map((obj) => (obj.id === dragObj.id ? translateObject(obj, dx, dy) : obj));
      dragObj.lastX = point.x;
      dragObj.lastY = point.y;
      redraw();
      return;
    }
    if (!current) {
      const hit = hitTestObjects(objects, point);
      const nextHover = hit?.id || '';
      if (nextHover !== hoverId) {
        hoverId = nextHover;
        redraw();
      }
      return;
    }
    if (current.kind === 'line') {
      const snapped = snapHighlightLine(current.x1, current.y1, point.x, point.y) || current;
      current = { ...current, ...snapped };
    } else if (current.kind === 'shape') {
      current = {
        ...current,
        x2: point.x,
        y2: point.y,
        constrainCircle: current.shape === 'circle' ? event.shiftKey : current.constrainCircle,
      };
    } else {
      current.points = downsamplePoints([...current.points, point]);
    }
    redraw();
  }

  function onPointerUp(event) {
    if (dragObj) {
      if (dragObj.moved) schedulePersist();
      dragObj = null;
      focusLayer();
      return;
    }
    if (!current) return;
    if (current.kind === 'shape' && current.shape === 'circle' && event) {
      current = { ...current, constrainCircle: event.shiftKey };
    }
    const next = normalizeObject(current);
    current = null;
    if (next) {
      pushUndo();
      objects = normalizeObjects([...objects, next]);
      schedulePersist();
    }
    redraw();
  }

  function deleteSelected() {
    if (!selectedId || textEditor) return;
    if (!objects.some((obj) => obj.id === selectedId)) return;
    pushUndo();
    objects = objects.filter((obj) => obj.id !== selectedId);
    selectedId = '';
    redraw();
    schedulePersist();
    focusLayer();
  }

  function clearInk() {
    closeTextEditor({ save: false });
    if (objects.length) pushUndo();
    objects = [];
    current = null;
    selectedId = '';
    dragObj = null;
    redraw();
    schedulePersist();
  }

  function beginChromeDrag(event, handle, target) {
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    const rect = handle.getBoundingClientRect();
    dragBar = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      anchorDx: chromeLeft() - rect.left,
      anchorDy: chromeTop() - rect.top,
      moved: false,
      target,
    };
    handle.setPointerCapture(event.pointerId);
  }

  function onBarPointerDown(event) {
    const grip = event.target.closest('.chrome-handle');
    beginChromeDrag(event, grip, 'bar');
  }

  function onFabPointerDown(event) {
    beginChromeDrag(event, fab, 'fab');
  }

  function onBarPointerMove(event) {
    if (!dragBar || event.pointerId !== dragBar.pointerId) return;
    const nextX = event.clientX - dragBar.dx + dragBar.anchorDx;
    const nextY = event.clientY - dragBar.dy + dragBar.anchorDy;
    if (Math.hypot(nextX - chromeLeft(), nextY - chromeTop()) > 3) dragBar.moved = true;
    barPos.x = nextX;
    barPos.y = nextY;
    applyChromePosition();
  }

  function onBarPointerUp(event) {
    if (!dragBar || event.pointerId !== dragBar.pointerId) return;
    dragBar = null;
    clampBar();
    scheduleChromePersist();
  }

  function onChromeDoubleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    toggleToolbar();
  }

  function onChromeKeyDown(event) {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggleToolbar();
  }

  function ensureUi() {
    if (rootEl) return;
    rootEl = document.createElement('div');
    rootEl.id = ROOT_ID;
    rootEl.setAttribute('data-tabwall-annotate', '1');
    shadow = rootEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; background: transparent !important; }
      [hidden] { display: none !important; }
      canvas {
        position: absolute;
        left: 0;
        top: 0;
        display: none;
        z-index: 0;
        background: transparent !important;
        opacity: 1;
        mix-blend-mode: normal;
        pointer-events: none;
        touch-action: none;
      }
      .text-layer {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 1;
        overflow: visible;
        pointer-events: none;
      }
      .text-render {
        position: absolute;
        max-width: calc(100vw - 24px);
        color: #1f2937;
        font: 16px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        pointer-events: none;
      }
      .text-render.is-editable {
        cursor: text;
        pointer-events: auto;
      }
      .text-render h1,
      .text-render h2,
      .text-render h3,
      .text-render h4,
      .text-render h5,
      .text-render h6 {
        margin: 0 0 .2em;
        font: inherit;
        font-weight: 700;
      }
      .text-render ul,
      .text-render ol {
        margin: 0 0 .2em 1.35em;
        padding: 0;
      }
      .text-render code {
        padding: 0 .2em;
        border-radius: 3px;
        background: rgba(15, 23, 42, .12);
        font: .92em ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .text-render a {
        color: inherit;
        cursor: pointer;
        text-decoration: underline;
      }
      .text-render.is-editable a { pointer-events: auto; }
      .markdown-blank { min-height: 1.3em; }
      .fab {
        position: fixed;
        z-index: 3;
        width: ${FAB_SIZE}px;
        height: ${FAB_SIZE}px;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 50%;
        background: rgba(201, 120, 88, 0.42);
        color: #fff8f3;
        display: grid;
        place-items: center;
        pointer-events: auto;
        cursor: grab;
        box-shadow: none;
        transition: background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
        opacity: 0.7;
      }
      .fab:hover, .fab:focus-visible {
        background: #c97858;
        opacity: 1;
        box-shadow: 0 8px 22px rgba(16,17,16,.28);
      }
      .fab:active { cursor: grabbing; }
      .fab svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .bar {
        position: fixed;
        z-index: 3;
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 4px 6px;
        border-radius: 14px;
        background: rgba(16, 17, 16, 0.18);
        color: #f1f0eb;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: none;
        pointer-events: auto;
        transition: background 0.15s ease, box-shadow 0.15s ease;
      }
      .bar { width: max-content; flex-wrap: nowrap; outline: none; }
      .bar.opens-left:not(.is-vertical) { flex-direction: row-reverse; }
      .bar.is-vertical { max-height: calc(100vh - 16px); overflow: hidden; }
      .bar.is-vertical.opens-left { align-items: flex-end; }
      .bar.is-vertical.opens-right { align-items: flex-start; }
      .bar.is-vertical.opens-up { flex-direction: column-reverse; }
      .bar.is-vertical.opens-down { flex-direction: column; }
      .bar .tools { display: flex; gap: 4px; align-items: center; flex-wrap: nowrap; }
      .bar.is-vertical .tools {
        flex-direction: column;
        align-items: stretch;
        max-height: calc(100vh - 128px);
        overflow-y: auto;
      }
      .palette { display: flex; gap: 4px; align-items: center; justify-content: center; }
      button, select {
        appearance: none;
        border: 0;
        border-radius: 999px;
        background: rgba(42, 45, 43, 0.35);
        color: inherit;
        font: inherit;
        padding: 4px 7px;
        cursor: pointer;
        opacity: 0.55;
        flex: 0 0 auto;
        transition: opacity 0.15s ease, background 0.15s ease;
      }
      .bar:hover, .bar:focus-within {
        background: rgba(16, 17, 16, 0.88);
        box-shadow: 0 8px 24px rgba(0,0,0,.28);
      }
      .bar:hover button, .bar:hover select,
      .bar:focus-within button, .bar:focus-within select {
        opacity: 1;
        background: #2a2d2b;
      }
      .bar .tools > button[data-tool][aria-pressed="true"] {
        background: #c97858;
        color: #fff8f3;
        opacity: 1;
        border: 1px solid rgba(255,255,255,.65);
        box-shadow: 0 0 0 2px rgba(201,120,88,.3), 0 3px 8px rgba(0,0,0,.2);
      }
      .swatch { width: 14px; height: 14px; border-radius: 50%; border: 1px solid #fff3; padding: 0; }
      .chrome-handle {
        width: ${TOOLBAR_HANDLE_SIZE}px;
        height: ${TOOLBAR_HANDLE_SIZE}px;
        padding: 0;
        display: grid;
        place-items: center;
        cursor: grab;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 50%;
        background: rgba(201, 120, 88, 0.42);
        color: #fff8f3;
      }
      .chrome-handle:active { cursor: grabbing; }
      .chrome-handle svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .text-edit {
        position: absolute;
        min-width: 80px;
        min-height: 1.3em;
        padding: 2px 4px;
        outline: 1px dashed #2563eb;
        background: rgba(255,255,255,.86);
        color: #1f2937;
        font: 16px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        max-width: calc(100vw - 24px);
        user-select: text;
        pointer-events: auto;
        z-index: 2;
      }
    `;

    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    textLayer.hidden = true;

    toolbar = document.createElement('div');
    toolbar.className = 'bar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.tabIndex = -1;
    const drawingIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l3.2-.7L18 8.5 15.5 6 4.7 16.8z"></path><path d="M14.2 4.8l3 3"></path></svg>';
    toolbar.innerHTML = `
      <button type="button" class="chrome-handle" data-act="drag" title="${copy.expandTools}" aria-label="${copy.expandTools}" aria-expanded="false">${drawingIcon}</button>
      <div class="tools">
        <button type="button" data-tool="pen">${copy.pen}</button>
        <button type="button" data-tool="highlight">${copy.highlight}</button>
        <button type="button" data-tool="line">${copy.line}</button>
        <button type="button" data-tool="circle">${copy.circle}</button>
        <button type="button" data-tool="rect">${copy.rectangle}</button>
        <button type="button" data-tool="text">${copy.text}</button>
        <button type="button" data-tool="eraser">${copy.eraser}</button>
        <button type="button" data-tool="view">${copy.view}</button>
        <div class="palette">
          ${COLORS.map((value) => `<button type="button" class="swatch" data-color="${value}" style="background:${value}"></button>`).join('')}
        </div>
        <select data-width>
          <option value="2">2</option>
          <option value="3" selected>3</option>
          <option value="6">6</option>
          <option value="10">10</option>
        </select>
        <button type="button" data-act="delete">${copy.del}</button>
        <button type="button" data-act="undo">${copy.undo}</button>
        <button type="button" data-act="clear">${copy.clear}</button>
      </div>
      <button type="button" data-act="hide">${copy.hide}</button>
    `;
    toolsEl = toolbar.querySelector('.tools');
    chromeHandle = toolbar.querySelector('.chrome-handle');
    chromeHandle.addEventListener('dblclick', onChromeDoubleClick);
    chromeHandle.addEventListener('keydown', onChromeKeyDown);
    toolbar.addEventListener('pointerdown', onBarPointerDown);
    toolbar.addEventListener('pointermove', onBarPointerMove);
    toolbar.addEventListener('pointerup', onBarPointerUp);
    toolbar.addEventListener('pointercancel', onBarPointerUp);
    toolbar.addEventListener('click', (event) => {
      if (dragBar) return;
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.tool) {
        tool = button.dataset.tool;
        if (tool !== 'text') closeTextEditor({ save: true });
        syncChrome();
        return;
      }
      if (button.dataset.color) {
        color = button.dataset.color;
        if (textEditor) textEditor.style.color = color;
        syncChrome();
        return;
      }
      if (button.dataset.act === 'delete') deleteSelected();
      if (button.dataset.act === 'undo') undo();
      if (button.dataset.act === 'clear') clearInk();
      if (button.dataset.act === 'hide') setVisible(false);
    });
    toolbar.querySelector('[data-width]').addEventListener('change', (event) => {
      width = Number(event.target.value) || 3;
    });

    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'fab';
    fab.hidden = true;
    fab.title = copy.expandTools;
    fab.setAttribute('aria-label', copy.expandTools);
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = drawingIcon;
    fab.addEventListener('pointerdown', onFabPointerDown);
    fab.addEventListener('pointermove', onBarPointerMove);
    fab.addEventListener('pointerup', onBarPointerUp);
    fab.addEventListener('pointercancel', onBarPointerUp);
    fab.addEventListener('dblclick', onChromeDoubleClick);
    fab.addEventListener('keydown', onChromeKeyDown);

    shadow.append(style, canvas, textLayer, toolbar, fab);
    rootEl.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none;background:transparent;';
    document.documentElement.appendChild(rootEl);
  }

  function syncParkBlock() {
    parkBlocked = Boolean(document.getElementById('tabwall-root'));
    if (parkBlocked) closeTextEditor({ save: true });
    syncChrome();
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const element = target.nodeType === 1 ? target : target.parentElement;
    if (element === textEditor || element?.isContentEditable) return true;
    const tag = String(element?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function isTextEditorEvent(event) {
    if (!textEditor) return false;
    if (event?.target === textEditor) return true;
    return typeof event?.composedPath === 'function' && event.composedPath().includes(textEditor);
  }

  function onKeyDown(event) {
    if (parkBlocked) return;
    if (isTextEditorEvent(event)) return;
    const isAltD = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      && (event.key === 'd' || event.key === 'D' || event.code === 'KeyD');
    if (isAltD && !isTypingTarget(event.target) && !textEditor) {
      event.preventDefault();
      event.stopPropagation();
      toggleVisible();
      return;
    }
    if (!visible) return;
    const typing = Boolean(textEditor) || isTypingTarget(event.target);
    if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === 'z') {
      if (typing) return;
      event.preventDefault();
      event.stopPropagation();
      undo();
      return;
    }
    if (typing) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (!selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      deleteSelected();
    }
  }

  function onKeyEvent(event) {
    if (isTextEditorEvent(event)) {
      if (event.type === 'keydown' && event.key === 'Escape') {
        event.preventDefault();
        exitTextEditToView();
      }
      event.stopPropagation();
      return;
    }
    if (event.type === 'keydown') onKeyDown(event);
  }

  function flushBeforeUnload() {
    writeOpenHint(visible);
    if (inkLoaded) {
      schedulePersist();
    } else {
      persistOverlayVisible(visible);
    }
  }

  function dispose() {
    window.clearTimeout(persistTimer);
    if (inkLoaded) schedulePersist();
    window.clearTimeout(chromeTimer);
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('scroll', onWindowScroll);
    window.removeEventListener('popstate', loadForCurrentUrl);
    window.removeEventListener('hashchange', loadForCurrentUrl);
    window.removeEventListener('pagehide', flushBeforeUnload);
    if (keyHandler) {
      ['keydown', 'keypress', 'keyup'].forEach((type) => window.removeEventListener(type, keyHandler, true));
    }
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    if (runtimeHandler) {
      try {
        chrome.runtime.onMessage.removeListener(runtimeHandler);
      } catch {
        // ignore
      }
    }
    rootEl?.remove();
    rootEl = null;
    if (global[MARKER]?.dispose === dispose) delete global[MARKER];
  }

  function onWindowResize() {
    syncCanvasSize();
    clampBar();
  }

  function onWindowScroll() {
    syncCanvasScroll();
  }

  ensureUi();
  syncCanvasSize();
  syncChrome();
  loadBarChrome();
  loadForCurrentUrl();

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('scroll', onWindowScroll, { passive: true });
  window.addEventListener('popstate', loadForCurrentUrl);
  window.addEventListener('hashchange', loadForCurrentUrl);
  window.addEventListener('pagehide', flushBeforeUnload);
  keyHandler = onKeyEvent;
  ['keydown', 'keypress', 'keyup'].forEach((type) => window.addEventListener(type, keyHandler, true));
  resizeObserver = new ResizeObserver(syncCanvasSize);
  try {
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  } catch {
    // ignore
  }
  mutationObserver = new MutationObserver(syncParkBlock);
  mutationObserver.observe(document.documentElement, { childList: true });
  syncParkBlock();

  runtimeHandler = (message, _sender, sendResponse) => {
    if (message?.type === 'TOGGLE_ANNOTATE') {
      sendResponse({ ok: true, open: toggleVisible() });
      return false;
    }
    if (message?.type === 'PAGE_ANNOTATION_URL_CHANGED') {
      loadForCurrentUrl().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === 'SET_ANNOTATE_VISIBLE') {
      setVisible(message.visible !== false);
      sendResponse({ ok: true, open: visible });
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(runtimeHandler);
  global[MARKER] = { dispose, toggle: toggleVisible };
})(typeof self !== 'undefined' ? self : globalThis);
