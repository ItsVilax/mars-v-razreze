/*
 * Small IndexedDB cache for the derived 4/8 px/° grids.
 *
 * The source files stay untouched in prompt/; this cache only avoids decoding
 * the 33 MB MOLA16 image and re-parsing the 5.5 MB MOLA4 CSV on every run.
 * Everything is versioned and failure-safe: if IndexedDB is unavailable or
 * the files changed, the caller simply falls back to the normal path.
 */

const DB_NAME = 'mars-atlas-cache';
const DB_VERSION = 1;
const STORE = 'derived';
const RECORD_KEY = 'current';
const GRID_VERSION = 1;

function openDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function requestValue(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function headSignature(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return '';
    return `${res.headers.get('content-length') || ''}:${res.headers.get('last-modified') || ''}`;
  } catch {
    return '';
  }
}

export async function dataSignature() {
  const [img, csv] = await Promise.all([
    headSignature('prompt/megt90n000eb.img'),
    headSignature('prompt/mola4_topography_m.csv'),
  ]);
  if (!img || !csv) return '';
  return `${GRID_VERSION}|${img}|${csv}`;
}

function isUsable(record, signature) {
  if (!record || record.version !== GRID_VERSION || record.signature !== signature) return false;
  return (
    record.globe4 instanceof Float32Array && record.globe4.length === 720 * 1440 &&
    record.globe8 instanceof Int16Array && record.globe8.length === 1440 * 2880 &&
    record.mola4 instanceof Int16Array && record.mola4.length === 720 * 1440 &&
    Number.isFinite(record.meta16?.min) && Number.isFinite(record.meta16?.max) &&
    Number.isFinite(record.meta4?.min) && Number.isFinite(record.meta4?.max)
  );
}

export async function readCachedGrids(signature) {
  if (!signature) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    const record = await requestValue(db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD_KEY));
    return isUsable(record, signature) ? record : null;
  } catch {
    return null;
  } finally {
    db.close?.();
  }
}

export async function writeCachedGrids(signature, payload) {
  if (!signature) return false;
  const db = await openDb();
  if (!db) return false;
  try {
    const record = {
      version: GRID_VERSION,
      signature,
      savedAt: Date.now(),
      globe4: payload.globe4,
      globe8: payload.globe8,
      mola4: payload.mola4,
      meta16: payload.meta16,
      meta4: payload.meta4,
    };
    await requestValue(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, RECORD_KEY));
    return true;
  } catch {
    return false;
  } finally {
    db.close?.();
  }
}
