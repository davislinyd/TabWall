/**
 * TabWall — Spatial canvas UI
 */

const SETTINGS_KEY = 'settings';
const CANVAS_LAYOUT_VERSION = 1;
const DEFAULT_CANVAS_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1 });
const CANVAS_NODE_CLICK_DELAY = 300;

const DEFAULT_AUTO_BACKUP = {
  enabled: false,
  mode: 'lite',
  onChange: true,
  intervalUnit: 'hour',
  intervalValue: 24,
  maxKeep: 5,
  subfolder: 'TabWall-Backups',
  folderPath: '',
  lastSuccessAt: 0,
  lastError: '',
  dirtyAt: 0,
};

const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  saveGroupCapture: 'all',
  restoreGroupIn: 'currentWindow',
  viewMode: 'canvas',
  sortBy: 'newest',
  theme: 'dark',
  cardCols: 4,
  locale: 'zh',
  defaultViewMode: 'canvas',
  openWithSearchFocus: false,
  searchRegex: false,
  autoBackup: { ...DEFAULT_AUTO_BACKUP },
  canvasSnap: true,
};

const Build = self.TabWallBackupBuild;
const CanvasStoreApi = self.TabWallCanvasStore;

function classifyStoredUrl(url) {
  if (Build?.classifyUrl) return Build.classifyUrl(url, { allowStoredOnly: true });
  if (/^https?:\/\//i.test(String(url || ''))) return 'restorable';
  if (/^file:/i.test(String(url || ''))) return 'stored_only';
  return 'invalid';
}

function isStoredOnlyUrl(url) {
  return classifyStoredUrl(url) === 'stored_only';
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

function formatImportWarnings(warnings) {
  const parts = [];
  if (warnings?.legacyVersion) {
    parts.push(t('backupLegacyNotice', { version: warnings.legacyVersion }));
  }
  if (warnings?.normalizedGroupColors) {
    parts.push(t('backupColorNotice', { n: warnings.normalizedGroupColors }));
  }
  if (warnings?.droppedFavicons) {
    parts.push(t('backupFaviconNotice', { n: warnings.droppedFavicons }));
  }
  if (warnings?.storedOnlyUrls) {
    parts.push(t('backupStoredOnly', { n: warnings.storedOnlyUrls }));
  }
  return parts.join(' ');
}

function formatBackupError(error) {
  const code = typeof error === 'string' ? error : error?.error || 'invalid_backup';
  const detail = error && typeof error === 'object' && error.detail ? ` (${error.detail})` : '';
  return t('backupInvalidDetail', { error: `${code}${detail}` });
}

function getParentOrigin() {
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

const PARENT_ORIGIN = getParentOrigin();

function postToParent(payload) {
  if (!PARENT_ORIGIN || !window.parent || window.parent === window) return false;
  try {
    window.parent.postMessage(payload, PARENT_ORIGIN);
    return true;
  } catch {
    return false;
  }
}

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
const MAX_SEARCH_REGEX_LENGTH = 512;
const Media = self.TabWallMediaDB;

/** @type {Set<string>} */
const liveObjectUrls = new Set();
const pendingObjectUrlRevokes = new Set();
/** @type {Map<string, string>} snap dataUrl/blob url cache */
const snapCache = new Map();
const SNAP_CACHE_MAX = 12;

function trackObjectUrl(url) {
  if (url && String(url).startsWith('blob:')) liveObjectUrls.add(url);
  return url;
}

function revokeObjectUrl(url) {
  if (url && String(url).startsWith('blob:') && liveObjectUrls.has(url)) {
    const inUse = [...document.images].some((img) => img.isConnected && img.src === url);
    if (inUse) {
      pendingObjectUrlRevokes.add(url);
      setTimeout(() => {
        if (!pendingObjectUrlRevokes.has(url)) return;
        pendingObjectUrlRevokes.delete(url);
        revokeObjectUrl(url);
      }, 1000);
      return;
    }
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
    const first = [...snapCache.keys()].find((candidate) => {
      const cached = snapCache.get(candidate);
      return ![...document.images].some((img) => img.isConnected && img.src === cached);
    });
    if (first == null) break;
    revokeObjectUrl(snapCache.get(first));
    snapCache.delete(first);
  }
}

/** Reuse thumb blob URLs across re-renders (search typing). */
const THUMB_URL_CACHE_MAX = 100;
/** @type {Map<string, string>} */
const thumbUrlCache = new Map();

function cacheThumbUrl(key, url) {
  if (!key || !url) return url;
  if (thumbUrlCache.has(key)) {
    const old = thumbUrlCache.get(key);
    if (old !== url) revokeObjectUrl(old);
    thumbUrlCache.delete(key);
  }
  thumbUrlCache.set(key, url);
  while (thumbUrlCache.size > THUMB_URL_CACHE_MAX) {
    const first = [...thumbUrlCache.keys()].find((candidate) => {
      const cached = thumbUrlCache.get(candidate);
      return ![...document.images].some((img) => img.isConnected && img.src === cached);
    });
    if (first == null) break;
    revokeObjectUrl(thumbUrlCache.get(first));
    thumbUrlCache.delete(first);
  }
  return url;
}

async function fetchMediaUrl(key, kind) {
  if (!key) return '';
  if (kind === 'thumb' && thumbUrlCache.has(key)) {
    return thumbUrlCache.get(key) || '';
  }
  if (kind === 'snap' && snapCache.has(key)) {
    return snapCache.get(key) || '';
  }
  if (!Media) {
    const res = await sendMessage({ type: 'GET_MEDIA', key, kind });
    const url = res.ok ? res.dataUrl || '' : '';
    if (kind === 'thumb' && url) cacheThumbUrl(key, url);
    if (kind === 'snap' && url) cacheSnap(key, url);
    return url;
  }
  try {
    const blob = await Media.getPart(key, kind === 'snap' ? 'snap' : 'thumb');
    if (!blob) return '';
    const url = trackObjectUrl(URL.createObjectURL(blob));
    if (kind === 'thumb') cacheThumbUrl(key, url);
    if (kind === 'snap') cacheSnap(key, url);
    return url;
  } catch {
    const res = await sendMessage({ type: 'GET_MEDIA', key, kind });
    const url = res.ok ? res.dataUrl || '' : '';
    if (kind === 'thumb' && url) cacheThumbUrl(key, url);
    if (kind === 'snap' && url) cacheSnap(key, url);
    return url;
  }
}

/** True lazy-load via IntersectionObserver + thumb cache. */
let thumbObserver = null;

function getThumbObserver() {
  if (thumbObserver) return thumbObserver;
  if (typeof IntersectionObserver === 'undefined') return null;
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        thumbObserver.unobserve(img);
        if (img.dataset.canvasMedia === 'true') loadCanvasMediaInto(img);
        else loadThumbInto(img);
      }
    },
    { root: null, rootMargin: '240px 0px', threshold: 0.01 }
  );
  return thumbObserver;
}

function loadThumbInto(img) {
  if (!img) return;
  const key = img.dataset.mediaKey;
  if (!key || img.dataset.loaded === '1') return;
  img.dataset.loaded = '1';
  if (thumbUrlCache.has(key)) {
    img.src = thumbUrlCache.get(key);
    return;
  }
  fetchMediaUrl(key, 'thumb').then((url) => {
    if (url && img.isConnected) img.src = url;
  });
}

function canvasPreferredMediaKind() {
  return canvasLayout.viewport.zoom > 1 ? 'snap' : 'thumb';
}

function loadCanvasMediaInto(img) {
  if (!img) return;
  const key = img.dataset.mediaKey;
  if (!key) return;
  const preferred = canvasPreferredMediaKind();
  const fallback = preferred === 'snap' ? 'thumb' : 'snap';
  const token = String((Number(img.dataset.canvasLoadToken) || 0) + 1);
  img.dataset.canvasLoadToken = token;
  img.dataset.canvasLoadingKind = preferred;
  (async () => {
    let loadedKind = preferred;
    let url = await fetchMediaUrl(key, preferred);
    if (!url) {
      loadedKind = fallback;
      url = await fetchMediaUrl(key, fallback);
    }
    if (img.dataset.canvasLoadToken !== token) return;
    if (!url) {
      delete img.dataset.canvasLoadingKind;
      return;
    }
    if (!img.isConnected) return;
    img.src = url;
    img.dataset.canvasLoadedKind = loadedKind;
    delete img.dataset.canvasLoadingKind;
  })().catch(() => {
    if (img.dataset.canvasLoadToken === token) delete img.dataset.canvasLoadingKind;
  });
}

function observeCanvasMedia(img) {
  if (!img) return;
  const key = img.dataset.mediaKey;
  if (!key) return;
  const preferred = canvasPreferredMediaKind();
  if (
    img.dataset.canvasLoadedKind === preferred ||
    img.dataset.canvasLoadingKind === preferred
  ) {
    return;
  }
  const obs = getThumbObserver();
  if (!obs) {
    loadCanvasMediaInto(img);
    return;
  }
  obs.unobserve(img);
  obs.observe(img);
}

function refreshCanvasMediaQuality() {
  canvasNodesEl?.querySelectorAll('img[data-canvas-media="true"]').forEach(observeCanvasMedia);
}

function observeThumb(img) {
  if (!img) return;
  const key = img.dataset.mediaKey;
  if (!key || img.dataset.loaded === '1') return;
  // Cache hit: paint immediately (no flash on search re-render)
  if (thumbUrlCache.has(key)) {
    img.dataset.loaded = '1';
    img.src = thumbUrlCache.get(key);
    return;
  }
  const obs = getThumbObserver();
  if (!obs) {
    loadThumbInto(img);
    return;
  }
  obs.observe(img);
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
    quickAddTab: '儲存目前分頁',
    quickAddGroup: '儲存目前 Group',
    quickAddUrl: '貼上 URL',
    quickAddMenuTitle: '新增選項',
    quickAddSaved: '已送出存檔',
    quickAddGroupSaved: '已送出 Group 存檔',
    quickAddNoTarget: '目前沒有可存檔的分頁',
    quickAddNoGroup: '目前分頁不在 Group 中',
    quickAddRestricted: '此頁面受 Chrome 限制，無法直接存檔',
    quickAddSelf: '目前已是 TabWall，請貼上 URL 或使用 Chrome 快捷鍵存檔',
    quickAddFailed: '存檔失敗：{error}',
    pinnedOnly: '已固定',
    pin: '固定項目',
    unpin: '取消固定',
    pinnedOn: '已固定項目',
    pinnedOff: '已取消固定',
    pinFailed: '固定狀態儲存失敗',
    tagApplyFilter: '套用此 tag 篩選',
    moreTools: '更多工具',
    savedAt: '儲存於 {time}',
    settingsGeneral: '一般',
    settingsDisplay: '顯示',
    settingsTools: '整理',
    settingsBackup: '備份',
    settingsShortcuts: '快捷鍵',
    settingsDiagnostic: '診斷',
    settingsAutoSaved: '已自動儲存',
    done: '完成',
    loadFailed: '資料讀取失敗，已保留目前畫面。',
    searchPh: '搜尋…  空格/&& 且、|| 或（不分大小寫）',
    searchRegexPh: '正規表示式（預設 i；或 /pattern/flags）',
    searchRegexTitle: '正規表示式搜尋',
    searchPhTag: '搜尋 tag…',
    searchPhNote: '搜尋 note…',
    searchPhGroup: '搜尋群組名稱或成員…',
    searchPhTagRegex: 'Regex 搜尋 tag…',
    searchPhNoteRegex: 'Regex 搜尋 note…',
    searchPhGroupRegex: '群組／成員正規表示式…',
    searchScopeClear: '清除欄位模式（或 all + Tab）',
    helpShortcutRegex: '切換正規表示式搜尋（支援 /pattern/flags）',
    helpShortcutSearchMode:
      '搜尋框輸入 t/tag、n/note、g/group、re/regex 後按 Tab 進入模式；all + Tab 回到全搜',
    searchHitsCount: '命中 {n} 個分頁',
    searchHitGroupMeta: '符合 group 名稱／note／tags',
    searchHitsMore: '還有 {n} 個…',
    stackTitle: 'Stack',
    stackHint: '拖曳卡片到另一張的標題區可組成 Stack，還原為 Tab Group',
    stackMerged: '已合併為 Stack',
    stackFailed: '無法合併',
    canvasNeedTwo: '至少選取兩個項目才能建立 Stack',
    canvasNewStack: '新 Stack',
    canvasStackHint: '為選取的項目命名，之後會以 Tab Group 還原。',
    canvasStackPlaceholder: 'Stack 名稱',
    canvasSnapshot: '快照',
    canvasNodeHint: '單擊預覽快照；雙擊還原；按住拖曳移動',
    canvasArrange: '整理畫布',
    canvasArrangeStack: '依 Stack',
    canvasArrangeDate: '依日期',
    canvasArrangeGrid: '棋盤排列',
    canvasArrangeCircle: '圓形排列',
    canvasArrangeManual: '手動',
    canvasSnap: '吸附格線',
    canvasResetView: '重設視角',
    canvasDropStack: '拖曳到這裡建立 Stack',
    canvasSelect: '選取',
    canvasPan: '平移',
    canvasArea: '框選區域',
    canvasLink: '連結',
    settingsCanvas: '畫布',
    canvasSettingsTitle: '畫布設定',
    canvasSettingsHint: '調整畫布的操作方式；位置與視角會自動儲存。',
    canvasOpen: '開啟',
    canvasMoveToStack: '移至 Stack',
    canvasCreateStack: '建立 Stack',
    canvasView: '畫布',
    cards: '卡片',
    list: '列表',
    sort: '排序',
    sortNewest: '儲存時間（新→舊）',
    sortOldest: '儲存時間（舊→新）',
    sortGroupFirst: 'Group 優先',
    sortTitle: '名稱 A→Z',
    sortTitleDesc: '名稱 Z→A',
    sortDomain: '網域 A→Z',
    sortManual: '手動排列',
    copied: '已複製連結',
    copyFailed: '複製失敗',
    copyLink: '複製連結',
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
    importBackup: '還原（覆蓋）',
    importAppend: '匯入（附加）',
    backupExported: '已匯出備份',
    backupExporting: '匯出中…',
    backupImporting: '匯入中…',
    backupImported: '已還原備份',
    backupAppended: '已附加 {n} 項',
    backupConfirm: '還原將覆寫目前所有 TabWall 資料，確定？',
    backupAppendConfirm: '將附加備份中的項目到現有清單（不刪除現有卡片），確定？',
    backupInvalid: '備份檔無效',
    backupInvalidDetail: '備份無法匯入：{error}',
    backupLegacyNotice: '已相容匯入舊版 v{version} 備份。',
    backupColorNotice: '已將 {n} 個舊版群組色轉換為目前格式。',
    backupFaviconNotice: '略過 {n} 個超出限制或格式無效的 favicon。',
    backupStoredOnly: '保留 {n} 個 file URL；這些項目不可直接還原。',
    backupError: '操作失敗',
    backupHint: '精簡不含截圖（檔案小）；完整 ZIP 含圖片二進位。覆蓋會取代全部資料；附加只新增。',
    diagLogTitle: '診斷日誌',
    diagLogHint: '匯出／匯入／自動備份等事件。可複製給除錯用。',
    diagLogRefresh: '重新整理',
    diagLogCopy: '複製',
    diagLogClear: '清除',
    diagLogEmpty: '尚無日誌',
    diagLogCopied: '已複製',
    manualAddTitle: '手動新增卡片',
    manualAddHint: '每行一個 URL。用 #GROUP:名稱 上下包住多行可建成群組。',
    manualAddPh:
      'https://example.com/a\nhttps://example.com/b\n\n#GROUP:工作\nhttps://jira.example.com\nhttps://wiki.example.com\n#GROUP:工作',
    manualAddSubmit: '新增卡片',
    manualAddOk: '已新增 {n} 項',
    manualAddEmpty: '沒有可新增的 URL',
    manualAddSkipped: '（略過 {n} 行）',
    autoBackupTitle: '自動備份',
    autoBackupHint:
      '寫入「瀏覽器設定的下載位置」下的子資料夾（不一定是 Downloads；可在 chrome://settings/downloads 查看）。不上傳。',
    autoBackupEnable: '啟用自動備份',
    autoBackupSubfolder: '下載位置子資料夾',
    autoBackupSubfolderHint: '相對於 Chrome 下載位置，例如 TabWall-Backups',
    autoBackupLocation: '備份位置',
    autoBackupLocationPending: '下載位置 / {subfolder}（成功備份後顯示完整路徑）',
    autoBackupLocationStale: '路徑待更新 — 請按「立即備份」以寫入目前下載位置',
    autoBackupMode: '格式',
    autoBackupModeLite: '精簡 JSON',
    autoBackupModeFull: '完整 ZIP',
    autoBackupOnChange: '資料變更後也備份',
    autoBackupEvery: '每',
    autoBackupUnitMinute: '分鐘',
    autoBackupUnitHour: '小時',
    autoBackupUnitDay: '天',
    autoBackupMaxKeep: '最多保留',
    autoBackupMaxKeepUnit: '份',
    autoBackupNow: '立即備份',
    autoBackupShowFolder: '開啟下載資料夾',
    autoBackupRunning: '備份中…',
    autoBackupOk: '已備份：{file}',
    autoBackupLastOk: '上次成功：{time}',
    autoBackupErrWrite: '寫入失敗',
    autoBackupErrExport: '匯出失敗',
    autoBackupErrDisabled: '請先啟用自動備份，或使用立即備份',
    selectMode: '選擇',
    selectModeOn: '選擇中',
    batchRestore: '還原',
    batchEdit: 'Note / Tags',
    batchExportLite: '匯出精簡',
    batchExportFull: '匯出完整',
    batchDelete: '刪除',
    batchClear: '取消',
    batchCount: '已選 {n}',
    batchExportEmpty: '請先選擇卡片',
    importPickTitle: '選擇要還原的項目',
    importPickHint: '勾選要寫入的 tab／group。預設全選。可點「預覽」查看縮圖／成員。',
    importPickAll: '全選',
    importPickNone: '全不選',
    importPickConfirm: '確認還原',
    importPickCount: '已選 {n} / {total}',
    importPickEmpty: '請至少選擇一項',
    importPickModeReplace: '模式：覆蓋現有資料',
    importPickModeAppend: '模式：附加到現有資料',
    importPickPreview: '預覽',
    importPreviewNoImage: '此項目無縮圖／快照（精簡備份僅含文字）',
    importPreviewGroupEmpty: '此 group 無成員',
    batchDeleteConfirm: '刪除選取的 {n} 項？',
    batchEditHeading: '批次編輯 Note / Tags',
    batchEditSub: 'Note 非空則覆寫；Tags 預設合併到各項目',
    editFailed: '儲存失敗',
    help: '說明',
    helpTitle: '說明',
    helpShortcutsTitle: '快捷鍵',
    helpShortcutSave: '儲存目前分頁（截圖）',
    helpShortcutGroup: '儲存目前 Tab Group',
    helpShortcutWall: '開關 TabWall 空間畫布',
    helpShortcutChrome: '儲存分頁、儲存 Tab Group 與開關空間畫布的快捷鍵由 Chrome 管理，請在 Chrome 設定頁設定。',
    helpShortcutSearch: '聚焦搜尋',
    helpShortcutSettings: '開啟／關閉設定（⌥⌘S）',
    helpShortcutEsc: '關閉浮層／空間畫布',
    helpShortcutArrows: '快照上一張／下一張',
    shortcutsTitle: 'Chrome 快捷鍵',
    shortcutsHint:
      '快捷鍵由 Chrome 管理。安裝時會採用 manifest 預設值；若要設定或修改，請在 Chrome 設定頁操作。',
    shortcutsOpenChrome: '在 Chrome 設定管理快捷鍵',
    shortcutsChromeOpened: '已開啟 Chrome 快捷鍵設定頁。請在 Chrome 中設定或修改。',
    shortcutsChromeOpenFailed: '無法開啟 Chrome 快捷鍵設定頁。',
    shortcutsChromeBound: 'Chrome 快捷鍵：{s}',
    shortcutsChromeUnbound: 'Chrome 快捷鍵：未綁定',
    dedupeTitle: '偵測到重複 URL',
    dedupeConflictHint: '牆內已有相同完整 URL 的分頁。請選擇如何處置。',
    dedupeExisting: '既有項目',
    dedupeKeepBoth: '保留兩者',
    dedupeReplace: '取代舊項',
    dedupeCancel: '取消',
    dedupeScanTitle: '去重複',
    dedupeScanHint: '掃描已存分頁中 URL 完全相同的項目，由你決定保留哪些。',
    dedupeScan: '掃描重複',
    dedupeNoDupes: '未發現重複',
    dedupeKeepNewest: '只留最新',
    dedupeKeepOldest: '只留最舊',
    dedupeKeepAll: '全部保留',
    dedupeApply: '套用',
    dedupeApplyOk: '已刪除 {n} 筆重複',
    dedupeApplyNone: '沒有需要刪除的項目',
    dedupeCount: '{n} 筆',
    dedupeSavedAt: '儲存於 {t}',
    helpDedupeBody:
      '存分頁時若 URL 已存在會詢問你如何處置。工具列「掃描重複」可掃描整牆並人工保留／刪除。',
    helpBasicTitle: '基本使用',
    helpBasicBody:
      '點縮圖還原、標題複製連結；編輯按鈕管理 note／tags；展開按鈕查看快照；刪除按鈕移除項目。拖曳可重排；拖到另一張卡片標題區稍停可組成 Stack（還原為 Tab Group）。',
    helpGroupTitle: 'Tab Group / Stack',
    helpGroupBody:
      'Alt+Shift+G 存整組；拖曳 tab 疊合亦可建 Stack。成員面板可預覽、編輯、還原單一或整個 group。',
    helpSelectTitle: '複選',
    helpSelectBody: '點「選擇」進入複選，勾選多張卡片後可批次還原、合併 tags、或刪除。',
    helpBackupTitle: '備份',
    helpBackupBody:
      '精簡 JSON 不含截圖；完整 ZIP 含圖片。還原（覆蓋）取代全部；匯入（附加）只新增。可手動貼 URL 建卡；#GROUP:名稱 包住多行可建群組。自動備份寫入下載目錄子資料夾。',
    helpLimitsTitle: '限制',
    helpLimitsBody:
      'chrome:// 等特殊頁無法截圖或注入。TabWall 的存檔不是 Chrome 書籤列內建的 Save group。',
    groupTabs: '{n} 個分頁',
    unnamedGroup: '未命名群組',
    restoreGroup: '還原整個 Group',
    restoreGroupConfirm: '還原群組「{title}」（{n} 個分頁）？',
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
    storedOnly: '不可直接還原',
    storedOnlyShort: 'file',
    restoreRestricted: '此 URL 不支援直接還原，項目已保留。',
    restoreSkipped: '群組已還原，略過 {n} 個不可直接還原的成員。',
    memberSnapshot: '快照',
    memberEdit: 'Note / Tags',
    editMemberHeading: '編輯成員 Note / Tags',
  },
  en: {
    appName: 'TabWall',
    quickAddTab: 'Save current tab',
    quickAddGroup: 'Save current Group',
    quickAddUrl: 'Paste URL',
    quickAddMenuTitle: 'Add options',
    quickAddSaved: 'Save request sent',
    quickAddGroupSaved: 'Group save request sent',
    quickAddNoTarget: 'There is no tab available to save',
    quickAddNoGroup: 'The current tab is not in a Group',
    quickAddRestricted: 'Chrome restricts this page from being saved directly',
    quickAddSelf: 'TabWall is the current page; paste a URL or use a Chrome shortcut',
    quickAddFailed: 'Save failed: {error}',
    pinnedOnly: 'Pinned',
    pin: 'Pin item',
    unpin: 'Unpin item',
    pinnedOn: 'Item pinned',
    pinnedOff: 'Item unpinned',
    pinFailed: 'Could not save pinned state',
    tagApplyFilter: 'Filter by this tag',
    moreTools: 'More tools',
    savedAt: 'Saved {time}',
    settingsGeneral: 'General',
    settingsDisplay: 'Display',
    settingsTools: 'Organize',
    settingsBackup: 'Backup',
    settingsShortcuts: 'Shortcuts',
    settingsDiagnostic: 'Diagnostics',
    settingsAutoSaved: 'Saved automatically',
    done: 'Done',
    loadFailed: 'Data could not be loaded; the current view was kept.',
    searchPh: 'Search…  space/&& AND, || OR (case-insensitive)',
    searchRegexPh: 'Regex (default i; or /pattern/flags)',
    searchRegexTitle: 'Regex search',
    searchPhTag: 'Search tags…',
    searchPhNote: 'Search notes…',
    searchPhGroup: 'Search group name or member tabs…',
    searchPhTagRegex: 'Regex search tags…',
    searchPhNoteRegex: 'Regex search notes…',
    searchPhGroupRegex: 'Group/member regex…',
    searchScopeClear: 'Clear field mode (or all + Tab)',
    helpShortcutRegex: 'Toggle regex search (supports /pattern/flags)',
    helpShortcutSearchMode:
      'In search, type t/tag, n/note, g/group, or re/regex then Tab; all + Tab resets scope',
    searchHitsCount: '{n} matching tab(s)',
    searchHitGroupMeta: 'Matched group title / note / tags',
    searchHitsMore: '+{n} more…',
    stackTitle: 'Stack',
    stackHint: 'Drag a card onto another card’s title area to stack; restore as a Tab Group',
    stackMerged: 'Stacked',
    stackFailed: 'Could not stack',
    canvasNeedTwo: 'Select at least two items to create a Stack',
    canvasNewStack: 'New Stack',
    canvasStackHint: 'Name the selected items; the Stack can be restored as a Tab Group.',
    canvasStackPlaceholder: 'Stack name',
    canvasSnapshot: 'Snapshot',
    canvasNodeHint: 'Click to preview; double-click to restore; drag to move',
    canvasArrange: 'Arrange canvas',
    canvasArrangeStack: 'By Stack',
    canvasArrangeDate: 'By date',
    canvasArrangeGrid: 'Grid',
    canvasArrangeCircle: 'Circle',
    canvasArrangeManual: 'Manual',
    canvasSnap: 'Snap to grid',
    canvasResetView: 'Reset view',
    canvasDropStack: 'Drop here to create a Stack',
    canvasSelect: 'Select',
    canvasPan: 'Pan',
    canvasArea: 'Select area',
    canvasLink: 'Link',
    settingsCanvas: 'Canvas',
    canvasSettingsTitle: 'Canvas settings',
    canvasSettingsHint: 'Adjust canvas behavior; positions and viewport are saved automatically.',
    canvasOpen: 'Open',
    canvasMoveToStack: 'Move to Stack',
    canvasCreateStack: 'Create Stack',
    canvasView: 'Canvas',
    cards: 'Cards',
    list: 'List',
    sort: 'Sort',
    sortNewest: 'Saved time (new → old)',
    sortOldest: 'Saved time (old → new)',
    sortGroupFirst: 'Groups first',
    sortTitle: 'Title A→Z',
    sortTitleDesc: 'Title Z→A',
    sortDomain: 'Domain A→Z',
    sortManual: 'Manual order',
    copied: 'Link copied',
    copyFailed: 'Copy failed',
    copyLink: 'Copy link',
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
    importBackup: 'Restore (replace)',
    importAppend: 'Import (append)',
    backupExported: 'Backup exported',
    backupExporting: 'Exporting…',
    backupImporting: 'Importing…',
    backupImported: 'Backup restored',
    backupAppended: 'Appended {n} item(s)',
    backupConfirm: 'Restore will overwrite all current TabWall data. Continue?',
    backupAppendConfirm: 'Append backup items to the current wall (existing cards stay). Continue?',
    backupInvalid: 'Invalid backup file',
    backupInvalidDetail: 'Backup could not be imported: {error}',
    backupLegacyNotice: 'Legacy v{version} backup compatibility was applied.',
    backupColorNotice: 'Converted {n} legacy group color(s) to the current format.',
    backupFaviconNotice: 'Skipped {n} favicon(s) that exceeded limits or had an invalid format.',
    backupStoredOnly: '{n} file URL(s) were kept but cannot be restored directly.',
    backupError: 'Operation failed',
    backupHint: 'Lite omits screenshots (small). Full ZIP stores binary images. Replace overwrites all; append only adds.',
    diagLogTitle: 'Diagnostic log',
    diagLogHint: 'Events for export / import / auto-backup. Copy for debugging.',
    diagLogRefresh: 'Refresh',
    diagLogCopy: 'Copy',
    diagLogClear: 'Clear',
    diagLogEmpty: 'No log entries yet',
    diagLogCopied: 'Copied',
    manualAddTitle: 'Add cards manually',
    manualAddHint: 'One URL per line. Wrap lines with #GROUP:Name to create a group.',
    manualAddPh:
      'https://example.com/a\nhttps://example.com/b\n\n#GROUP:Work\nhttps://jira.example.com\nhttps://wiki.example.com\n#GROUP:Work',
    manualAddSubmit: 'Add cards',
    manualAddOk: 'Added {n} item(s)',
    manualAddEmpty: 'No valid URLs to add',
    manualAddSkipped: '({n} line(s) skipped)',
    autoBackupTitle: 'Auto backup',
    autoBackupHint:
      'Writes under Chrome’s configured download location (not always ~/Downloads — see chrome://settings/downloads). Never uploaded.',
    autoBackupEnable: 'Enable auto backup',
    autoBackupSubfolder: 'Subfolder under download location',
    autoBackupSubfolderHint: 'Relative to Chrome’s download location, e.g. TabWall-Backups',
    autoBackupLocation: 'Backup location',
    autoBackupLocationPending: 'Download location / {subfolder} (full path after a successful backup)',
    autoBackupLocationStale: 'Path outdated — click Backup now to write to the current download location',
    autoBackupMode: 'Format',
    autoBackupModeLite: 'Lite JSON',
    autoBackupModeFull: 'Full ZIP',
    autoBackupOnChange: 'Also backup after data changes',
    autoBackupEvery: 'Every',
    autoBackupUnitMinute: 'minutes',
    autoBackupUnitHour: 'hours',
    autoBackupUnitDay: 'days',
    autoBackupMaxKeep: 'Keep at most',
    autoBackupMaxKeepUnit: 'copies',
    autoBackupNow: 'Backup now',
    autoBackupShowFolder: 'Open Downloads folder',
    autoBackupRunning: 'Backing up…',
    autoBackupOk: 'Saved: {file}',
    autoBackupLastOk: 'Last success: {time}',
    autoBackupErrWrite: 'Write failed',
    autoBackupErrExport: 'Export failed',
    autoBackupErrDisabled: 'Enable auto backup first, or use Backup now',
    selectMode: 'Select',
    selectModeOn: 'Selecting',
    batchRestore: 'Restore',
    batchEdit: 'Note / Tags',
    batchExportLite: 'Export lite',
    batchExportFull: 'Export full',
    batchDelete: 'Delete',
    batchClear: 'Cancel',
    batchCount: '{n} selected',
    batchExportEmpty: 'Select cards first',
    importPickTitle: 'Choose items to restore',
    importPickHint: 'Check tabs/groups to write. All selected by default. Use Preview for thumbs / members.',
    importPickAll: 'Select all',
    importPickNone: 'Select none',
    importPickConfirm: 'Confirm restore',
    importPickCount: '{n} / {total} selected',
    importPickEmpty: 'Select at least one item',
    importPickModeReplace: 'Mode: replace existing data',
    importPickModeAppend: 'Mode: append to existing data',
    importPickPreview: 'Preview',
    importPreviewNoImage: 'No thumbnail/snapshot (lite backup is text-only)',
    importPreviewGroupEmpty: 'This group has no members',
    batchDeleteConfirm: 'Delete {n} selected items?',
    batchEditHeading: 'Batch edit note / tags',
    batchEditSub: 'Non-empty note overwrites; tags are merged by default',
    editFailed: 'Save failed',
    help: 'Help',
    helpTitle: 'Help',
    helpShortcutsTitle: 'Shortcuts',
    helpShortcutSave: 'Park current tab (screenshot)',
    helpShortcutGroup: 'Park current Tab Group',
    helpShortcutWall: 'Toggle TabWall canvas',
    helpShortcutChrome: 'Shortcuts for parking a tab, parking a Tab Group, and toggling the canvas are managed by Chrome. Configure them in Chrome shortcut settings.',
    helpShortcutSearch: 'Focus search',
    helpShortcutSettings: 'Open / close settings (⌥⌘S / Alt+Win+S)',
    helpShortcutEsc: 'Close panels / canvas',
    helpShortcutArrows: 'Previous / next snapshot',
    shortcutsTitle: 'Chrome Shortcuts',
    shortcutsHint:
      'Shortcuts are managed by Chrome. The manifest defaults are used at install time; configure or change them in Chrome shortcut settings.',
    shortcutsOpenChrome: 'Manage shortcuts in Chrome settings',
    shortcutsChromeOpened: 'Chrome shortcut settings opened. Configure or change the shortcuts there.',
    shortcutsChromeOpenFailed: 'Unable to open Chrome shortcut settings.',
    shortcutsChromeBound: 'Chrome shortcut: {s}',
    shortcutsChromeUnbound: 'Chrome shortcut: not set',
    dedupeTitle: 'Duplicate URL detected',
    dedupeConflictHint: 'This exact URL is already parked. Choose what to do.',
    dedupeExisting: 'Existing items',
    dedupeKeepBoth: 'Keep both',
    dedupeReplace: 'Replace old',
    dedupeCancel: 'Cancel',
    dedupeScanTitle: 'Deduplicate',
    dedupeScanHint: 'Scan parked tabs with identical full URLs and choose what to keep.',
    dedupeScan: 'Scan duplicates',
    dedupeNoDupes: 'No duplicates found',
    dedupeKeepNewest: 'Keep newest',
    dedupeKeepOldest: 'Keep oldest',
    dedupeKeepAll: 'Keep all',
    dedupeApply: 'Apply',
    dedupeApplyOk: 'Removed {n} duplicate(s)',
    dedupeApplyNone: 'Nothing to remove',
    dedupeCount: '{n} items',
    dedupeSavedAt: 'Saved {t}',
    helpDedupeBody:
      'Saving a tab with an existing URL asks you how to proceed. Use the toolbar “Scan duplicates” to clean the wall.',
    helpBasicTitle: 'Basics',
    helpBasicBody:
      'Thumbnail restores; title copies the link; use Edit for notes/tags, Expand for snapshots, and Delete to remove. Drag to reorder, or drop onto another card’s title area to stack (restores as a Tab Group).',
    helpGroupTitle: 'Tab Groups / Stacks',
    helpGroupBody:
      'Alt+Shift+G parks a group; stacking tabs also builds a group. The member panel previews, edits, and restores one or all members.',
    helpSelectTitle: 'Multi-select',
    helpSelectBody: 'Turn on Select, pick cards, then batch restore, merge tags, or delete.',
    helpBackupTitle: 'Backup',
    helpBackupBody:
      'Lite JSON omits screenshots; full ZIP includes images. Restore (replace) overwrites all; import (append) only adds. Paste URLs to create cards; wrap with #GROUP:Name for groups. Auto-backup uses a Downloads subfolder.',
    helpLimitsTitle: 'Limits',
    helpLimitsBody:
      'chrome:// pages cannot be captured or injected into. TabWall storage is not Chrome’s built-in Save group.',
    groupTabs: '{n} tabs',
    unnamedGroup: 'Untitled group',
    restoreGroup: 'Restore entire group',
    restoreGroupConfirm: 'Restore group “{title}” ({n} tabs)?',
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
    storedOnly: 'Cannot restore directly',
    storedOnlyShort: 'file',
    restoreRestricted: 'This URL cannot be restored directly; the item was kept.',
    restoreSkipped: 'Group restored; skipped {n} member(s) that cannot be restored directly.',
    memberSnapshot: 'Snapshot',
    memberEdit: 'Note / Tags',
    editMemberHeading: 'Edit member note / tags',
  },
};

