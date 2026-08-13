/**
 * TabWall background — normalize items / tags / parked URL index helpers.
 * importScripts shared SW scope with background.js.
 */

// ── original background.js L152-312 ──
// ─── Normalize meta (no inline media) ──────────────────────────────

function normalizeTabItem(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const hasInlineThumb = typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('data:');
  const hasInlineSnap = typeof raw.snapshot === 'string' && raw.snapshot.startsWith('data:');
  const tags = normalizeTags(raw.tags);
  const item = {
    kind: 'tab',
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    url: safeText(raw.url, DATA_LIMITS.MAX_URL_LENGTH),
    title: safeText(raw.title || raw.url || 'Untitled', DATA_LIMITS.MAX_TITLE_LENGTH) || 'Untitled',
    favIconUrl: safeText(raw.favIconUrl, 4096),
    pinned: Boolean(raw.pinned),
    note: safeText(raw.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags,
    savedAt: safeTimestamp(raw.savedAt),
    hasThumb: raw.hasThumb === true || hasInlineThumb,
    hasSnap: raw.hasSnap === true || hasInlineSnap,
    // keep inline only during migration pass
    thumbnail: hasInlineThumb ? raw.thumbnail : '',
    snapshot: hasInlineSnap ? raw.snapshot : '',
    ...(raw.cardSource === 'image' ? { cardSource: 'image' } : {}),
  };
  return withTitleLockFields(item, raw);
}

function normalizeGroupItem(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.map((m, i) => {
        m = m && typeof m === 'object' ? m : {};
        const hasInlineThumb = typeof m.thumbnail === 'string' && m.thumbnail.startsWith('data:');
        const hasInlineSnap = typeof m.snapshot === 'string' && m.snapshot.startsWith('data:');
        return withTitleLockFields({
          id: typeof m.id === 'string' && m.id ? m.id : crypto.randomUUID(),
          url: safeText(m.url, DATA_LIMITS.MAX_URL_LENGTH),
          title: safeText(m.title || m.url || 'Untitled', DATA_LIMITS.MAX_TITLE_LENGTH) || 'Untitled',
          favIconUrl: safeText(m.favIconUrl, 4096),
          pinned: Boolean(m.pinned),
          indexInGroup: typeof m.indexInGroup === 'number' ? m.indexInGroup : i,
          note: safeText(m.note, DATA_LIMITS.MAX_NOTE_LENGTH),
          tags: normalizeTags(m.tags),
          hasThumb: m.hasThumb === true || hasInlineThumb,
          hasSnap: m.hasSnap === true || hasInlineSnap,
          thumbnail: hasInlineThumb ? m.thumbnail : '',
          snapshot: hasInlineSnap ? m.snapshot : '',
          ...(m.cardSource === 'image' ? { cardSource: 'image' } : {}),
        }, m);
      })
    : [];
  const normalizeNote = (value) => normalizeNoteItem(value);
  return withTitleLockFields({
    kind: 'group',
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: safeText(raw.title, DATA_LIMITS.MAX_TITLE_LENGTH),
    color: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'].includes(raw.color)
      ? raw.color
      : 'grey',
    collapsed: Boolean(raw.collapsed),
    pinned: Boolean(raw.pinned),
    note: safeText(raw.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(raw.tags),
    savedAt: safeTimestamp(raw.savedAt),
    tabs,
    notes: Array.isArray(raw.notes) ? raw.notes.map(normalizeNote).filter(Boolean) : [],
  }, raw);
}

function normalizeNoteItem(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.slice(0, Build?.LIMITS?.MAX_NOTE_ATTACHMENTS || 12).map((value) => {
        value = value && typeof value === 'object' ? value : {};
        const mime = typeof value.mime === 'string' && /^image\//i.test(value.mime)
          ? value.mime.slice(0, 128)
          : 'image/jpeg';
        const data = typeof value.data === 'string' ? value.data : '';
        return {
          id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
          name: safeText(value.name || 'image', DATA_LIMITS.MAX_TITLE_LENGTH) || 'image',
          alt: safeText(value.alt, DATA_LIMITS.MAX_NOTE_LENGTH),
          mime,
          size: Math.max(0, Math.round(Number(value.size) || 0)),
          width: Math.max(0, Math.min(100000, Math.round(Number(value.width) || 0))),
          height: Math.max(0, Math.min(100000, Math.round(Number(value.height) || 0))),
          hasData: value.hasData === true || Boolean(data),
          ...(data ? { data } : {}),
          ...(value.__stageNoteId ? { __stageNoteId: value.__stageNoteId } : {}),
          ...(value.__stageAttachmentId ? { __stageAttachmentId: value.__stageAttachmentId } : {}),
        };
      })
    : [];
  return withTitleLockFields({
    kind: 'note',
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: safeText(raw.title || 'Sticker note', DATA_LIMITS.MAX_TITLE_LENGTH) || 'Sticker note',
    markdown: safeText(raw.markdown, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(raw.tags),
    pinned: Boolean(raw.pinned),
    savedAt: safeTimestamp(raw.savedAt),
    attachments,
    ...(raw.__stageItemId ? { __stageItemId: raw.__stageItemId } : {}),
    ...(raw.__stageGroupId ? { __stageGroupId: raw.__stageGroupId } : {}),
    ...(raw.__stageNoteId ? { __stageNoteId: raw.__stageNoteId } : {}),
  }, raw);
}

function safeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maxLength);
}

function normalizeDisplayTitle(raw, originalTitle) {
  const display = safeText(raw, DATA_LIMITS.MAX_TITLE_LENGTH).trim();
  const original = safeText(originalTitle, DATA_LIMITS.MAX_TITLE_LENGTH).trim();
  if (!display || display === original) return '';
  return display;
}

function normalizeLockFields(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (!source.locked) return {};
  const salt = typeof source.lockSalt === 'string' && /^[0-9a-f]{32}$/i.test(source.lockSalt)
    ? source.lockSalt.toLowerCase()
    : '';
  const hash = typeof source.lockHash === 'string' && /^[0-9a-f]{64}$/i.test(source.lockHash)
    ? source.lockHash.toLowerCase()
    : '';
  return {
    locked: true,
    ...(salt && hash ? { lockSalt: salt, lockHash: hash } : {}),
  };
}

function storedTitleLockFields(item) {
  if (!item || typeof item !== 'object') return {};
  return {
    ...(item.displayTitle ? { displayTitle: item.displayTitle } : {}),
    ...(item.locked ? { locked: true } : {}),
    ...(item.locked && item.lockSalt && item.lockHash
      ? { lockSalt: item.lockSalt, lockHash: item.lockHash }
      : {}),
  };
}

function applyDisplayTitlePatch(item, patch) {
  if (!item || typeof patch?.displayTitle !== 'string') return;
  const display = normalizeDisplayTitle(patch.displayTitle, item.title);
  if (display) item.displayTitle = display;
  else delete item.displayTitle;
}

function applyLockPatch(item, patch) {
  if (!item || typeof patch?.locked !== 'boolean') return;
  if (!patch.locked) {
    delete item.locked;
    delete item.lockSalt;
    delete item.lockHash;
    return;
  }
  item.locked = true;
  const hasSalt = Object.prototype.hasOwnProperty.call(patch, 'lockSalt');
  const hasHash = Object.prototype.hasOwnProperty.call(patch, 'lockHash');
  if (!hasSalt && !hasHash) return;
  const fields = normalizeLockFields({
    locked: true,
    lockSalt: patch.lockSalt,
    lockHash: patch.lockHash,
  });
  if (fields.lockSalt && fields.lockHash) {
    item.lockSalt = fields.lockSalt;
    item.lockHash = fields.lockHash;
  } else {
    delete item.lockSalt;
    delete item.lockHash;
  }
}

function withTitleLockFields(item, raw) {
  const displayTitle = normalizeDisplayTitle(raw?.displayTitle, item.title);
  return {
    ...item,
    ...(displayTitle ? { displayTitle } : {}),
    ...normalizeLockFields(raw),
  };
}

function safeTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= Date.now() + 86400000 ? n : Date.now();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .map((tag) => safeText(tag, DATA_LIMITS.MAX_TAG_LENGTH).trim())
      .filter(Boolean)
  )].slice(0, DATA_LIMITS.MAX_TAGS);
}

