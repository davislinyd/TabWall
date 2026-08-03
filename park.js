/**
 * TabWall — Photo wall UI
 */

const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS = {
  afterSave: 'close',
  viewMode: 'cards', // cards | list
  sortBy: 'newest',
  theme: 'dark', // dark | light
};

const gridEl = document.getElementById('grid');
const countEl = document.getElementById('count');
const searchEl = document.getElementById('search');
const settingsEl = document.getElementById('settings');
const settingsBtn = document.getElementById('settingsBtn');
const closeBtn = document.getElementById('closeBtn');
const themeBtn = document.getElementById('themeBtn');
const viewCardsBtn = document.getElementById('viewCards');
const viewListBtn = document.getElementById('viewList');
const sortByEl = document.getElementById('sortBy');

const lightbox = document.getElementById('lightbox');
const lbImage = document.getElementById('lbImage');
const lbTitle = document.getElementById('lbTitle');
const lbUrl = document.getElementById('lbUrl');
const lbSnapHint = document.getElementById('lbSnapHint');
const lbRestore = document.getElementById('lbRestore');
const lbClose = document.getElementById('lbClose');

const editBox = document.getElementById('editBox');
const editDrag = document.getElementById('editDrag');
const editTitle = document.getElementById('editTitle');
const editSub = document.getElementById('editSub');
const editNote = document.getElementById('editNote');
const editTags = document.getElementById('editTags');
const editCancel = document.getElementById('editCancel');
const editSave = document.getElementById('editSave');
const editCloseX = document.getElementById('editCloseX');

/** @type {Array<any>} */
let allTabs = [];
let query = '';
/** @type {typeof DEFAULT_SETTINGS} */
let settings = { ...DEFAULT_SETTINGS };
/** @type {string|null} */
let expandedId = null;
/** @type {string|null} */
let editingId = null;

function requestHostClose() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'TABWALL_CLOSE' }, '*');
      return;
    }
  } catch {
    // ignore
  }
  window.close();
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: 'empty_response' });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err) });
    }
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeTags(input) {
  if (Array.isArray(input)) {
    return input.map((t) => String(t).trim()).filter(Boolean);
  }
  return String(input || '')
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function matchesQuery(item, q) {
  if (!q) return true;
  const hay = [
    item.title || '',
    item.url || '',
    domainOf(item.url),
    item.note || '',
    ...(Array.isArray(item.tags) ? item.tags : []),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// ─── Settings ──────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(partial) {
  settings = { ...settings, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  themeBtn.textContent = theme === 'light' ? 'Dark' : 'Light';
}

function applyViewMode(mode) {
  const isList = mode === 'list';
  gridEl.classList.toggle('cards', !isList);
  gridEl.classList.toggle('list', isList);
  viewCardsBtn.classList.toggle('active', !isList);
  viewListBtn.classList.toggle('active', isList);
}

function syncSettingsUi() {
  applyTheme(settings.theme);
  applyViewMode(settings.viewMode);
  sortByEl.value = settings.sortBy || 'newest';

  const after =
    settingsEl.querySelector(`input[name="afterSave"][value="${settings.afterSave}"]`) ||
    settingsEl.querySelector('input[name="afterSave"][value="close"]');
  if (after) after.checked = true;

  const themeRadio =
    settingsEl.querySelector(`input[name="theme"][value="${settings.theme}"]`) ||
    settingsEl.querySelector('input[name="theme"][value="dark"]');
  if (themeRadio) themeRadio.checked = true;
}

async function initSettingsUi() {
  settings = await loadSettings();
  syncSettingsUi();

  settingsEl.querySelectorAll('input[name="afterSave"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) await saveSettings({ afterSave: input.value });
    });
  });

  settingsEl.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) {
        await saveSettings({ theme: input.value });
        applyTheme(input.value);
      }
    });
  });
}

settingsBtn.addEventListener('click', () => {
  const open = settingsEl.classList.toggle('open');
  settingsBtn.classList.toggle('active', open);
});

