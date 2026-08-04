/**
 * TabWall media store (IndexedDB)
 * Shared by service worker (importScripts) and park.html
 */
(function (global) {
  const DB_NAME = 'tabwall-media';
  const DB_VERSION = 1;
  const STORE = 'media';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error('IDB open failed'));
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
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
        resolve(row ? { thumb: row.thumb || null, snap: row.snap || null } : { thumb: null, snap: null });
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

  /** Collect all keys for a parked item (tab or group) */
  function keysForItem(item) {
    if (!item) return [];
    if (item.kind === 'group') {
      return (item.tabs || []).map((m) => mediaKeyMember(item.id, m.id));
    }
    return [mediaKeyTab(item.id)];
  }

  global.TabWallMediaDB = {
    openDb,
    mediaKeyTab,
    mediaKeyMember,
    put,
    get,
    getPart,
    remove,
    removeMany,
    dataUrlToBlob,
    blobToDataUrl,
    putFromDataUrls,
    putFromBlobs,
    keysForItem,
  };
})(typeof self !== 'undefined' ? self : globalThis);
