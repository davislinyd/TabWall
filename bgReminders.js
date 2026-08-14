/**
 * TabWall background — per-card reminder alarms and notifications.
 * importScripts shared SW scope with background.js.
 */

const REMINDER_ALARM_PREFIX = 'tabwall-reminder:';
const REMINDER_NOTIFICATION_PREFIX = 'tabwall-reminder:';

function reminderAlarmName(itemId) {
  return `${REMINDER_ALARM_PREFIX}${String(itemId || '')}`;
}

function reminderItemIdFromAlarm(name) {
  const value = String(name || '');
  return value.startsWith(REMINDER_ALARM_PREFIX)
    ? value.slice(REMINDER_ALARM_PREFIX.length)
    : '';
}

function reminderNotificationId(itemId) {
  return `${REMINDER_NOTIFICATION_PREFIX}${String(itemId || '')}`;
}

function normalizeReminderForStorage(raw) {
  return normalizeReminder(raw);
}

async function listReminderItems(items = null) {
  const source = Array.isArray(items) ? items : await getParkedItems();
  return source
    .filter((item) => item && normalizeReminderForStorage(item.reminder))
    .map((item) => ({
      ...item,
      reminder: normalizeReminderForStorage(item.reminder),
    }))
    .sort((a, b) => a.reminder.nextAt - b.reminder.nextAt);
}

async function syncReminderAlarmsForItems(items = null) {
  if (!chrome.alarms?.create) return { ok: false, error: 'alarms_unavailable' };
  const reminders = await listReminderItems(items);
  const wanted = new Map(reminders.map((item) => [item.id, item]));
  let alarms = [];
  try {
    alarms = chrome.alarms.getAll ? await chrome.alarms.getAll() : [];
  } catch (err) {
    console.warn('[TabWall] reminder alarm lookup failed:', err);
  }

  for (const alarm of alarms || []) {
    const itemId = reminderItemIdFromAlarm(alarm?.name);
    if (itemId && !wanted.has(itemId)) {
      await chrome.alarms.clear(alarm.name).catch(() => {});
    }
  }

  const now = Date.now();
  for (const item of reminders) {
    const when = Math.max(now + 1000, Number(item.reminder.nextAt));
    await chrome.alarms.create(reminderAlarmName(item.id), { when });
  }
  return { ok: true, count: reminders.length };
}

async function setReminder(itemId, rawReminder) {
  const id = String(itemId || '');
  if (!id) return { ok: false, error: 'invalid_id' };
  const reminder = normalizeReminderForStorage(rawReminder);
  if (!reminder) return { ok: false, error: 'invalid_reminder' };
  if (reminder.nextAt <= Date.now()) return { ok: false, error: 'reminder_in_past' };

  const items = await getParkedItems();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, error: 'not_found' };
  const item = { ...items[index], reminder };
  items[index] = item;
  await setParkedItems(items);
  await syncReminderAlarmsForItems(items);
  return { ok: true, item };
}

async function clearReminder(itemId) {
  const id = String(itemId || '');
  if (!id) return { ok: false, error: 'invalid_id' };
  const items = await getParkedItems();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, error: 'not_found' };
  const item = { ...items[index] };
  delete item.reminder;
  items[index] = item;
  await setParkedItems(items);
  await syncReminderAlarmsForItems(items);
  return { ok: true, item };
}

function createReminderNotification(item, reminder) {
  return new Promise((resolve) => {
    if (!chrome.notifications?.create) {
      resolve({ ok: false, error: 'notifications_unavailable' });
      return;
    }
    const id = reminderNotificationId(item.id);
    const title = String(item.displayTitle || item.title || item.url || 'TabWall').trim() || 'TabWall';
    const message = String(reminder.message || '').trim() || title;
    let settled = false;
    const finish = (createdId) => {
      if (settled) return;
      settled = true;
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: String(error.message || error) } : { ok: true, id: createdId || id });
    };
    try {
      const result = chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title,
        message,
        priority: 2,
      }, finish);
      if (result?.then) result.then((createdId) => finish(createdId)).catch((err) => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: String(err?.message || err) });
        }
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: String(err?.message || err) });
      }
    }
  });
}

async function handleReminderAlarm(alarm) {
  const itemId = reminderItemIdFromAlarm(alarm?.name);
  if (!itemId) return { ok: false, error: 'not_reminder' };
  const items = await getParkedItems();
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    await chrome.alarms.clear(alarm.name).catch(() => {});
    return { ok: false, error: 'not_found' };
  }
  const item = { ...items[index] };
  const reminder = normalizeReminderForStorage(item.reminder);
  if (!reminder) {
    await chrome.alarms.clear(alarm.name).catch(() => {});
    return { ok: false, error: 'no_reminder' };
  }
  if (reminder.nextAt > Date.now() + 1000) {
    await syncReminderAlarmsForItems(items);
    return { ok: true, skipped: true };
  }

  const sent = await createReminderNotification(item, reminder);
  if (!sent.ok) {
    console.warn('[TabWall] reminder notification failed:', sent.error);
    await chrome.alarms.clear(alarm.name).catch(() => {});
    return sent;
  }

  if (reminder.mode === 'once') {
    delete item.reminder;
  } else {
    item.reminder = {
      ...reminder,
      nextAt: Date.now() + reminder.intervalMinutes * 60 * 1000,
    };
  }
  items[index] = item;
  await setParkedItems(items);
  await syncReminderAlarmsForItems(items);
  return { ok: true, notificationId: sent.id, item };
}

async function handleReminderNotificationClick(notificationId) {
  const value = String(notificationId || '');
  if (!value.startsWith(REMINDER_NOTIFICATION_PREFIX)) return false;
  const itemId = value.slice(REMINDER_NOTIFICATION_PREFIX.length);
  if (!itemId) return false;
  await openStandaloneParkTab({ focusReminderId: itemId });
  return true;
}
