// @ts-check
/**
 * Keeps Google connected and feeds the Approvals inbox. Config lives in the
 * encrypted store (meta key `google`); tokens never leave memory.
 *
 * @typedef {{ clientId: string, gmail: boolean, connected: boolean, lastSync: string|null, lastAdded: number, errors: string[], needsReconnect: boolean }} GoogleConfig
 * @typedef {ReturnType<typeof createConnections>} Connections
 */

export const CLIENT_ID_RE = /^[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+)*\.apps\.googleusercontent\.com$/;
const EVERY_MS = 20 * 60_000;

/**
 * @param {{ repo: import('../storage/repository.js').Repository, store: import('./store.js').Store, inbox: ReturnType<typeof import('./inbox.js').createInbox>, google: ReturnType<typeof import('./google.js').createGoogle>, onFound: (added: import('../domain/suggestions.js').Suggestion[]) => void, now?: () => Date }} deps
 */
export function createConnections(deps) {
  const { repo, store, inbox, google, onFound } = deps;
  const now = deps.now ?? (() => new Date());
  /** @type {Set<() => void>} */
  const listeners = new Set();
  let busy = false;

  /** @returns {Promise<GoogleConfig>} */
  async function config() {
    const c = /** @type {any} */ (await repo.getMeta('google')) ?? {};
    return {
      clientId: typeof c.clientId === 'string' ? c.clientId : '',
      gmail: c.gmail === true,
      connected: c.connected === true,
      lastSync: typeof c.lastSync === 'string' ? c.lastSync : null,
      lastAdded: Number.isInteger(c.lastAdded) ? c.lastAdded : 0,
      errors: Array.isArray(c.errors) ? c.errors.filter((/** @type {unknown} */ e) => typeof e === 'string').slice(0, 5) : [],
      needsReconnect: c.needsReconnect === true,
    };
  }
  /** @param {Partial<GoogleConfig>} patch */
  async function save(patch) {
    await repo.setMeta('google', { ...(await config()), ...patch });
    listeners.forEach((l) => l());
  }

  /**
   * Check Google now. Quiet by design: problems are recorded for the Settings page, not thrown at the user.
   * @returns {Promise<{ added: number, errors: string[], needsReconnect: boolean }>}
   */
  async function syncNow() {
    const cfg = await config();
    if (!cfg.connected || busy) return { added: 0, errors: [], needsReconnect: cfg.needsReconnect };
    busy = true;
    try {
      if (!google.hasToken() && !(await google.renew(cfg.clientId, cfg.gmail))) {
        await save({ needsReconnect: true });
        return { added: 0, errors: [], needsReconnect: true };
      }
      const { found, errors } = await google.sync({ gmail: cfg.gmail });
      const added = await inbox.add(found, store.getState().events);
      await save({ lastSync: now().toISOString(), lastAdded: added.length, errors, needsReconnect: false });
      if (added.length) onFound(added);
      return { added: added.length, errors, needsReconnect: false };
    } catch (e) {
      const err = /** @type {any} */ (e);
      const needs = err?.kind === 'auth';
      await save({ errors: [err?.message ?? 'Sync failed.'], needsReconnect: needs });
      return { added: 0, errors: [err?.message ?? 'Sync failed.'], needsReconnect: needs };
    } finally {
      busy = false;
    }
  }

  return {
    config,
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Must run from a click (Google opens a window). @param {string} clientId @param {boolean} gmail */
    async connect(clientId, gmail) {
      const id = clientId.trim();
      if (!CLIENT_ID_RE.test(id)) throw new Error('That does not look like a Google Client ID. It ends in .apps.googleusercontent.com.');
      await google.connect(id, gmail);
      await save({ clientId: id, gmail, connected: true, needsReconnect: false, errors: [] });
      return syncNow();
    },
    syncNow,
    /** Change what is scanned. Turning Gmail on needs a fresh consent, so it reconnects. @param {boolean} gmail */
    async setGmail(gmail) {
      const cfg = await config();
      if (gmail === cfg.gmail) return;
      if (gmail) await google.connect(cfg.clientId, true);
      await save({ gmail });
      if (gmail) await syncNow();
    },
    async disconnect() {
      await google.disconnect();
      await save({ connected: false, lastSync: null, errors: [], needsReconnect: false });
    },
    /** Poll while the app is open. @returns {() => void} stop */
    startAuto() {
      const timer = setInterval(() => void syncNow(), EVERY_MS);
      const onVisible = () => {
        if (document.visibilityState === 'visible') void syncNow();
      };
      document.addEventListener('visibilitychange', onVisible);
      void syncNow();
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
  };
}
