// Delivery channels. Each takes a validated config and one message; returns { ok, detail, gone? }.
import { assertPublicUrl } from './netguard.js';
import { sendWebPush } from './webpush.js';

/**
 * @typedef {{ title: string, body: string, key: string, at: number }} Message
 * @typedef {{ fetch: typeof fetch, env: Record<string, string|undefined>, vapid: any, now: () => number, lookup?: any, allowPrivate?: boolean }} Deps
 */

const TIMEOUT = 10_000;

/** @param {Deps} d @param {string} url */
const guard = (d, url) => assertPublicUrl(url, { lookup: d.lookup, allowPrivate: d.allowPrivate });

/** @param {Deps} d @param {string} url @param {object} body @param {Record<string,string>} [headers] */
async function postJson(d, url, body, headers = {}) {
  const res = await d.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT), redirect: 'error' });
  return res;
}

/** @type {Record<string, (cfg: any, m: Message, d: Deps) => Promise<{ ok: boolean, detail: string, gone?: boolean }>>} */
export const CHANNELS = {
  async ntfy(cfg, m, d) {
    const server = cfg.server || 'https://ntfy.sh';
    await guard(d, server);
    const res = await postJson(d, server, { topic: cfg.topic, title: m.title, message: m.body, priority: 4, tags: ['calendar'] });
    return { ok: res.ok, detail: `ntfy ${res.status}` };
  },
  async telegram(cfg, m, d) {
    const res = await postJson(d, `https://api.telegram.org/bot${cfg.botToken}/sendMessage`, { chat_id: cfg.chatId, text: `${m.title}\n${m.body}` });
    return { ok: res.ok, detail: `telegram ${res.status}` };
  },
  async webhook(cfg, m, d) {
    await guard(d, cfg.url);
    const res = await postJson(d, cfg.url, { source: 'showup', key: m.key, at: m.at, title: m.title, body: m.body });
    return { ok: res.ok, detail: `webhook ${res.status}` };
  },
  async email(cfg, m, d) {
    const key = d.env.RELAY_EMAIL_API_KEY;
    if (!key) return { ok: false, detail: 'email is not enabled on this relay' };
    const url = d.env.RELAY_EMAIL_API_URL || 'https://api.resend.com/emails';
    const res = await postJson(d, url, { from: d.env.RELAY_EMAIL_FROM || 'ShowUp <reminders@example.com>', to: [cfg.to], subject: m.title, text: m.body }, { Authorization: `Bearer ${key}` });
    return { ok: res.ok, detail: `email ${res.status}` };
  },
  async push(cfg, m, d) {
    await guard(d, cfg.subscription.endpoint);
    const r = await sendWebPush(cfg.subscription, { title: m.title, body: m.body, tag: m.key }, {
      vapid: d.vapid, subject: d.env.RELAY_CONTACT || 'mailto:admin@example.com', fetch: d.fetch, now: d.now,
    });
    return { ok: r.ok, detail: `push ${r.status}`, gone: r.gone };
  },
};

/**
 * Send to every configured channel. A failure in one never blocks the others.
 * @param {Record<string, any>} channels @param {Message} m @param {Deps} d
 * @returns {Promise<Record<string, { ok: boolean, detail: string, gone?: boolean }>>}
 */
export async function deliver(channels, m, d) {
  /** @type {Record<string, { ok: boolean, detail: string, gone?: boolean }>} */
  const out = {};
  for (const [name, cfg] of Object.entries(channels)) {
    const send = CHANNELS[name];
    if (!send || !cfg) continue;
    try {
      out[name] = await send(cfg, m, d);
    } catch (err) {
      out[name] = { ok: false, detail: err instanceof Error ? err.message.slice(0, 120) : 'failed' };
    }
  }
  return out;
}