const gridEl = document.getElementById('grid');
const canvasView = document.getElementById('canvasView');
const canvasViewportEl = document.getElementById('canvasViewport');
const canvasWorldEl = document.getElementById('canvasWorld');
const canvasNodesEl = document.getElementById('canvasNodes');
const canvasSelectionEl = document.getElementById('canvasSelection');
const canvasContextBar = document.getElementById('canvasContextBar');
const canvasArrangePanel = document.getElementById('canvasArrangePanel');
const canvasMinimap = document.getElementById('canvasMinimap');
const canvasDropZone = document.getElementById('canvasDropZone');
const canvasStackDialog = document.getElementById('canvasStackDialog');
const canvasStackTitle = document.getElementById('canvasStackTitle');
const canvasStackConfirm = document.getElementById('canvasStackConfirm');
const canvasStackCancel = document.getElementById('canvasStackCancel');
const countEl = document.getElementById('count');
const loadStatusEl = document.getElementById('loadStatus');
const searchEl = document.getElementById('search');
const searchRegexBtn = document.getElementById('searchRegexBtn');
const searchWrap = document.getElementById('searchWrap');
const searchScopeChip = document.getElementById('searchScopeChip');
const quickAddBtn = document.getElementById('quickAddBtn');
const quickAddMenuBtn = document.getElementById('quickAddMenuBtn');
const quickAddMenu = document.getElementById('quickAddMenu');
const quickAddTabMenu = document.getElementById('quickAddTabMenu');
const quickAddGroupMenu = document.getElementById('quickAddGroupMenu');
const quickAddUrlMenu = document.getElementById('quickAddUrlMenu');
const moreToolsBtn = document.getElementById('moreToolsBtn');
const moreToolsMenu = document.getElementById('moreToolsMenu');
const pinnedOnlyBtn = document.getElementById('pinnedOnlyBtn');
const settingsEl = document.getElementById('settings');
const settingsNav = document.getElementById('settingsNav');
const settingsSaveStatus = document.getElementById('settingsSaveStatus');
const settingsDoneBtn = document.getElementById('settingsDoneBtn');
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
const conflictModal = document.getElementById('conflictModal');
const conflictIncomingTitle = document.getElementById('conflictIncomingTitle');
const conflictIncomingUrl = document.getElementById('conflictIncomingUrl');
const conflictMatchList = document.getElementById('conflictMatchList');
const conflictCancel = document.getElementById('conflictCancel');
const conflictReplace = document.getElementById('conflictReplace');
const conflictKeepBoth = document.getElementById('conflictKeepBoth');
const dedupeBox = document.getElementById('dedupeBox');
const dedupeDrag = document.getElementById('dedupeDrag');
const dedupeCloseX = document.getElementById('dedupeCloseX');
const dedupeClustersEl = document.getElementById('dedupeClusters');
const dedupeStatus = document.getElementById('dedupeStatus');
const dedupeRescanBtn = document.getElementById('dedupeRescanBtn');
const dedupeApplyBtn = document.getElementById('dedupeApplyBtn');
const openDedupeBtn = document.getElementById('openDedupeBtn');
const tagSearch = document.getElementById('tagSearch');
const tagManageList = document.getElementById('tagManageList');
const tagAddInput = document.getElementById('tagAddInput');
const tagAddBtn = document.getElementById('tagAddBtn');
const exportLiteBtn = document.getElementById('exportLiteBtn');
const exportFullBtn = document.getElementById('exportFullBtn');
const importBackupBtn = document.getElementById('importBackupBtn');
const importAppendBtn = document.getElementById('importAppendBtn');
const importBackupFile = document.getElementById('importBackupFile');
const backupStatus = document.getElementById('backupStatus');
const manualAddText = document.getElementById('manualAddText');
const manualAddBtn = document.getElementById('manualAddBtn');
const manualAddStatus = document.getElementById('manualAddStatus');
const diagLogText = document.getElementById('diagLogText');
const diagLogRefreshBtn = document.getElementById('diagLogRefreshBtn');
const diagLogCopyBtn = document.getElementById('diagLogCopyBtn');
const diagLogClearBtn = document.getElementById('diagLogClearBtn');
const diagLogStatus = document.getElementById('diagLogStatus');
/** @type {'replace' | 'append'} */
let pendingImportMode = 'replace';

/** @type {{ t: number, level: string, tag: string, msg: string, detail: string }[]} */
const uiLogBuffer = [];
const UI_LOG_MAX = 150;

function uiLog(level, tag, msg, detail) {
  const entry = {
    t: Date.now(),
    level: level || 'info',
    tag: String(tag || 'ui'),
    msg: String(msg || ''),
    detail: detail != null ? String(detail).slice(0, 800) : '',
  };
  uiLogBuffer.push(entry);
  while (uiLogBuffer.length > UI_LOG_MAX) uiLogBuffer.shift();
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

function formatLogEntry(e) {
  const ts = new Date(e.t).toISOString().replace('T', ' ').replace('Z', '');
  const d = e.detail ? ` | ${e.detail}` : '';
  return `${ts} [${e.level}] [${e.tag}] ${e.msg}${d}`;
}

async function refreshDiagLogPanel() {
  if (!diagLogText) return;
  const res = await sendMessage({ type: 'GET_LOGS' });
  const swLogs = res?.ok && Array.isArray(res.logs) ? res.logs : [];
  const merged = [...swLogs, ...uiLogBuffer].sort((a, b) => a.t - b.t);
  // Dedupe near-identical consecutive lines
  const lines = [];
  let prev = '';
  for (const e of merged) {
    const line = formatLogEntry(e);
    if (line === prev) continue;
    lines.push(line);
    prev = line;
  }
  diagLogText.value = lines.length ? lines.join('\n') : t('diagLogEmpty');
  if (diagLogStatus) diagLogStatus.textContent = '';
}

diagLogRefreshBtn?.addEventListener('click', () => {
  refreshDiagLogPanel();
});
diagLogCopyBtn?.addEventListener('click', async () => {
  const text = diagLogText?.value || '';
  try {
    await navigator.clipboard.writeText(text);
    if (diagLogStatus) diagLogStatus.textContent = t('diagLogCopied');
  } catch {
    if (diagLogText) {
      diagLogText.select();
      document.execCommand('copy');
      if (diagLogStatus) diagLogStatus.textContent = t('diagLogCopied');
    }
  }
});
diagLogClearBtn?.addEventListener('click', async () => {
  uiLogBuffer.length = 0;
  await sendMessage({ type: 'CLEAR_LOGS' });
  await refreshDiagLogPanel();
});
const autoBackupEnabledEl = document.getElementById('autoBackupEnabled');
const autoBackupSubfolderEl = document.getElementById('autoBackupSubfolder');
const autoBackupLocationLabelEl = document.getElementById('autoBackupLocationLabel');
const autoBackupOnChangeEl = document.getElementById('autoBackupOnChange');
const autoBackupIntervalValueEl = document.getElementById('autoBackupIntervalValue');
const autoBackupIntervalUnitEl = document.getElementById('autoBackupIntervalUnit');
const autoBackupMaxKeepEl = document.getElementById('autoBackupMaxKeep');
const autoBackupNowBtn = document.getElementById('autoBackupNowBtn');
const autoBackupShowFolderBtn = document.getElementById('autoBackupShowFolderBtn');
const autoBackupStatusEl = document.getElementById('autoBackupStatus');
const selectModeBtn = document.getElementById('selectModeBtn');
const batchBar = document.getElementById('batchBar');
const batchCount = document.getElementById('batchCount');
const batchRestore = document.getElementById('batchRestore');
const batchEdit = document.getElementById('batchEdit');
const batchExportLite = document.getElementById('batchExportLite');
const batchExportFull = document.getElementById('batchExportFull');
const batchDelete = document.getElementById('batchDelete');
const batchClear = document.getElementById('batchClear');
const importPickBox = document.getElementById('importPickBox');
const importPickDrag = document.getElementById('importPickDrag');
const importPickCloseX = document.getElementById('importPickCloseX');
const importPickList = document.getElementById('importPickList');
const importPickAllBtn = document.getElementById('importPickAllBtn');
const importPickNoneBtn = document.getElementById('importPickNoneBtn');
const importPickCount = document.getElementById('importPickCount');
const importPickCancelBtn = document.getElementById('importPickCancelBtn');
const importPickConfirmBtn = document.getElementById('importPickConfirmBtn');
const importPickStatus = document.getElementById('importPickStatus');
const importPickHintEl = document.getElementById('importPickHint');
const importPreviewOverlay = document.getElementById('importPreviewOverlay');
const importPreviewTitle = document.getElementById('importPreviewTitle');
const importPreviewUrl = document.getElementById('importPreviewUrl');
const importPreviewBody = document.getElementById('importPreviewBody');
const importPreviewCloseBtn = document.getElementById('importPreviewCloseBtn');
/** @type {{ mode: 'replace'|'append', backup: object, selected: Set<string>, warnings: object } | null} */
let pendingImportPick = null;
const closeBtn = document.getElementById('closeBtn');
const themeBtn = document.getElementById('themeBtn');
const viewModeBtn = document.getElementById('viewModeBtn');
const viewModeLabel = document.getElementById('viewModeLabel');
const viewModeListIcon = document.getElementById('viewModeListIcon');
const viewModeCanvasIcon = document.getElementById('viewModeCanvasIcon');
const sortByEl = document.getElementById('sortBy');
const colsControl = document.getElementById('colsControl');
const cardColsEl = document.getElementById('cardCols');
const colsValueEl = document.getElementById('colsValue');
const settingsCardCols = document.getElementById('settingsCardCols');
const settingsColsValue = document.getElementById('settingsColsValue');
const openWithSearchFocusEl = document.getElementById('openWithSearchFocus');
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
const lbGroupMosaic = document.getElementById('lbGroupMosaic');

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
/** Store-owned read projection; canvas mutations must go through canvasStore. */
let canvasLayout = {
  version: CANVAS_LAYOUT_VERSION,
  viewport: { ...DEFAULT_CANVAS_VIEWPORT },
  positions: {},
};
let canvasStore = null;
const canvasNodeElements = new Map();
const canvasMinimapElements = new Map();
let canvasLoadGeneration = 0;
let canvasPointerRaf = 0;
let canvasQueuedPointerEvent = null;
let canvasLastPointerEvent = null;
let canvasInteractionGeneration = 0;
let canvasSessionFallback = false;
let canvasNeedsInitialCenter = false;
let canvasInitialCenterRaf = 0;
let canvasGeometryObserver = null;
let canvasSaveTimer = null;
let canvasPointerState = null;
let canvasActiveTool = 'select';
let canvasSnapToGrid = true;
let canvasSpacePressed = false;
const canvasNodeClickTimers = new Map();
const canvasNodeClickSuppressUntil = new Map();
let query = '';
/** @type {'all'|'tag'|'note'} */
let searchScope = 'all';
/** @type {{ raw: string, re: RegExp|null, err: string|null }} */
let compiledSearch = { raw: '', re: null, err: null };
/** @type {typeof DEFAULT_SETTINGS} */
let settings = { ...DEFAULT_SETTINGS };
/** @type {string|null} */
let expandedId = null;
/** @type {{ type?: 'member' | 'group', groupId?: string } | null} */
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
let pinnedOnly = false;
let canvasIndexFilter = 'all';
let settingsSection = 'general';
let selectMode = false;
/** @type {Set<string>} */
let selectedIds = new Set();
/** @type {string|null} */
let lastAnchorId = null;
let copyToastTimer = null;

function canvasStoreSnapshot() {
  return canvasStore?.getState?.() || {
    items: allTabs,
    layout: canvasLayout,
    baseLayout: canvasLayout,
    viewport: { ...canvasLayout.viewport },
    revision: 0,
    selectedIds: new Set(selectedIds),
    interaction: null,
    pendingOperations: [],
    sync: { status: 'idle', attempt: 0, error: '' },
  };
}

function activeCanvasSelection() {
  return canvasStoreSnapshot().selectedIds;
}

function clearAllSelections() {
  ensureCanvasStore()?.setSelection([]);
  selectedIds.clear();
}

function updateCanvasSyncStatus(sync = canvasStoreSnapshot().sync) {
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
  canvasLayout = snapshot.layout;
  if (settings.viewMode === 'canvas') selectedIds = new Set(snapshot.selectedIds);
  updateCanvasSyncStatus(snapshot.sync);
  const fullRender = new Set(['ITEMS_SET', 'HYDRATE', 'REMOTE_LAYOUT']).has(action.type);
  if (fullRender && settings.viewMode === 'canvas' && !canvasSessionFallback) renderCanvas();
  else if (settings.viewMode === 'canvas' && !canvasSessionFallback) {
    updateCanvasTransform();
    updateCanvasNodePositions(snapshot);
    updateCanvasNodeSelection();
    renderCanvasMinimap(getCanvasVisibleTabs());
    updateBatchBar();
    if (action.type === 'OPERATION_COMMIT' || action.type === 'SYNC_ERROR' || action.type === 'SYNC_FAILED') {
      refreshCanvasMediaQuality();
    }
  }
}

function ensureCanvasStore() {
  if (canvasStore || !CanvasStoreApi?.createCanvasStore) return canvasStore;
  canvasStore = CanvasStoreApi.createCanvasStore({
    items: allTabs,
    layout: canvasLayout,
    sendPatch: ({ layout, baseRevision }) => sendMessage({
      type: 'PATCH_CANVAS_LAYOUT',
      layout,
      baseRevision,
    }),
    onChange: handleCanvasStoreChange,
  });
  return canvasStore;
}

ensureCanvasStore();

/** @type {null | object} */
let dragState = null;

const uiBusyActions = new Set();

async function withUiActionLock(name, task) {
  if (uiBusyActions.has(name)) return { ok: false, error: 'busy' };
  uiBusyActions.add(name);
  document.body.dataset.tabwallBusy = '1';
  try {
    return await task();
  } finally {
    uiBusyActions.delete(name);
    if (!uiBusyActions.size) delete document.body.dataset.tabwallBusy;
  }
}

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
  if (event.source !== window.parent || !PARENT_ORIGIN || event.origin !== PARENT_ORIGIN) return;
  if (event.data?.type === 'TABWALL_FOCUS_SEARCH') {
    focusSearch();
    return;
  }
  if (event.data?.type === 'TABWALL_SAVE_RESULT') {
    handleQuickCaptureResult(event.data.result);
    return;
  }
  if (event.data?.type === 'TABWALL_SAVE_CONFLICT' && event.data.conflict) {
    openConflictModal(event.data.conflict);
  }
});

// Tell host content script the park UI is ready (for queued conflict payload)
try {
  if (window.parent && window.parent !== window) {
    postToParent({ type: 'TABWALL_PARK_READY' });
  }
} catch {
  // ignore
}

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
  syncQuickCaptureAvailability();
  syncPinnedFilterUi();
  if (selectModeBtn) {
    selectModeBtn.textContent = selectMode ? t('selectModeOn') : t('selectMode');
  }
  updateSavedBadge();
  if (typeof updateBatchBar === 'function') updateBatchBar();
  if (typeof refreshChromeCommandLabels === 'function') refreshChromeCommandLabels();
  if (typeof syncSearchRegexUi === 'function') syncSearchRegexUi();
}

