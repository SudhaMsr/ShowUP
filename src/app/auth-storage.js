// @ts-check
/**
 * IndexedDB persistence for the device account and the optional "keep me signed
 * in" session. The session holds a non-extractable CryptoKey: structured clone
 * lets the browser store the key object itself without ever exposing its bytes.
 */

export const AUTH_DB = 'showup-auth';

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUTH_DB, 1);
    req.onupgradeneeded = () => {
      for (const name of ['profile', 'session']) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @template T
 * @param {string} store @param {IDBTransactionMode} mode
 * @param {(os: IDBObjectStore) => IDBRequest<T> | void} fn
 * @returns {Promise<T | undefined>}
 */
async function run(store, mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** @returns {import('./auth.js').AuthStorage} */
export function idbAuthStorage() {
  return {
    getProfile: async () => /** @type {any} */ ((await run('profile', 'readonly', (os) => os.get('main'))) ?? null),
    putProfile: async (p) => void (await run('profile', 'readwrite', (os) => os.put(p, 'main'))),
    getSession: async () => /** @type {any} */ ((await run('session', 'readonly', (os) => os.get('main'))) ?? null),
    putSession: async (s) => void (await run('session', 'readwrite', (os) => os.put(s, 'main'))),
    clearSession: async () => void (await run('session', 'readwrite', (os) => os.clear())),
    clearAll: async () => {
      await run('session', 'readwrite', (os) => os.clear());
      await run('profile', 'readwrite', (os) => os.clear());
    },
  };
}

/** True when the browser can run the sign-in (IndexedDB + Web Crypto). */
export function authSupported() {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

/**
 * Delete every ShowUp database. Used by "forgot password" and "delete account".
 * @param {string[]} names
 */
export function deleteDatabases(names) {
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
        }),
    ),
  );
}
