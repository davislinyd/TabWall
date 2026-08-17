/**
 * TabWall parkStickerUi — TabWallStickerUi.
 * bind(env) using explicit live getters/setters from park.js.
 * Access park bindings via env.* only — no eval, no with-statement (MV3 CSP safe).
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>|null} */
  let env = null;

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    env = next;
  }

  function ensureBound(name) {
    if (!env) throw new Error('TabWallStickerUi.' + name + ' used before bind()');
  }

  function stickerNoteUuid() {
    ensureBound('stickerNoteUuid');

    try {
      if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    } catch {
      // fall through
    }
    return `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      
  }

  function stickerNoteDraftMeta() {
    ensureBound('stickerNoteDraftMeta');

    return env.stickerNoteDraftAttachments.map(({
      blob,
      previewUrl,
      sourceBytes,
      sourceWidth,
      sourceHeight,
      ...attachment
    }) => ({ ...attachment }));
      
  }

  function stickerNoteDraftRecord() {
    ensureBound('stickerNoteDraftRecord');

    const typed = env.stickerNoteTitle?.value?.trim() || env.t('noteUntitled');
    const isEdit = env.stickerNoteContext?.mode === 'edit';
    const original = isEdit
      ? (env.stickerNoteContext.originalTitle || typed)
      : typed;
    const displayTitle = isEdit && typed !== original ? typed : '';
    return {
      kind: 'note',
      id: env.stickerNoteContext?.id || stickerNoteUuid(),
      title: original,
      ...(displayTitle ? { displayTitle } : {}),
      markdown: env.stickerNoteMarkdown?.value || '',
      tags: [...env.stickerNoteTagList],
      pinned: Boolean(env.stickerNoteContext?.pinned),
      savedAt: env.stickerNoteContext?.savedAt || Date.now(),
      attachments: stickerNoteDraftMeta(),
      locked: Boolean(env.stickerNoteLockEnabled?.checked),
    };
      
  }

  function syncStickerNoteLockFields() {
    ensureBound('syncStickerNoteLockFields');
    const locked = Boolean(env.stickerNoteLockEnabled?.checked);
    const typed = String(env.stickerNoteTitle?.value || '').trim();
    const original = String(env.stickerNoteContext?.originalTitle || '').trim();
    const hasCustomDisplayTitle = Boolean(
      env.stickerNoteContext?.mode === 'edit' && typed && typed !== original
    );
    if (env.stickerNoteLockFields) env.stickerNoteLockFields.hidden = !locked;
    if (env.stickerNoteHideOriginalTitle) {
      const canHide = locked && hasCustomDisplayTitle;
      env.stickerNoteHideOriginalTitle.disabled = !canHide;
      if (!canHide) env.stickerNoteHideOriginalTitle.checked = false;
    }
  }

  function renderStickerNoteTags() {
    ensureBound('renderStickerNoteTags');

    if (!env.stickerNoteChips) return;
    env.stickerNoteChips.innerHTML = '';
    for (const tag of env.stickerNoteTagList) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `#${tag}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', env.t('delete'));
      remove.innerHTML = env.iconSvg('close');
      remove.addEventListener('click', () => {
        env.stickerNoteTagList = env.stickerNoteTagList.filter((value) => value !== tag);
        renderStickerNoteTags();
      });
      chip.appendChild(remove);
      env.stickerNoteChips.appendChild(chip);
    }
      
  }

  function setStickerNoteMediaStatus(message = '', isError = false) {
    ensureBound('setStickerNoteMediaStatus');

    if (!env.stickerNoteMediaStatus) return;
    env.stickerNoteMediaStatus.textContent = message;
    env.stickerNoteMediaStatus.classList.toggle('error', Boolean(isError));
      
  }

  function setStickerNoteMediaBusy(busy) {
    ensureBound('setStickerNoteMediaBusy');

    env.stickerNoteMediaBusy = Boolean(busy);
    if (env.stickerNoteSave) env.stickerNoteSave.disabled = env.stickerNoteMediaBusy;
    if (env.stickerNoteDrop) env.stickerNoteDrop.toggleAttribute('aria-busy', env.stickerNoteMediaBusy);
      
  }

  async function refreshStickerNoteUsage() {
    ensureBound('refreshStickerNoteUsage');

    const requestId = ++env.stickerNoteUsageRequest;
    if (!env.stickerNoteContext) return;
    try {
      const usage = await env.sendMessage({
        type: 'GET_ATTACHMENT_USAGE',
        noteId: env.stickerNoteContext.id,
        groupId: env.stickerNoteContext.groupId || '',
      });
      if (requestId !== env.stickerNoteUsageRequest || !usage?.ok) return;
      const draftBytes = env.stickerNoteDraftAttachments.reduce(
        (total, attachment) => total + (attachment.hasData ? Number(attachment.size) || 0 : 0),
        0
      );
      const previousNoteBytes = env.stickerNoteContext.mode === 'edit' ? Number(usage.noteBytes) || 0 : 0;
      const noteBytes = draftBytes;
      const globalBytes = Math.max(0, (Number(usage.usedBytes) || 0) - previousNoteBytes + noteBytes);
      setStickerNoteMediaStatus(env.t('noteImageUsage', {
        used: env.formatNoteBytes(noteBytes),
        noteLimit: env.formatNoteBytes(usage.noteMaxBytes),
        globalUsed: env.formatNoteBytes(globalBytes),
        globalLimit: env.formatNoteBytes(usage.maxBytes),
      }));
    } catch {
      // Usage is advisory; background validation remains authoritative.
    }
      
  }

  function commitStickerNoteTagDraft() {
    ensureBound('commitStickerNoteTagDraft');

    const value = env.stickerNoteTagDraft?.value?.trim();
    if (!value) return;
    if (!env.stickerNoteTagList.includes(value)) env.stickerNoteTagList.push(value);
    env.stickerNoteTagDraft.value = '';
    renderStickerNoteTags();
      
  }

  function renderStickerNotePreview() {
    ensureBound('renderStickerNotePreview');

    if (!env.stickerNotePreview) return;
    const note = stickerNoteDraftRecord();
    env.stickerNotePreview.innerHTML = env.Build?.renderSafeMarkdown
      ? env.Build.renderSafeMarkdown(note.markdown, note.attachments)
      : env.escapeHtml(note.markdown);
    const attachmentMap = new Map(env.stickerNoteDraftAttachments.map((attachment) => [attachment.id, attachment]));
    env.stickerNotePreview.querySelectorAll('[data-attachment-id]').forEach((img) => {
      const attachment = attachmentMap.get(img.dataset.attachmentId);
      if (!attachment) return;
      if (attachment.previewUrl) img.src = attachment.previewUrl;
      else {
        env.fetchMediaUrl(env.Media.mediaKeyNoteAttachment(note.id, attachment.id), 'attachment').then((url) => {
          if (url && img.isConnected) img.src = url;
        });
      }
    });
      
  }

  function renderStickerNoteAttachments() {
    ensureBound('renderStickerNoteAttachments');

    if (!env.stickerNoteAttachments) return;
    env.stickerNoteAttachments.innerHTML = '';
    env.stickerNoteDraftAttachments.forEach((attachment) => {
      const row = document.createElement('div');
      row.className = 'sticker-note-attachment';
      const image = document.createElement('img');
      image.alt = attachment.alt || attachment.name || '';
      image.loading = 'lazy';
      if (attachment.previewUrl) image.src = attachment.previewUrl;
      else env.fetchMediaUrl(env.Media.mediaKeyNoteAttachment(env.stickerNoteContext.id, attachment.id), 'attachment').then((url) => {
        if (url && image.isConnected) image.src = url;
      });
      const name = document.createElement('span');
      name.textContent = attachment.name || 'image';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn danger';
      remove.title = env.t('noteAttachmentDelete');
      remove.setAttribute('aria-label', env.t('noteAttachmentDelete'));
      remove.innerHTML = env.iconSvg('delete');
      remove.addEventListener('click', () => removeStickerNoteAttachment(attachment.id));
      row.append(image, name, remove);
      env.stickerNoteAttachments.appendChild(row);
    });
      
  }

  function refreshStickerNoteEditor() {
    ensureBound('refreshStickerNoteEditor');

    renderStickerNoteTags();
    renderStickerNoteAttachments();
    renderStickerNotePreview();
      
  }

  function removeStickerNoteAttachment(id) {
    ensureBound('removeStickerNoteAttachment');

    const target = env.stickerNoteDraftAttachments.find((attachment) => attachment.id === id);
    if (target?.previewUrl && target.blob) URL.revokeObjectURL(target.previewUrl);
    env.stickerNoteDraftAttachments = env.stickerNoteDraftAttachments.filter((attachment) => attachment.id !== id);
    if (env.stickerNoteMarkdown) {
      const pattern = new RegExp(`!\\[[^\\]\\n]*\\]\\(attachment://${String(id).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\)\\n?`, 'g');
      env.stickerNoteMarkdown.value = env.stickerNoteMarkdown.value.replace(pattern, '');
    }
    refreshStickerNoteEditor();
    refreshStickerNoteUsage();
      
  }

  async function addStickerNoteFiles(files) {
    ensureBound('addStickerNoteFiles');

    const list = [...(files || [])].filter((file) => String(file?.type || '').toLowerCase().startsWith('image/'));
    if (!list.length || env.stickerNoteMediaBusy) return;
    const maxAttachments = env.Build?.LIMITS?.MAX_NOTE_ATTACHMENTS || 12;
    if (env.stickerNoteDraftAttachments.length + list.length > maxAttachments) {
      setStickerNoteMediaStatus(env.t('noteImageTooMany'), true);
      return;
    }
    setStickerNoteMediaBusy(true);
    setStickerNoteMediaStatus(env.t('noteImageNormalizing'));
    const normalizedAttachments = [];
    try {
      if (!env.NoteMedia?.normalizeBlob) throw new Error('note_media_unavailable');
      for (const file of list) {
        const normalized = await env.NoteMedia.normalizeBlob(file);
        const id = stickerNoteUuid();
        const name = String(file.name || 'image').slice(0, 512);
        normalizedAttachments.push({
          id,
          name,
          alt: name.slice(0, 2048),
          mime: normalized.mime,
          size: normalized.size,
          width: normalized.width,
          height: normalized.height,
          hasData: true,
          sourceBytes: Number(file.size) || 0,
          sourceWidth: normalized.sourceWidth,
          sourceHeight: normalized.sourceHeight,
          blob: normalized.blob,
          previewUrl: URL.createObjectURL(normalized.blob),
        });
      }
    } catch (err) {
      normalizedAttachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      setStickerNoteMediaStatus(env.formatNoteMediaError(err), true);
      setStickerNoteMediaBusy(false);
      return;
    }
    normalizedAttachments.forEach((attachment) => {
      env.stickerNoteDraftAttachments.push(attachment);
      const token = `![${String(attachment.alt || attachment.name).replace(/[\]\n]/g, '')}](attachment://${attachment.id})`;
      const textarea = env.stickerNoteMarkdown;
      const start = textarea?.selectionStart ?? textarea?.value?.length ?? 0;
      const end = textarea?.selectionEnd ?? start;
      if (textarea) {
        textarea.value = `${textarea.value.slice(0, start)}${token}\n${textarea.value.slice(end)}`;
        textarea.setSelectionRange(start + token.length + 1, start + token.length + 1);
      }
    });
    setStickerNoteMediaBusy(false);
    setStickerNoteMediaStatus('');
    refreshStickerNoteEditor();
    refreshStickerNoteUsage();
      
  }

  function openStickerNoteEditor(note = null, { groupId = '', position = null } = {}) {
    ensureBound('openStickerNoteEditor');

    if (!env.stickerNoteBox) return;
    env.closeAllFloatsExcept('stickerNote');
    const source = note ? env.normalizeNoteProjection(note) : {
      kind: 'note',
      id: stickerNoteUuid(),
      title: env.t('noteUntitled'),
      markdown: '',
      tags: [],
      pinned: false,
      savedAt: Date.now(),
      attachments: [],
    };
    env.stickerNoteContext = {
      mode: note ? 'edit' : 'create',
      id: source.id,
      groupId,
      position,
      pinned: Boolean(source.pinned),
      savedAt: source.savedAt,
      originalTitle: source.title || env.t('noteUntitled'),
      hasPassword: Boolean(source.lockHash),
    };
    env.stickerNoteTagList = [...(source.tags || [])];
    env.stickerNoteDraftAttachments = (source.attachments || []).map((attachment) => ({
      ...attachment,
      blob: null,
      previewUrl: '',
    }));
    env.stickerNoteTitle.value = (source.displayTitle || source.title || env.t('noteUntitled'));
    if (env.stickerNoteLockEnabled) env.stickerNoteLockEnabled.checked = Boolean(source.locked);
    if (env.stickerNoteHideOriginalTitle) {
      env.stickerNoteHideOriginalTitle.checked = Boolean(source.locked && source.displayTitle && source.hideOriginalTitle);
    }
    if (env.stickerNoteLockPassword) env.stickerNoteLockPassword.value = '';
    if (env.stickerNoteLockPasswordConfirm) env.stickerNoteLockPasswordConfirm.value = '';
    syncStickerNoteLockFields();
    env.stickerNoteMarkdown.value = source.markdown || '';
    env.stickerNoteTagDraft.value = '';
    setStickerNoteMediaBusy(false);
    setStickerNoteMediaStatus('');
    refreshStickerNoteEditor();
    env.stickerNoteBox.classList.add('open');
    env.stickerNoteBox.setAttribute('aria-hidden', 'false');
    env.stickerNoteBox.style.left = `${Math.max(16, Math.round((window.innerWidth - (env.stickerNoteBox.offsetWidth || 860)) / 2))}px`;
    env.stickerNoteBox.style.top = `${Math.max(16, Math.round((window.innerHeight - (env.stickerNoteBox.offsetHeight || 600)) / 2))}px`;
    env.syncFloatBackdrop();
    refreshStickerNoteUsage();
    setTimeout(() => env.stickerNoteTitle?.focus(), 0);
      
  }

  function closeStickerNoteEditor() {
    ensureBound('closeStickerNoteEditor');

    if (!env.stickerNoteBox) return;
    const wasPlacement = env.stickerNoteContext?.mode === 'create';
    env.stickerNoteDraftAttachments.forEach((attachment) => {
      if (attachment.blob && attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
    env.stickerNoteDraftAttachments = [];
    env.stickerNoteTagList = [];
    env.stickerNoteContext = null;
    env.stickerNoteUsageRequest++;
    setStickerNoteMediaBusy(false);
    setStickerNoteMediaStatus('');
    env.stickerNoteBox.classList.remove('open');
    env.stickerNoteBox.setAttribute('aria-hidden', 'true');
    if (wasPlacement) env.resetCanvasNotePlacement();
    env.syncFloatBackdrop();
      
  }

  async function saveStickerNote() {
    ensureBound('saveStickerNote');

    if (!env.stickerNoteContext || env.stickerNoteMediaBusy) return;
    commitStickerNoteTagDraft();
    const note = stickerNoteDraftRecord();
    const lockPatch = await env.collectLockPatchFromFields?.({
      locked: Boolean(env.stickerNoteLockEnabled?.checked),
      hideOriginalTitle: Boolean(env.stickerNoteHideOriginalTitle?.checked),
      password: env.stickerNoteLockPassword?.value || '',
      confirm: env.stickerNoteLockPasswordConfirm?.value || '',
      hasPassword: Boolean(env.stickerNoteContext?.hasPassword),
    });
    if (lockPatch?.error) {
      setStickerNoteMediaStatus(env.t(lockPatch.error), true);
      return;
    }
    if (lockPatch) Object.assign(note, lockPatch);
    const writtenKeys = [];
    try {
      for (const attachment of env.stickerNoteDraftAttachments) {
        if (!attachment.blob) continue;
        const key = env.Media.mediaKeyNoteAttachment(note.id, attachment.id);
        await env.Media.putAttachment(key, attachment.blob);
        writtenKeys.push(key);
      }
      const res = env.stickerNoteContext.mode === 'create'
        ? await env.sendMessage({ type: 'CREATE_NOTE', note, position: env.stickerNoteContext.position })
        : await env.sendMessage({
            type: 'UPDATE_NOTE',
            noteId: note.id,
            groupId: env.stickerNoteContext.groupId,
            patch: note,
          });
      if (!res?.ok) throw new Error(res?.error || 'note_save_failed');
      closeStickerNoteEditor();
      await env.loadList();
    } catch (err) {
      if (writtenKeys.length) await env.Media.removeMany(writtenKeys).catch(() => {});
      console.warn('[TabWall] sticker note save failed:', err);
      const message = err?.message === 'attachment_quota_exceeded'
        ? env.t('noteImageQuotaExceeded')
        : env.t('editFailed');
      setStickerNoteMediaStatus(message, true);
      env.showCopyToast(message);
    }
      
  }

  function placeStickerNoteAt(point) {
    ensureBound('placeStickerNoteAt');

    env.resetCanvasNotePlacement();
    openStickerNoteEditor(null, { position: point });
      
  }

  global.TabWallStickerUi = {
    bind,
    stickerNoteUuid,
    stickerNoteDraftMeta,
    stickerNoteDraftRecord,
    syncStickerNoteLockFields,
    renderStickerNoteTags,
    setStickerNoteMediaStatus,
    setStickerNoteMediaBusy,
    refreshStickerNoteUsage,
    commitStickerNoteTagDraft,
    renderStickerNotePreview,
    renderStickerNoteAttachments,
    refreshStickerNoteEditor,
    removeStickerNoteAttachment,
    addStickerNoteFiles,
    openStickerNoteEditor,
    closeStickerNoteEditor,
    saveStickerNote,
    placeStickerNoteAt
  };
})(typeof self !== 'undefined' ? self : globalThis);
