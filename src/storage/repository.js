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

/**
 * @typedef {import('../app/crypto.js').Codec} Codec
 */

/** @param {unknown} v */
function sealedShape(v) {
  return Boolean(v) && typeof v === 'object' && /** @type {any} */ (v).enc === 1 && typeof /** @type {any} */ (v).iv === 'string' && typeof /** @type {any} */ (v).ct === 'string';
}

/**
 * IndexedDB-backed repository. With a codec, every record is stored encrypted
 * and only the id/key stays readable. Records saved before encryption was turned
 * on (plain objects) are still read, and `migrate()` re-saves them encrypted.
 * @implements {Repository}
 */
export class IndexedDbRepository {
  /** @param {IDBDatabase} db @param {Codec|null} [codec] */
  constructor(db, codec = null) {
    this.db = db;
    this.codec = codec;
    this.persistent = true;
    /** Records that could not be decrypted (wrong key or tampering). */
    this.unreadable = 0;
  }

  /**
   * @param {string} [name] @param {Codec|null} [codec]
   * @returns {Promise<IndexedDbRepository>}
   */
  static open(name = DB_NAME, codec = null) {
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
        resolve(new IndexedDbRepository(db, codec));
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
    });
  }

  close() {
    this.db.close();
  }

  /** @param {string} store @param {IDBTransactionMode} mode */
  #tx(store, mode) {
    const tx = this.db.transaction(store, mode);
    return { tx, os: tx.objectStore(store) };
  }

  /** Stored form of an event. @param {ShowUpEvent} e */
  async #packEvent(e) {
    return this.codec ? { id: e.id, ...(await this.codec.encode(`events:${e.id}`, e)) } : e;
  }

  /** Back to an event; undefined if it cannot be read. @param {any} rec */
  async #unpackEvent(rec) {
    if (!sealedShape(rec)) return /** @type {ShowUpEvent} */ (rec);
    if (!this.codec) return undefined;
    try {
      return /** @type {ShowUpEvent} */ (await this.codec.decode(`events:${rec.id}`, rec));
    } catch {
      this.unreadable++;
      return undefined;
    }
  }

  async all() {
    const { os } = this.#tx('events', 'readonly');
    const rows = /** @type {any[]} */ (await wrap(os.getAll()));
    const out = await Promise.all(rows.map((r) => this.#unpackEvent(r)));
    return /** @type {ShowUpEvent[]} */ (out.filter(Boolean));
  }
  /** @param {string} id */
  async get(id) {
    const { os } = this.#tx('events', 'readonly');
    return this.#unpackEvent(await wrap(os.get(id)));
  }
  /** @param {ShowUpEvent} e */
  async put(e) {
    return this.putMany([e]);
  }
  /** @param {ShowUpEvent[]} list */
  async putMany(list) {
    // Encrypt first: an IndexedDB transaction closes if we await non-IDB work inside it.
    const rows = await Promise.all(list.map((e) => this.#packEvent(e)));
    const { tx, os } = this.#tx('events', 'readwrite');
    for (const r of rows) os.put(r);
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
    const row = /** @type {any} */ (await wrap(os.get(key)));
    if (!row) return undefined;
    if (!sealedShape(row)) return row.value;
    if (!this.codec) return undefined;
    try {
      return await this.codec.decode(`meta:${key}`, row);
    } catch {
      this.unreadable++;
      return undefined;
    }
  }
  /** @param {string} key @param {unknown} value */
  async setMeta(key, value) {
    const row = this.codec ? { key, ...(await this.codec.encode(`meta:${key}`, value)) } : { key, value };
    const { tx, os } = this.#tx('meta', 'readwrite');
    os.put(row);
    await done(tx);
  }
  /** @param {string} key */
  async deleteMeta(key) {
    const { tx, os } = this.#tx('meta', 'readwrite');
    os.delete(key);
    await done(tx);
  }

  /**
   * Encrypt anything still stored in plain form. Safe to run repeatedly.
   * @returns {Promise<number>} how many records were converted
   */
  async migrate() {
    const codec = this.codec;
    if (!codec) return 0;
    const events = /** @type {any[]} */ (await wrap(this.#tx('events', 'readonly').os.getAll())).filter((r) => !sealedShape(r));
    const metas = /** @type {any[]} */ (await wrap(this.#tx('meta', 'readonly').os.getAll())).filter((r) => !sealedShape(r));
    const eventRows = await Promise.all(events.map((e) => this.#packEvent(e)));
    const metaRows = await Promise.all(metas.map(async (m) => ({ key: m.key, ...(await codec.encode(`meta:${m.key}`, m.value)) })));
    if (eventRows.length) {
      const { tx, os } = this.#tx('events', 'readwrite');
      for (const r of eventRows) os.put(r);
      await done(tx);
    }
    if (metaRows.length) {
      const { tx, os } = this.#tx('meta', 'readwrite');
      for (const r of metaRows) os.put(r);
      await done(tx);
    }
    return eventRows.length + metaRows.length;
  }

  /** How many records are still in plain form (used to offer migration). */
  async plaintextCount() {
    const events = /** @type {any[]} */ (await wrap(this.#tx('events', 'readonly').os.getAll()));
    return events.filter((r) => !sealedShape(r)).length;
  }
}

/**
 * Open the best available repository. Falls back to memory (flagged
 * `persistent: false`) so the app still works when storage is blocked.
 * @param {string} [name] @param {Codec|null} [codec]
 * @returns {Promise<Repository>}
 */
export async function openRepository(name = DB_NAME, codec = null) {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return await IndexedDbRepository.open(name, codec);
  } catch {
    return new MemoryRepository();
  }
}
