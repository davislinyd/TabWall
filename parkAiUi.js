/**
 * TabWall AI panel adapter for the park.html surface.
 * Shared port protocol and safe rendering live in aiUiCore.js.
 */
(function (global) {
  'use strict';

  let env = null;
  let core = null;
  let initialized = false;

  function ensureBound(name) {
    if (!env || !core) throw new Error(`TabWallAiUi.${name} used before bind()`);
  }

  function isEditableTarget(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element) return false;
    const tag = String(element.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
  }

  function isAiPanelHotkey(event) {
    const shared = global.TabWallAiCore?.isOptionLetterHotkey;
    if (typeof shared === 'function') return shared(event, 'KeyA');
    return Boolean(
      event && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey &&
      event.code === 'KeyA' && !event.repeat && !event.isComposing && event.keyCode !== 229
    );
  }

  function showUiOnly() {
    if (!env?.aiBox) return;
    env.aiBox.classList.add('open');
    env.aiBox.setAttribute('aria-hidden', 'false');
    env.aiBtn?.classList.add('active');
    env.syncFloatBackdrop?.();
  }

  function hideUiOnly() {
    if (!env?.aiBox) return;
    env.aiBox.classList.remove('open');
    env.aiBox.setAttribute('aria-hidden', 'true');
    env.aiBtn?.classList.remove('active');
    env.syncFloatBackdrop?.();
  }

  function bind(next) {
    if (!next || typeof next !== 'object') return;
    env = next;
    core = global.TabWallAiCore?.create?.({
      env,
      document: global.document,
      t: (key, vars) => env.t(key, vars),
      getSettings: () => env.settings?.ai || {},
      getBridgeToken: () => env.aiBridgeToken?.value || '',
      showUi: showUiOnly,
      hideUi: hideUiOnly,
    }) || null;
  }

  function getSettings() {
    ensureBound('getSettings');
    const raw = env.settings?.ai && typeof env.settings.ai === 'object' ? env.settings.ai : {};
    return {
      enabled: raw.enabled === true,
      baseUrl: String(raw.baseUrl || 'http://127.0.0.1:8080/v1'),
      model: String(raw.model || ''),
      bridgeUrl: String(raw.bridgeUrl || 'http://127.0.0.1:8787'),
      timeoutMs: Number(raw.timeoutMs) || 120000,
      contextSize: Number(raw.contextSize) || 8192,
      allowedBridgeTools: Array.isArray(raw.allowedBridgeTools) ? raw.allowedBridgeTools : [],
    };
  }

  function openAiBox() {
    ensureBound('openAiBox');
    env.closeAllFloatsExcept?.('ai');
    showUiOnly();
    core.open();
    if (env.aiInput) setTimeout(() => env.aiInput.focus(), 0);
  }

  function closeAiBox(sync = true) {
    ensureBound('closeAiBox');
    core.dismiss();
    if (sync) env.syncFloatBackdrop?.();
  }

  function parseAllowedTools(value) {
    return [...new Set(String(value || '')
      .split(/[\s,]+/)
      .map((name) => name.trim())
      .filter((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name)))].slice(0, 100);
  }

  async function testConnection() {
    ensureBound('testConnection');
    const button = env.aiTestConnectionBtn;
    if (button) button.disabled = true;
    if (env.aiConnectionStatus) env.aiConnectionStatus.textContent = env.t('aiTesting');
    try {
      const response = await env.sendMessage({
        type: 'AI_HEALTH',
        bridgeToken: String(env.aiBridgeToken?.value || '').trim(),
      });
      const llm = response?.llm?.ok
        ? env.t('aiLlmOk', { n: (response.llm.models || []).length })
        : env.t('aiLlmFailed');
      const bridge = response?.bridge?.ok
        ? env.t('aiBridgeOk', { n: (response.bridge.tools || []).length })
        : env.t('aiBridgeUnavailable');
      if (env.aiConnectionStatus) env.aiConnectionStatus.textContent = `${llm} · ${bridge}`;
    } catch (err) {
      if (env.aiConnectionStatus) env.aiConnectionStatus.textContent = `${env.t('aiError')}: ${err?.message || err}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function persistAiSettings() {
    ensureBound('persistAiSettings');
    await env.saveSettings({
      ai: {
        enabled: Boolean(env.settingsAiEnabled?.checked),
        baseUrl: env.settingsAiBaseUrl?.value || '',
        model: env.settingsAiModel?.value || '',
        bridgeUrl: env.settingsAiBridgeUrl?.value || '',
        contextSize: env.settingsAiContextSize?.value || '',
        allowedBridgeTools: parseAllowedTools(env.settingsAiAllowedTools?.value || ''),
      },
    });
    syncSettingsUi();
  }

  function syncSettingsUi() {
    if (!env?.settingsAiEnabled) return;
    const settings = getSettings();
    env.settingsAiEnabled.checked = settings.enabled;
    env.settingsAiBaseUrl.value = settings.baseUrl;
    env.settingsAiModel.value = settings.model;
    env.settingsAiBridgeUrl.value = settings.bridgeUrl;
    if (env.settingsAiContextSize) env.settingsAiContextSize.value = String(settings.contextSize);
    env.settingsAiAllowedTools.value = settings.allowedBridgeTools.join(', ');
  }

  function handleAiShortcut(event) {
    if (!isAiPanelHotkey(event)) return;
    if (isEditableTarget(event.target) && event.target !== env?.aiInput) return;
    event.preventDefault();
    event.stopPropagation();
    openAiBox();
  }

  function init() {
    ensureBound('init');
    if (initialized) return;
    initialized = true;
    env.aiBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (env.aiBox.classList.contains('open')) closeAiBox();
      else openAiBox();
    });
    env.aiCloseX?.addEventListener('click', () => closeAiBox());
    env.aiTestConnectionBtn?.addEventListener('click', testConnection);
    ['change', 'blur'].forEach((eventName) => {
      [env.settingsAiEnabled, env.settingsAiBaseUrl, env.settingsAiModel, env.settingsAiBridgeUrl, env.settingsAiContextSize, env.settingsAiAllowedTools]
        .filter(Boolean)
        .forEach((input) => input.addEventListener(eventName, () => persistAiSettings().catch(() => {})));
    });
    env.setupFloatDrag?.(env.aiDrag, env.aiBox);
    global.document?.addEventListener('keydown', handleAiShortcut, true);
    core.init();
    syncSettingsUi();
  }

  global.TabWallAiUi = {
    bind,
    init,
    openAiBox,
    closeAiBox,
    syncSettingsUi,
    parseAllowedTools,
    isAiPanelHotkey,
    handleAiShortcut,
  };
})(typeof self !== 'undefined' ? self : globalThis);
