// @ts-check
import { newSuggestions } from '../domain/suggestions.js';

/**
 * The Approvals inbox: proposed events waiting for a yes or no. Kept in the same
 * encrypted store as events (meta keys `suggestions` and `dismissed`).
 *
 * @typedef {import('../domain/suggestions.js').Suggestion} Suggestion
 * @typedef {import('./store.js').Store} Store
 */

const MAX_WAITING = 200;
const MAX_DISMISSED = 3000;

/**
 * @param {import('../storage/repository.js').Repository} repo
 */
export function createInbox(repo) {
  /** @type {Suggestion[]} */
  let waiting = [];
  /** @type {string[]} */
  let dismissed = [];
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => l());
  const persist = async () => {
    await repo.setMeta('suggestions', waiting);
    await repo.setMeta('dismissed', dismissed);
  };

  return {
    async init() {
      const w = await repo.getMeta('suggestions');
      const d = await repo.getMeta('dismissed');
      waiting = Array.isArray(w) ? /** @type {Suggestion[]} */ (w).filter((s) => s && typeof s.id === 'string' && s.draft) : [];
      dismissed = Array.isArray(d) ? /** @type {string[]} */ (d).filter((x) => typeof x === 'string') : [];
      emit();
    },
    list: () => waiting,
    count: () => waiting.length,
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * Add proposals that are genuinely new. @param {Suggestion[]} found @param {import('../domain/event.js').ShowUpEvent[]} events
     * @returns {Promise<Suggestion[]>} the ones that were added
     */
    async add(found, events) {
      const fresh = newSuggestions(found, { events, waiting, dismissed: new Set(dismissed) }).slice(0, Math.max(0, MAX_WAITING - waiting.length));
      if (!fresh.length) return [];
      waiting = [...waiting, ...fresh];
      await persist();
      emit();
      return fresh;
    },

    /** Say yes: save as a real event. @param {string} id @param {Store} store */
    async approve(id, store) {
      const s = waiting.find((x) => x.id === id);
      if (!s) return false;
      const res = await store.save({ ...s.draft, status: 'upcoming' });
      if (!res.ok) return false;
      waiting = waiting.filter((x) => x.id !== id);
      await persist();
      emit();
      return true;
    },

    /** @param {Store} store @returns {Promise<number>} how many were added */
    async approveAll(store) {
      let n = 0;
      for (const s of [...waiting]) if (await this.approve(s.id, store)) n++;
      return n;
    },

    /** Say no, and remember it so it is never proposed again. @param {string} id */
    async dismiss(id) {
      if (!waiting.some((x) => x.id === id)) return;
      waiting = waiting.filter((x) => x.id !== id);
      dismissed = [...dismissed, id].slice(-MAX_DISMISSED);
      await persist();
      emit();
    },

    async dismissAll() {
      dismissed = [...dismissed, ...waiting.map((s) => s.id)].slice(-MAX_DISMISSED);
      waiting = [];
      await persist();
      emit();
    },
  };
}
