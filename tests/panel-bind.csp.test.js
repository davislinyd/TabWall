import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SETTINGS_SRC = fs.readFileSync(new URL('../parkSettingsUi.js', import.meta.url), 'utf8');
const IMPORT_SRC = fs.readFileSync(new URL('../parkImportExport.js', import.meta.url), 'utf8');
const STICKER_SRC = fs.readFileSync(new URL('../parkStickerUi.js', import.meta.url), 'utf8');
const PARK_SRC = fs.readFileSync(new URL('../park.js', import.meta.url), 'utf8');

function loadPanels() {
  const sandbox = { self: null, console };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SETTINGS_SRC, sandbox, { filename: 'parkSettingsUi.js' });
  vm.runInContext(IMPORT_SRC, sandbox, { filename: 'parkImportExport.js' });
  vm.runInContext(STICKER_SRC, sandbox, { filename: 'parkStickerUi.js' });
  return {
    SettingsUi: sandbox.TabWallSettingsUi,
    ImportExport: sandbox.TabWallImportExport,
    StickerUi: sandbox.TabWallStickerUi,
  };
}

test('panel modules export TabWall* APIs with bind (no with statement)', () => {
  for (const src of [SETTINGS_SRC, IMPORT_SRC, STICKER_SRC]) {
    // Strip block/line comments before checking for with-statement.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bwith\s*\(/);
    assert.doesNotMatch(code, /\beval\s*\(/);
    assert.match(src, /function bind\(/);
    assert.match(src, /env\.\w+/);
  }
  assert.match(SETTINGS_SRC, /TabWallSettingsUi/);
  assert.match(IMPORT_SRC, /TabWallImportExport/);
  assert.match(STICKER_SRC, /TabWallStickerUi/);
});

test('bindPanelModules uses real closures — not eval — for live env accessors', () => {
  const start = PARK_SRC.indexOf('function bindPanelModules');
  assert.ok(start >= 0, 'bindPanelModules present');
  const end = PARK_SRC.indexOf('bindPanelModules();', start);
  const block = PARK_SRC.slice(start, end);
  assert.doesNotMatch(block, /\beval\s*\(/);
  assert.doesNotMatch(block, /new Function\s*\(/);
  // Compact live env: getters via ro/rw maps (still real closures, no eval).
  assert.match(block, /"settings":\s*\{\s*get:\s*\(\)\s*=>\s*settings/);
  assert.match(block, /set:\s*\(v\)\s*=>\s*\{\s*settings = v/);
  assert.match(block, /SettingsUi\.bind\(env\)/);
  assert.match(block, /ImportExport\.bind\(env\)/);
  assert.match(block, /StickerUi\.bind\(env\)/);
});

test('panel bind accessors return and mutate real values without eval', () => {
  const { SettingsUi, ImportExport, StickerUi } = loadPanels();
  assert.equal(typeof SettingsUi.bind, 'function');
  assert.equal(typeof SettingsUi.normalizeAutoBackup, 'function');
  assert.equal(typeof ImportExport.formatImportWarnings, 'function');
  assert.equal(typeof StickerUi.stickerNoteUuid, 'function');

  // Live state object that panels read/write through getters/setters (same pattern as park.js).
  let settings = {
    autoBackup: {
      enabled: false,
      mode: 'lite',
      scheduleHour: 0,
      scheduleMinute: 0,
      maxKeep: 5,
      subfolder: 'TabWall-Backups',
      folderPath: '',
      lastSuccessAt: 0,
      lastError: '',
    },
  };
  let tCalls = 0;
  const env = Object.create(null);
  Object.defineProperty(env, 'settings', {
    enumerable: true,
    get() { return settings; },
    set(v) { settings = v; },
  });
  Object.defineProperty(env, 't', {
    enumerable: true,
    get() {
      return (key, vars) => {
        tCalls += 1;
        return key;
      };
    },
  });
  Object.defineProperty(env, 'DEFAULT_AUTO_BACKUP', {
    enumerable: true,
    get() {
      return {
        enabled: false,
        mode: 'lite',
        scheduleHour: 0,
        scheduleMinute: 0,
        maxKeep: 5,
        subfolder: 'TabWall-Backups',
        folderPath: '',
        lastSuccessAt: 0,
        lastError: '',
      };
    },
  });
  Object.defineProperty(env, 'clampInt', {
    enumerable: true,
    get() {
      return (n, min, max, fallback) => {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.min(max, Math.max(min, Math.round(v)));
      };
    },
  });

  SettingsUi.bind(env);
  ImportExport.bind(env);
  StickerUi.bind(env);

  // Pure normalize should run via env.DEFAULT_AUTO_BACKUP getter (no eval).
  const ab = SettingsUi.normalizeAutoBackup({ enabled: true, scheduleHour: 9, scheduleMinute: 30 });
  assert.equal(ab.enabled, true);
  assert.equal(ab.scheduleHour, 9);
  assert.equal(ab.scheduleMinute, 30);

  // Mutation through env.settings setter path used by panel bodies.
  env.settings = { ...env.settings, locale: 'en' };
  assert.equal(settings.locale, 'en');

  // formatImportWarnings uses env.t
  const msg = ImportExport.formatImportWarnings({ legacyVersion: 1 });
  assert.equal(typeof msg, 'string');
  assert.ok(tCalls >= 1, 't getter must be invoked without eval');

  // sticker uuid is pure-ish and must work after bind
  const id = StickerUi.stickerNoteUuid();
  assert.match(String(id), /[0-9a-f-]{8,}/i);

  // Calling before bind must throw (ensureBound)
  const fresh = loadPanels();
  assert.throws(() => fresh.SettingsUi.normalizeAutoBackup({}), /before bind/i);
});


test('panel sources keep real HTML class/attribute names (no env. rewrite corruption)', () => {
  // Product path: settings nav + auto-save metadata markup must match park.html/CSS.
  assert.match(SETTINGS_SRC, /data-settings-section/);
  assert.doesNotMatch(SETTINGS_SRC, /data-env\.settings-section/);
  assert.doesNotMatch(SETTINGS_SRC, /data-env\./);
  assert.match(SETTINGS_SRC, /class="settings-input/);
  assert.match(SETTINGS_SRC, /class="settings-textarea/);
  assert.doesNotMatch(SETTINGS_SRC, /class="env\.settings-input/);
  assert.doesNotMatch(SETTINGS_SRC, /class="env\.settings-textarea/);
  assert.doesNotMatch(SETTINGS_SRC, /class="env\./);
  // querySelector paths used by applySettingsSection / initSettingsSections
  assert.match(SETTINGS_SRC, /\.settings-block\[data-settings-section\]/);
  assert.match(SETTINGS_SRC, /\.settings-nav-btn\[data-settings-section\]/);
});
