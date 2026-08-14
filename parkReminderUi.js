/**
 * TabWall reminder UI — reminder panel, editor, and notification focus.
 * Loaded by park.html before park.js and bound to the page environment.
 */
(function (global) {
  'use strict';

  let env = null;
  let currentItemId = '';
  let listenersBound = false;

  function bind(next) {
    if (next && typeof next === 'object') env = next;
  }

  function ensureBound(name) {
    if (!env) throw new Error(`TabWallReminderUi.${name} used before bind()`);
  }

  function t(key, vars) {
    return env.t(key, vars);
  }

  function get(id) {
    return document.getElementById(id);
  }

  function reminderItems() {
    ensureBound('reminderItems');
    return (env.allTabs || [])
      .filter((item) => item?.reminder?.nextAt > 0)
      .sort((a, b) => Number(a.reminder.nextAt) - Number(b.reminder.nextAt));
  }

  function formatDateTime(value) {
    try {
      return new Intl.DateTimeFormat(env.settings?.locale === 'en' ? 'en' : 'zh-Hant', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch {
      return new Date(value).toLocaleString();
    }
  }

  function formatDateTimeLocal(value) {
    const date = new Date(value);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseDateTimeLocal(value) {
    if (typeof value !== 'string' || !value) return NaN;
    const result = new Date(value);
    return result.getTime();
  }

  function intervalFields(intervalMinutes) {
    const minutes = Math.max(1, Math.round(Number(intervalMinutes) || 1));
    if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'day' };
    if (minutes % 60 === 0) return { value: minutes / 60, unit: 'hour' };
    return { value: minutes, unit: 'minute' };
  }

  function intervalMinutes() {
    const value = Number(get('reminderIntervalValue')?.value);
    const unit = get('reminderIntervalUnit')?.value || 'minute';
    if (!Number.isInteger(value) || value < 1) return NaN;
    return value * (unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1);
  }

  function updateModeFields() {
    const interval = get('reminderModeInterval')?.checked === true;
    const fields = get('reminderIntervalFields');
    if (fields) fields.hidden = !interval;
  }

  function setStatus(message = '', isError = false) {
    const status = get('reminderEditorStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function setPanelOpen(open) {
    const box = env.remindersBox;
    if (!box) return;
    box.classList.toggle('open', open);
    box.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (!open) {
      currentItemId = '';
      showListView();
    }
    env.syncFloatBackdrop?.();
  }

  function showListView() {
    const list = get('remindersListView');
    const editor = get('reminderEditorView');
    if (list) list.hidden = false;
    if (editor) editor.hidden = true;
    setStatus('');
  }

  function showEditorView() {
    const list = get('remindersListView');
    const editor = get('reminderEditorView');
    if (list) list.hidden = true;
    if (editor) editor.hidden = false;
  }

  function renderReminderList() {
    ensureBound('renderReminderList');
    const list = get('remindersList');
    if (!list) return;
    const items = reminderItems();
    const count = env.reminderCount;
    if (count) {
      count.textContent = String(items.length);
      count.hidden = items.length === 0;
    }
    if (!items.length) {
      list.innerHTML = `<div class="reminder-empty">${env.escapeHtml(t('reminderEmpty'))}</div>`;
      return;
    }
    list.innerHTML = items.map((item) => {
      const reminder = item.reminder;
      const title = env.itemTitle(item);
      const message = reminder.message.trim() || t('reminderUsesTitle');
      const interval = intervalFields(reminder.intervalMinutes);
      const unitKey = interval.unit === 'day'
        ? 'reminderDays'
        : interval.unit === 'hour'
          ? 'reminderHours'
          : 'reminderMinutes';
      const schedule = reminder.mode === 'interval'
        ? t('reminderEvery', {
            n: interval.value,
            unit: t(unitKey),
            time: formatDateTime(reminder.nextAt),
          })
        : t('reminderOnceAt', { time: formatDateTime(reminder.nextAt) });
      return `
        <article class="reminder-row" data-reminder-id="${env.escapeAttr(item.id)}">
          <button type="button" class="reminder-row-main" data-reminder-focus="${env.escapeAttr(item.id)}">
            <span class="reminder-row-icon">${env.iconSvg('reminder')}</span>
            <span class="reminder-row-copy">
              <strong>${env.escapeHtml(title)}</strong>
              <span>${env.escapeHtml(message)}</span>
              <small>${env.escapeHtml(schedule)}</small>
            </span>
          </button>
          <span class="reminder-row-actions">
            <button type="button" class="btn icon-btn" data-reminder-edit="${env.escapeAttr(item.id)}" title="${env.escapeAttr(t('reminderEdit'))}" aria-label="${env.escapeAttr(t('reminderEdit'))}">${env.iconSvg('edit')}</button>
            <button type="button" class="btn icon-btn danger" data-reminder-clear="${env.escapeAttr(item.id)}" title="${env.escapeAttr(t('reminderClear'))}" aria-label="${env.escapeAttr(t('reminderClear'))}">${env.iconSvg('delete')}</button>
          </span>
        </article>`;
    }).join('');

    list.querySelectorAll('[data-reminder-focus]').forEach((button) => {
      button.addEventListener('click', () => focusItem(button.dataset.reminderFocus));
    });
    list.querySelectorAll('[data-reminder-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = env.allTabs.find((candidate) => candidate.id === button.dataset.reminderEdit);
        if (item) openReminderEditor(item);
      });
    });
    list.querySelectorAll('[data-reminder-clear]').forEach((button) => {
      button.addEventListener('click', () => clearItem(button.dataset.reminderClear));
    });
  }

  function openRemindersBox() {
    ensureBound('openRemindersBox');
    env.closeAllFloatsExcept?.('reminders');
    currentItemId = '';
    showListView();
    renderReminderList();
    setPanelOpen(true);
  }

  function openReminderEditor(item) {
    ensureBound('openReminderEditor');
    if (!item?.id) return;
    env.closeAllFloatsExcept?.('reminders');
    currentItemId = item.id;
    const reminder = item.reminder || {
      mode: 'once',
      message: '',
      nextAt: Date.now() + 60 * 60 * 1000,
    };
    const once = get('reminderModeOnce');
    const interval = get('reminderModeInterval');
    if (once) once.checked = reminder.mode !== 'interval';
    if (interval) interval.checked = reminder.mode === 'interval';
    const at = get('reminderAt');
    if (at) at.value = formatDateTimeLocal(reminder.nextAt);
    const message = get('reminderMessage');
    if (message) message.value = reminder.message || '';
    const fields = intervalFields(reminder.intervalMinutes || 60);
    if (get('reminderIntervalValue')) get('reminderIntervalValue').value = String(fields.value);
    if (get('reminderIntervalUnit')) get('reminderIntervalUnit').value = fields.unit;
    const clear = get('reminderClearBtn');
    if (clear) clear.hidden = !item.reminder;
    const title = get('reminderEditorTitle');
    if (title) title.textContent = t('reminderEditorTitle', { title: env.itemTitle(item) });
    setStatus('');
    updateModeFields();
    showEditorView();
    setPanelOpen(true);
    setTimeout(() => get('reminderAt')?.focus(), 0);
  }

  async function saveItem() {
    ensureBound('saveItem');
    const itemId = currentItemId;
    if (!itemId) return;
    const nextAt = parseDateTimeLocal(get('reminderAt')?.value || '');
    if (!Number.isFinite(nextAt) || nextAt <= Date.now()) {
      setStatus(t('reminderFutureRequired'), true);
      return;
    }
    const mode = get('reminderModeInterval')?.checked ? 'interval' : 'once';
    const reminder = {
      mode,
      message: get('reminderMessage')?.value || '',
      nextAt,
    };
    if (mode === 'interval') {
      const minutes = intervalMinutes();
      if (!Number.isInteger(minutes) || minutes < 1) {
        setStatus(t('reminderIntervalRequired'), true);
        return;
      }
      reminder.intervalMinutes = minutes;
    }
    const save = get('reminderSaveBtn');
    if (save) save.disabled = true;
    setStatus(t('reminderSaving'));
    try {
      const result = await env.sendMessage({ type: 'SET_REMINDER', id: itemId, reminder });
      if (!result?.ok) {
        setStatus(t('reminderSaveFailed'), true);
        return;
      }
      await env.loadList();
      openRemindersBox();
    } finally {
      if (save) save.disabled = false;
    }
  }

  async function clearItem(itemId = currentItemId) {
    ensureBound('clearItem');
    if (!itemId) return;
    const result = await env.sendMessage({ type: 'CLEAR_REMINDER', id: itemId });
    if (!result?.ok) {
      setStatus(t('reminderSaveFailed'), true);
      return;
    }
    await env.loadList();
    openRemindersBox();
  }

  function closeRemindersBox() {
    setPanelOpen(false);
  }

  function focusItem(itemId) {
    if (!itemId) return;
    closeRemindersBox();
    env.focusItem?.(itemId);
  }

  function refresh() {
    if (!env) return;
    const count = env.reminderCount;
    const items = reminderItems();
    if (count) {
      count.textContent = String(items.length);
      count.hidden = items.length === 0;
    }
    if (env.remindersBox?.classList.contains('open')) renderReminderList();
  }

  function handleFocusFromUrl() {
    const id = new URLSearchParams(window.location.search).get('focusReminder');
    if (!id) return;
    setTimeout(() => {
      env.focusItem?.(id);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('focusReminder');
        history.replaceState(null, '', url.toString());
      } catch {
        // ignore history cleanup failures
      }
    }, 80);
  }

  function init() {
    ensureBound('init');
    if (listenersBound) return;
    listenersBound = true;
    env.remindersBtn?.addEventListener('click', openRemindersBox);
    get('remindersCloseX')?.addEventListener('click', closeRemindersBox);
    get('reminderBackBtn')?.addEventListener('click', openRemindersBox);
    get('reminderSaveBtn')?.addEventListener('click', saveItem);
    get('reminderClearBtn')?.addEventListener('click', () => clearItem());
    get('reminderModeOnce')?.addEventListener('change', updateModeFields);
    get('reminderModeInterval')?.addEventListener('change', updateModeFields);
    refresh();
  }

  global.TabWallReminderUi = {
    bind,
    init,
    refresh,
    openRemindersBox,
    openReminderEditor,
    closeRemindersBox,
    handleFocusFromUrl,
  };
})(typeof self !== 'undefined' ? self : globalThis);
