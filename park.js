/**
 * TabWall — Photo wall UI
 */

const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  saveGroupCapture: 'all',
  restoreGroupIn: 'currentWindow',
  viewMode: 'cards',
  sortBy: 'newest',
  theme: 'dark',
  cardCols: 4,
  locale: 'zh',
  defaultViewMode: 'cards',
  openWithSearchFocus: false,
};

const GROUP_COLORS = {
  grey: '#9ca3af',
  blue: '#60a5fa',
  red: '#f87171',
  yellow: '#fbbf24',
  green: '#34d399',
  pink: '#f472b6',
  purple: '#a78bfa',
  cyan: '#22d3ee',
};

const DRAG_THRESHOLD = 6;
const Media = self.TabWallMediaDB;

/** @type {Set<string>} */
const liveObjectUrls = new Set();
/** @type {Map<string, string>} snap dataUrl/blob url cache */
const snapCache = new Map();
const SNAP_CACHE_MAX = 12;

function trackObjectUrl(url) {
  if (url && String(url).startsWith('blob:')) liveObjectUrls.add(url);
  return url;
}

function revokeObjectUrl(url) {
  if (url && String(url).startsWith('blob:') && liveObjectUrls.has(url)) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
    liveObjectUrls.delete(url);
  }
}

function cacheSnap(key, url) {
  if (snapCache.has(key)) {
    const old = snapCache.get(key);
    if (old !== url) revokeObjectUrl(old);
  }
  snapCache.set(key, url);
  while (snapCache.size > SNAP_CACHE_MAX) {
    const first = snapCache.keys().next().value;
    revokeObjectUrl(snapCache.get(first));
    snapCache.delete(first);
  }
}

async function fetchMediaUrl(key, kind) {
  if (!key || !Media) {
    const res = await sendMessage({ type: 'GET_MEDIA', key, kind });
    return res.ok ? res.dataUrl || '' : '';
  }
  try {
    const blob = await Media.getPart(key, kind === 'snap' ? 'snap' : 'thumb');
    if (!blob) return '';
    return trackObjectUrl(URL.createObjectURL(blob));
  } catch {
    const res = await sendMessage({ type: 'GET_MEDIA', key, kind });
    return res.ok ? res.dataUrl || '' : '';
  }
}

const thumbObserver =
  typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const img = entry.target;
            const key = img.dataset.mediaKey;
            if (!key || img.dataset.loaded === '1') continue;
            img.dataset.loaded = '1';
            fetchMediaUrl(key, 'thumb').then((url) => {
              if (url) img.src = url;
            });
            thumbObserver.unobserve(img);
          }
        },
        { root: null, rootMargin: '120px', threshold: 0.01 }
      )
    : null;

function observeThumb(img) {
  if (!img) return;
  if (thumbObserver) thumbObserver.observe(img);
  else if (img.dataset.mediaKey) {
    fetchMediaUrl(img.dataset.mediaKey, 'thumb').then((url) => {
      if (url) img.src = url;
    });
  }
}

function mediaKeyForItem(item) {
  if (!item) return '';
  if (item.kind === 'group') return '';
  return Media ? Media.mediaKeyTab(item.id) : `t:${item.id}`;
}

function mediaKeyForMember(groupId, memberId) {
  return Media ? Media.mediaKeyMember(groupId, memberId) : `g:${groupId}:${memberId}`;
}

const I18N = {
  zh: {
    appName: 'TabWall',
    searchPh: '搜尋 tab name、URL、domain、note、tag',
    cards: '卡片',
    list: '列表',
    sort: '排序',
    sortNewest: '最新儲存',
    sortOldest: '最舊儲存',
    sortTitle: '名稱 A→Z',
    sortTitleDesc: '名稱 Z→A',
    sortDomain: '網域 A→Z',
    sortManual: '手動排列',
    cols: '欄數',
    colsTitle: '卡片欄數 4–10',
    themeToggle: '切換主題',
    settings: '設定',
    close: '關閉',
    afterSaveTitle: '儲存分頁後的行為',
    afterSaveClose: '關閉該分頁',
    afterSaveKeep: '不額外執行動作（僅儲存）',
    themeTitle: '主題',
    langTitle: '語言 / Language',
    defaultColsTitle: '預設欄數',
    defaultViewTitle: '預設檢視',
    otherTitle: '其它',
    openWithSearchFocus: '開啟時聚焦搜尋框',
    restore: '還原分頁',
    noSnapshot: '此項目無全尺寸快照，顯示縮圖。',
    editHeading: '編輯 Note / Tags',
    note: 'Note',
    notePh: '加入備註…',
    tags: 'Tags',
    tagsHint: '輸入後按 Tab 新增',
    tagPh: '輸入 tag',
    cancel: '取消',
    save: '儲存',
    savedCount: '已存 {n} 個',
    countTabs: '{n} 個暫存分頁',
    countFiltered: '{shown} / {total}',
    emptyTitle: '尚無暫存分頁',
    emptyBody:
      '在網頁按下 <kbd>Option</kbd>/<kbd>Alt</kbd>+<kbd>S</kbd> 存分頁；在 Group 內按 <kbd>Option</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> 存整個群組。<br/>開啟後按 <kbd>/</kbd> 可搜尋。',
    noResultsTitle: '沒有符合的結果',
    noResultsBody: '試試其他關鍵字，或清除搜尋。',
    expand: '放大',
    edit: '編輯 note / tags',
    delete: '刪除',
    viewMode: '檢視模式',
    tagsManage: 'Tags',
    tagsManageTitle: 'Tag 管理',
    tagSearchPh: '搜尋 tag…',
    tagAddPh: '新 tag 名稱',
    add: '新增',
    rename: '編輯',
    tagCount: '{n} 個分頁',
    tagEmpty: '尚無 tag',
    tagRenamePrompt: '輸入新的 tag 名稱',
    tagDeleteConfirm: '刪除 tag「{name}」？將從所有 saved tabs 移除。',
    backupTitle: '備份與還原',
    exportBackup: '匯出備份',
    exportLite: '匯出精簡',
    exportFull: '匯出完整 ZIP',
    importBackup: '還原',
    backupExported: '已匯出備份',
    backupImported: '已還原備份',
    backupConfirm: '還原將覆寫目前所有 TabWall 資料，確定？',
    backupInvalid: '備份檔無效',
    backupError: '操作失敗',
    backupHint: '精簡不含截圖（檔案小）；完整 ZIP 含圖片二進位。',
    selectMode: '選擇',
    selectModeOn: '選擇中',
    batchRestore: '還原',
    batchEdit: 'Note / Tags',
    batchDelete: '刪除',
    batchClear: '取消',
    batchCount: '已選 {n}',
    batchDeleteConfirm: '刪除選取的 {n} 項？',
    batchEditHeading: '批次編輯 Note / Tags',
    batchEditSub: 'Note 非空則覆寫；Tags 預設合併到各項目',
    editFailed: '儲存失敗',
    help: '說明',
    helpTitle: '說明',
    helpShortcutsTitle: '快捷鍵',
    helpShortcutSave: '儲存目前分頁（截圖）',
    helpShortcutGroup: '儲存目前 Tab Group',
    helpShortcutWall: '開關 TabWall 照片牆',
    helpShortcutSearch: '聚焦搜尋',
    helpShortcutEsc: '關閉浮層／照片牆',
    helpShortcutArrows: '快照上一張／下一張',
    helpBasicTitle: '基本使用',
    helpBasicBody:
      '點縮圖或標題還原分頁；中央 ✎ 編輯 note／tags；⤢ 放大快照；× 刪除。可拖曳卡片重排（磁吸）。',
    helpGroupTitle: 'Tab Group',
    helpGroupBody:
      '在 group 內按 Alt+Shift+G 可整組存檔。照片牆中 ▦ 開啟成員面板：可看每位成員快照、編輯 note／tags、還原單一或整個 group。',
    helpSelectTitle: '複選',
    helpSelectBody: '點「選擇」進入複選，勾選多張卡片後可批次還原、合併 tags、或刪除。',
    helpBackupTitle: '備份',
    helpBackupBody: '精簡 JSON 不含截圖、檔案小；完整 ZIP 含圖片二進位。還原會覆寫現有資料。',
    helpLimitsTitle: '限制',
    helpLimitsBody:
      'chrome:// 等特殊頁無法截圖或注入。TabWall 的存檔不是 Chrome 書籤列內建的 Save group。',
    groupTabs: '{n} 個分頁',
    unnamedGroup: '未命名群組',
    restoreGroup: '還原整個 Group',
    expandGroup: '展開成員',
    collapseGroup: '收合',
    afterSaveGroupTitle: '儲存 Group 後',
    saveGroupCaptureTitle: 'Group 截圖',
    captureAll: '全部成員',
    captureNone: '不截圖（僅結構）',
    captureActive: '僅目前分頁',
    restoreGroupInTitle: '還原 Group 到',
    restoreCurrentWindow: '目前視窗',
    restoreNewWindow: '新視窗',
    memberRestore: '還原此分頁',
    memberSnapshot: '快照',
    memberEdit: 'Note / Tags',
    editMemberHeading: '編輯成員 Note / Tags',
  },
  en: {
    appName: 'TabWall',
    searchPh: 'Search name, URL, domain, note, tag',
    cards: 'Cards',
    list: 'List',
    sort: 'Sort',
    sortNewest: 'Newest',
    sortOldest: 'Oldest',
    sortTitle: 'Title A→Z',
    sortTitleDesc: 'Title Z→A',
    sortDomain: 'Domain A→Z',
    sortManual: 'Manual order',
    cols: 'Cols',
    colsTitle: 'Card columns 4–10',
    themeToggle: 'Toggle theme',
    settings: 'Settings',
    close: 'Close',
    afterSaveTitle: 'After saving a tab',
    afterSaveClose: 'Close the tab',
    afterSaveKeep: 'Keep the tab open (save only)',
    themeTitle: 'Theme',
    langTitle: 'Language',
    defaultColsTitle: 'Default columns',
    defaultViewTitle: 'Default view',
    otherTitle: 'Other',
    openWithSearchFocus: 'Focus search when opening',
    restore: 'Restore tab',
    noSnapshot: 'No full snapshot; showing thumbnail.',
    editHeading: 'Edit note / tags',
    note: 'Note',
    notePh: 'Add a note…',
    tags: 'Tags',
    tagsHint: 'Type then press Tab to add',
    tagPh: 'Add a tag',
    cancel: 'Cancel',
    save: 'Save',
    savedCount: '{n} saved',
    countTabs: '{n} parked tabs',
    countFiltered: '{shown} / {total}',
    emptyTitle: 'No parked tabs yet',
    emptyBody:
      'Press <kbd>Option</kbd>/<kbd>Alt</kbd>+<kbd>S</kbd> to park a tab; <kbd>Option</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> to park the whole Tab Group.<br/>Press <kbd>/</kbd> to search.',
    noResultsTitle: 'No matches',
    noResultsBody: 'Try another query or clear the search.',
    expand: 'Expand',
    edit: 'Edit note / tags',
    delete: 'Delete',
    viewMode: 'View mode',
    tagsManage: 'Tags',
    tagsManageTitle: 'Tag manager',
    tagSearchPh: 'Search tags…',
    tagAddPh: 'New tag name',
    add: 'Add',
    rename: 'Edit',
    tagCount: '{n} tabs',
    tagEmpty: 'No tags yet',
    tagRenamePrompt: 'Enter new tag name',
    tagDeleteConfirm: 'Delete tag "{name}"? It will be removed from all saved tabs.',
    backupTitle: 'Backup & restore',
    exportBackup: 'Export',
    exportLite: 'Export lite',
    exportFull: 'Export full ZIP',
    importBackup: 'Restore',
    backupExported: 'Backup exported',
    backupImported: 'Backup restored',
    backupConfirm: 'Restore will overwrite all current TabWall data. Continue?',
    backupInvalid: 'Invalid backup file',
    backupError: 'Operation failed',
    backupHint: 'Lite omits screenshots (small). Full ZIP stores binary images.',
    selectMode: 'Select',
    selectModeOn: 'Selecting',
    batchRestore: 'Restore',
    batchEdit: 'Note / Tags',
    batchDelete: 'Delete',
    batchClear: 'Cancel',
    batchCount: '{n} selected',
    batchDeleteConfirm: 'Delete {n} selected items?',
    batchEditHeading: 'Batch edit note / tags',
    batchEditSub: 'Non-empty note overwrites; tags are merged by default',
    editFailed: 'Save failed',
    help: 'Help',
    helpTitle: 'Help',
    helpShortcutsTitle: 'Shortcuts',
    helpShortcutSave: 'Park current tab (screenshot)',
    helpShortcutGroup: 'Park current Tab Group',
    helpShortcutWall: 'Toggle TabWall overlay',
    helpShortcutSearch: 'Focus search',
    helpShortcutEsc: 'Close panels / TabWall',
    helpShortcutArrows: 'Previous / next snapshot',
    helpBasicTitle: 'Basics',
    helpBasicBody:
      'Click thumbnail or title to restore; ✎ for note/tags; ⤢ to expand snapshot; × to delete. Drag cards to reorder.',
    helpGroupTitle: 'Tab Groups',
    helpGroupBody:
      'Press Alt+Shift+G inside a group to park it. Use ▦ for the members panel: snapshots, per-tab note/tags, restore one or the whole group.',
    helpSelectTitle: 'Multi-select',
    helpSelectBody: 'Turn on Select, pick cards, then batch restore, merge tags, or delete.',
    helpBackupTitle: 'Backup',
    helpBackupBody:
      'Lite JSON omits screenshots (small). Full ZIP stores binary images. Restore overwrites current data.',
    helpLimitsTitle: 'Limits',
    helpLimitsBody:
      'chrome:// pages cannot be captured or injected into. TabWall storage is not Chrome’s built-in Save group.',
    groupTabs: '{n} tabs',
    unnamedGroup: 'Untitled group',
    restoreGroup: 'Restore entire group',
    expandGroup: 'Show members',
    collapseGroup: 'Collapse',
    afterSaveGroupTitle: 'After saving a group',
    saveGroupCaptureTitle: 'Group capture',
    captureAll: 'All members',
    captureNone: 'None (structure only)',
    captureActive: 'Active tab only',
    restoreGroupInTitle: 'Restore group to',
    restoreCurrentWindow: 'Current window',
    restoreNewWindow: 'New window',
    memberRestore: 'Restore this tab',
    memberSnapshot: 'Snapshot',
    memberEdit: 'Note / Tags',
    editMemberHeading: 'Edit member note / tags',
  },
};