async function closeStandaloneTab() {
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
  if (window.parent && window.parent !== window) {
    try {
      if (postToParent({ type: 'TABWALL_CLOSE' })) return;
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

function quickCaptureErrorText(error) {
  switch (String(error || '')) {
    case 'self_tab':
      return t('quickAddSelf');
    case 'restricted_url':
      return t('quickAddRestricted');
    case 'not_in_group':
      return t('quickAddNoGroup');
    case 'no_tab':
      return t('quickAddNoTarget');
    default:
      return t('quickAddFailed', { error: error || 'unknown' });
  }
}

async function handleQuickCaptureResult(result) {
  if (!result) return;
  if (!result.ok) {
    showCopyToast(quickCaptureErrorText(result.error));
    return;
  }
  if (result.conflict) {
    showCopyToast(t('quickAddSaved'));
    return;
  }
  showCopyToast(result.tabCount ? t('quickAddGroupSaved') : t('quickAddSaved'));
  await loadList();
}

function closeQuickMenus() {
  if (quickAddMenu) quickAddMenu.hidden = true;
  if (quickAddMenuBtn) quickAddMenuBtn.setAttribute('aria-expanded', 'false');
  if (moreToolsMenu) moreToolsMenu.hidden = true;
  if (moreToolsBtn) moreToolsBtn.setAttribute('aria-expanded', 'false');
}

function syncQuickCaptureAvailability() {
  const hasHost = Boolean(PARENT_ORIGIN);
  if (quickAddBtn) {
    quickAddBtn.disabled = !hasHost;
    quickAddBtn.title = hasHost ? t('quickAddTab') : t('quickAddSelf');
    quickAddBtn.setAttribute('aria-label', t('quickAddTab'));
  }
  if (quickAddTabMenu) {
    quickAddTabMenu.disabled = !hasHost;
    quickAddTabMenu.title = hasHost ? t('quickAddTab') : t('quickAddSelf');
  }
  if (quickAddGroupMenu) {
    quickAddGroupMenu.disabled = !hasHost;
    quickAddGroupMenu.title = hasHost ? t('quickAddGroup') : t('quickAddSelf');
  }
}

async function requestQuickCapture(kind) {
  closeQuickMenus();
  if (kind === 'url') {
    openSettingsBox();
    applySettingsSection('tools');
    setTimeout(() => manualAddText?.focus(), 0);
    return;
  }
  if (kind === 'tab' && !PARENT_ORIGIN) {
    showCopyToast(t('quickAddSelf'));
    return;
  }
  if (kind === 'tab' && PARENT_ORIGIN) {
    if (!postToParent({ type: 'TABWALL_SAVE_ACTIVE' })) {
      showCopyToast(t('quickAddNoTarget'));
    }
    return;
  }
  const result = await sendMessage({ type: 'SAVE_ACTIVE_GROUP' });
  await handleQuickCaptureResult(result);
}

function initQuickCaptureUi() {
  syncQuickCaptureAvailability();
  quickAddBtn?.addEventListener('click', () => requestQuickCapture('tab'));
  quickAddTabMenu?.addEventListener('click', () => requestQuickCapture('tab'));
  quickAddGroupMenu?.addEventListener('click', () => requestQuickCapture('group'));
  quickAddUrlMenu?.addEventListener('click', () => requestQuickCapture('url'));
  quickAddMenuBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = Boolean(quickAddMenu && quickAddMenu.hidden);
    closeQuickMenus();
    if (quickAddMenu && open) {
      quickAddMenu.hidden = false;
      quickAddMenuBtn.setAttribute('aria-expanded', 'true');
    }
  });
  moreToolsBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = Boolean(moreToolsMenu && moreToolsMenu.hidden);
    closeQuickMenus();
    if (moreToolsMenu && open) {
      moreToolsMenu.hidden = false;
      moreToolsBtn.setAttribute('aria-expanded', 'true');
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('#quickAddWrap, #moreToolsMenu, #moreToolsBtn')) {
      closeQuickMenus();
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

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function sanitizeSubfolder(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
  s = s.replace(/^\/+/, '');
  const parts = s
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[?%*:|"<>]/g, '_').replace(/^\.+/, ''));
  s = parts.join('/');
  if (!s) s = 'TabWall-Backups';
  if (s.length > 180) s = s.slice(0, 180);
  return s;
}

function normalizeIntervalUnit(u) {
  if (u === 'minute' || u === 'minutes') return 'minute';
  if (u === 'day' || u === 'days') return 'day';
  return 'hour';
}

function intervalValueBounds(unit) {
  if (unit === 'minute') return { min: 10, max: 1440, fallback: 60 };
  if (unit === 'day') return { min: 1, max: 7, fallback: 1 };
  return { min: 1, max: 168, fallback: 24 };
}

function normalizeAutoBackup(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  let unit = normalizeIntervalUnit(o.intervalUnit);
  let valueRaw = o.intervalValue;
  if (valueRaw == null && o.intervalHours != null) {
    unit = 'hour';
    valueRaw = o.intervalHours;
  }
  const bounds = intervalValueBounds(unit);
  const subfolder = sanitizeSubfolder(
    o.subfolder != null && String(o.subfolder).trim() !== ''
      ? o.subfolder
      : o.folderName || 'TabWall-Backups'
  );
  return {
    enabled: Boolean(o.enabled),
    mode: o.mode === 'full' ? 'full' : 'lite',
    onChange: o.onChange !== false,
    intervalUnit: unit,
    intervalValue: clampInt(valueRaw, bounds.min, bounds.max, bounds.fallback),
    maxKeep: clampInt(o.maxKeep, 1, 99, 5),
    subfolder,
    folderPath: typeof o.folderPath === 'string' ? o.folderPath : '',
    lastSuccessAt: Number(o.lastSuccessAt) || 0,
    lastError: typeof o.lastError === 'string' ? o.lastError : '',
    dirtyAt: Number(o.dirtyAt) || 0,
  };
}

function autoBackupIntervalMinutes(ab) {
  const n = normalizeAutoBackup(ab);
  if (n.intervalUnit === 'minute') return n.intervalValue;
  if (n.intervalUnit === 'day') return n.intervalValue * 24 * 60;
  return n.intervalValue * 60;
}

function syncIntervalInputBounds() {
  if (!autoBackupIntervalValueEl || !autoBackupIntervalUnitEl) return;
  const unit = normalizeIntervalUnit(autoBackupIntervalUnitEl.value);
  const bounds = intervalValueBounds(unit);
  autoBackupIntervalValueEl.min = String(bounds.min);
  autoBackupIntervalValueEl.max = String(bounds.max);
  const v = clampInt(autoBackupIntervalValueEl.value, bounds.min, bounds.max, bounds.fallback);
  autoBackupIntervalValueEl.value = String(v);
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  merged.cardCols = clampCols(merged.cardCols);
  if (merged.viewMode === 'cards') merged.viewMode = 'canvas';
  if (merged.viewMode !== 'list') merged.viewMode = 'canvas';
  if (merged.defaultViewMode === 'cards') merged.defaultViewMode = 'canvas';
  if (merged.defaultViewMode !== 'list') merged.defaultViewMode = 'canvas';
  if (merged.locale !== 'en') merged.locale = 'zh';
  // Local shortcut settings were removed; discard the legacy field on the next write.
  delete merged.shortcuts;
  merged.autoBackup = normalizeAutoBackup({
    ...DEFAULT_AUTO_BACKUP,
    ...(merged.autoBackup || {}),
  });
  merged.canvasSnap = merged.canvasSnap !== false;
  return merged;
}

/** Skip our own storage writes in onChanged (avoids full UI rebuild echo). */
let suppressSettingsOnChanged = false;
let suppressSettingsTimer = null;

async function saveSettings(partial) {
  let patch = { ...(partial || {}) };
  if (patch.cardCols != null) patch.cardCols = clampCols(patch.cardCols);
  if (patch.autoBackup) {
    patch.autoBackup = normalizeAutoBackup({ ...settings.autoBackup, ...patch.autoBackup });
  }
  suppressSettingsOnChanged = true;
  if (suppressSettingsTimer) clearTimeout(suppressSettingsTimer);
  try {
    const res = await sendMessage({ type: 'PATCH_SETTINGS', partial: patch });
    if (!res?.ok || !res.settings) {
      uiLog('error', 'settings', 'save failed', res?.error || 'unknown');
      return settings;
    }
    settings = { ...settings, ...res.settings };
    if (settings.autoBackup) settings.autoBackup = normalizeAutoBackup(settings.autoBackup);
    if (settingsSaveStatus) {
      settingsSaveStatus.textContent = t('settingsAutoSaved');
      settingsSaveStatus.dataset.state = 'saved';
    }
    return settings;
  } finally {
    // chrome.storage.onChanged may fire async after set resolves
    suppressSettingsTimer = setTimeout(() => {
      suppressSettingsOnChanged = false;
      suppressSettingsTimer = null;
    }, 50);
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  themeBtn.textContent = theme === 'light' ? 'Dark' : 'Light';
}

function syncViewModeButton(mode) {
  if (!viewModeBtn) return;
  const target = mode === 'canvas' ? 'list' : 'canvas';
  const label = t(target === 'list' ? 'list' : 'canvasView');
  if (viewModeLabel) viewModeLabel.textContent = label;
  if (viewModeListIcon) viewModeListIcon.hidden = target !== 'list';
  if (viewModeCanvasIcon) viewModeCanvasIcon.hidden = target !== 'canvas';
  viewModeBtn.dataset.viewTarget = target;
  viewModeBtn.title = label;
  viewModeBtn.setAttribute('aria-label', label);
}

function applyViewMode(mode) {
  if (mode !== 'list' && mode !== 'canvas') mode = 'canvas';
  const isList = mode === 'list';
  const isCanvas = mode === 'canvas';
  gridEl.classList.toggle('cards', !isList);
  gridEl.classList.toggle('list', isList);
  syncViewModeButton(mode);
  colsControl.classList.toggle('visible', !isList && !isCanvas);
  if (canvasView) canvasView.hidden = !isCanvas;
  if (canvasView) canvasView.setAttribute('aria-hidden', isCanvas ? 'false' : 'true');
  document.body.classList.toggle('canvas-mode', isCanvas);
  if (isCanvas) scheduleInitialCanvasCenter();
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
  const isCanvasUi = settings.viewMode === 'canvas' && !canvasSessionFallback;
  const visible = isCanvasUi ? getCanvasVisibleTabs().length : getVisibleTabs().length;
  const canvasFiltered = isCanvasUi && canvasIndexFilter !== 'all';
  countEl.textContent =
    (query || pinnedOnly || canvasFiltered) && visible !== n
      ? t('countFiltered', { shown: visible, total: n })
      : t('countTabs', { n });
}

function syncPinnedFilterUi() {
  if (!pinnedOnlyBtn) return;
  pinnedOnlyBtn.classList.toggle('active', pinnedOnly);
  pinnedOnlyBtn.setAttribute('aria-pressed', pinnedOnly ? 'true' : 'false');
}

function syncSettingsUi() {
  applyTheme(settings.theme);
  applyViewMode(settings.viewMode);
  applyCardCols(settings.cardCols);
  canvasSnapToGrid = settings.canvasSnap !== false;
  const canvasSnapInput = document.getElementById('settingsCanvasSnap');
  if (canvasSnapInput) canvasSnapInput.checked = canvasSnapToGrid;
  const canvasSnapToggle = document.getElementById('canvasSnapToggle');
  if (canvasSnapToggle) canvasSnapToggle.checked = canvasSnapToGrid;
  syncPinnedFilterUi();
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
      `input[name="defaultViewMode"][value="${settings.defaultViewMode || 'canvas'}"]`
    ) || settingsEl.querySelector('input[name="defaultViewMode"][value="canvas"]');
  if (viewRadio) viewRadio.checked = true;

  syncAutoBackupUi();

  applyI18n();
  refreshChromeCommandLabels();
  syncSearchRegexUi();
}

function autoBackupErrorText(code, detail) {
  let base = '';
  switch (code) {
    case 'export_failed':
    case 'build_failed':
      base = t('autoBackupErrExport');
      break;
    case 'write_failed':
    case 'busy':
      base = t('autoBackupErrWrite');
      break;
    case 'disabled':
      base = t('autoBackupErrDisabled');
      break;
    default:
      base = code ? t('autoBackupErrWrite') : '';
  }
  if (base && detail) return `${base}: ${detail}`;
  return base;
}

/** True if stored absolute path looks like it belongs to current subfolder. */
function folderPathMatchesSubfolder(folderPath, subfolder) {
  if (!folderPath || !subfolder) return false;
  const norm = String(folderPath).replace(/[/\\]+$/, '');
  const base = norm.split(/[/\\]/).pop() || '';
  return base === subfolder || norm.endsWith('/' + subfolder) || norm.endsWith('\\' + subfolder);
}

function syncAutoBackupUi() {
  const ab = normalizeAutoBackup(settings.autoBackup);
  settings.autoBackup = ab;
  if (autoBackupEnabledEl) autoBackupEnabledEl.checked = ab.enabled;
  if (autoBackupOnChangeEl) autoBackupOnChangeEl.checked = ab.onChange;
  if (autoBackupIntervalUnitEl) autoBackupIntervalUnitEl.value = ab.intervalUnit;
  if (autoBackupIntervalValueEl) {
    autoBackupIntervalValueEl.value = String(ab.intervalValue);
    syncIntervalInputBounds();
    autoBackupIntervalValueEl.value = String(ab.intervalValue);
  }
  if (autoBackupMaxKeepEl) autoBackupMaxKeepEl.value = String(ab.maxKeep);
  if (autoBackupSubfolderEl && document.activeElement !== autoBackupSubfolderEl) {
    autoBackupSubfolderEl.value = ab.subfolder;
  }
  const modeRadio =
    settingsEl.querySelector(`input[name="autoBackupMode"][value="${ab.mode}"]`) ||
    settingsEl.querySelector('input[name="autoBackupMode"][value="lite"]');
  if (modeRadio) modeRadio.checked = true;

  if (autoBackupLocationLabelEl) {
    if (ab.folderPath && folderPathMatchesSubfolder(ab.folderPath, ab.subfolder)) {
      autoBackupLocationLabelEl.textContent = ab.folderPath;
      autoBackupLocationLabelEl.style.color = 'var(--text)';
      autoBackupLocationLabelEl.setAttribute('title', ab.folderPath);
    } else if (ab.folderPath && !folderPathMatchesSubfolder(ab.folderPath, ab.subfolder)) {
      autoBackupLocationLabelEl.textContent = t('autoBackupLocationStale');
      autoBackupLocationLabelEl.style.color = 'var(--muted)';
      autoBackupLocationLabelEl.setAttribute('title', ab.folderPath);
    } else {
      autoBackupLocationLabelEl.textContent = t('autoBackupLocationPending', {
        subfolder: ab.subfolder || 'TabWall-Backups',
      });
      autoBackupLocationLabelEl.style.color = 'var(--muted)';
      autoBackupLocationLabelEl.removeAttribute('title');
    }
  }

  if (autoBackupStatusEl) {
    const parts = [];
    if (ab.lastSuccessAt) {
      parts.push(t('autoBackupLastOk', { time: formatSavedAt(ab.lastSuccessAt) }));
    }
    if (ab.lastError) {
      const errText = autoBackupErrorText(ab.lastError);
      if (errText) parts.push(errText);
    }
    autoBackupStatusEl.textContent = parts.join(' · ');
  }
}

async function refreshChromeCommandLabels() {
  const res = await sendMessage({ type: 'GET_COMMANDS' });
  const byName = new Map(
    (res.ok && Array.isArray(res.commands) ? res.commands : []).map((c) => [c.name, c])
  );
  document.querySelectorAll('[data-chrome-cmd]').forEach((el) => {
    const name = el.getAttribute('data-chrome-cmd');
    const cmd = byName.get(name);
    const sc = cmd?.shortcut || '';
    el.textContent = sc
      ? t('shortcutsChromeBound', { s: sc })
      : t('shortcutsChromeUnbound');
  });
}

function refreshChromeCommandLabelsOnFocus() {
  if (document.visibilityState !== 'visible') return;
  refreshChromeCommandLabels().catch(() => {});
}

async function openChromeShortcutsForApply() {
  const res = await sendMessage({ type: 'OPEN_SHORTCUTS_PAGE' });
  showCopyToast(
    res?.ok ? t('shortcutsChromeOpened') : t('shortcutsChromeOpenFailed')
  );
}

function initChromeShortcutsUi() {
  const openChromeBtn = document.getElementById('openChromeShortcutsBtn');
  if (openChromeBtn) {
    openChromeBtn.addEventListener('click', () => {
      openChromeShortcutsForApply();
    });
  }

  document.addEventListener('visibilitychange', refreshChromeCommandLabelsOnFocus);
  window.addEventListener('focus', refreshChromeCommandLabelsOnFocus);
}

async function initSettingsUi() {
  settings = await loadSettings();

  // On open: apply default view if we want fresh open behavior
  // Use stored viewMode if user toggled; defaultViewMode applied when viewMode missing
  if (!settings.viewMode) {
    settings.viewMode = settings.defaultViewMode || 'canvas';
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

  // Auto backup controls
  autoBackupEnabledEl?.addEventListener('change', async () => {
    await saveSettings({ autoBackup: { enabled: autoBackupEnabledEl.checked } });
    syncAutoBackupUi();
  });
  autoBackupOnChangeEl?.addEventListener('change', async () => {
    await saveSettings({ autoBackup: { onChange: autoBackupOnChangeEl.checked } });
  });
  autoBackupSubfolderEl?.addEventListener('change', async () => {
    const subfolder = sanitizeSubfolder(autoBackupSubfolderEl.value);
    autoBackupSubfolderEl.value = subfolder;
    // Clear stale absolute path from older FS-access / old subfolder
    await saveSettings({ autoBackup: { subfolder, folderPath: '' } });
    syncAutoBackupUi();
  });
  autoBackupIntervalUnitEl?.addEventListener('change', async () => {
    const unit = normalizeIntervalUnit(autoBackupIntervalUnitEl.value);
    const bounds = intervalValueBounds(unit);
    const value = clampInt(autoBackupIntervalValueEl?.value, bounds.min, bounds.max, bounds.fallback);
    if (autoBackupIntervalValueEl) autoBackupIntervalValueEl.value = String(value);
    syncIntervalInputBounds();
    await saveSettings({ autoBackup: { intervalUnit: unit, intervalValue: value } });
  });
  autoBackupIntervalValueEl?.addEventListener('change', async () => {
    const unit = normalizeIntervalUnit(autoBackupIntervalUnitEl?.value || 'hour');
    const bounds = intervalValueBounds(unit);
    const value = clampInt(autoBackupIntervalValueEl.value, bounds.min, bounds.max, bounds.fallback);
    autoBackupIntervalValueEl.value = String(value);
    await saveSettings({ autoBackup: { intervalUnit: unit, intervalValue: value } });
  });
  autoBackupMaxKeepEl?.addEventListener('change', async () => {
    const maxKeep = clampInt(autoBackupMaxKeepEl.value, 1, 99, 5);
    autoBackupMaxKeepEl.value = String(maxKeep);
    await saveSettings({ autoBackup: { maxKeep } });
  });
  settingsEl.querySelectorAll('input[name="autoBackupMode"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.checked) {
        await saveSettings({ autoBackup: { mode: input.value === 'full' ? 'full' : 'lite' } });
      }
    });
  });
  autoBackupNowBtn?.addEventListener('click', async () => {
    await runLocalAutoBackup({ force: true });
  });
  autoBackupShowFolderBtn?.addEventListener('click', async () => {
    await sendMessage({ type: 'AUTO_BACKUP_SHOW_FOLDER' });
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
        syncViewModeButton(settings.viewMode);
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

  const settingsCanvasSnap = document.getElementById('settingsCanvasSnap');
  settingsCanvasSnap?.addEventListener('change', async () => {
    canvasSnapToGrid = settingsCanvasSnap.checked;
    const arrangeSnap = document.getElementById('canvasSnapToggle');
    if (arrangeSnap) arrangeSnap.checked = canvasSnapToGrid;
    await saveSettings({ canvasSnap: canvasSnapToGrid });
  });
  document.getElementById('settingsCanvasResetView')?.addEventListener('click', () => {
    document.getElementById('canvasResetView')?.click();
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

  initChromeShortcutsUi();
  initDedupeUi();
  initQuickCaptureUi();
  initSettingsSections();

  if (settings.openWithSearchFocus) {
    setTimeout(() => searchEl.focus(), 50);
  }

  // Resume conflict modal if SW queued one before park loaded
  sendMessage({ type: 'GET_PENDING_CONFLICT' }).then((res) => {
    if (res?.ok && res.conflict) openConflictModal(res.conflict);
  });
}

// ─── Save conflict (human decision) ────────────────────────────────

function formatSavedAt(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(settings.locale === 'en' ? 'en' : 'zh-Hant');
  } catch {
    return String(ts);
  }
}

function appendDedupeThumb(parent, item) {
  const mediaKey = mediaKeyForItem({ id: item.id, kind: 'tab' });
  if (item.hasThumb || item.hasSnap) {
    const img = document.createElement('img');
    img.className = 'dedupe-thumb lazy-thumb';
    img.alt = '';
    img.draggable = false;
    img.dataset.mediaKey = mediaKey;
    parent.appendChild(img);
    observeThumb(img);
  } else {
    const ph = document.createElement('span');
    ph.className = 'dedupe-thumb placeholder';
    ph.setAttribute('aria-hidden', 'true');
    parent.appendChild(ph);
  }
}

function appendDedupePreviewBtn(parent, item) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn dedupe-preview-btn';
  btn.title = t('expand');
  btn.setAttribute('aria-label', t('expand'));
  btn.innerHTML = iconSvg('expand');
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openLightbox({
      kind: 'tab',
      id: item.id,
      title: item.title || item.url || 'Untitled',
      url: item.url || '',
      hasThumb: Boolean(item.hasThumb),
      hasSnap: Boolean(item.hasSnap),
      savedAt: item.savedAt || 0,
    });
  });
  parent.appendChild(btn);
}

function openConflictModal(conflict) {
  if (!conflictModal || !conflict) return;
  conflictIncomingTitle.textContent = conflict.title || conflict.url || '—';
  conflictIncomingUrl.textContent = conflict.url || '—';
  conflictMatchList.innerHTML = '';
  const matches = Array.isArray(conflict.matches) ? conflict.matches : [];
  for (const m of matches) {
    const li = document.createElement('li');
    appendDedupeThumb(li, m);
    const body = document.createElement('div');
    body.className = 'di-body';
    body.innerHTML = `
      <div class="di-title">${escapeHtml(m.title || m.url || '—')}</div>
      <div class="di-meta">${escapeHtml(t('dedupeSavedAt', { t: formatSavedAt(m.savedAt) }))}</div>
    `;
    li.appendChild(body);
    appendDedupePreviewBtn(li, m);
    conflictMatchList.appendChild(li);
  }
  conflictModal.classList.add('open');
  conflictModal.setAttribute('aria-hidden', 'false');
}

function closeConflictModal() {
  if (!conflictModal) return;
  conflictModal.classList.remove('open');
  conflictModal.setAttribute('aria-hidden', 'true');
}

async function resolveConflict(decision) {
  closeConflictModal();
  const res = await sendMessage({ type: 'RESOLVE_SAVE_CONFLICT', decision });
  if (decision !== 'cancel') {
    await loadList();
  }
  if (res && !res.ok && res.error === 'no_pending') {
    // expired — ignore
  }
}

function initConflictUi() {
  if (!conflictModal) return;
  conflictCancel?.addEventListener('click', () => resolveConflict('cancel'));
  conflictReplace?.addEventListener('click', () => resolveConflict('replace'));
  conflictKeepBoth?.addEventListener('click', () => resolveConflict('keep-both'));
  conflictModal.addEventListener('click', (e) => {
    if (e.target === conflictModal) resolveConflict('cancel');
  });
}

// ─── Manual wall dedupe scan ───────────────────────────────────────

/** @type {Array<{url:string, items:object[], mode:string, keepIds:Set<string>}>} */
let dedupeState = [];

function closeDedupeBox(sync = true) {
  if (!dedupeBox) return;
  dedupeBox.classList.remove('open');
  dedupeBox.setAttribute('aria-hidden', 'true');
  if (sync) syncFloatBackdrop();
}

function centerDedupeBox() {
  // Dedupe is a right-side drawer in the redesigned wall; keep the legacy
  // call sites harmless without writing inline left/top coordinates.
}

async function openDedupeBox() {
  if (!dedupeBox) return;
  closeAllFloatsExcept('dedupe');
  closeSettingsBox(false);
  dedupeBox.classList.add('open');
  dedupeBox.setAttribute('aria-hidden', 'false');
  syncFloatBackdrop();
  centerDedupeBox();
  await runDedupeScan();
  requestAnimationFrame(() => {
    centerDedupeBox();
    requestAnimationFrame(() => centerDedupeBox());
  });
}

function setClusterKeepMode(cluster, mode) {
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

function renderDedupeClusters() {
  if (!dedupeClustersEl) return;
  dedupeClustersEl.innerHTML = '';
  if (!dedupeState.length) {
    dedupeClustersEl.innerHTML = `<div class="dedupe-empty">${escapeHtml(t('dedupeNoDupes'))}</div>`;
    if (dedupeStatus) dedupeStatus.textContent = t('dedupeNoDupes');
    return;
  }
  if (dedupeStatus) {
    dedupeStatus.textContent = t('dedupeCount', { n: dedupeState.length });
  }

  dedupeState.forEach((cluster, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'dedupe-cluster';
    wrap.dataset.idx = String(idx);

    const tools = document.createElement('div');
    tools.className = 'cluster-tools';
    const mkBtn = (label, mode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (cluster.mode === mode ? ' primary' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        setClusterKeepMode(cluster, mode);
        renderDedupeClusters();
      });
      return b;
    };
    tools.append(
      mkBtn(t('dedupeKeepAll'), 'all'),
      mkBtn(t('dedupeKeepNewest'), 'newest'),
      mkBtn(t('dedupeKeepOldest'), 'oldest')
    );

    const urlEl = document.createElement('div');
    urlEl.className = 'cluster-url';
    urlEl.textContent = `${cluster.url} · ${t('dedupeCount', { n: cluster.items.length })}`;

    wrap.appendChild(urlEl);
    wrap.appendChild(tools);

    for (const it of cluster.items) {
      const row = document.createElement('div');
      row.className = 'dedupe-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = cluster.keepIds.has(it.id);
      cb.addEventListener('change', () => {
        cluster.mode = 'manual';
        if (cb.checked) cluster.keepIds.add(it.id);
        else cluster.keepIds.delete(it.id);
        // ensure at least one kept
        if (cluster.keepIds.size === 0) {
          cb.checked = true;
          cluster.keepIds.add(it.id);
        }
      });
      row.appendChild(cb);
      appendDedupeThumb(row, it);
      const body = document.createElement('div');
      body.className = 'di-body';
      body.innerHTML = `
        <div class="di-title">${escapeHtml(it.title || '—')}</div>
        <div class="di-meta">${escapeHtml(t('dedupeSavedAt', { t: formatSavedAt(it.savedAt) }))}</div>
      `;
      row.appendChild(body);
      appendDedupePreviewBtn(row, it);
      wrap.appendChild(row);
    }

    dedupeClustersEl.appendChild(wrap);
  });
  centerDedupeBox();
}

async function runDedupeScan() {
  if (dedupeStatus) dedupeStatus.textContent = '…';
  const res = await sendMessage({ type: 'SCAN_DUPLICATES' });
  const clusters = res?.ok && Array.isArray(res.clusters) ? res.clusters : [];
  dedupeState = clusters.map((c) => {
    const cluster = {
      url: c.url,
      items: Array.isArray(c.items) ? c.items : [],
      mode: 'newest',
      keepIds: new Set(),
    };
    setClusterKeepMode(cluster, 'newest');
    return cluster;
  });
  renderDedupeClusters();
  requestAnimationFrame(() => centerDedupeBox());
}

async function applyDedupeChoices() {
  const ops = dedupeState
    .filter((c) => c.keepIds.size > 0 && c.keepIds.size < c.items.length)
    .map((c) => ({ url: c.url, keepIds: [...c.keepIds] }));

  if (!ops.length) {
    if (dedupeStatus) dedupeStatus.textContent = t('dedupeApplyNone');
    return;
  }

  const res = await sendMessage({ type: 'APPLY_DEDUPE', ops });
  if (res?.ok) {
    if (dedupeStatus) dedupeStatus.textContent = t('dedupeApplyOk', { n: res.deleted || 0 });
    await loadList();
    await runDedupeScan();
  } else if (dedupeStatus) {
    dedupeStatus.textContent = res?.error || 'error';
  }
}

function initDedupeUi() {
  initConflictUi();
  openDedupeBtn?.addEventListener('click', async () => {
    await openDedupeBox();
  });
  dedupeCloseX?.addEventListener('click', () => closeDedupeBox());
  dedupeRescanBtn?.addEventListener('click', () => runDedupeScan());
  dedupeApplyBtn?.addEventListener('click', () => applyDedupeChoices());
  if (dedupeDrag && dedupeBox) setupFloatDrag(dedupeDrag, dedupeBox);
}

function placeFloatBox(el) {
  const w = el.offsetWidth || 440;
  const h = el.offsetHeight || 360;
  el.style.left = `${Math.max(16, Math.round((window.innerWidth - w) / 2))}px`;
  el.style.top = `${Math.max(16, Math.round((window.innerHeight - h) / 2))}px`;
}

function setupFloatDrag(handle, box) {
  if (!handle || !box) return;
  if (box.matches('#settingsBox, #tagsBox, #helpBox, #dedupeBox')) return;
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

function applySettingsSection(section = 'general') {
  const allowed = new Set(['general', 'canvas', 'display', 'tools', 'backup', 'shortcuts', 'diagnostic']);
  settingsSection = allowed.has(section) ? section : 'general';
  settingsEl?.querySelectorAll('.settings-block[data-settings-section]').forEach((block) => {
    block.hidden = block.dataset.settingsSection !== settingsSection;
  });
  settingsNav?.querySelectorAll('.settings-nav-btn[data-settings-section]').forEach((button) => {
    const active = button.dataset.settingsSection === settingsSection;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function initSettingsSections() {
  settingsNav?.querySelectorAll('.settings-nav-btn[data-settings-section]').forEach((button) => {
    button.addEventListener('click', () => applySettingsSection(button.dataset.settingsSection));
  });
  settingsDoneBtn?.addEventListener('click', () => closeSettingsBox());
  applySettingsSection(settingsSection);
}

function anyFloatOpen() {
  return (
    settingsBox.classList.contains('open') ||
    tagsBox.classList.contains('open') ||
    helpBox.classList.contains('open') ||
    editBox.classList.contains('open') ||
    membersBox.classList.contains('open') ||
    (dedupeBox && dedupeBox.classList.contains('open')) ||
    (importPickBox && importPickBox.classList.contains('open')) ||
    (canvasStackDialog && canvasStackDialog.classList.contains('open'))
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
  if (except !== 'dedupe') closeDedupeBox(false);
  if (except !== 'importPick') closeImportPickBox(false);
  if (except !== 'canvasStack') closeCanvasStackDialog();
  syncFloatBackdrop();
}

function openSettingsBox() {
  closeAllFloatsExcept('settings');
  settingsBox.classList.add('open');
  settingsBox.setAttribute('aria-hidden', 'false');
  settingsBtn.classList.add('active');
  applySettingsSection(settingsSection);
  syncFloatBackdrop();
  refreshChromeCommandLabels();
  syncAutoBackupUi();
  refreshDiagLogPanel().catch(() => {});
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
  if (canvasStackDialog?.classList.contains('open')) {
    closeCanvasStackDialog();
    return;
  }
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
  if (dedupeBox?.classList.contains('open')) {
    closeDedupeBox();
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

viewModeBtn?.addEventListener('click', async () => {
  const nextMode = settings.viewMode === 'canvas' ? 'list' : 'canvas';
  if (nextMode === 'canvas') canvasSessionFallback = false;
  await saveSettings({ viewMode: nextMode });
  applyViewMode(nextMode);
  renderGrid();
});

sortByEl.addEventListener('change', async () => {
  await saveSettings({ sortBy: sortByEl.value });
  renderGrid();
});

pinnedOnlyBtn?.addEventListener('click', () => {
  pinnedOnly = !pinnedOnly;
  syncPinnedFilterUi();
  renderGrid();
});

cardColsEl.addEventListener('input', () => {
  applyCardCols(cardColsEl.value);
});

cardColsEl.addEventListener('change', async () => {
  await saveSettings({ cardCols: clampCols(cardColsEl.value) });
});

closeBtn.addEventListener('click', requestHostClose);
closeBtn.innerHTML = iconSvg('close');
closeBtn.setAttribute('aria-label', t('close'));
closeBtn.title = t('close');

// ─── Search ────────────────────────────────────────────────────────

function searchPlaceholderText() {
  const re = Boolean(settings.searchRegex);
  if (searchScope === 'tag') return re ? t('searchPhTagRegex') : t('searchPhTag');
  if (searchScope === 'note') return re ? t('searchPhNoteRegex') : t('searchPhNote');
  if (searchScope === 'group') return re ? t('searchPhGroupRegex') : t('searchPhGroup');
  return re ? t('searchRegexPh') : t('searchPh');
}

function syncSearchScopeUi() {
  const scoped = searchScope === 'tag' || searchScope === 'note' || searchScope === 'group';
  if (searchWrap) searchWrap.classList.toggle('has-scope', scoped);
  if (searchScopeChip) {
    if (scoped) {
      searchScopeChip.hidden = false;
      searchScopeChip.textContent = searchScope;
      searchScopeChip.title = t('searchScopeClear');
      searchScopeChip.setAttribute('aria-label', t('searchScopeClear'));
    } else {
      searchScopeChip.hidden = true;
      searchScopeChip.textContent = '';
    }
  }
  if (searchEl) {
    searchEl.placeholder = searchPlaceholderText();
    // "group" chip is wider than "tag"/"note" — pad input so caret is not covered
    if (scoped && searchScopeChip) {
      requestAnimationFrame(() => {
        if (!searchEl || !searchScopeChip || searchScopeChip.hidden) return;
        const w = searchScopeChip.offsetWidth || 0;
        searchEl.style.paddingLeft = `${Math.max(52, w + 16)}px`;
      });
    } else {
      searchEl.style.paddingLeft = '';
    }
  }
}

function syncSearchRegexUi() {
  const on = Boolean(settings.searchRegex);
  if (searchRegexBtn) {
    searchRegexBtn.classList.toggle('active', on);
    searchRegexBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    searchRegexBtn.title = t('searchRegexTitle');
  }
  if (searchEl) {
    searchEl.placeholder = searchPlaceholderText();
    if (!on) {
      searchEl.classList.remove('invalid');
      searchEl.removeAttribute('aria-invalid');
      searchEl.removeAttribute('title');
    } else {
      applySearchCompileState();
    }
  }
  syncSearchScopeUi();
}

function clearSearchInputKeepFocus() {
  if (!searchEl) return;
  searchEl.value = '';
  query = '';
  compiledSearch = { raw: '', re: null, err: null };
  searchEl.classList.remove('invalid');
  searchEl.removeAttribute('aria-invalid');
  searchEl.removeAttribute('title');
  searchEl.focus();
  if (searchRenderTimer) {
    clearTimeout(searchRenderTimer);
    searchRenderTimer = null;
  }
}

/** Empty query matches everything — no need to rebuild the canvas. */
function refilterSearchIfNeeded() {
  if (searchRenderTimer) {
    clearTimeout(searchRenderTimer);
    searchRenderTimer = null;
  }
  if (query) renderGrid();
  else {
    renderGrid(); // scope change (e.g. group) must refilter even with empty query
  }
}

async function applySearchTabToken(token) {
  if (token === 'tag' || token === 'note' || token === 'group' || token === 'all') {
    searchScope = token === 'all' ? 'all' : token;
    clearSearchInputKeepFocus();
    syncSearchScopeUi();
    refilterSearchIfNeeded();
    return;
  }
  if (token === 'regex') {
    if (!settings.searchRegex) {
      await saveSettings({ searchRegex: true });
    }
    clearSearchInputKeepFocus();
    syncSearchRegexUi();
    refilterSearchIfNeeded();
  }
}

/** Initial search mode: scope=all, regex off. Returns true if anything changed. */
async function resetSearchModesToDefault() {
  let changed = false;
  if (searchScope !== 'all') {
    searchScope = 'all';
    changed = true;
  }
  if (settings.searchRegex) {
    await saveSettings({ searchRegex: false });
    changed = true;
  }
  if (changed) {
    syncSearchRegexUi();
    refilterSearchIfNeeded();
  }
  return changed;
}

function isSearchInCustomMode() {
  return searchScope !== 'all' || Boolean(settings.searchRegex);
}

function parseRegexInput(raw) {
  const s = String(raw || '');
  // /pattern/flags form (flags: only gimsuyv)
  const m = /^\/((?:\\\/|[^/])+)\/([gimsuyv]*)$/.exec(s);
  if (m) {
    return { source: m[1], flags: m[2] || 'i' };
  }
  return { source: s, flags: 'i' };
}

function compileSearchQuery(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    compiledSearch = { raw: '', re: null, err: null };
    return compiledSearch;
  }
  if (!settings.searchRegex) {
    compiledSearch = { raw: trimmed, re: null, err: null };
    return compiledSearch;
  }
  if (trimmed.length > MAX_SEARCH_REGEX_LENGTH) {
    compiledSearch = { raw: trimmed, re: null, err: `pattern_too_long_${MAX_SEARCH_REGEX_LENGTH}` };
    return compiledSearch;
  }
  try {
    const { source, flags } = parseRegexInput(trimmed);
    // Drop sticky/global to avoid lastIndex side effects on repeated .test
    const safeFlags = flags.replace(/[gy]/g, '');
    const re = new RegExp(source, safeFlags || 'i');
    compiledSearch = { raw: trimmed, re, err: null };
  } catch (err) {
    compiledSearch = { raw: trimmed, re: null, err: String(err?.message || err) };
  }
  return compiledSearch;
}

function applySearchCompileState() {
  if (!searchEl) return;
  if (!settings.searchRegex || !query) {
    searchEl.classList.remove('invalid');
    searchEl.removeAttribute('aria-invalid');
    if (settings.searchRegex) searchEl.removeAttribute('title');
    return;
  }
  const { err } = compileSearchQuery(query);
  if (err) {
    searchEl.classList.add('invalid');
    searchEl.setAttribute('aria-invalid', 'true');
    searchEl.title = err;
  } else {
    searchEl.classList.remove('invalid');
    searchEl.removeAttribute('aria-invalid');
    searchEl.removeAttribute('title');
  }
}

let searchRenderTimer = null;
const SEARCH_RENDER_DEBOUNCE_MS = 120;

function setSearchQueryFromInput({ immediate = false } = {}) {
  // Keep original case for regex; plain mode lowercases inside matchesQuery
  query = searchEl.value.trim();
  compileSearchQuery(query);
  applySearchCompileState();
  if (immediate) {
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
    }
    renderGrid();
    return;
  }
  if (searchRenderTimer) clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(() => {
    searchRenderTimer = null;
    renderGrid();
  }, SEARCH_RENDER_DEBOUNCE_MS);
}

searchEl.addEventListener('input', () => {
  setSearchQueryFromInput({ immediate: false });
});

const SEARCH_TAB_TOKENS = {
  t: 'tag',
  tag: 'tag',
  n: 'note',
  note: 'note',
  g: 'group',
  group: 'group',
  re: 'regex',
  regex: 'regex',
  a: 'all',
  all: 'all',
};

searchEl.addEventListener('keydown', (e) => {
  // Empty field + Backspace/Delete → leave tag/note/regex back to default
  if (
    (e.key === 'Backspace' || e.key === 'Delete') &&
    searchEl.value === '' &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey
  ) {
    if (!isSearchInCustomMode()) return;
    e.preventDefault();
    e.stopPropagation();
    resetSearchModesToDefault();
    return;
  }

  if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  const token = searchEl.value.trim().toLowerCase();
  const mode = SEARCH_TAB_TOKENS[token];
  if (!mode) return;
  e.preventDefault();
  e.stopPropagation();
  applySearchTabToken(mode);
});

if (searchScopeChip) {
  searchScopeChip.addEventListener('click', () => {
    applySearchTabToken('all');
  });
}

if (searchRegexBtn) {
  searchRegexBtn.addEventListener('click', async () => {
    await saveSettings({ searchRegex: !settings.searchRegex });
    syncSearchRegexUi();
    compileSearchQuery(query);
    applySearchCompileState();
    refilterSearchIfNeeded();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    e.stopPropagation();
    focusSearch();
    return;
  }

  // ⌥⌘S (Mac) / Alt+Win+S — toggle settings; works even when search is focused
  if (
    e.altKey &&
    e.metaKey &&
    !e.ctrlKey &&
    (e.key === 's' || e.key === 'S' || e.code === 'KeyS')
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (settingsBox.classList.contains('open')) closeSettingsBox();
    else openSettingsBox();
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (canvasStackDialog?.classList.contains('open')) {
      closeCanvasStackDialog();
      return;
    }
    if (conflictModal?.classList.contains('open')) {
      resolveConflict('cancel');
      return;
    }
    if (importPreviewOverlay?.classList.contains('open')) {
      closeImportPreview();
      return;
    }
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
    if (dedupeBox?.classList.contains('open')) {
      closeDedupeBox();
      return;
    }
    if (importPickBox?.classList.contains('open')) {
      closeImportPickBox();
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
    if (document.activeElement === searchEl) {
      if (searchEl.value) {
        searchEl.value = '';
        query = '';
        compiledSearch = { raw: '', re: null, err: null };
        searchEl.classList.remove('invalid');
        searchEl.removeAttribute('aria-invalid');
        searchEl.removeAttribute('title');
        renderGrid();
        searchEl.blur();
        return;
      }
      if (isSearchInCustomMode()) {
        resetSearchModesToDefault();
        return;
      }
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
    case 'group-first':
      return arr.sort((a, b) => {
        const ga = a.kind === 'group' ? 0 : 1;
        const gb = b.kind === 'group' ? 0 : 1;
        if (ga !== gb) return ga - gb;
        return (b.savedAt || 0) - (a.savedAt || 0);
      });
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

function linkTextForItem(item) {
  if (item.kind === 'group') {
    return (item.tabs || [])
      .map((m) => m.url)
      .filter(Boolean)
      .join('\n');
  }
  return item.url || '';
}

function copyTextFallback(text) {
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
  const text = linkTextForItem(item);
  if (!text) {
    showCopyToast(t('copyFailed'));
    return;
  }
  // Prefer sync fallback first while still in the user-gesture stack (iframe-safe)
  if (copyTextFallback(text)) {
    showCopyToast(t('copied'));
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showCopyToast(t('copied'));
      return;
    }
  } catch {
    // fall through
  }
  showCopyToast(t('copyFailed'));
}

function showCopyToast(msg) {
  let el = document.getElementById('copyToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'copyToast';
    el.className = 'copy-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  if (copyToastTimer) clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 1400);
}

function isMultiSelectModifier(e) {
  return Boolean(e && (e.metaKey || e.ctrlKey || e.shiftKey));
}

function handleCardSelectClick(itemId, e) {
  if (!e) {
    if (!selectMode) setSelectMode(true);
    toggleSelect(itemId);
    lastAnchorId = itemId;
    return;
  }
  const visible = getVisibleTabs();
  const ids = visible.map((x) => x.id);
  const idx = ids.indexOf(itemId);
  if (e.shiftKey && lastAnchorId) {
    const a = ids.indexOf(lastAnchorId);
    if (a >= 0 && idx >= 0) {
      if (!selectMode) setSelectMode(true);
      const lo = Math.min(a, idx);
      const hi = Math.max(a, idx);
      for (let i = lo; i <= hi; i++) selectedIds.add(ids[i]);
      updateBatchBar();
      renderGrid();
      return;
    }
  }
  // ⌘/Ctrl toggle, Shift 起點, 或已在選擇模式：切換此項
  if (selectMode || e.metaKey || e.ctrlKey || e.shiftKey) {
    if (!selectMode) setSelectMode(true);
    toggleSelect(itemId);
    lastAnchorId = itemId;
  }
}

function getVisibleTabs() {
  return sortTabs(
    allTabs.filter((item) => (!pinnedOnly || item.pinned === true) && matchesQuery(item, query)),
    settings.sortBy || 'newest'
  );
}

function getCanvasVisibleTabs() {
  const visible = getVisibleTabs();
  if (canvasIndexFilter === 'unsorted') return visible.filter((item) => item.kind !== 'group');
  if (canvasIndexFilter === 'pinned') return visible.filter((item) => item.pinned === true);
  if (canvasIndexFilter.startsWith('stack:')) {
    const id = canvasIndexFilter.slice(6);
    return visible.filter((item) => item.id === id);
  }
  return visible;
}

function syncCanvasIndexUi() {
  const allButton = document.getElementById('canvasAllBtn');
  const unsortedButton = document.getElementById('canvasUnsortedBtn');
  const pinnedButton = document.getElementById('canvasPinnedBtn');
  const buttons = [allButton, unsortedButton, pinnedButton, ...document.querySelectorAll('[data-canvas-stack-filter]')].filter(Boolean);
  buttons.forEach((button) => button.classList.remove('active'));
  const active = canvasIndexFilter === 'unsorted'
    ? unsortedButton
    : canvasIndexFilter === 'pinned'
      ? pinnedButton
      : canvasIndexFilter.startsWith('stack:')
        ? document.querySelector(`[data-canvas-stack-filter="${CSS.escape(canvasIndexFilter.slice(6))}"]`)
        : allButton;
  active?.classList.add('active');
  const count = document.querySelector('[data-canvas-count]');
  if (count) count.textContent = String(getCanvasVisibleTabs().length);
}

function renderCanvasStackIndex() {
  const root = document.getElementById('canvasStackIndex');
  if (!root) return;
  const groups = allTabs.filter((item) => item.kind === 'group');
  if (canvasIndexFilter.startsWith('stack:') && !groups.some((group) => group.id === canvasIndexFilter.slice(6))) {
    canvasIndexFilter = 'all';
  }
  root.innerHTML = groups
    .map((group) => `<button type="button" data-canvas-stack-filter="${escapeAttr(group.id)}" title="${escapeAttr(itemTitle(group))}">${escapeHtml(itemTitle(group))}</button>`)
    .join('');
  root.querySelectorAll('[data-canvas-stack-filter]').forEach((button) => {
    button.addEventListener('click', () => setCanvasIndexFilter(`stack:${button.dataset.canvasStackFilter}`));
  });
  syncCanvasIndexUi();
}

function setCanvasIndexFilter(filter) {
  canvasIndexFilter = String(filter || 'all');
  syncCanvasIndexUi();
  renderCanvas();
}

function itemHaystack(item, scope = searchScope) {
  if (scope === 'group') {
    // Only group cards; name + member tabs (title/url/domain)
    if (item.kind !== 'group') return '';
    const parts = [item.title || ''];
    for (const m of item.tabs || []) {
      parts.push(m.title || '', m.url || '', domainOf(m.url));
    }
    return parts.join(' ');
  }
  if (scope === 'tag') {
    if (item.kind === 'group') {
      const parts = [...(Array.isArray(item.tags) ? item.tags : [])];
      for (const m of item.tabs || []) {
        if (Array.isArray(m.tags)) parts.push(...m.tags);
      }
      return parts.join(' ');
    }
    return (Array.isArray(item.tags) ? item.tags : []).join(' ');
  }
  if (scope === 'note') {
    if (item.kind === 'group') {
      const parts = [item.note || ''];
      for (const m of item.tabs || []) parts.push(m.note || '');
      return parts.join(' ');
    }
    return item.note || '';
  }
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
    return parts.join(' ');
  }
  return [
    item.title || '',
    item.url || '',
    domainOf(item.url),
    item.note || '',
    ...(Array.isArray(item.tags) ? item.tags : []),
  ].join(' ');
}

/**
 * Plain search: case-insensitive.
 * - `||`  OR between groups
 * - `&&` or whitespace  AND within a group
 * Examples: `grafana||zabbix`  |  `grafana zabbix`  |  `grafana&&zabbix`
 */
function matchesPlainQuery(hay, q) {
  const hayLower = String(hay).toLowerCase();
  const raw = String(q || '').trim();
  if (!raw) return true;

  const orGroups = raw
    .split(/\s*\|\|\s*/)
    .map((g) => g.trim())
    .filter(Boolean);
  if (!orGroups.length) return true;

  return orGroups.some((group) => {
    const terms = group
      .split(/\s*&&\s*|\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!terms.length) return true;
    return terms.every((term) => hayLower.includes(term));
  });
}

function textMatchesQuery(text, q) {
  if (!q) return true;
  if (settings.searchRegex) {
    const compiled =
      compiledSearch.raw === q ? compiledSearch : compileSearchQuery(q);
    if (!compiled.re) return false;
    compiled.re.lastIndex = 0;
    return compiled.re.test(String(text || ''));
  }
  return matchesPlainQuery(text, q);
}

function memberHaystack(member, scope = searchScope) {
  if (!member) return '';
  if (scope === 'group') {
    return [member.title || '', member.url || '', domainOf(member.url)].join(' ');
  }
  if (scope === 'tag') {
    return (Array.isArray(member.tags) ? member.tags : []).join(' ');
  }
  if (scope === 'note') {
    return member.note || '';
  }
  return [
    member.title || '',
    member.url || '',
    domainOf(member.url),
    member.note || '',
    ...(Array.isArray(member.tags) ? member.tags : []),
  ].join(' ');
}

function groupMetaHaystack(group, scope = searchScope) {
  if (scope === 'group') {
    return group.title || '';
  }
  if (scope === 'tag') {
    return (Array.isArray(group.tags) ? group.tags : []).join(' ');
  }
  if (scope === 'note') {
    return group.note || '';
  }
  return [
    group.title || '',
    group.note || '',
    ...(Array.isArray(group.tags) ? group.tags : []),
  ].join(' ');
}

function getMatchingMembers(group, q = query) {
  if (!q || !group || group.kind !== 'group') return [];
  return (group.tabs || []).filter((m) => textMatchesQuery(memberHaystack(m), q));
}

function groupMetaMatches(group, q = query) {
  if (!q || !group || group.kind !== 'group') return false;
  return textMatchesQuery(groupMetaHaystack(group), q);
}

/** Per-render cache: avoid double getMatchingMembers for filter + hit rows. */
/** @type {Map<string, { hits: any[], metaHit: boolean }> | null} */
let searchMatchCache = null;

function getGroupSearchMatch(group, q = query) {
  if (!group || group.kind !== 'group') return { hits: [], metaHit: false };
  if (searchMatchCache && searchMatchCache.has(group.id)) {
    return searchMatchCache.get(group.id);
  }
  const metaHit = !q ? false : groupMetaMatches(group, q);
  const hits = !q ? [] : getMatchingMembers(group, q);
  const result = { hits, metaHit };
  if (searchMatchCache) searchMatchCache.set(group.id, result);
  return result;
}

function matchesQuery(item, q) {
  if (!q) {
    // Empty query: group scope still only shows groups
    if (searchScope === 'group') return item?.kind === 'group';
    return true;
  }
  if (searchScope === 'group') {
    if (item?.kind !== 'group') return false;
    const { hits, metaHit } = getGroupSearchMatch(item, q);
    return metaHit || hits.length > 0;
  }
  const hay = itemHaystack(item);
  return textMatchesQuery(hay, q);
}

const SEARCH_HIT_LIMIT = 8;

/** Append matching member rows under a group card/row when searching. */
function appendGroupSearchHits(parentEl, group) {
  if (!query || !parentEl || group?.kind !== 'group') return;

  const { hits, metaHit } = getGroupSearchMatch(group, query);
  if (!hits.length && !metaHit) return;

  const box = document.createElement('div');
  box.className = 'search-hits';
  box.addEventListener('click', (e) => e.stopPropagation());
  box.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (hits.length) {
    const head = document.createElement('div');
    head.className = 'search-hits-head';
    head.textContent = t('searchHitsCount', { n: hits.length });
    box.appendChild(head);

    const show = hits.slice(0, SEARCH_HIT_LIMIT);
    for (const m of show) {
      const row = document.createElement('div');
      row.className = 'search-hit';

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'search-hit-main';
      main.title = t('memberRestore');
      main.innerHTML = `
        <div class="search-hit-title">${escapeHtml(m.title || m.url || '—')}</div>
        <div class="search-hit-url">${escapeHtml(m.url || '')}</div>
      `;
      main.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (selectMode) return;
        restoreMember(group.id, m.id);
      });

      const actions = document.createElement('div');
      actions.className = 'search-hit-actions';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'icon-btn sm';
      prevBtn.title = t('expand');
      prevBtn.innerHTML = iconSvg('expand');
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLightbox(m, { groupId: group.id });
      });

      const restBtn = document.createElement('button');
      restBtn.type = 'button';
      restBtn.className = 'icon-btn sm';
      restBtn.title = t('memberRestore');
      restBtn.innerHTML = iconSvg('restore');
      restBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        restoreMember(group.id, m.id);
      });

      actions.append(prevBtn, restBtn);
      row.append(main, actions);
      box.appendChild(row);
    }

    if (hits.length > SEARCH_HIT_LIMIT) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'search-hits-more';
      more.textContent = t('searchHitsMore', { n: hits.length - SEARCH_HIT_LIMIT });
      more.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMembersBox(group);
      });
      box.appendChild(more);
    }
  } else if (metaHit) {
    const head = document.createElement('div');
    head.className = 'search-hits-head meta-only';
    head.textContent = t('searchHitGroupMeta');
    box.appendChild(head);
  }

  parentEl.appendChild(box);
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
    entry.restore.type === 'member' ? { type: 'member', groupId: entry.restore.groupId } : null;
  lightboxNav = { list, index };
  lbTitle.textContent = entry.title;
  lbUrl.textContent = entry.url;
  lbImage.hidden = false;
  if (lbGroupMosaic) {
    lbGroupMosaic.hidden = true;
    lbGroupMosaic.replaceChildren();
  }
  if (lbPrev) lbPrev.hidden = false;
  if (lbNext) lbNext.hidden = false;
  if (lbRestore) {
    lbRestore.dataset.i18n = 'restore';
    lbRestore.textContent = t('restore');
  }
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

function openCanvasGroupLightbox(group) {
  if (!group || group.kind !== 'group' || !lbGroupMosaic) return;
  expandedId = group.id;
  expandedMeta = { type: 'group' };
  lightboxNav = null;
  lbTitle.textContent = itemTitle(group);
  lbUrl.textContent = t('groupTabs', { n: (group.tabs || []).length });
  if (lbCounter) lbCounter.textContent = '—';
  if (lbPrev) lbPrev.hidden = true;
  if (lbNext) lbNext.hidden = true;
  if (lbRestore) {
    lbRestore.dataset.i18n = 'restoreGroup';
    lbRestore.textContent = t('restoreGroup');
  }
  lbImage.removeAttribute('src');
  lbImage.hidden = true;
  lbGroupMosaic.innerHTML = groupCoverHtml(group);
  lbGroupMosaic.hidden = false;
  lbGroupMosaic.querySelectorAll('img.lazy-thumb').forEach((img) => observeThumb(img));
  lbSnapHint.hidden = true;
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
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
  lbImage.hidden = false;
  lbImage.removeAttribute('src');
  if (lbGroupMosaic) {
    lbGroupMosaic.hidden = true;
    lbGroupMosaic.replaceChildren();
  }
  if (lbPrev) lbPrev.hidden = false;
  if (lbNext) lbNext.hidden = false;
  if (lbRestore) {
    lbRestore.dataset.i18n = 'restore';
    lbRestore.textContent = t('restore');
  }
  if (lbCounter) lbCounter.textContent = '—';
}

lbClose.addEventListener('click', closeLightbox);
if (lbPrev) lbPrev.addEventListener('click', () => navigateLightbox(-1));
if (lbNext) lbNext.addEventListener('click', () => navigateLightbox(1));

lbRestore.addEventListener('click', async () => {
  if (!expandedId) return;
  if (expandedMeta?.type === 'group') {
    await restoreItem(expandedId);
    return;
  }
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
  editTagList.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)} <button type="button" aria-label="remove">${iconSvg('close')}</button>`;
    chip.querySelector('button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentIndex = editTagList.indexOf(tag);
      if (currentIndex === -1) return;
      editTagList.splice(currentIndex, 1);
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
      <button type="button" class="name tag-filter-btn" title="${escapeAttr(t('tagApplyFilter'))}" aria-label="${escapeAttr(t('tagApplyFilter'))}">${escapeHtml(item.name)}</button>
      <span class="count">${escapeHtml(String(item.count))}</span>
      <button type="button" class="chip-btn rename-btn" title="${escapeAttr(t('rename'))}">${iconSvg('edit')}</button>
      <button type="button" class="chip-btn delete-btn" title="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
    `;

    row.querySelector('.tag-filter-btn').addEventListener('click', () => {
      searchScope = 'tag';
      searchEl.value = item.name;
      setSearchQueryFromInput({ immediate: true });
      syncSearchScopeUi();
      closeTagsBox();
    });

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

let autoBackupLocalRunning = false;

/** Immediate / catch-up auto backup via background downloads. */
async function runLocalAutoBackup({ force = false } = {}) {
  if (autoBackupLocalRunning) return { ok: false, error: 'busy' };
  const ab = normalizeAutoBackup(settings.autoBackup);
  if (!force && !ab.enabled) return { ok: false, error: 'disabled' };

  autoBackupLocalRunning = true;
  if (autoBackupStatusEl) autoBackupStatusEl.textContent = t('autoBackupRunning');
  try {
    const res = await sendMessage({
      type: 'AUTO_BACKUP_RUN',
      force: true,
      reason: force ? 'manual' : 'local',
    });
    settings = await loadSettings();
    syncAutoBackupUi();
    if (res?.ok) {
      if (autoBackupStatusEl) {
        autoBackupStatusEl.textContent = t('autoBackupOk', {
          file: res.filename || res.absoluteFile || ab.subfolder,
        });
      }
      return res;
    }
    const err = res?.error || 'write_failed';
    if (autoBackupStatusEl) {
      autoBackupStatusEl.textContent = autoBackupErrorText(err, res?.detail);
    }
    return { ok: false, error: err };
  } finally {
    autoBackupLocalRunning = false;
  }
}

async function maybeCatchUpAutoBackup() {
  const ab = normalizeAutoBackup(settings.autoBackup);
  if (!ab.enabled) return;
  const dueDirty = ab.onChange && ab.dirtyAt > 0;
  const intervalMs = Math.max(10, autoBackupIntervalMinutes(ab)) * 60 * 1000;
  const dueSchedule = !ab.lastSuccessAt || Date.now() - ab.lastSuccessAt >= intervalMs;
  if (!dueDirty && !dueSchedule) return;
  await runLocalAutoBackup({ force: false });
}

/** Hydrate thumb/snap from local IDB for full ZIP (avoids huge SW messages). */
async function mapWithConcurrencyLocal(values, limit, mapper) {
  const list = Array.isArray(values) ? values : [];
  const result = new Array(list.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= list.length) return;
      result[index] = await mapper(list[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), list.length || 1) }, worker)
  );
  return result;
}

