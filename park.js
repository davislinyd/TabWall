/**
 * TabWall — Spatial canvas UI
 */

const SETTINGS_KEY = 'settings';
const CANVAS_LAYOUT_VERSION = 1;
const DEFAULT_CANVAS_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1 });
const CANVAS_NODE_CLICK_DELAY = 300;
const CANVAS_MIDDLE_CLICK_DELAY = 300;
const CANVAS_RAIL_DEFAULT_WIDTH = 188;
const CANVAS_RAIL_MIN_WIDTH = 168;
const CANVAS_RAIL_MAX_WIDTH = 360;
const CANVAS_RAIL_COLLAPSE_THRESHOLD = 120;
const CANVAS_RAIL_COLLAPSED_WIDTH = 34;
const CANVAS_RAIL_KEYBOARD_STEP = 16;
// Node display / gap / connection curve / wheel zoom math constants live in parkCanvasGeometry.js
const CANVAS_ZOOM_MIN = 0.25;
const CANVAS_ZOOM_MAX = 2;
const CANVAS_ZOOM_STEP = 0.05;
const CANVAS_FIT_PADDING = 24;
const CANVAS_CONNECTION_HIT_WIDTH = 16;

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

const AUTO_SAVE_METADATA_MAX_RULES = 50;
const AUTO_SAVE_METADATA_MAX_CONDITIONS = 20;
const AUTO_SAVE_METADATA_OPERATORS = [
  'match',
  'contains',
  'startsWith',
  'endsWith',
  'regex',
];
const DEFAULT_AUTO_SAVE_METADATA = {
  enabled: false,
  rules: [],
};

const DEFAULT_SETTINGS = {
  afterSave: 'close',
  afterSaveGroup: 'close',
  preSaveEdit: true,
  saveGroupCapture: 'all',
  restoreGroupIn: 'currentWindow',
  viewMode: 'canvas',
  sortBy: 'newest',
  theme: 'dark',
  fxLevel: 'standard',
  cardCols: 4,
  locale: 'zh',
  defaultViewMode: 'canvas',
  openWithSearchFocus: false,
  searchRegex: false,
  autoBackup: { ...DEFAULT_AUTO_BACKUP },
  autoSaveMetadata: { ...DEFAULT_AUTO_SAVE_METADATA },
  canvasSnap: true,
  canvasRailWidth: CANVAS_RAIL_DEFAULT_WIDTH,
  canvasRailCollapsed: false,
};

const Build = self.TabWallBackupBuild;
const CanvasStoreApi = self.TabWallCanvasStore;
const NoteMedia = self.TabWallNoteMedia;
const SearchQuery = self.TabWallSearchQuery;
const SearchUi = self.TabWallSearchUi;
const Media = self.TabWallMediaDB;
const MediaUi = self.TabWallMediaUi;
const CanvasGeom = self.TabWallCanvasGeometry;
const CanvasRender = self.TabWallCanvasRender;
const SettingsUi = self.TabWallSettingsUi;
const ImportExport = self.TabWallImportExport;
const StickerUi = self.TabWallStickerUi;
const CanvasIx = self.TabWallCanvasInteraction;
const CanvasChrome = self.TabWallCanvasChrome;
const ListUi = self.TabWallListUi;
const WorkspaceUi = self.TabWallWorkspaceUi;
const AppHelpers = self.TabWallAppHelpers;

function classifyStoredUrl(...args) { return AppHelpers.classifyStoredUrl(...args); }

function isStoredOnlyUrl(...args) { return AppHelpers.isStoredOnlyUrl(...args); }

function countStoredOnlyUrls(...args) { return AppHelpers.countStoredOnlyUrls(...args); }

function formatImportWarnings(...args) { return ImportExport.formatImportWarnings(...args); }

function formatBackupError(...args) { return ImportExport.formatBackupError(...args); }

function formatNoteBytes(...args) { return AppHelpers.formatNoteBytes(...args); }

function formatNoteMediaError(...args) { return AppHelpers.formatNoteMediaError(...args); }

function getParentOrigin(...args) { return AppHelpers.getParentOrigin(...args); }

const PARENT_ORIGIN = getParentOrigin();

function postToParent(...args) { return AppHelpers.postToParent(...args); }

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

// Canvas pure geometry (zoom factor / bounds / connection bezier) lives in parkCanvasGeometry.js.
const CANVAS_NODE_DISPLAY_SCALE = CanvasGeom.CANVAS_NODE_DISPLAY_SCALE;
const CANVAS_NODE_DEFAULT_WIDTH = CanvasGeom.CANVAS_NODE_DEFAULT_WIDTH;
const CANVAS_NODE_DEFAULT_HEIGHT = CanvasGeom.CANVAS_NODE_DEFAULT_HEIGHT;
const CANVAS_DEFAULT_CARD_GAP = CanvasGeom.CANVAS_DEFAULT_CARD_GAP;
const CANVAS_CONNECTION_MAX_CURVE_OFFSET = CanvasGeom.CANVAS_CONNECTION_MAX_CURVE_OFFSET;
const CANVAS_WHEEL_ZOOM_SENSITIVITY = CanvasGeom.CANVAS_WHEEL_ZOOM_SENSITIVITY;
const CANVAS_TRACKPAD_ZOOM_SENSITIVITY = CanvasGeom.CANVAS_TRACKPAD_ZOOM_SENSITIVITY;
const CANVAS_WHEEL_ZOOM_FRAME_LIMIT = CanvasGeom.CANVAS_WHEEL_ZOOM_FRAME_LIMIT;
const canvasDefaultPosition = CanvasGeom.canvasDefaultPosition;
const canvasDisplayPosition = CanvasGeom.canvasDisplayPosition;
const canvasBoundsForItems = CanvasGeom.canvasBoundsForItems;
const canvasConnectionId = CanvasGeom.canvasConnectionId;
const canvasConnectionSideForVector = CanvasGeom.canvasConnectionSideForVector;
const canvasConnectionSideForPoint = CanvasGeom.canvasConnectionSideForPoint;
const canvasConnectionCurveGeometry = CanvasGeom.canvasConnectionCurveGeometry;
const canvasCubicBezierPoint = CanvasGeom.canvasCubicBezierPoint;
const canvasCubicBezierLength = CanvasGeom.canvasCubicBezierLength;
const canvasCubicBezierTAtLength = CanvasGeom.canvasCubicBezierTAtLength;
const canvasCubicBezierSplit = CanvasGeom.canvasCubicBezierSplit;
const canvasConnectionCurveSegments = CanvasGeom.canvasConnectionCurveSegments;
const canvasConnectionPathD = CanvasGeom.canvasConnectionPathD;
const canvasConnectionHandlePoint = CanvasGeom.canvasConnectionHandlePoint;
const canvasMinimapProjectionFor = CanvasGeom.canvasMinimapProjectionFor;
const canvasWheelZoomFactor = CanvasGeom.canvasWheelZoomFactor;
const canvasWheelZoomSensitivity = CanvasGeom.canvasWheelZoomSensitivity;

// Media thumb/snap/attachment URL cache + lazy load lives in parkMediaUi.js
// (bound near SearchUi once page state/DOM refs exist).
const I18N = self.TabWallI18n;

const gridEl = document.getElementById('grid');
const canvasView = document.getElementById('canvasView');
const canvasRail = document.getElementById('canvasRail');
const canvasRailResize = document.getElementById('canvasRailResize');
const canvasRailToggle = document.getElementById('canvasRailToggle');
const canvasViewportEl = document.getElementById('canvasViewport');
const canvasWorldEl = document.getElementById('canvasWorld');
const canvasWorldScaleEl = document.getElementById('canvasWorldScale');
const canvasConnectionsEl = document.getElementById('canvasConnections');
const canvasNodesEl = document.getElementById('canvasNodes');
const canvasSelectionEl = document.getElementById('canvasSelection');
const canvasContextBar = document.getElementById('canvasContextBar');
const canvasContextMenu = document.getElementById('canvasContextMenu');
const canvasMinimap = document.getElementById('canvasMinimap');
const canvasMinimapViewport = document.getElementById('canvasMinimapViewport');
const canvasZoomValueWrap = document.getElementById('canvasZoomValueWrap');
const canvasZoomValue = document.getElementById('canvasZoomValue');
const canvasZoomSlider = document.getElementById('canvasZoomSlider');
const canvasZoomMenu = document.getElementById('canvasZoomMenu');
const canvasDropZone = document.getElementById('canvasDropZone');
const canvasStackDialog = document.getElementById('canvasStackDialog');
const canvasStackTitle = document.getElementById('canvasStackTitle');
const canvasStackConfirm = document.getElementById('canvasStackConfirm');
const canvasStackCancel = document.getElementById('canvasStackCancel');
const canvasAddNoteBtn = document.getElementById('canvasAddNoteBtn');
const stickerNoteBox = document.getElementById('stickerNoteBox');
const stickerNoteDrag = document.getElementById('stickerNoteDrag');
const stickerNoteTitle = document.getElementById('stickerNoteTitle');
const stickerNoteMarkdown = document.getElementById('stickerNoteMarkdown');
const stickerNotePreview = document.getElementById('stickerNotePreview');
const stickerNoteFile = document.getElementById('stickerNoteFile');
const stickerNoteAttachments = document.getElementById('stickerNoteAttachments');
const stickerNoteMediaStatus = document.getElementById('stickerNoteMediaStatus');
const stickerNoteDrop = document.getElementById('stickerNoteDrop');
const stickerNoteSave = document.getElementById('stickerNoteSave');
const stickerNoteCancel = document.getElementById('stickerNoteCancel');
const stickerNoteCloseX = document.getElementById('stickerNoteCloseX');
const stickerNoteChips = document.getElementById('stickerNoteChips');
const stickerNoteTagDraft = document.getElementById('stickerNoteTagDraft');
const countEl = document.getElementById('count');
const loadStatusEl = document.getElementById('loadStatus');
const searchEl = document.getElementById('search');
const searchRegexBtn = document.getElementById('searchRegexBtn');
const searchWrap = document.getElementById('searchWrap');
const searchScopeChip = document.getElementById('searchScopeChip');
const searchTagSuggest = document.getElementById('searchTagSuggest');
const quickAddBtn = document.getElementById('quickAddBtn');
const quickAddMenuBtn = document.getElementById('quickAddMenuBtn');
const quickAddMenu = document.getElementById('quickAddMenu');
const quickAddTabMenu = document.getElementById('quickAddTabMenu');
const quickAddGroupMenu = document.getElementById('quickAddGroupMenu');
const quickAddUrlMenu = document.getElementById('quickAddUrlMenu');
const canvasOrganizeWrap = document.getElementById('canvasOrganizeWrap');
const canvasOrganizeBtn = document.getElementById('canvasOrganizeBtn');
const canvasOrganizePanel = document.getElementById('canvasOrganizePanel');
const manualAddWrap = document.getElementById('manualAddWrap');
const manualAddTopBtn = document.getElementById('manualAddTopBtn');
const manualAddPanel = document.getElementById('manualAddPanel');
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
const preSaveModal = document.getElementById('preSaveModal');
const preSaveTitle = document.getElementById('preSaveTitle');
const preSaveUrl = document.getElementById('preSaveUrl');
const preSaveNote = document.getElementById('preSaveNote');
const preSaveChips = document.getElementById('preSaveChips');
const preSaveTagDraft = document.getElementById('preSaveTagDraft');
const preSaveError = document.getElementById('preSaveError');
const preSaveCancel = document.getElementById('preSaveCancel');
const preSaveConfirm = document.getElementById('preSaveConfirm');
const settingsPreSaveEdit = document.getElementById('settingsPreSaveEdit');
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

function uiLog(...args) { return AppHelpers.uiLog(...args); }

function formatLogEntry(e) {
  const ts = new Date(e.t).toISOString().replace('T', ' ').replace('Z', '');
  const d = e.detail ? ` | ${e.detail}` : '';
  return `${ts} [${e.level}] [${e.tag}] ${e.msg}${d}`;
}