const gridEl = document.getElementById('grid');
const countEl = document.getElementById('count');
const searchEl = document.getElementById('search');
const settingsEl = document.getElementById('settings');
const floatBackdrop = document.getElementById('floatBackdrop');
const settingsBox = document.getElementById('settingsBox');
const settingsBtn = document.getElementById('settingsBtn');
const settingsDrag = document.getElementById('settingsDrag');
const settingsCloseX = document.getElementById('settingsCloseX');
const tagsBtn = document.getElementById('tagsBtn');
const tagsBox = document.getElementById('tagsBox');
const tagsDrag = document.getElementById('tagsDrag');
const tagsCloseX = document.getElementById('tagsCloseX');
const helpBtn = document.getElementById('helpBtn');
const helpBox = document.getElementById('helpBox');
const helpDrag = document.getElementById('helpDrag');
const helpCloseX = document.getElementById('helpCloseX');
const tagSearch = document.getElementById('tagSearch');
const tagManageList = document.getElementById('tagManageList');
const tagAddInput = document.getElementById('tagAddInput');
const tagAddBtn = document.getElementById('tagAddBtn');
const exportLiteBtn = document.getElementById('exportLiteBtn');
const exportFullBtn = document.getElementById('exportFullBtn');
const importBackupBtn = document.getElementById('importBackupBtn');
const importBackupFile = document.getElementById('importBackupFile');
const backupStatus = document.getElementById('backupStatus');
const selectModeBtn = document.getElementById('selectModeBtn');
const batchBar = document.getElementById('batchBar');
const batchCount = document.getElementById('batchCount');
const batchRestore = document.getElementById('batchRestore');
const batchEdit = document.getElementById('batchEdit');
const batchDelete = document.getElementById('batchDelete');
const batchClear = document.getElementById('batchClear');
const closeBtn = document.getElementById('closeBtn');
const themeBtn = document.getElementById('themeBtn');
const viewCardsBtn = document.getElementById('viewCards');
const viewListBtn = document.getElementById('viewList');
const sortByEl = document.getElementById('sortBy');
const colsControl = document.getElementById('colsControl');
const cardColsEl = document.getElementById('cardCols');
const colsValueEl = document.getElementById('colsValue');
const settingsCardCols = document.getElementById('settingsCardCols');
const settingsColsValue = document.getElementById('settingsColsValue');
const openWithSearchFocusEl = document.getElementById('openWithSearchFocus');
const savedBadge = document.getElementById('savedBadge');
const versionBadge = document.getElementById('versionBadge');

const lightbox = document.getElementById('lightbox');
const lbImage = document.getElementById('lbImage');
const lbTitle = document.getElementById('lbTitle');
const lbUrl = document.getElementById('lbUrl');
const lbSnapHint = document.getElementById('lbSnapHint');
const lbRestore = document.getElementById('lbRestore');
const lbClose = document.getElementById('lbClose');
const lbPrev = document.getElementById('lbPrev');
const lbNext = document.getElementById('lbNext');
const lbCounter = document.getElementById('lbCounter');

const editBox = document.getElementById('editBox');
const editDrag = document.getElementById('editDrag');
const editHeading = document.getElementById('editHeading');
const editItemTitle = document.getElementById('editItemTitle');
const editSub = document.getElementById('editSub');
const editNote = document.getElementById('editNote');
const editChips = document.getElementById('editChips');
const editTagDraft = document.getElementById('editTagDraft');
const editCancel = document.getElementById('editCancel');
const editSave = document.getElementById('editSave');
const editCloseX = document.getElementById('editCloseX');

const membersBox = document.getElementById('membersBox');
const membersDrag = document.getElementById('membersDrag');
const membersTitle = document.getElementById('membersTitle');
const membersList = document.getElementById('membersList');
const membersCloseX = document.getElementById('membersCloseX');
const membersRestoreAll = document.getElementById('membersRestoreAll');
const membersDelete = document.getElementById('membersDelete');

