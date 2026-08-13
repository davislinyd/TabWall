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
    MAX_CARD_FILES: 8,
    CARD_SNAP_LONG_EDGE: 1920,
    CARD_THUMB_WIDTH: 480,
    CARD_THUMB_QUALITY: 0.6,
    CARD_SNAP_QUALITY: 0.85,
    OUTPUT_QUALITY: 0.88,
    OUTPUT_MIMES: Object.freeze(['image/webp', 'image/png']),
  });

  const KIND_BY_MIME = Object.freeze({
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/pjpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'image/heic-sequence': 'heic',
    'image/heif-sequence': 'heic',
  });

  const KIND_BY_EXT = Object.freeze({
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    webp: 'webp',
    gif: 'gif',
    svg: 'svg',
    heic: 'heic',
    heif: 'heic',
  });

  let heicLibPromise = null;

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

  function fileExtension(name) {
    const base = String(name || '').replace(/^.*[\\/]/, '');
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  }

  function identifyImageKind(source, name = '') {
    const mime = String(source?.type || '').toLowerCase();
    if (KIND_BY_MIME[mime]) return KIND_BY_MIME[mime];
    const ext = fileExtension(name || source?.name || '');
    return KIND_BY_EXT[ext] || '';
  }

  function isHeicBuffer(bytes) {
    if (!bytes || bytes.length < 12) return false;
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).replace('\0', ' ').trim();
    return brand === 'mif1' || brand === 'msf1' || brand === 'heic' || brand === 'heix'
      || brand === 'hevc' || brand === 'hevx';
  }

  function titleFromFileName(name) {
    const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
    return base.slice(0, 2048);
  }

  function parseSvgSize(text) {
    const source = String(text || '');
    const widthMatch = /<svg\b[^>]*\bwidth\s*=\s*["']?([\d.]+)/i.exec(source);
    const heightMatch = /<svg\b[^>]*\bheight\s*=\s*["']?([\d.]+)/i.exec(source);
    const viewBox = /viewBox\s*=\s*["']?\s*[-.\d]+\s+[-.\d]+\s+([\d.]+)\s+([\d.]+)/i.exec(source);
    let width = Number(widthMatch?.[1]) || 0;
    let height = Number(heightMatch?.[1]) || 0;
    if ((!width || !height) && viewBox) {
      width = Number(viewBox[1]) || 0;
      height = Number(viewBox[2]) || 0;
    }
    if (!width || !height) return { width: 1024, height: 1024 };
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }

  function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
      const ImageCtor = global.Image;
      const img = typeof ImageCtor === 'function'
        ? new ImageCtor()
        : global.document?.createElement?.('img');
      if (!img) {
        reject(error('note_image_svg_unsupported'));
        return;
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(error('note_image_invalid'));
      img.src = url;
    });
  }

  async function rasterizeSvg(source) {
    const text = await source.text();
    if (!/<svg[\s>]/i.test(text)) throw error('note_image_invalid');
    const size = parseSvgSize(text);
    if (size.width * size.height > LIMITS.MAX_SOURCE_DECODE_PIXELS) {
      throw error('note_image_decode_too_large');
    }
    if (typeof URL?.createObjectURL !== 'function') throw error('note_image_svg_unsupported');
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try {
      const img = await loadHtmlImage(url);
      const width = finiteDimension(img.naturalWidth) || size.width;
      const height = finiteDimension(img.naturalHeight) || size.height;
      if (!width || !height) throw error('note_image_invalid_dimensions');
      if (width * height > LIMITS.MAX_SOURCE_DECODE_PIXELS) throw error('note_image_decode_too_large');
      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext?.('2d', { alpha: true });
      if (!ctx) throw error('note_image_canvas_unavailable');
      ctx.clearRect?.(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return canvas;
    } finally {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }

  function loadLibheif() {
    if (global.libheif) return Promise.resolve(global.libheif);
    if (heicLibPromise) return heicLibPromise;
    if (!global.document?.createElement) return Promise.reject(error('note_image_heic_unsupported'));
    heicLibPromise = new Promise((resolve, reject) => {
      const script = global.document.createElement('script');
      script.src = 'vendor/libheif-bundle.js';
      script.async = true;
      script.onload = () => {
        if (global.libheif) resolve(global.libheif);
        else {
          heicLibPromise = null;
          reject(error('note_image_heic_unsupported'));
        }
      };
      script.onerror = () => {
        heicLibPromise = null;
        reject(error('note_image_heic_unsupported'));
      };
      (global.document.head || global.document.documentElement).appendChild(script);
    });
    return heicLibPromise;
  }

  async function decodeHeicToBlob(source) {
    if (typeof global.TabWallHeicDecode === 'function') {
      const decoded = await global.TabWallHeicDecode(source);
      if (!decoded || typeof decoded.size !== 'number') throw error('note_image_heic_unsupported');
      return decoded;
    }
    const buffer = new Uint8Array(await source.arrayBuffer());
    if (!isHeicBuffer(buffer)) throw error('note_image_heic_unsupported');
    const lib = await loadLibheif();
    if (lib?.ready) await lib.ready;
    if (typeof lib?.HeifDecoder !== 'function') throw error('note_image_heic_unsupported');
    const decoder = new lib.HeifDecoder();
    let images = [];
    try {
      images = decoder.decode(buffer) || [];
      if (!images.length) throw error('note_image_heic_unsupported');
      const image = images[0];
      const width = finiteDimension(image.get_width?.());
      const height = finiteDimension(image.get_height?.());
      if (!width || !height) throw error('note_image_invalid_dimensions');
      if (width * height > LIMITS.MAX_SOURCE_DECODE_PIXELS) throw error('note_image_decode_too_large');
      const display = await new Promise((resolve, reject) => {
        image.display(
          { data: new Uint8ClampedArray(width * height * 4), width, height },
          (data) => {
            if (!data) reject(error('note_image_heic_unsupported'));
            else resolve(data);
          }
        );
      });
      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext?.('2d', { alpha: true });
      if (!ctx?.putImageData) throw error('note_image_canvas_unavailable');
      const imageData = typeof ctx.createImageData === 'function'
        ? ctx.createImageData(width, height)
        : display;
      if (imageData !== display && imageData?.data && display?.data) imageData.data.set(display.data);
      ctx.putImageData(imageData, 0, 0);
      return canvasToBlob(canvas, 'image/jpeg', 0.92);
    } finally {
      try {
        images.forEach((image) => image.free?.());
      } catch {
        // ignore
      }
      try {
        decoder.decoder?.delete?.();
      } catch {
        // ignore
      }
    }
  }

  async function decodeSourceToBitmap(source, kind) {
    if (kind === 'heic') {
      const raster = await decodeHeicToBlob(source);
      return global.createImageBitmap(raster);
    }
    if (kind === 'svg') {
      const canvas = await rasterizeSvg(source);
      return global.createImageBitmap(canvas);
    }
    return global.createImageBitmap(source);
  }

  async function rasterBitmapToBlob(bitmap, { maxWidth = 0, maxLongEdge = 0, type, quality }) {
    let width = finiteDimension(bitmap.width);
    let height = finiteDimension(bitmap.height);
    if (!width || !height) throw error('note_image_invalid_dimensions');
    if (maxWidth && width > maxWidth) {
      height = Math.max(1, Math.round((height * maxWidth) / width));
      width = maxWidth;
    }
    const long = Math.max(width, height);
    if (maxLongEdge && long > maxLongEdge) {
      const scale = maxLongEdge / long;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext?.('2d', { alpha: true });
    if (!ctx) throw error('note_image_canvas_unavailable');
    ctx.clearRect?.(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, type, quality);
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // ignore
    }
    if (!blob) throw error('note_image_encode_failed');
    return blob;
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

  async function normalizeBlob(source, options = {}) {
    if (!source || typeof source.size !== 'number') throw error('note_image_invalid');
    if (source.size > LIMITS.MAX_IMAGE_BYTES) throw error('note_image_source_too_large');
    if (typeof global.createImageBitmap !== 'function') throw error('note_image_decode_unavailable');
    const kind = identifyImageKind(source, options.name || source.name || '');
    if (options.requireAllowedKind && !kind) throw error('note_image_unsupported_type');

    let bitmap = null;
    let canvas = null;
    let output = null;
    try {
      bitmap = await decodeSourceToBitmap(source, kind);
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

  async function normalizeCardMedia(source, options = {}) {
    const name = options.name || source?.name || '';
    const kind = identifyImageKind(source, name);
    if (!kind) throw error('note_image_unsupported_type');
    const normalized = await normalizeBlob(source, { name, requireAllowedKind: true });
    let bitmap = null;
    try {
      bitmap = await global.createImageBitmap(normalized.blob);
      const [thumbBlob, snapBlob] = await Promise.all([
        rasterBitmapToBlob(bitmap, {
          maxWidth: LIMITS.CARD_THUMB_WIDTH,
          type: 'image/jpeg',
          quality: LIMITS.CARD_THUMB_QUALITY,
        }),
        rasterBitmapToBlob(bitmap, {
          maxLongEdge: LIMITS.CARD_SNAP_LONG_EDGE,
          type: 'image/jpeg',
          quality: LIMITS.CARD_SNAP_QUALITY,
        }),
      ]);
      return {
        ...normalized,
        kind,
        title: titleFromFileName(name),
        thumbBlob,
        snapBlob,
      };
    } finally {
      try {
        bitmap?.close?.();
      } catch {
        // ignore
      }
    }
  }

  global.TabWallNoteMedia = {
    LIMITS,
    fitDimensions,
    validateNormalizedMetadata,
    identifyImageKind,
    isHeicBuffer,
    titleFromFileName,
    parseSvgSize,
    normalizeBlob,
    normalizeDataUrl,
    normalizeCardMedia,
  };
})(typeof self !== 'undefined' ? self : globalThis);
