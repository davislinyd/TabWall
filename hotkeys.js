/**
 * TabWall — in-page hotkey bridge
 * Uses e.code (KeyS) so macOS Option+letter still matches (e.key becomes ß etc.)
 */
(() => {
  if (window.__tabWallHotkeys) return;
  window.__tabWallHotkeys = true;

  const DEFAULT_SHORTCUTS = {
    'save-tab': { alt: true, shift: false, ctrl: false, meta: false, key: 's' },
    'save-group': { alt: true, shift: true, ctrl: false, meta: false, key: 'g' },
    'toggle-park': { alt: true, shift: false, ctrl: false, meta: false, key: 'o' },
  };

  /** @type {typeof DEFAULT_SHORTCUTS} */
  let shortcuts = {
    'save-tab': { ...DEFAULT_SHORTCUTS['save-tab'] },
    'save-group': { ...DEFAULT_SHORTCUTS['save-group'] },
    'toggle-park': { ...DEFAULT_SHORTCUTS['toggle-park'] },
  };

  function normalizeShortcuts(raw) {
    const base = {
      'save-tab': { ...DEFAULT_SHORTCUTS['save-tab'] },
      'save-group': { ...DEFAULT_SHORTCUTS['save-group'] },
      'toggle-park': { ...DEFAULT_SHORTCUTS['toggle-park'] },
    };
    if (!raw || typeof raw !== 'object') return base;
    for (const name of Object.keys(base)) {
      const s = raw[name];
      if (!s || typeof s !== 'object' || !s.key) continue;
      base[name] = {
        alt: Boolean(s.alt),
        shift: Boolean(s.shift),
        ctrl: Boolean(s.ctrl),
        meta: Boolean(s.meta),
        key: String(s.key).toLowerCase(),
      };
    }
    return base;
  }

  function loadShortcuts() {
    try {
      chrome.storage.local.get('settings', (data) => {
        if (chrome.runtime.lastError) return;
        shortcuts = normalizeShortcuts(data?.settings?.shortcuts);
      });
    } catch {
      // extension context invalidated
    }
  }

  loadShortcuts();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      shortcuts = normalizeShortcuts(changes.settings.newValue?.shortcuts);
    });
  } catch {
    // ignore
  }

  /** Physical key from KeyboardEvent (macOS Option-safe) */
  function keyFromEvent(e) {
    const code = e.code || '';
    if (code.startsWith('Key') && code.length === 4) {
      return code.slice(3).toLowerCase();
    }
    if (code.startsWith('Digit') && code.length === 6) {
      return code.slice(5);
    }
    if (code.startsWith('Numpad') && code.length > 6) {
      return code.slice(6).toLowerCase();
    }
    const map = {
      Space: ' ',
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backquote: '`',
    };
    if (map[code]) return map[code];
    if (e.key && e.key.length === 1) return e.key.toLowerCase();
    return (e.key || '').toLowerCase();
  }

  function matches(combo, e) {
    if (!combo || !combo.key) return false;
    if (Boolean(combo.alt) !== e.altKey) return false;
    if (Boolean(combo.shift) !== e.shiftKey) return false;
    if (Boolean(combo.ctrl) !== e.ctrlKey) return false;
    if (Boolean(combo.meta) !== e.metaKey) return false;
    return keyFromEvent(e) === String(combo.key).toLowerCase();
  }

  function isTypingTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return Boolean(el.closest && el.closest('[contenteditable="true"]'));
  }

  function fire(action) {
    try {
      chrome.runtime.sendMessage({ type: 'HOTKEY', action }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // ignore
    }
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;

      for (const action of ['save-tab', 'save-group', 'toggle-park']) {
        if (matches(shortcuts[action], e)) {
          e.preventDefault();
          e.stopPropagation();
          fire(action);
          return;
        }
      }
    },
    true
  );
})();
