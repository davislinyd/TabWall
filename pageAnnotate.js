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
  const COLORS = ['#c97858', '#1f2937', '#dc2626', '#2563eb', '#16a34a', '#eab308'];
  const CHROME_KEY = 'pageAnnotateChrome';

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
    if (raw.kind === 'line' || raw.kind === 'text' || raw.kind === 'stroke') return raw.kind;
    if (raw.tool === 'highlight' || (raw.x1 != null && raw.x2 != null)) return 'line';
    if (raw.tool === 'text' || typeof raw.text === 'string') return 'text';
    return 'stroke';
  }

  function normalizeObject(raw) {
    const kind = objectKind(raw);
    if (kind === 'line') return normalizeLine(raw);
    if (kind === 'text') return normalizeText(raw);
    return normalizeStroke(raw);
  }

  function normalizeObjects(list) {
    return (Array.isArray(list) ? list : []).map(normalizeObject).filter(Boolean).slice(-MAX_STROKES);
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

  function objectBounds(obj) {
    if (!obj) return null;
    if (obj.kind === 'text') return textBounds(obj);
    if (obj.kind === 'line') return lineBounds(obj);
    return strokeBounds(obj);
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
    normalizeText,
    normalizeObject,
    normalizeObjects,
    snapHighlightLine,
    hitTestObject,
    hitTestObjects,
    objectBounds,
    textBounds,
    measureTextBox,
    translateObject,
    snapshotObjects,
    createUndoStack,
    resolveOverlayVisible,
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

  const ROOT_ID = 'tabwall-annotate-root';
  const zh = /zh/i.test(navigator.language || '');
  const copy = zh
    ? {
      select: '選',
      pen: '筆',
      highlight: '螢',
      text: '字',
      eraser: '擦',
      view: '檢視',
      del: '刪除',
      clear: '清除',
      collapse: '收合',
      expand: '展開',
      hide: '關閉圖層',
      drag: '拖曳面板',
      undo: '復原',
      chip: 'TabWall 圖層',
    }
    : {
      select: 'Pick',
      pen: 'Pen',
      highlight: 'Mark',
      text: 'Text',
      eraser: 'Erase',
      view: 'View',
      del: 'Delete',
      clear: 'Clear',
      collapse: 'Collapse',
      expand: 'Expand',
      hide: 'Hide layer',
      drag: 'Move panel',
      undo: 'Undo',
      chip: 'TabWall layer',
    };

  let rootEl = null;
  let shadow = null;
  let canvas = null;
  let ctx = null;
  let toolbar = null;
  let toolsEl = null;
  let fab = null;
  let chip = null;
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
  let dragObj = null;
  const undoStack = createUndoStack(40);
  let chromeTimer = 0;
  let parkBlocked = false;
  let runtimeHandler = null;
  let keyHandler = null;
  let resizeObserver = null;
  let mutationObserver = null;
  let barPos = { x: null, y: 16, collapsed: true };
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

  function paintText(obj, context) {
    if (obj.id === editingId) return;
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
  }

  function syncCanvasSize() {
    if (!canvas) return;
    const { w, h } = pageSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const nextW = Math.max(1, Math.round(w * dpr));
    const nextH = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    redraw();
  }

  function capturing() {
    return visible && !parkBlocked && ['pen', 'eraser', 'highlight', 'text'].includes(tool);
  }

  function defaultFabLeft() {
    return Math.max(8, window.innerWidth - FAB_SIZE - 16);
  }

  function chromeLeft() {
    return barPos.x == null ? defaultFabLeft() : barPos.x;
  }

  function chromeTop() {
    return Number.isFinite(barPos.y) ? barPos.y : 16;
  }

  function clampBar() {
    if (barPos.x == null) return;
    const width = barPos.collapsed ? FAB_SIZE : (toolbar?.getBoundingClientRect().width || 160);
    const height = barPos.collapsed ? FAB_SIZE : (toolbar?.getBoundingClientRect().height || 40);
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    barPos.x = clamp(barPos.x, 8, maxX);
    barPos.y = clamp(barPos.y, 8, maxY);
    applyChromePosition();
  }

  function applyChromePosition() {
    const left = `${chromeLeft()}px`;
    const top = `${chromeTop()}px`;
    if (toolbar) {
      toolbar.style.left = left;
      toolbar.style.top = top;
      toolbar.style.transform = 'none';
    }
    if (fab) {
      fab.style.left = left;
      fab.style.top = top;
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
          y: Number.isFinite(y) ? y : 16,
          collapsed: true,
        };
      }
    } catch {
      // ignore
    }
    applyBarChrome();
  }

  function syncChrome() {
    if (!rootEl) return;
    const showChip = !visible && objects.length > 0;
    chip.hidden = !showChip;
    canvas.style.display = visible ? 'block' : 'none';
    canvas.style.pointerEvents = capturing() ? 'auto' : 'none';
    chip.style.pointerEvents = showChip ? 'auto' : 'none';
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
    persistTimer = window.setTimeout(() => {
      sendRuntime({
        type: 'PUT_PAGE_INK',
        url: pageUrl(),
        title: document.title || '',
        overlayVisible: visible,
        strokes: objects,
      });
    }, 400);
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

  function startTextEdit(obj) {
    closeTextEditor({ save: true });
    const item = obj || { id: newObjectId(), x: 0, y: 0, text: '', color, fontSize: 16 };
    editingId = item.id;
    selectedId = item.id;
    textEditor = document.createElement('div');
    textEditor.className = 'text-edit';
    textEditor.contentEditable = 'true';
    textEditor.dataset.x = String(item.x);
    textEditor.dataset.y = String(item.y);
    textEditor.style.left = `${item.x}px`;
    textEditor.style.top = `${item.y}px`;
    textEditor.style.color = item.color || color;
    textEditor.style.fontSize = `${item.fontSize || 16}px`;
    textEditor.textContent = item.text || '';
    textEditor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTextEditor({ save: true });
      }
    });
    textEditor.addEventListener('blur', () => closeTextEditor({ save: true }));
    shadow.appendChild(textEditor);
    redraw();
    setTimeout(() => textEditor?.focus(), 0);
  }

  async function loadForCurrentUrl() {
    closeTextEditor({ save: false });
    const [view, ink, hint] = await Promise.all([
      sendRuntime({ type: 'GET_PAGE_ANNOTATION', url: pageUrl() }),
      sendRuntime({ type: 'GET_PAGE_INK', url: pageUrl() }),
      readOpenHint(),
    ]);
    if (ink?.ok) objects = normalizeObjects(ink.strokes);
    const stored = view?.ok ? view.annotation?.overlayVisible === true : null;
    visible = resolveOverlayVisible(stored, hint);
    current = null;
    selectedId = '';
    syncCanvasSize();
    syncChrome();
  }

  function setVisible(next) {
    visible = Boolean(next);
    if (visible) {
      if (tool === 'view') tool = 'pen';
      barPos.collapsed = true;
    } else {
      closeTextEditor({ save: true });
      selectedId = '';
      hoverId = '';
    }
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
      if (hit.kind === 'text' && event.detail >= 2) {
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
    } else {
      current.points = downsamplePoints([...current.points, point]);
    }
    redraw();
  }

  function onPointerUp() {
    if (dragObj) {
      if (dragObj.moved) schedulePersist();
      dragObj = null;
      focusLayer();
      return;
    }
    if (!current) return;
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

  function onBarPointerDown(event) {
    const grip = event.target.closest('[data-act="drag"]');
    if (!grip || event.button !== 0) return;
    event.preventDefault();
    const rect = toolbar.getBoundingClientRect();
    dragBar = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
      target: 'bar',
    };
    grip.setPointerCapture(event.pointerId);
  }

  function onFabPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = fab.getBoundingClientRect();
    dragBar = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
      target: 'fab',
    };
    fab.setPointerCapture(event.pointerId);
  }

  function onBarPointerMove(event) {
    if (!dragBar || event.pointerId !== dragBar.pointerId) return;
    const nextX = event.clientX - dragBar.dx;
    const nextY = event.clientY - dragBar.dy;
    if (Math.hypot(nextX - chromeLeft(), nextY - chromeTop()) > 3) dragBar.moved = true;
    barPos.x = nextX;
    barPos.y = nextY;
    applyChromePosition();
  }

  function onBarPointerUp(event) {
    if (!dragBar || event.pointerId !== dragBar.pointerId) return;
    const wasFabClick = dragBar.target === 'fab' && !dragBar.moved;
    dragBar = null;
    if (wasFabClick) {
      barPos.collapsed = false;
      applyBarChrome();
      return;
    }
    clampBar();
    scheduleChromePersist();
  }

  function ensureUi() {
    if (rootEl) return;
    rootEl = document.createElement('div');
    rootEl.id = ROOT_ID;
    rootEl.setAttribute('data-tabwall-annotate', '1');
    shadow = rootEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      canvas {
        position: absolute;
        left: 0;
        top: 0;
        display: none;
        z-index: 0;
      }
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
      .bar, .chip {
        position: fixed;
        z-index: 1;
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 8px;
        border-radius: 14px;
        background: rgba(16, 17, 16, 0.18);
        color: #f1f0eb;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: none;
        z-index: 3;
        pointer-events: auto;
        transition: background 0.15s ease, box-shadow 0.15s ease;
      }
      .bar { top: 12px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 16px); flex-wrap: wrap; outline: none; }
      .bar .tools:not([hidden]) { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .bar.collapsed .tools { display: none; }
      .chip { top: 12px; right: 12px; cursor: pointer; border: 0; }
      button, select {
        appearance: none;
        border: 0;
        border-radius: 999px;
        background: rgba(42, 45, 43, 0.35);
        color: inherit;
        font: inherit;
        padding: 5px 8px;
        cursor: pointer;
        opacity: 0.55;
        transition: opacity 0.15s ease, background 0.15s ease;
      }
      .bar:hover, .bar:focus-within, .chip:hover, .chip:focus-visible {
        background: rgba(16, 17, 16, 0.88);
        box-shadow: 0 8px 24px rgba(0,0,0,.28);
      }
      .bar:hover button, .bar:hover select,
      .bar:focus-within button, .bar:focus-within select,
      .chip:hover, .chip:focus-visible {
        opacity: 1;
        background: #2a2d2b;
      }
      button[aria-pressed="true"] { background: #c97858; color: #fff8f3; opacity: 1; }
      .swatch { width: 16px; height: 16px; border-radius: 50%; border: 1px solid #fff3; padding: 0; }
      .drag { cursor: grab; padding: 5px 7px; }
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

    toolbar = document.createElement('div');
    toolbar.className = 'bar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.tabIndex = -1;
    toolbar.innerHTML = `
      <button type="button" class="drag" data-act="drag" title="${copy.drag}" aria-label="${copy.drag}">⋮⋮</button>
      <div class="tools">
        <button type="button" data-tool="pen">${copy.pen}</button>
        <button type="button" data-tool="highlight">${copy.highlight}</button>
        <button type="button" data-tool="text">${copy.text}</button>
        <button type="button" data-tool="eraser">${copy.eraser}</button>
        <button type="button" data-tool="view">${copy.view}</button>
        ${COLORS.map((value) => `<button type="button" class="swatch" data-color="${value}" style="background:${value}"></button>`).join('')}
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
      <button type="button" data-act="collapse">${copy.collapse}</button>
      <button type="button" data-act="hide">${copy.hide}</button>
    `;
    toolsEl = toolbar.querySelector('.tools');
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
      if (button.dataset.act === 'collapse') {
        barPos.collapsed = true;
        applyBarChrome();
      }
      if (button.dataset.act === 'hide') setVisible(false);
    });
    toolbar.querySelector('[data-width]').addEventListener('change', (event) => {
      width = Number(event.target.value) || 3;
    });

    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = copy.chip;
    chip.addEventListener('click', () => setVisible(true));

    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'fab';
    fab.hidden = true;
    fab.title = copy.expand;
    fab.setAttribute('aria-label', copy.expand);
    fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l3.2-.7L18 8.5 15.5 6 4.7 16.8z"></path><path d="M14.2 4.8l3 3"></path></svg>';
    fab.addEventListener('pointerdown', onFabPointerDown);
    fab.addEventListener('pointermove', onBarPointerMove);
    fab.addEventListener('pointerup', onBarPointerUp);
    fab.addEventListener('pointercancel', onBarPointerUp);

    shadow.append(style, canvas, toolbar, fab, chip);
    rootEl.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none;';
    document.documentElement.appendChild(rootEl);
  }

  function syncParkBlock() {
    parkBlocked = Boolean(document.getElementById('tabwall-root'));
    if (parkBlocked) closeTextEditor({ save: true });
    syncChrome();
  }

  function isTypingTarget(target) {
    if (!target) return false;
    if (target === textEditor || target.isContentEditable) return true;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function onKeyDown(event) {
    if (parkBlocked) return;
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

  function flushBeforeUnload() {
    writeOpenHint(visible);
    if (persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = 0;
      sendRuntime({
        type: 'PUT_PAGE_INK',
        url: pageUrl(),
        title: document.title || '',
        overlayVisible: visible,
        strokes: objects,
      });
    } else {
      persistOverlayVisible(visible);
    }
  }

  function dispose() {
    window.clearTimeout(persistTimer);
    window.clearTimeout(chromeTimer);
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('popstate', loadForCurrentUrl);
    window.removeEventListener('hashchange', loadForCurrentUrl);
    window.removeEventListener('pagehide', flushBeforeUnload);
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
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

  ensureUi();
  syncCanvasSize();
  syncChrome();
  loadBarChrome();
  loadForCurrentUrl();

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('popstate', loadForCurrentUrl);
  window.addEventListener('hashchange', loadForCurrentUrl);
  window.addEventListener('pagehide', flushBeforeUnload);
  keyHandler = onKeyDown;
  window.addEventListener('keydown', keyHandler, true);
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
