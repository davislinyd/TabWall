/**
 * TabWall — backup payload → lite JSON / full ZIP (shared by park + offscreen)
 */
(function (global) {
  const FORMAT = 'tabwall-backup';
  const FORMAT_VERSION = 7;
  const SUPPORTED_MIN_VERSION = 1;
  const LIMITS = Object.freeze({
    MAX_JSON_BYTES: 100 * 1024 * 1024,
    MAX_ZIP_BYTES: 256 * 1024 * 1024,
    MAX_ENTRY_BYTES: 24 * 1024 * 1024,
    MAX_IMAGE_BYTES: 24 * 1024 * 1024,
    MAX_ZIP_ENTRIES: 30000,
    MAX_ITEMS: 10000,
    MAX_MEMBERS: 30000,
    MAX_TAGS: 100,
    MAX_TAG_CATALOG: 2000,
    MAX_URL_LENGTH: 8192,
    MAX_TITLE_LENGTH: 2048,
    MAX_NOTE_LENGTH: 20000,
    MAX_NOTE_CODE_TOTAL_LENGTH: 50000,
    MAX_NOTE_WEB_SOURCE_LENGTH: 50000,
    MAX_NOTE_ATTACHMENTS: 12,
    MAX_NOTE_IMAGE_LONG_EDGE: 4096,
    MAX_NOTE_IMAGE_PIXELS: 16 * 1024 * 1024,
    MAX_SOURCE_DECODE_PIXELS: 64 * 1024 * 1024,
    NOTE_ATTACHMENT_QUOTA_BYTES: 96 * 1024 * 1024,
    TOTAL_ATTACHMENT_QUOTA_BYTES: 512 * 1024 * 1024,
    NOTE_IMAGE_OUTPUT_QUALITY: 0.88,
    MAX_ATTACHMENT_NAME_LENGTH: 512,
    MAX_ATTACHMENT_ALT_LENGTH: 2048,
    MAX_TAG_LENGTH: 128,
    MAX_FAVICON_LENGTH: 4096,
    MAX_PAGE_ANNOTATIONS: 10000,
    MAX_PAGE_STICKERS: 100,
    MAX_PAGE_STICKER_COORDINATE: 10000000,
    MAX_PAGE_STICKER_Z: 1000000,
    MIN_PAGE_STICKER_WIDTH: 160,
    MAX_PAGE_STICKER_WIDTH: 640,
    MIN_PAGE_STICKER_HEIGHT: 120,
    MAX_PAGE_STICKER_HEIGHT: 560,
  });

  const ALLOWED_GROUP_COLORS = new Set([
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
  ]);

  function composeLegacyWebSource(html, css, javascript) {
    let source = typeof html === 'string' ? html : '';
    const style = typeof css === 'string' && css
      ? `<style>\n${css}\n</style>`
      : '';
    const script = typeof javascript === 'string' && javascript
      ? `<script>\n${javascript}\n</script>`
      : '';
    if (style) {
      const headClose = /<\/head>/i;
      source = headClose.test(source)
        ? source.replace(headClose, `${style}\n</head>`)
        : `${source}${source ? '\n' : ''}${style}`;
    }
    if (script) {
      const bodyClose = /<\/body>/i;
      source = bodyClose.test(source)
        ? source.replace(bodyClose, `${script}\n</body>`)
        : `${source}${source ? '\n' : ''}${script}`;
    }
    return source;
  }

  function validationError(error, detail = '') {
    return { ok: false, error, detail };
  }

  function parseDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    const match = /^data:([^,]*),([\s\S]*)$/i.exec(dataUrl);
    if (!match) return null;
    const metadata = match[1].split(';');
    const mime = String(metadata.shift() || '').trim().toLowerCase();
    const body = match[2];
    const base64Flags = metadata.filter((part) => part.trim().toLowerCase() === 'base64');
    if (
      !/^[a-z][a-z0-9!#$&^_.+\-]*\/[a-z0-9!#$&^_.+\-]+$/i.test(mime) ||
      base64Flags.length > 1 ||
      (base64Flags.length === 1 && metadata[metadata.length - 1].trim().toLowerCase() !== 'base64')
    ) {
      return null;
    }
    const isBase64 = base64Flags.length === 1;
    try {
      if (isBase64) {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body) || body.length % 4 === 1) return null;
        const bin = atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { mime, bytes };
      }
      return { mime, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
    } catch {
      return null;
    }
  }

  function dataUrlToBytes(dataUrl) {
    return parseDataUrl(dataUrl)?.bytes || null;
  }

  function bytesToDataUrl(bytes, mime = 'image/jpeg') {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  function isUuid(value) {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    );
  }

  function isHttpUrl(value, maxLength = LIMITS.MAX_URL_LENGTH) {
    if (typeof value !== 'string' || !value || value.length > maxLength) return false;
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
      return false;
    }
  }

  function isFileUrl(value, maxLength = LIMITS.MAX_URL_LENGTH) {
    if (typeof value !== 'string' || !value || value.length > maxLength) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'file:' && Boolean(url.pathname);
    } catch {
      return false;
    }
  }

  function classifyUrl(value, { allowStoredOnly = false } = {}) {
    if (isHttpUrl(value)) return 'restorable';
    if (allowStoredOnly && isFileUrl(value)) return 'stored_only';
    return 'invalid';
  }

  function isImageDataUrl(value) {
    const parsed = parseDataUrl(value);
    if (!parsed || !/^image\/[a-z0-9.+-]+$/i.test(parsed.mime)) return false;
    return parsed.bytes.length <= LIMITS.MAX_IMAGE_BYTES;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attachmentTokenId(value) {
    const match = /^attachment:\/\/([A-Za-z0-9_-]{1,128})$/.exec(String(value || ''));
    return match ? match[1] : '';
  }

  function renderSafeInlineMarkdown(source, attachments) {
    const text = String(source || '');
    const attachmentMap = attachments instanceof Map
      ? attachments
      : new Map((Array.isArray(attachments) ? attachments : []).map((item) => [String(item?.id || ''), item]));
    const tokenPattern = /!\[([^\]\n]{0,2048})\]\(([^)\s]{1,512})\)|\[([^\]\n]{0,2048})\]\(([^)\s]{1,2048})\)|`([^`\n]{0,2048})`|\*\*([^*\n]{0,2048})\*\*|__([^_\n]{0,2048})__|~~([^~\n]{0,2048})~~|\*([^*\n]{0,2048})\*|_([^_\n]{0,2048})_/g;
    let output = '';
    let cursor = 0;
    let match;
    while ((match = tokenPattern.exec(text))) {
      output += escapeHtml(text.slice(cursor, match.index));
      if (match[1] != null) {
        const id = attachmentTokenId(match[2]);
        const attachment = id ? attachmentMap.get(id) : null;
        if (attachment) {
          output += `<img class="sticker-markdown-image" data-attachment-id="${escapeHtml(id)}" alt="${escapeHtml(match[1])}" />`;
        } else {
          output += escapeHtml(match[0]);
        }
      } else if (match[3] != null) {
        const label = escapeHtml(match[3]);
        const url = match[4];
        if (isHttpUrl(url, LIMITS.MAX_URL_LENGTH)) {
          output += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        } else {
          output += escapeHtml(match[0]);
        }
      } else if (match[5] != null) {
        output += `<code>${escapeHtml(match[5])}</code>`;
      } else if (match[6] != null || match[7] != null) {
        output += `<strong>${escapeHtml(match[6] ?? match[7])}</strong>`;
      } else if (match[8] != null) {
        output += `<del>${escapeHtml(match[8])}</del>`;
      } else if (match[9] != null || match[10] != null) {
        output += `<em>${escapeHtml(match[9] ?? match[10])}</em>`;
      }
      cursor = tokenPattern.lastIndex;
    }
    output += escapeHtml(text.slice(cursor));
    return output;
  }

  /** Render the intentionally small, safe Markdown subset used by notes. */
  function renderSafeMarkdown(markdown, attachments = []) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let inCode = false;
    let codeLines = [];
    let listType = '';
    const closeList = () => {
      if (listType) html.push(`</${listType}>`);
      listType = '';
    };
    const flushCode = () => {
      if (!inCode) return;
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      codeLines = [];
      inCode = false;
    };
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        closeList();
        if (inCode) flushCode();
        else inCode = true;
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) {
        closeList();
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderSafeInlineMarkdown(heading[2], attachments)}</h${level}>`);
        continue;
      }
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) {
        closeList();
        html.push(`<blockquote>${renderSafeInlineMarkdown(quote[1], attachments)}</blockquote>`);
        continue;
      }
      const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (unordered || ordered) {
        const nextType = unordered ? 'ul' : 'ol';
        if (listType !== nextType) {
          closeList();
          listType = nextType;
          html.push(`<${listType}>`);
        }
        html.push(`<li>${renderSafeInlineMarkdown((unordered || ordered)[1], attachments)}</li>`);
        continue;
      }
      closeList();
      html.push(`<p>${renderSafeInlineMarkdown(line, attachments)}</p>`);
    }
    flushCode();
    closeList();
    return html.join('');
  }

  function isSafeZipPath(name) {
    if (
      typeof name !== 'string' ||
      !name ||
      name.length > 512 ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      return false;
    }
    return name === 'backup.json' || name.startsWith('media/');
  }

  function mimeFromPath(path) {
    const ext = String(path || '').toLowerCase().split('.').pop();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'avif') return 'image/avif';
    return 'image/jpeg';
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) {
    const b = new Uint8Array(2);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    return b;
  }

  function u32(n) {
    const b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return b;
  }

  function concatBytes(parts) {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  /** Minimal ZIP (STORE only) — good for already-compressed JPEGs */
  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = concatBytes([
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
        data,
      ]);
      const central = concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }
    const centralDir = concatBytes(centrals);
    const end = concatBytes([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDir.length),
      u32(offset),
      u16(0),
    ]);
    return concatBytes([...locals, centralDir, end]);
  }

  function readU16(v, o) {
    return v[o] | (v[o + 1] << 8);
  }
  function readU32(v, o) {
    return (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0;
  }

  function unzipStore(buf) {
    const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (view.length > LIMITS.MAX_ZIP_BYTES) throw new Error('invalid_zip:too_large');
    const files = Object.create(null);
    const names = new Set();
    const localEntries = [];
    let o = 0;
    while (o + 4 <= view.length && readU32(view, o) === 0x04034b50) {
      if (localEntries.length >= LIMITS.MAX_ZIP_ENTRIES) {
        throw new Error('invalid_zip:too_many_entries');
      }
      if (o + 30 > view.length) throw new Error('invalid_zip:truncated_local_header');
      const sig = readU32(view, o);
      if (sig !== 0x04034b50) throw new Error('invalid_zip:bad_local_signature');
      const flags = readU16(view, o + 6);
      const method = readU16(view, o + 8);
      if (flags !== 0) throw new Error('invalid_zip:unsupported_flags');
      if (method !== 0) throw new Error('invalid_zip:unsupported_method');
      const crc = readU32(view, o + 14);
      const compSize = readU32(view, o + 18);
      const rawSize = readU32(view, o + 22);
      const nameLen = readU16(view, o + 26);
      const extraLen = readU16(view, o + 28);
      if (compSize !== rawSize || compSize > LIMITS.MAX_ENTRY_BYTES) {
        throw new Error('invalid_zip:bad_size');
      }
      const nameStart = o + 30;
      const dataStart = nameStart + nameLen + extraLen;
      if (dataStart > view.length || dataStart + compSize > view.length) {
        throw new Error('invalid_zip:truncated_entry');
      }
      let name;
      try {
        name = new TextDecoder('utf-8', { fatal: true }).decode(
          view.subarray(nameStart, nameStart + nameLen)
        );
      } catch {
        throw new Error('invalid_zip:bad_filename');
      }
      if (!isSafeZipPath(name) || names.has(name)) throw new Error('invalid_zip:bad_filename');
      names.add(name);
      const data = view.subarray(dataStart, dataStart + compSize);
      if (crc32(data) !== crc) throw new Error('invalid_zip:crc');
      files[name] = data.slice();
      localEntries.push({ name, crc, size: compSize, offset: o });
      o = dataStart + compSize;
    }

    if (!localEntries.length) throw new Error('invalid_zip:no_entries');
    const centralStart = o;
    const centralEntries = [];
    while (o + 4 <= view.length && readU32(view, o) === 0x02014b50) {
      if (o + 46 > view.length) throw new Error('invalid_zip:truncated_central_header');
      const flags = readU16(view, o + 8);
      const method = readU16(view, o + 10);
      const crc = readU32(view, o + 16);
      const compSize = readU32(view, o + 20);
      const rawSize = readU32(view, o + 24);
      const nameLen = readU16(view, o + 28);
      const extraLen = readU16(view, o + 30);
      const commentLen = readU16(view, o + 32);
      const localOffset = readU32(view, o + 42);
      const nameStart = o + 46;
      const next = nameStart + nameLen + extraLen + commentLen;
      if (next > view.length || flags !== 0 || method !== 0 || compSize !== rawSize) {
        throw new Error('invalid_zip:bad_central_entry');
      }
      let name;
      try {
        name = new TextDecoder('utf-8', { fatal: true }).decode(
          view.subarray(nameStart, nameStart + nameLen)
        );
      } catch {
        throw new Error('invalid_zip:bad_filename');
      }
      const local = localEntries[centralEntries.length];
      if (!local || local.name !== name || local.offset !== localOffset || local.crc !== crc || local.size !== compSize) {
        throw new Error('invalid_zip:central_mismatch');
      }
      centralEntries.push(name);
      o = next;
    }

    if (o + 22 > view.length || readU32(view, o) !== 0x06054b50) {
      throw new Error('invalid_zip:missing_end');
    }
    const disk = readU16(view, o + 4);
    const centralDisk = readU16(view, o + 6);
    const diskCount = readU16(view, o + 8);
    const totalCount = readU16(view, o + 10);
    const centralSize = readU32(view, o + 12);
    const centralOffset = readU32(view, o + 16);
    const commentLen = readU16(view, o + 20);
    if (
      disk !== 0 ||
      centralDisk !== 0 ||
      diskCount !== localEntries.length ||
      totalCount !== localEntries.length ||
      centralEntries.length !== localEntries.length ||
      centralOffset !== centralStart ||
      centralSize !== o - centralStart ||
      o + 22 + commentLen !== view.length
    ) {
      throw new Error('invalid_zip:bad_directory');
    }
    return files;
  }

  function extFromDataUrl(dataUrl) {
    const mime = parseDataUrl(dataUrl)?.mime || '';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('svg')) return 'svg';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('avif')) return 'avif';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    return 'bin';
  }

  function collectMediaFiles(items) {
    const files = [];
    const mediaMimes = {};
    let totalBytes = 0;
    const clone = (items || []).map((item) => ({
      ...item,
      ...(item?.kind === 'group' || Array.isArray(item?.tabs)
        ? {
            tabs: (item.tabs || []).map((member) => ({ ...member })),
            notes: (item.notes || []).map((note) => ({
              ...note,
              attachments: (note.attachments || []).map((attachment) => ({ ...attachment })),
            })),
          }
        : item?.kind === 'note'
          ? { attachments: (item.attachments || []).map((attachment) => ({ ...attachment })) }
          : {}),
    }));
    const addMedia = (owner, field, path) => {
      const parsed = parseDataUrl(owner[field]);
      if (!parsed || parsed.bytes.length > LIMITS.MAX_IMAGE_BYTES) {
        owner[field] = '';
        return;
      }
      files.push({ name: path, data: parsed.bytes });
      totalBytes += parsed.bytes.length;
      mediaMimes[path] = parsed.mime;
      owner[field] = path;
    };
    for (const item of clone) {
      if (item.kind === 'group') {
        for (const m of item.tabs || []) {
          addMedia(m, 'thumbnail', `media/${item.id}_${m.id}_thumb.${extFromDataUrl(m.thumbnail)}`);
          addMedia(m, 'snapshot', `media/${item.id}_${m.id}_snap.${extFromDataUrl(m.snapshot)}`);
        }
        for (const note of item.notes || []) {
          for (const attachment of note.attachments || []) {
            if (attachment.hasData === true && !attachment.data) {
              throw new Error('invalid_attachment_data');
            }
            const path = `media/${note.id}_${attachment.id}.${extFromDataUrl(attachment.data)}`;
            const parsed = parseDataUrl(attachment.data);
            if (!parsed || parsed.bytes.length > LIMITS.MAX_IMAGE_BYTES) {
              attachment.data = '';
              attachment.hasData = false;
              continue;
            }
            files.push({ name: path, data: parsed.bytes });
            totalBytes += parsed.bytes.length;
            mediaMimes[path] = parsed.mime;
            attachment.data = path;
            attachment.hasData = true;
          }
        }
      } else if (item.kind === 'note') {
        for (const attachment of item.attachments || []) {
          if (attachment.hasData === true && !attachment.data) {
            throw new Error('invalid_attachment_data');
          }
          const path = `media/${item.id}_${attachment.id}.${extFromDataUrl(attachment.data)}`;
          const parsed = parseDataUrl(attachment.data);
          if (!parsed || parsed.bytes.length > LIMITS.MAX_IMAGE_BYTES) {
            attachment.data = '';
            attachment.hasData = false;
            continue;
          }
          files.push({ name: path, data: parsed.bytes });
          totalBytes += parsed.bytes.length;
          mediaMimes[path] = parsed.mime;
          attachment.data = path;
          attachment.hasData = true;
        }
      } else {
        addMedia(item, 'thumbnail', `media/${item.id}_thumb.${extFromDataUrl(item.thumbnail)}`);
        addMedia(item, 'snapshot', `media/${item.id}_snap.${extFromDataUrl(item.snapshot)}`);
      }
    }
    return { items: clone, files, mediaMimes, totalBytes };
  }

  function findMissingMedia(items, settings) {
    const missing = [];
    const add = (scope, itemId, field, extra = {}) => {
      missing.push({ scope, itemId: String(itemId || ''), field, ...extra });
    };
    const checkOwner = (owner, scope, itemId, extra = {}) => {
      if (owner?.hasThumb === true && !owner.thumbnail) add(scope, itemId, 'thumbnail', extra);
      if (owner?.hasSnap === true && !owner.snapshot) add(scope, itemId, 'snapshot', extra);
    };

    for (const item of Array.isArray(items) ? items : []) {
      if (item?.kind === 'group') {
        for (const member of item.tabs || []) {
          checkOwner(member, 'group-member', item.id, { memberId: member.id });
        }
        for (const note of item.notes || []) {
          for (const attachment of note.attachments || []) {
            if (attachment?.hasData === true && !attachment.data) {
              add('note-attachment', item.id, 'attachment', {
                noteId: note.id,
                attachmentId: attachment.id,
              });
            }
          }
        }
      } else if (item?.kind === 'note') {
        for (const attachment of item.attachments || []) {
          if (attachment?.hasData === true && !attachment.data) {
            add('note-attachment', item.id, 'attachment', { attachmentId: attachment.id });
          }
        }
      } else {
        checkOwner(item, 'tab', item?.id);
      }
    }

    if (settings?.wallpaper?.enabled === true) {
      const data = settings.wallpaper.data;
      const parsed = parseDataUrl(data);
      if (!data || !parsed || !isImageDataUrl(data) || parsed.bytes.length > LIMITS.MAX_IMAGE_BYTES) {
        add('wallpaper', 'settings', 'wallpaper');
      }
    }
    return missing;
  }

  function formatMissingMediaDetail(missing, maxEntries = 5) {
    const list = Array.isArray(missing) ? missing : [];
    const describe = (entry) => {
      if (entry.scope === 'note-attachment') {
        const owner = entry.noteId ? ` note=${entry.noteId}` : '';
        return `${entry.scope} item=${entry.itemId}${owner} attachment=${entry.attachmentId}`;
      }
      if (entry.scope === 'group-member') {
        return `${entry.scope} group=${entry.itemId} member=${entry.memberId} field=${entry.field}`;
      }
      return `${entry.scope} item=${entry.itemId} field=${entry.field}`;
    };
    const shown = list.slice(0, Math.max(1, maxEntries)).map(describe).join(', ');
    const suffix = list.length > maxEntries ? `, ... (+${list.length - maxEntries} more)` : '';
    return `missing=${list.length} ${shown}${suffix}`;
  }

  function backupError(code, detail = '', extra = {}) {
    const error = new Error(String(code || 'backup_failed'));
    error.code = String(code || 'backup_failed');
    if (detail) error.detail = String(detail).slice(0, 800);
    Object.assign(error, extra);
    return error;
  }

  function collectWallpaperMedia(settings) {
    if (!settings || typeof settings !== 'object' || !settings.wallpaper || typeof settings.wallpaper !== 'object') {
      return { settings, file: null, mime: '' };
    }
    const wallpaper = { ...settings.wallpaper };
    const parsed = parseDataUrl(wallpaper.data);
    delete wallpaper.data;
    if (!parsed || parsed.bytes.length > LIMITS.MAX_IMAGE_BYTES) {
      return { settings: { ...settings, wallpaper }, file: null, mime: '' };
    }
    const ext = parsed.mime === 'image/png' ? 'png' : 'webp';
    const path = `media/wallpaper.${ext}`;
    wallpaper.data = path;
    return {
      settings: { ...settings, wallpaper },
      file: { name: path, data: parsed.bytes },
      mime: parsed.mime,
    };
  }

  function rehydrateWallpaper(settings, zipFiles, mediaMimes = {}) {
    if (!settings || typeof settings !== 'object' || !settings.wallpaper || typeof settings.wallpaper !== 'object') {
      return settings;
    }
    const value = settings.wallpaper.data;
    if (!value || typeof value !== 'string' || value.startsWith('data:')) return settings;
    const bytes = zipFiles?.[value];
    if (!bytes) {
      const wallpaper = { ...settings.wallpaper };
      delete wallpaper.data;
      return { ...settings, wallpaper };
    }
    return {
      ...settings,
      wallpaper: {
        ...settings.wallpaper,
        data: bytesToDataUrl(bytes, mediaMimes[value] || mimeFromPath(value)),
      },
    };
  }

  function rehydrateMedia(items, zipFiles, mediaMimes = {}) {
    const get = (path) => {
      if (!path || typeof path !== 'string') return '';
      if (path.startsWith('data:')) return path;
      const bytes = zipFiles[path];
      if (!bytes) return '';
      return bytesToDataUrl(bytes, mediaMimes[path] || mimeFromPath(path));
    };
    return items.map((item) => {
      if (item.kind === 'group') {
        return {
          ...item,
          tabs: (item.tabs || []).map((m) => ({
            ...m,
            thumbnail: get(m.thumbnail),
            snapshot: get(m.snapshot),
          })),
          notes: (item.notes || []).map((note) => ({
            ...note,
            attachments: (note.attachments || []).map((attachment) => {
              const data = get(attachment.data);
              return {
                ...attachment,
                data,
                hasData: Boolean(data) || attachment.hasData === true,
              };
            }),
          })),
        };
      }
      if (item.kind === 'note') {
        return {
          ...item,
          attachments: (item.attachments || []).map((attachment) => {
            const data = get(attachment.data);
            return {
              ...attachment,
              data,
              hasData: Boolean(data) || attachment.hasData === true,
            };
          }),
        };
      }
      return {
        ...item,
        thumbnail: get(item.thumbnail),
        snapshot: get(item.snapshot),
      };
    });
  }

  function prepareImportedBackup(backup) {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
      return validationError('invalid_format');
    }
    if (backup.format !== FORMAT) return validationError('invalid_format');
    const version = backup.version == null ? 1 : Number(backup.version);
    if (!Number.isInteger(version) || version < SUPPORTED_MIN_VERSION || version > FORMAT_VERSION) {
      return validationError('unsupported_version');
    }

    const legacy = version < FORMAT_VERSION;
    const warnings = {
      legacyVersion: legacy ? version : 0,
      normalizedGroupColors: 0,
      defaultedFields: 0,
      droppedFavicons: 0,
      storedOnlyUrls: 0,
    };
    const sourceItems = Array.isArray(backup.parkedItems)
      ? backup.parkedItems
      : Array.isArray(backup.parkedTabs)
        ? backup.parkedTabs.map((item) => ({ ...item, kind: 'tab' }))
        : null;
    if (!sourceItems) return validationError('invalid_items');

    const legacyFavicon = (value) => {
      if (!legacy) return value;
      if (value == null) {
        warnings.defaultedFields++;
        return '';
      }
      if (typeof value !== 'string' || !value) {
        if (typeof value !== 'string') warnings.defaultedFields++;
        return '';
      }
      if (value.length > LIMITS.MAX_FAVICON_LENGTH) {
        warnings.droppedFavicons++;
        return '';
      }
      if (isHttpUrl(value, LIMITS.MAX_FAVICON_LENGTH) || isImageDataUrl(value)) return value;
      warnings.droppedFavicons++;
      return '';
    };

    const legacyText = (value, fallback = '') => {
      if (!legacy || value != null) return value;
      warnings.defaultedFields++;
      return fallback;
    };

    const normalizeMember = (raw, index) => {
      const member = raw && typeof raw === 'object' ? { ...raw } : {};
      if (legacy) {
        member.title = legacyText(member.title, member.url || 'Untitled');
        member.favIconUrl = legacyFavicon(member.favIconUrl);
        member.note = legacyText(member.note, '');
        member.tags = Array.isArray(member.tags) ? member.tags : [];
        if (!Array.isArray(raw?.tags)) warnings.defaultedFields++;
        member.indexInGroup = member.indexInGroup == null ? index : member.indexInGroup;
        if (member.indexInGroup === index && raw?.indexInGroup == null) warnings.defaultedFields++;
        if (member.savedAt == null) {
          member.savedAt = Date.now();
          warnings.defaultedFields++;
        }
      }
      return member;
    };

    const normalizeNote = (raw) => {
      const note = raw && typeof raw === 'object' ? { ...raw } : {};
      note.kind = 'note';
      if (note.contentMode == null) {
        note.contentMode = 'markdown';
        warnings.defaultedFields++;
      }
      if (note.webSource == null) {
        note.webSource = composeLegacyWebSource(note.html, note.css, note.javascript);
        warnings.defaultedFields++;
      }
      delete note.html;
      delete note.css;
      delete note.javascript;
      if (backup.media === 'none' && Array.isArray(note.attachments)) {
        note.attachments = note.attachments.map((attachment) => ({
          ...attachment,
          data: '',
          hasData: false,
        }));
      }
      if (legacy) {
        note.title = legacyText(note.title, 'Untitled');
        note.markdown = legacyText(note.markdown, '');
        note.tags = Array.isArray(note.tags) ? note.tags : [];
        note.attachments = Array.isArray(note.attachments) ? note.attachments : [];
        if (note.savedAt == null) {
          note.savedAt = Date.now();
          warnings.defaultedFields++;
        }
      }
      return note;
    };

    const items = sourceItems.map((raw) => {
      const value = raw && typeof raw === 'object' ? { ...raw } : {};
      const isGroup = value.kind === 'group' || Array.isArray(value.tabs);
      if (isGroup) {
        value.kind = 'group';
        if (legacy) {
          value.title = legacyText(value.title, '');
          value.note = legacyText(value.note, '');
          value.tags = Array.isArray(value.tags) ? value.tags : [];
          if (!Array.isArray(raw?.tags)) warnings.defaultedFields++;
          if (value.savedAt == null) {
            value.savedAt = Date.now();
            warnings.defaultedFields++;
          }
          if (value.color == null) {
            value.color = 'grey';
            warnings.defaultedFields++;
          } else if (value.color === 'orange') {
            value.color = 'grey';
            warnings.normalizedGroupColors++;
          }
        }
        value.tabs = Array.isArray(value.tabs)
          ? value.tabs.map((member, index) => normalizeMember(member, index))
          : [];
        value.notes = Array.isArray(value.notes)
          ? value.notes.map((note) => normalizeNote(note))
          : [];
      } else if (value.kind === 'note') {
        return normalizeNote(value);
      } else {
        value.kind = 'tab';
        if (legacy) {
          value.title = legacyText(value.title, value.url || 'Untitled');
          value.favIconUrl = legacyFavicon(value.favIconUrl);
          value.note = legacyText(value.note, '');
          value.tags = Array.isArray(value.tags) ? value.tags : [];
          if (!Array.isArray(raw?.tags)) warnings.defaultedFields++;
          if (value.savedAt == null) {
            value.savedAt = Date.now();
            warnings.defaultedFields++;
          }
        }
      }
      return value;
    });

    const pageAnnotations = Array.isArray(backup.pageAnnotations)
      ? backup.pageAnnotations.map((annotation) => ({
        ...(annotation && typeof annotation === 'object' ? annotation : {}),
        stickers: Array.isArray(annotation?.stickers) ? annotation.stickers : [],
      }))
      : [];

    const countStoredOnly = (item) => {
      const urls = Array.isArray(item.tabs) ? item.tabs.map((member) => member.url) : [item.url];
      for (const url of urls) {
        if (classifyUrl(url, { allowStoredOnly: true }) === 'stored_only') warnings.storedOnlyUrls++;
      }
    };
    items.forEach(countStoredOnly);

    const parkedTabs = items
      .filter((item) => item.kind === 'tab')
      .map(({ kind, ...item }) => item);
    const allowStoredOnlyUrls = legacy || warnings.storedOnlyUrls > 0;
    return {
      ok: true,
      version,
      allowStoredOnlyUrls,
      warnings,
      backup: {
        ...backup,
        parkedItems: items,
        parkedTabs,
        pageAnnotations,
      },
    };
  }

  /**
   * Local wall-clock + offset for filenames (no ':' for Windows).
   * Example: 2026-08-04T13-00-00+0800
   */
  function stamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const offMin = -date.getTimezoneOffset();
    const sign = offMin >= 0 ? '+' : '-';
    const abs = Math.abs(offMin);
    const oh = p(Math.floor(abs / 60));
    const om = p(abs % 60);
    return (
      `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
      `T${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}` +
      `${sign}${oh}${om}`
    );
  }

  function canonicalizeNoteForExport(raw) {
    const note = raw && typeof raw === 'object' ? { ...raw } : {};
    if (note.contentMode == null) note.contentMode = 'markdown';
    if (note.webSource == null) note.webSource = composeLegacyWebSource(note.html, note.css, note.javascript);
    delete note.html;
    delete note.css;
    delete note.javascript;
    return note;
  }

  function withoutLocalOnlyProfiles(settings) {
    if (global.TabWallWebhookCore?.withoutProfiles) {
      const next = global.TabWallWebhookCore.withoutProfiles(settings);
      delete next.ai;
      return next;
    }
    const source = settings && typeof settings === 'object' ? settings : {};
    const next = { ...source };
    delete next.webhookProfiles;
    delete next.ai;
    return next;
  }

  function canonicalizeTabForExport(raw) {
    const tab = raw && typeof raw === 'object' ? { ...raw } : raw;
    if (!tab || typeof tab !== 'object') return tab;
    const favicon = typeof tab.favIconUrl === 'string' ? tab.favIconUrl : '';
    const valid = !favicon || (
      validateString(favicon, LIMITS.MAX_FAVICON_LENGTH) &&
      (isHttpUrl(favicon, LIMITS.MAX_FAVICON_LENGTH) || isImageDataUrl(favicon))
    );
    return valid ? { ...tab, favIconUrl: favicon } : { ...tab, favIconUrl: '' };
  }

  function canonicalizeBackupForExport(backup) {
    const source = backup && typeof backup === 'object' ? backup : {};
    const items = (Array.isArray(source.parkedItems) ? source.parkedItems : []).map((item) => {
      if (item?.kind === 'group') {
        return {
          ...item,
          tabs: (item.tabs || []).map(canonicalizeTabForExport),
          notes: (item.notes || []).map(canonicalizeNoteForExport),
        };
      }
      if (item?.kind === 'note') return canonicalizeNoteForExport(item);
      return item?.kind === 'tab' ? canonicalizeTabForExport(item) : item;
    });
    const settings = source.settings && typeof source.settings === 'object'
      ? withoutLocalOnlyProfiles(source.settings)
      : source.settings;
    return {
      ...source,
      parkedItems: items,
      parkedTabs: items.filter((item) => item?.kind === 'tab').map(({ kind, ...rest }) => rest),
      ...(settings !== undefined ? { settings } : {}),
    };
  }

  function buildLiteBlob(backup, { auto = false, partial = false } = {}) {
    const canonical = canonicalizeBackupForExport(backup);
    const items = (canonical.parkedItems || []).map((item) => {
      const clone = { ...item };
      const stripNote = (note) => ({
        ...note,
        attachments: (note.attachments || []).map((attachment) => ({
          ...attachment,
          data: '',
          hasData: false,
        })),
      });
      if (clone.kind === 'group') {
        clone.tabs = (clone.tabs || []).map((member) => ({
          ...member,
          thumbnail: '',
          snapshot: '',
        }));
        clone.notes = (clone.notes || []).map(stripNote);
      } else if (clone.kind === 'note') {
        clone.attachments = (clone.attachments || []).map((attachment) => ({
          ...attachment,
          data: '',
          hasData: false,
        }));
      } else {
        clone.thumbnail = '';
        clone.snapshot = '';
      }
      return clone;
    });
    const liteBackup = {
      ...canonical,
      parkedItems: items,
      parkedTabs: items.filter((i) => i.kind === 'tab').map(({ kind, ...rest }) => rest),
      media: 'none',
    };
    let prefix = auto ? 'tabwall-auto-lite' : 'tabwall-backup-lite';
    if (partial && !auto) prefix = 'tabwall-backup-lite-partial';
    const filename = `${prefix}-${stamp()}.json`;
    const blob = new Blob([
      JSON.stringify({ ...liteBackup, format: FORMAT, version: FORMAT_VERSION }, null, 2),
    ], { type: 'application/json' });
    return { blob, filename };
  }

  function estimateZipBytes(jsonBytes, files = []) {
    const backupNameBytes = new TextEncoder().encode('backup.json').length;
    const metadataBytes = Number(jsonBytes?.length) || 0;
    const mediaBytes = (files || []).reduce((total, file) => {
      const nameBytes = new TextEncoder().encode(file.name).length;
      return total + (Number(file.data?.length) || 0) + 76 + nameBytes * 2;
    }, 0);
    return metadataBytes + mediaBytes + 30 + 46 + backupNameBytes * 2 + 22;
  }

  function buildFullZipBlob(backup, { auto = false, partial = false } = {}) {
    const canonical = canonicalizeBackupForExport(backup);
    const missing = findMissingMedia(canonical.parkedItems, canonical.settings);
    if (missing.length) {
      throw backupError('missing_media', formatMissingMediaDetail(missing), { phase: 'build', missing });
    }
    const validation = validateBackup({
      ...canonical,
      format: FORMAT,
      version: FORMAT_VERSION,
      media: 'inline',
    }, { allowStoredOnlyUrls: true });
    if (!validation.ok) {
      throw backupError(validation.error, validation.detail || '', { phase: 'validate' });
    }
    const { items, files, mediaMimes } = collectMediaFiles(canonical.parkedItems || []);
    const wall = collectWallpaperMedia(canonical.settings);
    if (wall.file) {
      files.push(wall.file);
      mediaMimes[wall.file.name] = wall.mime;
    }
    const meta = {
      ...canonical,
      format: FORMAT,
      version: FORMAT_VERSION,
      media: 'zip',
      mediaMimes,
      settings: wall.settings || canonical.settings,
      parkedItems: items,
      parkedTabs: items.filter((i) => i.kind === 'tab').map(({ kind, ...r }) => r),
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(meta));
    const estimatedZipBytes = estimateZipBytes(jsonBytes, files);
    if (estimatedZipBytes > LIMITS.MAX_ZIP_BYTES) {
      throw backupError(
        'backup_too_large:full_zip',
        `estimatedBytes=${estimatedZipBytes} limitBytes=${LIMITS.MAX_ZIP_BYTES}`,
        { phase: 'size', estimatedBytes: estimatedZipBytes, limitBytes: LIMITS.MAX_ZIP_BYTES }
      );
    }
    const zip = zipStore([{ name: 'backup.json', data: jsonBytes }, ...files]);
    let prefix = auto ? 'tabwall-auto-full' : 'tabwall-backup-full';
    if (partial && !auto) prefix = 'tabwall-backup-full-partial';
    const filename = `${prefix}-${stamp()}.zip`;
    const blob = new Blob([zip], { type: 'application/zip' });
    return { blob, filename };
  }

  function validateString(value, maxLength, { allowEmpty = true } = {}) {
    return (
      typeof value === 'string' &&
      value.length <= maxLength &&
      (allowEmpty || value.length > 0) &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
    );
  }

  function validateReminder(value) {
    if (value == null) return '';
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid_reminder';
    if (value.mode !== 'once' && value.mode !== 'interval') return 'invalid_reminder_mode';
    if (!validateString(value.message, LIMITS.MAX_NOTE_LENGTH)) return 'invalid_reminder_message';
    if (!Number.isFinite(value.nextAt) || value.nextAt <= 0) return 'invalid_reminder_time';
    if (value.webhookProfileIds != null) {
      if (!Array.isArray(value.webhookProfileIds) || value.webhookProfileIds.length > 20) {
        return 'invalid_reminder_webhooks';
      }
      const ids = new Set();
      for (const id of value.webhookProfileIds) {
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || ids.has(id)) {
          return 'invalid_reminder_webhooks';
        }
        ids.add(id);
      }
    }
    if (value.mode === 'interval') {
      if (!Number.isInteger(value.intervalMinutes) || value.intervalMinutes < 1) {
        return 'invalid_reminder_interval';
      }
    } else if (value.intervalMinutes != null) {
      return 'invalid_reminder_interval';
    }
    return '';
  }

  function validateTitleLockFields(item) {
    if (item.displayTitle != null && !validateString(item.displayTitle, LIMITS.MAX_TITLE_LENGTH)) {
      return 'invalid_display_title';
    }
    if (item.locked != null && typeof item.locked !== 'boolean') return 'invalid_locked';
    if (item.hideOriginalTitle != null && typeof item.hideOriginalTitle !== 'boolean') {
      return 'invalid_hide_original_title';
    }
    if (item.lockSalt != null && item.lockSalt !== '') {
      if (typeof item.lockSalt !== 'string' || !/^[0-9a-f]{32}$/i.test(item.lockSalt)) {
        return 'invalid_lock_salt';
      }
    }
    if (item.lockHash != null && item.lockHash !== '') {
      if (typeof item.lockHash !== 'string' || !/^[0-9a-f]{64}$/i.test(item.lockHash)) {
        return 'invalid_lock_hash';
      }
    }
    return '';
  }

  function validateTags(tags) {
    if (!Array.isArray(tags) || tags.length > LIMITS.MAX_TAGS) return false;
    const seen = new Set();
    for (const tag of tags) {
      if (!validateString(tag, LIMITS.MAX_TAG_LENGTH, { allowEmpty: false }) || seen.has(tag)) {
        return false;
      }
      seen.add(tag);
    }
    return true;
  }

  function validateImageField(value, media, mediaMimes) {
    if (value == null || value === '') return true;
    if (typeof value !== 'string') return false;
    if (value.startsWith('data:')) return isImageDataUrl(value);
    if (media !== 'zip' || !isSafeZipPath(value) || !value.startsWith('media/')) return false;
    const mime = mediaMimes && mediaMimes[value];
    return typeof mime === 'string' && /^image\/[a-z0-9.+-]+$/i.test(mime);
  }

  function validateMediaOwner(owner, media, mediaMimes) {
    return (
      validateImageField(owner.thumbnail, media, mediaMimes) &&
      validateImageField(owner.snapshot, media, mediaMimes)
    );
  }

  function validateAttachmentData(value, media, mediaMimes) {
    if (value == null || value === '') return true;
    if (typeof value !== 'string') return false;
    if (value.startsWith('data:')) return isImageDataUrl(value);
    if (media !== 'zip' || !isSafeZipPath(value) || !value.startsWith('media/')) return false;
    const mime = mediaMimes && mediaMimes[value];
    return typeof mime === 'string' && /^image\/[a-z0-9.+-]+$/i.test(mime);
  }

  function attachmentStoredBytes(attachment, media = 'none') {
    if (!attachment || (attachment.hasData !== true && !attachment.data)) return 0;
    if (typeof attachment.data === 'string' && attachment.data.startsWith('data:')) {
      return parseDataUrl(attachment.data)?.bytes.length || 0;
    }
    const size = Number(attachment.size);
    return Number.isInteger(size) && size > 0 ? size : 0;
  }

  function noteAttachmentBytes(note, media = 'none') {
    return (note?.attachments || []).reduce(
      (total, attachment) => total + attachmentStoredBytes(attachment, media),
      0
    );
  }

  function validateNoteShape(
    note,
    idSet,
    memberSet,
    attachmentIds,
    media,
    mediaMimes,
    allowReminder = false
  ) {
    if (!note || typeof note !== 'object' || note.kind !== 'note' || !isUuid(note.id)
      || idSet.has(note.id) || memberSet.has(note.id)) {
      return 'invalid_note_id';
    }
    idSet.add(note.id);
    memberSet.add(note.id);
    if (!validateString(note.title, LIMITS.MAX_TITLE_LENGTH)) return 'invalid_title';
    const titleLockError = validateTitleLockFields(note);
    if (titleLockError) return titleLockError;
    if (!allowReminder && note.reminder != null) return 'invalid_reminder_scope';
    if (allowReminder) {
      const reminderError = validateReminder(note.reminder);
      if (reminderError) return reminderError;
    }
    if (!validateString(note.markdown, LIMITS.MAX_NOTE_LENGTH)) return 'invalid_markdown';
    const hasContentMode = Object.prototype.hasOwnProperty.call(note, 'contentMode');
    const contentMode = hasContentMode ? note.contentMode : 'markdown';
    if (contentMode !== 'markdown' && contentMode !== 'web') return 'invalid_note_content_mode';
    if (!validateString(note.webSource, LIMITS.MAX_NOTE_WEB_SOURCE_LENGTH)) return 'invalid_note_web_source';
    if (!validateTags(note.tags)) return 'invalid_tags';
    if (note.pinned != null && typeof note.pinned !== 'boolean') return 'invalid_pinned';
    if (!Number.isFinite(note.savedAt) || note.savedAt < 0 || note.savedAt > Date.now() + 86400000) {
      return 'invalid_timestamp';
    }
    if (!Array.isArray(note.attachments) || note.attachments.length > LIMITS.MAX_NOTE_ATTACHMENTS) {
      return 'invalid_attachments';
    }
    const localAttachmentIds = new Set();
    for (const attachment of note.attachments) {
      if (!attachment || typeof attachment !== 'object' || !isUuid(attachment.id)
        || attachmentIds.has(attachment.id) || localAttachmentIds.has(attachment.id)) {
        return 'invalid_attachment_id';
      }
      attachmentIds.add(attachment.id);
      localAttachmentIds.add(attachment.id);
      if (!validateString(attachment.name, LIMITS.MAX_ATTACHMENT_NAME_LENGTH, { allowEmpty: false })) {
        return 'invalid_attachment_name';
      }
      if (!validateString(attachment.alt, LIMITS.MAX_ATTACHMENT_ALT_LENGTH)) {
        return 'invalid_attachment_alt';
      }
      if (typeof attachment.mime !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(attachment.mime)) {
        return 'invalid_attachment_mime';
      }
      if (!Number.isInteger(attachment.size) || attachment.size < 0 || attachment.size > LIMITS.MAX_IMAGE_BYTES) {
        return 'invalid_attachment_size';
      }
      for (const dimension of ['width', 'height']) {
        if (!Number.isInteger(attachment[dimension]) || attachment[dimension] < 0 || attachment[dimension] > 100000) {
          return 'invalid_attachment_dimensions';
        }
      }
      if (attachment.width * attachment.height > LIMITS.MAX_SOURCE_DECODE_PIXELS) {
        return 'invalid_attachment_dimensions';
      }
      if (attachment.hasData != null && typeof attachment.hasData !== 'boolean') {
        return 'invalid_attachment_data';
      }
      if (!validateAttachmentData(attachment.data, media, mediaMimes)) return 'invalid_attachment_data';
    }
    if (noteAttachmentBytes(note, media) > LIMITS.NOTE_ATTACHMENT_QUOTA_BYTES) {
      return 'attachment_quota_exceeded';
    }
    const referenced = new Set();
    const tokenPattern = /!\[[^\]\n]*\]\(attachment:\/\/([A-Za-z0-9_-]{1,128})\)/g;
    let token;
    while ((token = tokenPattern.exec(note.markdown || ''))) referenced.add(token[1]);
    for (const id of referenced) {
      if (!localAttachmentIds.has(id)) return 'invalid_attachment_reference';
    }
    return '';
  }

  function validateTabShape(tab, idSet, memberSet, media, mediaMimes, allowStoredOnlyUrls) {
    if (!tab || typeof tab !== 'object' || !isUuid(tab.id) || idSet.has(tab.id) || memberSet.has(tab.id)) {
      return 'invalid_member_id';
    }
    idSet.add(tab.id);
    memberSet.add(tab.id);
    if (tab.reminder != null) return 'invalid_reminder_scope';
    if (tab.cardSource === 'image') {
      if (tab.url) return 'invalid_url';
    } else if (classifyUrl(tab.url, { allowStoredOnly: allowStoredOnlyUrls }) === 'invalid') {
      return 'invalid_url';
    }
    if (!validateString(tab.title, LIMITS.MAX_TITLE_LENGTH, { allowEmpty: false })) return 'invalid_title';
    const titleLockError = validateTitleLockFields(tab);
    if (titleLockError) return titleLockError;
    if (!validateString(tab.favIconUrl, LIMITS.MAX_FAVICON_LENGTH)) return 'invalid_favicon';
    if (tab.favIconUrl && !isHttpUrl(tab.favIconUrl, LIMITS.MAX_FAVICON_LENGTH) && !isImageDataUrl(tab.favIconUrl)) {
      return 'invalid_favicon';
    }
    if (!validateString(tab.note, LIMITS.MAX_NOTE_LENGTH)) return 'invalid_note';
    if (!validateTags(tab.tags)) return 'invalid_tags';
    if (!Number.isFinite(tab.indexInGroup) || tab.indexInGroup < 0 || tab.indexInGroup > LIMITS.MAX_MEMBERS) {
      return 'invalid_index';
    }
    if (!validateImageField(tab.thumbnail, media, mediaMimes) || !validateImageField(tab.snapshot, media, mediaMimes)) {
      return 'invalid_image';
    }
    return '';
  }

  function validateCanvasLayout(layout, itemIds) {
    if (layout == null) return true;
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false;
    if (layout.version != null && Number(layout.version) !== 1) return false;
    const viewport = layout.viewport;
    if (viewport != null) {
      if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) return false;
      if (!Number.isFinite(Number(viewport.x)) || !Number.isFinite(Number(viewport.y))) return false;
      if (!Number.isFinite(Number(viewport.zoom)) || Number(viewport.zoom) < 0.25 || Number(viewport.zoom) > 2) {
        return false;
      }
    }
    const positions = layout.positions;
    if (positions != null && (typeof positions !== 'object' || Array.isArray(positions))) return false;
    const ids = itemIds instanceof Set ? itemIds : new Set(itemIds || []);
    for (const [id, position] of Object.entries(positions || {})) {
      if (ids.size && !ids.has(id)) continue;
      if (!position || typeof position !== 'object' || Array.isArray(position)) return false;
      for (const key of ['x', 'y', 'w', 'h', 'z']) {
        if (position[key] != null && !Number.isFinite(Number(position[key]))) return false;
      }
      if (position.w != null && (Number(position.w) < 160 || Number(position.w) > 640)) return false;
      if (position.h != null && (Number(position.h) < 120 || Number(position.h) > 560)) return false;
    }
    if (layout.connections != null && !Array.isArray(layout.connections)) return false;
    const seenConnections = new Set();
    for (const connection of layout.connections || []) {
      if (!connection || typeof connection !== 'object' || Array.isArray(connection)) return false;
      const sourceId = connection.sourceId;
      const targetId = connection.targetId;
      if (typeof sourceId !== 'string' || typeof targetId !== 'string' || !sourceId || !targetId) return false;
      if (sourceId === targetId) return false;
      if (ids.size && (!ids.has(sourceId) || !ids.has(targetId))) return false;
      const [source, target] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];
      const key = `${source}\u0000${target}`;
      if (seenConnections.has(key)) return false;
      seenConnections.add(key);
      if (connection.curveOffset != null) {
        const offset = connection.curveOffset;
        if (!offset || typeof offset !== 'object' || Array.isArray(offset)) return false;
        for (const axis of ['x', 'y']) {
          if (offset[axis] != null && (!Number.isFinite(Number(offset[axis]))
            || Number(offset[axis]) < -2000 || Number(offset[axis]) > 2000)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  function validatePageAnnotations(pageAnnotations, topLevelNoteIds) {
    if (pageAnnotations == null) return true;
    if (!Array.isArray(pageAnnotations) || pageAnnotations.length > LIMITS.MAX_PAGE_ANNOTATIONS) return false;
    const noteIds = topLevelNoteIds instanceof Set ? topLevelNoteIds : new Set();
    for (const annotation of pageAnnotations) {
      if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) return false;
      if (!validateString(annotation.id, 128, { allowEmpty: false })) return false;
      if (!validateString(annotation.url, LIMITS.MAX_URL_LENGTH, { allowEmpty: false })) return false;
      if (!validateString(annotation.title || '', LIMITS.MAX_TITLE_LENGTH)) return false;
      if (!validateString(annotation.favIconUrl || '', LIMITS.MAX_FAVICON_LENGTH)) return false;
      if (!validateString(annotation.note || '', LIMITS.MAX_NOTE_LENGTH)) return false;
      if (!validateTags(annotation.tags || [])) return false;
      const stickers = annotation.stickers == null ? [] : annotation.stickers;
      if (!Array.isArray(stickers) || stickers.length > LIMITS.MAX_PAGE_STICKERS) {
        return false;
      }
      const seen = new Set();
      for (const sticker of stickers) {
        if (!sticker || typeof sticker !== 'object' || Array.isArray(sticker)) return false;
        if (!validateString(sticker.noteId, 128, { allowEmpty: false }) || seen.has(sticker.noteId)) return false;
        if (!noteIds.has(sticker.noteId)) return false;
        seen.add(sticker.noteId);
        const x = Number(sticker.x);
        const y = Number(sticker.y);
        const w = Number(sticker.w);
        const h = Number(sticker.h);
        const z = Number(sticker.z);
        if (![x, y, w, h, z].every(Number.isFinite)
          || x < 0 || x > LIMITS.MAX_PAGE_STICKER_COORDINATE
          || y < 0 || y > LIMITS.MAX_PAGE_STICKER_COORDINATE
          || w < LIMITS.MIN_PAGE_STICKER_WIDTH || w > LIMITS.MAX_PAGE_STICKER_WIDTH
          || h < LIMITS.MIN_PAGE_STICKER_HEIGHT || h > LIMITS.MAX_PAGE_STICKER_HEIGHT
          || z < 0 || z > LIMITS.MAX_PAGE_STICKER_Z) return false;
      }
    }
    return true;
  }

  function validateBackup(
    backup,
    { maxJsonBytes = LIMITS.MAX_JSON_BYTES, allowStoredOnlyUrls = false } = {}
  ) {
    try {
      if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return validationError('invalid_format');
      if (backup.format !== FORMAT) return validationError('invalid_format');
      const version = backup.version == null ? 1 : Number(backup.version);
      if (!Number.isInteger(version) || version < SUPPORTED_MIN_VERSION || version > FORMAT_VERSION) {
        return validationError('unsupported_version');
      }
      const allowedMedia = new Set(['none', 'idb', 'inline', 'zip']);
      if (backup.media != null && !allowedMedia.has(backup.media)) return validationError('invalid_media');
      const media = backup.media || 'none';
      const items = Array.isArray(backup.parkedItems)
        ? backup.parkedItems
        : Array.isArray(backup.parkedTabs)
          ? backup.parkedTabs.map((item) => ({ ...item, kind: 'tab' }))
          : null;
      if (!items || items.length > LIMITS.MAX_ITEMS) return validationError('invalid_items');
      if (JSON.stringify(backup).length > maxJsonBytes) return validationError('backup_too_large');

      const ids = new Set();
      const attachmentIds = new Set();
      const mediaMimes = backup.mediaMimes && typeof backup.mediaMimes === 'object' ? backup.mediaMimes : {};
      let memberCount = 0;
      for (const item of items) {
        if (!item || typeof item !== 'object' || !isUuid(item.id) || ids.has(item.id)) {
          return validationError('duplicate_or_invalid_id');
        }
        ids.add(item.id);
        if (item.pinned != null && typeof item.pinned !== 'boolean') {
          return validationError('invalid_pinned', item.id);
        }
        if (!Number.isFinite(item.savedAt) || item.savedAt < 0 || item.savedAt > Date.now() + 86400000) {
          return validationError('invalid_timestamp');
        }
        const isGroup = item.kind === 'group' || Array.isArray(item.tabs);
        if (!isGroup && item.kind === 'note') {
          // The common item-id check above reserves the id for tab/group items;
          // note validation owns the same global set so nested note ids cannot collide.
          ids.delete(item.id);
          const error = validateNoteShape(
            item,
            ids,
            new Set(),
            attachmentIds,
            media,
            mediaMimes,
            true
          );
          if (error) return validationError(error, item.id);
          continue;
        }
        if (!validateString(item.note, LIMITS.MAX_NOTE_LENGTH)) return validationError('invalid_note');
        if (!validateTags(item.tags)) return validationError('invalid_tags');
        if (!validateString(item.title, LIMITS.MAX_TITLE_LENGTH)) return validationError('invalid_title');
        const reminderError = validateReminder(item.reminder);
        if (reminderError) return validationError(reminderError, item.id);
        const titleLockError = validateTitleLockFields(item);
        if (titleLockError) return validationError(titleLockError, item.id);
        if (!validateImageField(item.thumbnail, media, mediaMimes) || !validateImageField(item.snapshot, media, mediaMimes)) {
          return validationError('invalid_image');
        }
        if (!isGroup) {
          if (item.kind !== 'tab') return validationError('invalid_url', item.id);
          if (item.cardSource === 'image') {
            if (item.url) return validationError('invalid_url', item.id);
          } else if (classifyUrl(item.url, { allowStoredOnly: allowStoredOnlyUrls }) === 'invalid') {
            return validationError('invalid_url', item.id);
          }
          if (!validateString(item.favIconUrl, LIMITS.MAX_FAVICON_LENGTH)) return validationError('invalid_favicon');
          if (item.favIconUrl && !isHttpUrl(item.favIconUrl, LIMITS.MAX_FAVICON_LENGTH) && !isImageDataUrl(item.favIconUrl)) {
            return validationError('invalid_favicon');
          }
          continue;
        }
        if (item.kind !== 'group' || !Array.isArray(item.tabs) || item.tabs.length > LIMITS.MAX_MEMBERS) {
          return validationError('invalid_group');
        }
        if (!ALLOWED_GROUP_COLORS.has(item.color)) {
          return validationError('invalid_group_color', item.id);
        }
        const memberIds = new Set();
        for (const member of item.tabs) {
          memberCount++;
          if (memberCount > LIMITS.MAX_MEMBERS) return validationError('too_many_members');
          const error = validateTabShape(
            member,
            ids,
            memberIds,
            media,
            mediaMimes,
            allowStoredOnlyUrls
          );
          if (error) return validationError(error, member.id);
        }
        if (item.notes != null && !Array.isArray(item.notes)) return validationError('invalid_notes', item.id);
        for (const note of item.notes || []) {
          memberCount++;
          if (memberCount > LIMITS.MAX_MEMBERS) return validationError('too_many_members');
          const error = validateNoteShape(
            note,
            ids,
            memberIds,
            attachmentIds,
            media,
            mediaMimes
          );
          if (error) return validationError(error, note?.id || item.id);
        }
      }

      const totalAttachmentBytes = items.reduce((total, item) => {
        if (item.kind === 'group') {
          return total + (item.notes || []).reduce(
            (groupTotal, note) => groupTotal + noteAttachmentBytes(note, media),
            0
          );
        }
        return total + (item.kind === 'note' ? noteAttachmentBytes(item, media) : 0);
      }, 0);
      if (totalAttachmentBytes > LIMITS.TOTAL_ATTACHMENT_QUOTA_BYTES) {
        return validationError('attachment_quota_exceeded', String(totalAttachmentBytes));
      }

      if (!validateCanvasLayout(backup.canvasLayout, ids)) {
        return validationError('invalid_canvas_layout');
      }

      const topLevelNoteIds = new Set(items.filter((item) => item.kind === 'note').map((item) => item.id));
      if (!validatePageAnnotations(backup.pageAnnotations, topLevelNoteIds)) {
        return validationError('invalid_page_annotations');
      }

      if (backup.tagCatalog != null) {
        if (!Array.isArray(backup.tagCatalog) || backup.tagCatalog.length > LIMITS.MAX_TAG_CATALOG) {
          return validationError('invalid_tag_catalog');
        }
        const catalog = new Set();
        for (const tag of backup.tagCatalog) {
          if (!validateString(tag, LIMITS.MAX_TAG_LENGTH, { allowEmpty: false }) || catalog.has(tag)) {
            return validationError('invalid_tag_catalog');
          }
          catalog.add(tag);
        }
      }
      if (backup.settings != null && (typeof backup.settings !== 'object' || Array.isArray(backup.settings))) {
        return validationError('invalid_settings');
      }
      return { ok: true, version, itemCount: items.length, memberCount };
    } catch (err) {
      return validationError('invalid_backup', String(err?.message || err));
    }
  }

  global.TabWallBackupBuild = {
    FORMAT,
    FORMAT_VERSION,
    LIMITS,
    composeLegacyWebSource,
    dataUrlToBytes,
    bytesToDataUrl,
    isHttpUrl,
    isFileUrl,
    classifyUrl,
    renderSafeMarkdown,
    isImageDataUrl,
    attachmentStoredBytes,
    noteAttachmentBytes,
    zipStore,
    unzipStore,
    collectMediaFiles,
    collectWallpaperMedia,
    rehydrateMedia,
    rehydrateWallpaper,
    prepareImportedBackup,
    validateBackup,
    validatePageAnnotations,
    stamp,
    buildLiteBlob,
    estimateZipBytes,
    findMissingMedia,
    formatMissingMediaDetail,
    buildFullZipBlob,
  };
})(typeof self !== 'undefined' ? self : this);