async function hydrateItemMediaLocal(item) {
  if (!item) return item;
  if (item.kind === 'group') {
    const tabs = await mapWithConcurrencyLocal(item.tabs || [], 4, async (m) => {
      const key = mediaKeyForMember(item.id, m.id);
      let thumb = '';
      let snap = '';
      try {
        if (Media) {
          const row = await Media.get(key);
          if (row?.thumb) thumb = await Media.blobToDataUrl(row.thumb);
          if (row?.snap) snap = await Media.blobToDataUrl(row.snap);
        }
      } catch (err) {
        uiLog('warn', 'export', 'media get failed', `${key} ${err?.message || err}`);
      }
      return { ...m, thumbnail: thumb, snapshot: snap };
    });
    return { ...item, tabs };
  }
  const key = mediaKeyForItem(item);
  let thumbnail = '';
  let snapshot = '';
  try {
    if (Media && key) {
      const row = await Media.get(key);
      if (row?.thumb) thumbnail = await Media.blobToDataUrl(row.thumb);
      if (row?.snap) snapshot = await Media.blobToDataUrl(row.snap);
    }
  } catch (err) {
    uiLog('warn', 'export', 'media get failed', `${key} ${err?.message || err}`);
  }
  return { ...item, thumbnail, snapshot };
}