/** @type {Array<any>} */
let allTabs = []; // ParkItem[] (kind tab | group)
let query = '';
/** @type {typeof DEFAULT_SETTINGS} */
let settings = { ...DEFAULT_SETTINGS };
/** @type {string|null} */
let expandedId = null;
/** @type {{ groupId?: string } | null} */
let expandedMeta = null;
/** @type {{ list: any[], index: number } | null} */
let lightboxNav = null;
/** @type {string|null} */
let editingId = null;
/** @type {{ type: 'item' | 'member' | 'batch', groupId?: string, memberId?: string, ids?: string[] } | null} */
let editContext = null;
/** @type {string|null} */
let membersGroupId = null;
/** @type {string[]} */
let editTagList = [];
/** @type {Array<{ name: string, count: number }>} */
let tagStats = [];
let tagFilter = '';
let selectMode = false;
/** @type {Set<string>} */
let selectedIds = new Set();

/** @type {null | object} */
let dragState = null;

function focusSearch() {
  try {
    window.focus();
  } catch {
    // ignore
  }
  searchEl.focus();
  searchEl.select();
}

window.addEventListener('message', (event) => {
  if (event.data?.type === 'TABWALL_FOCUS_SEARCH') {
    focusSearch();
  }
});

function t(key, vars) {
  const locale = settings.locale === 'en' ? 'en' : 'zh';
  let s = I18N[locale][key] || I18N.en[key] || I18N.zh[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
    });
  }
  return s;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (key) el.setAttribute('aria-label', t(key));
  });
  // sort options
  sortByEl.querySelectorAll('option[data-i18n]').forEach((opt) => {
    const key = opt.getAttribute('data-i18n');
    if (key) opt.textContent = t(key);
  });
  applyTheme(settings.theme);
  if (selectModeBtn) {
    selectModeBtn.textContent = selectMode ? t('selectModeOn') : t('selectMode');
  }
  updateSavedBadge();
  if (typeof updateBatchBar === 'function') updateBatchBar();
}

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

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function clampCols(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 4;
  return Math.min(10, Math.max(4, Math.round(v)));
}

// ─── Settings ──────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  merged.cardCols = clampCols(merged.cardCols);
  if (merged.defaultViewMode !== 'list') merged.defaultViewMode = 'cards';
  if (merged.locale !== 'en') merged.locale = 'zh';
  return merged;
}

async function saveSettings(partial) {
  if (partial.cardCols != null) partial.cardCols = clampCols(partial.cardCols);
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
  colsControl.classList.toggle('visible', !isList);
}

function applyCardCols(cols) {
  const n = clampCols(cols);
  gridEl.style.setProperty('--cols', String(n));
  cardColsEl.value = String(n);
  colsValueEl.textContent = String(n);
  if (settingsCardCols) {
    settingsCardCols.value = String(n);
    settingsColsValue.textContent = String(n);
  }
}

function updateSavedBadge() {
  const n = allTabs.length;
  const visible = getVisibleTabs().length;
  savedBadge.textContent = t('savedCount', { n });
  countEl.textContent =
    query && visible !== n
      ? t('countFiltered', { shown: visible, total: n })
      : t('countTabs', { n });
}

function syncSettingsUi() {
  applyTheme(settings.theme);
  applyViewMode(settings.viewMode);
  applyCardCols(settings.cardCols);
  sortByEl.value = settings.sortBy || 'newest';
  openWithSearchFocusEl.checked = Boolean(settings.openWithSearchFocus);

  const after =
    settingsEl.querySelector(`input[name="afterSave"][value="${settings.afterSave}"]`) ||
    settingsEl.querySelector('input[name="afterSave"][value="close"]');
  if (after) after.checked = true;

  const afterG =
    settingsEl.querySelector(
      `input[name="afterSaveGroup"][value="${settings.afterSaveGroup || 'close'}"]`
    ) || settingsEl.querySelector('input[name="afterSaveGroup"][value="close"]');
  if (afterG) afterG.checked = true;

  const cap =
    settingsEl.querySelector(
      `input[name="saveGroupCapture"][value="${settings.saveGroupCapture || 'all'}"]`
    ) || settingsEl.querySelector('input[name="saveGroupCapture"][value="all"]');
  if (cap) cap.checked = true;

  const rg =
    settingsEl.querySelector(
      `input[name="restoreGroupIn"][value="${settings.restoreGroupIn || 'currentWindow'}"]`
    ) || settingsEl.querySelector('input[name="restoreGroupIn"][value="currentWindow"]');
  if (rg) rg.checked = true;

  const themeRadio =
    settingsEl.querySelector(`input[name="theme"][value="${settings.theme}"]`) ||
    settingsEl.querySelector('input[name="theme"][value="dark"]');
  if (themeRadio) themeRadio.checked = true;

  const localeRadio =
    settingsEl.querySelector(`input[name="locale"][value="${settings.locale}"]`) ||
    settingsEl.querySelector('input[name="locale"][value="zh"]');
  if (localeRadio) localeRadio.checked = true;

  const viewRadio =
    settingsEl.querySelector(
      `input[name="defaultViewMode"][value="${settings.defaultViewMode || 'cards'}"]`
    ) || settingsEl.querySelector('input[name="defaultViewMode"][value="cards"]');
  if (viewRadio) viewRadio.checked = true;

  applyI18n();
}

async function initSettingsUi() {
  settings = await loadSettings();

  // On open: apply default view if we want fresh open behavior
  // Use stored viewMode if user toggled; defaultViewMode applied when viewMode missing
  if (!settings.viewMode) {
    settings.viewMode = settings.defaultViewMode || 'cards';
  }

  syncSettingsUi();

  try {
    versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch {
    versionBadge.textContent = 'v—';
  }

  settingsEl.querySelectorAll('input[name="afterSave"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) await saveSettings({ afterSave: input.value });
    });
  });

  settingsEl.querySelectorAll('input[name="afterSaveGroup"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) await saveSettings({ afterSaveGroup: input.value });
    });
  });

  settingsEl.querySelectorAll('input[name="saveGroupCapture"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) await saveSettings({ saveGroupCapture: input.value });
    });
  });

  settingsEl.querySelectorAll('input[name="restoreGroupIn"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) await saveSettings({ restoreGroupIn: input.value });
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

  settingsEl.querySelectorAll('input[name="locale"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) {
        await saveSettings({ locale: input.value });
        applyI18n();
        renderGrid();
      }
    });
  });

  settingsEl.querySelectorAll('input[name="defaultViewMode"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) {
        await saveSettings({
          defaultViewMode: input.value,
          viewMode: input.value,
        });
        applyViewMode(input.value);
        renderGrid();
      }
    });
  });

  openWithSearchFocusEl.addEventListener('change', async () => {
    await saveSettings({ openWithSearchFocus: openWithSearchFocusEl.checked });
  });

  settingsCardCols.addEventListener('input', () => {
    applyCardCols(settingsCardCols.value);
  });
  settingsCardCols.addEventListener('change', async () => {
    await saveSettings({ cardCols: clampCols(settingsCardCols.value) });
  });

  if (settings.openWithSearchFocus) {
    setTimeout(() => searchEl.focus(), 50);
  }
}

function placeFloatBox(el) {
  const w = el.offsetWidth || 440;
  const h = el.offsetHeight || 360;
  el.style.left = `${Math.max(16, Math.round((window.innerWidth - w) / 2))}px`;
  el.style.top = `${Math.max(16, Math.round((window.innerHeight - h) / 2))}px`;
}

function setupFloatDrag(handle, box) {
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
  return (
    settingsBox.classList.contains('open') ||
    tagsBox.classList.contains('open') ||
    helpBox.classList.contains('open') ||
    editBox.classList.contains('open') ||
    membersBox.classList.contains('open')
  );
}

function syncFloatBackdrop() {
  if (anyFloatOpen()) {
    floatBackdrop.classList.add('open');
    floatBackdrop.setAttribute('aria-hidden', 'false');
  } else {
    floatBackdrop.classList.remove('open');
    floatBackdrop.setAttribute('aria-hidden', 'true');
  }
}

function closeAllFloatsExcept(except) {
  if (except !== 'settings') closeSettingsBox(false);
  if (except !== 'tags') closeTagsBox(false);
  if (except !== 'help') closeHelpBox(false);
  if (except !== 'edit') closeEditBox();
  if (except !== 'members') closeMembersBox();
  syncFloatBackdrop();
}

function openSettingsBox() {
  closeAllFloatsExcept('settings');
  settingsBox.classList.add('open');
  settingsBox.setAttribute('aria-hidden', 'false');
  settingsBtn.classList.add('active');
  placeFloatBox(settingsBox);
  syncFloatBackdrop();
}

function closeSettingsBox(sync = true) {
  settingsBox.classList.remove('open');
  settingsBox.setAttribute('aria-hidden', 'true');
  settingsBtn.classList.remove('active');
  if (sync) syncFloatBackdrop();
}

async function openTagsBox() {
  closeAllFloatsExcept('tags');
  tagsBox.classList.add('open');
  tagsBox.setAttribute('aria-hidden', 'false');
  tagsBtn.classList.add('active');
  placeFloatBox(tagsBox);
  syncFloatBackdrop();
  await refreshTagManager();
  tagSearch.focus();
}

function closeTagsBox(sync = true) {
  tagsBox.classList.remove('open');
  tagsBox.setAttribute('aria-hidden', 'true');
  tagsBtn.classList.remove('active');
  if (sync) syncFloatBackdrop();
}

