// @ts-check
/**
 * Optional reminder relay client. When switched on, ShowUp sends its upcoming
 * reminder times to a relay you host, which pushes them to ntfy, Telegram, email,
 * a webhook or Web Push, so they arrive while the app is closed. Config, including
 * the device secret, lives in the encrypted store (meta key `relay`).
 *
 * @typedef {{ ntfy?: { topic: string, server?: string }, telegram?: { botToken: string, chatId: string }, webhook?: { url: string }, email?: { to: string }, push?: { subscription: { endpoint: string, keys: { p256dh: string, auth: string } } } }} Channels
 * @typedef {{ url: string, deviceId: string, secret: string, channels: Channels, hideTitles: boolean, enabled: boolean, lastSync: string|null, lastError: string|null, lastCount: number }} RelayConfig
 * @typedef {ReturnType<typeof createRelay>} Relay
 */
import { buildRelayPayload } from '../domain/relay-payload.js';

const DEBOUNCE_MS = 3000;
const REFRESH_MS = 6 * 3600_000;

/** @param {number} n bytes @returns {string} base64url */
function randomToken(n) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} raw @returns {string|null} a clean origin+path without trailing slash, or null */
export function normalizeRelayUrl(raw) {
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** @param {string} b64u */
function b64uToBytes(b64u) {
  const s = b64u.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/**
 * @param {{ repo: import('../storage/repository.js').Repository, store: import('./store.js').Store, fetch?: typeof fetch, now?: () => Date }} deps
 */
export function createRelay(deps) {
  const { repo, store } = deps;
  const doFetch = deps.fetch ?? fetch.bind(globalThis);
  const now = deps.now ?? (() => new Date());
  /** @type {Set<() => void>} */
  const listeners = new Set();
  let lastDigest = '';
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  let busy = false;

  /** @returns {Promise<RelayConfig>} */
  async function config() {
    const c = /** @type {any} */ (await repo.getMeta('relay')) ?? {};
    return {
      url: typeof c.url === 'string' ? c.url : '',
      deviceId: typeof c.deviceId === 'string' ? c.deviceId : '',
      secret: typeof c.secret === 'string' ? c.secret : '',
      channels: c.channels && typeof c.channels === 'object' ? c.channels : {},
      hideTitles: c.hideTitles === true,
      enabled: c.enabled === true,
      lastSync: typeof c.lastSync === 'string' ? c.lastSync : null,
      lastError: typeof c.lastError === 'string' ? c.lastError : null,
      lastCount: Number.isInteger(c.lastCount) ? c.lastCount : 0,
    };
  }
  /** @param {Partial<RelayConfig>} patch */
  async function save(patch) {
    await repo.setMeta('relay', { ...(await config()), ...patch });
    listeners.forEach((l) => l());
  }

  /** @param {RelayConfig} c @param {string} path @param {RequestInit} [init] */
  function call(c, path, init = {}) {
    return doFetch(`${c.url}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.secret}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  }

  /** @param {unknown} err */
  function explain(err) {
    return err instanceof TypeError
      ? 'Could not reach the relay. Check the address, and that this site was built with that relay allowed (see server/README.md).'
      : err instanceof Error ? err.message : 'Something went wrong.';
  }

  /** @param {Response} res */
  async function failure(res) {
    let msg = '';
    try {
      msg = /** @type {any} */ (await res.json()).error ?? '';
    } catch { /* not JSON */ }
    return msg || `The relay answered ${res.status}.`;
  }

  /**
   * Send the current reminder list. Quiet: problems are stored for Settings.
   * @param {{ force?: boolean }} [o]
   */
  async function sync(o = {}) {
    const c = await config();
    if (!c.enabled || !c.url || busy) return { ok: false };
    busy = true;
    try {
      const reminders = buildRelayPayload(store.getState().events, store.getState().settings, now(), { hideTitles: c.hideTitles });
      const body = JSON.stringify({ channels: c.channels, reminders });
      if (!o.force && body === lastDigest) return { ok: true };
      const res = await call({ ...c }, `/v1/devices/${c.deviceId}`, { method: 'PUT', body });
      if (!res.ok) {
        await save({ lastError: await failure(res) });
        return { ok: false };
      }
      lastDigest = body;
      await save({ lastSync: now().toISOString(), lastError: null, lastCount: reminders.length });
      return { ok: true };
    } catch (err) {
      await save({ lastError: explain(err) });
      return { ok: false };
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
    sync,

    /** Ask a relay what it offers. @param {string} rawUrl */
    async info(rawUrl) {
      const url = normalizeRelayUrl(rawUrl);
      if (!url) throw new Error('Use the relay address starting with https://');
      try {
        const res = await doFetch(`${url}/v1/info`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`The relay answered ${res.status}.`);
        return /** @type {{ channels: Record<string, boolean>, vapidPublicKey: string }} */ (await res.json());
      } catch (err) {
        throw new Error(explain(err));
      }
    },

    /** Save settings and send the first sync. @param {{ url: string, channels: Channels, hideTitles: boolean }} next */
    async connect(next) {
      const url = normalizeRelayUrl(next.url);
      if (!url) throw new Error('Use the relay address starting with https://');
      if (!Object.keys(next.channels).length) throw new Error('Choose at least one way to be reminded.');
      const c = await config();
      lastDigest = '';
      await save({
        url, channels: next.channels, hideTitles: next.hideTitles, enabled: true,
        deviceId: c.deviceId || randomToken(18),
        secret: c.secret || randomToken(32),
      });
      const res = await sync({ force: true });
      const after = await config();
      if (!res.ok) throw new Error(after.lastError ?? 'Could not save to the relay.');
      return after;
    },

    /** Send a test message to every configured channel. */
    async test() {
      const c = await config();
      if (!c.enabled) throw new Error('Connect a relay first.');
      try {
        const res = await call(c, `/v1/devices/${c.deviceId}/test`, { method: 'POST' });
        if (!res.ok) throw new Error(await failure(res));
        return /** @type {{ ok: boolean, results: Record<string, { ok: boolean, detail: string }> }} */ (await res.json());
      } catch (err) {
        throw new Error(explain(err));
      }
    },

    /** Stop and delete this device's data on the relay (best effort), then forget the settings. */
    async disconnect() {
      const c = await config();
      let remoteGone = true;
      if (c.enabled && c.url) {
        try {
          const res = await call(c, `/v1/devices/${c.deviceId}`, { method: 'DELETE' });
          remoteGone = res.ok || res.status === 404;
        } catch {
          remoteGone = false;
        }
      }
      await repo.setMeta('relay', {});
      lastDigest = '';
      listeners.forEach((l) => l());
      return { remoteGone };
    },

    /** Subscribe this browser to Web Push from the relay. @param {string} rawUrl */
    async subscribePush(rawUrl) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser cannot receive push messages.');
      const info = await this.info(rawUrl);
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site.');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(info.vapidPublicKey) }));
      const j = sub.toJSON();
      if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('The browser returned an incomplete push subscription.');
      return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
    },

    /** Keep the relay current while the app runs. Returns a stop function. */
    start() {
      const later = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void sync(), DEBOUNCE_MS);
      };
      const off = store.subscribe(later);
      const every = setInterval(() => void sync({ force: true }), REFRESH_MS);
      later();
      return () => {
        off();
        clearInterval(every);
        clearTimeout(timer);
      };
    },
  };
}
