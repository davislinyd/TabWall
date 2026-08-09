/**
 * TabWall — Sticker Note image normalization and resource policy
 * Shared by the service worker and park.html.
 */
(function (global) {
  const LIMITS = Object.freeze({
    MAX_IMAGE_BYTES: 24 * 1024 * 1024,
    MAX_NOTE_IMAGE_LONG_EDGE: 4096,
    MAX_NOTE_IMAGE_PIXELS: 16 * 1024 * 1024,
    MAX_SOURCE_DECODE_PIXELS: 64 * 1024 * 1024,
    OUTPUT_QUALITY: 0.88,
    OUTPUT_MIMES: Object.freeze(['image/webp', 'image/png']),
  });

  function error(code) {
    const err = new Error(code);
    err.code = code;
    return err;
  }

  function finiteDimension(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function fitDimensions(width, height) {
    const sourceWidth = finiteDimension(width);
    const sourceHeight = finiteDimension(height);
    if (!sourceWidth || !sourceHeight) throw error('note_image_invalid_dimensions');
    const edgeScale = LIMITS.MAX_NOTE_IMAGE_LONG_EDGE / Math.max(sourceWidth, sourceHeight);
    const pixelScale = Math.sqrt(LIMITS.MAX_NOTE_IMAGE_PIXELS / (sourceWidth * sourceHeight));
    const scale = Math.min(1, edgeScale, pixelScale);
    let outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    let outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    while (outputWidth * outputHeight > LIMITS.MAX_NOTE_IMAGE_PIXELS) {
      if (outputWidth >= outputHeight) outputWidth--;
      else outputHeight--;
    }
    if (Math.max(outputWidth, outputHeight) > LIMITS.MAX_NOTE_IMAGE_LONG_EDGE) {
      const edge = Math.max(outputWidth, outputHeight);
      const edgeScale = LIMITS.MAX_NOTE_IMAGE_LONG_EDGE / edge;
      outputWidth = Math.max(1, Math.floor(outputWidth * edgeScale));
      outputHeight = Math.max(1, Math.floor(outputHeight * edgeScale));
    }
    return {
      width: outputWidth,
      height: outputHeight,
      sourceWidth,
      sourceHeight,
    };
  }

  function isOutputMime(mime) {
    return LIMITS.OUTPUT_MIMES.includes(String(mime || '').toLowerCase());
  }

  function validateNormalizedMetadata(metadata, blob = null) {
    const value = metadata && typeof metadata === 'object' ? metadata : {};
    const mime = String(value.mime || blob?.type || '').toLowerCase();
    const size = Number(value.size ?? blob?.size);
    const width = finiteDimension(value.width);
    const height = finiteDimension(value.height);
    if (!isOutputMime(mime)) return 'note_image_invalid_output_mime';
    if (!Number.isInteger(size) || size < 1 || size > LIMITS.MAX_IMAGE_BYTES) {
      return 'note_image_output_too_large';
    }
    if (!width || !height || Math.max(width, height) > LIMITS.MAX_NOTE_IMAGE_LONG_EDGE
      || width * height > LIMITS.MAX_NOTE_IMAGE_PIXELS) {
      return 'note_image_invalid_output_dimensions';
    }
    if (blob && Number(blob.size) !== size) return 'note_image_size_mismatch';
    return '';
  }

  function makeCanvas(width, height) {
    if (typeof global.OffscreenCanvas === 'function') return new global.OffscreenCanvas(width, height);
    if (global.document?.createElement) {
      const canvas = global.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    throw error('note_image_canvas_unavailable');
  }

  function canvasToBlob(canvas, type, quality) {
    if (typeof canvas.convertToBlob === 'function') {
      return canvas.convertToBlob({ type, quality });
    }
    if (typeof canvas.toBlob === 'function') {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(error('note_image_encode_failed'));
        }, type, quality);
      });
    }
    return Promise.reject(error('note_image_canvas_unavailable'));
  }

  async function normalizeBlob(source) {
    if (!source || typeof source.size !== 'number') throw error('note_image_invalid');
    if (source.size > LIMITS.MAX_IMAGE_BYTES) throw error('note_image_source_too_large');
    if (typeof global.createImageBitmap !== 'function') throw error('note_image_decode_unavailable');

    let bitmap = null;
    let canvas = null;
    let output = null;
    try {
      bitmap = await global.createImageBitmap(source);
      const sourceWidth = finiteDimension(bitmap?.width);
      const sourceHeight = finiteDimension(bitmap?.height);
      if (!sourceWidth || !sourceHeight) throw error('note_image_invalid_dimensions');
      if (sourceWidth * sourceHeight > LIMITS.MAX_SOURCE_DECODE_PIXELS) {
        throw error('note_image_decode_too_large');
      }
      const dimensions = fitDimensions(sourceWidth, sourceHeight);
      canvas = makeCanvas(dimensions.width, dimensions.height);
      const ctx = canvas.getContext?.('2d', { alpha: true });
      if (!ctx) throw error('note_image_canvas_unavailable');
      ctx.clearRect?.(0, 0, dimensions.width, dimensions.height);
      ctx.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

      try {
        output = await canvasToBlob(canvas, 'image/webp', LIMITS.OUTPUT_QUALITY);
      } catch {
        // Fall back to PNG when WebP encoding is unavailable.
      }
      let mime = String(output?.type || '').toLowerCase();
      if (!output || !isOutputMime(mime) || mime !== 'image/webp') {
        try {
          output = await canvasToBlob(canvas, 'image/png');
        } catch {
          throw error('note_image_encode_failed');
        }
        mime = String(output?.type || 'image/png').toLowerCase();
      }
      if (!output || !isOutputMime(mime)) throw error('note_image_encode_failed');
      const normalized = new Blob([output], { type: mime });
      const metadata = {
        mime,
        size: normalized.size,
        width: dimensions.width,
        height: dimensions.height,
      };
      const validationError = validateNormalizedMetadata(metadata, normalized);
      if (validationError) throw error(validationError);
      return {
        ...metadata,
        sourceWidth,
        sourceHeight,
        blob: normalized,
      };
    } finally {
      try {
        bitmap?.close?.();
      } catch {
        // best effort bitmap cleanup
      }
      try {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      } catch {
        // best effort canvas cleanup
      }
      output = null;
    }
  }

  function normalizeDataUrl(dataUrl) {
    if (typeof global.fetch !== 'function' || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return Promise.reject(error('note_image_invalid'));
    }
    return global.fetch(dataUrl)
      .then((response) => response.blob())
      .then((blob) => normalizeBlob(blob));
  }

  global.TabWallNoteMedia = {
    LIMITS,
    fitDimensions,
    validateNormalizedMetadata,
    normalizeBlob,
    normalizeDataUrl,
  };
})(typeof self !== 'undefined' ? self : globalThis);