function normalizeAutoSaveCondition(raw) {
  const condition = raw && typeof raw === 'object' ? raw : {};
  return {
    field: condition.field === 'title' ? 'title' : 'domain',
    operator: AUTO_SAVE_METADATA_OPERATORS.has(condition.operator)
      ? condition.operator
      : 'match',
    negate: Boolean(condition.negate),
    value: safeText(condition.value, DATA_LIMITS.MAX_TITLE_LENGTH).trim(),
  };
}

function normalizeAutoSaveRule(raw) {
  const rule = raw && typeof raw === 'object' ? raw : {};
  const conditions = Array.isArray(rule.conditions)
    ? rule.conditions.slice(0, AUTO_SAVE_METADATA_MAX_CONDITIONS).map(normalizeAutoSaveCondition)
    : [];
  return {
    id: typeof rule.id === 'string' && rule.id ? rule.id : crypto.randomUUID(),
    enabled: rule.enabled !== false,
    logic: rule.logic === 'OR' ? 'OR' : 'AND',
    conditions,
    note: safeText(rule.note, DATA_LIMITS.MAX_NOTE_LENGTH),
    tags: normalizeTags(rule.tags),
  };
}

function normalizeAutoSaveMetadata(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(source.enabled),
    rules: Array.isArray(source.rules)
      ? source.rules.slice(0, AUTO_SAVE_METADATA_MAX_RULES).map(normalizeAutoSaveRule)
      : [],
  };
}

