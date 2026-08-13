import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../noteMedia.js', import.meta.url), 'utf8');

function loadNoteMedia(dimensions = { width: 8000, height: 4000 }) {
  const sandbox = {
    Blob,
    console,
    createImageBitmap: async () => ({
      ...dimensions,
      close() {},
    }),
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return { clearRect() {}, drawImage() {} };
      }

      async convertToBlob({ type = 'image/webp' } = {}) {
        return new Blob([new Uint8Array([1, 2, 3])], { type });
      }
    },
  };
  sandbox.self = sandbox;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'noteMedia.js' });
  return sandbox.TabWallNoteMedia;
}

test('fitDimensions enforces the 4096px edge and 16MP pixel caps', () => {
  const media = loadNoteMedia();
  const fitted = media.fitDimensions(8000, 4000);
  assert.equal(fitted.width, 4096);
  assert.equal(fitted.height, 2048);
  assert.equal(fitted.sourceWidth, 8000);
  assert.equal(fitted.sourceHeight, 4000);
  const square = media.fitDimensions(20000, 20000);
  assert.ok(square.width <= 4096);
  assert.ok(square.height <= 4096);
  assert.ok(square.width * square.height <= 16 * 1024 * 1024);
});

test('normalizeBlob outputs bounded WebP metadata and closes the bitmap', async () => {
  const media = loadNoteMedia({ width: 8000, height: 4000 });
  const result = await media.normalizeBlob(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
  assert.equal(result.mime, 'image/webp');
  assert.equal(result.width, 4096);
  assert.equal(result.height, 2048);
  assert.ok(result.size <= media.LIMITS.MAX_IMAGE_BYTES);
  assert.equal(media.validateNormalizedMetadata(result, result.blob), '');
});

test('identifyImageKind accepts WEBP GIF SVG HEIC by mime or extension', () => {
  const media = loadNoteMedia();
  assert.equal(media.identifyImageKind({ type: 'image/webp' }), 'webp');
  assert.equal(media.identifyImageKind({ type: 'image/gif' }), 'gif');
  assert.equal(media.identifyImageKind({ type: 'image/svg+xml' }), 'svg');
  assert.equal(media.identifyImageKind({ type: 'image/heic' }), 'heic');
  assert.equal(media.identifyImageKind({ type: '' }, 'photo.HEIF'), 'heic');
  assert.equal(media.identifyImageKind({ type: '' }, 'clip.webp'), 'webp');
  assert.equal(media.identifyImageKind({ type: 'application/pdf' }, 'a.pdf'), '');
});

test('isHeicBuffer detects ftyp brands and parseSvgSize caps missing size', () => {
  const media = loadNoteMedia();
  const bytes = new Uint8Array(12);
  bytes.set([0x68, 0x65, 0x69, 0x63], 8); // heic
  assert.equal(media.isHeicBuffer(bytes), true);
  assert.equal(media.isHeicBuffer(new Uint8Array(12)), false);
  const sized = media.parseSvgSize('<svg width="200" height="100"></svg>');
  assert.equal(sized.width, 200);
  assert.equal(sized.height, 100);
  const fallback = media.parseSvgSize('<svg></svg>');
  assert.equal(fallback.width, 1024);
  assert.equal(fallback.height, 1024);
  const huge = media.parseSvgSize('<svg viewBox="0 0 200000 200000"></svg>');
  assert.equal(huge.width, 200000);
  assert.equal(huge.height, 200000);
});

test('normalizeCardMedia rejects disallowed types and builds thumb plus snap', async () => {
  const media = loadNoteMedia({ width: 4000, height: 2000 });
  await assert.rejects(
    media.normalizeCardMedia(new Blob([new Uint8Array([1])], { type: 'application/pdf' }), { name: 'a.pdf' }),
    { code: 'note_image_unsupported_type' }
  );
  const result = await media.normalizeCardMedia(
    new Blob([new Uint8Array([1, 2, 3])], { type: 'image/gif' }),
    { name: 'shot.gif' }
  );
  assert.equal(result.title, 'shot');
  assert.equal(result.kind, 'gif');
  assert.ok(result.thumbBlob?.size > 0);
  assert.ok(result.snapBlob?.size > 0);
});

test('normalizeBlob uses the injected HEIC decoder and rejects a huge SVG viewBox', async () => {
  const sandboxMedia = loadNoteMedia({ width: 800, height: 600 });
  const SOURCE = fs.readFileSync(new URL('../noteMedia.js', import.meta.url), 'utf8');
  const sandbox = {
    Blob,
    URL,
    console,
    TabWallHeicDecode: async () => new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }),
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { clearRect() {}, drawImage() {} };
      }
      async convertToBlob({ type = 'image/webp' } = {}) {
        return new Blob([new Uint8Array([1, 2, 3])], { type });
      }
    },
  };
  sandbox.self = sandbox;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'noteMedia.js' });
  const decoded = await sandbox.TabWallNoteMedia.normalizeBlob(
    new Blob([new Uint8Array([1])], { type: 'image/heic' }),
    { name: 'img.heic' }
  );
  assert.equal(decoded.mime, 'image/webp');
  assert.equal(decoded.width, 800);

  await assert.rejects(
    sandboxMedia.normalizeBlob(
      new Blob([new TextEncoder().encode('<svg viewBox="0 0 200000 200000"></svg>')], { type: 'image/svg+xml' }),
      { name: 'huge.svg' }
    ),
    { code: 'note_image_decode_too_large' }
  );
});

test('normalizeBlob rejects an oversized source before decode and a decompression bomb', async () => {
  const media = loadNoteMedia();
  const oversized = new Blob([new Uint8Array(media.LIMITS.MAX_IMAGE_BYTES + 1)], { type: 'image/png' });
  await assert.rejects(media.normalizeBlob(oversized), { code: 'note_image_source_too_large' });

  const bombMedia = loadNoteMedia({ width: 100000, height: 1000 });
  await assert.rejects(
    bombMedia.normalizeBlob(new Blob([new Uint8Array([1])], { type: 'image/png' })),
    { code: 'note_image_decode_too_large' }
  );
});
