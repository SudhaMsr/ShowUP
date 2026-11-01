// @ts-check
/**
 * Persistence behind one small contract. Two implementations:
 *   IndexedDbRepository - production
 *   MemoryRepository    - tests, and graceful fallback (private mode / blocked storage)
 *
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {Object} Repository
 * @property {boolean} persistent
 * @property {() => Promise<ShowUpEvent[]>} all
 * @property {(id: string) => Promise<ShowUpEvent|undefined>} get
 * @property {(e: ShowUpEvent) => Promise<void>} put
 * @property {(list: ShowUpEvent[]) => Promise<void>} putMany
 * @property {(id: string) => Promise<void>} delete
 * @property {() => Promise<void>} clearEvents
 * @property {(key: string) => Promise<unknown>} getMeta
 * @property {(key: string, value: unknown) => Promise<void>} setMeta
 * @property {(key: string) => Promise<void>} deleteMeta
 */

export const DB_NAME = 'showup';
export const DB_VERSION = 1;

/** @implements {Repository} */
export class MemoryRepository {
  constructor() {
    this.persistent = false;
    /** @type {Map<string, ShowUpEvent>} */
    this.events = new Map();
    /** @type {Map<string, unknown>} */
    this.meta = new Map();
  }
  async all() {
    return [...this.events.values()].map((e) => structuredClone(e));
  }
  /** @param {string} id */
  async get(id) {
    const e = this.events.get(id);
    return e ? structuredClone(e) : undefined;
  }
  /** @param {ShowUpEvent} e */
  async put(e) {
    this.events.set(e.id, structuredClone(e));
  }
  /** @param {ShowUpEvent[]} list */
  async putMany(list) {
    for (const e of list) this.events.set(e.id, structuredClone(e));
  }
  /** @param {string} id */
  async delete(id) {
    this.events.delete(id);
  }
  async clearEvents() {
    this.events.clear();
  }
  /** @param {string} key */
  async getMeta(key) {
    return this.meta.has(key) ? structuredClone(this.meta.get(key)) : undefined;
  }
  /** @param {string} key @param {unknown} value */
  async setMeta(key, value) {
    this.meta.set(key, structuredClone(value));
  }
  /** @param {string} key */
  async deleteMeta(key) {
    this.meta.delete(key);
  }
}

/** @template T @param {IDBRequest<T>} r @returns {Promise<T>} */
function wrap(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** @param {IDBTransaction} tx @returns {Promise<void>} */
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

/** @implements {Repository} */
export class IndexedDbRepository {
  /** @param {IDBDatabase} db */
  constructor(db) {
    this.db = db;
    this.persistent = true;
  }

  /**
   * @param {string} [name]
   * @returns {Promise<IndexedDbRepository>}
   */
  static open(name = DB_NAME) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'id' });
          store.createIndex('date', 'date');
          store.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the schema must not be blocked by this one.
        db.onversionchange = () => db.close();
        resolve(new IndexedDbRepository(db));
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
    });
  }

  /** @param {string} store @param {IDBTransactionMode} mode */
  #tx(store, mode) {
    const tx = this.db.transaction(store, mode);
    return { tx, os: tx.objectStore(store) };
  }

  async all() {
    const { os } = this.#tx('events', 'readonly');
    return /** @type {ShowUpEvent[]} */ (await wrap(os.getAll()));
  }
  /** @param {string} id */
  async get(id) {
    const { os } = this.#tx('events', 'readonly');
    return /** @type {ShowUpEvent|undefined} */ (await wrap(os.get(id)));
  }
  /** @param {ShowUpEvent} e */
  async put(e) {
    const { tx, os } = this.#tx('events', 'readwrite');
    os.put(e);
    await done(tx);
  }
  /** @param {ShowUpEvent[]} list */
  async putMany(list) {
    const { tx, os } = this.#tx('events', 'readwrite');
    for (const e of list) os.put(e);
    await done(tx);
  }
  /** @param {string} id */
  async delete(id) {
    const { tx, os } = this.#tx('events', 'readwrite');
    os.delete(id);
    await done(tx);
  }
  async clearEvents() {
    const { tx, os } = this.#tx('events', 'readwrite');
    os.clear();
    await done(tx);
  }
  /** @param {string} key */
  async getMeta(key) {
    const { os } = this.#tx('meta', 'readonly');
    const row = /** @type {{ key: string, value: unknown } | undefined} */ (await wrap(os.get(key)));
    return row?.value;
  }
  /** @param {string} key @param {unknown} value */
  async setMeta(key, value) {
    const { tx, os } = this.#tx('meta', 'readwrite');
    os.put({ key, value });
    await done(tx);
  }
  /** @param {string} key */
  async deleteMeta(key) {
    const { tx, os } = this.#tx('meta', 'readwrite');
    os.delete(key);
    await done(tx);
  }
}

/**
 * Open the best available repository. Falls back to memory (flagged
 * `persistent: false`) so the app still works when storage is blocked.
 * @param {string} [name]
 * @returns {Promise<Repository>}
 */
export async function openRepository(name = DB_NAME) {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return await IndexedDbRepository.open(name);
  } catch {
    return new MemoryRepository();
  }
}