async function refreshDiagLogPanel(...args) { return await AppHelpers.refreshDiagLogPanel(...args); }

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
const autoSaveMetadataEnabledEl = document.getElementById('autoSaveMetadataEnabled');
const autoSaveMetadataRulesEl = document.getElementById('autoSaveMetadataRules');
const autoSaveMetadataAddRuleBtn = document.getElementById('autoSaveMetadataAddRuleBtn');
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
const lbBack = document.getElementById('lbBack');
const lbManageMembers = document.getElementById('lbManageMembers');

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
let allTabs = []; // ParkItem[] (kind tab | group | note)
/** Store-owned read projection; canvas mutations must go through canvasStore. */
let canvasLayout = {
  version: CANVAS_LAYOUT_VERSION,
  viewport: { ...DEFAULT_CANVAS_VIEWPORT },
  positions: {},
  connections: [],
};
let canvasStore = null;
const canvasNodeElements = new Map();
const canvasConnectionElements = new Map(); // connectionId -> { path, highlights: [h0,h1,h2], hits: [x0,x1,x2] }
let canvasConnectionDraftEl = null;
const canvasMinimapElements = new Map();
let canvasLoadGeneration = 0;
let canvasPointerRaf = 0;
let canvasQueuedPointerEvent = null;
let canvasLastPointerEvent = null;
let canvasInteractionGeneration = 0;
let canvasRailResizeState = null;
let canvasRailResizeFrame = 0;
let canvasMinimapProjection = null;
let canvasMinimapDragState = null;
let canvasSessionFallback = false;
let canvasNeedsInitialCenter = false;
let canvasInitialCenterRaf = 0;
let canvasGeometryObserver = null;
let canvasSaveTimer = null;
let canvasPointerState = null;
let canvasActiveTool = 'select';
let selectedCanvasConnectionId = '';
let canvasConnectionSourceId = '';
let canvasConnectionDragState = null;
const canvasConnectionClickSuppressUntil = new Map();
const canvasConnectionPointerDownAt = new Map();
let canvasSnapToGrid = true;
let canvasSpacePressed = false;
let canvasZoomWheelFrame = 0;
let canvasZoomWheelState = null;
let canvasMiddleClickTimer = null;
let canvasLastMiddleClickAt = 0;
const canvasNodeClickTimers = new Map();
const canvasNodeClickSuppressUntil = new Map();
let query = '';
/** @type {'all'|'tag'|'note'} */
let searchScope = 'all';
/** @type {typeof DEFAULT_SETTINGS} */
let settings = { ...DEFAULT_SETTINGS };

// Media UI (thumb/snap/lazy load) lives in parkMediaUi.js.
MediaUi.bind({
  sendMessage: (payload) => sendMessage(payload),
  getCanvasViewportEl: () => canvasViewportEl,
  getCanvasNodesEl: () => canvasNodesEl,
  getCanvasZoom: () => canvasLayout?.viewport?.zoom ?? 1,
  getAllTabs: () => allTabs,
  t: (key, vars) => t(key, vars),
});
const snapCache = MediaUi.snapCache;
const cacheSnap = MediaUi.cacheSnap;
const fetchMediaUrl = MediaUi.fetchMediaUrl;
const wireCanvasMedia = MediaUi.wireCanvasMedia;
const observeThumb = MediaUi.observeThumb;
const observeStickerAttachment = MediaUi.observeStickerAttachment;
const disconnectCanvasMediaObserver = MediaUi.disconnectCanvasMediaObserver;
const pruneAttachmentUrlCache = MediaUi.pruneAttachmentUrlCache;
const refreshCanvasMediaQuality = MediaUi.refreshCanvasMediaQuality;
const scheduleCanvasMediaQualityRefresh = MediaUi.scheduleCanvasMediaQualityRefresh;
const mediaKeyForItem = MediaUi.mediaKeyForItem;
const mediaKeyForMember = MediaUi.mediaKeyForMember;

// Canvas render surface (node HTML / arrange / minimap / connections) lives in parkCanvasRender.js.
CanvasRender.bind({
  canvasNodeElements,
  canvasConnectionElements,
  canvasMinimapElements,
  canvasNodeClickSuppressUntil,
  t: (key, vars) => t(key, vars),
  escapeHtml: (s) => escapeHtml(s),
  escapeAttr: (s) => escapeAttr(s),
  iconSvg: (name) => iconSvg(name),
  groupCoverHtml: (item, opts) => groupCoverHtml(item, opts),
  itemTitle: (item) => itemTitle(item),
  formatSavedAt: (ts) => formatSavedAt(ts),
  domainOf: (url) => domainOf(url),
  mediaKeyForItem: (item) => mediaKeyForItem(item),
  activeCanvasSelection: () => activeCanvasSelection(),
  canvasPositionFor: (id, index) => canvasPositionFor(id, index),
  canvasStoreSnapshot: () => canvasStoreSnapshot(),
  canvasNodeWorldRect: (node) => canvasNodeWorldRect(node),
  getCanvasSearchContext: () => getCanvasSearchContext(),
  canvasSearchLayoutFor: (sc) => canvasSearchLayoutFor(sc),
  isCanvasSearchPreviewActive: (sc) => isCanvasSearchPreviewActive(sc),
  ensureCanvasStore: () => ensureCanvasStore(),
  updateSavedBadge: () => updateSavedBadge(),
  syncCanvasIndexUi: () => syncCanvasIndexUi(),
  updateBatchBar: () => updateBatchBar(),
  updateCanvasTransform: () => updateCanvasTransform(),
  updateCanvasNodeSelection: () => updateCanvasNodeSelection(),
  wireCanvasNodeActions: (node) => wireCanvasNodeActions(node),
  wireCanvasMedia: (img) => wireCanvasMedia(img),
  wireFavicon: (el) => wireFavicon(el),
  appendGroupSearchHits: (node, item) => appendGroupSearchHits(node, item),
  wireStickerAttachmentImages: (root, note) => wireStickerAttachmentImages(root, note),
  cancelCanvasNodeClick: (id) => cancelCanvasNodeClick(id),
  wireCanvasConnectionPath: (path, connection, connectionId, zone) => wireCanvasConnectionPath(path, connection, connectionId, zone),
  snapCanvasPosition: (position) => snapCanvasPosition(position),
  canvasViewportEl: () => canvasViewportEl,
  canvasConnectionsEl: () => canvasConnectionsEl,
  canvasNodesEl: () => canvasNodesEl,
  canvasMinimap: () => canvasMinimap,
  canvasMinimapViewport: () => canvasMinimapViewport,
  canvasDropZone: () => canvasDropZone,
  canvasLayout: () => canvasLayout,
  canvasConnectionDragState: () => canvasConnectionDragState,
  canvasConnectionDraftEl: () => canvasConnectionDraftEl,
  setCanvasConnectionDraftEl: (el) => { canvasConnectionDraftEl = el; },
  canvasConnectionSourceId: () => canvasConnectionSourceId,
  selectedCanvasConnectionId: () => selectedCanvasConnectionId,
  setSelectedCanvasConnectionId: (id) => { selectedCanvasConnectionId = id; },
  canvasMinimapDragState: () => canvasMinimapDragState,
  canvasMinimapProjection: () => canvasMinimapProjection,
  setCanvasMinimapProjection: (p) => { canvasMinimapProjection = p; },
  allTabs: () => allTabs,
  query: () => query,
  settings: () => settings,
  // Observers live inside parkMediaUi.js; unobserve is best-effort.
  thumbObserver: () => null,
  canvasMediaObserver: () => null,
  canvasItemById: (id) => canvasItemById(id),
  CANVAS_CONNECTION_HIT_WIDTH: () => CANVAS_CONNECTION_HIT_WIDTH,
});