exportLiteBtn.addEventListener('click', async () => {
  backupStatus.textContent = t('backupExporting');
  uiLog('info', 'export', 'lite start');
  try {
    const res = await sendMessage({ type: 'EXPORT_BACKUP', mode: 'lite' });
    if (!res.ok || !res.backup) {
      const err = res?.error || 'export_failed';
      uiLog('error', 'export', 'lite failed', err);
      backupStatus.textContent = `${t('backupError')}: ${err}`;
      return;
    }
    const { blob, filename } = Build.buildLiteBlob(res.backup, { auto: false });
    downloadBlob(blob, filename);
    uiLog('info', 'export', 'lite ok', `file=${filename} bytes=${blob.size}`);
    backupStatus.textContent = t('backupExported');
  } catch (err) {
    uiLog('error', 'export', 'lite exception', err?.message || err);
    backupStatus.textContent = `${t('backupError')}: ${err?.message || err}`;
  }
});

exportFullBtn.addEventListener('click', async () => {
  backupStatus.textContent = t('backupExporting');
  uiLog('info', 'export', 'full start');
  try {
    // Meta only over the wire — hydrate images in this page from IDB
    const res = await sendMessage({ type: 'EXPORT_BACKUP', mode: 'full' });
    if (!res.ok || !res.backup) {
      const err = res?.error || 'export_failed';
      uiLog('error', 'export', 'full meta failed', err);
      backupStatus.textContent = `${t('backupError')}: ${err}`;
      return;
    }
    const rawItems = res.backup.parkedItems || [];
    uiLog('info', 'export', 'hydrating media', `items=${rawItems.length}`);
    let hydratedCount = 0;
    const hydrated = await mapWithConcurrencyLocal(rawItems, 4, async (item) => {
      const result = await hydrateItemMediaLocal(item);
      hydratedCount++;
      if (hydratedCount % 20 === 0 || hydratedCount === rawItems.length) {
        backupStatus.textContent = `${t('backupExporting')} (${hydratedCount}/${rawItems.length})`;
      }
      return result;
    });
    const backup = {
      ...res.backup,
      media: 'inline',
      parkedItems: hydrated,
    };
    const { blob, filename } = Build.buildFullZipBlob(backup, { auto: false });
    downloadBlob(blob, filename);
    uiLog('info', 'export', 'full ok', `file=${filename} bytes=${blob.size}`);
    backupStatus.textContent = t('backupExported');
  } catch (err) {
    console.warn(err);
    uiLog('error', 'export', 'full exception', err?.message || err);
    backupStatus.textContent = `${t('backupError')}: ${err?.message || err}`;
  }
});

importBackupBtn.addEventListener('click', () => {
  backupStatus.textContent = '';
  pendingImportMode = 'replace';
  importBackupFile.click();
});

importAppendBtn?.addEventListener('click', () => {
  backupStatus.textContent = '';
  pendingImportMode = 'append';
  importBackupFile.click();
});

function closeImportPickBox(sync = true) {
  if (!importPickBox) return;
  closeImportPreview();
  importPickBox.classList.remove('open');
  importPickBox.setAttribute('aria-hidden', 'true');
  pendingImportPick = null;
  if (importPickList) importPickList.innerHTML = '';
  if (importPickStatus) importPickStatus.textContent = '';
  if (sync) syncFloatBackdrop();
}

function updateImportPickCount() {
  if (!pendingImportPick || !importPickCount) return;
  const total = (pendingImportPick.backup.parkedItems || []).length;
  const n = pendingImportPick.selected.size;
  importPickCount.textContent = t('importPickCount', { n, total });
}

/** Prefer full snapshot, then thumbnail (data-URL only after ZIP rehydrate). */
function pickImportImageDataUrl(item) {
  if (!item || typeof item !== 'object') return '';
  for (const key of ['snapshot', 'thumbnail']) {
    const v = item[key];
    if (typeof v === 'string' && v.startsWith('data:')) return v;
  }
  return '';
}

function newImportStageId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // fall through to a local opaque id
  }
  return `stage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Convert preview data URLs into shared IndexedDB blobs before messaging SW. */
async function stageImportMedia(stageId, items) {
  if (!Media?.dataUrlToBlob || !Media?.putImportStage) {
    throw new Error('import_stage_unavailable');
  }
  const rows = [];
  const stagedItems = (Array.isArray(items) ? items : []).map((raw) => {
    const item = { ...raw };
    const stageOwner = (owner, mediaKey) => {
      const thumb = owner.thumbnail ? Media.dataUrlToBlob(owner.thumbnail) : null;
      const snap = owner.snapshot ? Media.dataUrlToBlob(owner.snapshot) : null;
      if ((owner.thumbnail && !thumb) || (owner.snapshot && !snap)) {
        throw new Error('invalid_image');
      }
      if (thumb || snap) rows.push({ mediaKey, thumb, snap });
      owner.hasThumb = Boolean(thumb);
      owner.hasSnap = Boolean(snap);
      owner.thumbnail = '';
      owner.snapshot = '';
    };

    if (item.kind === 'group' || Array.isArray(item.tabs)) {
      // Group-level media is not a persisted format; never carry it into the
      // transport payload even if an old backup contains unexpected fields.
      item.hasThumb = false;
      item.hasSnap = false;
      item.thumbnail = '';
      item.snapshot = '';
      item.tabs = (item.tabs || []).map((rawMember) => {
        const member = { ...rawMember };
        stageOwner(member, Media.mediaKeyMember(item.id, member.id));
        return member;
      });
    } else {
      stageOwner(item, Media.mediaKeyTab(item.id));
    }
    return item;
  });
  await Media.putImportStage(stageId, rows);
  return { items: stagedItems, mediaOwners: rows.length };
}

function closeImportPreview() {
  if (!importPreviewOverlay) return;
  importPreviewOverlay.classList.remove('open');
  importPreviewOverlay.setAttribute('aria-hidden', 'true');
  if (importPreviewBody) importPreviewBody.innerHTML = '';
  if (importPreviewTitle) importPreviewTitle.textContent = '—';
  if (importPreviewUrl) importPreviewUrl.textContent = '';
}

function openImportTabPreview(item) {
  if (!importPreviewOverlay || !importPreviewBody) return;
  const title = item?.title || item?.url || '—';
  const url = item?.url || '';
  if (importPreviewTitle) importPreviewTitle.textContent = title;
  if (importPreviewUrl) {
    importPreviewUrl.textContent = isStoredOnlyUrl(url) ? `${url} · ${t('storedOnly')}` : url;
  }
  importPreviewBody.innerHTML = '';
  const src = pickImportImageDataUrl(item);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = title;
    importPreviewBody.appendChild(img);
  } else {
    const empty = document.createElement('div');
    empty.className = 'import-preview-empty';
    empty.textContent = t('importPreviewNoImage');
    importPreviewBody.appendChild(empty);
  }
  importPreviewOverlay.classList.add('open');
  importPreviewOverlay.setAttribute('aria-hidden', 'false');
}

function openImportGroupPreview(item) {
  if (!importPreviewOverlay || !importPreviewBody) return;
  const title = item?.title || t('stackTitle');
  const members = Array.isArray(item?.tabs) ? item.tabs : [];
  if (importPreviewTitle) importPreviewTitle.textContent = title;
  if (importPreviewUrl) {
    importPreviewUrl.textContent = t('groupTabs', { n: members.length });
  }
  importPreviewBody.innerHTML = '';
  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'import-preview-empty';
    empty.textContent = t('importPreviewGroupEmpty');
    importPreviewBody.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'import-preview-members';
    members.forEach((m) => {
      const row = document.createElement('div');
      const storedOnly = isStoredOnlyUrl(m?.url);
      row.className = `import-preview-member${storedOnly ? ' stored-only' : ''}`;
      const mTitle = m?.title || m?.url || '—';
      const mUrl = m?.url || '';
      const thumb = pickImportImageDataUrl(m);
      row.innerHTML = `
        ${
          thumb
            ? `<img src="${escapeAttr(thumb)}" alt="" style="width:48px;height:30px;object-fit:cover;border-radius:6px;flex-shrink:0;background:var(--input-bg)" />`
            : ''
        }
        <div class="m-main">
          <div class="m-title">
            ${escapeHtml(mTitle)}
            ${storedOnly ? `<span class="stored-only-badge">${escapeHtml(t('storedOnlyShort'))}</span>` : ''}
          </div>
          <div class="m-url">${escapeHtml(mUrl)}</div>
        </div>
        <button type="button" class="btn import-pick-preview">${escapeHtml(t('importPickPreview'))}</button>
      `;
      row.querySelector('button')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openImportTabPreview(m);
      });
      list.appendChild(row);
    });
    importPreviewBody.appendChild(list);
  }
  importPreviewOverlay.classList.add('open');
  importPreviewOverlay.setAttribute('aria-hidden', 'false');
}

function openImportPickBox(mode, backup, warnings = {}) {
  if (!importPickBox || !importPickList) return;
  const items = Array.isArray(backup.parkedItems) ? backup.parkedItems : [];
  const selected = new Set(items.map((it, i) => String(it.id || `idx-${i}`)));
  // Ensure each item has a stable pick key
  items.forEach((it, i) => {
    if (!it.id) it.id = `idx-${i}-${Date.now()}`;
    selected.add(String(it.id));
  });
  pendingImportPick = { mode, backup, selected, warnings };

  closeAllFloatsExcept('importPick');
  importPickBox.classList.add('open');
  importPickBox.setAttribute('aria-hidden', 'false');
  if (importPickHintEl) {
    const modeLabel =
      mode === 'append' ? t('importPickModeAppend') : t('importPickModeReplace');
    importPickHintEl.textContent = `${t('importPickHint')} ${modeLabel}`;
  }
  if (importPickStatus) importPickStatus.textContent = formatImportWarnings(warnings);

  importPickList.innerHTML = '';
  items.forEach((item) => {
    const id = String(item.id);
    const isGroup = item.kind === 'group' || Array.isArray(item.tabs);
    const storedOnlyCount = countStoredOnlyUrls(item);
    const title = isGroup
      ? item.title || t('stackTitle')
      : item.title || item.url || '—';
    const sub = isGroup
      ? `${t('groupTabs', { n: (item.tabs || []).length })}${storedOnlyCount ? ` · ${t('backupStoredOnly', { n: storedOnlyCount })}` : ''}`
      : isStoredOnlyUrl(item.url)
        ? `${item.url || ''} · ${t('storedOnly')}`
        : item.url || '';
    const kindLabel = isGroup ? 'group' : storedOnlyCount ? t('storedOnlyShort') : 'tab';

    const row = document.createElement('div');
    row.className = `import-pick-row${storedOnlyCount ? ' stored-only' : ''}`;
    row.innerHTML = `
      <label class="import-pick-label">
        <input type="checkbox" data-pick-id="${escapeAttr(id)}" ${selected.has(id) ? 'checked' : ''} />
        <span class="import-pick-kind ${isGroup ? 'group' : storedOnlyCount ? 'stored-only' : ''}">${escapeHtml(kindLabel)}</span>
        <span class="import-pick-main">
          <div class="import-pick-title">${escapeHtml(title)}</div>
          <div class="import-pick-sub">${escapeHtml(sub)}</div>
        </span>
      </label>
      <button type="button" class="btn import-pick-preview">${escapeHtml(t('importPickPreview'))}</button>
    `;
    const cb = row.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) pendingImportPick.selected.add(id);
      else pendingImportPick.selected.delete(id);
      updateImportPickCount();
    });
    row.querySelector('.import-pick-preview')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isGroup) openImportGroupPreview(item);
      else openImportTabPreview(item);
    });
    importPickList.appendChild(row);
  });
  updateImportPickCount();
  placeFloatBox(importPickBox);
  syncFloatBackdrop();
}

async function confirmImportPick() {
  return withUiActionLock('import', confirmImportPickUnlocked);
}

async function confirmImportPickUnlocked() {
  if (!pendingImportPick) return;
  const { mode, backup, selected } = pendingImportPick;
  if (!selected.size) {
    if (importPickStatus) importPickStatus.textContent = t('importPickEmpty');
    return;
  }
  const confirmMsg =
    mode === 'append'
      ? t('backupAppendConfirm')
      : t('backupConfirm');
  if (!window.confirm(confirmMsg)) return;

  const all = Array.isArray(backup.parkedItems) ? backup.parkedItems : [];
  const filtered = all.filter((it) => selected.has(String(it.id)));
  const payload = {
    ...backup,
    parkedItems: filtered,
    parkedTabs: filtered
      .filter((i) => i.kind !== 'group' && !Array.isArray(i.tabs))
      .map(({ kind, hasThumb, hasSnap, ...rest }) => rest),
  };

  if (importPickStatus) importPickStatus.textContent = t('backupImporting');
  uiLog('info', 'import', `confirm mode=${mode}`, `selected=${filtered.length}/${all.length}`);
  let importId = '';
  let messageSent = false;
  try {
    importId = newImportStageId();
    const staged = await stageImportMedia(importId, filtered);
    const transportItems = staged.items;
    const transportBackup = {
      ...payload,
      media: 'idb',
      parkedItems: transportItems,
      parkedTabs: transportItems
        .filter((i) => i.kind !== 'group' && !Array.isArray(i.tabs))
        .map(({ kind, hasThumb, hasSnap, ...rest }) => rest),
    };
    const res = await sendMessage({
      type: 'IMPORT_BACKUP',
      backup: transportBackup,
      mode,
      importId,
    });
    messageSent = true;
    if (!res.ok) {
      const errorText = formatBackupError(res);
      if (importPickStatus) importPickStatus.textContent = errorText;
      backupStatus.textContent = errorText;
      uiLog('error', 'import', 'failed', `${res.error || 'invalid_backup'}${res.detail ? ` ${res.detail}` : ''}`);
      return;
    }
    closeImportPickBox();
    settings = await loadSettings();
    syncSettingsUi();
    await loadList();
    if (tagsBox.classList.contains('open')) await refreshTagManager();
    const warningText = formatImportWarnings(res.warnings);
    if (mode === 'append') {
      backupStatus.textContent = `${t('backupAppended', { n: res.added != null ? res.added : filtered.length })}${warningText ? ` ${warningText}` : ''}`;
    } else {
      backupStatus.textContent = `${t('backupImported')}${warningText ? ` ${warningText}` : ''}`;
    }
  } catch (err) {
    if (!messageSent && importId) {
      try {
        await Media.removeImportStage?.(importId);
      } catch {
        // best effort cleanup; the service worker also removes stale stages
      }
    }
    console.warn(err);
    uiLog('error', 'import', 'exception', err?.message || err);
    const errorText = formatBackupError(err?.message || err);
    if (importPickStatus) importPickStatus.textContent = errorText;
    backupStatus.textContent = errorText;
  }
}

importBackupFile.addEventListener('change', async () => {
  const file = importBackupFile.files && importBackupFile.files[0];
  importBackupFile.value = '';
  if (!file) return;
  const mode = pendingImportMode === 'append' ? 'append' : 'replace';
  pendingImportMode = 'replace';

  try {
    let backup;
    if (file.name.endsWith('.zip') || file.type === 'application/zip') {
      if (file.size > (Build.LIMITS?.MAX_ZIP_BYTES || 256 * 1024 * 1024)) {
        throw new Error('backup_too_large');
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const zipFiles = Build.unzipStore(buf);
      const jsonBytes = zipFiles['backup.json'];
      if (!jsonBytes) throw new Error('no backup.json');
      backup = JSON.parse(new TextDecoder().decode(jsonBytes));
      if (Array.isArray(backup.parkedItems)) {
        backup.parkedItems = Build.rehydrateMedia(
          backup.parkedItems,
          zipFiles,
          backup.mediaMimes || {}
        );
      }
    } else {
      if (file.size > (Build.LIMITS?.MAX_JSON_BYTES || 100 * 1024 * 1024)) {
        throw new Error('backup_too_large');
      }
      backup = JSON.parse(await file.text());
    }
    if (!backup || backup.format !== 'tabwall-backup') {
      const errorText = formatBackupError('invalid_format');
      backupStatus.textContent = errorText;
      uiLog('error', 'import', 'parse failed', 'invalid_format');
      return;
    }
    const prepared = Build.prepareImportedBackup(backup);
    if (!prepared?.ok) {
      const errorText = formatBackupError(prepared);
      backupStatus.textContent = errorText;
      uiLog('error', 'import', 'validation failed', prepared?.error || 'invalid_backup');
      return;
    }
    backup = prepared.backup;
    const validation = Build.validateBackup(backup, {
      allowStoredOnlyUrls: Boolean(prepared.allowStoredOnlyUrls),
    });
    if (!validation?.ok || !Array.isArray(backup.parkedItems)) {
      const errorText = formatBackupError(validation || 'invalid_backup');
      backupStatus.textContent = errorText;
      uiLog('error', 'import', 'validation failed', `${validation?.error || 'invalid_backup'}${validation?.detail ? ` ${validation.detail}` : ''}`);
      return;
    }
    openImportPickBox(mode, backup, prepared.warnings);
  } catch (err) {
    console.warn(err);
    const errorText = formatBackupError(err?.message || err);
    uiLog('error', 'import', 'parse failed', err?.message || err);
    backupStatus.textContent = errorText;
  }
});

importPickCloseX?.addEventListener('click', () => closeImportPickBox());
importPickCancelBtn?.addEventListener('click', () => closeImportPickBox());
importPickConfirmBtn?.addEventListener('click', () => {
  confirmImportPick();
});
importPickAllBtn?.addEventListener('click', () => {
  if (!pendingImportPick) return;
  (pendingImportPick.backup.parkedItems || []).forEach((it) =>
    pendingImportPick.selected.add(String(it.id))
  );
  importPickList?.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = true;
  });
  updateImportPickCount();
});
importPickNoneBtn?.addEventListener('click', () => {
  if (!pendingImportPick) return;
  pendingImportPick.selected.clear();
  importPickList?.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
  updateImportPickCount();
});
if (importPickDrag && importPickBox) setupFloatDrag(importPickDrag, importPickBox);
importPreviewCloseBtn?.addEventListener('click', () => closeImportPreview());
importPreviewOverlay?.addEventListener('click', (e) => {
  if (e.target === importPreviewOverlay) closeImportPreview();
});

manualAddBtn?.addEventListener('click', async () => {
  if (manualAddStatus) manualAddStatus.textContent = '';
  const text = manualAddText ? manualAddText.value : '';
  const res = await sendMessage({ type: 'CREATE_FROM_URL_TEXT', text });
  if (!res?.ok) {
    if (manualAddStatus) {
      const skip =
        res?.skipped > 0 ? ` ${t('manualAddSkipped', { n: res.skipped })}` : '';
      manualAddStatus.textContent = t('manualAddEmpty') + skip;
    }
    return;
  }
  await loadList();
  if (tagsBox.classList.contains('open')) await refreshTagManager();
  if (manualAddText) manualAddText.value = '';
  if (manualAddStatus) {
    let msg = t('manualAddOk', { n: res.added });
    if (res.skipped > 0) msg += ` ${t('manualAddSkipped', { n: res.skipped })}`;
    manualAddStatus.textContent = msg;
  }
});

// ─── Multi-select ──────────────────────────────────────────────────

function updateBatchBar() {
  const isCanvasUi = settings.viewMode === 'canvas' && !canvasSessionFallback;
  const selection = isCanvasUi ? activeCanvasSelection() : selectedIds;
  const n = selection.size;
  batchCount.textContent = t('batchCount', { n });
  if (isCanvasUi) {
    if (canvasContextBar) {
      canvasContextBar.classList.toggle('open', n > 0);
      canvasContextBar.setAttribute('aria-hidden', n > 0 ? 'false' : 'true');
      const count = canvasContextBar.querySelector('[data-canvas-selection-count]');
      if (count) count.textContent = t('batchCount', { n });
      const selectedItem = n === 1 ? canvasItemById([...selection][0]) : null;
      const snapshotButton = canvasContextBar.querySelector('[data-canvas-action="snapshot"]');
      const membersButton = canvasContextBar.querySelector('[data-canvas-action="members"]');
      const editButton = canvasContextBar.querySelector('[data-canvas-action="edit"]');
      if (snapshotButton) snapshotButton.hidden = selectedItem?.kind !== 'tab';
      if (membersButton) membersButton.hidden = selectedItem?.kind !== 'group';
      if (editButton) editButton.hidden = n !== 1;
    }
    if (canvasDropZone) canvasDropZone.hidden = n < 2;
    batchBar.classList.remove('open');
    batchBar.setAttribute('aria-hidden', 'true');
    return;
  }
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
    if (settings.viewMode === 'canvas') ensureCanvasStore()?.setSelection([]);
    else selectedIds.clear();
    lastAnchorId = null;
  }
  updateBatchBar();
  renderGrid();
}

function toggleSelect(id) {
  if (settings.viewMode === 'canvas') {
    ensureCanvasStore()?.toggleSelection(id, true);
    lastAnchorId = id;
    return;
  }
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  lastAnchorId = id;
  updateBatchBar();
  const root = settings.viewMode === 'canvas' ? canvasNodesEl : gridEl;
  const card = root?.querySelector(`[data-id="${id.replace(/"/g, '')}"]`);
  if (card) {
    card.classList.toggle('selected', selectedIds.has(id));
    const check = card.querySelector('.card-check');
    if (check) check.checked = selectedIds.has(id);
  }
}

