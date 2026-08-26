/**
 * TabWall page Sticker editor host.
 * Runs in the extension-origin editor iframe mounted over the current page.
 */
(function (global) {
  'use strict';

  const box = document.getElementById('stickerNoteBox');
  if (!box || !global.TabWallStickerUi) return;

  const dom = {
    stickerNoteBox: box,
    stickerNoteDrag: document.getElementById('stickerNoteDrag'),
    stickerNoteTitle: document.getElementById('stickerNoteTitle'),
    stickerNoteLockEnabled: document.getElementById('stickerNoteLockEnabled'),
    stickerNoteLockFields: document.getElementById('stickerNoteLockFields'),
    stickerNoteHideOriginalTitle: document.getElementById('stickerNoteHideOriginalTitle'),
    stickerNoteLockPassword: document.getElementById('stickerNoteLockPassword'),
    stickerNoteLockPasswordConfirm: document.getElementById('stickerNoteLockPasswordConfirm'),
    stickerNoteMarkdown: document.getElementById('stickerNoteMarkdown'),
    stickerNoteModeMarkdown: document.getElementById('stickerNoteModeMarkdown'),
    stickerNoteModeWeb: document.getElementById('stickerNoteModeWeb'),
    stickerNoteMarkdownPane: document.getElementById('stickerNoteMarkdownPane'),
    stickerNoteWebPane: document.getElementById('stickerNoteWebPane'),
    stickerNoteWebSource: document.getElementById('stickerNoteWebSource'),
    stickerNoteCodePreview: document.getElementById('stickerNoteCodePreview'),
    stickerNoteCodeStatus: document.getElementById('stickerNoteCodeStatus'),
    stickerNoteCodePreviewPane: document.getElementById('stickerNoteCodePreviewPane'),
    stickerNoteCodePreviewFrame: document.getElementById('stickerNoteCodePreviewFrame'),
    stickerNoteCodePreviewHint: document.getElementById('stickerNoteCodePreviewHint'),
    stickerNotePreview: document.getElementById('stickerNotePreview'),
    stickerNoteFile: document.getElementById('stickerNoteFile'),
    stickerNoteAttachments: document.getElementById('stickerNoteAttachments'),
    stickerNoteMediaStatus: document.getElementById('stickerNoteMediaStatus'),
    stickerNoteDrop: document.getElementById('stickerNoteDrop'),
    stickerNoteSave: document.getElementById('stickerNoteSave'),
    stickerNoteCancel: document.getElementById('stickerNoteCancel'),
    stickerNoteCloseX: document.getElementById('stickerNoteCloseX'),
    stickerNoteChips: document.getElementById('stickerNoteChips'),
    stickerNoteTagDraft: document.getElementById('stickerNoteTagDraft'),
  };

  const locale = /zh/i.test(navigator.language || '') ? 'zh' : 'en';
  const catalog = global.TabWallI18n?.[locale] || global.TabWallI18n?.en || {};
  const state = {
    sessionId: '',
    parentOrigin: '',
    context: null,
    draftAttachments: [],
    mediaBusy: false,
    tagList: [],
    usageRequest: 0,
  };
  const attachmentUrls = new Map();

  function t(key, vars = {}) {
    let value = catalog[key] || key;
    for (const [name, replacement] of Object.entries(vars || {})) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
    });
  }

  function sendMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          resolve(chrome.runtime.lastError
            ? { ok: false, error: chrome.runtime.lastError.message }
            : (response || { ok: false, error: 'empty_response' }));
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function normalizeNoteProjection(item) {
    const source = item && typeof item === 'object' ? item : {};
    return {
      ...source,
      kind: 'note',
      title: typeof source.title === 'string' && source.title ? source.title : t('noteUntitled'),
      markdown: typeof source.markdown === 'string' ? source.markdown : '',
      contentMode: source.contentMode === 'web' ? 'web' : 'markdown',
      webSource: typeof source.webSource === 'string' ? source.webSource : '',
      pinned: Boolean(source.pinned),
      savedAt: Number(source.savedAt) || Date.now(),
      tags: Array.isArray(source.tags) ? source.tags : [],
      attachments: Array.isArray(source.attachments) ? source.attachments : [],
    };
  }

  function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = String(value || '');
    return node.innerHTML;
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${Math.round(bytes)} B`;
  }

  function formatMediaError(error) {
    const code = typeof error === 'string' ? error : error?.code || error?.message || '';
    const key = {
      note_image_source_too_large: 'noteImageSourceTooLarge',
      note_image_decode_too_large: 'noteImageDecodeTooLarge',
      note_image_output_too_large: 'noteImageOutputTooLarge',
      note_image_too_many: 'noteImageTooMany',
      attachment_quota_exceeded: 'noteImageQuotaExceeded',
      note_image_unsupported_type: 'noteImageUnsupportedType',
      note_image_heic_unsupported: 'noteImageHeicUnsupported',
      note_image_svg_unsupported: 'noteImageSvgUnsupported',
    }[code];
    return t(key || 'noteImageInvalid');
  }

  function postToParent(payload) {
    if (window.parent === window || !state.sessionId) return false;
    const type = payload?.type === 'TABWALL_PAGE_STICKER_SAVED'
      ? 'TABWALL_PAGE_STICKER_EDITOR_SAVED'
      : payload?.type === 'TABWALL_PAGE_STICKER_CANCEL'
        ? 'TABWALL_PAGE_STICKER_EDITOR_CANCELLED'
        : payload?.type;
    window.parent.postMessage({
      ...payload,
      type,
      sessionId: state.sessionId,
    }, state.parentOrigin || '*');
    return true;
  }

  function setStatus(message, isError = false) {
    dom.stickerNoteMediaStatus.textContent = message || '';
    dom.stickerNoteMediaStatus.classList.toggle('error', Boolean(isError));
  }

  function showCopyToast(message) {
    setStatus(message, true);
  }

  async function fetchMediaUrl(key) {
    if (!key) return '';
    if (attachmentUrls.has(key)) return attachmentUrls.get(key) || '';
    try {
      const blob = await global.TabWallMediaDB.getAttachment(key);
      if (!blob) return '';
      const url = URL.createObjectURL(blob);
      attachmentUrls.set(key, url);
      return url;
    } catch {
      return '';
    }
  }

  function bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(hex) {
    const clean = String(hex || '');
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  async function collectLockPatchFromFields({ locked, password, confirm, hasPassword, hideOriginalTitle } = {}) {
    const hide = Boolean(hideOriginalTitle);
    if (!locked) return { locked: false, hideOriginalTitle: false };
    const pw = String(password || '');
    const confirmPw = String(confirm || '');
    if (pw || confirmPw) {
      if (pw !== confirmPw) return { error: 'lockPasswordMismatch' };
      if (!pw) return { locked: true, hideOriginalTitle: hide, lockSalt: '', lockHash: '' };
      const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const encoded = new TextEncoder().encode(pw);
      const saltBytes = hexToBytes(salt);
      const payload = new Uint8Array(saltBytes.length + 1 + encoded.length);
      payload.set(saltBytes, 0);
      payload[saltBytes.length] = 0;
      payload.set(encoded, saltBytes.length + 1);
      const digest = await crypto.subtle.digest('SHA-256', payload);
      return {
        locked: true,
        hideOriginalTitle: hide,
        lockSalt: salt,
        lockHash: bytesToHex(new Uint8Array(digest)),
      };
    }
    if (hasPassword) return { locked: true, hideOriginalTitle: hide };
    return { locked: true, hideOriginalTitle: hide, lockSalt: '', lockHash: '' };
  }

  const editorEnv = {
    ...dom,
    Build: global.TabWallBackupBuild,
    Media: global.TabWallMediaDB,
    NoteMedia: global.TabWallNoteMedia,
    t,
    sendMessage,
    escapeHtml,
    fetchMediaUrl,
    formatNoteBytes: formatBytes,
    formatNoteMediaError: formatMediaError,
    normalizeNoteProjection,
    collectLockPatchFromFields,
    iconSvg: () => '×',
    closeAllFloatsExcept: () => {},
    resetCanvasNotePlacement: () => {},
    syncFloatBackdrop: () => {},
    loadList: async () => {},
    showCopyToast,
    get stickerNoteContext() { return state.context; },
    set stickerNoteContext(value) { state.context = value; },
    get stickerNoteDraftAttachments() { return state.draftAttachments; },
    set stickerNoteDraftAttachments(value) { state.draftAttachments = value; },
    get stickerNoteMediaBusy() { return state.mediaBusy; },
    set stickerNoteMediaBusy(value) { state.mediaBusy = Boolean(value); },
    get stickerNoteTagList() { return state.tagList; },
    set stickerNoteTagList(value) { state.tagList = value; },
    get stickerNoteUsageRequest() { return state.usageRequest; },
    set stickerNoteUsageRequest(value) { state.usageRequest = Number(value) || 0; },
    postToParent,
  };

  function closeEditorWithoutNotify() {
    global.TabWallStickerUi.closeStickerNoteEditor({ notifyPage: false });
    for (const url of attachmentUrls.values()) URL.revokeObjectURL(url);
    attachmentUrls.clear();
  }

  function handleInit(data, event) {
    if (event.source !== window.parent || !data?.sessionId) return;
    const expectedParentOrigin = typeof data.parentOrigin === 'string' ? data.parentOrigin : '';
    if (expectedParentOrigin && event.origin !== expectedParentOrigin) return;
    if (state.context && state.sessionId === String(data.sessionId)) return;
    state.sessionId = String(data.sessionId);
    state.parentOrigin = expectedParentOrigin;
    try {
      global.TabWallStickerUi.openStickerNoteEditor(
        data.note ? normalizeNoteProjection(data.note) : null,
        {
          pageUrl: data.url || '',
          pagePlacement: data.placement || null,
        },
      );
      postToParent({ type: 'TABWALL_PAGE_STICKER_EDITOR_READY', url: data.url || '', noteId: data.note?.id || '' });
    } catch (err) {
      postToParent({ type: 'TABWALL_PAGE_STICKER_EDITOR_ERROR', message: String(err?.message || err) });
    }
  }

  function bindEvents() {
    dom.stickerNoteTitle.addEventListener('input', () => {
      global.TabWallStickerUi.renderStickerNotePreview();
      global.TabWallStickerUi.syncStickerNoteLockFields();
    });
    dom.stickerNoteMarkdown.addEventListener('input', () => global.TabWallStickerUi.renderStickerNotePreview());
    dom.stickerNoteModeMarkdown.addEventListener('click', () => global.TabWallStickerUi.setStickerNoteContentMode('markdown'));
    dom.stickerNoteModeWeb.addEventListener('click', () => global.TabWallStickerUi.setStickerNoteContentMode('web'));
    dom.stickerNoteWebSource.addEventListener('input', () => global.TabWallStickerUi.markStickerNoteCodeDirty());
    dom.stickerNoteCodePreview.addEventListener('click', () => global.TabWallStickerUi.runStickerNoteCodePreview());
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === 'TABWALL_PAGE_STICKER_EDITOR_INIT') {
        handleInit(event.data, event);
        return;
      }
      if (event.data?.type === 'TABWALL_PAGE_STICKER_EDITOR_CLOSE'
        && event.data.sessionId === state.sessionId) {
        closeEditorWithoutNotify();
      }
      global.TabWallStickerUi.handleStickerNoteCodeMessage?.(event);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      global.TabWallStickerUi.closeStickerNoteEditor();
    });
    dom.stickerNoteTagDraft.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === 'Tab') && dom.stickerNoteTagDraft.value.trim()) {
        event.preventDefault();
        global.TabWallStickerUi.commitStickerNoteTagDraft();
      }
      if (event.key === 'Backspace' && !dom.stickerNoteTagDraft.value && state.tagList.length) {
        state.tagList.pop();
        global.TabWallStickerUi.renderStickerNoteTags();
      }
    });
    dom.stickerNoteFile.addEventListener('change', () => global.TabWallStickerUi.addStickerNoteFiles(dom.stickerNoteFile.files));
    dom.stickerNoteDrop.addEventListener('click', () => dom.stickerNoteFile.click());
    dom.stickerNoteDrop.addEventListener('dragover', (event) => event.preventDefault());
    dom.stickerNoteDrop.addEventListener('drop', (event) => {
      event.preventDefault();
      global.TabWallStickerUi.addStickerNoteFiles(event.dataTransfer?.files || []);
    });
    dom.stickerNoteMarkdown.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.files || [])].filter((file) => String(file.type || '').startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      global.TabWallStickerUi.addStickerNoteFiles(files);
    });
    dom.stickerNoteMarkdown.addEventListener('dragover', (event) => event.preventDefault());
    dom.stickerNoteMarkdown.addEventListener('drop', (event) => {
      event.preventDefault();
      global.TabWallStickerUi.addStickerNoteFiles(event.dataTransfer?.files || []);
    });
    dom.stickerNoteLockEnabled.addEventListener('change', () => global.TabWallStickerUi.syncStickerNoteLockFields());
    dom.stickerNoteSave.addEventListener('click', () => global.TabWallStickerUi.saveStickerNote());
    dom.stickerNoteCancel.addEventListener('click', () => global.TabWallStickerUi.closeStickerNoteEditor());
    dom.stickerNoteCloseX.addEventListener('click', () => global.TabWallStickerUi.closeStickerNoteEditor());
  }

  applyI18n();
  global.TabWallStickerUi.bind(editorEnv);
  bindEvents();
  window.parent?.postMessage({ type: 'TABWALL_PAGE_STICKER_EDITOR_LOADED' }, '*');
})(typeof self !== 'undefined' ? self : globalThis);