themeBtn.addEventListener('click', async () => {
  const next = settings.theme === 'light' ? 'dark' : 'light';
  await saveSettings({ theme: next });
  applyTheme(next);
  const radio = settingsEl.querySelector(`input[name="theme"][value="${next}"]`);
  if (radio) radio.checked = true;
});

viewCardsBtn.addEventListener('click', async () => {
  await saveSettings({ viewMode: 'cards' });
  applyViewMode('cards');
  renderGrid();
});

viewListBtn.addEventListener('click', async () => {
  await saveSettings({ viewMode: 'list' });
  applyViewMode('list');
  renderGrid();
});

sortByEl.addEventListener('change', async () => {
  await saveSettings({ sortBy: sortByEl.value });
  renderGrid();
});

closeBtn.addEventListener('click', requestHostClose);

// ─── Search ────────────────────────────────────────────────────────

searchEl.addEventListener('input', () => {
  query = searchEl.value.trim().toLowerCase();
  renderGrid();
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
    return;
  }

  if (e.key === 'Escape') {
    if (editBox.classList.contains('open')) {
      e.preventDefault();
      closeEditBox();
      return;
    }
    if (lightbox.classList.contains('open')) {
      e.preventDefault();
      closeLightbox();
      return;
    }
    if (document.activeElement === searchEl && searchEl.value) {
      searchEl.value = '';
      query = '';
      renderGrid();
      searchEl.blur();
      return;
    }
    e.preventDefault();
    requestHostClose();
  }
});

// ─── Sort ──────────────────────────────────────────────────────────

function sortTabs(list, sortBy) {
  const arr = [...list];
  const titleOf = (t) => (t.title || t.url || '').toLowerCase();
  switch (sortBy) {
    case 'oldest':
      return arr.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    case 'title':
      return arr.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'zh-Hant'));
    case 'title-desc':
      return arr.sort((a, b) => titleOf(b).localeCompare(titleOf(a), 'zh-Hant'));
    case 'domain':
      return arr.sort((a, b) => domainOf(a.url).localeCompare(domainOf(b.url)));
    case 'newest':
    default:
      return arr.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
}

// ─── Expand ────────────────────────────────────────────────────────

function openLightbox(item) {
  expandedId = item.id;
  lbTitle.textContent = item.title || item.url || 'Untitled';
  lbUrl.textContent = item.url || '';
  lbImage.src = item.snapshot || item.thumbnail || '';
  lbSnapHint.hidden = Boolean(item.snapshot);
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
  expandedId = null;
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  lbImage.removeAttribute('src');
}

lbClose.addEventListener('click', closeLightbox);

lbRestore.addEventListener('click', async () => {
  if (!expandedId) return;
  const res = await sendMessage({ type: 'RESTORE_TAB', id: expandedId });
  if (res.ok) {
    allTabs = allTabs.filter((t) => t.id !== expandedId);
    closeLightbox();
    renderGrid();
  }
});

// ─── Movable edit box ──────────────────────────────────────────────

function placeEditBoxCentered() {
  const w = editBox.offsetWidth || 400;
  const h = editBox.offsetHeight || 320;
  const left = Math.max(16, Math.round((window.innerWidth - w) / 2));
  const top = Math.max(16, Math.round((window.innerHeight - h) / 2));
  editBox.style.left = `${left}px`;
  editBox.style.top = `${top}px`;
}

function openEditBox(item) {
  editingId = item.id;
  editTitle.textContent = item.title || item.url || 'Untitled';
  editSub.textContent = item.url || '';
  editNote.value = item.note || '';
  editTags.value = (Array.isArray(item.tags) ? item.tags : []).join(', ');
  editBox.classList.add('open');
  editBox.setAttribute('aria-hidden', 'false');
  placeEditBoxCentered();
  setTimeout(() => editNote.focus(), 0);
}

