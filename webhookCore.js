/**
 * TabWall webhook profiles — shared normalization and body-template helpers.
 * Loaded by both the service worker and park.html.
 */
(function (global) {
  'use strict';

  const MAX_PROFILES = 20;
  const MAX_HEADERS = 50;
  const MAX_PROFILE_ID_LENGTH = 128;
  const MAX_PROFILE_NAME_LENGTH = 128;
  const MAX_URL_LENGTH = 8192;
  const MAX_HEADER_NAME_LENGTH = 256;
  const MAX_HEADER_VALUE_LENGTH = 4096;
  const MAX_BODY_LENGTH = 64 * 1024;
  const REQUEST_TIMEOUT_MS = 15 * 1000;
  const TEST_CONTEXT_NEXT_AT = 1735689600000;
  const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  const PROFILE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

  function cleanText(value, maxLength, { preserveNewlines = false } = {}) {
    const pattern = preserveNewlines
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
      : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\r\n\t]/g;
    return String(value == null ? '' : value).replace(pattern, '').slice(0, maxLength);
  }

  function newId() {
    try {
      if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    } catch {
      // Fall through to an opaque local id.
    }
    return `webhook-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeProfileId(value) {
    const id = cleanText(value, MAX_PROFILE_ID_LENGTH).trim();
    return PROFILE_ID_RE.test(id) ? id : '';
  }

  function normalizeUrl(value) {
    const candidate = cleanText(value, MAX_URL_LENGTH).trim();
    if (!candidate) return '';
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.username || url.password) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function normalizeHeaders(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result = {};
    let count = 0;
    for (const [rawName, rawValue] of Object.entries(raw)) {
      if (count >= MAX_HEADERS) break;
      const name = cleanText(rawName, MAX_HEADER_NAME_LENGTH).trim();
      const value = cleanText(rawValue, MAX_HEADER_VALUE_LENGTH).trim();
      if (!name || !HEADER_NAME_RE.test(name)) continue;
      const existing = Object.keys(result).find((key) => key.toLowerCase() === name.toLowerCase());
      if (existing) delete result[existing];
      result[name] = value;
      count++;
    }
    return result;
  }

  function normalizeBody(value) {
    return cleanText(value, MAX_BODY_LENGTH, { preserveNewlines: true });
  }

  function normalizeProfile(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      id: normalizeProfileId(source.id) || newId(),
      name: cleanText(source.name, MAX_PROFILE_NAME_LENGTH).trim() || 'Webhook profile',
      url: normalizeUrl(source.url),
      headers: normalizeHeaders(source.headers),
      body: normalizeBody(source.body),
    };
  }

  function normalizeProfiles(raw) {
    if (!Array.isArray(raw)) return [];
    const used = new Set();
    return raw.slice(0, MAX_PROFILES).map((value) => {
      const profile = normalizeProfile(value);
      while (used.has(profile.id)) profile.id = newId();
      used.add(profile.id);
      return profile;
    });
  }

  function normalizeProfileIds(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw
      .map((value) => normalizeProfileId(value))
      .filter(Boolean)
    )].slice(0, MAX_PROFILES);
  }

  function validateProfile(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'invalid_webhook_profile' };
    }
    const url = normalizeUrl(raw.url);
    if (!url) return { ok: false, error: 'invalid_webhook_url' };
    if (raw.headers != null && (!raw.headers || typeof raw.headers !== 'object' || Array.isArray(raw.headers))) {
      return { ok: false, error: 'invalid_webhook_headers' };
    }
    const headers = normalizeHeaders(raw.headers);
    const rawHeaderCount = raw.headers && typeof raw.headers === 'object' ? Object.keys(raw.headers).length : 0;
    if (rawHeaderCount > MAX_HEADERS) return { ok: false, error: 'too_many_webhook_headers' };
    for (const [name, value] of Object.entries(raw.headers || {})) {
      const rawValue = String(value == null ? '' : value);
      const cleanName = cleanText(name, MAX_HEADER_NAME_LENGTH).trim();
      if (!cleanName || !HEADER_NAME_RE.test(cleanName)) return { ok: false, error: 'invalid_webhook_header_name' };
      if (rawValue.includes('\r') || rawValue.includes('\n')) {
        return { ok: false, error: 'invalid_webhook_header_value' };
      }
      if (rawValue.length > MAX_HEADER_VALUE_LENGTH) return { ok: false, error: 'webhook_header_too_long' };
    }
    if (String(raw.body == null ? '' : raw.body).length > MAX_BODY_LENGTH) {
      return { ok: false, error: 'webhook_body_too_long' };
    }
    return { ok: true, profile: { ...normalizeProfile(raw), url, headers } };
  }

  function buildContext(item, reminder, triggeredAt = Date.now()) {
    const displayTitle = cleanText(item?.displayTitle, 2048).trim();
    const title = cleanText(item?.title || item?.url || 'TabWall', 2048).trim() || 'TabWall';
    const message = cleanText(reminder?.message, 20000).trim() || displayTitle || title;
    const nextAt = Number(reminder?.nextAt);
    const safeNextAt = Number.isFinite(nextAt) && nextAt > 0 ? nextAt : Number(triggeredAt) || Date.now();
    const tags = Array.isArray(item?.tags)
      ? item.tags.map((tag) => cleanText(tag, 128).trim()).filter(Boolean).slice(0, 100)
      : [];
    return {
      id: cleanText(item?.id, MAX_PROFILE_ID_LENGTH),
      title,
      displayTitle,
      url: cleanText(item?.url, MAX_URL_LENGTH),
      message,
      mode: reminder?.mode === 'interval' ? 'interval' : 'once',
      nextAt: safeNextAt,
      nextAtIso: new Date(safeNextAt).toISOString(),
      tags,
    };
  }

  function renderBodyTemplate(body, context) {
    const source = normalizeBody(body);
    const values = context && typeof context === 'object' ? context : {};
    return source.replace(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g, (token, key) => {
      if (key === 'json') {
        try {
          return JSON.stringify(values);
        } catch {
          return token;
        }
      }
      if (!Object.prototype.hasOwnProperty.call(values, key)) return token;
      if (key === 'tags') return Array.isArray(values.tags) ? values.tags.join(', ') : String(values.tags ?? '');
      return String(values[key] ?? '');
    });
  }

  function sampleContext() {
    const nextAt = TEST_CONTEXT_NEXT_AT;
    return {
      id: 'webhook-test',
      title: 'TabWall webhook test',
      displayTitle: '',
      url: 'https://example.com/tabwall-webhook-test',
      message: 'This is a TabWall webhook test.',
      mode: 'once',
      nextAt,
      nextAtIso: new Date(nextAt).toISOString(),
      tags: ['webhook', 'test'],
    };
  }

  function withoutProfiles(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const next = { ...source };
    delete next.webhookProfiles;
    return next;
  }

  global.TabWallWebhookCore = {
    MAX_PROFILES,
    MAX_HEADERS,
    MAX_PROFILE_ID_LENGTH,
    MAX_PROFILE_NAME_LENGTH,
    MAX_URL_LENGTH,
    MAX_HEADER_NAME_LENGTH,
    MAX_HEADER_VALUE_LENGTH,
    MAX_BODY_LENGTH,
    REQUEST_TIMEOUT_MS,
    normalizeUrl,
    normalizeHeaders,
    normalizeBody,
    normalizeProfile,
    normalizeProfiles,
    normalizeProfileIds,
    validateProfile,
    buildContext,
    renderBodyTemplate,
    sampleContext,
    withoutProfiles,
  };
})(typeof self !== 'undefined' ? self : globalThis);