function openHelpBox() {
  closeAllFloatsExcept('help');
  helpBox.classList.add('open');
  helpBox.setAttribute('aria-hidden', 'false');
  helpBtn.classList.add('active');
  placeFloatBox(helpBox);
  syncFloatBackdrop();
}

function closeHelpBox(sync = true) {
  helpBox.classList.remove('open');
  helpBox.setAttribute('aria-hidden', 'true');
  helpBtn.classList.remove('active');
  if (sync) syncFloatBackdrop();
}

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsBox.classList.contains('open')) closeSettingsBox();
  else openSettingsBox();
});
settingsCloseX.addEventListener('click', () => closeSettingsBox());
setupFloatDrag(settingsDrag, settingsBox);

tagsBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (tagsBox.classList.contains('open')) closeTagsBox();
  else await openTagsBox();
});
tagsCloseX.addEventListener('click', () => closeTagsBox());
setupFloatDrag(tagsDrag, tagsBox);

helpBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (helpBox.classList.contains('open')) closeHelpBox();
  else openHelpBox();
});
helpCloseX.addEventListener('click', () => closeHelpBox());
setupFloatDrag(helpDrag, helpBox);

floatBackdrop.addEventListener('click', () => {
  if (editBox.classList.contains('open')) {
    closeEditBox();
    syncFloatBackdrop();
    return;
  }
  if (membersBox.classList.contains('open')) {
    closeMembersBox();
    syncFloatBackdrop();
    return;
  }
  if (helpBox.classList.contains('open')) {
    closeHelpBox();
    return;
  }
  if (tagsBox.classList.contains('open')) {
    closeTagsBox();
    return;
  }
  if (settingsBox.classList.contains('open')) {
    closeSettingsBox();
  }
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

cardColsEl.addEventListener('input', () => {
  applyCardCols(cardColsEl.value);
});

cardColsEl.addEventListener('change', async () => {
  await saveSettings({ cardCols: clampCols(cardColsEl.value) });
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
    e.stopPropagation();
    focusSearch();
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (editBox.classList.contains('open')) {
      closeEditBox();
      return;
    }
    if (lightbox.classList.contains('open')) {
      closeLightbox();
      return;
    }
    if (membersBox.classList.contains('open')) {
      closeMembersBox();
      return;
    }
    if (helpBox.classList.contains('open')) {
      closeHelpBox();
      return;
    }
    if (tagsBox.classList.contains('open')) {
      closeTagsBox();
      return;
    }
    if (settingsBox.classList.contains('open')) {
      closeSettingsBox();
      return;
    }
    if (selectMode) {
      setSelectMode(false);
      return;
    }
    if (document.activeElement === searchEl && searchEl.value) {
      searchEl.value = '';
      query = '';
      renderGrid();
      searchEl.blur();
      return;
    }
    requestHostClose();
    return;
  }

  if (lightbox.classList.contains('open') && !isTypingTarget(e.target)) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateLightbox(-1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateLightbox(1);
    }
  }
});

// ─── Sort ──────────────────────────────────────────────────────────

function sortTabs(list, sortBy) {
  if (sortBy === 'manual') return [...list];
  const arr = [...list];
  const titleOf = (t) => itemTitle(t).toLowerCase();
  switch (sortBy) {
    case 'oldest':
      return arr.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    case 'title':
      return arr.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'zh-Hant'));
    case 'title-desc':
      return arr.sort((a, b) => titleOf(b).localeCompare(titleOf(a), 'zh-Hant'));
    case 'domain':
      return arr.sort((a, b) => {
        const da = a.kind === 'group' ? '' : domainOf(a.url);
        const db = b.kind === 'group' ? '' : domainOf(b.url);
        return da.localeCompare(db);
      });
    case 'newest':
    default:
      return arr.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
}

function getVisibleTabs() {
  return sortTabs(
    allTabs.filter((item) => matchesQuery(item, query)),
    settings.sortBy || 'newest'
  );
}

function matchesQuery(item, q) {
  if (!q) return true;
  if (item.kind === 'group') {
    const parts = [
      item.title || '',
      item.note || '',
      ...(Array.isArray(item.tags) ? item.tags : []),
    ];
    for (const m of item.tabs || []) {
      parts.push(
        m.title || '',
        m.url || '',
        domainOf(m.url),
        m.note || '',
        ...(Array.isArray(m.tags) ? m.tags : [])
      );
    }
    return parts.join(' ').toLowerCase().includes(q);
  }
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

function itemTitle(item) {
  if (item.kind === 'group') return item.title || t('unnamedGroup');
  return item.title || item.url || 'Untitled';
}

// ─── Expand ────────────────────────────────────────────────────────

function buildLightboxNavList() {
  const list = [];
  for (const item of getVisibleTabs()) {
    if (item.kind === 'group') {
      for (const m of item.tabs || []) {
        list.push({
          key: `m:${item.id}:${m.id}`,
          mediaKey: mediaKeyForMember(item.id, m.id),
          title: m.title || m.url || 'Untitled',
          url: m.url || '',
          hasSnap: Boolean(m.hasSnap || m.snapshot),
          hasThumb: Boolean(m.hasThumb || m.thumbnail),
          restore: { type: 'member', groupId: item.id, memberId: m.id },
        });
      }
    } else {
      list.push({
        key: `t:${item.id}`,
        mediaKey: mediaKeyForItem(item),
        title: item.title || item.url || 'Untitled',
        url: item.url || '',
        hasSnap: Boolean(item.hasSnap || item.snapshot),
        hasThumb: Boolean(item.hasThumb || item.thumbnail),
        restore: { type: 'tab', id: item.id },
      });
    }
  }
  return list;
}

async function showLightboxEntry(entry, index, list) {
  expandedId = entry.restore.type === 'member' ? entry.restore.memberId : entry.restore.id;
  expandedMeta =
    entry.restore.type === 'member' ? { groupId: entry.restore.groupId } : null;
  lightboxNav = { list, index };
  lbTitle.textContent = entry.title;
  lbUrl.textContent = entry.url;
  if (lbCounter) {
    lbCounter.textContent = list.length ? `${index + 1} / ${list.length}` : '—';
  }
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');

  // placeholder thumb then full snap
  const prevSrc = lbImage.src;
  if (prevSrc && prevSrc.startsWith('blob:') && ![...snapCache.values()].includes(prevSrc)) {
    // keep snap cache; don't revoke mid-nav of cached
  }

  let shownSnap = false;
  if (entry.mediaKey && snapCache.has(entry.mediaKey)) {
    lbImage.src = snapCache.get(entry.mediaKey);
    lbSnapHint.hidden = true;
    shownSnap = true;
  } else {
    // show thumb first
    if (entry.mediaKey && entry.hasThumb) {
      const thumbUrl = await fetchMediaUrl(entry.mediaKey, 'thumb');
      if (thumbUrl && lightboxNav?.index === index) lbImage.src = thumbUrl;
    } else {
      lbImage.removeAttribute('src');
    }
    lbSnapHint.hidden = !entry.hasSnap;
    if (entry.mediaKey && entry.hasSnap) {
      const snapUrl = await fetchMediaUrl(entry.mediaKey, 'snap');
      if (snapUrl && lightboxNav?.index === index) {
        cacheSnap(entry.mediaKey, snapUrl);
        lbImage.src = snapUrl;
        lbSnapHint.hidden = true;
        shownSnap = true;
      }
    }
  }

  if (!shownSnap && !lbImage.getAttribute('src')) {
    lbSnapHint.hidden = false;
  }

  // prefetch neighbors
  const n = list.length;
  if (n > 1) {
    for (const d of [-1, 1]) {
      const ni = (index + d + n) % n;
      const ne = list[ni];
      if (ne?.mediaKey && ne.hasSnap && !snapCache.has(ne.mediaKey)) {
        fetchMediaUrl(ne.mediaKey, 'snap').then((url) => {
          if (url) cacheSnap(ne.mediaKey, url);
        });
      }
    }
  }
}

function openLightbox(item, meta = null) {
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
        ? mediaKeyForMember(meta.groupId, item.id)
        : mediaKeyForItem(item),
      title: item.title || item.url || 'Untitled',
      url: item.url || '',
      hasSnap: Boolean(item.hasSnap || item.snapshot),
      hasThumb: Boolean(item.hasThumb || item.thumbnail),
      restore: meta?.groupId
        ? { type: 'member', groupId: meta.groupId, memberId: item.id }
        : { type: 'tab', id: item.id },
    };
    showLightboxEntry(entry, 0, [entry]);
    return;
  }
  showLightboxEntry(list[index], index, list);
}

function navigateLightbox(delta) {
  if (!lightboxNav || !lightboxNav.list.length) return;
  const n = lightboxNav.list.length;
  const next = (lightboxNav.index + delta + n) % n;
  showLightboxEntry(lightboxNav.list[next], next, lightboxNav.list);
}

function closeLightbox() {
  expandedId = null;
  expandedMeta = null;
  lightboxNav = null;
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  lbImage.removeAttribute('src');
  if (lbCounter) lbCounter.textContent = '—';
}

lbClose.addEventListener('click', closeLightbox);
if (lbPrev) lbPrev.addEventListener('click', () => navigateLightbox(-1));
if (lbNext) lbNext.addEventListener('click', () => navigateLightbox(1));