// Compact live env for panel + domain modules (no eval/with).
function bindPanelModules() {
  const env = Object.create(null);
  const ro = {
    "activeCanvasSelection": () => activeCanvasSelection,
    "applyCanvasRailUi": () => applyCanvasRailUi,
    "applyCanvasSearchPointerPreview": () => applyCanvasSearchPointerPreview,
    "applyCanvasZoomAction": () => applyCanvasZoomAction,
    "applyCardCols": () => applyCardCols,
    "applyI18n": () => applyI18n,
    "applyViewMode": () => applyViewMode,
    "armCanvasNotePlacement": () => armCanvasNotePlacement,
    "arrangeCanvas": () => arrangeCanvas,
    "arrangeCanvasAlign": () => arrangeCanvasAlign,
    "arrangeCanvasGrid": () => arrangeCanvasGrid,
    "AUTO_SAVE_METADATA_MAX_CONDITIONS": () => AUTO_SAVE_METADATA_MAX_CONDITIONS,
    "AUTO_SAVE_METADATA_MAX_RULES": () => AUTO_SAVE_METADATA_MAX_RULES,
    "AUTO_SAVE_METADATA_OPERATORS": () => AUTO_SAVE_METADATA_OPERATORS,
    "autoBackupEnabledEl": () => autoBackupEnabledEl,
    "autoBackupErrorText": () => autoBackupErrorText,
    "autoBackupIntervalMinutes": () => autoBackupIntervalMinutes,
    "autoBackupIntervalUnitEl": () => autoBackupIntervalUnitEl,
    "autoBackupIntervalValueEl": () => autoBackupIntervalValueEl,
    "autoBackupLocationLabelEl": () => autoBackupLocationLabelEl,
    "autoBackupMaxKeepEl": () => autoBackupMaxKeepEl,
    "autoBackupNowBtn": () => autoBackupNowBtn,
    "autoBackupOnChangeEl": () => autoBackupOnChangeEl,
    "autoBackupShowFolderBtn": () => autoBackupShowFolderBtn,
    "autoBackupStatusEl": () => autoBackupStatusEl,
    "autoBackupSubfolderEl": () => autoBackupSubfolderEl,
    "autoSaveMetadataAddRuleBtn": () => autoSaveMetadataAddRuleBtn,
    "autoSaveMetadataEnabledEl": () => autoSaveMetadataEnabledEl,
    "autoSaveMetadataRulesEl": () => autoSaveMetadataRulesEl,
    "backupStatus": () => backupStatus,
    "batchBar": () => batchBar,
    "batchCount": () => batchCount,
    "batchDelete": () => batchDelete,
    "batchRestore": () => batchRestore,
    "Build": () => Build,
    "cacheSnap": () => cacheSnap,
    "cancelCanvasConnectionDrag": () => cancelCanvasConnectionDrag,
    "cancelCanvasNodeClick": () => cancelCanvasNodeClick,
    "cancelCanvasPointer": () => cancelCanvasPointer,
    "CANVAS_CONNECTION_MAX_CURVE_OFFSET": () => CANVAS_CONNECTION_MAX_CURVE_OFFSET,
    "CANVAS_FIT_PADDING": () => CANVAS_FIT_PADDING,
    "CANVAS_LAYOUT_VERSION": () => CANVAS_LAYOUT_VERSION,
    "CANVAS_MIDDLE_CLICK_DELAY": () => CANVAS_MIDDLE_CLICK_DELAY,
    "CANVAS_NODE_CLICK_DELAY": () => CANVAS_NODE_CLICK_DELAY,
    "CANVAS_RAIL_COLLAPSE_THRESHOLD": () => CANVAS_RAIL_COLLAPSE_THRESHOLD,
    "CANVAS_RAIL_COLLAPSED_WIDTH": () => CANVAS_RAIL_COLLAPSED_WIDTH,
    "CANVAS_RAIL_KEYBOARD_STEP": () => CANVAS_RAIL_KEYBOARD_STEP,
    "CANVAS_RAIL_MAX_WIDTH": () => CANVAS_RAIL_MAX_WIDTH,
    "CANVAS_WHEEL_ZOOM_FRAME_LIMIT": () => CANVAS_WHEEL_ZOOM_FRAME_LIMIT,
    "CANVAS_WHEEL_ZOOM_SENSITIVITY": () => CANVAS_WHEEL_ZOOM_SENSITIVITY,
    "CANVAS_ZOOM_MAX": () => CANVAS_ZOOM_MAX,
    "CANVAS_ZOOM_MIN": () => CANVAS_ZOOM_MIN,
    "CANVAS_ZOOM_STEP": () => CANVAS_ZOOM_STEP,
    "canvasAction": () => canvasAction,
    "canvasAddNoteBtn": () => canvasAddNoteBtn,
    "canvasBoundsForItems": () => canvasBoundsForItems,
    "canvasConnectionClickSuppressUntil": () => canvasConnectionClickSuppressUntil,
    "canvasConnectionHandlePointForId": () => canvasConnectionHandlePointForId,
    "canvasConnectionId": () => canvasConnectionId,
    "canvasConnectionPointerDownAt": () => canvasConnectionPointerDownAt,
    "canvasConnectionPosition": () => canvasConnectionPosition,
    "canvasConnectionsEl": () => canvasConnectionsEl,
    "canvasContextBar": () => canvasContextBar,
    "canvasContextMenu": () => canvasContextMenu,
    "canvasDefaultPosition": () => canvasDefaultPosition,
    "canvasDisplayPosition": () => canvasDisplayPosition,
    "canvasDropZone": () => canvasDropZone,
    "canvasItemById": () => canvasItemById,
    "canvasItemPassesIndexFilter": () => canvasItemPassesIndexFilter,
    "canvasMinimap": () => canvasMinimap,
    "canvasMinimapViewport": () => canvasMinimapViewport,
    "canvasMoveSelected": () => canvasMoveSelected,
    "canvasNodeActionEntries": () => canvasNodeActionEntries,
    "canvasNodeClickSuppressUntil": () => canvasNodeClickSuppressUntil,
    "canvasNodeClickTimers": () => canvasNodeClickTimers,
    "canvasNodeElements": () => canvasNodeElements,
    "canvasNodesEl": () => canvasNodesEl,
    "canvasNodeWorldRectFromState": () => canvasNodeWorldRectFromState,
    "canvasOrganizeBtn": () => canvasOrganizeBtn,
    "canvasOrganizePanel": () => canvasOrganizePanel,
    "canvasPointFromEvent": () => canvasPointFromEvent,
    "canvasRailResize": () => canvasRailResize,
    "canvasRailToggle": () => canvasRailToggle,
    "canvasSearchLayoutFor": () => canvasSearchLayoutFor,
    "canvasSearchPreviewKey": () => canvasSearchPreviewKey,
    "canvasSearchPreviewSelectedIds": () => canvasSearchPreviewSelectedIds,
    "canvasSelectionEl": () => canvasSelectionEl,
    "canvasSelectNode": () => canvasSelectNode,
    "canvasStackCancel": () => canvasStackCancel,
    "canvasStackConfirm": () => canvasStackConfirm,
    "canvasStackDialog": () => canvasStackDialog,
    "canvasStackTitle": () => canvasStackTitle,
    "CanvasStoreApi": () => CanvasStoreApi,
    "canvasStoreSnapshot": () => canvasStoreSnapshot,
    "canvasTargetAt": () => canvasTargetAt,
    "canvasView": () => canvasView,
    "canvasViewportEl": () => canvasViewportEl,
    "canvasViewportSize": () => canvasViewportSize,
    "canvasWheelZoomFactor": () => canvasWheelZoomFactor,
    "canvasWheelZoomSensitivity": () => canvasWheelZoomSensitivity,
    "canvasWorldEl": () => canvasWorldEl,
    "canvasWorldScaleEl": () => canvasWorldScaleEl,
    "canvasWorldViewportCenter": () => canvasWorldViewportCenter,
    "canvasZoomMenu": () => canvasZoomMenu,
    "canvasZoomSlider": () => canvasZoomSlider,
    "canvasZoomValue": () => canvasZoomValue,
    "canvasZoomValueWrap": () => canvasZoomValueWrap,
    "cardColsEl": () => cardColsEl,
    "centerDedupeBox": () => centerDedupeBox,
    "clampCols": () => clampCols,
    "clampInt": () => clampInt,
    "cleanupCardDragVisual": () => cleanupCardDragVisual,
    "clearCanvasMiddleClickSequence": () => clearCanvasMiddleClickSequence,
    "clearCanvasPointerUi": () => clearCanvasPointerUi,
    "clearStackHover": () => clearStackHover,
    "closeAllFloatsExcept": () => closeAllFloatsExcept,
    "closeCanvasContextMenu": () => closeCanvasContextMenu,
    "closeCanvasStackDialog": () => closeCanvasStackDialog,
    "closeCanvasZoomMenu": () => closeCanvasZoomMenu,
    "closeImportPickBox": () => closeImportPickBox,
    "closeQuickMenus": () => closeQuickMenus,
    "closeSettingsBox": () => closeSettingsBox,
    "closeStickerNoteEditor": () => closeStickerNoteEditor,
    "colsControl": () => colsControl,
    "colsValueEl": () => colsValueEl,
    "commitCanvasRailState": () => commitCanvasRailState,
    "conflictCancel": () => conflictCancel,
    "conflictIncomingTitle": () => conflictIncomingTitle,
    "conflictIncomingUrl": () => conflictIncomingUrl,
    "conflictKeepBoth": () => conflictKeepBoth,
    "conflictMatchList": () => conflictMatchList,
    "conflictModal": () => conflictModal,
    "conflictReplace": () => conflictReplace,
    "copySavedLink": () => copySavedLink,
    "countEl": () => countEl,
    "countStoredOnlyUrls": () => countStoredOnlyUrls,
    "createCanvasStackFromSelection": () => createCanvasStackFromSelection,
    "dedupeApplyBtn": () => dedupeApplyBtn,
    "dedupeBox": () => dedupeBox,
    "dedupeCloseX": () => dedupeCloseX,
    "dedupeClustersEl": () => dedupeClustersEl,
    "dedupeDrag": () => dedupeDrag,
    "dedupeRescanBtn": () => dedupeRescanBtn,
    "dedupeStatus": () => dedupeStatus,
    "DEFAULT_AUTO_BACKUP": () => DEFAULT_AUTO_BACKUP,
    "DEFAULT_CANVAS_VIEWPORT": () => DEFAULT_CANVAS_VIEWPORT,
    "DEFAULT_SETTINGS": () => DEFAULT_SETTINGS,
    "deleteCanvasConnection": () => deleteCanvasConnection,
    "deleteGroupNote": () => deleteGroupNote,
    "deleteItem": () => deleteItem,
    "detachCardDragListeners": () => detachCardDragListeners,
    "diagLogStatus": () => diagLogStatus,
    "diagLogText": () => diagLogText,
    "disconnectCanvasMediaObserver": () => disconnectCanvasMediaObserver,
    "domainOf": () => domainOf,
    "DRAG_THRESHOLD": () => DRAG_THRESHOLD,
    "editBox": () => editBox,
    "editChips": () => editChips,
    "editHeading": () => editHeading,
    "editItemTitle": () => editItemTitle,
    "editNote": () => editNote,
    "editSub": () => editSub,
    "editTagDraft": () => editTagDraft,
    "ensureCanvasStore": () => ensureCanvasStore,
    "escapeAttr": () => escapeAttr,
    "escapeHtml": () => escapeHtml,
    "exportLiteBackup": () => exportLiteBackup,
    "fetchMediaUrl": () => fetchMediaUrl,
    "findStackTargetAt": () => findStackTargetAt,
    "finishCanvasSearchPointer": () => finishCanvasSearchPointer,
    "flipCards": () => flipCards,
    "floatBackdrop": () => floatBackdrop,
    "flushCanvasPointerFrame": () => flushCanvasPointerFrame,
    "formatLogEntry": () => formatLogEntry,
    "formatNoteBytes": () => formatNoteBytes,
    "formatNoteMediaError": () => formatNoteMediaError,
    "formatSavedAt": () => formatSavedAt,
    "getCanvasSearchContext": () => getCanvasSearchContext,
    "getCanvasVisibleTabs": () => getCanvasVisibleTabs,
    "getGroupSearchMatch": () => getGroupSearchMatch,
    "getVisibleTabs": () => getVisibleTabs,
    "gridEl": () => gridEl,
    "gridNodeElements": () => gridNodeElements,
    "gridNodeRenderKey": () => gridNodeRenderKey,
    "GROUP_COLORS": () => GROUP_COLORS,
    "groupCoverHtml": () => groupCoverHtml,
    "handleCanvasContextMenuAction": () => handleCanvasContextMenuAction,
    "handleCardSelectClick": () => handleCardSelectClick,
    "helpBox": () => helpBox,
    "helpBtn": () => helpBtn,
    "iconSvg": () => iconSvg,
    "importPickBox": () => importPickBox,
    "importPickCount": () => importPickCount,
    "importPickHintEl": () => importPickHintEl,
    "importPickList": () => importPickList,
    "importPickStatus": () => importPickStatus,
    "importPreviewBody": () => importPreviewBody,
    "importPreviewOverlay": () => importPreviewOverlay,
    "importPreviewTitle": () => importPreviewTitle,
    "importPreviewUrl": () => importPreviewUrl,
    "initDedupeUi": () => initDedupeUi,
    "initQuickCaptureUi": () => initQuickCaptureUi,
    "isCanvasContextMenuOpen": () => isCanvasContextMenuOpen,
    "isCanvasSearchPreviewActive": () => isCanvasSearchPreviewActive,
    "isMultiSelectModifier": () => isMultiSelectModifier,
    "isStoredOnlyUrl": () => isStoredOnlyUrl,
    "isTypingTarget": () => isTypingTarget,
    "itemTitle": () => itemTitle,
    "lbBack": () => lbBack,
    "lbCounter": () => lbCounter,
    "lbGroupMosaic": () => lbGroupMosaic,
    "lbImage": () => lbImage,
    "lbManageMembers": () => lbManageMembers,
    "lbNext": () => lbNext,
    "lbPrev": () => lbPrev,
    "lbRestore": () => lbRestore,
    "lbSnapHint": () => lbSnapHint,
    "lbTitle": () => lbTitle,
    "lbUrl": () => lbUrl,
    "lightbox": () => lightbox,
    "linkTextForItem": () => linkTextForItem,
    "loadList": () => loadList,
    "loadSettings": () => loadSettings,
    "loadStatusEl": () => loadStatusEl,
    "manualAddPanel": () => manualAddPanel,
    "manualAddTopBtn": () => manualAddTopBtn,
    "markTagSuggestIndexDirty": () => markTagSuggestIndexDirty,
    "Media": () => Media,
    "mediaKeyForItem": () => mediaKeyForItem,
    "mediaKeyForMember": () => mediaKeyForMember,
    "membersBox": () => membersBox,
    "membersList": () => membersList,
    "membersTitle": () => membersTitle,
    "moreToolsBtn": () => moreToolsBtn,
    "moreToolsMenu": () => moreToolsMenu,
    "normalizeAutoBackup": () => normalizeAutoBackup,
    "normalizeCanvasCurveOffset": () => normalizeCanvasCurveOffset,
    "normalizeCanvasLayoutLocal": () => normalizeCanvasLayoutLocal,
    "normalizeCanvasRailSettings": () => normalizeCanvasRailSettings,
    "normalizeCanvasRailWidth": () => normalizeCanvasRailWidth,
    "normalizeNoteProjection": () => normalizeNoteProjection,
    "normalizeParkedList": () => normalizeParkedList,
    "normalizeSortBy": () => normalizeSortBy,
    "NoteMedia": () => NoteMedia,
    "observeStickerAttachment": () => observeStickerAttachment,
    "observeThumb": () => observeThumb,
    "openCanvasContextMenu": () => openCanvasContextMenu,
    "openCanvasGroupLightbox": () => openCanvasGroupLightbox,
    "openCanvasStackDialog": () => openCanvasStackDialog,
    "openConflictModal": () => openConflictModal,
    "openDedupeBtn": () => openDedupeBtn,
    "openEditBox": () => openEditBox,
    "openLightbox": () => openLightbox,
    "openManualAddPanel": () => openManualAddPanel,
    "openMembersBox": () => openMembersBox,
    "openPreSaveModal": () => openPreSaveModal,
    "openStickerNoteEditor": () => openStickerNoteEditor,
    "openWithSearchFocusEl": () => openWithSearchFocusEl,
    "PARENT_ORIGIN": () => PARENT_ORIGIN,
    "pinnedOnlyBtn": () => pinnedOnlyBtn,
    "placeFloatBox": () => placeFloatBox,
    "placeMembersBoxCentered": () => placeMembersBoxCentered,
    "placeStickerNoteAt": () => placeStickerNoteAt,
    "postToParent": () => postToParent,
    "preSaveCancel": () => preSaveCancel,
    "preSaveChips": () => preSaveChips,
    "preSaveConfirm": () => preSaveConfirm,
    "preSaveError": () => preSaveError,
    "preSaveModal": () => preSaveModal,
    "preSaveNote": () => preSaveNote,
    "preSaveTagDraft": () => preSaveTagDraft,
    "preSaveTitle": () => preSaveTitle,
    "preSaveUrl": () => preSaveUrl,
    "pruneAttachmentUrlCache": () => pruneAttachmentUrlCache,
    "queueCardPointerMove": () => queueCardPointerMove,
    "quickAddBtn": () => quickAddBtn,
    "quickAddGroupMenu": () => quickAddGroupMenu,
    "quickAddMenu": () => quickAddMenu,
    "quickAddMenuBtn": () => quickAddMenuBtn,
    "quickAddTabMenu": () => quickAddTabMenu,
    "quickAddUrlMenu": () => quickAddUrlMenu,
    "refreshCanvasMediaQuality": () => refreshCanvasMediaQuality,
    "refreshCanvasSearchPreview": () => refreshCanvasSearchPreview,
    "refreshDiagLogPanel": () => refreshDiagLogPanel,
    "refreshTagManager": () => refreshTagManager,
    "removeGridNode": () => removeGridNode,
    "renderCanvas": () => renderCanvas,
    "renderCanvasConnections": () => renderCanvasConnections,
    "renderCanvasMinimap": () => renderCanvasMinimap,
    "renderCanvasStackIndex": () => renderCanvasStackIndex,
    "renderGrid": () => renderGrid,
    "resetCanvasNotePlacement": () => resetCanvasNotePlacement,
    "resetCanvasView": () => resetCanvasView,
    "restoreItem": () => restoreItem,
    "restoreMember": () => restoreMember,
    "runCanvasNodeAction": () => runCanvasNodeAction,
    "runLocalAutoBackup": () => runLocalAutoBackup,
    "saveSettings": () => saveSettings,
    "scheduleCanvasMediaQualityRefresh": () => scheduleCanvasMediaQualityRefresh,
    "scheduleInitialCanvasCenter": () => scheduleInitialCanvasCenter,
    "SEARCH_HIT_LIMIT": () => SEARCH_HIT_LIMIT,
    "searchEl": () => searchEl,
    "SearchQuery": () => SearchQuery,
    "selectModeBtn": () => selectModeBtn,
    "sendMessage": () => sendMessage,
    "setCanvasActiveTool": () => setCanvasActiveTool,
    "setCanvasIndexFilter": () => setCanvasIndexFilter,
    "setCanvasSelection": () => setCanvasSelection,
    "setCanvasZoom": () => setCanvasZoom,
    "setClusterKeepMode": () => setClusterKeepMode,
    "setSearchQueryFromInput": () => setSearchQueryFromInput,
    "setSelectMode": () => setSelectMode,
    "SETTINGS_KEY": () => SETTINGS_KEY,
    "settingsBox": () => settingsBox,
    "settingsBtn": () => settingsBtn,
    "settingsCardCols": () => settingsCardCols,
    "settingsColsValue": () => settingsColsValue,
    "settingsDoneBtn": () => settingsDoneBtn,
    "settingsEl": () => settingsEl,
    "settingsNav": () => settingsNav,
    "settingsPreSaveEdit": () => settingsPreSaveEdit,
    "settingsSaveStatus": () => settingsSaveStatus,
    "showCopyToast": () => showCopyToast,
    "snapCache": () => snapCache,
    "snapCanvasPosition": () => snapCanvasPosition,
    "snapshotCardRects": () => snapshotCardRects,
    "sortByEl": () => sortByEl,
    "STACK_DWELL_MS": () => STACK_DWELL_MS,
    "stickerNoteAttachments": () => stickerNoteAttachments,
    "stickerNoteBox": () => stickerNoteBox,
    "stickerNoteChips": () => stickerNoteChips,
    "stickerNoteDrop": () => stickerNoteDrop,
    "stickerNoteMarkdown": () => stickerNoteMarkdown,
    "stickerNoteMediaStatus": () => stickerNoteMediaStatus,
    "stickerNotePreview": () => stickerNotePreview,
    "stickerNoteSave": () => stickerNoteSave,
    "stickerNoteTagDraft": () => stickerNoteTagDraft,
    "stickerNoteTitle": () => stickerNoteTitle,
    "suppressCanvasNodeClick": () => suppressCanvasNodeClick,
    "syncAutoBackupUi": () => syncAutoBackupUi,
    "syncCanvasOrganizeUi": () => syncCanvasOrganizeUi,
    "syncFloatBackdrop": () => syncFloatBackdrop,
    "syncQuickCaptureAvailability": () => syncQuickCaptureAvailability,
    "syncSearchRegexUi": () => syncSearchRegexUi,
    "syncSearchScopeUi": () => syncSearchScopeUi,
    "syncSettingsUi": () => syncSettingsUi,
    "t": () => t,
    "tagAddInput": () => tagAddInput,
    "tagManageList": () => tagManageList,
    "tagsBox": () => tagsBox,
    "tagsBtn": () => tagsBtn,
    "tagSearch": () => tagSearch,
    "themeBtn": () => themeBtn,
    "toggleCanvasZoomMenu": () => toggleCanvasZoomMenu,
    "toggleHeaderPopover": () => toggleHeaderPopover,
    "togglePinned": () => togglePinned,
    "toggleSelect": () => toggleSelect,
    "UI_LOG_MAX": () => UI_LOG_MAX,
    "uiLog": () => uiLog,
    "uiLogBuffer": () => uiLogBuffer,
    "updateBatchBar": () => updateBatchBar,
    "updateCanvasNodePositions": () => updateCanvasNodePositions,
    "updateCanvasNodeSelection": () => updateCanvasNodeSelection,
    "updateCanvasTransform": () => updateCanvasTransform,
    "updateGridSelectionUi": () => updateGridSelectionUi,
    "updateSavedBadge": () => updateSavedBadge,
    "versionBadge": () => versionBadge,
    "viewModeBtn": () => viewModeBtn,
    "viewModeCanvasIcon": () => viewModeCanvasIcon,
    "viewModeLabel": () => viewModeLabel,
    "viewModeListIcon": () => viewModeListIcon,
    "withUiActionLock": () => withUiActionLock,
  };
  const rw = {
    "allTabs": { get: () => allTabs, set: (v) => { allTabs = v; } },
    "autoBackupLocalRunning": { get: () => autoBackupLocalRunning, set: (v) => { autoBackupLocalRunning = v; } },
    "canvasActiveTool": { get: () => canvasActiveTool, set: (v) => { canvasActiveTool = v; } },
    "canvasConnectionDragState": { get: () => canvasConnectionDragState, set: (v) => { canvasConnectionDragState = v; } },
    "canvasConnectionSourceId": { get: () => canvasConnectionSourceId, set: (v) => { canvasConnectionSourceId = v; } },
    "canvasContextMenuState": { get: () => canvasContextMenuState, set: (v) => { canvasContextMenuState = v; } },
    "canvasGeometryObserver": { get: () => canvasGeometryObserver, set: (v) => { canvasGeometryObserver = v; } },
    "canvasIndexFilter": { get: () => canvasIndexFilter, set: (v) => { canvasIndexFilter = v; } },
    "canvasInitialCenterRaf": { get: () => canvasInitialCenterRaf, set: (v) => { canvasInitialCenterRaf = v; } },
    "canvasInteractionGeneration": { get: () => canvasInteractionGeneration, set: (v) => { canvasInteractionGeneration = v; } },
    "canvasLastMiddleClickAt": { get: () => canvasLastMiddleClickAt, set: (v) => { canvasLastMiddleClickAt = v; } },
    "canvasLastPointerEvent": { get: () => canvasLastPointerEvent, set: (v) => { canvasLastPointerEvent = v; } },
    "canvasLayout": { get: () => canvasLayout, set: (v) => { canvasLayout = v; } },
    "canvasLoadGeneration": { get: () => canvasLoadGeneration, set: (v) => { canvasLoadGeneration = v; } },
    "canvasMiddleClickTimer": { get: () => canvasMiddleClickTimer, set: (v) => { canvasMiddleClickTimer = v; } },
    "canvasMinimapDragState": { get: () => canvasMinimapDragState, set: (v) => { canvasMinimapDragState = v; } },
    "canvasMinimapProjection": { get: () => canvasMinimapProjection, set: (v) => { canvasMinimapProjection = v; } },
    "canvasNeedsInitialCenter": { get: () => canvasNeedsInitialCenter, set: (v) => { canvasNeedsInitialCenter = v; } },
    "canvasNotePlacementArmed": { get: () => canvasNotePlacementArmed, set: (v) => { canvasNotePlacementArmed = v; } },
    "canvasPointerRaf": { get: () => canvasPointerRaf, set: (v) => { canvasPointerRaf = v; } },
    "canvasPointerState": { get: () => canvasPointerState, set: (v) => { canvasPointerState = v; } },
    "canvasQueuedPointerEvent": { get: () => canvasQueuedPointerEvent, set: (v) => { canvasQueuedPointerEvent = v; } },
    "canvasRailResizeFrame": { get: () => canvasRailResizeFrame, set: (v) => { canvasRailResizeFrame = v; } },
    "canvasRailResizeState": { get: () => canvasRailResizeState, set: (v) => { canvasRailResizeState = v; } },
    "canvasSearchPreview": { get: () => canvasSearchPreview, set: (v) => { canvasSearchPreview = v; } },
    "canvasSessionFallback": { get: () => canvasSessionFallback, set: (v) => { canvasSessionFallback = v; } },
    "canvasSnapToGrid": { get: () => canvasSnapToGrid, set: (v) => { canvasSnapToGrid = v; } },
    "canvasSpacePressed": { get: () => canvasSpacePressed, set: (v) => { canvasSpacePressed = v; } },
    "canvasStore": { get: () => canvasStore, set: (v) => { canvasStore = v; } },
    "canvasZoomWheelFrame": { get: () => canvasZoomWheelFrame, set: (v) => { canvasZoomWheelFrame = v; } },
    "canvasZoomWheelState": { get: () => canvasZoomWheelState, set: (v) => { canvasZoomWheelState = v; } },
    "cardPointerRaf": { get: () => cardPointerRaf, set: (v) => { cardPointerRaf = v; } },
    "cardQueuedPointerEvent": { get: () => cardQueuedPointerEvent, set: (v) => { cardQueuedPointerEvent = v; } },
    "copyToastTimer": { get: () => copyToastTimer, set: (v) => { copyToastTimer = v; } },
    "dedupeState": { get: () => dedupeState, set: (v) => { dedupeState = v; } },
    "dragState": { get: () => dragState, set: (v) => { dragState = v; } },
    "editContext": { get: () => editContext, set: (v) => { editContext = v; } },
    "editingId": { get: () => editingId, set: (v) => { editingId = v; } },
    "editTagList": { get: () => editTagList, set: (v) => { editTagList = v; } },
    "expandedId": { get: () => expandedId, set: (v) => { expandedId = v; } },
    "expandedMeta": { get: () => expandedMeta, set: (v) => { expandedMeta = v; } },
    "gridNodeIsList": { get: () => gridNodeIsList, set: (v) => { gridNodeIsList = v; } },
    "lastAnchorId": { get: () => lastAnchorId, set: (v) => { lastAnchorId = v; } },
    "lightboxNav": { get: () => lightboxNav, set: (v) => { lightboxNav = v; } },
    "loadListTimer": { get: () => loadListTimer, set: (v) => { loadListTimer = v; } },
    "membersGroupId": { get: () => membersGroupId, set: (v) => { membersGroupId = v; } },
    "pendingImportPick": { get: () => pendingImportPick, set: (v) => { pendingImportPick = v; } },
    "pinnedOnly": { get: () => pinnedOnly, set: (v) => { pinnedOnly = v; } },
    "preSaveContext": { get: () => preSaveContext, set: (v) => { preSaveContext = v; } },
    "preSaveTagList": { get: () => preSaveTagList, set: (v) => { preSaveTagList = v; } },
    "query": { get: () => query, set: (v) => { query = v; } },
    "searchScope": { get: () => searchScope, set: (v) => { searchScope = v; } },
    "selectedCanvasConnectionId": { get: () => selectedCanvasConnectionId, set: (v) => { selectedCanvasConnectionId = v; } },
    "selectedIds": { get: () => selectedIds, set: (v) => { selectedIds = v; } },
    "selectMode": { get: () => selectMode, set: (v) => { selectMode = v; } },
    "settings": { get: () => settings, set: (v) => { settings = v; } },
    "settingsSection": { get: () => settingsSection, set: (v) => { settingsSection = v; } },
    "stickerNoteContext": { get: () => stickerNoteContext, set: (v) => { stickerNoteContext = v; } },
    "stickerNoteDraftAttachments": { get: () => stickerNoteDraftAttachments, set: (v) => { stickerNoteDraftAttachments = v; } },
    "stickerNoteMediaBusy": { get: () => stickerNoteMediaBusy, set: (v) => { stickerNoteMediaBusy = v; } },
    "stickerNoteTagList": { get: () => stickerNoteTagList, set: (v) => { stickerNoteTagList = v; } },
    "stickerNoteUsageRequest": { get: () => stickerNoteUsageRequest, set: (v) => { stickerNoteUsageRequest = v; } },
    "suppressSettingsOnChanged": { get: () => suppressSettingsOnChanged, set: (v) => { suppressSettingsOnChanged = v; } },
    "suppressSettingsTimer": { get: () => suppressSettingsTimer, set: (v) => { suppressSettingsTimer = v; } },
    "tagFilter": { get: () => tagFilter, set: (v) => { tagFilter = v; } },
    "tagStats": { get: () => tagStats, set: (v) => { tagStats = v; } },
  };
  for (const [name, get] of Object.entries(ro)) {
    Object.defineProperty(env, name, { enumerable: true, configurable: true, get });
  }
  for (const [name, acc] of Object.entries(rw)) {
    Object.defineProperty(env, name, { enumerable: true, configurable: true, get: acc.get, set: acc.set });
  }
  SettingsUi.bind(env);
  ImportExport.bind(env);
  StickerUi.bind(env);
  CanvasIx.bind(env);
  CanvasChrome.bind(env);
  ListUi.bind(env);
  WorkspaceUi.bind(env);
  AppHelpers.bind(env);
}
bindPanelModules();

