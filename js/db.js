// IndexedDB: alle Daten bleiben im Browser auf diesem Gerät.

const DB_NAME = 'budget-db';
const DB_VERSION = 1;
export const STORES = ['settings', 'categories', 'plan', 'txs', 'invoices', 'rules', 'receipts'];
const KEYS = { settings: 'key', rules: 'key' };

let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: KEYS[s] || 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank blockiert. Bitte andere Tabs mit der App schliessen.'));
  });
  return dbp;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Abgebrochen'));
  });
}

export async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}

export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

export async function delMany(store, keys) {
  if (!keys.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  return done(tx);
}

// Mehrere Stores in einer Transaktion ändern (alles oder nichts)
export async function batch(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  if (!stores.length) return;
  const db = await openDB();
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const os = tx.objectStore(o.store);
    if (o.type === 'put') os.put(o.value);
    else if (o.type === 'del') os.delete(o.key);
    else if (o.type === 'clear') os.clear();
  }
  return done(tx);
}

export async function clearAll() {
  return batch(STORES.map((s) => ({ store: s, type: 'clear' })));
}

// Einstellungen als Schlüssel/Wert
export async function loadSettings() {
  const rows = await getAll('settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function saveSetting(key, value) {
  return put('settings', { key, value });
}
