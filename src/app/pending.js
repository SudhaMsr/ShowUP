// @ts-check
/**
 * Outcome taps made on a system notification while the app was closed.
 *
 * The service worker cannot (and should not) open the main database, so it
 * leaves a tiny note here: just an event id and the chosen outcome. Nothing else
 * about the event is stored. The page applies and clears the notes on start.
 *
 * Kept in a separate database from the encrypted event store on purpose.
 */

export const PENDING_DB = 'showup-pending';
const STORE = 'outcomes';

/** @typedef {{ id: string, status: 'attended'|'missed'|'cancelled'|null, at: number }} PendingOutcome */

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Only accept well-formed notes; anything else is ignored. @param {unknown} v @returns {v is PendingOutcome} */
function isPending(v) {
  if (!v || typeof v !== 'object') return false;
  const o = /** @type {Record<string, unknown>} */ (v);
  return typeof o.id === 'string' && o.id.length <= 100 && (o.status === null || o.status === 'attended' || o.status === 'missed' || o.status === 'cancelled');
}

/**
 * Read and clear every pending note.
 * @returns {Promise<PendingOutcome[]>}
 */
export async function takePending() {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await open();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const all = os.getAll();
      all.onsuccess = () => {
        os.clear();
        tx.oncomplete = () => resolve(all.result);
      };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return /** @type {unknown[]} */ (rows).filter(isPending);
  } catch {
    return [];
  }
}