// Search match/compile lives in parkSearchQuery.js (bind getters to page state).
SearchQuery.bind({
  getSearchScope: () => searchScope,
  getSearchRegex: () => Boolean(settings.searchRegex),
  getQuery: () => query,
});
// Search UI (tag suggest / input / regex) lives in parkSearchUi.js.
SearchUi.bind({
  getSearchEl: () => searchEl,
  getSearchRegexBtn: () => searchRegexBtn,
  getSearchWrap: () => searchWrap,
  getSearchScopeChip: () => searchScopeChip,
  getSearchTagSuggest: () => searchTagSuggest,
  getQuery: () => query,
  setQuery: (q) => {
    query = q;
  },
  getSearchScope: () => searchScope,
  setSearchScope: (s) => {
    searchScope = s;
  },
  getSearchRegex: () => Boolean(settings.searchRegex),
  getAllTabs: () => allTabs,
  t: (key, vars) => t(key, vars),
  itemTagNames: (item) => SearchQuery.itemTagNames(item),
  isTagExpressionMode: () => SearchQuery.isTagExpressionMode(),
  compileSearchQuery: (raw) => SearchQuery.compileSearchQuery(raw),
  resetCompiledSearch: () => SearchQuery.resetCompiledSearch(),
  renderGrid: () => renderGrid(),
  saveSettings: (partial) => saveSettings(partial),
});
SearchUi.init();
function syncSearchRegexUi() {
  return SearchUi.syncSearchRegexUi();
}
function syncSearchScopeUi() {
  return SearchUi.syncSearchScopeUi();
}
function setSearchQueryFromInput(opts) {
  return SearchUi.setSearchQueryFromInput(opts);
}
function isSearchInCustomMode() {
  return SearchUi.isSearchInCustomMode();
}
async function resetSearchModesToDefault() {
  return SearchUi.resetSearchModesToDefault();
}
function markTagSuggestIndexDirty() {
  SearchUi.markTagSuggestIndexDirty();
}
const domainOf = SearchQuery.domainOf;
const parseRegexInput = SearchQuery.parseRegexInput;
const compileSearchQuery = SearchQuery.compileSearchQuery;
const isTagExpressionMode = SearchQuery.isTagExpressionMode;
const parseTagQuery = SearchQuery.parseTagQuery;
const compileTagQuery = SearchQuery.compileTagQuery;
const tagsMatchQuery = SearchQuery.tagsMatchQuery;
const itemTagNames = SearchQuery.itemTagNames;
const memberTagNames = SearchQuery.memberTagNames;
const groupMetaTagNames = SearchQuery.groupMetaTagNames;
const matchesPlainQuery = SearchQuery.matchesPlainQuery;
const textMatchesQuery = SearchQuery.textMatchesQuery;
const itemHaystack = SearchQuery.itemHaystack;
const memberHaystack = SearchQuery.memberHaystack;
const groupMetaHaystack = SearchQuery.groupMetaHaystack;
const getMatchingMembers = SearchQuery.getMatchingMembers;
const groupMetaMatches = SearchQuery.groupMetaMatches;
const getGroupSearchMatch = SearchQuery.getGroupSearchMatch;
const matchesQuery = SearchQuery.matchesQuery;