selectModeBtn.addEventListener('click', () => setSelectMode(!selectMode));

batchClear.addEventListener('click', () => setSelectMode(false));

async function buildPartialBackupPayload(items, { withMedia = false } = {}) {
  const parkedItems = [];
  for (const it of items) {
    parkedItems.push(withMedia ? await hydrateItemMediaLocal(it) : { ...it });
  }
  // Strip any accidental inline emptiness for lite
  if (!withMedia) {
    for (const it of parkedItems) {
      if (it.kind === 'group') {
        for (const m of it.tabs || []) {
          m.thumbnail = '';
          m.snapshot = '';
        }
      } else {
        it.thumbnail = '';
        it.snapshot = '';
      }
    }
  }
  const parkedTabs = parkedItems
    .filter((i) => i.kind !== 'group' && !Array.isArray(i.tabs))
    .map(({ kind, hasThumb, hasSnap, thumbnail, snapshot, ...rest }) => rest);
  const selectedIds = new Set(items.map((item) => item.id));
  const partialLayout = normalizeCanvasLayoutLocal(canvasLayout, items);
  partialLayout.positions = Object.fromEntries(
    Object.entries(partialLayout.positions).filter(([id]) => selectedIds.has(id))
  );
  return {
    format: 'tabwall-backup',
    version: Build.FORMAT_VERSION || 4,
    media: withMedia ? 'inline' : 'none',
    partial: true,
    appVersion: (() => {
      try {
        return chrome.runtime.getManifest().version;
      } catch {
        return '';
      }
    })(),
    exportedAt: new Date().toISOString(),
    parkedItems,
    parkedTabs,
    settings: { ...settings },
    tagCatalog: [], // filled async if needed
    canvasLayout: partialLayout,
  };
}

async function exportSelected(mode) {
  const ids = [...selectedIds];
  if (!ids.length) {
    uiLog('warn', 'export', 'partial empty selection');
    window.alert(t('batchExportEmpty'));
    return;
  }
  const idSet = new Set(ids);
  // Preserve wall order
  const items = allTabs.filter((it) => idSet.has(it.id));
  if (!items.length) {
    window.alert(t('batchExportEmpty'));
    return;
  }
  uiLog('info', 'export', `partial ${mode} start`, `n=${items.length}`);
  try {
    const backup = await buildPartialBackupPayload(items, { withMedia: mode === 'full' });
    // Best-effort tag catalog from SW via lite export settings not needed
    const tagRes = await sendMessage({ type: 'EXPORT_BACKUP', mode: 'lite' });
    if (tagRes?.ok && tagRes.backup?.tagCatalog) {
      backup.tagCatalog = tagRes.backup.tagCatalog;
    }
    if (tagRes?.ok && tagRes.backup?.settings) {
      backup.settings = tagRes.backup.settings;
    }
    const built =
      mode === 'full'
        ? Build.buildFullZipBlob(backup, { auto: false, partial: true })
        : Build.buildLiteBlob(backup, { auto: false, partial: true });
    downloadBlob(built.blob, built.filename);
    uiLog('info', 'export', `partial ${mode} ok`, `file=${built.filename} n=${items.length}`);
  } catch (err) {
    console.warn(err);
    uiLog('error', 'export', `partial ${mode} failed`, err?.message || err);
    window.alert(`${t('backupError')}: ${err?.message || err}`);
  }
}

batchExportLite?.addEventListener('click', () => {
  exportSelected('lite');
});
batchExportFull?.addEventListener('click', () => {
  exportSelected('full');
});

batchRestore.addEventListener('click', async () => {
  await withUiActionLock('batch-restore', async () => {
    const ids = [...selectedIds];
    for (const id of ids) await restoreItem(id);
    clearAllSelections();
    updateBatchBar();
    await loadList();
  });
});

batchDelete.addEventListener('click', async () => {
  await withUiActionLock('batch-delete', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!window.confirm(t('batchDeleteConfirm', { n: ids.length }))) return;
    await sendMessage({ type: 'BATCH_DELETE_ITEMS', ids });
    clearAllSelections();
    updateBatchBar();
    await loadList();
  });
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
      clearAllSelections();
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
    const storedOnly = isStoredOnlyUrl(m.url);
    const note = m.note || '';
    const tags = Array.isArray(m.tags) ? m.tags : [];
    const mKey = mediaKeyForMember(group.id, m.id);
    row.innerHTML = `
      <img class="member-thumb lazy-thumb" alt="" data-media-key="${escapeAttr(mKey)}" />
      <div class="member-body">
        <div class="member-title" title="${escapeAttr(m.title || '')}">
          ${escapeHtml(m.title || m.url || '')}
          ${storedOnly ? `<span class="stored-only-badge">${escapeHtml(t('storedOnlyShort'))}</span>` : ''}
        </div>
        <div class="member-url" title="${escapeAttr(m.url || '')}">${escapeHtml(m.url || '')}</div>
        ${storedOnly ? `<div class="note-preview">${escapeHtml(t('storedOnly'))}</div>` : ''}
        ${note ? `<div class="note-preview">${escapeHtml(note)}</div>` : ''}
        ${
          tags.length
            ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
            : ''
        }
        <div class="member-actions">
          <button type="button" class="btn snap-btn">${escapeHtml(t('memberSnapshot'))}</button>
          <button type="button" class="btn edit-m-btn">${escapeHtml(t('memberEdit'))}</button>
          <button type="button" class="btn primary restore-m-btn" ${storedOnly ? `disabled title="${escapeAttr(t('storedOnly'))}"` : ''}>${escapeHtml(t('memberRestore'))}</button>
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
  return withUiActionLock(`restore:${id}`, async () => {
    const item = allTabs.find((t) => t.id === id);
    if (item?.kind !== 'group' && isStoredOnlyUrl(item?.url)) {
      showCopyToast(t('restoreRestricted'));
      return { ok: false, error: 'restricted_url' };
    }
    if (item?.kind === 'group') {
      const n = (item.tabs || []).length;
      const title = itemTitle(item);
      if (!window.confirm(t('restoreGroupConfirm', { title, n }))) return { ok: false, error: 'cancelled' };
    }
    const type = item?.kind === 'group' ? 'RESTORE_GROUP' : 'RESTORE_TAB';
    const res = await sendMessage({ type, id });
    if (res.ok) {
      allTabs = allTabs.filter((t) => t.id !== id);
      if (expandedId === id) closeLightbox();
      if (editingId === id) closeEditBox();
      if (membersGroupId === id) closeMembersBox();
      renderGrid();
      if (res.skipped) showCopyToast(t('restoreSkipped', { n: res.skipped }));
    } else if (res.error === 'restricted_url' || res.error === 'no_restorable_urls') {
      showCopyToast(t('restoreRestricted'));
    }
    return res;
  });
}

async function restoreMember(groupId, memberId) {
  return withUiActionLock(`restore-member:${groupId}:${memberId}`, async () => {
    const group = allTabs.find((item) => item.id === groupId && item.kind === 'group');
    const member = group?.tabs?.find((item) => item.id === memberId);
    if (isStoredOnlyUrl(member?.url)) {
      showCopyToast(t('restoreRestricted'));
      return { ok: false, error: 'restricted_url' };
    }
    const res = await sendMessage({
      type: 'RESTORE_GROUP_MEMBER',
      groupId,
      memberId,
    });
    if (res.ok) await loadList();
    else if (res.error === 'restricted_url') showCopyToast(t('restoreRestricted'));
    return res;
  });
}

async function deleteItem(id) {
  return withUiActionLock(`delete:${id}`, async () => {
    const res = await sendMessage({ type: 'DELETE_ITEM', id });
    if (res.ok) {
      allTabs = allTabs.filter((t) => t.id !== id);
      if (expandedId === id) closeLightbox();
      if (editingId === id) closeEditBox();
      renderGrid();
    }
    return res;
  });
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
  // Match card width so grid reflow is stable
  placeholder.style.width = `${rect.width}px`;
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
  // Ensure capture survives after leaving the card bounds
  try {
    if (state.pointerId != null) card.setPointerCapture(state.pointerId);
  } catch {
    // ignore
  }
}

/** Dwell before a drop is treated as stack (ms). Short so stacking is easy; still avoids drive-by merges. */
const STACK_DWELL_MS = 150;

function clearStackHover() {
  gridEl.querySelectorAll('.card.stack-hover').forEach((el) => el.classList.remove('stack-hover'));
}

/**
 * Stack hot-zone: only the card title/meta strip (not thumb center).
 * Avoids green + while dragging over the bulk of the card.
 */
function findStackTargetAt(clientX, clientY, excludeCard) {
  const cards = [...gridEl.querySelectorAll('.card')].filter(
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

function updateStackHoverState(state, clientX, clientY) {
  const stackEl = findStackTargetAt(clientX, clientY, state.card);
  const candId = stackEl?.dataset?.id || null;
  const now = performance.now();

  if (candId !== state.stackCandidateId) {
    state.stackCandidateId = candId;
    state.stackCandidateSince = candId ? now : 0;
    // Not armed until dwell completes
    if (state.stackTargetId) {
      clearStackHover();
      state.stackTargetId = null;
    }
    return false;
  }

  if (!candId) {
    if (state.stackTargetId) {
      clearStackHover();
      state.stackTargetId = null;
    }
    return false;
  }

  const armed = now - (state.stackCandidateSince || 0) >= STACK_DWELL_MS;
  if (armed) {
    if (state.stackTargetId !== candId) {
      clearStackHover();
      state.stackTargetId = candId;
      if (stackEl) stackEl.classList.add('stack-hover');
    }
    return true;
  }

  // Hovering but not armed — still reorder
  if (state.stackTargetId) {
    clearStackHover();
    state.stackTargetId = null;
  }
  return false;
}

function onCardPointerMove(e) {
  if (!dragState) return;
  // Ignore multi-touch / wrong pointer
  if (dragState.pointerId != null && e.pointerId !== dragState.pointerId) return;

  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;

  if (!dragState.active) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    beginCardDrag(dragState, e);
  }

  const { card, offsetX, offsetY, placeholder } = dragState;
  if (!card) return;

  card.style.left = `${e.clientX - offsetX}px`;
  card.style.top = `${e.clientY - offsetY}px`;

  // Stack only after a short dwell on the title/meta hot-zone; otherwise keep reordering
  const stacking = updateStackHoverState(dragState, e.clientX, e.clientY);
  if (stacking) return;

  if (!placeholder || !placeholder.parentElement) return;

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

function cleanupCardDragVisual(state) {
  const { card, placeholder } = state;
  clearStackHover();
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
}

function normalizeParkedList(raw) {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    if (item.kind === 'group' || Array.isArray(item.tabs)) {
      return {
        ...item,
        kind: 'group',
        pinned: Boolean(item.pinned),
        note: typeof item.note === 'string' ? item.note : '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        tabs: Array.isArray(item.tabs) ? item.tabs : [],
      };
    }
    return {
      ...item,
      kind: 'tab',
      pinned: Boolean(item.pinned),
      note: typeof item.note === 'string' ? item.note : '',
      tags: Array.isArray(item.tags) ? item.tags : [],
    };
  });
}

async function endCardDrag(e) {
  if (!dragState) return;
  const state = dragState;
  dragState = null;
  detachCardDragListeners(state);

  const clientX = e?.clientX;
  const clientY = e?.clientY;

  try {
    if (e?.pointerId != null) state.card.releasePointerCapture(e.pointerId);
    else if (state.pointerId != null) state.card.releasePointerCapture(state.pointerId);
  } catch {
    // ignore
  }

  if (!state.active) {
    if (selectMode) return;
    // setPointerCapture suppresses click — handle short-press here
    if (state.allowClickCopy && state.item) {
      copySavedLink(state.item);
      return;
    }
    if (state.allowClickRestore) {
      restoreItem(state.id);
    }
    return;
  }

  // Re-check stack target at drop point (dwell optional if still in hotzone)
  let stackTargetId = state.stackTargetId || null;
  if (
    !stackTargetId &&
    typeof clientX === 'number' &&
    typeof clientY === 'number'
  ) {
    const el = findStackTargetAt(clientX, clientY, state.card);
    if (el?.dataset?.id && el.dataset.id !== state.id) {
      stackTargetId = el.dataset.id;
    }
  }

  cleanupCardDragVisual(state);

  // Drop onto another card → stack / merge into group
  if (stackTargetId && stackTargetId !== state.id) {
    const res = await sendMessage({
      type: 'STACK_ITEMS',
      sourceId: state.id,
      targetId: stackTargetId,
    });
    if (res.ok && Array.isArray(res.items)) {
      allTabs = normalizeParkedList(res.items);
      await saveSettings({ sortBy: 'manual' });
      sortByEl.value = 'manual';
      renderGrid();
      showCopyToast(t('stackMerged'));
      return;
    }
    console.warn('[TabWall] STACK_ITEMS failed', res);
    showCopyToast(t('stackFailed'));
    // fall through to reorder if stack failed
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

function detachCardDragListeners(state) {
  if (!state?.onMove) return;
  window.removeEventListener('pointermove', state.onMove, true);
  window.removeEventListener('pointerup', state.onUp, true);
  window.removeEventListener('pointercancel', state.onUp, true);
  state.onMove = null;
  state.onUp = null;
}

/**
 * Bind title/meta copy. Meta does not enter card drag (setPointerCapture kills click).
 * pointerup + small movement = copy (more reliable than click alone).
 */
function bindMetaCopy(metaEl, item) {
  if (!metaEl) return;
  let downX = 0;
  let downY = 0;
  let downId = null;
  let copiedOnUp = false;

  metaEl.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.search-hits, button, input')) return;
    downX = e.clientX;
    downY = e.clientY;
    downId = e.pointerId;
    copiedOnUp = false;
  });

  metaEl.addEventListener('pointerup', (e) => {
    if (downId != null && e.pointerId !== downId) return;
    const pid = downId;
    downId = null;
    if (pid == null) return;
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.search-hits, button, input')) return;
    if (dragState?.active) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) >= DRAG_THRESHOLD) return;
    if (selectMode || isMultiSelectModifier(e)) {
      handleCardSelectClick(item.id, e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    copiedOnUp = true;
    copySavedLink(item);
  });

  metaEl.addEventListener('click', (e) => {
    if (copiedOnUp) {
      copiedOnUp = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('.search-hits, button, input')) return;
    if (dragState?.active) return;
    if (selectMode || isMultiSelectModifier(e)) {
      handleCardSelectClick(item.id, e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    copySavedLink(item);
  });
}

function attachCardDrag(card, item) {
  // Capture phase: thumb / card body can start drag; meta is excluded (copy only)
  card.addEventListener(
    'pointerdown',
    (e) => {
      if (selectMode) return;
      if (isMultiSelectModifier(e)) return;
      if (settings.viewMode === 'list') return;
      if (e.button != null && e.button !== 0) return;
      // Meta / copy-hit: do not capture — copy handled by bindMetaCopy
      if (e.target.closest('.meta, .copy-hit')) return;
      if (
        e.target.closest(
          'button, input, a, .icon-btn, .card-check, .delete-btn, .search-hits, .search-hit'
        )
      ) {
        return;
      }

      // End any prior gesture
      if (dragState) {
        detachCardDragListeners(dragState);
        dragState = null;
      }

      const pointerId = e.pointerId;
      e.preventDefault();

      const state = {
        card,
        item,
        id: item.id,
        pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: 0,
        offsetY: 0,
        placeholder: null,
        active: false,
        stackTargetId: null,
        stackCandidateId: null,
        stackCandidateSince: 0,
        allowClickRestore: Boolean(
          e.target.closest('.thumb-wrap, .thumb, .group-cover, .group-mosaic, .group-badge')
        ),
        allowClickCopy: false,
        onMove: null,
        onUp: null,
      };

      state.onMove = (ev) => {
        if (ev.pointerId !== pointerId) return;
        onCardPointerMove(ev);
      };
      state.onUp = (ev) => {
        if (ev.pointerId !== pointerId) return;
        detachCardDragListeners(state);
        endCardDrag(ev).catch(() => {});
      };

      dragState = state;
      window.addEventListener('pointermove', state.onMove, true);
      window.addEventListener('pointerup', state.onUp, true);
      window.addEventListener('pointercancel', state.onUp, true);

      try {
        card.setPointerCapture(pointerId);
      } catch {
        // ignore
      }
    },
    true
  );
}

// Block native HTML5 drag (img/link → green + cursor under pointer)
document.addEventListener(
  'dragstart',
  (e) => {
    const t = e.target;
    if (
      t?.closest?.('.card, #grid, .thumb, .lazy-thumb, .favicon, .meta, .title') ||
      t?.tagName === 'IMG' ||
      t?.tagName === 'A'
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);

// ─── Cards / List ──────────────────────────────────────────────────

function iconSvg(name) {
  const paths = {
    edit: '<path d="m4 16.5-.7 3.2 3.2-.7L18.1 7.4a2 2 0 0 0-2.8-2.8L3.7 16.5z"></path><path d="m13.8 6.2 4 4"></path>',
    expand: '<path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"></path>',
    members: '<rect x="4" y="5" width="12" height="14" rx="2"></rect><path d="M8 3h10a2 2 0 0 1 2 2v12M8 9h4M8 13h5"></path>',
    pin: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"></path>',
    delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>',
    restore: '<path d="M5 8h9a5 5 0 1 1-3.5 8.5L8 14"></path><path d="M5 8V4M5 8l4-2"></path>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"></path>',
    snapshot: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="12" cy="12" r="3"></circle><path d="M8 5 9.2 3h5.6L16 5"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  };
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${paths[name] || ''}</svg>`;
}

async function togglePinned(item) {
  const next = !Boolean(item?.pinned);
  const res = await withUiActionLock(`pin:${item?.id || ''}`, () =>
    sendMessage({ type: 'UPDATE_ITEM', id: item.id, pinned: next })
  );
  if (!res?.ok) {
    showCopyToast(t('pinFailed'));
    return;
  }
  const stored = allTabs.find((candidate) => candidate.id === item.id);
  if (stored) stored.pinned = next;
  showCopyToast(t(next ? 'pinnedOn' : 'pinnedOff'));
  renderGrid();
}

function groupCoverHtml(item, { canvas = false } = {}) {
  const mediaClass = canvas ? ' canvas-thumb' : '';
  const mediaAttribute = canvas ? ' data-canvas-media="true"' : '';
  const imageHtml = (member, className = '') =>
    `<img class="${className}${className ? ' ' : ''}lazy-thumb${mediaClass}" alt="" draggable="false" data-media-key="${escapeAttr(mediaKeyForMember(item.id, member.id))}"${mediaAttribute} />`;
  const members = (item.tabs || []).filter((m) => m.hasThumb || m.thumbnail).slice(0, 4);
  if (members.length === 0) {
    // still try first few for keys even without hasThumb flag (migration)
    const any = (item.tabs || []).slice(0, 4);
    if (!any.length) return `<div class="group-cover empty-cover"></div>`;
    if (any.length === 1) {
      return imageHtml(any[0], 'thumb');
    }
    return `<div class="group-mosaic mosaic-${Math.min(any.length, 4)}">${any
      .map((m) => imageHtml(m))
      .join('')}</div>`;
  }
  if (members.length === 1) {
    return imageHtml(members[0], 'thumb');
  }
  return `<div class="group-mosaic mosaic-${Math.min(members.length, 4)}">${members
    .map((m) => imageHtml(m))
    .join('')}</div>`;
}

