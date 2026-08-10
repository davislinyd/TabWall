/**
 * TabWall media store (IndexedDB)
 * Shared by service worker (importScripts) and park.html
 */
(function (global) {
  const DB_NAME = 'tabwall-media';
  const DB_VERSION = 2;
  const STORE = 'media';
  const IMPORT_STORE = 'imports';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error('IDB open failed'));
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(IMPORT_STORE)) {
          db.createObjectStore(IMPORT_STORE, { keyPath: 'key' });
        }
      };
    });
    return dbPromise;
  }

  function mediaKeyTab(itemId) {
    return `t:${itemId}`;
  }

  function mediaKeyMember(groupId, memberId) {
    return `g:${groupId}:${memberId}`;
  }

  function mediaKeyNoteAttachment(noteId, attachmentId) {
    return `n:${noteId}:${attachmentId}`;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IDB aborted'));
    });
  }

  async function put(key, { thumb = null, snap = null } = {}) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({
      key,
      thumb: thumb || null,
      snap: snap || null,
      updatedAt: Date.now(),
    });
    await txDone(tx);
  }

  async function get(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result;
        resolve(row
          ? { thumb: row.thumb || null, snap: row.snap || null, updatedAt: row.updatedAt || 0 }
          : { thumb: null, snap: null, updatedAt: 0 });
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getPart(key, part) {
    const row = await get(key);
    return part === 'snap' ? row.snap : row.thumb;
  }

  async function remove(key) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    await txDone(tx);
  }

  async function removeMany(keys) {
    if (!keys || !keys.length) return;
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const key of keys) store.delete(key);
    await txDone(tx);
  }

  async function listKeys() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result || []).map(String));
      req.onerror = () => reject(req.error || new Error('IDB list keys failed'));
    });
  }

  async function removeOrphans(keepKeys) {
    const keep = new Set((keepKeys || []).map(String));
    const keys = await listKeys();
    const stale = keys.filter((key) => !keep.has(key));
    await removeMany(stale);
    return stale;
  }

  function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const mimeMatch = /data:([^;]+)/.exec(header);
    const mime = (mimeMatch && mimeMatch[1]) || 'image/jpeg';
    const isBase64 = /;base64/i.test(header);
    const body = dataUrl.slice(comma + 1);
    try {
      if (isBase64) {
        const bin = atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
      }
      return new Blob([decodeURIComponent(body)], { type: mime });
    } catch {
      return null;
    }
  }

  function blobToDataUrl(blob) {
    if (!blob) return Promise.resolve('');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function putFromDataUrls(key, thumbDataUrl, snapDataUrl) {
    const thumb = dataUrlToBlob(thumbDataUrl);
    const snap = dataUrlToBlob(snapDataUrl);
    if (!thumb && !snap) {
      await remove(key);
      return { hasThumb: false, hasSnap: false };
    }
    await put(key, { thumb, snap });
    return { hasThumb: Boolean(thumb), hasSnap: Boolean(snap) };
  }

  async function putFromBlobs(key, thumbBlob, snapBlob) {
    if (!thumbBlob && !snapBlob) {
      await remove(key);
      return { hasThumb: false, hasSnap: false };
    }
    await put(key, { thumb: thumbBlob || null, snap: snapBlob || null });
    return { hasThumb: Boolean(thumbBlob), hasSnap: Boolean(snapBlob) };
  }

  async function putAttachment(key, blob) {
    if (!key || !blob) {
      if (key) await remove(key);
      return false;
    }
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      key: String(key),
      attachment: blob,
      updatedAt: Date.now(),
    });
    await txDone(tx);
    return true;
  }

  async function getAttachment(key) {
    if (!key) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(String(key));
      req.onsuccess = () => resolve(req.result?.attachment || null);
      req.onerror = () => reject(req.error || new Error('IDB attachment read failed'));
    });
  }

  function stageKey(stageId, mediaKey) {
    return `${String(stageId)}|${String(mediaKey)}`;
  }

  function stageRange(stageId) {
    const prefix = `${String(stageId)}|`;
    return typeof IDBKeyRange === 'undefined'
      ? null
      : IDBKeyRange.bound(prefix, `${prefix}\uffff`);
  }

  /** Store imported blobs outside the runtime message channel. */
  async function putImportStage(stageId, rows) {
    if (!stageId || !Array.isArray(rows)) throw new Error('invalid_import_stage');
    const db = await openDb();
    const tx = db.transaction(IMPORT_STORE, 'readwrite');
    const store = tx.objectStore(IMPORT_STORE);
    for (const row of rows) {
      if (!row?.mediaKey) continue;
      const key = stageKey(stageId, row.mediaKey);
      if (row.thumb || row.snap || row.attachment) {
        store.put({
          key,
          stageId: String(stageId),
          mediaKey: String(row.mediaKey),
          thumb: row.thumb || null,
          snap: row.snap || null,
          attachment: row.attachment || null,
          updatedAt: Date.now(),
        });
      } else {
        store.delete(key);
      }
    }
    await txDone(tx);
  }

  async function getImportStage(stageId) {
    if (!stageId) return new Map();
    const db = await openDb();
    const range = stageRange(stageId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMPORT_STORE, 'readonly');
      const request = range
        ? tx.objectStore(IMPORT_STORE).getAll(range)
        : tx.objectStore(IMPORT_STORE).getAll();
      request.onsuccess = () => {
        const result = new Map();
        for (const row of request.result || []) {
          if (row.stageId !== String(stageId) || !row.mediaKey) continue;
          result.set(String(row.mediaKey), {
            thumb: row.thumb || null,
            snap: row.snap || null,
            attachment: row.attachment || null,
          });
        }
        resolve(result);
      };
      request.onerror = () => reject(request.error || new Error('IDB import stage read failed'));
    });
  }

  async function removeImportStage(stageId) {
    if (!stageId) return;
    const db = await openDb();
    const range = stageRange(stageId);
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(IMPORT_STORE, 'readonly');
      const request = range
        ? tx.objectStore(IMPORT_STORE).getAllKeys(range)
        : tx.objectStore(IMPORT_STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('IDB import stage keys failed'));
    });
    if (!keys.length) return;
    const tx = db.transaction(IMPORT_STORE, 'readwrite');
    const store = tx.objectStore(IMPORT_STORE);
    for (const key of keys) store.delete(key);
    await txDone(tx);
  }

  async function removeExpiredImportStages(maxAgeMs = 24 * 60 * 60 * 1000) {
    const db = await openDb();
    const cutoff = Date.now() - Math.max(60 * 1000, Number(maxAgeMs) || 0);
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(IMPORT_STORE, 'readonly');
      const request = tx.objectStore(IMPORT_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('IDB import stage cleanup failed'));
    });
    const stale = new Set(
      rows
        .filter((row) => row?.stageId && Number(row.updatedAt) < cutoff)
        .map((row) => String(row.stageId))
    );
    for (const stageId of stale) await removeImportStage(stageId);
    return stale.size;
  }

  /** Collect all keys for a parked item (tab, note or group). */
  function keysForItem(item) {
    if (!item) return [];
    if (item.kind === 'group') {
      return [
        ...(item.tabs || []).map((m) => mediaKeyMember(item.id, m.id)),
        ...(item.notes || []).flatMap((note) => (
          note.attachments || []
        ).map((attachment) => mediaKeyNoteAttachment(note.id, attachment.id))),
      ];
    }
    if (item.kind === 'note') {
      return (item.attachments || []).map((attachment) => (
        mediaKeyNoteAttachment(item.id, attachment.id)
      ));
    }
    return [mediaKeyTab(item.id)];
  }

  global.TabWallMediaDB = {
    openDb,
    mediaKeyTab,
    mediaKeyMember,
    mediaKeyNoteAttachment,
    put,
    get,
    getPart,
    remove,
    removeMany,
    listKeys,
    removeOrphans,
    dataUrlToBlob,
    blobToDataUrl,
    putFromDataUrls,
    putFromBlobs,
    putAttachment,
    getAttachment,
    putImportStage,
    getImportStage,
    removeImportStage,
    removeExpiredImportStages,
    keysForItem,
  };
})(typeof self !== 'undefined' ? self : globalThis);
