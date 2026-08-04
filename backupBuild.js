/**
 * TabWall — backup payload → lite JSON / full ZIP (shared by park + offscreen)
 */
(function (global) {
  function dataUrlToBytes(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return null;
    }
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const b64 = dataUrl.slice(comma + 1);
    try {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }

  function bytesToDataUrl(bytes, mime = 'image/jpeg') {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
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
    const files = {};
    let o = 0;
    while (o + 30 <= view.length) {
      const sig = readU32(view, o);
      if (sig !== 0x04034b50) break;
      const method = readU16(view, o + 8);
      const compSize = readU32(view, o + 18);
      const nameLen = readU16(view, o + 26);
      const extraLen = readU16(view, o + 28);
      const name = new TextDecoder().decode(view.subarray(o + 30, o + 30 + nameLen));
      const dataStart = o + 30 + nameLen + extraLen;
      const data = view.subarray(dataStart, dataStart + compSize);
      if (method === 0) files[name] = data.slice();
      o = dataStart + compSize;
    }
    return files;
  }

  function collectMediaFiles(items) {
    const files = [];
    const clone = JSON.parse(JSON.stringify(items));
    for (const item of clone) {
      if (item.kind === 'group') {
        for (const m of item.tabs || []) {
          const tBytes = dataUrlToBytes(m.thumbnail);
          const sBytes = dataUrlToBytes(m.snapshot);
          if (tBytes) {
            const path = `media/${item.id}_${m.id}_thumb.jpg`;
            files.push({ name: path, data: tBytes });
            m.thumbnail = path;
          } else m.thumbnail = '';
          if (sBytes) {
            const path = `media/${item.id}_${m.id}_snap.jpg`;
            files.push({ name: path, data: sBytes });
            m.snapshot = path;
          } else m.snapshot = '';
        }
      } else {
        const tBytes = dataUrlToBytes(item.thumbnail);
        const sBytes = dataUrlToBytes(item.snapshot);
        if (tBytes) {
          const path = `media/${item.id}_thumb.jpg`;
          files.push({ name: path, data: tBytes });
          item.thumbnail = path;
        } else item.thumbnail = '';
        if (sBytes) {
          const path = `media/${item.id}_snap.jpg`;
          files.push({ name: path, data: sBytes });
          item.snapshot = path;
        } else item.snapshot = '';
      }
    }
    return { items: clone, files };
  }

  function rehydrateMedia(items, zipFiles) {
    const get = (path) => {
      if (!path || typeof path !== 'string') return '';
      if (path.startsWith('data:')) return path;
      const bytes = zipFiles[path];
      if (!bytes) return '';
      return bytesToDataUrl(bytes);
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

  function stamp(date = new Date()) {
    return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  }

  function buildLiteBlob(backup, { auto = false } = {}) {
    const prefix = auto ? 'tabwall-auto-lite' : 'tabwall-backup-lite';
    const filename = `${prefix}-${stamp()}.json`;
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    return { blob, filename };
  }

  function buildFullZipBlob(backup, { auto = false } = {}) {
    const { items, files } = collectMediaFiles(backup.parkedItems || []);
    const meta = {
      ...backup,
      version: 3,
      media: 'zip',
      parkedItems: items,
      parkedTabs: items.filter((i) => i.kind === 'tab').map(({ kind, ...r }) => r),
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(meta));
    const zip = zipStore([{ name: 'backup.json', data: jsonBytes }, ...files]);
    const prefix = auto ? 'tabwall-auto-full' : 'tabwall-backup-full';
    const filename = `${prefix}-${stamp()}.zip`;
    const blob = new Blob([zip], { type: 'application/zip' });
    return { blob, filename };
  }

  global.TabWallBackupBuild = {
    dataUrlToBytes,
    bytesToDataUrl,
    zipStore,
    unzipStore,
    collectMediaFiles,
    rehydrateMedia,
    stamp,
    buildLiteBlob,
    buildFullZipBlob,
  };
})(typeof self !== 'undefined' ? self : this);
