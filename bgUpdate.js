/**
 * TabWall — GitHub stable release checker
 * Only release metadata is stored; downloads and installs remain manual.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'releaseUpdate';
  const ALARM_NAME = 'tabwall-release-check';
  const CHECK_INTERVAL_MINUTES = 24 * 60;
  const REQUEST_TIMEOUT_MS = 10_000;
  const RELEASE_API_URL = 'https://api.github.com/repos/davislinyd/TabWall/releases/latest';
  const RELEASE_URL_PREFIX = 'https://github.com/davislinyd/TabWall/releases/';
  const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

  let activeCheck = null;

  function parseVersion(value) {
    const match = String(value ?? '').trim().match(SEMVER_RE);
    if (!match) return null;
    const parts = match.slice(1, 4).map(Number);
    if (!parts.every((part) => Number.isSafeInteger(part))) return null;
    return {
      major: parts[0],
      minor: parts[1],
      patch: parts[2],
      value: parts.join('.'),
    };
  }

  function compareVersions(leftValue, rightValue) {
    const left = typeof leftValue === 'string' ? parseVersion(leftValue) : leftValue;
    const right = typeof rightValue === 'string' ? parseVersion(rightValue) : rightValue;
    if (!left || !right) return null;
    for (const part of ['major', 'minor', 'patch']) {
      if (left[part] !== right[part]) return left[part] > right[part] ? 1 : -1;
    }
    return 0;
  }

  function updateError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function normalizeRelease(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.draft === true || payload.prerelease === true) return null;

    const tagName = String(payload.tag_name || payload.tagName || '').trim();
    const parsed = parseVersion(tagName);
    if (!parsed) return null;

    const url = String(payload.html_url || payload.url || '').trim();
    if (!url.startsWith(RELEASE_URL_PREFIX)) return null;

    const key = String(payload.id ?? '').trim() || tagName;
    return {
      key,
      version: parsed.value,
      tagName,
      name: String(payload.name || '').trim().slice(0, 200),
      url,
      publishedAt: String(payload.published_at || payload.publishedAt || '').trim().slice(0, 100),
    };
  }

  function normalizeStoredRelease(value) {
    if (!value || typeof value !== 'object') return null;
    return normalizeRelease({
      id: value.key,
      tag_name: value.tagName || value.tag_name,
      name: value.name,
      html_url: value.url || value.html_url,
      published_at: value.publishedAt || value.published_at,
    });
  }

  function normalizeState(value) {
    const lastCheckedAt = Number(value?.lastCheckedAt);
    return {
      latestRelease: normalizeStoredRelease(value?.latestRelease),
      lastCheckedAt: Number.isFinite(lastCheckedAt) && lastCheckedAt > 0 ? lastCheckedAt : 0,
      dismissedReleaseKey: typeof value?.dismissedReleaseKey === 'string'
        ? value.dismissedReleaseKey
        : '',
    };
  }

  function getCurrentVersion() {
    try {
      return String(global.chrome?.runtime?.getManifest?.().version || '').trim() || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  function statusForState(state) {
    const latestRelease = state.latestRelease;
    const comparison = latestRelease
      ? compareVersions(getCurrentVersion(), latestRelease.version)
      : null;
    const hasNewerRelease = comparison != null && comparison < 0;
    const noticePending = hasNewerRelease && state.dismissedReleaseKey !== latestRelease.key;
    return {
      ok: true,
      currentVersion: getCurrentVersion(),
      latestRelease,
      lastCheckedAt: state.lastCheckedAt,
      dismissedReleaseKey: state.dismissedReleaseKey,
      hasNewerRelease,
      noticePending,
    };
  }

  async function readState() {
    const data = await global.chrome.storage.local.get(STORAGE_KEY);
    return normalizeState(data?.[STORAGE_KEY]);
  }

  async function fetchLatestRelease() {
    const controller = typeof global.AbortController === 'function'
      ? new global.AbortController()
      : null;
    let timedOut = false;
    const timeoutId = global.setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await global.fetch(RELEASE_API_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        credentials: 'omit',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response?.ok) {
        throw updateError(`http_${Number(response?.status) || 0}`);
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw updateError('invalid_response');
      }
      const release = normalizeRelease(payload);
      if (!release) throw updateError('invalid_release');
      return release;
    } catch (error) {
      if (timedOut) throw updateError('timeout');
      if (error?.code) throw error;
      throw updateError('network_error');
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  async function getReleaseUpdateStatus() {
    try {
      return statusForState(await readState());
    } catch {
      return {
        ...statusForState(normalizeState(null)),
        ok: false,
        error: 'storage_unavailable',
      };
    }
  }

  async function checkReleaseUpdate({ reason = 'manual' } = {}) {
    if (activeCheck) return activeCheck;

    activeCheck = (async () => {
      let state;
      try {
        state = await readState();
        const latestRelease = await fetchLatestRelease();
        const nextState = {
          ...state,
          latestRelease,
          lastCheckedAt: Date.now(),
        };
        await global.chrome.storage.local.set({ [STORAGE_KEY]: nextState });
        return { ...statusForState(nextState), reason };
      } catch (error) {
        const fallback = state || normalizeState(null);
        return {
          ...statusForState(fallback),
          ok: false,
          error: error?.code || 'check_failed',
          reason,
        };
      }
    })().finally(() => {
      activeCheck = null;
    });
    return activeCheck;
  }

  async function dismissReleaseUpdate(releaseKey) {
    let state;
    try {
      state = await readState();
      const key = String(releaseKey || '').trim();
      if (!key || !state.latestRelease || state.latestRelease.key !== key) {
        return {
          ...statusForState(state),
          ok: false,
          error: 'release_not_found',
        };
      }
      const nextState = { ...state, dismissedReleaseKey: key };
      await global.chrome.storage.local.set({ [STORAGE_KEY]: nextState });
      return statusForState(nextState);
    } catch {
      return {
        ...statusForState(state || normalizeState(null)),
        ok: false,
        error: 'storage_unavailable',
      };
    }
  }

  async function syncReleaseCheckAlarm() {
    try {
      const alarms = await global.chrome.alarms.getAll();
      if (!alarms.some((alarm) => alarm?.name === ALARM_NAME)) {
        await global.chrome.alarms.create(ALARM_NAME, {
          delayInMinutes: CHECK_INTERVAL_MINUTES,
          periodInMinutes: CHECK_INTERVAL_MINUTES,
        });
      }
      return {
        ok: true,
        alarmName: ALARM_NAME,
        periodInMinutes: CHECK_INTERVAL_MINUTES,
      };
    } catch {
      return { ok: false, error: 'alarm_sync_failed' };
    }
  }

  global.TabWallReleaseUpdate = {
    STORAGE_KEY,
    ALARM_NAME,
    CHECK_INTERVAL_MINUTES,
    REQUEST_TIMEOUT_MS,
    RELEASE_API_URL,
    parseVersion,
    compareVersions,
    normalizeRelease,
    getReleaseUpdateStatus,
    checkReleaseUpdate,
    dismissReleaseUpdate,
    syncReleaseCheckAlarm,
  };
})(typeof self !== 'undefined' ? self : globalThis);