function createGroupCard(item) {
  const card = document.createElement('article');
  card.className = 'card group-card';
  card.draggable = false;
  card.dataset.id = item.id;
  card.dataset.kind = 'group';
  card.setAttribute('role', 'listitem');

  const title = itemTitle(item);
  const n = (item.tabs || []).length;
  const storedOnlyCount = countStoredOnlyUrls(item);
  const color = GROUP_COLORS[item.color] || GROUP_COLORS.grey;
  const note = item.note || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const savedAt = formatSavedAt(item.savedAt);

  const selected = selectedIds.has(item.id);
  if (selected) card.classList.add('selected');

  card.innerHTML = `
    <input type="checkbox" class="card-check" ${selected ? 'checked' : ''} aria-label="select" />
    <div class="group-color-bar" style="background:${color}"></div>
    <div class="thumb-wrap">
      ${groupCoverHtml(item)}
      <div class="card-actions">
        <button type="button" class="icon-btn lg edit-btn" title="${escapeAttr(t('edit'))}">${iconSvg('edit')}<span>${escapeHtml(t('edit'))}</span></button>
        <button type="button" class="icon-btn lg members-btn" title="${escapeAttr(t('expandGroup'))}">${iconSvg('members')}<span>${escapeHtml(t('expandGroup'))}</span></button>
      </div>
      <button type="button" class="pin-btn ${item.pinned ? 'active' : ''}" aria-pressed="${item.pinned ? 'true' : 'false'}" title="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}" aria-label="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}">${iconSvg('pin')}</button>
      <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
      <span class="group-badge">${escapeHtml(t('groupTabs', { n }))}</span>
    </div>
    <div class="meta copy-hit" title="${escapeAttr(t('copyLink'))}">
      <div class="title-row">
        <span class="color-dot" style="background:${color}"></span>
        <div class="title" title="${escapeAttr(title)}">
          ${escapeHtml(title)}
          ${storedOnlyCount ? `<span class="stored-only-badge">${escapeHtml(t('storedOnlyShort'))} ×${storedOnlyCount}</span>` : ''}
        </div>
      </div>
      <div class="url">${escapeHtml(t('groupTabs', { n }))}</div>
      <div class="saved-at">${escapeHtml(t('savedAt', { time: savedAt }))}</div>
      ${note ? `<div class="note-preview">${escapeHtml(note)}</div>` : ''}
      ${
        tags.length
          ? `<div class="tags">${tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join('')}</div>`
          : ''
      }
    </div>
  `;

  card.querySelectorAll('img.lazy-thumb').forEach((img) => observeThumb(img));
  appendGroupSearchHits(card, item);

  card.querySelector('.card-check').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectMode) setSelectMode(true);
    handleCardSelectClick(item.id, e);
  });

  bindMetaCopy(card.querySelector('.meta'), item);

  card.querySelector('.thumb-wrap').addEventListener('click', (e) => {
    if (e.target.closest('.card-actions, .delete-btn, .members-btn, .pin-btn, .card-check')) return;
    if (dragState?.active) return;
    if (selectMode || isMultiSelectModifier(e)) {
      handleCardSelectClick(item.id, e);
    }
    // pure thumb click restore is handled by endCardDrag
  });

  card.querySelector('.members-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openMembersBox(item);
  });

  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditBox(item);
  });
  card.querySelector('.pin-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePinned(item);
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
  card.draggable = false;
  card.dataset.id = item.id;
  card.dataset.kind = 'tab';
  card.setAttribute('role', 'listitem');

  const title = item.title || item.url || 'Untitled';
  const url = item.url || '';
  const mediaKey = mediaKeyForItem(item);
  const fav = item.favIconUrl || '';
  const storedOnly = isStoredOnlyUrl(url);
  const note = item.note || '';
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const savedAt = formatSavedAt(item.savedAt);

  if (selectedIds.has(item.id)) card.classList.add('selected');

  card.innerHTML = `
    <input type="checkbox" class="card-check" ${selectedIds.has(item.id) ? 'checked' : ''} aria-label="select" />
    <div class="thumb-wrap">
      <img class="thumb lazy-thumb" alt="" draggable="false" decoding="async" data-media-key="${escapeAttr(mediaKey)}" />
      <div class="card-actions">
        <button type="button" class="icon-btn lg edit-btn" title="${escapeAttr(t('edit'))}" aria-label="${escapeAttr(t('edit'))}">${iconSvg('edit')}<span>${escapeHtml(t('edit'))}</span></button>
        <button type="button" class="icon-btn lg expand-btn" title="${escapeAttr(t('expand'))}" aria-label="${escapeAttr(t('expand'))}">${iconSvg('expand')}<span>${escapeHtml(t('expand'))}</span></button>
      </div>
      <button type="button" class="pin-btn ${item.pinned ? 'active' : ''}" aria-pressed="${item.pinned ? 'true' : 'false'}" title="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}" aria-label="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}">${iconSvg('pin')}</button>
      <button type="button" class="icon-btn sm danger delete-corner delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
    </div>
    <div class="meta copy-hit" title="${escapeAttr(t('copyLink'))}">
      <div class="title-row">
        ${
          fav
            ? `<img class="favicon" alt="" draggable="false" src="${escapeAttr(fav)}" />`
            : `<span class="favicon-fallback" aria-hidden="true"></span>`
        }
        <div class="title" title="${escapeAttr(title)}">
          ${escapeHtml(title)}
          ${storedOnly ? `<span class="stored-only-badge">${escapeHtml(t('storedOnlyShort'))}</span>` : ''}
        </div>
      </div>
      <div class="url" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
      <div class="saved-at">${escapeHtml(t('savedAt', { time: savedAt }))}</div>
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
    if (!selectMode) setSelectMode(true);
    handleCardSelectClick(item.id, e);
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
  card.querySelector('.pin-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectMode) return;
    togglePinned(item);
  });
  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectMode) return;
    deleteItem(item.id);
  });
  bindMetaCopy(card.querySelector('.meta'), item);
  card.querySelector('.thumb-wrap').addEventListener('click', (e) => {
    if (e.target.closest('.card-actions, .delete-btn, .expand-btn, .edit-btn, .pin-btn, .card-check')) return;
    if (dragState?.active) return;
    if (selectMode || isMultiSelectModifier(e)) {
      handleCardSelectClick(item.id, e);
    }
    // pure thumb click restore is handled by endCardDrag
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
  const storedOnlyCount = countStoredOnlyUrls(item);

  row.innerHTML = `
    <img class="row-thumb lazy-thumb" alt="" draggable="false" decoding="async" data-media-key="${escapeAttr(mediaKey)}" title="${escapeAttr(t('restore'))}" />
    <div class="row-main">
      <div class="title copy-hit" title="${escapeAttr(title)}">
        ${color ? `<span class="color-dot" style="background:${color};display:inline-block;margin-right:6px;vertical-align:middle"></span>` : ''}
        ${escapeHtml(title)}
        ${storedOnlyCount ? `<span class="stored-only-badge">${escapeHtml(t('storedOnlyShort'))}${storedOnlyCount > 1 ? ` ×${storedOnlyCount}` : ''}</span>` : ''}
      </div>
      <div class="url copy-hit" title="${escapeAttr(url)}">${escapeHtml(url)}</div>
      <div class="saved-at">${escapeHtml(t('savedAt', { time: formatSavedAt(item.savedAt) }))}</div>
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
      <button type="button" class="pin-btn ${item.pinned ? 'active' : ''}" aria-pressed="${item.pinned ? 'true' : 'false'}" title="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}" aria-label="${escapeAttr(t(item.pinned ? 'unpin' : 'pin'))}">${iconSvg('pin')}</button>
      <button type="button" class="icon-btn edit-btn" title="${escapeAttr(t('edit'))}" aria-label="${escapeAttr(t('edit'))}">${iconSvg('edit')}</button>
      ${
        isGroup
          ? ''
          : `<button type="button" class="icon-btn expand-btn" title="${escapeAttr(t('expand'))}" aria-label="${escapeAttr(t('expand'))}">${iconSvg('expand')}</button>`
      }
      <button type="button" class="icon-btn danger delete-btn" title="${escapeAttr(t('delete'))}" aria-label="${escapeAttr(t('delete'))}">${iconSvg('delete')}</button>
    </div>
  `;

  observeThumb(row.querySelector('img.lazy-thumb'));
  if (isGroup) appendGroupSearchHits(row, item);
  row.querySelector('.row-thumb').addEventListener('click', (e) => {
    if (selectMode || isMultiSelectModifier(e)) {
      handleCardSelectClick(item.id, e);
      return;
    }
    restoreItem(item.id);
  });
  row.querySelectorAll('.copy-hit').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.search-hits')) return;
      if (selectMode || isMultiSelectModifier(e)) {
        handleCardSelectClick(item.id, e);
        return;
      }
      copySavedLink(item);
    });
  });
  if (selectedIds.has(item.id)) row.classList.add('selected');
  const expandBtn = row.querySelector('.expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => openLightbox(item));
  }
  row.querySelector('.edit-btn').addEventListener('click', () => openEditBox(item));
  row.querySelector('.pin-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectMode) return;
    togglePinned(item);
  });
  row.querySelector('.delete-btn').addEventListener('click', () => deleteItem(item.id));
  return row;
}

// ─── Spatial Canvas ────────────────────────────────────────────────

function canvasDefaultPosition(index) {
  const i = Math.max(0, Number(index) || 0);
  return { x: 96 + (i % 4) * 300, y: 96 + Math.floor(i / 4) * 238, w: 220, h: 170, z: i };
}

function normalizeCanvasLayoutLocal(raw, items = allTabs) {
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
    const fallback = canvasDefaultPosition(index++);
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
      const fallback = canvasDefaultPosition(index++);
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
  return {
    version: CANVAS_LAYOUT_VERSION,
    viewport: {
      x: finite(value.viewport?.x, -100000, 100000, DEFAULT_CANVAS_VIEWPORT.x),
      y: finite(value.viewport?.y, -100000, 100000, DEFAULT_CANVAS_VIEWPORT.y),
      zoom: finite(value.viewport?.zoom, 0.25, 2, DEFAULT_CANVAS_VIEWPORT.zoom),
    },
    positions,
  };
}

function canvasPositionFor(id, index = 0) {
  return canvasLayout.positions[id] || canvasDefaultPosition(index);
}

function canvasLayoutSnapshot() {
  return CanvasStoreApi?.normalizeLayout
    ? CanvasStoreApi.normalizeLayout(canvasStoreSnapshot().layout, allTabs)
    : normalizeCanvasLayoutLocal(canvasStoreSnapshot().layout, allTabs);
}

function cancelCanvasLayoutSave() {
  if (canvasSaveTimer) clearTimeout(canvasSaveTimer);
  canvasSaveTimer = null;
  canvasStore?.flush?.().catch?.(() => {});
}

function scheduleCanvasLayoutSave() {
  // Store owns debounce, revision and retry. Keep this wrapper for legacy
  // callers that still use the old save hook.
  canvasStore?.flush?.().catch((err) => uiLog('warn', 'canvas', 'layout save failed', err));
}

function canvasPointFromEvent(event) {
  const rect = canvasViewportEl?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  const { viewport } = canvasLayout;
  const zoom = viewport.zoom || DEFAULT_CANVAS_VIEWPORT.zoom;
  return {
    x: (event.clientX - rect.left) / zoom + viewport.x,
    y: (event.clientY - rect.top) / zoom + viewport.y,
  };
}

function updateCanvasTransform() {
  if (!canvasWorldEl) return;
  const { x, y, zoom } = canvasLayout.viewport;
  canvasWorldEl.style.transform = `translate(${-x * zoom}px, ${-y * zoom}px) scale(${zoom})`;
  const zoomValue = document.getElementById('canvasZoomValue');
  if (zoomValue) zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  if (canvasMinimap) canvasMinimap.dataset.zoom = String(zoom);
}

function setCanvasZoom(next, clientX = null, clientY = null) {
  const state = canvasStoreSnapshot();
  const oldZoom = state.layout.viewport.zoom;
  const zoom = Math.min(2, Math.max(0.25, Number(next) || oldZoom));
  if (zoom === oldZoom) return;
  const rect = canvasViewportEl?.getBoundingClientRect();
  let anchor = null;
  if (rect && clientX != null && clientY != null) {
    anchor = {
      world: {
        x: (clientX - rect.left) / oldZoom + state.layout.viewport.x,
        y: (clientY - rect.top) / oldZoom + state.layout.viewport.y,
      },
      offset: {
        x: clientX - rect.left,
        y: clientY - rect.top,
      },
    };
  }
  canvasStore?.commitZoom(zoom, anchor);
}

function centerCanvasInitialView() {
  if (!canvasNeedsInitialCenter || settings.viewMode !== 'canvas' || canvasSessionFallback || !canvasViewportEl) return;
  const width = canvasViewportEl.clientWidth || canvasViewportEl.getBoundingClientRect?.().width || 0;
  const height = canvasViewportEl.clientHeight || canvasViewportEl.getBoundingClientRect?.().height || 0;
  if (!width || !height) return;
  const state = canvasStoreSnapshot();
  if (state.pendingOperations?.length || state.interaction) {
    canvasNeedsInitialCenter = false;
    return;
  }
  if (!allTabs.length) {
    canvasNeedsInitialCenter = false;
    return;
  }
  const positions = allTabs.map((item, index) => state.layout.positions?.[item.id] || canvasDefaultPosition(index));
  const minX = Math.min(...positions.map((position) => Number(position.x) || 0));
  const minY = Math.min(...positions.map((position) => Number(position.y) || 0));
  const maxX = Math.max(...positions.map((position) => (Number(position.x) || 0) + Math.max(1, Number(position.w) || 1)));
  const maxY = Math.max(...positions.map((position) => (Number(position.y) || 0) + Math.max(1, Number(position.h) || 1)));
  const zoom = Math.max(0.25, Number(state.layout.viewport.zoom) || DEFAULT_CANVAS_VIEWPORT.zoom);
  canvasNeedsInitialCenter = false;
  canvasStore?.commitViewport({
    x: (minX + maxX) / 2 - width / (2 * zoom),
    y: (minY + maxY) / 2 - height / (2 * zoom),
    zoom,
  });
}

function scheduleInitialCanvasCenter() {
  if (!canvasNeedsInitialCenter || canvasInitialCenterRaf) return;
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
  canvasInitialCenterRaf = schedule(() => {
    canvasInitialCenterRaf = 0;
    centerCanvasInitialView();
  });
}

function canvasThumbHtml(item) {
  if (item.kind === 'group') return groupCoverHtml(item, { canvas: true });
  return `<img class="canvas-thumb lazy-thumb" alt="" draggable="false" decoding="async" data-media-key="${escapeAttr(mediaKeyForItem(item))}" data-canvas-media="true" />`;
}

function canvasNodeHtml(item) {
  const title = itemTitle(item);
  const selected = activeCanvasSelection().has(item.id);
  const position = canvasPositionFor(item.id);
  const pin = item.pinned ? `<span class="canvas-pin" title="${escapeAttr(t('pinnedOnly'))}" aria-label="${escapeAttr(t('pinnedOnly'))}">${iconSvg('pin')}</span>` : '';
  const meta = item.kind === 'group'
    ? t('groupTabs', { n: (item.tabs || []).length })
    : `${domainOf(item.url)} · ${formatSavedAt(item.savedAt)}`;
  const actions = item.kind === 'group'
    ? [
        ['restore', t('restoreGroup'), 'restore'],
        ['members', t('expandGroup'), 'members'],
        ['edit', t('edit'), 'edit'],
        ['pin', t(item.pinned ? 'unpin' : 'pin'), 'pin'],
        ['delete', t('delete'), 'delete'],
      ]
    : [
        ['restore', t('restore'), 'restore'],
        ['snapshot', t('canvasSnapshot'), 'snapshot'],
        ['edit', t('edit'), 'edit'],
        ['copy', t('copyLink'), 'copy'],
        ['pin', t(item.pinned ? 'unpin' : 'pin'), 'pin'],
        ['delete', t('delete'), 'delete'],
      ];
  const actionHtml = actions
    .map(([action, label, icon]) => `<button type="button" class="canvas-node-action${action === 'delete' ? ' danger' : ''}" data-canvas-node-action="${action}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${iconSvg(icon)}</button>`)
    .join('');
  return `
    <article class="canvas-node${item.kind === 'group' ? ' canvas-group' : ''}${selected ? ' selected' : ''}"
      data-id="${escapeAttr(item.id)}" data-kind="${escapeAttr(item.kind)}" role="button" tabindex="0"
      aria-selected="${selected ? 'true' : 'false'}" title="${escapeAttr(t('canvasNodeHint'))}" style="left:${position.x}px;top:${position.y}px;width:${position.w}px;min-height:${position.h}px;z-index:${Math.round(position.z || 0)}">
      <div class="canvas-node-thumb" title="${escapeAttr(t('canvasNodeHint'))}">${canvasThumbHtml(item)}</div>
      <div class="canvas-node-copy">
        <div class="canvas-node-title">
          ${item.kind === 'tab' && item.favIconUrl ? `<img class="favicon" alt="" draggable="false" src="${escapeAttr(item.favIconUrl)}" />` : ''}
          <span>${escapeHtml(title)}</span>${pin}
        </div>
        <div class="canvas-node-meta">${escapeHtml(meta)}</div>
        ${item.note ? `<div class="canvas-node-note">${escapeHtml(item.note)}</div>` : ''}
        ${item.tags?.length ? `<div class="canvas-node-tags">${item.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</div>` : ''}
      </div>
      <div class="canvas-node-actions" aria-label="${escapeAttr(title)}">${actionHtml}</div>
    </article>`;
}

function canvasItemById(id) {
  return allTabs.find((item) => item.id === id) || null;
}

function cancelCanvasNodeClick(id) {
  const timer = canvasNodeClickTimers.get(id);
  if (timer) clearTimeout(timer);
  canvasNodeClickTimers.delete(id);
}

function scheduleCanvasNodePreview(item) {
  if (!item?.id) return;
  cancelCanvasNodeClick(item.id);
  const timer = setTimeout(() => {
    canvasNodeClickTimers.delete(item.id);
    const current = canvasItemById(item.id);
    if (!current) return;
    if (current.kind === 'group') openCanvasGroupLightbox(current);
    else openLightbox(current);
  }, CANVAS_NODE_CLICK_DELAY);
  canvasNodeClickTimers.set(item.id, timer);
}

function suppressCanvasNodeClick(id) {
  if (!id) return;
  canvasNodeClickSuppressUntil.set(id, Date.now() + CANVAS_NODE_CLICK_DELAY);
}

function wireCanvasNodeActions(node) {
  if (!node || node.dataset.canvasWired === '1') return;
  const item = canvasItemById(node.dataset.id);
  if (!item) return;
  node.dataset.canvasWired = '1';
  node.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.detail === 0 || isCanvasControlTarget(event.target)) return;
    if (canvasActiveTool !== 'select') return;
    const suppressedUntil = canvasNodeClickSuppressUntil.get(item.id) || 0;
    if (suppressedUntil) {
      canvasNodeClickSuppressUntil.delete(item.id);
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
      const action = button.dataset.canvasNodeAction;
      if (action === 'restore') await restoreItem(item.id);
      else if (action === 'snapshot') openLightbox(item);
      else if (action === 'copy') await copySavedLink(item);
      else if (action === 'members') openMembersBox(item);
      else if (action === 'edit') openEditBox(item);
      else if (action === 'pin') await togglePinned(item);
      else if (action === 'delete') await deleteItem(item.id);
    });
  });
}