lbRestore.addEventListener('click', async () => {
  if (!expandedId) return;
  if (expandedMeta?.groupId) {
    const res = await sendMessage({
      type: 'RESTORE_GROUP_MEMBER',
      groupId: expandedMeta.groupId,
      memberId: expandedId,
    });
    if (res.ok) {
      closeLightbox();
      await loadList();
    }
    return;
  }
  const res = await sendMessage({ type: 'RESTORE_TAB', id: expandedId });
  if (res.ok) {
    allTabs = allTabs.filter((t) => t.id !== expandedId);
    closeLightbox();
    renderGrid();
  }
});

// ─── Tag chips ─────────────────────────────────────────────────────

function renderEditChips() {
  editChips.innerHTML = '';
  editTagList.forEach((tag, index) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)} <button type="button" aria-label="remove">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      editTagList.splice(index, 1);
      renderEditChips();
    });
    editChips.appendChild(chip);
  });
}

function commitTagDraft() {
  const raw = editTagDraft.value.trim();
  if (!raw) return false;
  if (!editTagList.includes(raw)) editTagList.push(raw);
  editTagDraft.value = '';
  renderEditChips();
  // ensure catalog knows this tag
  sendMessage({ type: 'ADD_TAG', name: raw }).then(() => {
    if (tagsBox.classList.contains('open')) refreshTagManager();
  });
  return true;
}

// ─── Tag manager ───────────────────────────────────────────────────

async function refreshTagManager() {
  const res = await sendMessage({ type: 'GET_TAGS' });
  tagStats = res.ok && Array.isArray(res.tags) ? res.tags : [];
  renderTagManager();
}

function renderTagManager() {
  const q = tagFilter.trim().toLowerCase();
  const list = tagStats.filter((t) => !q || t.name.toLowerCase().includes(q));
  tagManageList.innerHTML = '';

  if (list.length === 0) {
    tagManageList.innerHTML = `<div class="tag-manage-empty">${escapeHtml(t('tagEmpty'))}</div>`;
    return;
  }

  list.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'tag-chip-card';
    row.innerHTML = `
      <span class="name" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</span>
      <span class="count">${escapeHtml(String(item.count))}</span>
      <button type="button" class="chip-btn rename-btn" title="${escapeAttr(t('rename'))}">✎</button>
      <button type="button" class="chip-btn delete-btn" title="${escapeAttr(t('delete'))}">×</button>
    `;

    row.querySelector('.rename-btn').addEventListener('click', async () => {
      const next = window.prompt(t('tagRenamePrompt'), item.name);
      if (next == null) return;
      const name = next.trim();
      if (!name || name === item.name) return;
      const res = await sendMessage({ type: 'RENAME_TAG', from: item.name, to: name });
      if (res.ok) {
        tagStats = res.tags || [];
        renderTagManager();
        await loadList();
      }
    });

    row.querySelector('.delete-btn').addEventListener('click', async () => {
      if (!window.confirm(t('tagDeleteConfirm', { name: item.name }))) return;
      const res = await sendMessage({ type: 'DELETE_TAG', name: item.name });
      if (res.ok) {
        tagStats = res.tags || [];
        renderTagManager();
        await loadList();
      }
    });

    tagManageList.appendChild(row);
  });
}

tagSearch.addEventListener('input', () => {
  tagFilter = tagSearch.value;
  renderTagManager();
});

async function addTagFromManager() {
  const name = tagAddInput.value.trim();
  if (!name) return;
  const res = await sendMessage({ type: 'ADD_TAG', name });
  if (res.ok) {
    tagAddInput.value = '';
    tagStats = res.tags || [];
    renderTagManager();
  }
}

tagAddBtn.addEventListener('click', () => addTagFromManager());
tagAddInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTagFromManager();
  }
});

// ─── Backup / restore (lite JSON or full ZIP store) ────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function dataUrlToBytes(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return null;
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToDataUrl(bytes, mime = 'image/jpeg') {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** CRC32 for ZIP */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function concatBytes(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Minimal ZIP (STORE only) — good for already-compressed JPEGs */
function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = concatBytes(centrals);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...locals, centralDir, end]);
}

function readU16(v, o) {
  return v[o] | (v[o + 1] << 8);
}
function readU32(v, o) {
  return (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0;
}

function unzipStore(buf) {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const files = {};
  let o = 0;
  while (o + 30 <= view.length) {
    const sig = readU32(view, o);
    if (sig !== 0x04034b50) break;
    const method = readU16(view, o + 8);
    const compSize = readU32(view, o + 18);
    const nameLen = readU16(view, o + 26);
    const extraLen = readU16(view, o + 28);
    const name = new TextDecoder().decode(view.subarray(o + 30, o + 30 + nameLen));
    const dataStart = o + 30 + nameLen + extraLen;
    const data = view.subarray(dataStart, dataStart + compSize);
    if (method === 0) files[name] = data.slice();
    o = dataStart + compSize;
  }
  return files;
}

function collectMediaFiles(items) {
  const files = [];
  const clone = JSON.parse(JSON.stringify(items));
  for (const item of clone) {
    if (item.kind === 'group') {
      for (const m of item.tabs || []) {
        const tBytes = dataUrlToBytes(m.thumbnail);
        const sBytes = dataUrlToBytes(m.snapshot);
        if (tBytes) {
          const path = `media/${item.id}_${m.id}_thumb.jpg`;
          files.push({ name: path, data: tBytes });
          m.thumbnail = path;
        } else m.thumbnail = '';
        if (sBytes) {
          const path = `media/${item.id}_${m.id}_snap.jpg`;
          files.push({ name: path, data: sBytes });
          m.snapshot = path;
        } else m.snapshot = '';
      }
    } else {
      const tBytes = dataUrlToBytes(item.thumbnail);
      const sBytes = dataUrlToBytes(item.snapshot);
      if (tBytes) {
        const path = `media/${item.id}_thumb.jpg`;
        files.push({ name: path, data: tBytes });
        item.thumbnail = path;
      } else item.thumbnail = '';
      if (sBytes) {
        const path = `media/${item.id}_snap.jpg`;
        files.push({ name: path, data: sBytes });
        item.snapshot = path;
      } else item.snapshot = '';
    }
  }
  return { items: clone, files };
}

function rehydrateMedia(items, zipFiles) {
  const get = (path) => {
    if (!path || typeof path !== 'string') return '';
    if (path.startsWith('data:')) return path;
    const bytes = zipFiles[path];
    if (!bytes) return '';
    return bytesToDataUrl(bytes);
  };
  return items.map((item) => {
    if (item.kind === 'group') {
      return {
        ...item,
        tabs: (item.tabs || []).map((m) => ({
          ...m,
          thumbnail: get(m.thumbnail),
          snapshot: get(m.snapshot),
        })),
      };
    }
    return {
      ...item,
      thumbnail: get(item.thumbnail),
      snapshot: get(item.snapshot),
    };
  });
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

exportLiteBtn.addEventListener('click', async () => {
  backupStatus.textContent = '';
  const res = await sendMessage({ type: 'EXPORT_BACKUP', mode: 'lite' });
  if (!res.ok || !res.backup) {
    backupStatus.textContent = t('backupError');
    return;
  }
  downloadBlob(
    new Blob([JSON.stringify(res.backup, null, 2)], { type: 'application/json' }),
    `tabwall-backup-lite-${stamp()}.json`
  );
  backupStatus.textContent = t('backupExported');
});

exportFullBtn.addEventListener('click', async () => {
  backupStatus.textContent = '';
  const res = await sendMessage({ type: 'EXPORT_BACKUP', mode: 'full' });
  if (!res.ok || !res.backup) {
    backupStatus.textContent = t('backupError');
    return;
  }
  try {
    const { items, files } = collectMediaFiles(res.backup.parkedItems || []);
    const meta = {
      ...res.backup,
      version: 3,
      media: 'zip',
      parkedItems: items,
      parkedTabs: items.filter((i) => i.kind === 'tab').map(({ kind, ...r }) => r),
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(meta));
    const zip = zipStore([{ name: 'backup.json', data: jsonBytes }, ...files]);
    downloadBlob(new Blob([zip], { type: 'application/zip' }), `tabwall-backup-full-${stamp()}.zip`);
    backupStatus.textContent = t('backupExported');
  } catch (err) {
    console.warn(err);
    backupStatus.textContent = t('backupError');
  }
});

importBackupBtn.addEventListener('click', () => {
  backupStatus.textContent = '';
  importBackupFile.click();
});

importBackupFile.addEventListener('change', async () => {
  const file = importBackupFile.files && importBackupFile.files[0];
  importBackupFile.value = '';
  if (!file) return;
  if (!window.confirm(t('backupConfirm'))) return;

  try {
    let backup;
    if (file.name.endsWith('.zip') || file.type === 'application/zip') {
      const buf = new Uint8Array(await file.arrayBuffer());
      const zipFiles = unzipStore(buf);
      const jsonBytes = zipFiles['backup.json'];
      if (!jsonBytes) throw new Error('no backup.json');
      backup = JSON.parse(new TextDecoder().decode(jsonBytes));
      if (Array.isArray(backup.parkedItems)) {
        backup.parkedItems = rehydrateMedia(backup.parkedItems, zipFiles);
      }
    } else {
      backup = JSON.parse(await file.text());
    }
    const res = await sendMessage({ type: 'IMPORT_BACKUP', backup });
    if (!res.ok) {
      backupStatus.textContent = t('backupInvalid');
      return;
    }
    settings = await loadSettings();
    syncSettingsUi();
    await loadList();
    if (tagsBox.classList.contains('open')) await refreshTagManager();
    backupStatus.textContent = t('backupImported');
  } catch (err) {
    console.warn(err);
    backupStatus.textContent = t('backupInvalid');
  }
});

// legacy alias removed — use exportLite / exportFull

// ─── Multi-select ──────────────────────────────────────────────────

function updateBatchBar() {
  const n = selectedIds.size;
  batchCount.textContent = t('batchCount', { n });
  if (selectMode && n > 0) {
    batchBar.classList.add('open');
    batchBar.setAttribute('aria-hidden', 'false');
  } else {
    batchBar.classList.remove('open');
    batchBar.setAttribute('aria-hidden', 'true');
  }
}

function setSelectMode(on) {
  selectMode = on;
  document.body.classList.toggle('select-mode', on);
  selectModeBtn.classList.toggle('active', on);
  selectModeBtn.textContent = on ? t('selectModeOn') : t('selectMode');
  if (!on) {
    selectedIds.clear();
  }
  updateBatchBar();
  renderGrid();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateBatchBar();
  const card = gridEl.querySelector(`[data-id="${id.replace(/"/g, '')}"]`);
  if (card) {
    card.classList.toggle('selected', selectedIds.has(id));
    const check = card.querySelector('.card-check');
    if (check) check.checked = selectedIds.has(id);
  }
}

selectModeBtn.addEventListener('click', () => setSelectMode(!selectMode));

batchClear.addEventListener('click', () => setSelectMode(false));

batchRestore.addEventListener('click', async () => {
  const ids = [...selectedIds];
  for (const id of ids) {
    await restoreItem(id);
  }
  selectedIds.clear();
  updateBatchBar();
  await loadList();
});

batchDelete.addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!window.confirm(t('batchDeleteConfirm', { n: ids.length }))) return;
  await sendMessage({ type: 'BATCH_DELETE_ITEMS', ids });
  selectedIds.clear();
  updateBatchBar();
  await loadList();
});