// ── original background.js L706-874 ──
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'group' || Array.isArray(raw.tabs)) return normalizeGroupItem(raw);
  if (raw.kind === 'note') return normalizeNoteItem(raw);
  return normalizeTabItem(raw);
}

/** Strip any residual data URLs before persisting meta */
function toStoredMeta(item) {
  if (item.kind === 'group') {
    return {
      kind: 'group',
      id: item.id,
      title: item.title || '',
      color: item.color || 'grey',
      collapsed: Boolean(item.collapsed),
      pinned: Boolean(item.pinned),
      note: item.note || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      savedAt: item.savedAt || Date.now(),
      tabs: (item.tabs || []).map((m) => ({
        id: m.id,
        url: m.url || '',
        title: m.title || '',
        favIconUrl: m.favIconUrl || '',
        pinned: Boolean(m.pinned),
        indexInGroup: m.indexInGroup || 0,
        note: m.note || '',
        tags: Array.isArray(m.tags) ? m.tags : [],
        hasThumb: Boolean(m.hasThumb),
        hasSnap: Boolean(m.hasSnap),
        ...(m.cardSource === 'image' ? { cardSource: 'image' } : {}),
        ...storedTitleLockFields(m),
      })),
      notes: (item.notes || []).map((note) => toStoredMeta(note)),
      ...storedTitleLockFields(item),
    };
  }
  if (item.kind === 'note') {
    return {
      kind: 'note',
      id: item.id,
      title: item.title || 'Sticker note',
      markdown: item.markdown || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      pinned: Boolean(item.pinned),
      savedAt: item.savedAt || Date.now(),
      attachments: (item.attachments || []).map((attachment) => ({
        id: attachment.id,
        name: attachment.name || 'image',
        alt: attachment.alt || '',
        mime: attachment.mime || 'image/jpeg',
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
        width: Number.isFinite(Number(attachment.width)) ? Number(attachment.width) : 0,
        height: Number.isFinite(Number(attachment.height)) ? Number(attachment.height) : 0,
        hasData: Boolean(attachment.hasData),
      })),
      ...storedTitleLockFields(item),
    };
  }
  return {
    kind: 'tab',
    id: item.id,
    url: item.url || '',
    title: item.title || '',
    favIconUrl: item.favIconUrl || '',
    pinned: Boolean(item.pinned),
    note: item.note || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    savedAt: item.savedAt || Date.now(),
    hasThumb: Boolean(item.hasThumb),
    hasSnap: Boolean(item.hasSnap),
    ...(item.cardSource === 'image' ? { cardSource: 'image' } : {}),
    ...storedTitleLockFields(item),
  };
}