/** @type {string|null} */
let expandedId = null;
/** @type {{ type?: 'member' | 'group', groupId?: string } | null} */
let expandedMeta = null;
/** @type {{ list: any[], index: number } | null} */
let lightboxNav = null;
/** @type {string|null} */
let editingId = null;
let stickerNoteContext = null;
let stickerNoteTagList = [];
let stickerNoteDraftAttachments = [];
let stickerNoteMediaBusy = false;
let stickerNoteUsageRequest = 0;
let canvasNotePlacementArmed = false;
/** @type {{ mode: 'blank' | 'node', itemId: string, worldPoint: { x: number, y: number } | null }} */
let canvasContextMenuState = { mode: 'blank', itemId: '', worldPoint: null };
/** @type {{ type: 'item' | 'member' | 'batch', groupId?: string, memberId?: string, ids?: string[] } | null} */
let editContext = null;
/** @type {string|null} */
let membersGroupId = null;
/** @type {string[]} */
let editTagList = [];
/** @type {string[]} */
let preSaveTagList = [];
/** @type {object|null} */
let preSaveContext = null;
/** @type {Array<{ name: string, count: number }>} */
let tagStats = [];
let tagFilter = '';
let pinnedOnly = false;
let canvasIndexFilter = 'all';
/** @type {{ key: string, revision: number, positions: Record<string, any>, mode: 'grid'|'align' } | null} */
let canvasSearchPreview = null;
let settingsSection = 'general';
let selectMode = false;
/** @type {Set<string>} */
let selectedIds = new Set();
/** @type {string|null} */
let lastAnchorId = null;
let copyToastTimer = null;

function canvasStoreSnapshot(...args) { return AppHelpers.canvasStoreSnapshot(...args); }

function activeCanvasSelection() {
  return canvasStoreSnapshot().selectedIds;
}

function clearAllSelections() {
  ensureCanvasStore()?.setSelection([]);
  selectedIds.clear();
}

function updateCanvasSyncStatus(...args) { return AppHelpers.updateCanvasSyncStatus(...args); }

function handleCanvasStoreChange(...args) { return AppHelpers.handleCanvasStoreChange(...args); }

function ensureCanvasStore(...args) { return AppHelpers.ensureCanvasStore(...args); }

ensureCanvasStore();

/** @type {null | object} */
let dragState = null;

// Grid/list view incremental render state — mirrors canvasNodeElements'
// reuse-by-render-key pattern so a single-field edit only patches the one
// changed card instead of tearing down the whole visible list.
const gridNodeElements = new Map(); // id -> DOM node (card or row)
let gridNodeIsList = null; // last render's list/grid mode; a change forces a full rebuild
let cardPointerRaf = 0;
let cardQueuedPointerEvent = null;

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
    return;
  }
  if (event.data?.type === 'TABWALL_PRESAVE_EDIT' && event.data.preSave) {
    openPreSaveModal(event.data.preSave);
    return;
  }
  if (event.data?.type === 'TABWALL_PRESAVE_RESULT') {
    if (preSaveConfirm) preSaveConfirm.disabled = false;
    if (preSaveCancel) preSaveCancel.disabled = false;
    if (preSaveError) preSaveError.textContent = t('presaveFailed');
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
  applyFxLevel(settings.fxLevel);
  if (typeof applyCanvasRailUi === 'function') applyCanvasRailUi();
  syncQuickCaptureAvailability();
  syncPinnedFilterUi();
  if (selectModeBtn) {
    selectModeBtn.textContent = selectMode ? t('selectModeOn') : t('selectMode');
  }
  updateSavedBadge();
  if (typeof updateBatchBar === 'function') updateBatchBar();
  if (typeof refreshChromeCommandLabels === 'function') refreshChromeCommandLabels();
  if (typeof syncSearchRegexUi === 'function') syncSearchRegexUi();
  if (typeof renderAutoSaveMetadataRules === 'function') renderAutoSaveMetadataRules();
}

async function closeStandaloneTab(...args) { return await AppHelpers.closeStandaloneTab(...args); }

function requestHostClose(...args) { return AppHelpers.requestHostClose(...args); }

function sendMessage(...args) { return AppHelpers.sendMessage(...args); }

function quickCaptureErrorText(...args) { return WorkspaceUi.quickCaptureErrorText(...args); }

async function handleQuickCaptureResult(...args) { return await WorkspaceUi.handleQuickCaptureResult(...args); }

function setHeaderPopoverState(button, panel, open) {
  if (!button || !panel) return;
  panel.hidden = !open;
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  button.classList.toggle('active', open);
}

function closeHeaderPopovers({ restoreFocus = false } = {}) {
  setHeaderPopoverState(canvasOrganizeBtn, canvasOrganizePanel, false);
  setHeaderPopoverState(manualAddTopBtn, manualAddPanel, false);
  if (restoreFocus) {
    if (canvasOrganizeBtn?.dataset.focusRestore === 'true') canvasOrganizeBtn.focus({ preventScroll: true });
    if (manualAddTopBtn?.dataset.focusRestore === 'true') manualAddTopBtn.focus({ preventScroll: true });
  }
  if (canvasOrganizeBtn) delete canvasOrganizeBtn.dataset.focusRestore;
  if (manualAddTopBtn) delete manualAddTopBtn.dataset.focusRestore;
}

function closeQuickMenus() {
  if (quickAddMenu) quickAddMenu.hidden = true;
  if (quickAddMenuBtn) quickAddMenuBtn.setAttribute('aria-expanded', 'false');
  if (moreToolsMenu) moreToolsMenu.hidden = true;
  if (moreToolsBtn) moreToolsBtn.setAttribute('aria-expanded', 'false');
  closeHeaderPopovers();
}

function openCanvasOrganizePanel() {
  if (!canvasOrganizePanel || !canvasOrganizeBtn || settings.viewMode !== 'canvas' || canvasSessionFallback) return;
  closeAllFloatsExcept('header');
  closeQuickMenus();
  setHeaderPopoverState(canvasOrganizeBtn, canvasOrganizePanel, true);
}

function openManualAddPanel() {
  if (!manualAddPanel || !manualAddTopBtn) return;
  closeAllFloatsExcept('header');
  closeQuickMenus();
  setHeaderPopoverState(manualAddTopBtn, manualAddPanel, true);
  setTimeout(() => manualAddText?.focus(), 0);
}

function toggleHeaderPopover(button, panel, open) {
  if (!panel || panel.hidden === !open) return;
  if (open) {
    if (button === canvasOrganizeBtn) openCanvasOrganizePanel();
    else if (button === manualAddTopBtn) openManualAddPanel();
    return;
  }
  if (button) button.dataset.focusRestore = 'true';
  closeHeaderPopovers({ restoreFocus: true });
}

function syncCanvasOrganizeUi(mode = settings.viewMode) {
  const visible = mode === 'canvas' && !canvasSessionFallback;
  if (canvasOrganizeWrap) canvasOrganizeWrap.hidden = !visible;
  if (!visible) setHeaderPopoverState(canvasOrganizeBtn, canvasOrganizePanel, false);
}

function syncQuickCaptureAvailability(...args) { return AppHelpers.syncQuickCaptureAvailability(...args); }

async function requestQuickCapture(...args) { return await WorkspaceUi.requestQuickCapture(...args); }

function initQuickCaptureUi(...args) { return WorkspaceUi.initQuickCaptureUi(...args); }

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

