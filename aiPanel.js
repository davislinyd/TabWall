/**
 * TabWall external AI panel.
 * This content script only creates the UI on demand; the service worker owns
 * the agent, page extraction, storage mutations, and bridge calls.
 */
(function (global) {
  'use strict';

  const HOST_ID = 'tabwall-ai-panel-host';
  const LAYOUT_KEY = 'aiPanelLayout';
  const LAYOUT_VERSION = 2;
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 760;
  const FAB_SIZE = 52 * 0.6;
  const MIN_HEIGHT = 320;
  const DEFAULT_HEIGHT = 720;
  const DOUBLE_ESCAPE_WINDOW_MS = 500;
  const DEFAULT_WIDTH = 430;
  const DEFAULT_GAP = 16;

  const COPY = {
    zh: {
      aiTitle: 'AI',
      aiReady: '就緒',
      aiWorking: '分析中',
      aiContextReady: '尚未建立 context',
      aiContextCount: ({ n }) => `開啟 ${n}（open / saved）`,
      aiContextTrimmed: '內容已裁切以符合 context 上限',
      aiStop: '停止',
      aiClear: '清除',
      aiClose: '關閉',
      aiCollapse: '收合',
      aiExpand: '展開 AI',
      aiSend: '送出',
      aiInputPh: '問問你的分頁…',
      aiPrivacyHint: '遠端 Provider 讀取 TabWall 資料前會要求確認。',
      aiProvider: 'Provider',
      aiModel: 'Model',
      aiNoModels: '尚未取得 models',
      aiAssistant: 'AI',
      aiYou: '你',
      aiTool: '工具',
      aiAgentActivity: ({ n }) => `Agent 活動（${n} 項）`,
      aiQuota: 'Quota',
      aiQuotaRequests: 'Requests',
      aiQuotaTokens: 'Tokens',
      aiQuotaReset: '重置',
      aiSourcesLabel: '來源分頁',
      aiConfirmTitle: 'Agent 想執行這個操作',
      aiExternalDataConfirm: '這會把 TabWall 資料送到遠端 Provider。',
      aiWriteConfirm: '這會修改 TabWall 資料。',
      aiReject: '拒絕',
      aiApprove: '允許一次',
      aiNeedsConfirmation: '等待你的確認',
      aiApproved: '已允許，執行中…',
      aiRejected: '已拒絕',
      aiDisconnected: 'AI 連線已中斷',
      aiConnectFailed: '無法連接 AI',
      aiToolsUnavailable: '模型不支援 Agent tools，已切換純聊天。',
      aiToolFailed: '失敗',
      aiToolDone: '完成',
      aiCancelled: '已停止',
      aiUnknownError: '未知錯誤',
      aiError: 'AI 錯誤',
      aiEnableFirst: '請先在 TabWall 設定啟用 AI Agent',
      aiStarting: '準備分析',
      aiStopping: '正在停止',
    },
    en: {
      aiTitle: 'AI',
      aiReady: 'Ready',
      aiWorking: 'Analyzing',
      aiContextReady: 'Context not built',
      aiContextCount: ({ n }) => `Open ${n} (open / saved)`,
      aiContextTrimmed: 'Context was trimmed to fit the limit',
      aiStop: 'Stop',
      aiClear: 'Clear',
      aiClose: 'Close',
      aiCollapse: 'Collapse',
      aiExpand: 'Open AI',
      aiSend: 'Send',
      aiInputPh: 'Ask about your tabs…',
      aiPrivacyHint: 'Remote providers require confirmation before reading TabWall data.',
      aiProvider: 'Provider',
      aiModel: 'Model',
      aiNoModels: 'No models fetched yet',
      aiAssistant: 'AI',
      aiYou: 'You',
      aiTool: 'Tool',
      aiAgentActivity: ({ n }) => `Agent activity (${n})`,
      aiQuota: 'Quota',
      aiQuotaRequests: 'Requests',
      aiQuotaTokens: 'Tokens',
      aiQuotaReset: 'Reset',
      aiSourcesLabel: 'Sources',
      aiConfirmTitle: 'The agent wants to run this action',
      aiExternalDataConfirm: 'This will send TabWall data to the remote provider.',
      aiWriteConfirm: 'This will modify TabWall data.',
      aiReject: 'Reject',
      aiApprove: 'Allow once',
      aiNeedsConfirmation: 'Waiting for your confirmation',
      aiApproved: 'Allowed once; running…',
      aiRejected: 'Rejected',
      aiDisconnected: 'AI connection disconnected',
      aiConnectFailed: 'Unable to connect to AI',
      aiToolsUnavailable: 'This model does not support Agent tools; switched to chat-only mode.',
      aiToolFailed: 'failed',
      aiToolDone: 'done',
      aiCancelled: 'Stopped',
      aiUnknownError: 'Unknown error',
      aiError: 'AI error',
      aiEnableFirst: 'Enable the AI Agent in TabWall settings first',
      aiStarting: 'Preparing analysis',
      aiStopping: 'Stopping',
    },
  };

  function language() {
    const value = String(global.navigator?.language || 'zh');
    return value.toLowerCase().startsWith('en') ? 'en' : 'zh';
  }

  function t(key, vars = {}) {
    const value = COPY[language()][key] ?? COPY.zh[key] ?? key;
    return typeof value === 'function' ? value(vars) : value;
  }

  function isAiPanelHotkey(event) {
    const shared = global.TabWallAiCore?.isOptionLetterHotkey;
    if (typeof shared === 'function') return shared(event, 'KeyA');
    return Boolean(
      event && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey &&
      event.code === 'KeyA' && !event.repeat && !event.isComposing && event.keyCode !== 229
    );
  }

  function isEditableTarget(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element) return false;
    const tag = String(element.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
  }

  function eventPath(event) {
    return typeof event?.composedPath === 'function' ? event.composedPath() : [];
  }

  function isAiPanelKeyboardEvent(event, host) {
    return Boolean(
      host &&
      ['keydown', 'keypress', 'keyup'].includes(event?.type) &&
      eventPath(event).includes(host)
    );
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function heightBounds(size) {
    const maxHeight = Math.max(160, size.height - 32);
    return {
      minHeight: Math.min(MIN_HEIGHT, maxHeight),
      maxHeight,
    };
  }

  function isDoubleEscapePress(now, previousAt, maxDelay = DOUBLE_ESCAPE_WINDOW_MS) {
    const current = Number(now);
    const previous = Number(previousAt);
    const delay = Number(maxDelay);
    return Number.isFinite(current) && Number.isFinite(previous) && Number.isFinite(delay) &&
      previous > 0 && current >= previous && current - previous <= delay;
  }

  function shouldMinimizeOnEscape(event, now, previousAt) {
    return Boolean(
      event?.key === 'Escape' &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      !event.repeat &&
      isDoubleEscapePress(now, previousAt)
    );
  }

  function viewportSize(viewport = {}) {
    return {
      width: Math.max(320, finite(viewport.width, global.innerWidth || 1280)),
      height: Math.max(240, finite(viewport.height, global.innerHeight || 800)),
    };
  }

  function normalizeLayout(raw, viewport = {}) {
    const size = viewportSize(viewport);
    const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, size.width - 16));
    const width = clamp(Math.round(finite(raw?.width, DEFAULT_WIDTH)), MIN_WIDTH, maxWidth);
    const heightRange = heightBounds(size);
    const defaultHeight = Math.min(DEFAULT_HEIGHT, heightRange.maxHeight);
    const height = clamp(
      Math.round(finite(raw?.height, defaultHeight)),
      heightRange.minHeight,
      heightRange.maxHeight
    );
    const maxLeft = Math.max(8, size.width - width - 8);
    const maxTop = Math.max(8, size.height - height - 8);
    const defaultLeft = size.width - width - DEFAULT_GAP;
    const defaultTop = DEFAULT_GAP;
    const fabMaxLeft = Math.max(8, size.width - FAB_SIZE - 8);
    const fabMaxTop = Math.max(8, size.height - FAB_SIZE - 8);
    return {
      version: LAYOUT_VERSION,
      width,
      height,
      left: clamp(Math.round(finite(raw?.left, defaultLeft)), 8, maxLeft),
      top: clamp(Math.round(finite(raw?.top, defaultTop)), 8, maxTop),
      fabLeft: clamp(Math.round(finite(raw?.fabLeft, fabMaxLeft)), 8, fabMaxLeft),
      fabTop: clamp(Math.round(finite(raw?.fabTop, fabMaxTop)), 8, fabMaxTop),
      collapsed: raw?.collapsed === true,
    };
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        const runtime = global.chrome?.runtime;
        if (!runtime?.sendMessage) {
          resolve({ ok: false, error: 'no_runtime' });
          return;
        }
        runtime.sendMessage(payload, (response) => {
          if (runtime.lastError) {
            resolve({ ok: false, error: runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'empty_response' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function install() {
    if (!global.document || global.__tabWallAiPanelInstalled) return;
    global.__tabWallAiPanelInstalled = true;

    let host = null;
    let shadow = null;
    let panel = null;
    let fab = null;
    let resizeHandle = null;
    let heightResizeHandle = null;
    let layout = normalizeLayout();
    let saveTimer = null;
    let core = null;
    let openGeneration = 0;
    let pointerAction = null;
    let suppressFabClick = false;
    let lastEscapeAt = 0;

    function loadLayout() {
      const storage = global.chrome?.storage?.local;
      if (!storage?.get) return Promise.resolve();
      return storage.get(LAYOUT_KEY).then((data) => {
        layout = normalizeLayout(data?.[LAYOUT_KEY], viewportSize());
        applyLayout();
      }).catch(() => {});
    }

    function saveLayout() {
      const storage = global.chrome?.storage?.local;
      if (!storage?.set) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        const value = {
          version: LAYOUT_VERSION,
          width: layout.width,
          height: layout.height,
          left: layout.left,
          top: layout.top,
          fabLeft: layout.fabLeft,
          fabTop: layout.fabTop,
          collapsed: layout.collapsed,
        };
        Promise.resolve(storage.set({ [LAYOUT_KEY]: value })).catch(() => {});
      }, 120);
    }

    function applyLayout() {
      if (!panel || !fab) return;
      layout = normalizeLayout(layout, viewportSize());
      panel.style.left = `${layout.left}px`;
      panel.style.top = `${layout.top}px`;
      panel.style.width = `${layout.width}px`;
      panel.style.height = `${layout.height}px`;
      fab.style.left = `${layout.fabLeft}px`;
      fab.style.top = `${layout.fabTop}px`;
      panel.hidden = layout.collapsed;
      fab.hidden = !layout.collapsed;
      panel.setAttribute('aria-hidden', layout.collapsed ? 'true' : 'false');
      fab.setAttribute('aria-hidden', layout.collapsed ? 'false' : 'true');
    }

    function setExpanded(expanded, persist = true) {
      layout.collapsed = !expanded;
      applyLayout();
      if (persist) saveLayout();
      if (expanded) {
        setTimeout(() => panel?.querySelector('#tabwall-ai-input')?.focus(), 0);
      }
    }

    function addButton(parent, label, className, handler) {
      const button = global.document.createElement('button');
      button.type = 'button';
      button.className = className || 'btn';
      button.textContent = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handler?.(event);
      });
      parent.appendChild(button);
      return button;
    }

    function createUi() {
      host = global.document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute('data-tabwall-ai-panel', '1');
      shadow = host.attachShadow({ mode: 'open' });

      const style = global.document.createElement('style');
      style.textContent = `
        :host { all: initial; color-scheme: light; }
        *, *::before, *::after { box-sizing: border-box; }
        .layer { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif; color: #2e2b27; }
        .panel { position: fixed; display: flex; flex-direction: column; min-width: ${MIN_WIDTH}px; height: ${DEFAULT_HEIGHT}px; max-height: calc(100dvh - 32px); overflow: hidden; border: 1px solid rgba(46, 43, 39, .24); border-radius: 6px; background: #f6f1e6; box-shadow: 0 18px 42px rgba(16, 17, 16, .3); pointer-events: auto; }
        .panel[hidden], .fab[hidden] { display: none; }
        .header { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 8px 10px 8px 14px; border-bottom: 1px solid rgba(46, 43, 39, .14); cursor: grab; user-select: none; touch-action: none; }
        .header:active { cursor: grabbing; }
        .header h2 { flex: 1; min-width: 0; margin: 0; font-size: 16px; line-height: 1.2; }
        .toolbar, .composer-actions, .ai-confirm-actions { display: flex; align-items: center; gap: 6px; }
        .toolbar { min-height: 42px; padding: 7px 10px; border-bottom: 1px solid rgba(46, 43, 39, .12); font-size: 11px; flex-wrap: wrap; }
        .select { max-width: 150px; min-width: 0; border: 1px solid rgba(46, 43, 39, .18); border-radius: 4px; padding: 4px 6px; background: transparent; color: inherit; font: inherit; font-size: 11px; }
        .status { min-width: 0; color: #2e2b27; font-weight: 650; }
        .status[data-state="working"] { color: #b85e43; }
        .status[data-state="working"]::after { content: "..."; display: inline-block; width: 0; overflow: hidden; vertical-align: bottom; white-space: nowrap; animation: tabwall-external-ai-dots 1.2s steps(1, end) infinite; }
        .status[data-state="error"] { color: #b42318; }
        .status[data-state="pending"] { color: #b85e43; }
        .status[data-state="done"] { color: #2e2b27; }
        @keyframes tabwall-external-ai-dots { 0%, 24% { width: 0; } 25%, 49% { width: .28em; } 50%, 74% { width: .56em; } 75%, 100% { width: .84em; } }
        @media (prefers-reduced-motion: reduce) { .status[data-state="working"]::after { width: .84em; animation: none; } }
        .context { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #777067; }
        .btn { border: 1px solid rgba(46, 43, 39, .18); border-radius: 4px; padding: 5px 8px; background: transparent; color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
        .btn:hover { background: rgba(198, 111, 89, .12); }
        .btn.primary { border-color: #c66f59; background: #c66f59; color: #fffaf1; }
        .icon-btn { width: 28px; height: 28px; padding: 0; font-size: 16px; line-height: 1; }
        .ai-sources { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 5px; padding: 7px 10px; border-bottom: 1px solid rgba(46, 43, 39, .12); background: rgba(46, 43, 39, .035); color: #777067; font-size: 10px; }
        .ai-sources[hidden], .ai-tool-confirm[hidden], .ai-quota[hidden] { display: none; }
        .ai-sources-label { font-weight: 700; }
        .ai-source { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ai-messages { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 10px; overflow: auto; padding: 10px; background: #f6f1e6; scrollbar-color: rgba(46, 43, 39, .28) #f6f1e6; scrollbar-width: thin; }
        .ai-messages::-webkit-scrollbar, .ai-confirm-args::-webkit-scrollbar, .ai-message-text pre::-webkit-scrollbar { width: 10px; height: 10px; }
        .ai-messages::-webkit-scrollbar-track, .ai-confirm-args::-webkit-scrollbar-track, .ai-message-text pre::-webkit-scrollbar-track { background: #f6f1e6; }
        .ai-messages::-webkit-scrollbar-thumb, .ai-confirm-args::-webkit-scrollbar-thumb, .ai-message-text pre::-webkit-scrollbar-thumb { border: 2px solid #f6f1e6; border-radius: 999px; background: rgba(46, 43, 39, .28); }
        .ai-messages::-webkit-scrollbar-thumb:hover, .ai-confirm-args::-webkit-scrollbar-thumb:hover, .ai-message-text pre::-webkit-scrollbar-thumb:hover { background: rgba(46, 43, 39, .45); }
        .ai-message { max-width: 92%; margin: 0; padding: 10px 12px; border: 1px solid rgba(46, 43, 39, .12); border-radius: 8px; background: rgba(255, 255, 255, .42); }
        .ai-message-user { align-self: flex-end; border-color: rgba(198, 111, 89, .42); background: rgba(198, 111, 89, .14); }
        .ai-message-tool { align-self: stretch; color: #777067; background: rgba(46, 43, 39, .045); }
        .ai-agent-activity { align-self: stretch; color: #777067; font-size: 11px; }
        .ai-agent-activity summary { cursor: pointer; font-weight: 650; }
        .ai-agent-activity ul { margin: 6px 0 0; padding-left: 18px; }
        .ai-agent-activity li[data-state="error"] { color: #b42318; }
        .ai-message-label { margin-bottom: 5px; color: #777067; font-size: 10px; font-weight: 700; }
        .ai-message-text { min-width: 0; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
        .ai-message-text p { margin: 0 0 10px; white-space: pre-wrap; }
        .ai-message-text p:last-child, .ai-message-text > :last-child { margin-bottom: 0; }
        .ai-message-text h1, .ai-message-text h2, .ai-message-text h3 { margin: 0 0 8px; line-height: 1.25; }
        .ai-message-text h1 { font-size: 18px; }
        .ai-message-text h2 { font-size: 16px; }
        .ai-message-text h3 { font-size: 14px; }
        .ai-message-text ul, .ai-message-text ol { margin: 0 0 10px; padding-left: 22px; }
        .ai-message-text li + li { margin-top: 4px; }
        .ai-message-text blockquote { margin: 0 0 10px; padding-left: 10px; border-left: 3px solid rgba(198, 111, 89, .5); color: #777067; }
        .ai-message-text code { border-radius: 3px; padding: 1px 4px; background: rgba(46, 43, 39, .1); font: 0.92em ui-monospace, SFMono-Regular, Menlo, monospace; }
        .ai-message-text pre { max-width: 100%; margin: 0 0 10px; overflow: auto; padding: 9px 10px; border-radius: 5px; background: rgba(46, 43, 39, .09); scrollbar-color: rgba(46, 43, 39, .28) #f6f1e6; scrollbar-width: thin; }
        .ai-message-text pre code { padding: 0; background: transparent; white-space: pre; }
        .ai-message-text a { color: #a94f39; text-decoration: underline; text-underline-offset: 2px; }
        .ai-tool-confirm { flex: 0 0 auto; margin: 0 10px 8px; padding: 9px; border: 1px solid #c66f59; border-radius: 5px; background: rgba(198, 111, 89, .1); font-size: 12px; }
        .ai-quota { flex: 0 0 auto; min-height: 30px; padding: 8px 10px; border-top: 1px solid rgba(46, 43, 39, .12); background: rgba(46, 43, 39, .035); color: #777067; font-size: 11px; line-height: 1.3; }
        .ai-confirm-name { margin-top: 5px; font-weight: 700; overflow-wrap: anywhere; }
        .ai-confirm-risk { margin-top: 4px; color: #777067; line-height: 1.4; }
        .ai-confirm-args { max-height: 150px; margin: 7px 0; overflow: auto; padding: 7px; background: rgba(255, 255, 255, .5); color: #2e2b27; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; scrollbar-color: rgba(46, 43, 39, .28) #f6f1e6; scrollbar-width: thin; }
        .composer { flex: 0 0 auto; padding: 9px 10px 10px; border-top: 1px solid rgba(46, 43, 39, .12); }
        .composer textarea { display: block; width: 100%; min-height: 70px; resize: vertical; border: 1px solid rgba(46, 43, 39, .2); border-radius: 4px; padding: 8px; background: rgba(255, 255, 255, .48); color: inherit; font: inherit; font-size: 13px; outline: none; }
        .composer textarea:focus { border-color: #c66f59; box-shadow: 0 0 0 2px rgba(198, 111, 89, .15); }
        .composer-actions { justify-content: flex-end; margin-top: 6px; }
        .hint { flex: 1; min-width: 0; color: #777067; font-size: 10px; line-height: 1.35; }
        .bridge-toggle { align-self: flex-start; margin-top: 6px; border: 0; padding: 2px 0; color: #777067; font-size: 10px; text-decoration: underline; }
        .bridge-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: #777067; font-size: 10px; }
        .bridge-row[hidden], .bridge-toggle[hidden] { display: none; }
        .bridge-row input { flex: 1; min-width: 0; border: 1px solid rgba(46, 43, 39, .16); border-radius: 3px; padding: 4px 6px; background: rgba(255, 255, 255, .4); color: inherit; font: inherit; }
        .resize-handle { position: absolute; top: 0; bottom: 0; left: -5px; width: 10px; cursor: ew-resize; touch-action: none; }
        .resize-height-handle { position: absolute; right: 0; bottom: 0; left: 0; height: 10px; cursor: ns-resize; touch-action: none; z-index: 2; }
        .fab { position: fixed; display: grid; place-items: center; width: ${FAB_SIZE}px; height: ${FAB_SIZE}px; border: 1px solid rgba(46, 43, 39, .22); border-radius: 50%; background: #c66f59; color: #fffaf1; box-shadow: 0 8px 22px rgba(16, 17, 16, .28); pointer-events: auto; cursor: grab; font: 700 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; user-select: none; touch-action: none; }
        .fab:active { cursor: grabbing; }
      `;

      const layer = global.document.createElement('div');
      layer.className = 'layer';
      panel = global.document.createElement('section');
      panel.className = 'panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', t('aiTitle'));
      panel.setAttribute('aria-modal', 'false');

      const header = global.document.createElement('div');
      header.className = 'header';
      const heading = global.document.createElement('h2');
      heading.textContent = t('aiTitle');
      header.append(heading);
      const collapse = addButton(header, '−', 'btn icon-btn', () => setExpanded(false));
      collapse.title = t('aiCollapse');
      collapse.setAttribute('aria-label', t('aiCollapse'));
      const close = addButton(header, '×', 'btn icon-btn', closePanel);
      close.title = t('aiClose');
      close.setAttribute('aria-label', t('aiClose'));

      const toolbar = global.document.createElement('div');
      toolbar.className = 'toolbar';
      const status = global.document.createElement('span');
      status.className = 'status';
      status.id = 'tabwall-ai-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = t('aiReady');
      const providerSelect = global.document.createElement('select');
      providerSelect.className = 'select';
      providerSelect.setAttribute('aria-label', t('aiProvider'));
      const modelSelect = global.document.createElement('select');
      modelSelect.className = 'select';
      modelSelect.setAttribute('aria-label', t('aiModel'));
      const contextStatus = global.document.createElement('span');
      contextStatus.className = 'context';
      contextStatus.id = 'tabwall-ai-context-status';
      contextStatus.textContent = t('aiContextReady');
      const stop = addButton(toolbar, t('aiStop'), 'btn', null);
      const clear = addButton(toolbar, t('aiClear'), 'btn', null);
      toolbar.append(status, providerSelect, modelSelect, contextStatus, stop, clear);

      const sources = global.document.createElement('div');
      sources.className = 'ai-sources';
      sources.id = 'tabwall-ai-sources';
      sources.hidden = true;
      const messages = global.document.createElement('div');
      messages.className = 'ai-messages';
      messages.id = 'tabwall-ai-messages';
      messages.setAttribute('role', 'log');
      messages.setAttribute('aria-live', 'polite');
      const confirmation = global.document.createElement('div');
      confirmation.className = 'ai-tool-confirm';
      confirmation.id = 'tabwall-ai-tool-confirm';
      confirmation.hidden = true;
      const quota = global.document.createElement('div');
      quota.className = 'ai-quota';
      quota.id = 'tabwall-ai-quota';
      quota.setAttribute('role', 'status');
      quota.setAttribute('aria-live', 'polite');
      quota.hidden = true;

      const composer = global.document.createElement('div');
      composer.className = 'composer';
      const input = global.document.createElement('textarea');
      input.id = 'tabwall-ai-input';
      input.rows = 3;
      input.placeholder = t('aiInputPh');
      input.setAttribute('aria-label', t('aiInputPh'));
      const composerActions = global.document.createElement('div');
      composerActions.className = 'composer-actions';
      const hint = global.document.createElement('span');
      hint.className = 'hint';
      hint.textContent = t('aiPrivacyHint');
      const send = addButton(composerActions, t('aiSend'), 'btn primary', null);
      composerActions.append(hint);
      composer.append(input, composerActions);

      resizeHandle = global.document.createElement('div');
      resizeHandle.className = 'resize-handle';
      resizeHandle.setAttribute('role', 'separator');
      resizeHandle.setAttribute('aria-orientation', 'vertical');
      resizeHandle.setAttribute('aria-label', '調整 AI 面板寬度');
      heightResizeHandle = global.document.createElement('div');
      heightResizeHandle.className = 'resize-height-handle';
      heightResizeHandle.setAttribute('role', 'separator');
      heightResizeHandle.setAttribute('aria-orientation', 'horizontal');
      heightResizeHandle.setAttribute('aria-label', '調整 AI 面板高度');
      panel.append(header, toolbar, sources, messages, confirmation, quota, composer, resizeHandle, heightResizeHandle);

      fab = global.document.createElement('button');
      fab.type = 'button';
      fab.className = 'fab';
      fab.textContent = 'AI';
      fab.title = t('aiExpand');
      fab.setAttribute('aria-label', t('aiExpand'));
      fab.addEventListener('click', () => {
        if (suppressFabClick) return;
        setExpanded(true);
      });

      layer.append(panel, fab);
      shadow.append(style, layer);
      global.document.documentElement.appendChild(host);

      const env = {
        aiStatus: status,
        aiContextStatus: contextStatus,
        aiSources: sources,
        aiMessages: messages,
        aiToolConfirm: confirmation,
        aiQuota: quota,
        aiInput: input,
        aiProviderSelect: providerSelect,
        aiModelSelect: modelSelect,
        aiSendBtn: send,
        aiStopBtn: stop,
        aiClearBtn: clear,
      };
      core = global.TabWallAiCore?.create?.({
        env,
        document: global.document,
        t: (key, vars) => t(key, vars),
        getSettings: async () => {
          const result = await sendRuntimeMessage({ type: 'GET_AI_SETTINGS' });
          return result?.ai || {};
        },
        saveSelection: async ({ providerId, model }) => {
          const result = await sendRuntimeMessage({ type: 'AI_UPDATE_SELECTION', providerId, model });
          return result?.ai || {};
        },
        showUi: () => setExpanded(true, false),
        handleInputKeydown: false,
      }) || null;
      core?.init?.();
      header.addEventListener('pointerdown', (event) => beginPointerAction('drag', event));
      resizeHandle.addEventListener('pointerdown', (event) => beginPointerAction('resize', event));
      heightResizeHandle.addEventListener('pointerdown', (event) => beginPointerAction('resize-height', event));
      fab.addEventListener('pointerdown', (event) => beginPointerAction('fab', event));
      input.addEventListener('blur', () => { lastEscapeAt = 0; });
      global.addEventListener('resize', handleViewportResize);
      applyLayout();
    }

    function beginPointerAction(type, event) {
      if (event.button !== 0) return;
      if (type === 'drag' && event.target.closest?.('button')) return;
      const target = event.currentTarget;
      const rect = (type === 'fab' ? fab : panel).getBoundingClientRect();
      pointerAction = {
        type,
        target,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: type === 'fab' ? layout.fabLeft : layout.left,
        startTop: type === 'fab' ? layout.fabTop : layout.top,
        startWidth: panel.offsetWidth || layout.width,
        startHeight: panel.offsetHeight || layout.height,
        moved: false,
        rect,
      };
      target.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      target.addEventListener('pointermove', movePointerAction);
      target.addEventListener('pointerup', endPointerAction, { once: true });
      target.addEventListener('pointercancel', endPointerAction, { once: true });
    }

    function movePointerAction(event) {
      if (!pointerAction) return;
      const action = pointerAction;
      const dx = event.clientX - action.startX;
      const dy = event.clientY - action.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) action.moved = true;
      const size = viewportSize();
      if (action.type === 'resize') {
        const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, size.width - 16));
        const width = clamp(Math.round(action.startWidth - dx), MIN_WIDTH, maxWidth);
        layout.width = width;
        layout.left = clamp(Math.round(action.startLeft + action.startWidth - width), 8, Math.max(8, size.width - width - 8));
      } else if (action.type === 'resize-height') {
        const range = heightBounds(size);
        layout.height = clamp(Math.round(action.startHeight + dy), range.minHeight, range.maxHeight);
        layout.top = clamp(layout.top, 8, Math.max(8, size.height - layout.height - 8));
      } else if (action.type === 'fab') {
        layout.fabLeft = clamp(Math.round(action.startLeft + dx), 8, Math.max(8, size.width - FAB_SIZE - 8));
        layout.fabTop = clamp(Math.round(action.startTop + dy), 8, Math.max(8, size.height - FAB_SIZE - 8));
      } else {
        layout.left = clamp(Math.round(action.startLeft + dx), 8, Math.max(8, size.width - layout.width - 8));
        layout.top = clamp(Math.round(action.startTop + dy), 8, Math.max(8, size.height - layout.height - 8));
      }
      applyLayout();
      if (action.moved) saveLayout();
    }

    function endPointerAction(event) {
      const action = pointerAction;
      if (!action) return;
      try {
        action.target.releasePointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
      action.target.removeEventListener('pointermove', movePointerAction);
      pointerAction = null;
      if (action.type === 'fab' && action.moved) {
        suppressFabClick = true;
        setTimeout(() => { suppressFabClick = false; }, 0);
      }
      saveLayout();
    }

    function handleViewportResize() {
      if (!host) return;
      layout = normalizeLayout(layout, viewportSize());
      applyLayout();
      saveLayout();
    }

    function closePanel() {
      openGeneration += 1;
      core?.destroy?.();
      global.removeEventListener('resize', handleViewportResize);
      if (host) host.remove();
      host = null;
      shadow = null;
      panel = null;
      fab = null;
      resizeHandle = null;
      heightResizeHandle = null;
      core = null;
      pointerAction = null;
      lastEscapeAt = 0;
    }

    async function openPanel() {
      if (host) {
        setExpanded(true);
        core?.open?.();
        return true;
      }
      const generation = ++openGeneration;
      createUi();
      await loadLayout();
      if (generation !== openGeneration || !host) return false;
      layout.collapsed = false;
      applyLayout();
      core?.open?.();
      return true;
    }

    function togglePanel() {
      if (host) {
        if (layout.collapsed) setExpanded(true);
        else closePanel();
        return;
      }
      openPanel().catch(() => {});
    }

    function isolatePanelKeyboard(event) {
      if (!isAiPanelKeyboardEvent(event, host)) return;
      if (event.type === 'keydown' && isAiPanelHotkey(event)) {
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
        return;
      }
      const path = eventPath(event);
      const input = panel?.querySelector('#tabwall-ai-input');
      if (event.type === 'keydown' && input && path.includes(input)) {
        if (event.key === 'Escape') {
          if (event.isComposing || event.keyCode === 229 || event.repeat) {
            lastEscapeAt = 0;
          } else {
            const now = Date.now();
            if (shouldMinimizeOnEscape(event, now, lastEscapeAt)) {
              lastEscapeAt = 0;
              event.preventDefault();
              setExpanded(false);
            } else {
              lastEscapeAt = now;
            }
          }
        } else {
          lastEscapeAt = 0;
        }
      }
      if (
        event.type === 'keydown' &&
        input &&
        path.includes(input) &&
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        event.keyCode !== 229
      ) {
        event.preventDefault();
        Promise.resolve(core?.sendPrompt?.()).catch(() => {});
      }
      // Keep page-level shortcuts from seeing retargeted Shadow DOM keystrokes.
      // Do not preventDefault for ordinary typing or IME composition.
      event.stopPropagation();
    }

    function onKeydown(event) {
      if (!isAiPanelHotkey(event)) return;
      const path = eventPath(event);
      const insidePanel = path.includes(host);
      if (!insidePanel && isEditableTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    }

    ['keydown', 'keypress', 'keyup'].forEach((type) => global.addEventListener(type, isolatePanelKeyboard, true));
    global.document.addEventListener('keydown', onKeydown, true);
    global.chrome?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AI_PANEL_PING') {
        sendResponse({ ok: true, open: Boolean(host), collapsed: Boolean(layout.collapsed) });
        return false;
      }
      if (message?.type === 'OPEN_AI_PANEL') {
        openPanel().then((ok) => sendResponse({ ok, open: Boolean(host) })).catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }
      if (message?.type === 'TOGGLE_AI_PANEL') {
        togglePanel();
        sendResponse({ ok: true, open: Boolean(host) });
        return false;
      }
      if (message?.type === 'CLOSE_AI_PANEL') {
        closePanel();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });

    global.TabWallAiPanelRuntime = {
      open: openPanel,
      close: closePanel,
      toggle: togglePanel,
      normalizeLayout,
      isAiPanelHotkey,
    };
  }

  global.TabWallAiPanel = {
    HOST_ID,
    LAYOUT_KEY,
    MIN_WIDTH,
    MAX_WIDTH,
    FAB_SIZE,
    MIN_HEIGHT,
    DEFAULT_HEIGHT,
    DOUBLE_ESCAPE_WINDOW_MS,
    isAiPanelHotkey,
    isEditableTarget,
    isAiPanelKeyboardEvent,
    isDoubleEscapePress,
    shouldMinimizeOnEscape,
    normalizeLayout,
    viewportSize,
  };

  if (global.document) install();
})(typeof self !== 'undefined' ? self : globalThis);
