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
      saveSelection: persistSelection,
      showUi: showUiOnly,
      hideUi: hideUiOnly,
    }) || null;
  }

  function getSettings() {
    ensureBound('getSettings');
    return env.settings?.ai && typeof env.settings.ai === 'object' ? env.settings.ai : {};
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

  function newProviderId() {
    try {
      return `provider-${global.crypto?.randomUUID?.().replace(/-/g, '') || ''}`.slice(0, 64);
    } catch {
      return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function parseHeaders(value) {
    return String(value || '').split(/\r?\n/).map((line) => {
      const index = line.indexOf(':');
      return index > 0 ? { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() } : null;
    }).filter(Boolean);
  }

  function providerField(card, field, fallback = '') {
    return card?.querySelector?.(`[data-ai-provider-field="${field}"]`)?.value || fallback;
  }

  function readProviderForms() {
    if (!env.settingsAiProviders?.querySelectorAll) return getSettings().providers || [];
    return [...env.settingsAiProviders.querySelectorAll('[data-ai-provider-id]')].map((card) => ({
      id: card.dataset.aiProviderId,
      name: providerField(card, 'name', 'OpenAI-compatible'),
      baseUrl: providerField(card, 'baseUrl'),
      model: providerField(card, 'model'),
      bearerToken: providerField(card, 'bearerToken'),
      headers: parseHeaders(providerField(card, 'headers')),
      models: String(card.dataset.models || '').split('\n').filter(Boolean),
      bypassConfirmations: card.querySelector?.('[data-ai-provider-field="bypassConfirmations"]')?.checked === true,
    }));
  }

  function addProviderField(card, label, field, value, type = 'text', secret = false) {
    const row = global.document.createElement('label');
    row.className = 'inline';
    const text = global.document.createElement('span');
    text.textContent = label;
    const input = global.document.createElement(type === 'textarea' ? 'textarea' : 'input');
    input.className = type === 'textarea' ? 'settings-textarea' : 'settings-input';
    input.dataset.aiProviderField = field;
    input.value = value || '';
    if (type !== 'textarea') input.type = type;
    if (secret) {
      input.autocomplete = 'new-password';
      input.setAttribute('data-1p-ignore', 'true');
      input.setAttribute('data-lpignore', 'true');
      input.setAttribute('data-bwignore', 'true');
    }
    row.append(text, input);
    card.appendChild(row);
  }

  function addProviderModelField(card, provider) {
    const row = global.document.createElement('label');
    row.className = 'inline';
    const text = global.document.createElement('span');
    text.textContent = env.t('aiModel');
    const select = global.document.createElement('select');
    select.className = 'settings-input';
    select.dataset.aiProviderField = 'model';
    const models = [...new Set([provider.model, ...(provider.models || [])].filter(Boolean))];
    const placeholder = global.document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = env.t('aiNoModels');
    select.appendChild(placeholder);
    for (const model of models) {
      const option = global.document.createElement('option');
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    }
    select.value = provider.model || '';
    select.disabled = models.length === 0;
    row.append(text, select);
    card.appendChild(row);
  }

  function addProviderBypassField(card, provider) {
    const row = global.document.createElement('label');
    row.className = 'inline';
    const text = global.document.createElement('span');
    text.textContent = env.t('aiBypassConfirmations');
    const input = global.document.createElement('input');
    input.type = 'checkbox';
    input.dataset.aiProviderField = 'bypassConfirmations';
    input.checked = provider.bypassConfirmations === true;
    row.append(text, input);
    card.appendChild(row);
  }

  function renderProviders() {
    const container = env.settingsAiProviders;
    if (!container?.replaceChildren || !global.document?.createElement) return;
    container.replaceChildren();
    for (const provider of getSettings().providers || []) {
      const card = global.document.createElement('section');
      card.className = 'ai-provider-card';
      card.dataset.aiProviderId = provider.id;
      card.dataset.models = (provider.models || []).join('\n');
      addProviderField(card, env.t('aiProviderName'), 'name', provider.name);
      addProviderField(card, env.t('aiEndpoint'), 'baseUrl', provider.baseUrl, 'url');
      addProviderModelField(card, provider);
      addProviderField(card, env.t('aiBearerToken'), 'bearerToken', provider.bearerToken, 'password', true);
      addProviderField(card, env.t('aiHeaders'), 'headers', (provider.headers || []).map((header) => `${header.name}: ${header.value}`).join('\n'), 'textarea');
      addProviderBypassField(card, provider);
      const models = global.document.createElement('p');
      models.className = 'hint';
      models.textContent = provider.models?.length
        ? env.t('aiModelsAvailable', { n: provider.models.length })
        : env.t('aiNoModels');
      card.appendChild(models);
      const check = global.document.createElement('button');
      check.type = 'button';
      check.className = 'btn';
      check.textContent = env.t('aiTestConnection');
      check.addEventListener('click', () => testConnection(provider.id, check).catch(() => {}));
      card.appendChild(check);
      if (provider.id !== 'local-llama-cpp') {
        const remove = global.document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn';
        remove.textContent = env.t('aiRemoveProvider');
        remove.addEventListener('click', () => {
          card.remove();
          persistAiSettings().catch(() => {});
        });
        card.appendChild(remove);
      }
      container.appendChild(card);
    }
  }

  async function testConnection(providerId = '', button = null) {
    ensureBound('testConnection');
    await persistAiSettings(false);
    if (button) button.disabled = true;
    if (env.aiConnectionStatus) env.aiConnectionStatus.textContent = env.t('aiTesting');
    try {
      const response = await env.sendMessage({
        type: 'AI_HEALTH',
        providerId: providerId || getSettings().activeProviderId,
      });
      const providerName = response?.provider?.name || (getSettings().providers || [])
        .find((provider) => provider.id === (providerId || getSettings().activeProviderId))?.name || env.t('aiProvider');
      const llm = response?.llm?.ok
        ? env.t('aiLlmOk', { provider: providerName, n: (response.llm.models || []).length })
        : env.t('aiLlmFailed');
      if (response?.llm?.ok && response.provider?.id) {
        const settings = getSettings();
        env.settings.ai = {
          ...settings,
          providers: (settings.providers || []).map((provider) => provider.id === response.provider.id
            ? { ...provider, model: response.provider.model || provider.model, models: response.llm.models || [] }
            : provider),
        };
        renderProviders();
        core.syncProviderSelectors(env.settings.ai);
      }
      if (env.aiConnectionStatus) env.aiConnectionStatus.textContent = llm;
    } catch (err) {
      if (env.aiConnectionStatus) env.aiConnectionStatus.textContent = `${env.t('aiError')}: ${err?.message || err}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function persistAiSettings(sync = true) {
    ensureBound('persistAiSettings');
    const current = getSettings();
    await env.saveSettings({
      ai: {
        enabled: Boolean(env.settingsAiEnabled?.checked),
        activeProviderId: current.activeProviderId || 'local-llama-cpp',
        providers: readProviderForms(),
      },
    });
    if (sync) syncSettingsUi();
  }

  async function persistSelection(selection) {
    const current = getSettings();
    await env.saveSettings({
      ai: {
        ...current,
        activeProviderId: selection.providerId,
        providers: (current.providers || []).map((provider) => provider.id === selection.providerId
          ? { ...provider, model: selection.model }
          : provider),
      },
    });
    return getSettings();
  }

  function syncSettingsUi() {
    if (!env?.settingsAiEnabled) return;
    const settings = getSettings();
    env.settingsAiEnabled.checked = settings.enabled;
    renderProviders();
    core.syncProviderSelectors(settings);
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
    env.aiAddProviderBtn?.addEventListener('click', () => {
      const settings = getSettings();
      env.settings.ai = {
        ...settings,
        providers: [...(settings.providers || []), {
          id: newProviderId(), name: 'OpenAI-compatible', baseUrl: '', model: '', bearerToken: '', headers: [], models: [], bypassConfirmations: false,
        }],
      };
      renderProviders();
    });
    ['change', 'focusout'].forEach((eventName) => {
      [env.settingsAiEnabled, env.settingsAiProviders]
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
    parseHeaders,
    isAiPanelHotkey,
    handleAiShortcut,
  };
})(typeof self !== 'undefined' ? self : globalThis);
