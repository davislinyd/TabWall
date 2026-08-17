import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const MANIFEST = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const POPUP_HTML = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
const POPUP_SOURCE = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');

test('extension action opens the TabWall popup', () => {
  assert.equal(MANIFEST.action?.default_popup, 'popup.html');
  assert.equal(MANIFEST.version, '2.46.5');
  assert.match(POPUP_HTML, /<script src="popup\.js"><\/script>/);
});

test('popup exposes separate tab and group save actions plus panel opening', () => {
  for (const id of ['saveTabKeep', 'saveTabClose', 'saveGroupKeep', 'saveGroupClose', 'openPark', 'pageNote', 'pageTagDraft', 'overlayToggle']) {
    assert.match(POPUP_HTML, new RegExp('id="' + id + '"'));
  }
  assert.match(POPUP_SOURCE, /type: 'GET_PAGE_ANNOTATION'/);
  assert.match(POPUP_SOURCE, /type: 'UPSERT_PAGE_ANNOTATION'/);
  assert.match(POPUP_HTML, /id="saveGroupKeep"[^>]*data-group-action/);
  assert.match(POPUP_HTML, /id="saveGroupClose"[^>]*data-group-action/);
  assert.match(POPUP_SOURCE, /type: 'SAVE_ACTIVE_TAB', afterSave: 'keep'/);
  assert.match(POPUP_SOURCE, /type: 'SAVE_ACTIVE_TAB', afterSave: 'close'/);
  assert.match(POPUP_SOURCE, /type: 'SAVE_ACTIVE_GROUP', afterSaveGroup: 'keep'/);
  assert.match(POPUP_SOURCE, /type: 'SAVE_ACTIVE_GROUP', afterSaveGroup: 'close'/);
  assert.match(POPUP_SOURCE, /type: 'OPEN_PARK_ACTIVE', targetTabId/);
  assert.match(POPUP_SOURCE, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/);
  assert.match(POPUP_SOURCE, /for \(const button of groupActionButtons\)/);
  assert.match(POPUP_SOURCE, /button\.disabled = busy \|\| !currentTabInGroup/);
});

test('popup follows the saved locale with Traditional Chinese fallback', () => {
  assert.match(POPUP_SOURCE, /data\.settings\?\.locale === 'en' \? 'en' : 'zh'/);
  assert.match(POPUP_SOURCE, /document\.documentElement\.lang = locale === 'en' \? 'en' : 'zh-Hant'/);
  assert.match(POPUP_SOURCE, /saveTabKeep: '儲存目前分頁（不關閉）'/);
  assert.match(POPUP_SOURCE, /saveTabKeep: 'Save current tab \(keep open\)'/);
});
