/**
 * TabWall parkSettingsUi — TabWallSettingsUi.
 * bind(env) using explicit live getters/setters from park.js.
 * Access park bindings via env.* only — no eval, no with-statement (MV3 CSP safe).
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>|null} */
  let env = null;
  let webhookUiBound = false;

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    env = next;
  }

  function ensureBound(name) {
    if (!env) throw new Error('TabWallSettingsUi.' + name + ' used before bind()');
  }

  const DEFAULT_AI_SETTINGS = {
    enabled: false,
    activeProviderId: 'local-llama-cpp',
    providers: [{
      id: 'local-llama-cpp',
      name: 'Local llama.cpp',
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: '',
      bearerToken: '',
      headers: [],
      models: [],
      bypassConfirmations: false,
    }],
    timeoutMs: 120000,
    contextSize: 8192,
  };

  function normalizeAiUrl(value, fallback = '') {
    try {
      const url = new URL(String(value || ''));
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(host);
      if (!(loopback || url.protocol === 'https:')) return fallback;
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/+$/, '');
    } catch {
      return fallback;
    }
  }

  function normalizeAiHeader(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const name = String(source.name ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    const value = String(source.value ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || !value) return null;
    if (['accept', 'content-type', 'authorization'].includes(name.toLowerCase())) return null;
    return { name, value: value.slice(0, 4000) };
  }

  function normalizeAiProvider(raw, fallbackId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const id = String(source.id || fallbackId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!id) return null;
    return {
      id,
      name: String(source.name ?? 'OpenAI-compatible').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'OpenAI-compatible',
      baseUrl: normalizeAiUrl(source.baseUrl, ''),
      model: String(source.model ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 300),
      bearerToken: String(source.bearerToken ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 4000),
      headers: Array.isArray(source.headers) ? source.headers.map(normalizeAiHeader).filter(Boolean).slice(0, 20) : [],
      models: Array.isArray(source.models)
        ? [...new Set(source.models.map((model) => String(model ?? '').replace(/[\u0000-\u001f]/g, '').trim()).filter(Boolean))].slice(0, 100)
        : [],
      bypassConfirmations: source.bypassConfirmations === true,
    };
  }

  function normalizeAiSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const legacy = Array.isArray(source.providers) ? [] : [{
      ...DEFAULT_AI_SETTINGS.providers[0], baseUrl: source.baseUrl || DEFAULT_AI_SETTINGS.providers[0].baseUrl, model: source.model || '',
    }];
    const providers = (Array.isArray(source.providers) ? source.providers : legacy)
      .map((provider, index) => normalizeAiProvider(provider, index === 0 ? 'local-llama-cpp' : ''))
      .filter((provider) => provider?.baseUrl)
      .filter((provider, index, list) => list.findIndex((item) => item.id === provider.id) === index)
      .slice(0, 20);
    if (!providers.some((provider) => provider.id === 'local-llama-cpp')) {
      providers.unshift(normalizeAiProvider(DEFAULT_AI_SETTINGS.providers[0]));
    }
    return {
      enabled: source.enabled === true,
      activeProviderId: providers.some((provider) => provider.id === source.activeProviderId)
        ? source.activeProviderId
        : 'local-llama-cpp',
      providers,
      timeoutMs: env.clampInt(source.timeoutMs, 10000, 180000, DEFAULT_AI_SETTINGS.timeoutMs),
      contextSize: env.clampInt(source.contextSize, 2048, 131072, DEFAULT_AI_SETTINGS.contextSize),
    };
  }

  function newAutoSaveMetadataRuleId() {
    ensureBound('newAutoSaveMetadataRuleId');

    try {
      if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    } catch {
      // Fall through to an opaque local id.
    }
    return `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      
  }

  function normalizeAutoSaveMetadataTags(tags) {
    ensureBound('normalizeAutoSaveMetadataTags');

    if (!Array.isArray(tags)) return [];
    return [...new Set(
      tags
        .map((tag) => String(tag ?? '').trim().slice(0, 128))
        .filter(Boolean)
    )].slice(0, 100);
      
  }

  function normalizeAutoSaveMetadataCondition(raw) {
    ensureBound('normalizeAutoSaveMetadataCondition');

    const condition = raw && typeof raw === 'object' ? raw : {};
    return {
      field: condition.field === 'title' ? 'title' : 'domain',
      operator: env.AUTO_SAVE_METADATA_OPERATORS.includes(condition.operator)
        ? condition.operator
        : 'match',
      negate: condition.negate === true,
      value: String(condition.value ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 2048).trim(),
    };
      
  }

  function normalizeAutoSaveMetadataRule(raw) {
    ensureBound('normalizeAutoSaveMetadataRule');

    const rule = raw && typeof raw === 'object' ? raw : {};
    return {
      id: typeof rule.id === 'string' && rule.id ? rule.id.slice(0, 128) : newAutoSaveMetadataRuleId(),
      enabled: rule.enabled !== false,
      logic: rule.logic === 'OR' ? 'OR' : 'AND',
      conditions: Array.isArray(rule.conditions)
        ? rule.conditions
            .slice(0, env.AUTO_SAVE_METADATA_MAX_CONDITIONS)
            .map(normalizeAutoSaveMetadataCondition)
        : [],
      note: String(rule.note ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 20000),
      tags: normalizeAutoSaveMetadataTags(rule.tags),
    };
      
  }

  function normalizeAutoSaveMetadata(raw) {
    ensureBound('normalizeAutoSaveMetadata');

    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: source.enabled === true,
      rules: Array.isArray(source.rules)
        ? source.rules.slice(0, env.AUTO_SAVE_METADATA_MAX_RULES).map(normalizeAutoSaveMetadataRule)
        : [],
    };
      
  }

  function newAutoSaveMetadataRule() {
    ensureBound('newAutoSaveMetadataRule');

    return {
      id: newAutoSaveMetadataRuleId(),
      enabled: true,
      logic: 'AND',
      conditions: [{ field: 'domain', operator: 'contains', negate: false, value: '' }],
      note: '',
      tags: [],
    };
      
  }

  function sanitizeSubfolder(raw) {
    ensureBound('sanitizeSubfolder');

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

  function normalizeAutoBackup(raw) {
    ensureBound('normalizeAutoBackup');

    const o = raw && typeof raw === 'object' ? raw : {};
    const legacyTime = legacyAutoBackupSchedule(o.lastSuccessAt);
    const scheduleHour = env.clampInt(
      o.scheduleHour == null ? legacyTime.scheduleHour : o.scheduleHour,
      0,
      23,
      legacyTime.scheduleHour
    );
    const scheduleMinute = normalizeAutoBackupScheduleMinute(
      o.scheduleMinute == null ? legacyTime.scheduleMinute : o.scheduleMinute,
      legacyTime.scheduleMinute
    );
    const subfolder = sanitizeSubfolder(
      o.subfolder != null && String(o.subfolder).trim() !== ''
        ? o.subfolder
        : o.folderName || 'TabWall-Backups'
    );
    return {
      enabled: Boolean(o.enabled),
      mode: o.mode === 'full' ? 'full' : 'lite',
      scheduleHour,
      scheduleMinute,
      maxKeep: env.clampInt(o.maxKeep, 1, 99, 5),
      subfolder,
      folderPath: typeof o.folderPath === 'string' ? o.folderPath : '',
      lastSuccessAt: Number(o.lastSuccessAt) || 0,
      lastError: typeof o.lastError === 'string' ? o.lastError : '',
    };
      
  }

  function legacyAutoBackupSchedule(lastSuccessAt) {
    const ts = Number(lastSuccessAt);
    if (!Number.isFinite(ts) || ts <= 0) {
      return { scheduleHour: 0, scheduleMinute: 0 };
    }
    const date = new Date(ts);
    return {
      scheduleHour: date.getHours(),
      scheduleMinute: date.getMinutes() >= 30 ? 30 : 0,
    };
  }

  function normalizeAutoBackupScheduleMinute(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback === 30 ? 30 : 0;
    return n === 30 ? 30 : 0;
  }

  async function loadSettings() {
    ensureBound('loadSettings');

    const data = await chrome.storage.local.get(env.SETTINGS_KEY);
    const merged = { ...env.DEFAULT_SETTINGS, ...(data[env.SETTINGS_KEY] || {}) };
    merged.cardCols = env.clampCols(merged.cardCols);
    if (merged.viewMode === 'cards') merged.viewMode = 'canvas';
    if (merged.viewMode !== 'list') merged.viewMode = 'canvas';
    if (merged.defaultViewMode === 'cards') merged.defaultViewMode = 'canvas';
    if (merged.defaultViewMode !== 'list') merged.defaultViewMode = 'canvas';
    if (merged.locale !== 'en') merged.locale = 'zh';
    merged.newTabOverride = merged.newTabOverride !== false;
    merged.sortBy = env.normalizeSortBy(merged.sortBy);
    // Local shortcut settings were removed; discard the legacy field on the next write.
    delete merged.shortcuts;
    merged.webhookProfiles = env.Webhook?.normalizeProfiles
      ? env.Webhook.normalizeProfiles(merged.webhookProfiles)
      : [];
    merged.autoBackup = normalizeAutoBackup(merged.autoBackup);
    merged.autoSaveMetadata = normalizeAutoSaveMetadata(merged.autoSaveMetadata);
    merged.ai = normalizeAiSettings(merged.ai);
    merged.canvasSnap = merged.canvasSnap !== false;
    merged.fxLevel = normalizeFxLevel(merged.fxLevel);
    merged.wallpaper = env.Wallpaper
      ? env.Wallpaper.normalizeWallpaper(merged.wallpaper)
      : merged.wallpaper;
    env.normalizeCanvasRailSettings(merged);
    return merged;
      
  }

  async function saveSettings(partial) {
    ensureBound('saveSettings');

    let patch = { ...(partial || {}) };
    if (patch.cardCols != null) patch.cardCols = env.clampCols(patch.cardCols);
    if (patch.sortBy != null) patch.sortBy = env.normalizeSortBy(patch.sortBy);
    if (patch.canvasRailWidth != null) patch.canvasRailWidth = env.normalizeCanvasRailWidth(patch.canvasRailWidth);
    if (patch.canvasRailCollapsed != null) patch.canvasRailCollapsed = patch.canvasRailCollapsed === true;
    if (patch.autoBackup) {
      const merged = normalizeAutoBackup({ ...env.settings.autoBackup, ...patch.autoBackup });
      const allowed = {};
      for (const key of Object.keys(patch.autoBackup)) {
        if (key === 'lastSuccessAt' || key === 'dirtyAt' || key === 'lastError') continue;
        if (Object.prototype.hasOwnProperty.call(merged, key)) allowed[key] = merged[key];
      }
      if (patch.autoBackup.subfolder != null) allowed.subfolder = merged.subfolder;
      patch.autoBackup = allowed;
    }
    if (patch.autoSaveMetadata) {
      patch.autoSaveMetadata = normalizeAutoSaveMetadata(patch.autoSaveMetadata);
    }
    if (patch.webhookProfiles && env.Webhook) {
      patch.webhookProfiles = env.Webhook.normalizeProfiles(patch.webhookProfiles);
    }
    if (patch.ai) {
      patch.ai = normalizeAiSettings({ ...env.settings.ai, ...patch.ai });
    }
    if (patch.wallpaper && env.Wallpaper) {
      patch.wallpaper = env.Wallpaper.normalizeWallpaper(patch.wallpaper);
    }
    env.suppressSettingsOnChanged = true;
    if (env.suppressSettingsTimer) clearTimeout(env.suppressSettingsTimer);
    try {
      const res = await env.sendMessage({ type: 'PATCH_SETTINGS', partial: patch });
      if (!res?.ok || !res.settings) {
        env.uiLog('error', 'settings', 'save failed', res?.error || 'unknown');
        return env.settings;
      }
      env.settings = { ...env.settings, ...res.settings };
      if (env.settings.autoBackup) env.settings.autoBackup = normalizeAutoBackup(env.settings.autoBackup);
      if (env.settingsSaveStatus) {
        env.settingsSaveStatus.textContent = env.t('settingsAutoSaved');
        env.settingsSaveStatus.dataset.state = 'saved';
      }
      return env.settings;
    } finally {
      // chrome.storage.onChanged may fire async after set resolves
      env.suppressSettingsTimer = setTimeout(() => {
        env.suppressSettingsOnChanged = false;
        env.suppressSettingsTimer = null;
      }, 50);
    }
      
  }

  function applyTheme(theme) {
    ensureBound('applyTheme');

    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    env.themeBtn.textContent = theme === 'light' ? 'Dark' : 'Light';
      
  }

  let fxMotionMql = null;

  function normalizeFxLevel(value) {
    if (value === 'quiet' || value === 'cinematic') return value;
    return 'standard';
  }

  function applyFxLevel(level) {
    ensureBound('applyFxLevel');

    const normalized = normalizeFxLevel(level);
    let reduced = false;
    try {
      if (!fxMotionMql && typeof matchMedia === 'function') {
        fxMotionMql = matchMedia('(prefers-reduced-motion: reduce)');
        fxMotionMql.addEventListener?.('change', () => applyFxLevel(env.settings?.fxLevel));
      }
      reduced = Boolean(fxMotionMql?.matches);
    } catch {
      reduced = false;
    }
    document.documentElement.dataset.fx = reduced ? 'quiet' : normalized;
  }

  function applyCanvasRailUi({ width = env.settings.canvasRailWidth, collapsed = env.settings.canvasRailCollapsed } = {}) {
    ensureBound('applyCanvasRailUi');

    if (!env.canvasView) return;
    const normalizedWidth = env.normalizeCanvasRailWidth(width);
    const isCollapsed = collapsed === true;
    const visibleWidth = isCollapsed ? env.CANVAS_RAIL_COLLAPSED_WIDTH : normalizedWidth;
    env.canvasView.style.setProperty('--canvas-rail-width', `${visibleWidth}px`);
    env.canvasView.dataset.canvasRailCollapsed = isCollapsed ? 'true' : 'false';
    if (env.canvasRailResize) {
      env.canvasRailResize.title = env.t('canvasRailResize');
      env.canvasRailResize.setAttribute('aria-label', env.t('canvasRailResize'));
      env.canvasRailResize.setAttribute('aria-valuemin', String(env.CANVAS_RAIL_COLLAPSED_WIDTH));
      env.canvasRailResize.setAttribute('aria-valuemax', String(env.CANVAS_RAIL_MAX_WIDTH));
      env.canvasRailResize.setAttribute('aria-valuenow', String(visibleWidth));
      env.canvasRailResize.setAttribute(
        'aria-valuetext',
        isCollapsed ? env.t('canvasRailCollapsedValue') : `${normalizedWidth}px`
      );
    }
    if (env.canvasRailToggle) {
      const label = env.t(isCollapsed ? 'canvasRailExpand' : 'canvasRailCollapse');
      env.canvasRailToggle.title = label;
      env.canvasRailToggle.setAttribute('aria-label', label);
      env.canvasRailToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    }
      
  }

  function syncViewModeButton(mode) {
    ensureBound('syncViewModeButton');

    if (!env.viewModeBtn) return;
    const target = mode === 'canvas' ? 'list' : 'canvas';
    const label = env.t(target === 'list' ? 'list' : 'canvasView');
    if (env.viewModeLabel) env.viewModeLabel.textContent = label;
    if (env.viewModeListIcon) env.viewModeListIcon.hidden = target !== 'list';
    if (env.viewModeCanvasIcon) env.viewModeCanvasIcon.hidden = target !== 'canvas';
    env.viewModeBtn.dataset.viewTarget = target;
    env.viewModeBtn.title = label;
    env.viewModeBtn.setAttribute('aria-label', label);
      
  }

  function applyViewMode(mode) {
    ensureBound('applyViewMode');

    env.closeCanvasContextMenu();
    if (mode !== 'list' && mode !== 'canvas') mode = 'canvas';
    const isList = mode === 'list';
    const isCanvas = mode === 'canvas';
    if (!isCanvas) {
      env.canvasSearchPreview = null;
      env.ensureCanvasStore()?.flush?.().catch?.(() => {});
    }
    env.gridEl.classList.toggle('cards', !isList);
    env.gridEl.classList.toggle('list', isList);
    syncViewModeButton(mode);
    env.colsControl.classList.toggle('visible', !isList && !isCanvas);
    if (env.canvasView) env.canvasView.hidden = !isCanvas;
    if (env.canvasView) env.canvasView.setAttribute('aria-hidden', isCanvas ? 'false' : 'true');
    document.body.classList.toggle('canvas-mode', isCanvas);
    env.syncCanvasOrganizeUi(mode);
    if (!isCanvas) env.closeCanvasZoomMenu();
    if (isCanvas) env.scheduleInitialCanvasCenter();
      
  }

  function applyCardCols(cols) {
    ensureBound('applyCardCols');

    const n = env.clampCols(cols);
    env.gridEl.style.setProperty('--cols', String(n));
    env.cardColsEl.value = String(n);
    env.colsValueEl.textContent = String(n);
    if (env.settingsCardCols) {
      env.settingsCardCols.value = String(n);
      env.settingsColsValue.textContent = String(n);
    }
      
  }

  function updateSavedBadge() {
    ensureBound('updateSavedBadge');

    const n = env.allTabs.length;
    const isCanvasUi = env.settings.viewMode === 'canvas' && !env.canvasSessionFallback;
    const visible = isCanvasUi ? env.getCanvasVisibleTabs().length : env.getVisibleTabs().length;
    const canvasFiltered = isCanvasUi && env.canvasIndexFilter !== 'all';
    env.countEl.textContent =
      (env.query || env.pinnedOnly || canvasFiltered) && visible !== n
        ? env.t('countFiltered', { shown: visible, total: n })
        : env.t('countTabs', { n });
      
  }

  function syncPinnedFilterUi() {
    ensureBound('syncPinnedFilterUi');

    if (!env.pinnedOnlyBtn) return;
    env.pinnedOnlyBtn.classList.toggle('active', env.pinnedOnly);
    env.pinnedOnlyBtn.setAttribute('aria-pressed', env.pinnedOnly ? 'true' : 'false');
      
  }

  function syncSettingsUi() {
    ensureBound('syncSettingsUi');

    applyTheme(env.settings.theme);
    applyFxLevel(env.settings.fxLevel);
    if (env.Wallpaper) {
      env.Wallpaper.apply(env.settings.wallpaper).catch(() => {});
    }
    applyViewMode(env.settings.viewMode);
    applyCardCols(env.settings.cardCols);
    if (env.settingsNewTabOverride) env.settingsNewTabOverride.checked = env.settings.newTabOverride !== false;
    env.canvasSnapToGrid = env.settings.canvasSnap !== false;
    const canvasSnapInput = document.getElementById('settingsCanvasSnap');
    if (canvasSnapInput) canvasSnapInput.checked = env.canvasSnapToGrid;
    syncPinnedFilterUi();
    env.settings.sortBy = env.normalizeSortBy(env.settings.sortBy);
    env.sortByEl.value = env.settings.sortBy;
    env.openWithSearchFocusEl.checked = Boolean(env.settings.openWithSearchFocus);
    if (env.settingsPreSaveEdit) env.settingsPreSaveEdit.checked = env.settings.preSaveEdit !== false;
      
    const after =
      env.settingsEl.querySelector(`input[name="afterSave"][value="${env.settings.afterSave}"]`) ||
      env.settingsEl.querySelector('input[name="afterSave"][value="close"]');
    if (after) after.checked = true;
      
    const afterG =
      env.settingsEl.querySelector(
        `input[name="afterSaveGroup"][value="${env.settings.afterSaveGroup || 'close'}"]`
      ) || env.settingsEl.querySelector('input[name="afterSaveGroup"][value="close"]');
    if (afterG) afterG.checked = true;
      
    const cap =
      env.settingsEl.querySelector(
        `input[name="saveGroupCapture"][value="${env.settings.saveGroupCapture || 'all'}"]`
      ) || env.settingsEl.querySelector('input[name="saveGroupCapture"][value="all"]');
    if (cap) cap.checked = true;
      
    const rg =
      env.settingsEl.querySelector(
        `input[name="restoreGroupIn"][value="${env.settings.restoreGroupIn || 'currentWindow'}"]`
      ) || env.settingsEl.querySelector('input[name="restoreGroupIn"][value="currentWindow"]');
    if (rg) rg.checked = true;
      
    const themeRadio =
      env.settingsEl.querySelector(`input[name="theme"][value="${env.settings.theme}"]`) ||
      env.settingsEl.querySelector('input[name="theme"][value="dark"]');
    if (themeRadio) themeRadio.checked = true;

    const fxRadio =
      env.settingsEl.querySelector(`input[name="fxLevel"][value="${normalizeFxLevel(env.settings.fxLevel)}"]`) ||
      env.settingsEl.querySelector('input[name="fxLevel"][value="standard"]');
    if (fxRadio) fxRadio.checked = true;
      
    const localeRadio =
      env.settingsEl.querySelector(`input[name="locale"][value="${env.settings.locale}"]`) ||
      env.settingsEl.querySelector('input[name="locale"][value="zh"]');
    if (localeRadio) localeRadio.checked = true;
      
    const viewRadio =
      env.settingsEl.querySelector(
        `input[name="defaultViewMode"][value="${env.settings.defaultViewMode || 'canvas'}"]`
      ) || env.settingsEl.querySelector('input[name="defaultViewMode"][value="canvas"]');
    if (viewRadio) viewRadio.checked = true;
      
    syncAutoBackupUi();
    syncAutoSaveMetadataUi();
    syncWebhookProfilesUi();
      
    env.applyI18n();
    env.syncAiSettingsUi?.();
    refreshChromeCommandLabels();
    env.syncSearchRegexUi();
      
  }

  function webhookHeaderRowHtml(name = '', value = '') {
    ensureBound('webhookHeaderRowHtml');

    return `
      <div class="webhook-header-row" data-webhook-header-row>
        <input class="settings-input" type="text" data-webhook-header-name maxlength="256" value="${env.escapeAttr(name)}" placeholder="${env.escapeAttr(env.t('webhookHeaderNamePh'))}" autocomplete="off" spellcheck="false" />
        <input class="settings-input" type="text" data-webhook-header-value maxlength="4096" value="${env.escapeAttr(value)}" placeholder="${env.escapeAttr(env.t('webhookHeaderValuePh'))}" autocomplete="off" spellcheck="false" />
        <button type="button" class="btn webhook-header-delete" data-webhook-action="remove-header" title="${env.escapeAttr(env.t('webhookRemoveHeader'))}" aria-label="${env.escapeAttr(env.t('webhookRemoveHeader'))}">${env.iconSvg('delete')}</button>
      </div>`;
  }

  function webhookProfileCardHtml(profile) {
    ensureBound('webhookProfileCardHtml');

    const headerRows = Object.entries(profile.headers || {})
      .map(([name, value]) => webhookHeaderRowHtml(name, value))
      .join('');
    return `
      <article class="webhook-profile-card" data-webhook-profile-id="${env.escapeAttr(profile.id)}">
        <div class="webhook-profile-header">
          <label class="webhook-profile-name">
            <span>${env.escapeHtml(env.t('webhookProfileName'))}</span>
            <input class="settings-input" type="text" data-webhook-profile-field="name" maxlength="128" value="${env.escapeAttr(profile.name)}" autocomplete="off" />
          </label>
          <button type="button" class="btn webhook-profile-delete" data-webhook-action="delete-profile" title="${env.escapeAttr(env.t('webhookDeleteProfile'))}" aria-label="${env.escapeAttr(env.t('webhookDeleteProfile'))}">${env.escapeHtml(env.t('delete'))}</button>
        </div>
        <label class="settings-stack-label">
          <span>${env.escapeHtml(env.t('webhookUrl'))}</span>
          <input class="settings-input" type="text" data-webhook-profile-field="url" maxlength="8192" value="${env.escapeAttr(profile.url)}" placeholder="https://…" autocomplete="off" spellcheck="false" />
        </label>
        <div class="webhook-header-heading">
          <span>${env.escapeHtml(env.t('webhookHeaders'))}</span>
          <button type="button" class="btn" data-webhook-action="add-header">${env.escapeHtml(env.t('webhookAddHeader'))}</button>
        </div>
        <div class="webhook-header-list" data-webhook-header-list>${headerRows}</div>
        <label class="settings-stack-label">
          <span>${env.escapeHtml(env.t('webhookBody'))}</span>
          <textarea class="settings-textarea webhook-body" rows="6" maxlength="65536" data-webhook-profile-field="body" spellcheck="false">${env.escapeHtml(profile.body)}</textarea>
        </label>
        <p class="hint webhook-template-hint">${env.escapeHtml(env.t('webhookTemplateHint'))}</p>
        <div class="webhook-profile-actions">
          <button type="button" class="btn primary" data-webhook-action="test-profile">${env.escapeHtml(env.t('webhookTest'))}</button>
          <span class="hint webhook-profile-status" data-webhook-status role="status" aria-live="polite"></span>
        </div>
      </article>`;
  }

  function normalizeWebhookProfiles(raw) {
    ensureBound('normalizeWebhookProfiles');
    return env.Webhook?.normalizeProfiles ? env.Webhook.normalizeProfiles(raw) : [];
  }

  function readWebhookProfileCard(card) {
    ensureBound('readWebhookProfileCard');

    const headers = {};
    card?.querySelectorAll('[data-webhook-header-row]').forEach((row) => {
      const name = row.querySelector('[data-webhook-header-name]')?.value?.trim() || '';
      if (!name) return;
      headers[name] = row.querySelector('[data-webhook-header-value]')?.value || '';
    });
    return {
      id: card?.dataset.webhookProfileId || '',
      name: card?.querySelector('[data-webhook-profile-field="name"]')?.value || '',
      url: card?.querySelector('[data-webhook-profile-field="url"]')?.value || '',
      headers,
      body: card?.querySelector('[data-webhook-profile-field="body"]')?.value || '',
    };
  }

  function readWebhookProfilesFromDom() {
    ensureBound('readWebhookProfilesFromDom');

    const root = env.webhookProfilesEl;
    if (!root) return normalizeWebhookProfiles(env.settings.webhookProfiles);
    return normalizeWebhookProfiles([...root.querySelectorAll('[data-webhook-profile-id]')]
      .map((card) => readWebhookProfileCard(card)));
  }

  async function persistWebhookProfilesFromDom() {
    ensureBound('persistWebhookProfilesFromDom');

    const profiles = readWebhookProfilesFromDom();
    env.settings.webhookProfiles = profiles;
    return saveSettings({ webhookProfiles: profiles });
  }

  function renderWebhookProfiles() {
    ensureBound('renderWebhookProfiles');

    const root = env.webhookProfilesEl;
    if (!root) return;
    const profiles = normalizeWebhookProfiles(env.settings.webhookProfiles);
    env.settings.webhookProfiles = profiles;
    root.innerHTML = profiles.length
      ? profiles.map(webhookProfileCardHtml).join('')
      : `<div class="webhook-profile-empty">${env.escapeHtml(env.t('webhookEmpty'))}</div>`;
  }

  function syncWebhookProfilesUi() {
    ensureBound('syncWebhookProfilesUi');

    renderWebhookProfiles();
  }

  function setWebhookStatus(card, message = '', isError = false) {
    const status = card?.querySelector('[data-webhook-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function webhookTestResultText(result) {
    ensureBound('webhookTestResultText');

    if (result?.ok) {
      const status = result.status ? ` (${result.status})` : '';
      const preview = result.responsePreview ? ` — ${result.responsePreview}` : '';
      return `${env.t('webhookTestSuccess')}${status}${preview}`;
    }
    const status = result?.status ? ` (${result.status})` : '';
    const error = result?.error ? `: ${result.error}` : '';
    const preview = result?.responsePreview ? ` — ${result.responsePreview}` : '';
    return `${env.t('webhookTestFailed')}${status}${error}${preview}`;
  }

  async function testWebhookProfileCard(card) {
    ensureBound('testWebhookProfileCard');

    const profile = readWebhookProfileCard(card);
    const button = card?.querySelector('[data-webhook-action="test-profile"]');
    if (button) button.disabled = true;
    setWebhookStatus(card, env.t('webhookTesting'));
    try {
      const result = await env.sendMessage({ type: 'TEST_WEBHOOK_PROFILE', profile });
      setWebhookStatus(card, webhookTestResultText(result), !result?.ok);
    } catch (err) {
      setWebhookStatus(card, `${env.t('webhookTestFailed')}: ${String(err?.message || err)}`, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function addWebhookProfile() {
    ensureBound('addWebhookProfile');

    const profiles = normalizeWebhookProfiles(env.settings.webhookProfiles);
    if (profiles.length >= (env.Webhook?.MAX_PROFILES || 20)) return;
    profiles.push(env.Webhook.normalizeProfile({ name: env.t('webhookNewProfile') }));
    env.settings.webhookProfiles = profiles;
    await saveSettings({ webhookProfiles: profiles });
    renderWebhookProfiles();
    env.webhookProfilesEl?.querySelector('[data-webhook-profile-field="name"]')?.focus();
  }

  function initWebhookProfilesUi() {
    ensureBound('initWebhookProfilesUi');
    if (webhookUiBound) return;
    webhookUiBound = true;
    env.webhookAddProfileBtn?.addEventListener('click', () => {
      addWebhookProfile().catch((err) => env.uiLog('error', 'webhook', 'add profile failed', err?.message || err));
    });
    env.webhookProfilesEl?.addEventListener('change', (event) => {
      const target = event.target;
      if (!target?.matches?.('[data-webhook-profile-field], [data-webhook-header-name], [data-webhook-header-value]')) return;
      persistWebhookProfilesFromDom().catch((err) => env.uiLog('error', 'webhook', 'save profile failed', err?.message || err));
    });
    env.webhookProfilesEl?.addEventListener('click', (event) => {
      const action = event.target.closest?.('[data-webhook-action]');
      if (!action) return;
      const card = action.closest('[data-webhook-profile-id]');
      const kind = action.dataset.webhookAction;
      if (kind === 'add-header' && card) {
        const list = card.querySelector('[data-webhook-header-list]');
        if (!list || list.querySelectorAll('[data-webhook-header-row]').length >= (env.Webhook?.MAX_HEADERS || 50)) return;
        list.insertAdjacentHTML('beforeend', webhookHeaderRowHtml());
        list.lastElementChild?.querySelector('[data-webhook-header-name]')?.focus();
      } else if (kind === 'remove-header' && card) {
        action.closest('[data-webhook-header-row]')?.remove();
        persistWebhookProfilesFromDom().catch((err) => env.uiLog('error', 'webhook', 'remove header failed', err?.message || err));
      } else if (kind === 'delete-profile' && card) {
        if (!window.confirm(env.t('webhookDeleteConfirm'))) return;
        const id = card.dataset.webhookProfileId;
        env.settings.webhookProfiles = normalizeWebhookProfiles(env.settings.webhookProfiles)
          .filter((profile) => profile.id !== id);
        saveSettings({ webhookProfiles: env.settings.webhookProfiles })
          .then(() => renderWebhookProfiles())
          .catch((err) => env.uiLog('error', 'webhook', 'delete profile failed', err?.message || err));
      } else if (kind === 'test-profile' && card) {
        testWebhookProfileCard(card).catch((err) => setWebhookStatus(card, String(err?.message || err), true));
      }
    });
  }

  function autoBackupErrorText(code, detail) {
    ensureBound('autoBackupErrorText');

    let base = '';
    switch (code) {
      case 'export_failed':
      case 'build_failed':
        base = env.t('autoBackupErrExport');
        break;
      case 'write_failed':
      case 'busy':
        base = env.t('autoBackupErrWrite');
        break;
      case 'disabled':
        base = env.t('autoBackupErrDisabled');
        break;
      default:
        base = code ? env.t('autoBackupErrWrite') : '';
    }
    if (base && detail) return `${base}: ${detail}`;
    return base;
      
  }

  function folderPathMatchesSubfolder(folderPath, subfolder) {
    ensureBound('folderPathMatchesSubfolder');

    if (!folderPath || !subfolder) return false;
    const norm = String(folderPath).replace(/[/\\]+$/, '');
    const base = norm.split(/[/\\]/).pop() || '';
    return base === subfolder || norm.endsWith('/' + subfolder) || norm.endsWith('\\' + subfolder);
      
  }

  function syncAutoBackupUi() {
    ensureBound('syncAutoBackupUi');

    const ab = normalizeAutoBackup(env.settings.autoBackup);
    env.settings.autoBackup = ab;
    if (env.autoBackupEnabledEl) env.autoBackupEnabledEl.checked = ab.enabled;
    if (env.autoBackupScheduleHourEl) env.autoBackupScheduleHourEl.value = String(ab.scheduleHour);
    if (env.autoBackupScheduleMinuteEl) env.autoBackupScheduleMinuteEl.value = String(ab.scheduleMinute);
    if (env.autoBackupMaxKeepEl) env.autoBackupMaxKeepEl.value = String(ab.maxKeep);
    if (env.autoBackupSubfolderEl && document.activeElement !== env.autoBackupSubfolderEl) {
      env.autoBackupSubfolderEl.value = ab.subfolder;
    }
    const modeRadio =
      env.settingsEl.querySelector(`input[name="autoBackupMode"][value="${ab.mode}"]`) ||
      env.settingsEl.querySelector('input[name="autoBackupMode"][value="lite"]');
    if (modeRadio) modeRadio.checked = true;
      
    if (env.autoBackupLocationLabelEl) {
      if (ab.folderPath && folderPathMatchesSubfolder(ab.folderPath, ab.subfolder)) {
        env.autoBackupLocationLabelEl.textContent = ab.folderPath;
        env.autoBackupLocationLabelEl.style.color = 'var(--text)';
        env.autoBackupLocationLabelEl.setAttribute('title', ab.folderPath);
      } else if (ab.folderPath && !folderPathMatchesSubfolder(ab.folderPath, ab.subfolder)) {
        env.autoBackupLocationLabelEl.textContent = env.t('autoBackupLocationStale');
        env.autoBackupLocationLabelEl.style.color = 'var(--muted)';
        env.autoBackupLocationLabelEl.setAttribute('title', ab.folderPath);
      } else {
        env.autoBackupLocationLabelEl.textContent = env.t('autoBackupLocationPending', {
          subfolder: ab.subfolder || 'TabWall-Backups',
        });
        env.autoBackupLocationLabelEl.style.color = 'var(--muted)';
        env.autoBackupLocationLabelEl.removeAttribute('title');
      }
    }
      
    if (env.autoBackupStatusEl) {
      const parts = [];
      if (ab.lastSuccessAt) {
        parts.push(env.t('autoBackupLastOk', { time: env.formatSavedAt(ab.lastSuccessAt) }));
      }
      if (ab.lastError) {
        const errText = autoBackupErrorText(ab.lastError);
        if (errText) parts.push(errText);
      }
      env.autoBackupStatusEl.textContent = parts.join(' · ');
    }
      
  }

  function autoSaveMetadataFieldOptions(selected) {
    ensureBound('autoSaveMetadataFieldOptions');

    return [
      ['domain', 'autoSaveMetadataDomain'],
      ['title', 'autoSaveMetadataTitleField'],
    ]
      .map(([value, key]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${env.escapeHtml(env.t(key))}</option>`)
      .join('');
      
  }

  function autoSaveMetadataOperatorOptions(selected) {
    ensureBound('autoSaveMetadataOperatorOptions');

    return [
      ['match', 'autoSaveMetadataMatch'],
      ['contains', 'autoSaveMetadataContains'],
      ['startsWith', 'autoSaveMetadataStartsWith'],
      ['endsWith', 'autoSaveMetadataEndsWith'],
      ['regex', 'autoSaveMetadataRegex'],
    ]
      .map(([value, key]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${env.escapeHtml(env.t(key))}</option>`)
      .join('');
      
  }

  function renderAutoSaveMetadataRules() {
    ensureBound('renderAutoSaveMetadataRules');

    if (!env.autoSaveMetadataRulesEl) return;
    env.settings.autoSaveMetadata = normalizeAutoSaveMetadata(env.settings.autoSaveMetadata);
    const rules = env.settings.autoSaveMetadata.rules;
    if (!rules.length) {
      env.autoSaveMetadataRulesEl.innerHTML = `<div class="auto-save-rule-empty">${env.escapeHtml(env.t('autoSaveMetadataEmpty'))}</div>`;
      return;
    }
      
    env.autoSaveMetadataRulesEl.innerHTML = rules.map((rule, ruleIndex) => `
      <article class="auto-save-rule-card" data-auto-save-rule="${ruleIndex}">
        <div class="auto-save-rule-header">
          <label class="inline auto-save-rule-enabled">
            <input type="checkbox" data-auto-save-rule-prop="enabled" ${rule.enabled ? 'checked' : ''} />
            <span>${env.escapeHtml(env.t('autoSaveMetadataRuleEnable'))}</span>
          </label>
          <strong>${env.escapeHtml(env.t('autoSaveMetadataRule', { n: ruleIndex + 1 }))}</strong>
          <button type="button" class="btn auto-save-rule-delete" data-auto-save-action="delete-rule" title="${env.escapeAttr(env.t('autoSaveMetadataDeleteRule'))}">${env.escapeHtml(env.t('delete'))}</button>
        </div>
        <div class="auto-save-rule-row">
          <label class="inline">
            <span>${env.escapeHtml(env.t('autoSaveMetadataLogic'))}</span>
            <select data-auto-save-rule-prop="logic" aria-label="${env.escapeAttr(env.t('autoSaveMetadataLogic'))}">
              <option value="AND"${rule.logic === 'AND' ? ' selected' : ''}>${env.escapeHtml(env.t('autoSaveMetadataAnd'))}</option>
              <option value="OR"${rule.logic === 'OR' ? ' selected' : ''}>${env.escapeHtml(env.t('autoSaveMetadataOr'))}</option>
            </select>
          </label>
        </div>
        <div class="auto-save-condition-heading">
          <span>${env.escapeHtml(env.t('autoSaveMetadataCondition'))}</span>
          <button type="button" class="btn" data-auto-save-action="add-condition">${env.escapeHtml(env.t('autoSaveMetadataAddCondition'))}</button>
        </div>
        <div class="auto-save-condition-list">
          ${rule.conditions.map((condition, conditionIndex) => `
            <div class="auto-save-condition-row" data-auto-save-condition="${conditionIndex}">
              <select data-auto-save-condition-prop="field" aria-label="${env.escapeAttr(env.t('autoSaveMetadataField'))}">${autoSaveMetadataFieldOptions(condition.field)}</select>
              <select data-auto-save-condition-prop="operator" aria-label="${env.escapeAttr(env.t('autoSaveMetadataOperator'))}">${autoSaveMetadataOperatorOptions(condition.operator)}</select>
              <label class="inline auto-save-condition-not">
                <input type="checkbox" data-auto-save-condition-prop="negate" ${condition.negate ? 'checked' : ''} />
                <span>${env.escapeHtml(env.t('autoSaveMetadataNot'))}</span>
              </label>
              <input type="text" class="settings-input auto-save-condition-value" data-auto-save-condition-prop="value" value="${env.escapeAttr(condition.value)}" placeholder="${env.escapeAttr(env.t('autoSaveMetadataValuePh'))}" />
              <button type="button" class="btn auto-save-condition-delete" data-auto-save-action="delete-condition" title="${env.escapeAttr(env.t('autoSaveMetadataDeleteCondition'))}">${env.escapeHtml(env.t('delete'))}</button>
            </div>
          `).join('')}
        </div>
        <div class="auto-save-actions-heading">${env.escapeHtml(env.t('autoSaveMetadataActions'))}</div>
        <label class="auto-save-note-field">
          <span>${env.escapeHtml(env.t('autoSaveMetadataNote'))}</span>
          <textarea class="settings-textarea" rows="3" data-auto-save-rule-prop="note" placeholder="${env.escapeAttr(env.t('autoSaveMetadataNotePh'))}">${env.escapeHtml(rule.note)}</textarea>
        </label>
        <div class="auto-save-tags-field">
          <span>${env.escapeHtml(env.t('autoSaveMetadataTags'))}</span>
          <div class="auto-save-tag-editor">
            <div class="auto-save-tag-list">
              ${rule.tags.map((tag, tagIndex) => `
                <span class="tag-chip auto-save-tag-chip">${env.escapeHtml(tag)}<button type="button" aria-label="${env.escapeAttr(env.t('autoSaveMetadataRemoveTag'))}" data-auto-save-action="remove-tag" data-auto-save-tag-index="${tagIndex}">${env.iconSvg('close')}</button></span>
              `).join('')}
              <input type="text" class="settings-input auto-save-tag-input" data-auto-save-tag-input data-rule-index="${ruleIndex}" placeholder="${env.escapeAttr(env.t('autoSaveMetadataTagPh'))}" autocomplete="off" />
            </div>
          </div>
        </div>
      </article>
    `).join('');
      
  }

  function syncAutoSaveMetadataUi() {
    ensureBound('syncAutoSaveMetadataUi');

    env.settings.autoSaveMetadata = normalizeAutoSaveMetadata(env.settings.autoSaveMetadata);
    if (env.autoSaveMetadataEnabledEl) env.autoSaveMetadataEnabledEl.checked = env.settings.autoSaveMetadata.enabled;
    renderAutoSaveMetadataRules();
      
  }

  async function persistAutoSaveMetadata() {
    ensureBound('persistAutoSaveMetadata');

    env.settings.autoSaveMetadata = normalizeAutoSaveMetadata(env.settings.autoSaveMetadata);
    await saveSettings({ autoSaveMetadata: env.settings.autoSaveMetadata });
      
  }

  async function commitAutoSaveMetadataTag(input) {
    ensureBound('commitAutoSaveMetadataTag');

    const raw = input?.value?.trim() || '';
    if (!raw) return;
    const ruleIndex = Number(input.dataset.ruleIndex);
    const rule = env.settings.autoSaveMetadata.rules[ruleIndex];
    if (!rule) return;
    if (!rule.tags.includes(raw)) rule.tags.push(raw);
    input.value = '';
    renderAutoSaveMetadataRules();
    await persistAutoSaveMetadata();
      
  }

  function initAutoSaveMetadataUi() {
    ensureBound('initAutoSaveMetadataUi');

    env.autoSaveMetadataEnabledEl?.addEventListener('change', async () => {
      env.settings.autoSaveMetadata.enabled = env.autoSaveMetadataEnabledEl.checked;
      await persistAutoSaveMetadata();
    });
      
    env.autoSaveMetadataAddRuleBtn?.addEventListener('click', async () => {
      if (env.settings.autoSaveMetadata.rules.length >= env.AUTO_SAVE_METADATA_MAX_RULES) return;
      env.settings.autoSaveMetadata.rules.push(newAutoSaveMetadataRule());
      await persistAutoSaveMetadata();
      renderAutoSaveMetadataRules();
    });
      
    env.autoSaveMetadataRulesEl?.addEventListener('click', async (event) => {
      const action = event.target.closest?.('[data-auto-save-action]');
      if (!action) return;
      const card = action.closest('[data-auto-save-rule]');
      if (!card) return;
      const ruleIndex = Number(card.dataset.autoSaveRule);
      const rule = env.settings.autoSaveMetadata.rules[ruleIndex];
      if (!rule) return;
      
      if (action.dataset.autoSaveAction === 'add-condition') {
        if (rule.conditions.length >= env.AUTO_SAVE_METADATA_MAX_CONDITIONS) return;
        rule.conditions.push({ field: 'domain', operator: 'contains', negate: false, value: '' });
      } else if (action.dataset.autoSaveAction === 'delete-condition') {
        const conditionRow = action.closest('[data-auto-save-condition]');
        const conditionIndex = Number(conditionRow?.dataset.autoSaveCondition);
        if (Number.isInteger(conditionIndex)) rule.conditions.splice(conditionIndex, 1);
      } else if (action.dataset.autoSaveAction === 'delete-rule') {
        env.settings.autoSaveMetadata.rules.splice(ruleIndex, 1);
      } else if (action.dataset.autoSaveAction === 'remove-tag') {
        const tagIndex = Number(action.dataset.autoSaveTagIndex);
        if (Number.isInteger(tagIndex)) rule.tags.splice(tagIndex, 1);
      } else {
        return;
      }
      await persistAutoSaveMetadata();
      renderAutoSaveMetadataRules();
    });
      
    env.autoSaveMetadataRulesEl?.addEventListener('change', async (event) => {
      const tagInput = event.target.closest?.('[data-auto-save-tag-input]');
      if (tagInput) {
        await commitAutoSaveMetadataTag(tagInput);
        return;
      }
      const card = event.target.closest?.('[data-auto-save-rule]');
      if (!card) return;
      const ruleIndex = Number(card.dataset.autoSaveRule);
      const rule = env.settings.autoSaveMetadata.rules[ruleIndex];
      if (!rule) return;
      const ruleProp = event.target.closest?.('[data-auto-save-rule-prop]')?.dataset.autoSaveRuleProp;
      if (ruleProp) {
        rule[ruleProp] = ruleProp === 'enabled' ? event.target.checked : event.target.value;
        await persistAutoSaveMetadata();
        return;
      }
      const condition = event.target.closest?.('[data-auto-save-condition]');
      const conditionProp = event.target.closest?.('[data-auto-save-condition-prop]')?.dataset.autoSaveConditionProp;
      if (!condition || !conditionProp) return;
      const conditionIndex = Number(condition.dataset.autoSaveCondition);
      if (!rule.conditions[conditionIndex]) return;
      rule.conditions[conditionIndex][conditionProp] = conditionProp === 'negate'
        ? event.target.checked
        : event.target.value;
      await persistAutoSaveMetadata();
    });
      
    env.autoSaveMetadataRulesEl?.addEventListener('keydown', async (event) => {
      const input = event.target.closest?.('[data-auto-save-tag-input]');
      if (!input || (event.key !== 'Enter' && event.key !== 'Tab')) return;
      if (!input.value.trim()) return;
      event.preventDefault();
      await commitAutoSaveMetadataTag(input);
    });
      
  }

  async function refreshChromeCommandLabels() {
    ensureBound('refreshChromeCommandLabels');

    const res = await env.sendMessage({ type: 'GET_COMMANDS' });
    const byName = new Map(
      (res.ok && Array.isArray(res.commands) ? res.commands : []).map((c) => [c.name, c])
    );
    document.querySelectorAll('[data-chrome-cmd]').forEach((el) => {
      const name = el.getAttribute('data-chrome-cmd');
      const cmd = byName.get(name);
      const sc = cmd?.shortcut || '';
      el.textContent = sc
        ? env.t('shortcutsChromeBound', { s: sc })
        : env.t('shortcutsChromeUnbound');
    });
      
  }

  function refreshChromeCommandLabelsOnFocus() {
    ensureBound('refreshChromeCommandLabelsOnFocus');

    if (document.visibilityState !== 'visible') return;
    refreshChromeCommandLabels().catch(() => {});
      
  }

  async function openChromeShortcutsForApply() {
    ensureBound('openChromeShortcutsForApply');

    const res = await env.sendMessage({ type: 'OPEN_SHORTCUTS_PAGE' });
    env.showCopyToast(
      res?.ok ? env.t('shortcutsChromeOpened') : env.t('shortcutsChromeOpenFailed')
    );
      
  }

  function initChromeShortcutsUi() {
    ensureBound('initChromeShortcutsUi');

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
    ensureBound('initSettingsUi');

    env.settings = await loadSettings();
      
    // On open: apply default view if we want fresh open behavior
    // Use stored viewMode if user toggled; defaultViewMode applied when viewMode missing
    if (!env.settings.viewMode) {
      env.settings.viewMode = env.settings.defaultViewMode || 'canvas';
    }
      
    syncSettingsUi();
    initAutoSaveMetadataUi();
    initWebhookProfilesUi();
      
    try {
      env.versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
    } catch {
      env.versionBadge.textContent = 'v—';
    }
      
    env.settingsEl.querySelectorAll('input[name="afterSave"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) await saveSettings({ afterSave: input.value });
      });
    });
      
    env.settingsPreSaveEdit?.addEventListener('change', async () => {
      await saveSettings({ preSaveEdit: env.settingsPreSaveEdit.checked });
    });

    env.settingsNewTabOverride?.addEventListener('change', async () => {
      await saveSettings({ newTabOverride: env.settingsNewTabOverride.checked });
    });
      
    env.settingsEl.querySelectorAll('input[name="afterSaveGroup"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) await saveSettings({ afterSaveGroup: input.value });
      });
    });
      
    env.settingsEl.querySelectorAll('input[name="saveGroupCapture"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) await saveSettings({ saveGroupCapture: input.value });
      });
    });
      
    env.settingsEl.querySelectorAll('input[name="restoreGroupIn"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) await saveSettings({ restoreGroupIn: input.value });
      });
    });
      
    // Auto backup controls
    env.autoBackupEnabledEl?.addEventListener('change', async () => {
      await saveSettings({ autoBackup: { enabled: env.autoBackupEnabledEl.checked } });
      syncAutoBackupUi();
    });
    env.autoBackupSubfolderEl?.addEventListener('change', async () => {
      const subfolder = sanitizeSubfolder(env.autoBackupSubfolderEl.value);
      env.autoBackupSubfolderEl.value = subfolder;
      // Clear stale absolute path from older FS-access / old subfolder
      await saveSettings({ autoBackup: { subfolder, folderPath: '' } });
      syncAutoBackupUi();
    });
    const saveAutoBackupSchedule = async () => {
      const scheduleHour = env.clampInt(env.autoBackupScheduleHourEl?.value, 0, 23, 0);
      const scheduleMinute = Number(env.autoBackupScheduleMinuteEl?.value) === 30 ? 30 : 0;
      if (env.autoBackupScheduleHourEl) env.autoBackupScheduleHourEl.value = String(scheduleHour);
      if (env.autoBackupScheduleMinuteEl) env.autoBackupScheduleMinuteEl.value = String(scheduleMinute);
      await saveSettings({ autoBackup: { scheduleHour, scheduleMinute } });
    };
    env.autoBackupScheduleHourEl?.addEventListener('change', saveAutoBackupSchedule);
    env.autoBackupScheduleMinuteEl?.addEventListener('change', saveAutoBackupSchedule);
    env.autoBackupMaxKeepEl?.addEventListener('change', async () => {
      const maxKeep = env.clampInt(env.autoBackupMaxKeepEl.value, 1, 99, 5);
      env.autoBackupMaxKeepEl.value = String(maxKeep);
      await saveSettings({ autoBackup: { maxKeep } });
    });
    env.settingsEl.querySelectorAll('input[name="autoBackupMode"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) {
          await saveSettings({ autoBackup: { mode: input.value === 'full' ? 'full' : 'lite' } });
        }
      });
    });
    env.autoBackupNowBtn?.addEventListener('click', async () => {
      await env.runLocalAutoBackup({ force: true });
    });
    env.autoBackupShowFolderBtn?.addEventListener('click', async () => {
      await env.sendMessage({ type: 'AUTO_BACKUP_SHOW_FOLDER' });
    });
      
    env.settingsEl.querySelectorAll('input[name="theme"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) {
          await saveSettings({ theme: input.value });
          applyTheme(input.value);
        }
      });
    });

    const wallpaperFile = document.getElementById('settingsWallpaperFile');
    document.getElementById('settingsWallpaperUpload')?.addEventListener('click', () => {
      wallpaperFile?.click();
    });
    wallpaperFile?.addEventListener('change', async () => {
      const file = wallpaperFile.files && wallpaperFile.files[0];
      wallpaperFile.value = '';
      if (!file || !env.Wallpaper) return;
      env.Wallpaper.setStatus(env.t('wallpaperProcessing'));
      try {
        const wallpaper = await env.Wallpaper.setFromFile(file);
        await saveSettings({ wallpaper });
        await env.Wallpaper.apply(wallpaper);
        env.Wallpaper.setStatus('');
      } catch (err) {
        env.Wallpaper.setStatus(env.formatNoteMediaError(err?.code || err?.message || err));
      }
    });
    document.getElementById('settingsWallpaperRemove')?.addEventListener('click', async () => {
      if (!env.Wallpaper) return;
      const wallpaper = await env.Wallpaper.clear();
      await saveSettings({ wallpaper });
      env.Wallpaper.setStatus(env.t('wallpaperNone'));
    });
    env.settingsEl.querySelectorAll('input[name="wallpaperFit"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (!input.checked || !env.Wallpaper) return;
        const wallpaper = env.Wallpaper.normalizeWallpaper({
          ...env.settings.wallpaper,
          fit: input.value,
        });
        await saveSettings({ wallpaper });
        await env.Wallpaper.apply(wallpaper);
      });
    });
    const persistWallpaperSlider = async (partial) => {
      if (!env.Wallpaper) return;
      const wallpaper = env.Wallpaper.normalizeWallpaper({
        ...env.settings.wallpaper,
        ...partial,
      });
      await saveSettings({ wallpaper });
      await env.Wallpaper.apply(wallpaper);
    };
    const blurInput = document.getElementById('settingsWallpaperBlur');
    const blurValue = document.getElementById('settingsWallpaperBlurValue');
    blurInput?.addEventListener('input', () => {
      if (blurValue) blurValue.textContent = blurInput.value;
    });
    blurInput?.addEventListener('change', async () => {
      await persistWallpaperSlider({ blurPx: Number(blurInput.value) });
    });
    const opacityInput = document.getElementById('settingsWallpaperOpacity');
    const opacityValue = document.getElementById('settingsWallpaperOpacityValue');
    opacityInput?.addEventListener('input', () => {
      if (opacityValue) opacityValue.textContent = opacityInput.value;
    });
    opacityInput?.addEventListener('change', async () => {
      await persistWallpaperSlider({ opacity: Number(opacityInput.value) });
    });

    env.settingsEl.querySelectorAll('input[name="fxLevel"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) {
          const fxLevel = normalizeFxLevel(input.value);
          await saveSettings({ fxLevel });
          applyFxLevel(fxLevel);
        }
      });
    });
      
    env.settingsEl.querySelectorAll('input[name="locale"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) {
          await saveSettings({ locale: input.value });
          env.applyI18n();
          syncViewModeButton(env.settings.viewMode);
          renderWebhookProfiles();
          env.renderGrid();
        }
      });
    });
      
    env.settingsEl.querySelectorAll('input[name="defaultViewMode"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (input.checked) {
          await saveSettings({
            defaultViewMode: input.value,
            viewMode: input.value,
          });
          applyViewMode(input.value);
          env.renderGrid();
        }
      });
    });
      
    const settingsCanvasSnap = document.getElementById('settingsCanvasSnap');
    settingsCanvasSnap?.addEventListener('change', async () => {
      env.canvasSnapToGrid = settingsCanvasSnap.checked;
      await saveSettings({ canvasSnap: env.canvasSnapToGrid });
    });
    document.getElementById('settingsCanvasResetView')?.addEventListener('click', () => {
      document.getElementById('canvasResetView')?.click();
    });
      
    env.openWithSearchFocusEl.addEventListener('change', async () => {
      await saveSettings({ openWithSearchFocus: env.openWithSearchFocusEl.checked });
    });
      
    env.settingsCardCols.addEventListener('input', () => {
      applyCardCols(env.settingsCardCols.value);
    });
    env.settingsCardCols.addEventListener('change', async () => {
      await saveSettings({ cardCols: env.clampCols(env.settingsCardCols.value) });
    });
      
    env.sortByEl?.addEventListener('change', async () => {
      const sortBy = env.normalizeSortBy(env.sortByEl.value);
      env.sortByEl.value = sortBy;
      await saveSettings({ sortBy });
      env.renderGrid();
    });
    env.canvasOrganizePanel?.querySelectorAll('[data-canvas-arrange]').forEach((button) => {
      button.addEventListener('click', () => env.arrangeCanvas(button.dataset.canvasArrange));
    });
      
    initChromeShortcutsUi();
    env.initDedupeUi();
    env.initQuickCaptureUi();
    env.initAiUi?.();
    initSettingsSections();
      
    if (env.settings.openWithSearchFocus) {
      setTimeout(() => env.searchEl.focus(), 50);
    }
      
    // Resume conflict modal if SW queued one before park loaded
    env.sendMessage({ type: 'GET_PENDING_CONFLICT' }).then((res) => {
      if (res?.ok && res.conflict) env.openConflictModal(res.conflict);
    });
    // Resume pre-save edit panel if SW queued one before park loaded (or the SW restarted mid-edit)
    env.sendMessage({ type: 'GET_PENDING_PRESAVE' }).then((res) => {
      if (res?.ok && res.preSave) env.openPreSaveModal(res.preSave);
    });
      
  }

  function applySettingsSection(section = 'general') {
    ensureBound('applySettingsSection');

    const allowed = new Set(['general', 'automation', 'canvas', 'display', 'backup', 'ai', 'webhook', 'shortcuts', 'diagnostic']);
    env.settingsSection = allowed.has(section) ? section : 'general';
    env.settingsEl?.querySelectorAll('.settings-block[data-settings-section]').forEach((block) => {
      block.hidden = block.dataset.settingsSection !== env.settingsSection;
    });
    env.settingsNav?.querySelectorAll('.settings-nav-btn[data-settings-section]').forEach((button) => {
      const active = button.dataset.settingsSection === env.settingsSection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
      
  }

  function initSettingsSections() {
    ensureBound('initSettingsSections');

    env.settingsNav?.querySelectorAll('.settings-nav-btn[data-settings-section]').forEach((button) => {
      button.addEventListener('click', () => applySettingsSection(button.dataset.settingsSection));
    });
    env.settingsDoneBtn?.addEventListener('click', () => closeSettingsBox());
    applySettingsSection(env.settingsSection);
      
  }

  function openSettingsBox() {
    ensureBound('openSettingsBox');

    env.closeAllFloatsExcept('settings');
    env.settingsBox.classList.add('open');
    env.settingsBox.setAttribute('aria-hidden', 'false');
    env.settingsBtn.classList.add('active');
    applySettingsSection(env.settingsSection);
    env.syncFloatBackdrop();
    refreshChromeCommandLabels();
    syncAutoBackupUi();
    env.refreshDiagLogPanel().catch(() => {});
      
  }

  function closeSettingsBox(sync = true) {
    ensureBound('closeSettingsBox');

    env.settingsBox.classList.remove('open');
    env.settingsBox.setAttribute('aria-hidden', 'true');
    env.settingsBtn.classList.remove('active');
    if (sync) env.syncFloatBackdrop();
      
  }

  global.TabWallSettingsUi = {
    bind,
    newAutoSaveMetadataRuleId,
    normalizeAutoSaveMetadataTags,
    normalizeAutoSaveMetadataCondition,
    normalizeAutoSaveMetadataRule,
    normalizeAutoSaveMetadata,
    normalizeAiSettings,
    newAutoSaveMetadataRule,
    sanitizeSubfolder,
    normalizeAutoBackup,
    loadSettings,
    saveSettings,
    applyTheme,
    applyFxLevel,
    applyCanvasRailUi,
    syncViewModeButton,
    applyViewMode,
    applyCardCols,
    updateSavedBadge,
    syncPinnedFilterUi,
    syncSettingsUi,
    autoBackupErrorText,
    folderPathMatchesSubfolder,
    syncAutoBackupUi,
    autoSaveMetadataFieldOptions,
    autoSaveMetadataOperatorOptions,
    renderAutoSaveMetadataRules,
    syncAutoSaveMetadataUi,
    persistAutoSaveMetadata,
    commitAutoSaveMetadataTag,
    initAutoSaveMetadataUi,
    renderWebhookProfiles,
    syncWebhookProfilesUi,
    initWebhookProfilesUi,
    refreshChromeCommandLabels,
    refreshChromeCommandLabelsOnFocus,
    openChromeShortcutsForApply,
    initChromeShortcutsUi,
    initSettingsUi,
    applySettingsSection,
    initSettingsSections,
    openSettingsBox,
    closeSettingsBox
  };
})(typeof self !== 'undefined' ? self : globalThis);
