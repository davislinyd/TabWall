/**
 * TabWall — backup payload → lite JSON / full ZIP (shared by park + offscreen)
 */
(function (global) {
  const FORMAT = 'tabwall-backup';
  const FORMAT_VERSION = 4;
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
    MAX_TAG_LENGTH: 128,
    MAX_FAVICON_LENGTH: 4096,
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
    const clone = (items || []).map((item) => ({
      ...item,
      ...(item?.kind === 'group' || Array.isArray(item?.tabs)
        ? { tabs: (item.tabs || []).map((member) => ({ ...member })) }
        : {}),
    }));
    const addMedia = (owner, field, path) => {
      const parsed = parseDataUrl(owner[field]);
      if (!parsed || parsed.bytes.length > LIMITS.MAX_IMAGE_BYTES) {
        owner[field] = '';
        return;
      }
      files.push({ name: path, data: parsed.bytes });
      mediaMimes[path] = parsed.mime;
      owner[field] = path;
    };
    for (const item of clone) {
      if (item.kind === 'group') {
        for (const m of item.tabs || []) {
          addMedia(m, 'thumbnail', `media/${item.id}_${m.id}_thumb.${extFromDataUrl(m.thumbnail)}`);
          addMedia(m, 'snapshot', `media/${item.id}_${m.id}_snap.${extFromDataUrl(m.snapshot)}`);
        }
      } else {
        addMedia(item, 'thumbnail', `media/${item.id}_thumb.${extFromDataUrl(item.thumbnail)}`);
        addMedia(item, 'snapshot', `media/${item.id}_snap.${extFromDataUrl(item.snapshot)}`);
      }
    }
    return { items: clone, files, mediaMimes };
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
    return {
      ok: true,
      version,
      allowStoredOnlyUrls: legacy,
      warnings,
      backup: {
        ...backup,
        parkedItems: items,
        parkedTabs,
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

  function buildLiteBlob(backup, { auto = false, partial = false } = {}) {
    let prefix = auto ? 'tabwall-auto-lite' : 'tabwall-backup-lite';
    if (partial && !auto) prefix = 'tabwall-backup-lite-partial';
    const filename = `${prefix}-${stamp()}.json`;
    const blob = new Blob([
      JSON.stringify({ ...backup, format: FORMAT, version: FORMAT_VERSION }, null, 2),
    ], { type: 'application/json' });
    return { blob, filename };
  }

  function buildFullZipBlob(backup, { auto = false, partial = false } = {}) {
    const { items, files, mediaMimes } = collectMediaFiles(backup.parkedItems || []);
    const meta = {
      ...backup,
      format: FORMAT,
      version: FORMAT_VERSION,
      media: 'zip',
      mediaMimes,
      parkedItems: items,
      parkedTabs: items.filter((i) => i.kind === 'tab').map(({ kind, ...r }) => r),
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(meta));
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

  function validateTabShape(tab, idSet, memberSet, media, mediaMimes, allowStoredOnlyUrls) {
    if (!tab || typeof tab !== 'object' || !isUuid(tab.id) || idSet.has(tab.id) || memberSet.has(tab.id)) {
      return 'invalid_member_id';
    }
    idSet.add(tab.id);
    memberSet.add(tab.id);
    if (classifyUrl(tab.url, { allowStoredOnly: allowStoredOnlyUrls }) === 'invalid') {
      return 'invalid_url';
    }
    if (!validateString(tab.title, LIMITS.MAX_TITLE_LENGTH, { allowEmpty: false })) return 'invalid_title';
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
        if (!validateString(item.note, LIMITS.MAX_NOTE_LENGTH)) return validationError('invalid_note');
        if (!validateTags(item.tags)) return validationError('invalid_tags');
        if (!validateString(item.title, LIMITS.MAX_TITLE_LENGTH)) return validationError('invalid_title');
        if (!validateImageField(item.thumbnail, media, mediaMimes) || !validateImageField(item.snapshot, media, mediaMimes)) {
          return validationError('invalid_image');
        }
        const isGroup = item.kind === 'group' || Array.isArray(item.tabs);
        if (!isGroup) {
          if (
            item.kind !== 'tab' ||
            classifyUrl(item.url, { allowStoredOnly: allowStoredOnlyUrls }) === 'invalid'
          ) {
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
      }

      if (!validateCanvasLayout(backup.canvasLayout, ids)) {
        return validationError('invalid_canvas_layout');
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
    dataUrlToBytes,
    bytesToDataUrl,
    isHttpUrl,
    isFileUrl,
    classifyUrl,
    zipStore,
    unzipStore,
    collectMediaFiles,
    rehydrateMedia,
    prepareImportedBackup,
    validateBackup,
    stamp,
    buildLiteBlob,
    buildFullZipBlob,
  };
})(typeof self !== 'undefined' ? self : this);
