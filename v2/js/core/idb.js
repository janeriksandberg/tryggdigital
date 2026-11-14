// Liten Promise-innpakning rundt IndexedDB. All v2-data ligger i databasen «td2» (v1 bruker localStorage-nøkkelen
// «tryggdigital.v1», så de to versjonene deler aldri lagring).
const DB_NAME = 'td2';
const DB_VERSION = 1;
let dbp = null;

export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('docs')) {
        const s = db.createObjectStore('docs', { keyPath: 'k' });
        s.createIndex('t', 't');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const s = db.createObjectStore('outbox', { keyPath: 'k' });
        s.createIndex('t', 't');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blokkert'));
  });
  return dbp;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function kvGet(key, fallback = undefined) {
  const db = await openDb();
  const v = await wrap(db.transaction('kv').objectStore('kv').get(key));
  return v === undefined ? fallback : v;
}
export async function kvSet(key, value) {
  const db = await openDb();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return done(tx);
}
export async function kvDel(key) {
  const db = await openDb();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').delete(key);
  return done(tx);
}
export async function kvKeys(prefix = '') {
  const db = await openDb();
  const keys = await wrap(db.transaction('kv').objectStore('kv').getAllKeys());
  return keys.filter((k) => String(k).startsWith(prefix));
}

export async function allByTenant(store, t) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).index('t').getAll(t));
}
export async function getRow(store, k) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(k));
}

/** Skriver/sletter flere rader i én transaksjon. ops: [{store, put?: row, del?: key}] */
export async function writeRows(ops) {
  if (!ops.length) return;
  const db = await openDb();
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const s = tx.objectStore(o.store);
    if (o.put) s.put(o.put); else if (o.del !== undefined) s.delete(o.del);
  }
  return done(tx);
}

export async function clearTenant(t) {
  const db = await openDb();
  const tx = db.transaction(['docs', 'outbox', 'kv'], 'readwrite');
  for (const store of ['docs', 'outbox']) {
    const idx = tx.objectStore(store).index('t');
    idx.openKeyCursor(IDBKeyRange.only(t)).onsuccess = (e) => {
      const c = e.target.result;
      if (c) { tx.objectStore(store).delete(c.primaryKey); c.continue(); }
    };
  }
  const kv = tx.objectStore('kv');
  kv.getAllKeys().onsuccess = (e) => { for (const k of e.target.result) if (String(k).includes(`|${t}|`) || String(k).endsWith(`|${t}`)) kv.delete(k); };
  return done(tx);
}

export async function wipeAll() {
  const db = await openDb();
  const tx = db.transaction(['docs', 'outbox', 'kv'], 'readwrite');
  for (const s of ['docs', 'outbox', 'kv']) tx.objectStore(s).clear();
  return done(tx);
}