function normalizeSortBy(value) {
  return value === 'domain' || value === 'group-first' ? value : 'newest';
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function normalizeCanvasRailWidth(value) {
  return clampInt(value, CANVAS_RAIL_MIN_WIDTH, CANVAS_RAIL_MAX_WIDTH, CANVAS_RAIL_DEFAULT_WIDTH);
}

function normalizeCanvasRailSettings(target) {
  if (!target || typeof target !== 'object') return target;
  target.canvasRailWidth = normalizeCanvasRailWidth(target.canvasRailWidth);
  target.canvasRailCollapsed = target.canvasRailCollapsed === true;
  return target;
}

function newAutoSaveMetadataRuleId(...args) { return SettingsUi.newAutoSaveMetadataRuleId(...args); }

function normalizeAutoSaveMetadataTags(...args) { return SettingsUi.normalizeAutoSaveMetadataTags(...args); }

function normalizeAutoSaveMetadataCondition(...args) { return SettingsUi.normalizeAutoSaveMetadataCondition(...args); }

function normalizeAutoSaveMetadataRule(...args) { return SettingsUi.normalizeAutoSaveMetadataRule(...args); }

function normalizeAutoSaveMetadata(...args) { return SettingsUi.normalizeAutoSaveMetadata(...args); }

function newAutoSaveMetadataRule(...args) { return SettingsUi.newAutoSaveMetadataRule(...args); }

function sanitizeSubfolder(...args) { return SettingsUi.sanitizeSubfolder(...args); }

function normalizeIntervalUnit(...args) { return SettingsUi.normalizeIntervalUnit(...args); }

function intervalValueBounds(...args) { return SettingsUi.intervalValueBounds(...args); }

function normalizeAutoBackup(...args) { return SettingsUi.normalizeAutoBackup(...args); }

function autoBackupIntervalMinutes(...args) { return SettingsUi.autoBackupIntervalMinutes(...args); }

function syncIntervalInputBounds(...args) { return SettingsUi.syncIntervalInputBounds(...args); }

async function loadSettings(...args) { return await SettingsUi.loadSettings(...args); }

/** Skip our own storage writes in onChanged (avoids full UI rebuild echo). */
let suppressSettingsOnChanged = false;
let suppressSettingsTimer = null;

async function saveSettings(...args) { return await SettingsUi.saveSettings(...args); }

function applyTheme(...args) { return SettingsUi.applyTheme(...args); }

function applyFxLevel(...args) { return SettingsUi.applyFxLevel(...args); }

function applyCanvasRailUi(...args) { return SettingsUi.applyCanvasRailUi(...args); }

function syncViewModeButton(...args) { return SettingsUi.syncViewModeButton(...args); }

function applyViewMode(...args) { return SettingsUi.applyViewMode(...args); }

function applyCardCols(...args) { return SettingsUi.applyCardCols(...args); }

function updateSavedBadge(...args) { return SettingsUi.updateSavedBadge(...args); }

function syncPinnedFilterUi(...args) { return SettingsUi.syncPinnedFilterUi(...args); }

function syncSettingsUi(...args) { return SettingsUi.syncSettingsUi(...args); }

function autoBackupErrorText(...args) { return SettingsUi.autoBackupErrorText(...args); }

/** True if stored absolute path looks like it belongs to current subfolder. */
function folderPathMatchesSubfolder(...args) { return SettingsUi.folderPathMatchesSubfolder(...args); }

function syncAutoBackupUi(...args) { return SettingsUi.syncAutoBackupUi(...args); }

function autoSaveMetadataFieldOptions(...args) { return SettingsUi.autoSaveMetadataFieldOptions(...args); }

function autoSaveMetadataOperatorOptions(...args) { return SettingsUi.autoSaveMetadataOperatorOptions(...args); }

function renderAutoSaveMetadataRules(...args) { return SettingsUi.renderAutoSaveMetadataRules(...args); }

function syncAutoSaveMetadataUi(...args) { return SettingsUi.syncAutoSaveMetadataUi(...args); }

async function persistAutoSaveMetadata(...args) { return await SettingsUi.persistAutoSaveMetadata(...args); }

async function commitAutoSaveMetadataTag(...args) { return await SettingsUi.commitAutoSaveMetadataTag(...args); }

function initAutoSaveMetadataUi(...args) { return SettingsUi.initAutoSaveMetadataUi(...args); }

async function refreshChromeCommandLabels(...args) { return await SettingsUi.refreshChromeCommandLabels(...args); }

function refreshChromeCommandLabelsOnFocus(...args) { return SettingsUi.refreshChromeCommandLabelsOnFocus(...args); }

async function openChromeShortcutsForApply(...args) { return await SettingsUi.openChromeShortcutsForApply(...args); }

function initChromeShortcutsUi(...args) { return SettingsUi.initChromeShortcutsUi(...args); }

async function initSettingsUi(...args) { return await SettingsUi.initSettingsUi(...args); }

function formatSavedAt(...args) { return ListUi.formatSavedAt(...args); }

function appendDedupeThumb(...args) { return WorkspaceUi.appendDedupeThumb(...args); }

function appendDedupePreviewBtn(...args) { return WorkspaceUi.appendDedupePreviewBtn(...args); }

function openConflictModal(...args) { return WorkspaceUi.openConflictModal(...args); }

function closeConflictModal(...args) { return WorkspaceUi.closeConflictModal(...args); }

async function resolveConflict(...args) { return await WorkspaceUi.resolveConflict(...args); }

function initConflictUi(...args) { return WorkspaceUi.initConflictUi(...args); }

function renderPreSaveChips(...args) { return WorkspaceUi.renderPreSaveChips(...args); }

function commitPreSaveTagDraft(...args) { return WorkspaceUi.commitPreSaveTagDraft(...args); }

function openPreSaveModal(...args) { return WorkspaceUi.openPreSaveModal(...args); }

function closePreSaveModal(...args) { return WorkspaceUi.closePreSaveModal(...args); }

function cancelPreSave(...args) { return WorkspaceUi.cancelPreSave(...args); }

async function confirmPreSave(...args) { return await WorkspaceUi.confirmPreSave(...args); }

function initPreSaveUi(...args) { return WorkspaceUi.initPreSaveUi(...args); }

/** @type {Array<{url:string, items:object[], mode:string, keepIds:Set<string>}>} */
let dedupeState = [];

function closeDedupeBox(...args) { return WorkspaceUi.closeDedupeBox(...args); }

function centerDedupeBox() {
  // Dedupe is a right-side drawer in the redesigned wall; keep the legacy
  // call sites harmless without writing inline left/top coordinates.
}

async function openDedupeBox(...args) { return await WorkspaceUi.openDedupeBox(...args); }

function setClusterKeepMode(...args) { return AppHelpers.setClusterKeepMode(...args); }

function renderDedupeClusters(...args) { return WorkspaceUi.renderDedupeClusters(...args); }

async function runDedupeScan(...args) { return await WorkspaceUi.runDedupeScan(...args); }

async function applyDedupeChoices(...args) { return await WorkspaceUi.applyDedupeChoices(...args); }

function initDedupeUi(...args) { return WorkspaceUi.initDedupeUi(...args); }

function placeFloatBox(...args) { return WorkspaceUi.placeFloatBox(...args); }

function positionTagsBoxUnderButton(...args) { return WorkspaceUi.positionTagsBoxUnderButton(...args); }

function setupFloatDrag(...args) { return WorkspaceUi.setupFloatDrag(...args); }

function applySettingsSection(...args) { return SettingsUi.applySettingsSection(...args); }

function initSettingsSections(...args) { return SettingsUi.initSettingsSections(...args); }

function anyFloatOpen(...args) { return WorkspaceUi.anyFloatOpen(...args); }

function syncFloatBackdrop(...args) { return WorkspaceUi.syncFloatBackdrop(...args); }

function closeAllFloatsExcept(...args) { return WorkspaceUi.closeAllFloatsExcept(...args); }

function openSettingsBox(...args) { return SettingsUi.openSettingsBox(...args); }

function closeSettingsBox(...args) { return SettingsUi.closeSettingsBox(...args); }

async function openTagsBox(...args) { return await WorkspaceUi.openTagsBox(...args); }

function closeTagsBox(...args) { return WorkspaceUi.closeTagsBox(...args); }

function openHelpBox(...args) { return WorkspaceUi.openHelpBox(...args); }

function closeHelpBox(...args) { return WorkspaceUi.closeHelpBox(...args); }

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
  if (stickerNoteBox?.classList.contains('open')) {
    closeStickerNoteEditor();
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
    if (isCanvasContextMenuOpen()) {
      closeCanvasContextMenu();
      return;
    }
    if (canvasNotePlacementArmed) {
      resetCanvasNotePlacement();
      return;
    }
    if (canvasZoomMenu && !canvasZoomMenu.hidden) {
      closeCanvasZoomMenu();
      return;
    }
    if (canvasConnectionSourceId || selectedCanvasConnectionId) {
      clearCanvasConnectionSelection();
      return;
    }
    if (canvasStackDialog?.classList.contains('open')) {
      closeCanvasStackDialog();
      return;
    }
    if (preSaveModal?.classList.contains('open')) {
      cancelPreSave();
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
    if (stickerNoteBox?.classList.contains('open')) {
      closeStickerNoteEditor();
      return;
    }
    if (lightbox.classList.contains('open')) {
      handleLightboxEscape();
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
    if ((canvasOrganizePanel && !canvasOrganizePanel.hidden) || (manualAddPanel && !manualAddPanel.hidden)) {
      const focusTarget = canvasOrganizePanel && !canvasOrganizePanel.hidden
        ? canvasOrganizeBtn
        : manualAddTopBtn;
      closeHeaderPopovers();
      focusTarget?.focus({ preventScroll: true });
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
        SearchQuery.resetCompiledSearch();
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

function sortTabs(...args) { return AppHelpers.sortTabs(...args); }

function linkTextForItem(item) {
  if (item.kind === 'group') {
    return (item.tabs || [])
      .map((m) => m.url)
      .filter(Boolean)
      .join('\n');
  }
  if (item.kind === 'note') return '';
  return item.url || '';
}

function copyTextFallback(...args) { return AppHelpers.copyTextFallback(...args); }

async function copySavedLink(...args) { return await AppHelpers.copySavedLink(...args); }

function showCopyToast(...args) { return AppHelpers.showCopyToast(...args); }

function isMultiSelectModifier(e) {
  return Boolean(e && (e.metaKey || e.ctrlKey || e.shiftKey));
}

function handleCardSelectClick(...args) { return AppHelpers.handleCardSelectClick(...args); }

function getVisibleTabs() {
  return sortTabs(
    allTabs.filter((item) => (!pinnedOnly || item.pinned === true) && matchesQuery(item, query)),
    normalizeSortBy(settings.sortBy)
  );
}

function canvasItemPassesIndexFilter(item) {
  if (canvasIndexFilter === 'unsorted') return item.kind !== 'group';
  if (canvasIndexFilter === 'pinned') return item.pinned === true;
  if (canvasIndexFilter.startsWith('stack:')) return item.id === canvasIndexFilter.slice(6);
  return true;
}

function getCanvasSearchContext(...args) { return AppHelpers.getCanvasSearchContext(...args); }

function getCanvasVisibleTabs() {
  return getCanvasSearchContext().items;
}

function isCanvasSearchPreviewActive(searchContext = getCanvasSearchContext()) {
  return Boolean(
    settings.viewMode === 'canvas'
    && !canvasSessionFallback
    && searchContext?.queryActive
  );
}

function canvasSearchPreviewKey(searchContext) {
  return JSON.stringify({
    query,
    scope: searchScope,
    regex: Boolean(settings.searchRegex),
    pinnedOnly,
    canvasIndexFilter,
    ids: (searchContext?.items || []).map((item) => item.id),
  });
}

function canvasSearchLayoutFor(...args) { return AppHelpers.canvasSearchLayoutFor(...args); }

function syncCanvasIndexUi(...args) { return AppHelpers.syncCanvasIndexUi(...args); }

function renderCanvasStackIndex(...args) { return AppHelpers.renderCanvasStackIndex(...args); }

function focusCanvasItem(...args) { return AppHelpers.focusCanvasItem(...args); }

function setCanvasIndexFilter(filter, focusId = '') {
  canvasIndexFilter = String(filter || 'all');
  syncCanvasIndexUi();
  renderCanvas();
  if (focusId) focusCanvasItem(focusId);
}

function commitCanvasRailState(width, collapsed) {
  const next = {
    canvasRailWidth: normalizeCanvasRailWidth(width),
    canvasRailCollapsed: collapsed === true,
  };
  settings = { ...settings, ...next };
  applyCanvasRailUi(next);
  saveSettings(next).catch(() => {});
}

function canvasRailResizeDraft(...args) { return CanvasChrome.canvasRailResizeDraft(...args); }

function scheduleCanvasRailResizePreview(...args) { return CanvasChrome.scheduleCanvasRailResizePreview(...args); }

function flushCanvasRailResizePreview(...args) { return CanvasChrome.flushCanvasRailResizePreview(...args); }

function updateCanvasRailResize(...args) { return CanvasChrome.updateCanvasRailResize(...args); }

function endCanvasRailResize(...args) { return CanvasChrome.endCanvasRailResize(...args); }

function handleCanvasRailKeydown(...args) { return CanvasChrome.handleCanvasRailKeydown(...args); }

function cancelCanvasRailResize(...args) { return CanvasChrome.cancelCanvasRailResize(...args); }

function initCanvasRailResize(...args) { return CanvasChrome.initCanvasRailResize(...args); }

const SEARCH_HIT_LIMIT = 8;

/** Append matching member rows under a group card/row when searching. */
function appendGroupSearchHits(...args) { return ListUi.appendGroupSearchHits(...args); }

function itemTitle(...args) { return ListUi.itemTitle(...args); }

function buildLightboxNavList(...args) { return WorkspaceUi.buildLightboxNavList(...args); }

async function showLightboxEntry(...args) { return await WorkspaceUi.showLightboxEntry(...args); }

function openLightbox(...args) { return WorkspaceUi.openLightbox(...args); }

function openCanvasGroupLightbox(...args) { return WorkspaceUi.openCanvasGroupLightbox(...args); }

function navigateLightbox(...args) { return WorkspaceUi.navigateLightbox(...args); }

function closeLightbox(...args) { return WorkspaceUi.closeLightbox(...args); }

function backToGroupOverview(...args) { return WorkspaceUi.backToGroupOverview(...args); }

function handleLightboxEscape(...args) { return WorkspaceUi.handleLightboxEscape(...args); }

lbClose.addEventListener('click', closeLightbox);
if (lbPrev) lbPrev.addEventListener('click', () => navigateLightbox(-1));
if (lbNext) lbNext.addEventListener('click', () => navigateLightbox(1));
lbBack?.addEventListener('click', () => {
  backToGroupOverview();
});
lbManageMembers?.addEventListener('click', () => {
  if (expandedMeta?.type !== 'group' || !expandedId) return;
  const group = allTabs.find((x) => x.id === expandedId);
  closeLightbox();
  if (group) openMembersBox(group);
});

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

function renderEditChips(...args) { return WorkspaceUi.renderEditChips(...args); }

function commitTagDraft(...args) { return WorkspaceUi.commitTagDraft(...args); }

async function refreshTagManager(...args) { return await WorkspaceUi.refreshTagManager(...args); }

function renderTagManager(...args) { return WorkspaceUi.renderTagManager(...args); }

tagSearch.addEventListener('input', () => {
  tagFilter = tagSearch.value;
  renderTagManager();
});

async function addTagFromManager(...args) { return await WorkspaceUi.addTagFromManager(...args); }

tagAddBtn.addEventListener('click', () => addTagFromManager());
tagAddInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTagFromManager();
  }
});

function downloadBlob(...args) { return ImportExport.downloadBlob(...args); }

let autoBackupLocalRunning = false;

/** Immediate / catch-up auto backup via background downloads. */
async function runLocalAutoBackup(...args) { return await ImportExport.runLocalAutoBackup(...args); }

async function maybeCatchUpAutoBackup(...args) { return await ImportExport.maybeCatchUpAutoBackup(...args); }

/** Hydrate thumb/snap from local IDB for full ZIP (avoids huge SW messages). */
async function mapWithConcurrencyLocal(...args) { return await ImportExport.mapWithConcurrencyLocal(...args); }

async function hydrateItemMediaLocal(...args) { return await ImportExport.hydrateItemMediaLocal(...args); }

async function estimateFullBackupMediaBytes(...args) { return await ImportExport.estimateFullBackupMediaBytes(...args); }

async function exportLiteBackup(...args) { return await ImportExport.exportLiteBackup(...args); }

exportLiteBtn.addEventListener('click', () => {
  exportLiteBackup();
});

exportFullBtn.addEventListener('click', async () => {
  backupStatus.textContent = t('backupExporting');
  uiLog('info', 'export', 'full start');
  let hydrated = [];
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
    const estimatedMediaBytes = await estimateFullBackupMediaBytes(rawItems);
    if (estimatedMediaBytes > (Build.LIMITS?.MAX_ZIP_BYTES || 256 * 1024 * 1024)) {
      throw new Error('backup_too_large:full_zip');
    }
    let hydratedCount = 0;
    hydrated = await mapWithConcurrencyLocal(rawItems, 4, async (item) => {
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
    hydrated = [];
    res.backup.parkedItems = [];
    uiLog('info', 'export', 'full ok', `file=${filename} bytes=${blob.size}`);
    backupStatus.textContent = t('backupExported');
  } catch (err) {
    console.warn(err);
    uiLog('error', 'export', 'full exception', err?.message || err);
    backupStatus.textContent = `${t('backupError')}: ${formatBackupError(err?.message || err)}`;
  } finally {
    hydrated = [];
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

function closeImportPickBox(...args) { return ImportExport.closeImportPickBox(...args); }

function updateImportPickCount(...args) { return ImportExport.updateImportPickCount(...args); }

/** Prefer full snapshot, then thumbnail (data-URL only after ZIP rehydrate). */
function pickImportImageDataUrl(...args) { return ImportExport.pickImportImageDataUrl(...args); }

function newImportStageId(...args) { return ImportExport.newImportStageId(...args); }

/** Convert preview data URLs into shared IndexedDB blobs before messaging SW. */
async function stageImportMedia(...args) { return await ImportExport.stageImportMedia(...args); }

function closeImportPreview(...args) { return ImportExport.closeImportPreview(...args); }

function openImportTabPreview(...args) { return ImportExport.openImportTabPreview(...args); }

function openImportGroupPreview(...args) { return ImportExport.openImportGroupPreview(...args); }

function openImportPickBox(...args) { return ImportExport.openImportPickBox(...args); }

async function confirmImportPick(...args) { return await ImportExport.confirmImportPick(...args); }

async function confirmImportPickUnlocked(...args) { return await ImportExport.confirmImportPickUnlocked(...args); }

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

function updateBatchBar(...args) { return WorkspaceUi.updateBatchBar(...args); }

function setSelectMode(...args) { return WorkspaceUi.setSelectMode(...args); }

function toggleSelect(...args) { return WorkspaceUi.toggleSelect(...args); }

selectModeBtn.addEventListener('click', () => setSelectMode(!selectMode));

batchClear.addEventListener('click', () => setSelectMode(false));

async function buildPartialBackupPayload(...args) { return await ImportExport.buildPartialBackupPayload(...args); }

async function exportSelected(...args) { return await ImportExport.exportSelected(...args); }

batchExportLite?.addEventListener('click', () => {
  exportSelected('lite');
});
batchExportFull?.addEventListener('click', () => {
  exportSelected('full');
});

batchRestore.addEventListener('click', async () => {
  await withUiActionLock('batch-restore', async () => {
    const ids = [...selectedIds];
    for (const id of ids) {
      const item = allTabs.find((candidate) => candidate.id === id);
      if (item?.kind === 'tab' || (item?.kind === 'group' && (item.tabs || []).length)) await restoreItem(id);
    }
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

function placeEditBoxCentered(...args) { return WorkspaceUi.placeEditBoxCentered(...args); }

function openEditBox(...args) { return WorkspaceUi.openEditBox(...args); }

function openMemberEditBox(...args) { return WorkspaceUi.openMemberEditBox(...args); }

function closeEditBox(...args) { return WorkspaceUi.closeEditBox(...args); }

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

function stickerNoteUuid(...args) { return StickerUi.stickerNoteUuid(...args); }

function stickerNoteDraftMeta(...args) { return StickerUi.stickerNoteDraftMeta(...args); }

function stickerNoteDraftRecord(...args) { return StickerUi.stickerNoteDraftRecord(...args); }

function renderStickerNoteTags(...args) { return StickerUi.renderStickerNoteTags(...args); }

function setStickerNoteMediaStatus(...args) { return StickerUi.setStickerNoteMediaStatus(...args); }

function setStickerNoteMediaBusy(...args) { return StickerUi.setStickerNoteMediaBusy(...args); }

async function refreshStickerNoteUsage(...args) { return await StickerUi.refreshStickerNoteUsage(...args); }

function commitStickerNoteTagDraft(...args) { return StickerUi.commitStickerNoteTagDraft(...args); }

function renderStickerNotePreview(...args) { return StickerUi.renderStickerNotePreview(...args); }

function renderStickerNoteAttachments(...args) { return StickerUi.renderStickerNoteAttachments(...args); }

function refreshStickerNoteEditor(...args) { return StickerUi.refreshStickerNoteEditor(...args); }

function removeStickerNoteAttachment(...args) { return StickerUi.removeStickerNoteAttachment(...args); }

async function addStickerNoteFiles(...args) { return await StickerUi.addStickerNoteFiles(...args); }

function openStickerNoteEditor(...args) { return StickerUi.openStickerNoteEditor(...args); }

function closeStickerNoteEditor(...args) { return StickerUi.closeStickerNoteEditor(...args); }

async function saveStickerNote(...args) { return await StickerUi.saveStickerNote(...args); }

function deleteGroupNote(groupId, noteId) {
  return withUiActionLock(`delete-note:${groupId}:${noteId}`, async () => {
    const res = await sendMessage({ type: 'DELETE_NOTE', groupId, noteId });
    if (res?.ok) await loadList();
    return res;
  });
}

stickerNoteTitle?.addEventListener('input', renderStickerNotePreview);
stickerNoteMarkdown?.addEventListener('input', renderStickerNotePreview);
stickerNoteTagDraft?.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === 'Tab') && stickerNoteTagDraft.value.trim()) {
    event.preventDefault();
    commitStickerNoteTagDraft();
  }
  if (event.key === 'Backspace' && !stickerNoteTagDraft.value && stickerNoteTagList.length) {
    stickerNoteTagList.pop();
    renderStickerNoteTags();
  }
});
stickerNoteFile?.addEventListener('change', () => addStickerNoteFiles(stickerNoteFile.files));
stickerNoteDrop?.addEventListener('click', () => stickerNoteFile?.click());
stickerNoteDrop?.addEventListener('dragover', (event) => event.preventDefault());
stickerNoteDrop?.addEventListener('drop', (event) => {
  event.preventDefault();
  addStickerNoteFiles(event.dataTransfer?.files || []);
});
stickerNoteMarkdown?.addEventListener('paste', (event) => {
  const fromItems = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const files = [...(event.clipboardData?.files || []), ...fromItems]
    .filter((file, index, values) => String(file.type || '').startsWith('image/') && values.indexOf(file) === index);
  if (!files.length) return;
  event.preventDefault();
  addStickerNoteFiles(files);
});
stickerNoteMarkdown?.addEventListener('dragover', (event) => {
  if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file')) event.preventDefault();
});
stickerNoteMarkdown?.addEventListener('drop', (event) => {
  const files = [...(event.dataTransfer?.files || [])].filter((file) => String(file.type || '').startsWith('image/'));
  if (!files.length) return;
  event.preventDefault();
  addStickerNoteFiles(files);
});
stickerNoteSave?.addEventListener('click', saveStickerNote);
stickerNoteCancel?.addEventListener('click', closeStickerNoteEditor);
stickerNoteCloseX?.addEventListener('click', closeStickerNoteEditor);

(function setupStickerNoteDrag() {
  if (!stickerNoteDrag || !stickerNoteBox) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  stickerNoteDrag.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const rect = stickerNoteBox.getBoundingClientRect();
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    stickerNoteDrag.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  stickerNoteDrag.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    stickerNoteBox.style.left = `${Math.max(8, origLeft + event.clientX - startX)}px`;
    stickerNoteBox.style.top = `${Math.max(8, origTop + event.clientY - startY)}px`;
  });
  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    try { stickerNoteDrag.releasePointerCapture(event.pointerId); } catch {}
  };
  stickerNoteDrag.addEventListener('pointerup', end);
  stickerNoteDrag.addEventListener('pointercancel', end);
})();

function placeMembersBoxCentered() {
  const w = membersBox.offsetWidth || 520;
  const h = membersBox.offsetHeight || 400;
  membersBox.style.left = `${Math.max(16, Math.round((window.innerWidth - w) / 2))}px`;
  membersBox.style.top = `${Math.max(16, Math.round((window.innerHeight - h) / 2))}px`;
}

function renderMembersList(...args) { return WorkspaceUi.renderMembersList(...args); }

function openMembersBox(...args) { return WorkspaceUi.openMembersBox(...args); }

function closeMembersBox(...args) { return WorkspaceUi.closeMembersBox(...args); }

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

async function restoreItem(...args) { return await WorkspaceUi.restoreItem(...args); }

async function restoreMember(...args) { return await AppHelpers.restoreMember(...args); }

async function deleteItem(...args) { return await WorkspaceUi.deleteItem(...args); }

function wireFavicon(...args) { return ListUi.wireFavicon(...args); }

function flipCards(...args) { return AppHelpers.flipCards(...args); }

function snapshotCardRects() {
  const map = new Map();
  gridEl.querySelectorAll('.card:not(.dragging)').forEach((card) => {
    map.set(card, card.getBoundingClientRect());
  });
  return map;
}

function beginCardDrag(...args) { return ListUi.beginCardDrag(...args); }

/** Dwell before a drop is treated as stack (ms). Short so stacking is easy; still avoids drive-by merges. */
const STACK_DWELL_MS = 150;

function clearStackHover() {
  gridEl.querySelectorAll('.card.stack-hover').forEach((el) => el.classList.remove('stack-hover'));
}

/**
 * Stack hot-zone: only the card title/meta strip (not thumb center).
 * Avoids green + while dragging over the bulk of the card.
 */
function findStackTargetAt(...args) { return AppHelpers.findStackTargetAt(...args); }

function updateStackHoverState(...args) { return ListUi.updateStackHoverState(...args); }

function queueCardPointerMove(e) {
  cardQueuedPointerEvent = e;
  if (cardPointerRaf) return;
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
  cardPointerRaf = schedule(() => {
    cardPointerRaf = 0;
    const next = cardQueuedPointerEvent;
    cardQueuedPointerEvent = null;
    if (next) onCardPointerMove(next);
  });
}

function flushCardPointerFrame(e) {
  if (cardPointerRaf) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(cardPointerRaf);
    else clearTimeout(cardPointerRaf);
    cardPointerRaf = 0;
  }
  const next = e || cardQueuedPointerEvent;
  cardQueuedPointerEvent = null;
  if (next) onCardPointerMove(next);
}

function onCardPointerMove(...args) { return ListUi.onCardPointerMove(...args); }

function cleanupCardDragVisual(...args) { return AppHelpers.cleanupCardDragVisual(...args); }

function normalizeParkedList(...args) { return AppHelpers.normalizeParkedList(...args); }

function normalizeNoteProjection(...args) { return AppHelpers.normalizeNoteProjection(...args); }

async function endCardDrag(...args) { return await ListUi.endCardDrag(...args); }

function detachCardDragListeners(...args) { return AppHelpers.detachCardDragListeners(...args); }

/**
 * Bind title/meta copy. Meta does not enter card drag (setPointerCapture kills click).
 * pointerup + small movement = copy (more reliable than click alone).
 */
function bindMetaCopy(...args) { return ListUi.bindMetaCopy(...args); }

function attachCardDrag(...args) { return ListUi.attachCardDrag(...args); }

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

function iconSvg(...args) { return ListUi.iconSvg(...args); }

async function togglePinned(...args) { return await AppHelpers.togglePinned(...args); }

function groupCoverHtml(...args) { return ListUi.groupCoverHtml(...args); }

function createGroupCard(...args) { return ListUi.createGroupCard(...args); }

function createCard(...args) { return ListUi.createCard(...args); }

function createRow(...args) { return ListUi.createRow(...args); }

function normalizeCanvasLayoutLocal(...args) { return AppHelpers.normalizeCanvasLayoutLocal(...args); }

function normalizeCanvasConnectionsLocal(...args) { return AppHelpers.normalizeCanvasConnectionsLocal(...args); }

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

function canvasPointFromEvent(...args) { return CanvasChrome.canvasPointFromEvent(...args); }

function updateCanvasTransform(...args) { return CanvasChrome.updateCanvasTransform(...args); }

function setCanvasZoom(...args) { return CanvasChrome.setCanvasZoom(...args); }

function canvasViewportSize(...args) { return CanvasChrome.canvasViewportSize(...args); }

function canvasFitViewport(...args) { return CanvasChrome.canvasFitViewport(...args); }

function closeCanvasZoomMenu(...args) { return CanvasChrome.closeCanvasZoomMenu(...args); }

function toggleCanvasZoomMenu(...args) { return CanvasChrome.toggleCanvasZoomMenu(...args); }

function applyCanvasZoomAction(...args) { return CanvasChrome.applyCanvasZoomAction(...args); }

function centerCanvasInitialView(...args) { return CanvasChrome.centerCanvasInitialView(...args); }

function scheduleInitialCanvasCenter(...args) { return CanvasChrome.scheduleInitialCanvasCenter(...args); }

function canvasThumbHtml(...args) { return CanvasRender.canvasThumbHtml(...args); }

function safeNotePreviewHtml(...args) { return CanvasRender.safeNotePreviewHtml(...args); }

function wireStickerAttachmentImages(...args) { return AppHelpers.wireStickerAttachmentImages(...args); }

/** Single-card toolbar + context-menu actions (tab / group / note). */
function canvasNodeActionEntries(...args) { return CanvasRender.canvasNodeActionEntries(...args); }

async function runCanvasNodeAction(...args) { return await CanvasIx.runCanvasNodeAction(...args); }

function canvasNodeHtml(...args) { return CanvasRender.canvasNodeHtml(...args); }

function canvasItemById(id) {
  return allTabs.find((item) => item.id === id) || null;
}

function cancelCanvasNodeClick(...args) { return CanvasIx.cancelCanvasNodeClick(...args); }

function scheduleCanvasNodePreview(...args) { return CanvasIx.scheduleCanvasNodePreview(...args); }

function suppressCanvasNodeClick(...args) { return CanvasIx.suppressCanvasNodeClick(...args); }

function wireCanvasLinkHandles(...args) { return CanvasIx.wireCanvasLinkHandles(...args); }

function wireCanvasNodeActions(...args) { return CanvasIx.wireCanvasNodeActions(...args); }

function updateCanvasNodeSelection(...args) { return CanvasIx.updateCanvasNodeSelection(...args); }

function normalizeCanvasCurveOffset(raw) {
  if (CanvasStoreApi?.normalizeCurveOffset) return CanvasStoreApi.normalizeCurveOffset(raw) || { x: 0, y: 0 };
  return CanvasGeom.normalizeCanvasCurveOffset(raw);
}

function canvasConnectionDomHandlePoint(...args) { return CanvasRender.canvasConnectionDomHandlePoint(...args); }

function canvasConnectionHandlePointForId(...args) { return CanvasRender.canvasConnectionHandlePointForId(...args); }

function canvasConnectionHandlePointForCursor(...args) { return CanvasRender.canvasConnectionHandlePointForCursor(...args); }

function canvasConnectionPosition(...args) { return CanvasRender.canvasConnectionPosition(...args); }

function canvasConnectionHandlePoints(...args) { return CanvasRender.canvasConnectionHandlePoints(...args); }

function canvasConnectionDragTarget(...args) { return CanvasIx.canvasConnectionDragTarget(...args); }

function beginCanvasConnectionDrag(...args) { return CanvasIx.beginCanvasConnectionDrag(...args); }

function updateCanvasConnectionDrag(...args) { return CanvasIx.updateCanvasConnectionDrag(...args); }

function renderCanvasConnectionDraft(...args) { return CanvasRender.renderCanvasConnectionDraft(...args); }

function commitCanvasConnectionDrag(...args) { return CanvasIx.commitCanvasConnectionDrag(...args); }

function endCanvasConnectionDrag(...args) { return CanvasIx.endCanvasConnectionDrag(...args); }

function cancelCanvasConnectionDrag(...args) { return CanvasIx.cancelCanvasConnectionDrag(...args); }

function resetCanvasConnectionCurve(...args) { return CanvasIx.resetCanvasConnectionCurve(...args); }

function selectCanvasConnection(...args) { return CanvasIx.selectCanvasConnection(...args); }

function clearCanvasConnectionSelection(...args) { return CanvasIx.clearCanvasConnectionSelection(...args); }

function deleteCanvasConnection(...args) { return CanvasIx.deleteCanvasConnection(...args); }

function handleCanvasConnectionNodeClick(...args) { return CanvasIx.handleCanvasConnectionNodeClick(...args); }

function canvasConnectionRenderOffset(...args) { return CanvasRender.canvasConnectionRenderOffset(...args); }

function handleCanvasConnectionClick(...args) { return CanvasIx.handleCanvasConnectionClick(...args); }

function handleCanvasConnectionDoubleClick(...args) { return CanvasIx.handleCanvasConnectionDoubleClick(...args); }

function setCanvasConnectionZoneHover(...args) { return CanvasIx.setCanvasConnectionZoneHover(...args); }

function detectCanvasConnectionDoublePointerDown(...args) { return CanvasIx.detectCanvasConnectionDoublePointerDown(...args); }

function wireCanvasConnectionPath(...args) { return CanvasIx.wireCanvasConnectionPath(...args); }

function renderCanvasConnections(...args) { return CanvasRender.renderCanvasConnections(...args); }

function updateCanvasNodePositions(...args) { return CanvasRender.updateCanvasNodePositions(...args); }

function renderCanvasMinimap(...args) { return CanvasRender.renderCanvasMinimap(...args); }

function canvasNodeRenderKey(...args) { return CanvasRender.canvasNodeRenderKey(...args); }

function createCanvasNodeElement(...args) { return CanvasRender.createCanvasNodeElement(...args); }

function removeCanvasNode(...args) { return CanvasRender.removeCanvasNode(...args); }

function renderCanvas(...args) { return CanvasRender.renderCanvas(...args); }

function setCanvasSelection(ids, additive = false) {
  ensureCanvasStore()?.setSelection(ids || [], additive);
  selectMode = activeCanvasSelection().size > 0;
}

function canvasSelectNode(...args) { return AppHelpers.canvasSelectNode(...args); }

function refreshCanvasSearchPreview(items = getCanvasVisibleTabs()) {
  updateCanvasNodePositions();
  updateCanvasNodeSelection();
  renderCanvasConnections();
  renderCanvasMinimap(items);
  updateBatchBar();
}

function canvasSearchPreviewSelectedIds(searchContext = getCanvasSearchContext()) {
  const visibleIds = new Set((searchContext?.items || []).map((item) => item.id));
  return [...activeCanvasSelection()].filter((id) => visibleIds.has(id));
}

function moveCanvasSearchPreview(...args) { return AppHelpers.moveCanvasSearchPreview(...args); }

function applyCanvasSearchPointerPreview(...args) { return AppHelpers.applyCanvasSearchPointerPreview(...args); }

function finishCanvasSearchPointer(...args) { return AppHelpers.finishCanvasSearchPointer(...args); }

function canvasMoveSelected(...args) { return AppHelpers.canvasMoveSelected(...args); }

function snapCanvasPosition(position) {
  if (!canvasSnapToGrid) return position;
  const grid = 24;
  position.x = Math.round(position.x / grid) * grid;
  position.y = Math.round(position.y / grid) * grid;
  return position;
}

function canvasWorldViewportCenter(...args) { return CanvasRender.canvasWorldViewportCenter(...args); }

function canvasArrangementEntries(...args) { return CanvasRender.canvasArrangementEntries(...args); }

function arrangeCanvasGrid(...args) { return CanvasRender.arrangeCanvasGrid(...args); }

function arrangeCanvasAlign(...args) { return CanvasRender.arrangeCanvasAlign(...args); }

function arrangeCanvas(...args) { return AppHelpers.arrangeCanvas(...args); }

function openCanvasStackDialog(...args) { return CanvasChrome.openCanvasStackDialog(...args); }

function closeCanvasStackDialog(...args) { return CanvasChrome.closeCanvasStackDialog(...args); }

async function createCanvasStackFromSelection(...args) { return await CanvasChrome.createCanvasStackFromSelection(...args); }

async function canvasAction(...args) { return await CanvasChrome.canvasAction(...args); }

function canvasNodeWorldRect(...args) { return AppHelpers.canvasNodeWorldRect(...args); }

// Position-based lookup for hit-testing: uses the layout state directly
// instead of getBoundingClientRect(), so it never forces a reflow. Matches
// canvasNodeWorldRect's coordinate space via canvasDisplayPosition (which
// applies the same CANVAS_NODE_DISPLAY_SCALE the DOM box is actually sized to).
function canvasNodeWorldRectFromState(id) {
  const raw = canvasStoreSnapshot().layout?.positions?.[id];
  if (!raw) return null;
  const position = canvasDisplayPosition(raw);
  return { x: position.x, y: position.y, w: position.w, h: position.h, z: position.z || 0 };
}

function canvasTargetAt(...args) { return AppHelpers.canvasTargetAt(...args); }

function resetCanvasView(...args) { return AppHelpers.resetCanvasView(...args); }

function clearCanvasMiddleClickSequence() {
  if (canvasMiddleClickTimer) clearTimeout(canvasMiddleClickTimer);
  canvasMiddleClickTimer = null;
  canvasLastMiddleClickAt = 0;
}

function handleCanvasMiddleClick(...args) { return CanvasIx.handleCanvasMiddleClick(...args); }

function isCanvasControlTarget(...args) { return CanvasIx.isCanvasControlTarget(...args); }

function isCanvasContextMenuOpen() {
  return Boolean(canvasContextMenu && !canvasContextMenu.hidden);
}

function closeCanvasContextMenu(...args) { return CanvasChrome.closeCanvasContextMenu(...args); }

function canvasBlankContextMenuEntries(...args) { return CanvasChrome.canvasBlankContextMenuEntries(...args); }

function renderCanvasContextMenuItems(...args) { return CanvasChrome.renderCanvasContextMenuItems(...args); }

function openCanvasContextMenu(...args) { return CanvasChrome.openCanvasContextMenu(...args); }

async function handleCanvasContextMenuAction(...args) { return await CanvasChrome.handleCanvasContextMenuAction(...args); }

function isCanvasWheelControlTarget(...args) { return CanvasIx.isCanvasWheelControlTarget(...args); }

function normalizeCanvasWheelDelta(...args) { return CanvasIx.normalizeCanvasWheelDelta(...args); }

function flushCanvasWheelZoom(...args) { return CanvasIx.flushCanvasWheelZoom(...args); }

function scheduleCanvasWheelZoom(...args) { return CanvasIx.scheduleCanvasWheelZoom(...args); }

function beginCanvasPointer(...args) { return CanvasIx.beginCanvasPointer(...args); }

function applyCanvasPointer(...args) { return CanvasIx.applyCanvasPointer(...args); }

function updateCanvasPointer(...args) { return CanvasIx.updateCanvasPointer(...args); }

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
  canvasNodeElements.forEach((node) => {
    node.classList.remove('dragging', 'stack-hover');
  });
}

function cancelCanvasPointer(...args) { return AppHelpers.cancelCanvasPointer(...args); }

async function endCanvasPointer(...args) { return await CanvasIx.endCanvasPointer(...args); }

function beginCanvasMinimapDrag(...args) { return CanvasIx.beginCanvasMinimapDrag(...args); }

function updateCanvasMinimapDrag(...args) { return CanvasIx.updateCanvasMinimapDrag(...args); }

function endCanvasMinimapDrag(...args) { return CanvasIx.endCanvasMinimapDrag(...args); }

function resetCanvasNotePlacement() {
  setCanvasActiveTool(canvasActiveTool === 'note' ? 'select' : canvasActiveTool);
}

function armCanvasNotePlacement() {
  setCanvasActiveTool('note');
  canvasViewportEl?.focus?.({ preventScroll: true });
}

function setCanvasActiveTool(...args) { return AppHelpers.setCanvasActiveTool(...args); }

function placeStickerNoteAt(...args) { return StickerUi.placeStickerNoteAt(...args); }

function initCanvasInteractions(...args) { return CanvasIx.initCanvasInteractions(...args); }

function renderEmpty(...args) { return ListUi.renderEmpty(...args); }

function gridNodeRenderKey(...args) { return AppHelpers.gridNodeRenderKey(...args); }

function removeGridNode(id, node) {
  node?.querySelectorAll('img.lazy-thumb').forEach((img) => {
    thumbObserver?.unobserve?.(img);
  });
  node?.remove();
  gridNodeElements.delete(id);
}

function updateGridSelectionUi() {
  gridEl.querySelectorAll('[data-id]').forEach((node) => {
    const active = selectedIds.has(node.dataset.id);
    node.classList.toggle('selected', active);
    const check = node.querySelector('.card-check');
    if (check) check.checked = active;
  });
}

function renderGrid(...args) { return ListUi.renderGrid(...args); }

let loadListTimer = null;

async function loadList(...args) { return await WorkspaceUi.loadList(...args); }

function scheduleLoadList(...args) { return AppHelpers.scheduleLoadList(...args); }

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
    settings.autoSaveMetadata = normalizeAutoSaveMetadata(settings.autoSaveMetadata);
    normalizeCanvasRailSettings(settings);
    syncSettingsUi();
    renderGrid();
  }
});

initCanvasInteractions();
initCanvasRailResize();

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