function closeEditBox() {
  editingId = null;
  editBox.classList.remove('open');
  editBox.setAttribute('aria-hidden', 'true');
}

editCancel.addEventListener('click', closeEditBox);
editCloseX.addEventListener('click', closeEditBox);

editSave.addEventListener('click', async () => {
  if (!editingId) return;
  const res = await sendMessage({
    type: 'UPDATE_TAB',
    id: editingId,
    note: editNote.value,
    tags: normalizeTags(editTags.value),
  });
  if (res.ok && res.tab) {
    const idx = allTabs.findIndex((t) => t.id === editingId);
    if (idx !== -1) allTabs[idx] = res.tab;
    closeEditBox();
    renderGrid();
  }
});

// drag by header
(function setupDrag() {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  editDrag.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = editBox.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    editDrag.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  editDrag.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxL = window.innerWidth - editBox.offsetWidth - 8;
    const maxT = window.innerHeight - 40;
    editBox.style.left = `${Math.min(maxL, Math.max(8, origLeft + dx))}px`;
    editBox.style.top = `${Math.min(maxT, Math.max(8, origTop + dy))}px`;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      editDrag.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };
  editDrag.addEventListener('pointerup', endDrag);
  editDrag.addEventListener('pointercancel', endDrag);
})();

// ─── Actions shared ────────────────────────────────────────────────

async function restoreItem(id) {
  const res = await sendMessage({ type: 'RESTORE_TAB', id });
  if (res.ok) {
    allTabs = allTabs.filter((t) => t.id !== id);
    if (expandedId === id) closeLightbox();
    if (editingId === id) closeEditBox();
    renderGrid();
  }
}

async function deleteItem(id) {
  const res = await sendMessage({ type: 'DELETE_TAB', id });
  if (res.ok) {
    allTabs = allTabs.filter((t) => t.id !== id);
    if (expandedId === id) closeLightbox();
    if (editingId === id) closeEditBox();
    renderGrid();
  }
}

function wireFavicon(root) {
  const favImg = root.querySelector('img.favicon');
  if (!favImg) return;
  favImg.addEventListener('error', () => {
    const fallback = document.createElement('span');
    fallback.className = 'favicon-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    favImg.replaceWith(fallback);
  });
}