batchEdit.addEventListener('click', () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  editingId = 'batch';
  editContext = { type: 'batch', ids };
  editHeading.textContent = t('batchEditHeading');
  editItemTitle.textContent = t('batchCount', { n: ids.length });
  editSub.textContent = t('batchEditSub');
  editNote.value = '';
  editTagList = [];
  editTagDraft.value = '';
  renderEditChips();
  editBox.classList.add('open');
  editBox.setAttribute('aria-hidden', 'false');
  placeEditBoxCentered();
  syncFloatBackdrop();
  setTimeout(() => editNote.focus(), 0);
});

editTagDraft.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' || e.key === 'Enter') {
    if (editTagDraft.value.trim()) {
      e.preventDefault();
      commitTagDraft();
    }
    // empty Tab: allow default (leave field) only for Tab without value
    if (e.key === 'Enter') e.preventDefault();
    return;
  }
  if (e.key === 'Backspace' && !editTagDraft.value && editTagList.length) {
    e.preventDefault();
    editTagList.pop();
    renderEditChips();
  }
});

// ─── Edit box ──────────────────────────────────────────────────────

function placeEditBoxCentered() {
  const w = editBox.offsetWidth || 400;
  const h = editBox.offsetHeight || 320;
  editBox.style.left = `${Math.max(16, Math.round((window.innerWidth - w) / 2))}px`;
  editBox.style.top = `${Math.max(16, Math.round((window.innerHeight - h) / 2))}px`;
}

function openEditBox(item) {
  editingId = item.id;
  editContext = { type: 'item' };
  editHeading.textContent = t('editHeading');
  editItemTitle.textContent = itemTitle(item);
  editSub.textContent =
    item.kind === 'group'
      ? t('groupTabs', { n: (item.tabs || []).length })
      : item.url || '';
  editNote.value = item.note || '';
  editTagList = Array.isArray(item.tags) ? [...item.tags] : [];
  editTagDraft.value = '';
  renderEditChips();
  editBox.classList.add('open');
  editBox.setAttribute('aria-hidden', 'false');
  placeEditBoxCentered();
  syncFloatBackdrop();
  setTimeout(() => editNote.focus(), 0);
}

function openMemberEditBox(groupId, member) {
  editingId = member.id;
  editContext = { type: 'member', groupId, memberId: member.id };
  editHeading.textContent = t('editMemberHeading');
  editItemTitle.textContent = member.title || member.url || 'Untitled';
  editSub.textContent = member.url || '';
  editNote.value = member.note || '';
  editTagList = Array.isArray(member.tags) ? [...member.tags] : [];
  editTagDraft.value = '';
  renderEditChips();
  editBox.classList.add('open');
  editBox.setAttribute('aria-hidden', 'false');
  placeEditBoxCentered();
  syncFloatBackdrop();
  setTimeout(() => editNote.focus(), 0);
}

function closeEditBox() {
  editingId = null;
  editContext = null;
  editTagList = [];
  editBox.classList.remove('open');
  editBox.setAttribute('aria-hidden', 'true');
  syncFloatBackdrop();
}

editCancel.addEventListener('click', closeEditBox);
editCloseX.addEventListener('click', closeEditBox);

editSave.addEventListener('click', async () => {
  if (!editContext) return;
  commitTagDraft();
  if (editContext.type === 'member') {
    const res = await sendMessage({
      type: 'UPDATE_GROUP_MEMBER',
      groupId: editContext.groupId,
      memberId: editContext.memberId,
      note: editNote.value,
      tags: [...editTagList],
    });
    if (res.ok) {
      closeEditBox();
      await loadList();
      if (membersGroupId) {
        const g = allTabs.find((x) => x.id === membersGroupId);
        if (g) renderMembersList(g);
      }
    } else {
      editSub.textContent = t('editFailed');
    }
    return;
  }
  if (editContext.type === 'batch') {
    const res = await sendMessage({
      type: 'BATCH_UPDATE_ITEMS',
      ids: editContext.ids,
      note: editNote.value,
      tags: [...editTagList],
      tagMode: 'merge',
    });
    if (res.ok) {
      closeEditBox();
      selectedIds.clear();
      updateBatchBar();
      await loadList();
    } else {
      editSub.textContent = t('editFailed');
    }
    return;
  }
  if (!editingId) return;
  const res = await sendMessage({
    type: 'UPDATE_ITEM',
    id: editingId,
    note: editNote.value,
    tags: [...editTagList],
  });
  if (res.ok && (res.item || res.tab)) {
    const updated = res.item || res.tab;
    const idx = allTabs.findIndex((t) => t.id === editingId);
    if (idx !== -1) allTabs[idx] = updated;
    closeEditBox();
    renderGrid();
  } else {
    editSub.textContent = t('editFailed');
  }
});

// ─── Members floating box ──────────────────────────────────────────

function placeMembersBoxCentered() {
  const w = membersBox.offsetWidth || 520;
  const h = membersBox.offsetHeight || 400;
  membersBox.style.left = `${Math.max(16, Math.round((window.innerWidth - w) / 2))}px`;
  membersBox.style.top = `${Math.max(16, Math.round((window.innerHeight - h) / 2))}px`;
}

function renderMembersList(group) {
  const members = [...(group.tabs || [])].sort(
    (a, b) => (a.indexInGroup || 0) - (b.indexInGroup || 0)
  );
  membersList.innerHTML = '';
  if (members.length === 0) {
    membersList.innerHTML = `<div class="tag-manage-empty">—</div>`;
    return;
  }
  members.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'member-row';
    row.dataset.memberId = m.id;
    const note = m.note || '';
    const tags = Array.isArray(m.tags) ? m.tags : [];
    const mKey = mediaKeyForMember(group.id, m.id);
    row.innerHTML = `
      <img class="member-thumb lazy-thumb" alt="" data-media-key="${escapeAttr(mKey)}" />
      <div class="member-body">
        <div class="member-title" title="${escapeAttr(m.title || '')}">${escapeHtml(m.title || m.url || '')}</div>
        <div class="member-url" title="${escapeAttr(m.url || '')}">${escapeHtml(m.url || '')}</div>
        ${note ? `<div class="note-preview">${escapeHtml(note)}</div>` : ''}
        ${
          tags.length
            ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
            : ''
        }
        <div class="member-actions">
          <button type="button" class="btn snap-btn">${escapeHtml(t('memberSnapshot'))}</button>
          <button type="button" class="btn edit-m-btn">${escapeHtml(t('memberEdit'))}</button>
          <button type="button" class="btn primary restore-m-btn">${escapeHtml(t('memberRestore'))}</button>
        </div>
      </div>
    `;
    observeThumb(row.querySelector('img.lazy-thumb'));
    const openMemberSnap = () => {
      openLightbox(
        {
          id: m.id,
          title: m.title,
          url: m.url,
          hasSnap: m.hasSnap,
          hasThumb: m.hasThumb,
        },
        { groupId: group.id }
      );
    };
    row.querySelector('.snap-btn').addEventListener('click', openMemberSnap);
    row.querySelector('.member-thumb').addEventListener('click', openMemberSnap);
    row.querySelector('.edit-m-btn').addEventListener('click', () => {
      openMemberEditBox(group.id, m);
    });
    row.querySelector('.restore-m-btn').addEventListener('click', async () => {
      await restoreMember(group.id, m.id);
      const g = allTabs.find((x) => x.id === group.id);
      if (!g) closeMembersBox();
      else renderMembersList(g);
    });
    membersList.appendChild(row);
  });
}

