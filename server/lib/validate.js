// Strict validation of what clients send. Anything unexpected is dropped, not trusted.

const str = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isHttps = (/** @type {string} */ u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

export const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const MAX_REMINDERS = 500;

/**
 * @param {unknown} raw
 * @param {{ emailEnabled: boolean, allowPrivate?: boolean }} o
 * @returns {{ ok: true, channels: Record<string, any> } | { ok: false, error: string }}
 */
export function validateChannels(raw, o) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'channels must be an object' };
  const src = /** @type {Record<string, any>} */ (raw);
  /** @type {Record<string, any>} */
  const out = {};
  const urlOk = (/** @type {string} */ u) => (o.allowPrivate ? /^https?:\/\//.test(u) : isHttps(u));
  if (src.ntfy) {
    const topic = str(src.ntfy.topic, 64);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(topic)) return { ok: false, error: 'ntfy topic must be 6 to 64 letters, digits, - or _' };
    const server = str(src.ntfy.server, 200);
    if (server && !urlOk(server)) return { ok: false, error: 'ntfy server must be an https address' };
    out.ntfy = { topic, ...(server ? { server: server.replace(/\/+$/, '') } : {}) };
  }
  if (src.telegram) {
    const botToken = str(src.telegram.botToken, 100);
    const chatId = str(String(src.telegram.chatId ?? ''), 40);
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken) || !/^-?\d+$|^@[A-Za-z0-9_]{4,}$/.test(chatId)) return { ok: false, error: 'telegram needs a bot token and a chat id' };
    out.telegram = { botToken, chatId };
  }
  if (src.webhook) {
    const url = str(src.webhook.url, 500);
    if (!urlOk(url)) return { ok: false, error: 'webhook must be an https address' };
    out.webhook = { url };
  }
  if (src.email) {
    const to = str(src.email.to, 200);
    if (!o.emailEnabled) return { ok: false, error: 'email is not enabled on this relay' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: 'email address looks wrong' };
    out.email = { to };
  }
  if (src.push) {
    const sub = src.push.subscription;
    const endpoint = str(sub?.endpoint, 1000);
    const p256dh = str(sub?.keys?.p256dh, 200);
    const auth = str(sub?.keys?.auth, 100);
    if (!urlOk(endpoint) || !p256dh || !auth) return { ok: false, error: 'push subscription is incomplete' };
    out.push = { subscription: { endpoint, keys: { p256dh, auth } } };
  }
  return { ok: true, channels: out };
}

/** @param {unknown} raw @returns {Array<{ key: string, at: number, title: string, body: string }>} */
export function validateReminders(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const key = str(r.key, 100);
    const at = Number(r.at);
    if (!key || seen.has(key) || !Number.isFinite(at) || at < 0 || at > 8.64e15) continue;
    seen.add(key);
    out.push({ key, at: Math.round(at), title: str(r.title, 120) || 'ShowUp reminder', body: str(r.body, 300) });
    if (out.length >= MAX_REMINDERS) break;
  }
  return out;
}