async function getParkedItemsRaw() {
  const data = await chrome.storage.local.get([STORAGE_ITEMS, STORAGE_TABS]);
  if (Array.isArray(data[STORAGE_ITEMS])) {
    return data[STORAGE_ITEMS].map(normalizeItem).filter(Boolean);
  }
  if (Array.isArray(data[STORAGE_TABS]) && data[STORAGE_TABS].length > 0) {
    return data[STORAGE_TABS].map((t) => normalizeTabItem({ ...t, kind: 'tab' }));
  }
  return [];
}

async function setParkedItems(items, options = {}) {
  const current = await getCanvasLayoutRecord();
  const result = await commitItemsAndCanvas(items, options.canvasLayout ?? current.layout, {
    ...options,
    currentRecord: current,
  });
  return result.items;
}

async function getParkedItems() {
  await ensureMediaMigration();
  const items = await getParkedItemsRaw();
  return items.map(toStoredMeta);
}

async function ensureMediaMigration() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const data = await chrome.storage.local.get([DATA_VERSION_KEY, STORAGE_ITEMS, STORAGE_TABS]);
    if ((data[DATA_VERSION_KEY] || 0) >= DATA_VERSION) return;

    let items = [];
    if (Array.isArray(data[STORAGE_ITEMS]) && data[STORAGE_ITEMS].length) {
      items = data[STORAGE_ITEMS].map(normalizeItem).filter(Boolean);
    } else if (Array.isArray(data[STORAGE_TABS]) && data[STORAGE_TABS].length) {
      items = data[STORAGE_TABS].map((t) => normalizeTabItem({ ...t, kind: 'tab' }));
    }

    for (const item of items) {
      if (item.kind === 'group') {
        for (const m of item.tabs || []) {
          if (m.thumbnail || m.snapshot) {
            const flags = await Media.putFromDataUrls(
              Media.mediaKeyMember(item.id, m.id),
              m.thumbnail,
              m.snapshot
            );
            m.hasThumb = flags.hasThumb || m.hasThumb;
            m.hasSnap = flags.hasSnap || m.hasSnap;
          }
          m.thumbnail = '';
          m.snapshot = '';
        }
        for (const note of item.notes || []) {
          for (const attachment of note.attachments || []) {
            if (attachment.data && Media.putAttachment) {
              const blob = Media.dataUrlToBlob(attachment.data);
              if (blob) {
                await Media.putAttachment(Media.mediaKeyNoteAttachment(note.id, attachment.id), blob);
                attachment.hasData = true;
              }
            }
            delete attachment.data;
          }
        }
      } else if (item.kind === 'note') {
        for (const attachment of item.attachments || []) {
          if (attachment.data && Media.putAttachment) {
            const blob = Media.dataUrlToBlob(attachment.data);
            if (blob) {
              await Media.putAttachment(Media.mediaKeyNoteAttachment(item.id, attachment.id), blob);
              attachment.hasData = true;
            }
          }
          delete attachment.data;
        }
      } else if (item.thumbnail || item.snapshot) {
        const flags = await Media.putFromDataUrls(
          Media.mediaKeyTab(item.id),
          item.thumbnail,
          item.snapshot
        );
        item.hasThumb = flags.hasThumb || item.hasThumb;
        item.hasSnap = flags.hasSnap || item.hasSnap;
        item.thumbnail = '';
        item.snapshot = '';
      }
    }

    await setParkedItems(items);
  })().catch((err) => {
    console.warn('[TabWall] media migration failed:', err);
    migrationPromise = null;
  });
  return migrationPromise;
}

