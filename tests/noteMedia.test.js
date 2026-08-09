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
