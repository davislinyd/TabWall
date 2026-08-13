import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadWallpaper() {
  const sandbox = { console };
  sandbox.self = sandbox;
  vm.runInNewContext(
    fs.readFileSync(new URL('../parkWallpaper.js', import.meta.url), 'utf8'),
    sandbox,
    { filename: 'parkWallpaper.js' }
  );
  return sandbox.TabWallWallpaper;
}

test('normalizeWallpaper clamps fit, opacity, blur, and strips data', () => {
  const Wallpaper = loadWallpaper();
  const next = Wallpaper.normalizeWallpaper({
    enabled: 'yes',
    fit: 'stretch',
    opacity: 3,
    blurPx: 99,
    mime: 'image/webp',
    width: 1920,
    height: 1080,
    updatedAt: 12,
    data: 'data:image/webp;base64,AAA',
  });
  assert.equal(next.enabled, false);
  assert.equal(next.fit, 'center');
  assert.equal(next.opacity, 15);
  assert.equal(next.blurPx, 32);
  assert.equal(next.mime, 'image/webp');
  assert.equal(next.width, 1920);
  assert.equal(next.height, 1080);
  assert.equal(next.updatedAt, 12);
  assert.equal('data' in next, false);
});

test('normalizeWallpaper keeps the four fit modes and enabled only when true', () => {
  const Wallpaper = loadWallpaper();
  assert.equal(Wallpaper.normalizeWallpaper({ fit: 'fitWidth' }).fit, 'fitWidth');
  assert.equal(Wallpaper.normalizeWallpaper({ fit: 'fitHeight' }).fit, 'fitHeight');
  assert.equal(Wallpaper.normalizeWallpaper({ fit: 'original' }).fit, 'original');
  assert.equal(Wallpaper.normalizeWallpaper({ enabled: true }).enabled, true);
  const fallback = Wallpaper.normalizeWallpaper(null);
  assert.equal(fallback.enabled, false);
  assert.equal(fallback.fit, 'center');
  assert.equal(fallback.opacity, 40);
  assert.equal(fallback.blurPx, 16);
});
