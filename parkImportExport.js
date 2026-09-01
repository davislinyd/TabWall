/**
 * TabWall parkImportExport — TabWallImportExport.
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
    if (!env) throw new Error('TabWallImportExport.' + name + ' used before bind()');
  }

  function formatImportWarnings(warnings) {
    ensureBound('formatImportWarnings');

    const parts = [];
    if (warnings?.legacyVersion) {
      parts.push(env.t('backupLegacyNotice', { version: warnings.legacyVersion }));
    }
    if (warnings?.normalizedGroupColors) {
      parts.push(env.t('backupColorNotice', { n: warnings.normalizedGroupColors }));
    }
    if (warnings?.droppedFavicons) {
      parts.push(env.t('backupFaviconNotice', { n: warnings.droppedFavicons }));
    }
    if (warnings?.storedOnlyUrls) {
      parts.push(env.t('backupStoredOnly', { n: warnings.storedOnlyUrls }));
    }
    return parts.join(' ');
      
  }

  function backupErrorCode(error) {
    if (typeof error === 'string') return error;
    return error?.code || error?.error || error?.message || 'invalid_backup';
  }

  function backupErrorDetail(error) {
    if (!error || typeof error !== 'object') return '';
    return typeof error.detail === 'string' ? error.detail.slice(0, 800) : '';
  }

  function formatBackupErrorLog(error) {
    const code = backupErrorCode(error);
    const phase = error && typeof error === 'object' && error.phase ? `phase=${error.phase}` : '';
    const detail = backupErrorDetail(error);
    return [`code=${code}`, phase, detail].filter(Boolean).join(' ');
  }

  function formatBackupError(error) {
    ensureBound('formatBackupError');

    const code = backupErrorCode(error);
    const detail = backupErrorDetail(error);
    let base = '';
    if (code === 'backup_too_large:full_zip') base = env.t('backupFullTooLarge');
    else if (code === 'missing_media') base = env.t('backupMissingMedia');
    if (code === 'attachment_quota_exceeded') {
      return `${env.t('noteImageQuotaExceeded')}${detail ? ` (${detail})` : ''}`;
    }
    else if (code === 'build_failed' || error?.phase === 'build') base = env.t('backupBuildFailed');
    else if (!base) return env.t('backupInvalidDetail', {
      error: `${code}${detail ? ` (${detail})` : ''}`,
    });
    return `${base}${detail ? ` (${detail})` : ''}`;
      
  }

  function downloadBlob(blob, filename) {
    ensureBound('downloadBlob');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
      
  }

  async function runLocalAutoBackup({ force = false } = {}) {
    ensureBound('runLocalAutoBackup');

    if (env.autoBackupLocalRunning) return { ok: false, error: 'busy' };
    const ab = env.normalizeAutoBackup(env.settings.autoBackup);
    if (!force && !ab.enabled) return { ok: false, error: 'disabled' };
      
    env.autoBackupLocalRunning = true;
    if (env.autoBackupStatusEl) env.autoBackupStatusEl.textContent = env.t('autoBackupRunning');
    try {
      const res = await env.sendMessage({
        type: 'AUTO_BACKUP_RUN',
        // Manual "Backup now" may force even if the toggle is off; catch-up
        // must not force or it bypasses lastSuccessAt / dirtyAt dedupe.
        force: Boolean(force),
        reason: force ? 'manual' : 'local',
      });
      env.settings = await env.loadSettings();
      env.syncAutoBackupUi();
      if (res?.skipped) return res;
      if (res?.ok) {
        if (env.autoBackupStatusEl) {
          env.autoBackupStatusEl.textContent = env.t('autoBackupOk', {
            file: res.filename || res.absoluteFile || ab.subfolder,
          });
        }
        return res;
      }
      const err = res?.error || 'write_failed';
      if (env.autoBackupStatusEl) {
        env.autoBackupStatusEl.textContent = env.autoBackupErrorText(err, res?.detail);
      }
      return { ok: false, error: err, detail: res?.detail || '', phase: res?.phase || '' };
    } finally {
      env.autoBackupLocalRunning = false;
    }
      
  }

  async function maybeCatchUpAutoBackup() {
    ensureBound('maybeCatchUpAutoBackup');

    const ab = env.normalizeAutoBackup(env.settings.autoBackup);
    if (!ab.enabled) return;
    // park.html is the New Tab page — let the Service Worker decide whether
    // today's local-time schedule is overdue.
    // First-enable is held back by the background gate.
    if (!ab.lastSuccessAt) return;
    await runLocalAutoBackup({ force: false });
      
  }

  async function mapWithConcurrencyLocal(values, limit, mapper) {
    ensureBound('mapWithConcurrencyLocal');

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
    ensureBound('hydrateItemMediaLocal');

    if (!item) return item;
    if (item.kind === 'group') {
      const tabs = await mapWithConcurrencyLocal(item.tabs || [], 4, async (m) => {
        const key = env.mediaKeyForMember(item.id, m.id);
        let thumb = '';
        let snap = '';
        try {
          if (env.Media) {
            const row = await env.Media.get(key);
            if (row?.thumb) thumb = await env.Media.blobToDataUrl(row.thumb);
            if (row?.snap) snap = await env.Media.blobToDataUrl(row.snap);
          }
        } catch (err) {
          env.uiLog('warn', 'export', 'media get failed', `${key} ${err?.message || err}`);
        }
        return { ...m, thumbnail: thumb, snapshot: snap };
      });
      const notes = await mapWithConcurrencyLocal(item.notes || [], 4, async (note) => ({
        ...note,
        attachments: await mapWithConcurrencyLocal(note.attachments || [], 4, async (attachment) => {
          let data = '';
          try {
            const blob = await env.Media?.getAttachment?.(env.Media.mediaKeyNoteAttachment(note.id, attachment.id));
            if (blob) data = await env.Media.blobToDataUrl(blob);
          } catch (err) {
            env.uiLog('warn', 'export', 'attachment get failed', `${note.id}/${attachment.id} ${err?.message || err}`);
          }
          return { ...attachment, data, hasData: Boolean(data) || attachment.hasData === true };
        }),
      }));
      return { ...item, tabs, notes };
    }
    if (item.kind === 'note') {
      const attachments = await mapWithConcurrencyLocal(item.attachments || [], 4, async (attachment) => {
        let data = '';
        try {
          const blob = await env.Media?.getAttachment?.(env.Media.mediaKeyNoteAttachment(item.id, attachment.id));
          if (blob) data = await env.Media.blobToDataUrl(blob);
        } catch (err) {
          env.uiLog('warn', 'export', 'attachment get failed', `${item.id}/${attachment.id} ${err?.message || err}`);
        }
        return { ...attachment, data, hasData: Boolean(data) || attachment.hasData === true };
      });
      return { ...item, attachments };
    }
    const key = env.mediaKeyForItem(item);
    let thumbnail = '';
    let snapshot = '';
    try {
      if (env.Media && key) {
        const row = await env.Media.get(key);
        if (row?.thumb) thumbnail = await env.Media.blobToDataUrl(row.thumb);
        if (row?.snap) snapshot = await env.Media.blobToDataUrl(row.snap);
      }
    } catch (err) {
      env.uiLog('warn', 'export', 'media get failed', `${key} ${err?.message || err}`);
    }
    return { ...item, thumbnail, snapshot };
      
  }

  async function estimateFullBackupMediaBytes(items) {
    ensureBound('estimateFullBackupMediaBytes');

    const sizeOf = (blob, fallback = 0) => {
      const size = Number(blob?.size);
      return Number.isFinite(size) && size >= 0 ? size : fallback;
    };
    const estimateItem = async (item) => {
      if (item.kind === 'group') {
        const tabBytes = await mapWithConcurrencyLocal(item.tabs || [], 4, async (member) => {
          let row = null;
          try {
            row = await env.Media?.get?.(env.mediaKeyForMember(item.id, member.id));
          } catch {
            row = null;
          }
          return sizeOf(row?.thumb) + sizeOf(row?.snap);
        });
        const noteBytes = await mapWithConcurrencyLocal(item.notes || [], 4, async (note) => {
          const values = await mapWithConcurrencyLocal(note.attachments || [], 4, async (attachment) => {
            let blob = null;
            try {
              blob = await env.Media?.getAttachment?.(env.Media.mediaKeyNoteAttachment(note.id, attachment.id));
            } catch {
              blob = null;
            }
            return sizeOf(blob, attachment.hasData ? Number(attachment.size) || 0 : 0);
          });
          return values.reduce((total, size) => total + size, 0);
        });
        return tabBytes.reduce((total, size) => total + size, 0)
          + noteBytes.reduce((total, size) => total + size, 0);
      }
      if (item.kind === 'note') {
        const values = await mapWithConcurrencyLocal(item.attachments || [], 4, async (attachment) => {
          let blob = null;
          try {
            blob = await env.Media?.getAttachment?.(env.Media.mediaKeyNoteAttachment(item.id, attachment.id));
          } catch {
            blob = null;
          }
          return sizeOf(blob, attachment.hasData ? Number(attachment.size) || 0 : 0);
        });
        return values.reduce((total, size) => total + size, 0);
      }
      let row = null;
      try {
        row = await env.Media?.get?.(env.mediaKeyForItem(item));
      } catch {
        row = null;
      }
      return sizeOf(row?.thumb) + sizeOf(row?.snap);
    };
    const values = await mapWithConcurrencyLocal(items, 4, estimateItem);
    let wallpaperBytes = 0;
    if (env.Wallpaper?.blobSize) {
      try {
        wallpaperBytes = Number(await env.Wallpaper.blobSize()) || 0;
      } catch {
        wallpaperBytes = 0;
      }
    }
    return values.reduce((total, size) => total + size, 0) + wallpaperBytes;
      
  }

  async function exportLiteBackup({ toast = false } = {}) {
    ensureBound('exportLiteBackup');

    if (env.backupStatus) env.backupStatus.textContent = env.t('backupExporting');
    env.uiLog('info', 'export', 'lite start', 'phase=export');
    try {
      const res = await env.sendMessage({ type: 'EXPORT_BACKUP', mode: 'lite' });
      if (!res.ok || !res.backup) {
      const err = res?.error || 'export_failed';
      env.uiLog('error', 'export', 'lite failed', formatBackupErrorLog(res));
      const errorText = formatBackupError(res);
      if (env.backupStatus) env.backupStatus.textContent = `${env.t('backupError')}: ${errorText}`;
      if (toast) env.showCopyToast(`${env.t('backupError')}: ${errorText}`);
      return { ok: false, error: err, detail: res?.detail || '', phase: res?.phase || '' };
      }
      const { blob, filename } = env.Build.buildLiteBlob(res.backup, { auto: false });
      downloadBlob(blob, filename);
      env.uiLog('info', 'export', 'lite ok', `phase=download file=${filename} bytes=${blob.size}`);
      if (env.backupStatus) env.backupStatus.textContent = env.t('backupExported');
      if (toast) env.showCopyToast(env.t('backupExported'));
      return { ok: true, filename };
    } catch (err) {
      env.uiLog('error', 'export', 'lite exception', formatBackupErrorLog(err));
      const errorText = formatBackupError(err);
      if (env.backupStatus) env.backupStatus.textContent = `${env.t('backupError')}: ${errorText}`;
      if (toast) env.showCopyToast(`${env.t('backupError')}: ${errorText}`);
      return { ok: false, error: backupErrorCode(err), detail: backupErrorDetail(err), phase: err?.phase || 'build' };
    }
      
  }

  function closeImportPickBox(sync = true) {
    ensureBound('closeImportPickBox');

    if (!env.importPickBox) return;
    closeImportPreview();
    env.importPickBox.classList.remove('open');
    env.importPickBox.setAttribute('aria-hidden', 'true');
    env.pendingImportPick = null;
    if (env.importPickList) env.importPickList.innerHTML = '';
    if (env.importPickStatus) env.importPickStatus.textContent = '';
    if (sync) env.syncFloatBackdrop();
      
  }

  function updateImportPickCount() {
    ensureBound('updateImportPickCount');

    if (!env.pendingImportPick || !env.importPickCount) return;
    const total = (env.pendingImportPick.backup.parkedItems || []).length;
    const n = env.pendingImportPick.selected.size;
    env.importPickCount.textContent = env.t('importPickCount', { n, total });
      
  }

  function pickImportImageDataUrl(item) {
    ensureBound('pickImportImageDataUrl');

    if (!item || typeof item !== 'object') return '';
    for (const key of ['snapshot', 'thumbnail']) {
      const v = item[key];
      if (typeof v === 'string' && v.startsWith('data:')) return v;
    }
    const attachment = item?.kind === 'note' ? item.attachments?.find((value) => typeof value?.data === 'string' && value.data.startsWith('data:')) : null;
    if (attachment?.data) return attachment.data;
    return '';
      
  }

  function newImportStageId() {
    ensureBound('newImportStageId');

    try {
      if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    } catch {
      // fall through to a local opaque id
    }
    return `stage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      
  }

  async function stageImportMedia(stageId, items) {
    ensureBound('stageImportMedia');

    if (!env.Media?.dataUrlToBlob || !env.Media?.putImportStage) {
      throw new Error('import_stage_unavailable');
    }
    const rows = [];
    const normalizeImportedAttachment = async (rawAttachment) => {
      const attachment = { ...rawAttachment };
      if (!attachment.data) {
        if (attachment.hasData === true) throw new Error('import_missing_media');
        attachment.hasData = false;
        attachment.data = '';
        return { attachment, blob: null };
      }
      const sourceBlob = env.Media.dataUrlToBlob(attachment.data);
      if (!sourceBlob) throw new Error('invalid_image');
      if (!env.NoteMedia?.normalizeBlob) throw new Error('note_media_unavailable');
      const normalized = await env.NoteMedia.normalizeBlob(sourceBlob);
      Object.assign(attachment, {
        mime: normalized.mime,
        size: normalized.size,
        width: normalized.width,
        height: normalized.height,
        hasData: true,
        data: '',
      });
      return { attachment, blob: normalized.blob };
    };
    const stagedItems = [];
    for (const raw of (Array.isArray(items) ? items : [])) {
      const item = { ...raw };
      const stageOwner = (owner, mediaKey) => {
        const thumb = owner.thumbnail ? env.Media.dataUrlToBlob(owner.thumbnail) : null;
        const snap = owner.snapshot ? env.Media.dataUrlToBlob(owner.snapshot) : null;
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
          stageOwner(member, env.Media.mediaKeyMember(item.id, member.id));
          return member;
        });
        const sourceNotes = Array.isArray(item.notes) ? item.notes : [];
        item.notes = [];
        for (const rawNote of sourceNotes) {
          const note = { ...rawNote };
          note.attachments = [];
          for (const rawAttachment of rawNote.attachments || []) {
            const normalized = await normalizeImportedAttachment(rawAttachment);
            note.attachments.push(normalized.attachment);
            if (normalized.blob) rows.push({
              mediaKey: env.Media.mediaKeyNoteAttachment(note.id, normalized.attachment.id),
              attachment: normalized.blob,
            });
          }
          item.notes.push(note);
        }
      } else if (item.kind === 'note') {
        item.attachments = [];
        for (const rawAttachment of raw.attachments || []) {
          const normalized = await normalizeImportedAttachment(rawAttachment);
          item.attachments.push(normalized.attachment);
          if (normalized.blob) rows.push({
            mediaKey: env.Media.mediaKeyNoteAttachment(item.id, normalized.attachment.id),
            attachment: normalized.blob,
          });
        }
      } else {
        stageOwner(item, env.Media.mediaKeyTab(item.id));
      }
      stagedItems.push(item);
    }
    await env.Media.putImportStage(stageId, rows);
    return { items: stagedItems, mediaOwners: rows.length };
      
  }

  function closeImportPreview() {
    ensureBound('closeImportPreview');

    if (!env.importPreviewOverlay) return;
    env.importPreviewOverlay.classList.remove('open');
    env.importPreviewOverlay.setAttribute('aria-hidden', 'true');
    if (env.importPreviewBody) env.importPreviewBody.innerHTML = '';
    if (env.importPreviewTitle) env.importPreviewTitle.textContent = '—';
    if (env.importPreviewUrl) env.importPreviewUrl.textContent = '';
      
  }

  function openImportTabPreview(item) {
    ensureBound('openImportTabPreview');

    if (!env.importPreviewOverlay || !env.importPreviewBody) return;
    const title = item?.title || item?.url || '—';
    const url = item?.kind === 'note' ? env.t('noteKind') : item?.url || '';
    if (env.importPreviewTitle) env.importPreviewTitle.textContent = title;
    if (env.importPreviewUrl) {
      env.importPreviewUrl.textContent = env.isStoredOnlyUrl(url) ? `${url} · ${env.t('storedOnly')}` : url;
    }
    env.importPreviewBody.innerHTML = '';
    const src = pickImportImageDataUrl(item);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = title;
      env.importPreviewBody.appendChild(img);
    } else {
      const empty = document.createElement('div');
      empty.className = 'import-preview-empty';
      empty.textContent = env.t('importPreviewNoImage');
      env.importPreviewBody.appendChild(empty);
    }
    env.importPreviewOverlay.classList.add('open');
    env.importPreviewOverlay.setAttribute('aria-hidden', 'false');
      
  }

  function openImportGroupPreview(item) {
    ensureBound('openImportGroupPreview');

    if (!env.importPreviewOverlay || !env.importPreviewBody) return;
    const title = item?.title || env.t('stackTitle');
    const members = Array.isArray(item?.tabs) ? item.tabs : [];
    const notes = Array.isArray(item?.notes) ? item.notes : [];
    if (env.importPreviewTitle) env.importPreviewTitle.textContent = title;
    if (env.importPreviewUrl) {
      env.importPreviewUrl.textContent = env.t('groupTabs', { n: members.length + notes.length });
    }
    env.importPreviewBody.innerHTML = '';
    if (!members.length && !notes.length) {
      const empty = document.createElement('div');
      empty.className = 'import-preview-empty';
      empty.textContent = env.t('importPreviewGroupEmpty');
      env.importPreviewBody.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'import-preview-members';
      [...members, ...notes].forEach((m) => {
        if (m.kind === 'note') {
          const row = document.createElement('div');
          row.className = 'import-preview-member';
          row.innerHTML = `<div class="m-main"><div class="m-title">${env.escapeHtml(m.title || env.t('noteUntitled'))}</div><div class="m-url">${env.escapeHtml((m.markdown || '').slice(0, 180))}</div></div><button type="button" class="btn import-pick-preview">${env.escapeHtml(env.t('importPickPreview'))}</button>`;
          row.querySelector('button')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openImportTabPreview(m);
          });
          list.appendChild(row);
          return;
        }
        const row = document.createElement('div');
        const storedOnly = env.isStoredOnlyUrl(m?.url);
        row.className = `import-preview-member${storedOnly ? ' stored-only' : ''}`;
        const mTitle = m?.title || m?.url || '—';
        const mUrl = m?.url || '';
        const thumb = pickImportImageDataUrl(m);
        row.innerHTML = `
          ${
            thumb
              ? `<img src="${env.escapeAttr(thumb)}" alt="" style="width:48px;height:30px;object-fit:cover;border-radius:6px;flex-shrink:0;background:var(--input-bg)" />`
              : ''
          }
          <div class="m-main">
            <div class="m-title">
              ${env.escapeHtml(mTitle)}
              ${storedOnly ? `<span class="stored-only-badge">${env.escapeHtml(env.t('storedOnlyShort'))}</span>` : ''}
            </div>
            <div class="m-url">${env.escapeHtml(mUrl)}</div>
          </div>
          <button type="button" class="btn import-pick-preview">${env.escapeHtml(env.t('importPickPreview'))}</button>
        `;
        row.querySelector('button')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openImportTabPreview(m);
        });
        list.appendChild(row);
      });
      env.importPreviewBody.appendChild(list);
    }
    env.importPreviewOverlay.classList.add('open');
    env.importPreviewOverlay.setAttribute('aria-hidden', 'false');
      
  }

  function openImportPickBox(mode, backup, warnings = {}) {
    ensureBound('openImportPickBox');

    if (!env.importPickBox || !env.importPickList) return;
    const items = Array.isArray(backup.parkedItems) ? backup.parkedItems : [];
    const selected = new Set(items.map((it, i) => String(it.id || `idx-${i}`)));
    // Ensure each item has a stable pick key
    items.forEach((it, i) => {
      if (!it.id) it.id = `idx-${i}-${Date.now()}`;
      selected.add(String(it.id));
    });
    env.pendingImportPick = { mode, backup, selected, warnings };
      
    env.closeAllFloatsExcept('importPick');
    env.importPickBox.classList.add('open');
    env.importPickBox.setAttribute('aria-hidden', 'false');
    if (env.importPickHintEl) {
      const modeLabel =
        mode === 'append' ? env.t('importPickModeAppend') : env.t('importPickModeReplace');
      env.importPickHintEl.textContent = `${env.t('importPickHint')} ${modeLabel}`;
    }
    if (env.importPickStatus) env.importPickStatus.textContent = formatImportWarnings(warnings);
      
    env.importPickList.innerHTML = '';
    items.forEach((item) => {
      const id = String(item.id);
      const isGroup = item.kind === 'group' || Array.isArray(item.tabs);
      const isNote = item.kind === 'note';
      const storedOnlyCount = env.countStoredOnlyUrls(item);
      const title = isGroup
        ? item.title || env.t('stackTitle')
        : item.title || item.url || '—';
      const sub = isGroup
        ? `${env.t('groupTabs', { n: (item.tabs || []).length + (item.notes || []).length })}${storedOnlyCount ? ` · ${env.t('backupStoredOnly', { n: storedOnlyCount })}` : ''}`
        : isNote
          ? `${env.t('noteKind')} · ${env.t('noteCount', { n: (item.attachments || []).length })}`
        : env.isStoredOnlyUrl(item.url)
          ? `${item.url || ''} · ${env.t('storedOnly')}`
          : item.url || '';
      const kindLabel = isGroup ? 'group' : isNote ? 'note' : storedOnlyCount ? env.t('storedOnlyShort') : 'tab';
      
      const row = document.createElement('div');
      row.className = `import-pick-row${storedOnlyCount ? ' stored-only' : ''}`;
      row.innerHTML = `
        <label class="import-pick-label">
          <input type="checkbox" data-pick-id="${env.escapeAttr(id)}" ${selected.has(id) ? 'checked' : ''} />
          <span class="import-pick-kind ${isGroup ? 'group' : storedOnlyCount ? 'stored-only' : ''}">${env.escapeHtml(kindLabel)}</span>
          <span class="import-pick-main">
            <div class="import-pick-title">${env.escapeHtml(title)}</div>
            <div class="import-pick-sub">${env.escapeHtml(sub)}</div>
          </span>
        </label>
        <button type="button" class="btn import-pick-preview">${env.escapeHtml(env.t('importPickPreview'))}</button>
      `;
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) env.pendingImportPick.selected.add(id);
        else env.pendingImportPick.selected.delete(id);
        updateImportPickCount();
      });
      row.querySelector('.import-pick-preview')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isGroup) openImportGroupPreview(item);
        else openImportTabPreview(item);
      });
      env.importPickList.appendChild(row);
    });
    updateImportPickCount();
    env.placeFloatBox(env.importPickBox);
    env.syncFloatBackdrop();
      
  }

  async function confirmImportPick() {
    ensureBound('confirmImportPick');

    return env.withUiActionLock('import', confirmImportPickUnlocked);
      
  }

  async function confirmImportPickUnlocked() {
    ensureBound('confirmImportPickUnlocked');

    if (!env.pendingImportPick) return;
    const { mode, backup, selected } = env.pendingImportPick;
    if (!selected.size) {
      if (env.importPickStatus) env.importPickStatus.textContent = env.t('importPickEmpty');
      return;
    }
    const confirmMsg =
      mode === 'append'
        ? env.t('backupAppendConfirm')
        : env.t('backupConfirm');
    if (!window.confirm(confirmMsg)) return;
      
    const all = Array.isArray(backup.parkedItems) ? backup.parkedItems : [];
    const filtered = all.filter((it) => selected.has(String(it.id)));
    const payload = {
      ...backup,
      parkedItems: filtered,
      parkedTabs: filtered
        .filter((i) => i.kind === 'tab')
        .map(({ kind, hasThumb, hasSnap, ...rest }) => rest),
    };
      
    if (env.importPickStatus) env.importPickStatus.textContent = env.t('backupImporting');
    env.uiLog('info', 'import', `confirm mode=${mode}`, `selected=${filtered.length}/${all.length}`);
    if (mode !== 'append' && payload.settings?.wallpaper?.data && env.Wallpaper?.persistFromDataUrl) {
      try {
        await env.Wallpaper.persistFromDataUrl(payload.settings.wallpaper.data);
      } catch (err) {
        env.uiLog('warn', 'import', 'wallpaper persist failed', err?.message || err);
      }
      const wallpaper = { ...payload.settings.wallpaper };
      delete wallpaper.data;
      payload.settings = { ...payload.settings, wallpaper };
    }
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
          .filter((i) => i.kind === 'tab')
          .map(({ kind, hasThumb, hasSnap, ...rest }) => rest),
      };
      const res = await env.sendMessage({
        type: 'IMPORT_BACKUP',
        backup: transportBackup,
        mode,
        importId,
      });
      messageSent = true;
      if (!res.ok) {
        const errorText = formatBackupError(res);
        if (env.importPickStatus) env.importPickStatus.textContent = errorText;
        env.backupStatus.textContent = errorText;
        env.uiLog('error', 'import', 'failed', formatBackupErrorLog(res));
        return;
      }
      closeImportPickBox();
      env.settings = await env.loadSettings();
      env.syncSettingsUi();
      await env.loadList();
      if (env.tagsBox.classList.contains('open')) await env.refreshTagManager();
      const warningText = formatImportWarnings(res.warnings);
      if (mode === 'append') {
        env.backupStatus.textContent = `${env.t('backupAppended', { n: res.added != null ? res.added : filtered.length })}${warningText ? ` ${warningText}` : ''}`;
      } else {
        env.backupStatus.textContent = `${env.t('backupImported')}${warningText ? ` ${warningText}` : ''}`;
      }
    } catch (err) {
      if (!messageSent && importId) {
        try {
          await env.Media.removeImportStage?.(importId);
        } catch {
          // best effort cleanup; the service worker also removes stale stages
        }
      }
      console.warn(err);
      env.uiLog('error', 'import', 'exception', formatBackupErrorLog(err));
      const errorText = formatBackupError(err);
      if (env.importPickStatus) env.importPickStatus.textContent = errorText;
      env.backupStatus.textContent = errorText;
    }
      
  }

  async function buildPartialBackupPayload(items, { withMedia = false } = {}) {
    ensureBound('buildPartialBackupPayload');

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
          for (const note of it.notes || []) {
            for (const attachment of note.attachments || []) attachment.data = '';
          }
        } else if (it.kind === 'note') {
          for (const attachment of it.attachments || []) attachment.data = '';
        } else {
          it.thumbnail = '';
          it.snapshot = '';
        }
      }
    }
    const parkedTabs = parkedItems
      .filter((i) => i.kind === 'tab')
      .map(({ kind, hasThumb, hasSnap, thumbnail, snapshot, ...rest }) => rest);
    const selectedIds = new Set(items.map((item) => item.id));
    const partialLayout = env.normalizeCanvasLayoutLocal(env.canvasLayout, items);
    partialLayout.positions = Object.fromEntries(
      Object.entries(partialLayout.positions).filter(([id]) => selectedIds.has(id))
    );
    partialLayout.connections = (partialLayout.connections || []).filter(
      (connection) => selectedIds.has(connection.sourceId) && selectedIds.has(connection.targetId)
    );
    return {
      format: 'tabwall-backup',
      version: env.Build.FORMAT_VERSION || 4,
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
      settings: { ...env.settings },
      tagCatalog: [], // filled async if needed
      canvasLayout: partialLayout,
    };
      
  }

  async function exportSelected(mode) {
    ensureBound('exportSelected');

    const ids = [...env.selectedIds];
    if (!ids.length) {
      env.uiLog('warn', 'export', 'partial empty selection');
      window.alert(env.t('batchExportEmpty'));
      return;
    }
    const idSet = new Set(ids);
    // Preserve wall order
    const items = env.allTabs.filter((it) => idSet.has(it.id));
    if (!items.length) {
      window.alert(env.t('batchExportEmpty'));
      return;
    }
    env.uiLog('info', 'export', `partial ${mode} start`, `phase=export n=${items.length}`);
    let phase = 'export';
    try {
      phase = 'hydrate';
      const backup = await buildPartialBackupPayload(items, { withMedia: mode === 'full' });
      // Best-effort tag catalog from SW via lite export env.settings not needed
      const tagRes = await env.sendMessage({ type: 'EXPORT_BACKUP', mode: 'lite' });
      if (tagRes?.ok && tagRes.backup?.tagCatalog) {
        backup.tagCatalog = tagRes.backup.tagCatalog;
      }
      if (tagRes?.ok && tagRes.backup?.settings) {
        backup.settings = tagRes.backup.settings;
      }
      if (mode === 'full' && env.Wallpaper?.hydrateForExport) {
        backup.settings = await env.Wallpaper.hydrateForExport(backup.settings);
      }
      phase = 'build';
      const built =
        mode === 'full'
          ? env.Build.buildFullZipBlob(backup, { auto: false, partial: true })
          : env.Build.buildLiteBlob(backup, { auto: false, partial: true });
      phase = 'download';
      downloadBlob(built.blob, built.filename);
      env.uiLog('info', 'export', `partial ${mode} ok`, `phase=download file=${built.filename} n=${items.length}`);
    } catch (err) {
      console.warn(err);
      const error = err && typeof err === 'object' ? err : new Error(String(err));
      if (!error.phase) error.phase = phase;
      env.uiLog('error', 'export', `partial ${mode} failed`, formatBackupErrorLog(error));
      window.alert(`${env.t('backupError')}: ${formatBackupError(error)}`);
    }
      
  }

  global.TabWallImportExport = {
    bind,
    formatImportWarnings,
    formatBackupError,
    formatBackupErrorLog,
    downloadBlob,
    runLocalAutoBackup,
    maybeCatchUpAutoBackup,
    mapWithConcurrencyLocal,
    hydrateItemMediaLocal,
    estimateFullBackupMediaBytes,
    exportLiteBackup,
    closeImportPickBox,
    updateImportPickCount,
    pickImportImageDataUrl,
    newImportStageId,
    stageImportMedia,
    closeImportPreview,
    openImportTabPreview,
    openImportGroupPreview,
    openImportPickBox,
    confirmImportPick,
    confirmImportPickUnlocked,
    buildPartialBackupPayload,
    exportSelected
  };
})(typeof self !== 'undefined' ? self : globalThis);