function openMembersBox(group) {
  closeAllFloatsExcept('members');
  membersGroupId = group.id;
  const color = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
  membersTitle.innerHTML = `<span class="color-dot" style="background:${color};display:inline-block;margin-right:6px;vertical-align:middle"></span>${escapeHtml(itemTitle(group))} · ${escapeHtml(t('groupTabs', { n: (group.tabs || []).length }))}`;
  renderMembersList(group);
  membersBox.classList.add('open');
  membersBox.setAttribute('aria-hidden', 'false');
  placeMembersBoxCentered();
  syncFloatBackdrop();
}

function closeMembersBox() {
  membersGroupId = null;
  membersBox.classList.remove('open');
  membersBox.setAttribute('aria-hidden', 'true');
  membersList.innerHTML = '';
  syncFloatBackdrop();
}

membersCloseX.addEventListener('click', closeMembersBox);

membersRestoreAll.addEventListener('click', async () => {
  if (!membersGroupId) return;
  const id = membersGroupId;
  closeMembersBox();
  await restoreItem(id);
});

membersDelete.addEventListener('click', async () => {
  if (!membersGroupId) return;
  const id = membersGroupId;
  closeMembersBox();
  await deleteItem(id);
});

(function setupMembersDrag() {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  membersDrag.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = membersBox.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    membersDrag.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  membersDrag.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    membersBox.style.left = `${Math.min(window.innerWidth - membersBox.offsetWidth - 8, Math.max(8, origLeft + e.clientX - startX))}px`;
    membersBox.style.top = `${Math.min(window.innerHeight - 40, Math.max(8, origTop + e.clientY - startY))}px`;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      membersDrag.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };
  membersDrag.addEventListener('pointerup', end);
  membersDrag.addEventListener('pointercancel', end);
})();

(function setupEditDrag() {
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
    editBox.style.left = `${Math.min(window.innerWidth - editBox.offsetWidth - 8, Math.max(8, origLeft + dx))}px`;
    editBox.style.top = `${Math.min(window.innerHeight - 40, Math.max(8, origTop + dy))}px`;
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      editDrag.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };
  editDrag.addEventListener('pointerup', end);
  editDrag.addEventListener('pointercancel', end);
})();

// ─── Actions ───────────────────────────────────────────────────────

async function restoreItem(id) {
  const item = allTabs.find((t) => t.id === id);
  const type = item?.kind === 'group' ? 'RESTORE_GROUP' : 'RESTORE_TAB';
  const res = await sendMessage({ type, id });
  if (res.ok) {
    allTabs = allTabs.filter((t) => t.id !== id);
    if (expandedId === id) closeLightbox();
    if (editingId === id) closeEditBox();
    renderGrid();
  }
}

async function restoreMember(groupId, memberId) {
  const res = await sendMessage({
    type: 'RESTORE_GROUP_MEMBER',
    groupId,
    memberId,
  });
  if (res.ok) {
    await loadList();
  }
}

async function deleteItem(id) {
  const res = await sendMessage({ type: 'DELETE_ITEM', id });
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

// ─── Card drag with push ───────────────────────────────────────────

function flipCards(beforeMap) {
  const cards = [...gridEl.querySelectorAll('.card:not(.dragging)')];
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

function snapshotCardRects() {
  const map = new Map();
  gridEl.querySelectorAll('.card:not(.dragging)').forEach((card) => {
    map.set(card, card.getBoundingClientRect());
  });
  return map;
}

function beginCardDrag(state, e) {
  const { card } = state;
  const rect = card.getBoundingClientRect();
  state.active = true;
  state.offsetX = e.clientX - rect.left;
  state.offsetY = e.clientY - rect.top;

  const placeholder = document.createElement('div');
  placeholder.className = 'card-placeholder';
  placeholder.style.height = `${rect.height}px`;
  card.parentElement.insertBefore(placeholder, card);
  state.placeholder = placeholder;

  gridEl.classList.add('is-dragging');
  card.classList.add('dragging');
  card.style.position = 'fixed';
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  card.style.zIndex = '80';
  card.style.margin = '0';
}

function onCardPointerMove(e) {
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;

  if (!dragState.active) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    beginCardDrag(dragState, e);
  }

  const { card, offsetX, offsetY, placeholder } = dragState;
  card.style.left = `${e.clientX - offsetX}px`;
  card.style.top = `${e.clientY - offsetY}px`;

  const before = snapshotCardRects();
  const siblings = [...gridEl.children].filter((el) => el !== card);
  let insertBefore = null;
  for (const el of siblings) {
    if (el === placeholder) continue;
    const rect = el.getBoundingClientRect();
    const cy = rect.top + rect.height / 2;
    const cx = rect.left + rect.width / 2;
    if (e.clientY < cy || (Math.abs(e.clientY - cy) < rect.height / 2 && e.clientX < cx)) {
      insertBefore = el;
      break;
    }
  }

  const currentNext = placeholder.nextElementSibling;
  const target = insertBefore;
  if (target === placeholder) return;
  // Avoid no-op moves
  if (target == null) {
    if (placeholder.parentElement && placeholder !== gridEl.lastElementChild) {
      gridEl.appendChild(placeholder);
      flipCards(before);
    }
  } else if (currentNext !== target) {
    gridEl.insertBefore(placeholder, target);
    flipCards(before);
  }
}

async function endCardDrag(e) {
  if (!dragState) return;
  const state = dragState;
  dragState = null;

  try {
    state.card.releasePointerCapture(e.pointerId);
  } catch {
    // ignore
  }

  if (!state.active) {
    if (state.allowClickRestore && !selectMode) restoreItem(state.id);
    return;
  }

  const { card, placeholder } = state;
  card.classList.remove('dragging');
  gridEl.classList.remove('is-dragging');
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

  const ids = [...gridEl.querySelectorAll('.card')].map((el) => el.dataset.id).filter(Boolean);

  let newAll;
  if (query) {
    const idSet = new Set(ids);
    const rest = allTabs.filter((t) => !idSet.has(t.id));
    const ordered = ids.map((i) => allTabs.find((t) => t.id === i)).filter(Boolean);
    newAll = [...ordered, ...rest];
  } else {
    newAll = ids.map((i) => allTabs.find((t) => t.id === i)).filter(Boolean);
    const have = new Set(newAll.map((t) => t.id));
    for (const t of allTabs) {
      if (!have.has(t.id)) newAll.push(t);
    }
  }

  allTabs = newAll;
  await saveSettings({ sortBy: 'manual' });
  sortByEl.value = 'manual';

  const res = await sendMessage({
    type: 'REORDER_ITEMS',
    ids: allTabs.map((t) => t.id),
  });
  if (res.ok && Array.isArray(res.items)) allTabs = res.items;
  renderGrid();
}

function attachCardDrag(card, item) {
  card.addEventListener('pointerdown', (e) => {
    if (selectMode) return;
    if (settings.viewMode === 'list') return;
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.card-actions, .delete-btn, .expand-btn, .edit-btn, .card-check')) return;

    dragState = {
      card,
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: 0,
      offsetY: 0,
      placeholder: null,
      active: false,
      allowClickRestore: Boolean(e.target.closest('.restore-hit, .thumb-wrap, .thumb')),
    };
    try {
      card.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  });
}

document.addEventListener('pointermove', onCardPointerMove);
document.addEventListener('pointerup', (e) => {
  if (dragState) endCardDrag(e).catch(() => {});
});
document.addEventListener('pointercancel', (e) => {
  if (dragState) endCardDrag(e).catch(() => {});
});

// ─── Cards / List ──────────────────────────────────────────────────

function groupCoverHtml(item) {
  const members = (item.tabs || []).filter((m) => m.hasThumb || m.thumbnail).slice(0, 4);
  if (members.length === 0) {
    // still try first few for keys even without hasThumb flag (migration)
    const any = (item.tabs || []).slice(0, 4);
    if (!any.length) return `<div class="group-cover empty-cover"></div>`;
    if (any.length === 1) {
      return `<img class="thumb lazy-thumb" alt="" draggable="false" data-media-key="${escapeAttr(mediaKeyForMember(item.id, any[0].id))}" />`;
    }
    return `<div class="group-mosaic mosaic-${Math.min(any.length, 4)}">${any
      .map(
        (m) =>
          `<img class="lazy-thumb" alt="" draggable="false" data-media-key="${escapeAttr(mediaKeyForMember(item.id, m.id))}" />`
      )
      .join('')}</div>`;
  }
  if (members.length === 1) {
    return `<img class="thumb lazy-thumb" alt="" draggable="false" data-media-key="${escapeAttr(mediaKeyForMember(item.id, members[0].id))}" />`;
  }
  return `<div class="group-mosaic mosaic-${Math.min(members.length, 4)}">${members
    .map(
      (m) =>
        `<img class="lazy-thumb" alt="" draggable="false" data-media-key="${escapeAttr(mediaKeyForMember(item.id, m.id))}" />`
    )
    .join('')}</div>`;
}

function createGroupCard(item) {
  const card = document.createElement('article');
  card.className = 'card group-card';
  card.dataset.id = item.id;
  card.dataset.kind = 'group';
  card.setAttribute('role', 'listitem');

  const title = itemTitle(item);
  const n = (item.tabs || []).length;
  const color = GROUP_COLORS[item.color] || GROUP_COLORS.grey;
  const note = item.note || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];

  const selected = selectedIds.has(item.id);
  if (selected) card.classList.add('selected');

  card.innerHTML = `
    <input type="checkbox" class="card-check" ${selected ? 'checked' : ''} aria-label="select" />
    <div class="group-color-bar" style="background:${color}"></div>
    <div class="thumb-wrap">
      ${groupCoverHtml(item)}
      <div class="card-actions">
        <button type="button" class="icon-btn lg edit-btn" title="${escapeAttr(t('edit'))}">✎</button>
        <button type="button" class="icon-btn lg members-btn" title="${escapeAttr(t('expandGroup'))}">▦</button>
      </div>
      <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="${escapeAttr(t('delete'))}">×</button>
      <span class="group-badge">${escapeHtml(t('groupTabs', { n }))}</span>
    </div>
    <div class="meta">
      <div class="title-row restore-hit">
        <span class="color-dot" style="background:${color}"></span>
        <div class="title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
      </div>
      <div class="url restore-hit">${escapeHtml(t('groupTabs', { n }))}</div>
      ${note ? `<div class="note-preview">${escapeHtml(note)}</div>` : ''}
      ${
        tags.length
          ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
          : ''
      }
    </div>
  `;

  card.querySelectorAll('img.lazy-thumb').forEach((img) => observeThumb(img));

  card.querySelector('.card-check').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelect(item.id);
  });

  card.querySelectorAll('.restore-hit, .thumb-wrap').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions, .delete-btn, .members-btn, .card-check')) return;
      if (dragState?.active) return;
      if (selectMode) {
        toggleSelect(item.id);
        return;
      }
      restoreItem(item.id);
    });
  });

  card.querySelector('.members-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openMembersBox(item);
  });

  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditBox(item);
  });
  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteItem(item.id);
  });
  attachCardDrag(card, item);
  return card;
}

