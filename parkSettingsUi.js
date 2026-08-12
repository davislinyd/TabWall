/**
 * TabWall parkSettingsUi — TabWallSettingsUi.
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
    if (!env) throw new Error('TabWallSettingsUi.' + name + ' used before bind()');
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

  function normalizeIntervalUnit(u) {
    ensureBound('normalizeIntervalUnit');

    if (u === 'minute' || u === 'minutes') return 'minute';
    if (u === 'day' || u === 'days') return 'day';
    return 'hour';
      
  }

  function intervalValueBounds(unit) {
    ensureBound('intervalValueBounds');

    if (unit === 'minute') return { min: 10, max: 1440, fallback: 60 };
    if (unit === 'day') return { min: 1, max: 7, fallback: 1 };
    return { min: 1, max: 168, fallback: 24 };
      
  }

  function normalizeAutoBackup(raw) {
    ensureBound('normalizeAutoBackup');

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
      intervalValue: env.clampInt(valueRaw, bounds.min, bounds.max, bounds.fallback),
      maxKeep: env.clampInt(o.maxKeep, 1, 99, 5),
      subfolder,
      folderPath: typeof o.folderPath === 'string' ? o.folderPath : '',
      lastSuccessAt: Number(o.lastSuccessAt) || 0,
      lastError: typeof o.lastError === 'string' ? o.lastError : '',
      dirtyAt: Number(o.dirtyAt) || 0,
    };
      
  }

  function autoBackupIntervalMinutes(ab) {
    ensureBound('autoBackupIntervalMinutes');

    const n = normalizeAutoBackup(ab);
    if (n.intervalUnit === 'minute') return n.intervalValue;
    if (n.intervalUnit === 'day') return n.intervalValue * 24 * 60;
    return n.intervalValue * 60;
      
  }

  function syncIntervalInputBounds() {
    ensureBound('syncIntervalInputBounds');

    if (!env.autoBackupIntervalValueEl || !env.autoBackupIntervalUnitEl) return;
    const unit = normalizeIntervalUnit(env.autoBackupIntervalUnitEl.value);
    const bounds = intervalValueBounds(unit);
    env.autoBackupIntervalValueEl.min = String(bounds.min);
    env.autoBackupIntervalValueEl.max = String(bounds.max);
    const v = env.clampInt(env.autoBackupIntervalValueEl.value, bounds.min, bounds.max, bounds.fallback);
    env.autoBackupIntervalValueEl.value = String(v);
      
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
    merged.sortBy = env.normalizeSortBy(merged.sortBy);
    // Local shortcut settings were removed; discard the legacy field on the next write.
    delete merged.shortcuts;
    merged.autoBackup = normalizeAutoBackup({
      ...env.DEFAULT_AUTO_BACKUP,
      ...(merged.autoBackup || {}),
    });
    merged.autoSaveMetadata = normalizeAutoSaveMetadata(merged.autoSaveMetadata);
    merged.canvasSnap = merged.canvasSnap !== false;
    merged.fxLevel = normalizeFxLevel(merged.fxLevel);
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
      patch.autoBackup = normalizeAutoBackup({ ...env.settings.autoBackup, ...patch.autoBackup });
    }
    if (patch.autoSaveMetadata) {
      patch.autoSaveMetadata = normalizeAutoSaveMetadata(patch.autoSaveMetadata);
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
    if (!isCanvas) env.canvasSearchPreview = null;
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
    applyViewMode(env.settings.viewMode);
    applyCardCols(env.settings.cardCols);
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
      
    env.applyI18n();
    refreshChromeCommandLabels();
    env.syncSearchRegexUi();
      
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
    if (env.autoBackupOnChangeEl) env.autoBackupOnChangeEl.checked = ab.onChange;
    if (env.autoBackupIntervalUnitEl) env.autoBackupIntervalUnitEl.value = ab.intervalUnit;
    if (env.autoBackupIntervalValueEl) {
      env.autoBackupIntervalValueEl.value = String(ab.intervalValue);
      syncIntervalInputBounds();
      env.autoBackupIntervalValueEl.value = String(ab.intervalValue);
    }
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
    env.autoBackupOnChangeEl?.addEventListener('change', async () => {
      await saveSettings({ autoBackup: { onChange: env.autoBackupOnChangeEl.checked } });
    });
    env.autoBackupSubfolderEl?.addEventListener('change', async () => {
      const subfolder = sanitizeSubfolder(env.autoBackupSubfolderEl.value);
      env.autoBackupSubfolderEl.value = subfolder;
      // Clear stale absolute path from older FS-access / old subfolder
      await saveSettings({ autoBackup: { subfolder, folderPath: '' } });
      syncAutoBackupUi();
    });
    env.autoBackupIntervalUnitEl?.addEventListener('change', async () => {
      const unit = normalizeIntervalUnit(env.autoBackupIntervalUnitEl.value);
      const bounds = intervalValueBounds(unit);
      const value = env.clampInt(env.autoBackupIntervalValueEl?.value, bounds.min, bounds.max, bounds.fallback);
      if (env.autoBackupIntervalValueEl) env.autoBackupIntervalValueEl.value = String(value);
      syncIntervalInputBounds();
      await saveSettings({ autoBackup: { intervalUnit: unit, intervalValue: value } });
    });
    env.autoBackupIntervalValueEl?.addEventListener('change', async () => {
      const unit = normalizeIntervalUnit(env.autoBackupIntervalUnitEl?.value || 'hour');
      const bounds = intervalValueBounds(unit);
      const value = env.clampInt(env.autoBackupIntervalValueEl.value, bounds.min, bounds.max, bounds.fallback);
      env.autoBackupIntervalValueEl.value = String(value);
      await saveSettings({ autoBackup: { intervalUnit: unit, intervalValue: value } });
    });
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

    const allowed = new Set(['general', 'automation', 'canvas', 'display', 'backup', 'shortcuts', 'diagnostic']);
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
    newAutoSaveMetadataRule,
    sanitizeSubfolder,
    normalizeIntervalUnit,
    intervalValueBounds,
    normalizeAutoBackup,
    autoBackupIntervalMinutes,
    syncIntervalInputBounds,
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