// ─── Cards ─────────────────────────────────────────────────────────

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = item.id;
  card.setAttribute('role', 'listitem');

  const title = item.title || item.url || 'Untitled';
  const url = item.url || '';
  const thumb = item.thumbnail || item.snapshot || '';
  const fav = item.favIconUrl || '';
  const note = item.note || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];

  card.innerHTML = `
    <div class="thumb-wrap">
      <img class="thumb" alt="" src="${escapeAttr(thumb)}" />
      <div class="card-actions">
        <button type="button" class="icon-btn lg expand-btn" title="Expand" aria-label="Expand">⤢</button>
        <button type="button" class="icon-btn lg edit-btn" title="編輯 note / tags" aria-label="編輯">✎</button>
      </div>
      <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="刪除" aria-label="刪除">×</button>
    </div>
    <div class="meta">
      <div class="title-row restore-hit">
        ${
          fav
            ? `<img class="favicon" alt="" src="${escapeAttr(fav)}" />`
            : `<span class="favicon-fallback" aria-hidden="true"></span>`
        }
        <div class="title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
      </div>
      <div class="url restore-hit" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
      ${note ? `<div class="note-preview" title="${escapeAttr(note)}">${escapeHtml(note)}</div>` : ''}
      ${
        tags.length
          ? `<div class="tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
          : ''
      }
    </div>
  `;

  wireFavicon(card);

  card.querySelector('.thumb-wrap').addEventListener('click', (e) => {
    if (e.target.closest('.card-actions, .delete-btn')) return;
    restoreItem(item.id);
  });

  card.querySelectorAll('.restore-hit').forEach((el) => {
    el.addEventListener('click', () => restoreItem(item.id));
  });

  card.querySelector('.expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openLightbox(item);
  });

  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditBox(item);
  });

  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteItem(item.id);
  });

  return card;
}

// ─── List rows ─────────────────────────────────────────────────────

function createRow(item) {
  const row = document.createElement('article');
  row.className = 'row';
  row.dataset.id = item.id;
  row.setAttribute('role', 'listitem');

  const title = item.title || item.url || 'Untitled';
  const url = item.url || '';
  const thumb = item.thumbnail || item.snapshot || '';
  const note = item.note || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];

  row.innerHTML = `
    <img class="row-thumb" alt="" src="${escapeAttr(thumb)}" title="還原" />
    <div class="row-main">
      <div class="title restore-hit" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
      <div class="url restore-hit" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
    </div>
    <div class="row-note" title="${escapeAttr(note)}">${note ? escapeHtml(note) : '—'}</div>
    <div class="row-tags">
      ${
        tags.length
          ? tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')
          : '<span class="note-preview">—</span>'
      }
    </div>
    <div class="row-actions">
      <button type="button" class="icon-btn expand-btn" title="Expand" aria-label="Expand">⤢</button>
      <button type="button" class="icon-btn edit-btn" title="編輯" aria-label="編輯">✎</button>
      <button type="button" class="icon-btn danger delete-btn" title="刪除" aria-label="刪除">×</button>
    </div>
  `;

  row.querySelector('.row-thumb').addEventListener('click', () => restoreItem(item.id));
  row.querySelectorAll('.restore-hit').forEach((el) => {
    el.addEventListener('click', () => restoreItem(item.id));
  });
  row.querySelector('.expand-btn').addEventListener('click', () => openLightbox(item));
  row.querySelector('.edit-btn').addEventListener('click', () => openEditBox(item));
  row.querySelector('.delete-btn').addEventListener('click', () => deleteItem(item.id));

  return row;
}

// ─── Render ────────────────────────────────────────────────────────

function renderEmpty(message) {
  gridEl.innerHTML = `
    <div class="empty" style="grid-column: 1 / -1">
      <strong>${escapeHtml(message.title)}</strong>
      ${message.body}
    </div>
  `;
}

function renderGrid() {
  const filtered = sortTabs(
    allTabs.filter((t) => matchesQuery(t, query)),
    settings.sortBy || 'newest'
  );

  if (allTabs.length === 0) {
    countEl.textContent = '0 個暫存分頁';
    renderEmpty({
      title: '尚無暫存分頁',
      body: `在網頁按下 <kbd>Option</kbd>/<kbd>Alt</kbd>+<kbd>S</kbd> 即可截圖並加入 TabWall。<br/>開啟後按 <kbd>/</kbd> 可搜尋。`,
    });
    return;
  }

  countEl.textContent =
    query && filtered.length !== allTabs.length
      ? `${filtered.length} / ${allTabs.length}`
      : `${allTabs.length} 個暫存分頁`;

  if (filtered.length === 0) {
    renderEmpty({
      title: '沒有符合的結果',
      body: '試試其他關鍵字，或清除搜尋。',
    });
    return;
  }

  gridEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  const isList = settings.viewMode === 'list';
  filtered.forEach((item) => {
    frag.appendChild(isList ? createRow(item) : createCard(item));
  });
  gridEl.appendChild(frag);
}

async function loadList() {
  const res = await sendMessage({ type: 'GET_PARKED_TABS' });
  allTabs = res.ok && Array.isArray(res.tabs) ? res.tabs : [];
  allTabs = allTabs.map((t) => ({
    ...t,
    note: typeof t.note === 'string' ? t.note : '',
    tags: Array.isArray(t.tags) ? t.tags : [],
  }));
  renderGrid();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.parkedTabs) loadList();
  if (changes.settings) {
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    syncSettingsUi();
    renderGrid();
  }
});

initSettingsUi().then(loadList);