function updateCanvasNodeSelection() {
  const selection = activeCanvasSelection();
  canvasNodesEl?.querySelectorAll('.canvas-node').forEach((node) => {
    const active = selection.has(node.dataset.id);
    node.classList.toggle('selected', active);
    node.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function updateCanvasNodePositions(snapshot = canvasStoreSnapshot()) {
  const positions = snapshot.layout?.positions || {};
  for (const [id, node] of canvasNodeElements) {
    const position = positions[id];
    if (!position) continue;
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
    node.style.width = `${position.w}px`;
    node.style.minHeight = `${position.h}px`;
    node.style.zIndex = String(Math.round(position.z || 0));
  }
}

function renderCanvasMinimap(items) {
  if (!canvasMinimap) return;
  const map = canvasMinimap.querySelector('.canvas-minimap-world');
  if (!map) return;
  const frame = map.querySelector('.canvas-minimap-viewport');
  const mapRect = map.getBoundingClientRect?.();
  const mapWidth = map.clientWidth || mapRect?.width || 0;
  const mapHeight = map.clientHeight || mapRect?.height || 0;
  const state = canvasStoreSnapshot();
  const layout = state.layout || canvasLayout;
  const zoom = Math.max(0.25, Number(layout.viewport?.zoom) || DEFAULT_CANVAS_VIEWPORT.zoom);
  const viewportWidth = Math.max(1, canvasViewportEl?.clientWidth || canvasViewportEl?.getBoundingClientRect?.().width || mapWidth);
  const viewportHeight = Math.max(1, canvasViewportEl?.clientHeight || canvasViewportEl?.getBoundingClientRect?.().height || mapHeight);
  const nodeRects = (Array.isArray(items) ? items : []).map((item, index) => {
    const position = layout.positions?.[item.id] || canvasDefaultPosition(index);
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
  const allRects = [...nodeRects, viewportRect];
  if (!mapWidth || !mapHeight || !allRects.length) {
    for (const [id, element] of canvasMinimapElements) {
      element.remove();
      canvasMinimapElements.delete(id);
    }
    if (frame) frame.hidden = true;
    return;
  }
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
  const offsetX = (mapWidth - worldWidth * scale) / 2 - worldX * scale;
  const offsetY = (mapHeight - worldHeight * scale) / 2 - worldY * scale;
  const toMinimapRect = (rect) => ({
    left: rect.x * scale + offsetX,
    top: rect.y * scale + offsetY,
    width: Math.max(2, rect.w * scale),
    height: Math.max(2, rect.h * scale),
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
    frame.style.width = `${Math.min(mapWidth, mapped.width)}px`;
    frame.style.height = `${Math.min(mapHeight, mapped.height)}px`;
  }
}

function canvasNodeRenderKey(item) {
  return JSON.stringify({
    id: item.id,
    kind: item.kind,
    title: item.title,
    url: item.url,
    note: item.note,
    tags: item.tags,
    pinned: item.pinned,
    savedAt: item.savedAt,
    favIconUrl: item.favIconUrl,
    tabs: item.kind === 'group'
      ? (item.tabs || []).map((member) => [member.id, member.title, member.url, member.hasThumb, member.hasSnap])
      : undefined,
    query,
    locale: settings.locale,
  });
}

function createCanvasNodeElement(item) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = canvasNodeHtml(item);
  const node = wrapper.firstElementChild;
  if (item.kind === 'group') appendGroupSearchHits(node, item);
  node.dataset.canvasRenderKey = canvasNodeRenderKey(item);
  wireCanvasNodeActions(node);
  node.querySelectorAll('img[data-canvas-media="true"]').forEach((img) => observeCanvasMedia(img));
  node.querySelectorAll('img.favicon').forEach((img) => wireFavicon(img.parentElement));
  return node;
}

function removeCanvasNode(id, node) {
  cancelCanvasNodeClick(id);
  canvasNodeClickSuppressUntil.delete(id);
  node?.querySelectorAll('img[data-canvas-media="true"]').forEach((img) => thumbObserver?.unobserve?.(img));
  node?.remove();
  canvasNodeElements.delete(id);
}

function renderCanvas() {
  if (!canvasNodesEl) return;
  ensureCanvasStore();
  const filtered = getCanvasVisibleTabs();
  const visibleIds = new Set(filtered.map((item) => item.id));
  updateSavedBadge();
  syncCanvasIndexUi();
  if (canvasDropZone) canvasDropZone.hidden = activeCanvasSelection().size < 2;

  for (const [id, node] of canvasNodeElements) {
    if (!visibleIds.has(id)) removeCanvasNode(id, node);
  }

  const empty = canvasNodesEl.querySelector('.canvas-empty');
  if (!allTabs.length || !filtered.length) {
    for (const [id, node] of canvasNodeElements) removeCanvasNode(id, node);
    if (!empty) {
      const message = document.createElement('div');
      message.className = 'canvas-empty';
      message.innerHTML = `<strong>${escapeHtml(t(allTabs.length ? 'noResultsTitle' : 'emptyTitle'))}</strong><span>${escapeHtml(t(allTabs.length ? 'noResultsBody' : 'emptyBody'))}</span>`;
      canvasNodesEl.appendChild(message);
    } else {
      empty.querySelector('strong').textContent = t(allTabs.length ? 'noResultsTitle' : 'emptyTitle');
      empty.querySelector('span').textContent = t(allTabs.length ? 'noResultsBody' : 'emptyBody');
    }
    updateCanvasTransform();
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
      const replacement = createCanvasNodeElement(item);
      if (node) node.replaceWith(replacement);
      node = replacement;
      canvasNodeElements.set(item.id, node);
    }
    const position = canvasLayout.positions[item.id] || canvasDefaultPosition(index);
    node.dataset.id = item.id;
    node.dataset.kind = item.kind;
    node.classList.toggle('canvas-group', item.kind === 'group');
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
    node.style.width = `${position.w}px`;
    node.style.minHeight = `${position.h}px`;
    node.style.zIndex = String(Math.round(position.z || 0));
    // Moving an existing node through the fragment keeps DOM order without
    // recreating its listeners, focus target, or media loader state.
    fragment.appendChild(node);
  });
  canvasNodesEl.appendChild(fragment);
  updateCanvasTransform();
  updateCanvasNodePositions();
  updateCanvasNodeSelection();
  canvasNodesEl.querySelectorAll('img[data-canvas-media="true"]').forEach((img) => observeCanvasMedia(img));
  renderCanvasMinimap(filtered);
  updateCanvasArrangeState();
  updateBatchBar();
}

function updateCanvasArrangeState() {
  canvasArrangePanel?.classList.toggle('open', canvasArrangePanel.dataset.open === 'true');
}

function setCanvasSelection(ids, additive = false) {
  ensureCanvasStore()?.setSelection(ids || [], additive);
  selectMode = activeCanvasSelection().size > 0;
}

function canvasSelectNode(id, event) {
  const additive = Boolean(event?.metaKey || event?.ctrlKey || event?.shiftKey);
  const selection = activeCanvasSelection();
  if (additive) ensureCanvasStore()?.toggleSelection(id, true);
  else if (!selection.has(id) || selection.size > 1) ensureCanvasStore()?.setSelection([id]);
  selectMode = activeCanvasSelection().size > 0;
  lastAnchorId = id;
}

function canvasMoveSelected(dx, dy) {
  ensureCanvasStore()?.commitMove([...activeCanvasSelection()], dx, dy, canvasSnapToGrid);
}

function snapCanvasPosition(position) {
  if (!canvasSnapToGrid) return position;
  const grid = 24;
  position.x = Math.round(position.x / grid) * grid;
  position.y = Math.round(position.y / grid) * grid;
  return position;
}

function canvasWorldViewportCenter() {
  const state = canvasStoreSnapshot();
  const viewport = state.layout?.viewport || DEFAULT_CANVAS_VIEWPORT;
  const rect = canvasViewportEl?.getBoundingClientRect?.();
  const width = Math.max(1, canvasViewportEl?.clientWidth || rect?.width || 1000);
  const height = Math.max(1, canvasViewportEl?.clientHeight || rect?.height || 700);
  const zoom = Math.max(0.25, Number(viewport.zoom) || DEFAULT_CANVAS_VIEWPORT.zoom);
  return {
    x: (Number(viewport.x) || 0) + width / (2 * zoom),
    y: (Number(viewport.y) || 0) + height / (2 * zoom),
  };
}

function canvasArrangementEntries(items, layout = canvasStoreSnapshot().layout) {
  return items.map((item, index) => ({
    item,
    position: {
      ...(layout.positions?.[item.id] || canvasDefaultPosition(index)),
    },
  }));
}

function arrangeCanvasGrid(items, layout) {
  const entries = canvasArrangementEntries(items, layout);
  if (!entries.length) return {};
  const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.ceil(entries.length / columns);
  const gapX = 48;
  const gapY = 48;
  const slotWidth = Math.max(...entries.map(({ position }) => Number(position.w) || 220), 220) + gapX;
  const slotHeight = Math.max(...entries.map(({ position }) => Number(position.h) || 170), 170) + gapY;
  const boardWidth = columns * slotWidth - gapX;
  const boardHeight = rows * slotHeight - gapY;
  const center = canvasWorldViewportCenter();
  const positions = {};

  entries.forEach(({ item, position }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    position.x = center.x - boardWidth / 2 + column * slotWidth + (slotWidth - gapX - position.w) / 2;
    position.y = center.y - boardHeight / 2 + row * slotHeight + (slotHeight - gapY - position.h) / 2;
    position.z = index;
    snapCanvasPosition(position);
    positions[item.id] = position;
  });
  return positions;
}

function arrangeCanvasCircle(items, layout) {
  const entries = canvasArrangementEntries(items, layout);
  if (!entries.length) return {};
  const center = canvasWorldViewportCenter();
  const positions = {};
  if (entries.length === 1) {
    const { item, position } = entries[0];
    position.x = center.x - position.w / 2;
    position.y = center.y - position.h / 2;
    position.z = 0;
    positions[item.id] = position;
    return positions;
  }

  const maxDimension = Math.max(
    ...entries.map(({ position }) => Math.max(Number(position.w) || 220, Number(position.h) || 170)),
    220
  );
  const gap = 72;
  const angleStep = (Math.PI * 2) / entries.length;
  const radius = Math.max(260, (maxDimension + gap) / (2 * Math.max(0.05, Math.sin(Math.PI / entries.length))));
  const startAngle = -Math.PI / 2;

  entries.forEach(({ item, position }, index) => {
    const angle = startAngle + index * angleStep;
    position.x = center.x + Math.cos(angle) * radius - position.w / 2;
    position.y = center.y + Math.sin(angle) * radius - position.h / 2;
    position.z = index;
    positions[item.id] = position;
  });
  return positions;
}

function arrangeCanvas(mode = 'manual') {
  if (mode === 'manual') {
    canvasArrangePanel?.classList.remove('open');
    if (canvasArrangePanel) canvasArrangePanel.dataset.open = 'false';
    return;
  }
  const items = sortTabs(allTabs, mode === 'date' ? 'newest' : mode === 'stack' ? 'group-first' : settings.sortBy);
  const layout = canvasStoreSnapshot().layout || canvasLayout;
  let positions;
  if (mode === 'grid') {
    positions = arrangeCanvasGrid(items, layout);
  } else if (mode === 'circle') {
    positions = arrangeCanvasCircle(items, layout);
  } else {
    positions = {};
    items.forEach((item, index) => {
      const p = { ...(layout.positions?.[item.id] || canvasDefaultPosition(index)) };
      const column = index % 4;
      const row = Math.floor(index / 4);
      p.x = 96 + column * 300;
      p.y = 144 + row * 238;
      p.z = index;
      snapCanvasPosition(p);
      positions[item.id] = p;
    });
  }
  ensureCanvasStore()?.commitPositions(positions);
  canvasArrangePanel?.classList.remove('open');
  if (canvasArrangePanel) canvasArrangePanel.dataset.open = 'false';
  renderCanvas();
}

function openCanvasStackDialog() {
  if (activeCanvasSelection().size < 2) {
    showCopyToast(t('canvasNeedTwo'));
    return;
  }
  if (!canvasStackDialog) return;
  closeAllFloatsExcept('canvasStack');
  canvasStackDialog.classList.add('open');
  canvasStackDialog.setAttribute('aria-hidden', 'false');
  if (canvasStackTitle) {
    canvasStackTitle.value = '';
    setTimeout(() => canvasStackTitle.focus(), 0);
  }
  syncFloatBackdrop();
}

function closeCanvasStackDialog() {
  canvasStackDialog?.classList.remove('open');
  canvasStackDialog?.setAttribute('aria-hidden', 'true');
  syncFloatBackdrop();
}

async function createCanvasStackFromSelection() {
  const ids = [...activeCanvasSelection()];
  const title = canvasStackTitle?.value?.trim() || t('canvasNewStack');
  closeCanvasStackDialog();
  const res = await sendMessage({ type: 'CREATE_STACK', ids, title });
  if (!res?.ok) {
    showCopyToast(t('stackFailed'));
    return;
  }
  ensureCanvasStore()?.setSelection([]);
  await loadList();
  showCopyToast(t('stackMerged'));
}

async function canvasAction(action) {
  const ids = [...activeCanvasSelection()];
  if (!ids.length) return;
  if (action === 'restore') {
    if (ids.length === 1) await restoreItem(ids[0]);
    else batchRestore?.click();
    return;
  }
  if (action === 'snapshot' && ids.length === 1) {
    const item = allTabs.find((candidate) => candidate.id === ids[0]);
    if (item?.kind === 'tab') openLightbox(item);
    return;
  }
  if (action === 'edit' && ids.length === 1) {
    const item = allTabs.find((candidate) => candidate.id === ids[0]);
    if (item) openEditBox(item);
    return;
  }
  if (action === 'members' && ids.length === 1) {
    const item = allTabs.find((candidate) => candidate.id === ids[0]);
    if (item?.kind === 'group') openMembersBox(item);
    return;
  }
  if (action === 'pin') {
    for (const id of ids) {
      const item = allTabs.find((candidate) => candidate.id === id);
      if (item) await togglePinned(item);
    }
    return;
  }
  if (action === 'stack') {
    openCanvasStackDialog();
    return;
  }
  if (action === 'delete') {
    batchDelete?.click();
  }
}

function canvasNodeWorldRect(node) {
  const viewportRect = canvasViewportEl?.getBoundingClientRect();
  const nodeRect = node?.getBoundingClientRect();
  if (!viewportRect || !nodeRect) return null;
  const { viewport } = canvasLayout;
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
  const nodes = [...(canvasNodesEl?.querySelectorAll('.canvas-node') || [])]
    .map((node) => ({ id: node.dataset.id || '', rect: canvasNodeWorldRect(node) }))
    .filter(({ id, rect }) => id && id !== excludeId && rect)
    .sort((a, b) => b.rect.z - a.rect.z);
  for (const { id, rect } of nodes) {
    if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
      return id;
    }
  }
  return '';
}

function isCanvasControlTarget(target) {
  return Boolean(
    target?.closest?.(
      'button, input, select, textarea, label, a, [contenteditable="true"], .canvas-arrange-panel, .canvas-context-bar, .canvas-minimap, .canvas-zoom-controls, .canvas-node-actions, .search-hits'
    )
  );
}

function isCanvasWheelControlTarget(target) {
  return Boolean(
    target?.closest?.(
      'button, input, select, textarea, label, a, [contenteditable="true"], .canvas-arrange-panel, .canvas-context-bar, .canvas-minimap, .canvas-zoom-controls, .canvas-node-actions, .search-hits'
    )
  );
}

function normalizeCanvasWheelDelta(event) {
  const mode = Number(event?.deltaMode) || 0;
  const unit = mode === 1
    ? 16
    : mode === 2
      ? Math.max(1, canvasViewportEl?.clientHeight || 800)
      : 1;
  const limit = 480;
  const clampDelta = (value) => Math.max(-limit, Math.min(limit, (Number(value) || 0) * unit));
  return { dx: clampDelta(event?.deltaX), dy: clampDelta(event?.deltaY) };
}

function canvasWheelZoomFactor(deltaY) {
  const bounded = Math.max(-120, Math.min(120, Number(deltaY) || 0));
  return Math.exp(-bounded * 0.0015);
}

function beginCanvasPointer(event, kind, id = '') {
  if (event.button != null && event.button !== 0) return;
  const point = canvasPointFromEvent(event);
  if (kind === 'node') {
    cancelCanvasNodeClick(id);
    canvasNodeClickSuppressUntil.delete(id);
    canvasSelectNode(id, event);
  }
  const ids = kind === 'node' ? [...activeCanvasSelection()] : [];
  ensureCanvasStore()?.beginPointer(kind, {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    ids,
  });
  canvasPointerState = {
    kind,
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startPoint: point,
    moved: false,
    selectionAdditive: Boolean(event.metaKey || event.ctrlKey || event.shiftKey),
    initialSelection: [...activeCanvasSelection()],
  };
  canvasInteractionGeneration += 1;
  canvasViewportEl?.setPointerCapture?.(event.pointerId);
  canvasViewportEl?.classList.toggle('is-panning', kind === 'pan');
  if (kind !== 'node') event.preventDefault();
}

function applyCanvasPointer(event) {
  const state = canvasPointerState;
  if (!state || state.pointerId !== event.pointerId) return;
  const dx = event.clientX - state.startX;
  const dy = event.clientY - state.startY;
  if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) state.moved = true;
  if (state.kind === 'node') {
    const zoom = canvasStoreSnapshot().layout.viewport.zoom || 1;
    ensureCanvasStore()?.previewPointer({ dx: dx / zoom, dy: dy / zoom, moved: state.moved });
    return;
  }
  if (state.kind === 'pan') {
    const zoom = canvasStoreSnapshot().layout.viewport.zoom || 1;
    ensureCanvasStore()?.previewPointer({ dx: -dx / zoom, dy: -dy / zoom, moved: state.moved });
    return;
  }
  if (state.kind === 'lasso') {
    const current = canvasPointFromEvent(event);
    const x = Math.min(state.startPoint.x, current.x);
    const y = Math.min(state.startPoint.y, current.y);
    const w = Math.abs(current.x - state.startPoint.x);
    const h = Math.abs(current.y - state.startPoint.y);
    if (canvasSelectionEl) {
      canvasSelectionEl.hidden = false;
      canvasSelectionEl.style.left = `${x}px`;
      canvasSelectionEl.style.top = `${y}px`;
      canvasSelectionEl.style.width = `${w}px`;
      canvasSelectionEl.style.height = `${h}px`;
    }
    const ids = [...(canvasNodesEl?.querySelectorAll('.canvas-node') || [])]
      .map((node) => ({ id: node.dataset.id || '', rect: canvasNodeWorldRect(node) }))
      .filter(({ rect }) => rect && rect.x < x + w && rect.x + rect.w > x && rect.y < y + h && rect.y + rect.h > y)
      .map(({ id }) => id)
      .filter(Boolean);
    const nextSelection = state.selectionAdditive
      ? [...new Set([...state.initialSelection, ...ids])]
      : ids;
    setCanvasSelection(nextSelection);
  }
}

function updateCanvasPointer(event) {
  canvasLastPointerEvent = event;
  canvasQueuedPointerEvent = event;
  if (canvasPointerRaf) return;
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
  canvasPointerRaf = schedule(() => {
    canvasPointerRaf = 0;
    const next = canvasQueuedPointerEvent;
    canvasQueuedPointerEvent = null;
    if (next) applyCanvasPointer(next);
  });
}

function flushCanvasPointerFrame(event = canvasLastPointerEvent) {
  if (canvasPointerRaf) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(canvasPointerRaf);
    else clearTimeout(canvasPointerRaf);
    canvasPointerRaf = 0;
  }
  canvasQueuedPointerEvent = null;
  if (event) applyCanvasPointer(event);
}

function clearCanvasPointerUi(pointerId = null) {
  canvasPointerState = null;
  canvasLastPointerEvent = null;
  canvasSelectionEl?.setAttribute('hidden', 'true');
  try {
    if (pointerId != null) canvasViewportEl?.releasePointerCapture?.(pointerId);
  } catch {
    // ignore
  }
  canvasViewportEl?.classList.remove('is-panning');
}

function cancelCanvasPointer() {
  const state = canvasPointerState;
  if (!state) return;
  flushCanvasPointerFrame();
  if (state.kind === 'node' && state.moved) {
    cancelCanvasNodeClick(state.id);
    suppressCanvasNodeClick(state.id);
  }
  ensureCanvasStore()?.cancelPointer();
  clearCanvasPointerUi(state.pointerId);
}

async function endCanvasPointer(event) {
  const state = canvasPointerState;
  if (!state || state.pointerId !== event.pointerId) return;
  flushCanvasPointerFrame(event);
  if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= DRAG_THRESHOLD) state.moved = true;
  const pointerGeneration = canvasInteractionGeneration;
  const finalPoint = canvasPointFromEvent(event);
  const operation = ensureCanvasStore()?.finishPointer({
    commit: state.moved,
    snap: state.kind === 'node' && canvasSnapToGrid,
  });
  clearCanvasPointerUi(event.pointerId);
  if (state.kind === 'node') {
    if (state.moved) {
      cancelCanvasNodeClick(state.id);
      suppressCanvasNodeClick(state.id);
    }
    if (!state.moved) {
      const item = canvasItemById(state.id);
      if (item && canvasActiveTool === 'select') scheduleCanvasNodePreview(item);
      updateCanvasNodeSelection();
      updateBatchBar();
      return;
    }
    let stacked = false;
    if (activeCanvasSelection().size === 1) {
      const targetId = canvasTargetAt(finalPoint, state.id);
      if (targetId) {
        await ensureCanvasStore()?.flush?.();
        if (pointerGeneration !== canvasInteractionGeneration) return;
        const result = await sendMessage({ type: 'STACK_ITEMS', sourceId: state.id, targetId });
        if (result?.ok) {
          stacked = true;
          ensureCanvasStore()?.setSelection([]);
          selectMode = false;
          await loadList();
        }
      }
    }
    if (!stacked) ensureCanvasStore()?.flush?.();
    updateCanvasNodeSelection();
    updateBatchBar();
  } else if (state.kind === 'pan' && state.moved) {
    ensureCanvasStore()?.flush?.();
  }
}

function initCanvasInteractions() {
  if (!canvasViewportEl) return;
  canvasViewportEl.addEventListener('pointerdown', (event) => {
    if (isCanvasControlTarget(event.target)) return;
    const node = event.target.closest?.('.canvas-node');
    if (node && canvasActiveTool === 'select' && !canvasSpacePressed) {
      beginCanvasPointer(event, 'node', node.dataset.id);
      node.focus({ preventScroll: true });
      return;
    }
    if (canvasActiveTool === 'area') {
      beginCanvasPointer(event, 'lasso');
      return;
    }
    if (canvasActiveTool === 'pan' || canvasActiveTool === 'select' || canvasSpacePressed) {
      beginCanvasPointer(event, 'pan');
    }
  });
  canvasViewportEl.addEventListener('pointermove', updateCanvasPointer);
  canvasViewportEl.addEventListener('pointerup', endCanvasPointer);
  canvasViewportEl.addEventListener('pointercancel', cancelCanvasPointer);
  canvasViewportEl.addEventListener('lostpointercapture', () => {
    if (canvasPointerState) cancelCanvasPointer();
  });
  window.addEventListener('blur', cancelCanvasPointer);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') cancelCanvasPointer();
  });
  canvasViewportEl.addEventListener('wheel', (event) => {
    if (isCanvasWheelControlTarget(event.target)) return;
    const { dx, dy } = normalizeCanvasWheelDelta(event);
    if (!dx && !dy) return;
    const modifierZoom = Boolean(event.ctrlKey || event.metaKey) && dy !== 0;
    event.preventDefault();
    if (modifierZoom) {
      const zoom = canvasStoreSnapshot().layout.viewport.zoom * canvasWheelZoomFactor(dy);
      setCanvasZoom(zoom, event.clientX, event.clientY);
      return;
    }
    const zoom = canvasStoreSnapshot().layout.viewport.zoom || DEFAULT_CANVAS_VIEWPORT.zoom;
    ensureCanvasStore()?.commitPan(dx / zoom, dy / zoom);
  }, { passive: false });
  const refreshCanvasGeometry = () => {
    if (settings.viewMode !== 'canvas' || canvasSessionFallback) return;
    renderCanvasMinimap(getCanvasVisibleTabs());
    scheduleInitialCanvasCenter();
  };
  window.addEventListener('resize', refreshCanvasGeometry);
  if (typeof ResizeObserver === 'function') {
    canvasGeometryObserver = new ResizeObserver(refreshCanvasGeometry);
    canvasGeometryObserver.observe(canvasViewportEl);
    if (canvasMinimap) canvasGeometryObserver.observe(canvasMinimap);
  }
  canvasViewportEl.addEventListener('dblclick', (event) => {
    if (isCanvasControlTarget(event.target)) return;
    const node = event.target.closest?.('.canvas-node');
    const id = node?.dataset.id || canvasTargetAt(canvasPointFromEvent(event));
    if (id) {
      cancelCanvasNodeClick(id);
      restoreItem(id);
    }
  });
  canvasViewportEl.addEventListener('keydown', (event) => {
    const focusedNode = event.target.closest?.('.canvas-node');
    if (focusedNode && event.target === focusedNode) {
      if (event.key === 'Enter') {
        event.preventDefault();
        restoreItem(focusedNode.dataset.id);
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        canvasSelectNode(focusedNode.dataset.id, event);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteItem(focusedNode.dataset.id);
        return;
      }
    }
    if (event.key === 'Escape') {
      ensureCanvasStore()?.setSelection([]);
      updateCanvasNodeSelection();
      updateBatchBar();
      return;
    }
    if (event.key === 'Enter' && activeCanvasSelection().size === 1) {
      event.preventDefault();
      restoreItem([...activeCanvasSelection()][0]);
      return;
    }
    if (event.key === 'Delete' && activeCanvasSelection().size) {
      event.preventDefault();
      batchDelete?.click();
      return;
    }
    if (event.key.startsWith('Arrow') && activeCanvasSelection().size) {
      event.preventDefault();
      const amount = event.shiftKey ? 24 : 8;
      const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      canvasMoveSelected(dx, dy);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || isTypingTarget(event.target)) return;
    canvasSpacePressed = true;
    if (document.activeElement === canvasViewportEl) event.preventDefault();
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') canvasSpacePressed = false;
  });
  document.querySelectorAll('[data-canvas-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      canvasActiveTool = button.dataset.canvasTool || 'select';
      document.querySelectorAll('[data-canvas-tool]').forEach((tool) => tool.classList.toggle('active', tool === button));
    });
  });
  document.getElementById('canvasZoomOut')?.addEventListener('click', () => setCanvasZoom(canvasStoreSnapshot().layout.viewport.zoom - 0.1));
  document.getElementById('canvasZoomIn')?.addEventListener('click', () => setCanvasZoom(canvasStoreSnapshot().layout.viewport.zoom + 0.1));
  document.getElementById('canvasResetView')?.addEventListener('click', () => {
    ensureCanvasStore()?.commitViewport({ ...DEFAULT_CANVAS_VIEWPORT });
  });
  document.getElementById('canvasArrangeBtn')?.addEventListener('click', () => {
    if (!canvasArrangePanel) return;
    canvasArrangePanel.dataset.open = canvasArrangePanel.dataset.open === 'true' ? 'false' : 'true';
    canvasArrangePanel.classList.toggle('open', canvasArrangePanel.dataset.open === 'true');
  });
  document.querySelectorAll('[data-canvas-arrange]').forEach((button) => {
    button.addEventListener('click', () => arrangeCanvas(button.dataset.canvasArrange));
  });
  document.getElementById('canvasSnapToggle')?.addEventListener('change', (event) => {
    canvasSnapToGrid = event.target.checked;
    const settingsSnap = document.getElementById('settingsCanvasSnap');
    if (settingsSnap) settingsSnap.checked = canvasSnapToGrid;
    saveSettings({ canvasSnap: canvasSnapToGrid }).catch(() => {});
  });
  document.getElementById('canvasAllBtn')?.addEventListener('click', () => setCanvasIndexFilter('all'));
  document.getElementById('canvasUnsortedBtn')?.addEventListener('click', () => setCanvasIndexFilter('unsorted'));
  document.getElementById('canvasPinnedBtn')?.addEventListener('click', () => setCanvasIndexFilter('pinned'));
  document.getElementById('canvasLinkBtn')?.addEventListener('click', () => quickAddUrlMenu?.click());
  document.querySelectorAll('[data-canvas-action]').forEach((button) => {
    button.addEventListener('click', () => canvasAction(button.dataset.canvasAction));
  });
  canvasStackConfirm?.addEventListener('click', createCanvasStackFromSelection);
  canvasStackCancel?.addEventListener('click', closeCanvasStackDialog);
  canvasStackTitle?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createCanvasStackFromSelection();
  });
  canvasDropZone?.addEventListener('click', openCanvasStackDialog);
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
  if (settings.viewMode === 'canvas' && !canvasSessionFallback) {
    renderCanvas();
    return;
  }
  // Always release observations before replacing or emptying the grid.
  if (thumbObserver) {
    try {
      thumbObserver.disconnect();
    } catch {
      // ignore
    }
  }
  // Fresh match cache for this paint (shared by filter + group hit rows)
  searchMatchCache = new Map();
  const filtered = getVisibleTabs();
  updateSavedBadge();

  if (allTabs.length === 0) {
    searchMatchCache = null;
    renderEmpty({ title: t('emptyTitle'), body: t('emptyBody') });
    return;
  }
  if (filtered.length === 0) {
    searchMatchCache = null;
    renderEmpty({ title: t('noResultsTitle'), body: t('noResultsBody') });
    return;
  }

  gridEl.innerHTML = '';
  applyCardCols(settings.cardCols);
  const frag = document.createDocumentFragment();
  const isList = settings.viewMode === 'list' || canvasSessionFallback;
  filtered.forEach((item) => {
    frag.appendChild(isList ? createRow(item) : createCard(item));
  });
  gridEl.appendChild(frag);
  searchMatchCache = null;
}

let loadListTimer = null;

async function loadList() {
  const generation = ++canvasLoadGeneration;
  const [res, layoutRes] = await Promise.all([
    sendMessage({ type: 'GET_PARKED_ITEMS' }),
    sendMessage({ type: 'GET_CANVAS_LAYOUT' }),
  ]);
  if (generation !== canvasLoadGeneration) return false;
  if (!res?.ok || (!Array.isArray(res.items) && !Array.isArray(res.tabs))) {
    if (loadStatusEl) loadStatusEl.textContent = t('loadFailed');
    uiLog('error', 'load', 'parked items unavailable', res?.error || 'invalid_response');
    if (settings.viewMode === 'canvas') {
      canvasSessionFallback = true;
      applyViewMode('list');
      renderGrid();
    }
    return false;
  }
  if (loadStatusEl) loadStatusEl.textContent = '';
  const raw =
    Array.isArray(res.items)
      ? res.items
      : Array.isArray(res.tabs)
        ? res.tabs
        : [];
  allTabs = raw.map((item) => {
    if (item.kind === 'group' || Array.isArray(item.tabs)) {
      return {
        ...item,
        kind: 'group',
        pinned: Boolean(item.pinned),
        note: typeof item.note === 'string' ? item.note : '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        tabs: Array.isArray(item.tabs) ? item.tabs : [],
      };
    }
    return {
      ...item,
      kind: 'tab',
      pinned: Boolean(item.pinned),
      note: typeof item.note === 'string' ? item.note : '',
      tags: Array.isArray(item.tags) ? item.tags : [],
    };
  });
  if (!layoutRes?.ok && settings.viewMode === 'canvas') {
    ensureCanvasStore()?.setItems(allTabs);
    canvasNeedsInitialCenter = false;
    canvasSessionFallback = true;
    applyViewMode('list');
    renderGrid();
    uiLog('error', 'canvas', 'layout unavailable', layoutRes?.error || 'invalid_response');
    return false;
  }
  const store = ensureCanvasStore();
  const current = store?.getState?.();
  if (current?.pendingOperations?.length || current?.interaction) {
    canvasNeedsInitialCenter = false;
    store.setItems(allTabs);
    if (layoutRes?.ok) store.applyRemote(layoutRes.layout, layoutRes.revision);
  } else {
    store.hydrate(
      allTabs,
      layoutRes?.ok ? layoutRes.layout : canvasLayout,
      layoutRes?.ok ? layoutRes.revision : current?.revision || 0,
    );
    canvasNeedsInitialCenter = Boolean(layoutRes?.ok && layoutRes.needsInitialCenter);
  }
  canvasSessionFallback = false;
  applyViewMode(settings.viewMode);
  renderCanvasStackIndex();
  renderGrid();
  scheduleInitialCanvasCenter();
  return true;
}

function scheduleLoadList() {
  if (loadListTimer) clearTimeout(loadListTimer);
  loadListTimer = setTimeout(() => {
    loadListTimer = null;
    loadList().catch((err) => {
      if (loadStatusEl) loadStatusEl.textContent = t('loadFailed');
      uiLog('error', 'load', 'exception', err?.message || err);
      if (settings.viewMode === 'canvas') {
        canvasSessionFallback = true;
        applyViewMode('list');
        renderGrid();
      }
    });
  }, 150);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.parkedTabs || changes.parkedItems) scheduleLoadList();
  if (changes.canvasLayout || changes.canvasLayoutRevision) {
    const layout = changes.canvasLayout?.newValue;
    const revision = changes.canvasLayoutRevision?.newValue;
    if (layout && ensureCanvasStore()) {
      ensureCanvasStore().applyRemote(layout, revision);
    } else {
      scheduleLoadList();
    }
  }
  if (changes.settings) {
    // Ignore echo from this page's saveSettings (was rebuilding entire grid + thumbs)
    if (suppressSettingsOnChanged) return;
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    delete settings.shortcuts;
    settings.cardCols = clampCols(settings.cardCols);
    settings.searchRegex = Boolean(settings.searchRegex);
    settings.canvasSnap = settings.canvasSnap !== false;
    settings.autoBackup = normalizeAutoBackup({
      ...DEFAULT_AUTO_BACKUP,
      ...(settings.autoBackup || {}),
    });
    syncSettingsUi();
    renderGrid();
  }
});

initCanvasInteractions();

initSettingsUi().then(async () => {
  if (Media?.openDb) Media.openDb().catch(() => {});
  await loadList();
  maybeCatchUpAutoBackup().catch(() => {});
  try {
    window.focus();
  } catch {
    // ignore
  }
});