function createCard(item) {
  if (item.kind === 'group') return createGroupCard(item);

  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = item.id;
  card.dataset.kind = 'tab';
  card.setAttribute('role', 'listitem');

  const title = item.title || item.url || 'Untitled';
  const url = item.url || '';
  const mediaKey = mediaKeyForItem(item);
  const fav = item.favIconUrl || '';
  const note = item.note || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];

  if (selectedIds.has(item.id)) card.classList.add('selected');

  card.innerHTML = `
    <input type="checkbox" class="card-check" ${selectedIds.has(item.id) ? 'checked' : ''} aria-label="select" />
    <div class="thumb-wrap">
      <img class="thumb lazy-thumb" alt="" draggable="false" loading="lazy" decoding="async" data-media-key="${escapeAttr(mediaKey)}" />
      <div class="card-actions">
        <button type="button" class="icon-btn lg edit-btn" title="${escapeAttr(t('edit'))}" aria-label="${escapeAttr(t('edit'))}">✎</button>
        <button type="button" class="icon-btn lg expand-btn" title="${escapeAttr(t('expand'))}" aria-label="${escapeAttr(t('expand'))}">⤢</button>
      </div>
      <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">×</button>
    </div>
    <div class="meta">
      <div class="title-row restore-hit">
        ${
          fav
            ? `<img class="favicon" alt="" draggable="false" src="${escapeAttr(fav)}" />`
            : `<span class="favicon-fallback" aria-hidden="true"></span>`
        }
        <div class="title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
      </div>
      <div class="url restore-hit" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
      ${note ? `<div class="note-preview" title="${escapeAttr(note)}">${escapeHtml(note)}</div>` : ''}
      ${
        tags.length
          ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
          : ''
      }
    </div>
  `;

  wireFavicon(card);
  observeThumb(card.querySelector('img.lazy-thumb'));
  card.querySelector('.card-check').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelect(item.id);
  });
  card.querySelector('.expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectMode) return;
    openLightbox(item);
  });
  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectMode) return;
    openEditBox(item);
  });
  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectMode) return;
    deleteItem(item.id);
  });
  // click card body to restore or select
  card.querySelectorAll('.restore-hit, .thumb-wrap').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions, .delete-btn, .expand-btn, .edit-btn, .card-check')) return;
      if (dragState?.active) return;
      if (selectMode) {
        toggleSelect(item.id);
        return;
      }
      // thumb click without drag ends in endCardDrag restore
    });
  });
  attachCardDrag(card, item);
  return card;
}

function createRow(item) {
  const row = document.createElement('article');
  row.className = 'row' + (item.kind === 'group' ? ' group-row' : '');
  row.dataset.id = item.id;
  row.setAttribute('role', 'listitem');

  const isGroup = item.kind === 'group';
  const title = itemTitle(item);
  const url = isGroup ? t('groupTabs', { n: (item.tabs || []).length }) : item.url || '';
  const mediaKey = isGroup
    ? (() => {
        const m = (item.tabs || []).find((x) => x.hasThumb || x.id) || (item.tabs || [])[0];
        return m ? mediaKeyForMember(item.id, m.id) : '';
      })()
    : mediaKeyForItem(item);
  const note = item.note || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const color = isGroup ? GROUP_COLORS[item.color] || GROUP_COLORS.grey : null;

  row.innerHTML = `
    <img class="row-thumb lazy-thumb" alt="" draggable="false" loading="lazy" decoding="async" data-media-key="${escapeAttr(mediaKey)}" title="${escapeAttr(t('restore'))}" />
    <div class="row-main">
      <div class="title restore-hit" title="${escapeAttr(title)}">
        ${color ? `<span class="color-dot" style="background:${color};display:inline-block;margin-right:6px;vertical-align:middle"></span>` : ''}
        ${escapeHtml(title)}
      </div>
      <div class="url restore-hit" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
    </div>
    <div class="row-note" title="${escapeAttr(note)}">${note ? escapeHtml(note) : '—'}</div>
    <div class="row-tags">
      ${
        tags.length
          ? tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')
          : '<span class="note-preview">—</span>'
      }
    </div>
    <div class="row-actions">
      <button type="button" class="icon-btn edit-btn" title="${escapeAttr(t('edit'))}">✎</button>
      ${
        isGroup
          ? ''
          : `<button type="button" class="icon-btn expand-btn" title="${escapeAttr(t('expand'))}">⤢</button>`
      }
      <button type="button" class="icon-btn danger delete-btn" title="${escapeAttr(t('delete'))}">×</button>
    </div>
  `;

  observeThumb(row.querySelector('img.lazy-thumb'));
  row.querySelector('.row-thumb').addEventListener('click', () => {
    if (selectMode) toggleSelect(item.id);
    else restoreItem(item.id);
  });
  row.querySelectorAll('.restore-hit').forEach((el) => {
    el.addEventListener('click', () => {
      if (selectMode) toggleSelect(item.id);
      else restoreItem(item.id);
    });
  });
  if (selectedIds.has(item.id)) row.classList.add('selected');
  const expandBtn = row.querySelector('.expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => openLightbox(item));
  }
  row.querySelector('.edit-btn').addEventListener('click', () => openEditBox(item));
  row.querySelector('.delete-btn').addEventListener('click', () => deleteItem(item.id));
  return row;
}

function renderEmpty(message) {
  gridEl.innerHTML = `
    <div class="empty" style="grid-column: 1 / -1">
      <strong>${escapeHtml(message.title)}</strong>
      ${message.body}
    </div>
  `;
}

function renderGrid() {
  const filtered = getVisibleTabs();
  updateSavedBadge();

  if (allTabs.length === 0) {
    renderEmpty({ title: t('emptyTitle'), body: t('emptyBody') });
    return;
  }
  if (filtered.length === 0) {
    renderEmpty({ title: t('noResultsTitle'), body: t('noResultsBody') });
    return;
  }

  gridEl.innerHTML = '';
  applyCardCols(settings.cardCols);
  const frag = document.createDocumentFragment();
  const isList = settings.viewMode === 'list';
  filtered.forEach((item) => {
    frag.appendChild(isList ? createRow(item) : createCard(item));
  });
  gridEl.appendChild(frag);
}

let loadListTimer = null;

async function loadList() {
  const res = await sendMessage({ type: 'GET_PARKED_ITEMS' });
  const raw =
    res.ok && Array.isArray(res.items)
      ? res.items
      : res.ok && Array.isArray(res.tabs)
        ? res.tabs
        : [];
  allTabs = raw.map((item) => {
    if (item.kind === 'group' || Array.isArray(item.tabs)) {
      return {
        ...item,
        kind: 'group',
        note: typeof item.note === 'string' ? item.note : '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        tabs: Array.isArray(item.tabs) ? item.tabs : [],
      };
    }
    return {
      ...item,
      kind: 'tab',
      note: typeof item.note === 'string' ? item.note : '',
      tags: Array.isArray(item.tags) ? item.tags : [],
    };
  });
  renderGrid();
}

function scheduleLoadList() {
  if (loadListTimer) clearTimeout(loadListTimer);
  loadListTimer = setTimeout(() => {
    loadListTimer = null;
    loadList();
  }, 150);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.parkedTabs || changes.parkedItems) scheduleLoadList();
  if (changes.settings) {
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    settings.cardCols = clampCols(settings.cardCols);
    syncSettingsUi();
    renderGrid();
  }
});

initSettingsUi().then(() => {
  if (Media?.openDb) Media.openDb().catch(() => {});
  loadList();
  try {
    window.focus();
  } catch {
    // ignore
  }
});
