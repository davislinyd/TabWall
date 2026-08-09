const COPY = {
  zh: {
    subtitle: '選擇目前分頁的操作',
    saveTabKeep: '儲存目前分頁（不關閉）',
    saveTabClose: '儲存目前分頁（關閉）',
    saveGroupKeep: '儲存目前群組（不關閉）',
    saveGroupClose: '儲存目前群組（關閉）',
    groupHint: '目前分頁不在 Tab Group 中',
    openPark: '打開 TabWall 面板',
    saving: '儲存中…',
    opening: '正在打開 TabWall…',
    openFailed: '無法打開 TabWall 面板',
    emptyResponse: '沒有收到背景回應',
    saveFailed: '儲存失敗：{error}',
    noTab: '目前沒有可存檔的分頁',
    restrictedUrl: '此頁面受 Chrome 限制，無法直接存檔',
    selfTab: '目前已是 TabWall，請使用「打開 TabWall 面板」',
    notInGroup: '目前分頁不在 Tab Group 中',
    genericError: '操作失敗：{error}',
  },
  en: {
    subtitle: 'Choose an action for the current tab',
    saveTabKeep: 'Save current tab (keep open)',
    saveTabClose: 'Save current tab (close)',
    saveGroupKeep: 'Save current group (keep open)',
    saveGroupClose: 'Save current group (close)',
    groupHint: 'The current tab is not in a Tab Group',
    openPark: 'Open TabWall panel',
    saving: 'Saving…',
    opening: 'Opening TabWall…',
    openFailed: 'Could not open the TabWall panel',
    emptyResponse: 'The background did not respond',
    saveFailed: 'Save failed: {error}',
    noTab: 'There is no tab available to save',
    restrictedUrl: 'Chrome restricts this page from being saved directly',
    selfTab: 'This is already TabWall; use “Open TabWall panel”',
    notInGroup: 'The current tab is not in a Tab Group',
    genericError: 'Operation failed: {error}',
  },
};

const tabActionButtons = [
  document.getElementById('saveTabKeep'),
  document.getElementById('saveTabClose'),
];
const groupActionButtons = [
  document.getElementById('saveGroupKeep'),
  document.getElementById('saveGroupClose'),
];
const groupHint = document.getElementById('groupHint');
const statusEl = document.getElementById('status');
let locale = 'zh';
let currentTabInGroup = false;
let busy = false;

function text(key, vars = {}) {
  let value = COPY[locale]?.[key] || COPY.zh[key] || key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

function applyLocale() {
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-Hant';
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    element.textContent = text(key);
  });
}

function setStatus(message = '', state = '') {
  statusEl.textContent = message;
  if (state) statusEl.dataset.state = state;
  else delete statusEl.dataset.state;
}

function syncButtonState() {
  for (const button of tabActionButtons) button.disabled = busy;
  for (const button of groupActionButtons) button.disabled = busy || !currentTabInGroup;
  document.getElementById('openPark').disabled = busy;
}

function errorMessage(error) {
  const key = String(error || '');
  if (key === 'no_tab') return text('noTab');
  if (key === 'restricted_url') return text('restrictedUrl');
  if (key === 'self_tab') return text('selfTab');
  if (key === 'not_in_group') return text('notInGroup');
  if (key === 'empty_response') return text('emptyResponse');
  return text('genericError', { error: key || 'unknown_error' });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: 'empty_response' });
      });
    } catch (error) {
      resolve({ ok: false, error: String(error) });
    }
  });
}

async function refreshGroupState() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const none = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1;
    currentTabInGroup = Boolean(tab?.id != null && tab.groupId != null && tab.groupId !== none);
  } catch {
    currentTabInGroup = false;
  }
  groupHint.hidden = currentTabInGroup;
  syncButtonState();
}

async function runSave(message) {
  if (busy) return;
  busy = true;
  setStatus(text('saving'), 'busy');
  syncButtonState();
  const result = await sendMessage(message);
  if (result.ok) {
    window.close();
    return;
  }
  busy = false;
  setStatus(text('saveFailed', { error: errorMessage(result.error) }), 'error');
  syncButtonState();
}

async function openPark() {
  if (busy) return;
  busy = true;
  setStatus(text('opening'), 'busy');
  syncButtonState();
  const result = await sendMessage({ type: 'OPEN_PARK_ACTIVE' });
  if (result.ok) {
    window.close();
    return;
  }
  busy = false;
  setStatus(result.error ? errorMessage(result.error) : text('openFailed'), 'error');
  syncButtonState();
}

async function loadLocale() {
  try {
    const data = await chrome.storage.local.get('settings');
    locale = data.settings?.locale === 'en' ? 'en' : 'zh';
  } catch {
    locale = 'zh';
  }
  applyLocale();
}

function init() {
  document.getElementById('saveTabKeep').addEventListener('click', () => {
    runSave({ type: 'SAVE_ACTIVE_TAB', afterSave: 'keep' });
  });
  document.getElementById('saveTabClose').addEventListener('click', () => {
    runSave({ type: 'SAVE_ACTIVE_TAB', afterSave: 'close' });
  });
  document.getElementById('saveGroupKeep').addEventListener('click', () => {
    runSave({ type: 'SAVE_ACTIVE_GROUP', afterSaveGroup: 'keep' });
  });
  document.getElementById('saveGroupClose').addEventListener('click', () => {
    runSave({ type: 'SAVE_ACTIVE_GROUP', afterSaveGroup: 'close' });
  });
  document.getElementById('openPark').addEventListener('click', openPark);
  syncButtonState();
  Promise.all([loadLocale(), refreshGroupState()]).catch(() => {});
}

init();
