// The relay: stores each device's upcoming reminders and sends them when they are due,
// so a reminder arrives even when the app is closed. It knows nothing about events,
// only (time, title, text) tuples the client chose to send.
import { createHash, timingSafeEqual } from 'node:crypto';
import { deliver } from './channels.js';
import { ID_RE, validateChannels, validateReminders } from './validate.js';

const MAX_BODY = 256 * 1024;
const MAX_LATE_MS = 6 * 3600_000; // a reminder this late is skipped, not sent as news
const DEVICE_TTL_MS = 90 * 86400_000;

/** @param {string} s */
const sha = (s) => createHash('sha256').update(s).digest();

/**
 * @param {{ db: ReturnType<typeof import('./db.js').createDb>, env?: Record<string,string|undefined>, fetch?: typeof fetch, now?: () => number, vapid: any, lookup?: any, allowPrivate?: boolean, log?: (m: string) => void }} o
 */
export function createApp(o) {
  const env = o.env ?? {};
  const now = o.now ?? (() => Date.now());
  const maxDevices = Number(env.RELAY_MAX_DEVICES) || 1000;
  const rateLimit = Number(env.RELAY_RATE_PER_MIN) || 120;
  const log = o.log ?? (() => {});
  const deps = () => ({ fetch: o.fetch ?? fetch, env, vapid: o.vapid, now, lookup: o.lookup, allowPrivate: o.allowPrivate });
  const emailEnabled = Boolean(env.RELAY_EMAIL_API_KEY);
  const origins = (env.RELAY_ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);

  /** @type {Map<string, { n: number, reset: number }>} */
  const hits = new Map();
  /** @param {string} ip */
  function limited(ip) {
    const t = now();
    const h = hits.get(ip);
    if (!h || h.reset <= t) {
      hits.set(ip, { n: 1, reset: t + 60_000 });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      return false;
    }
    return ++h.n > rateLimit;
  }

  /** @param {import('node:http').IncomingMessage} req */
  function cors(req) {
    const origin = req.headers.origin;
    const allow = origins.includes('*') ? '*' : origin && origins.includes(origin) ? origin : '';
    return /** @type {Record<string,string>} */ ({
      ...(allow ? { 'Access-Control-Allow-Origin': allow, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    });
  }

  /** @param {import('node:http').ServerResponse} res @param {number} status @param {any} body @param {Record<string,string>} headers */
  function send(res, status, body, headers) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  }

  /** @param {import('node:http').IncomingMessage} req */
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      /** @type {Buffer[]} */
      const chunks = [];
      let tooBig = false;
      req.on('data', (c) => {
        size += c.length;
        if (tooBig) return; // keep draining so the client can read our 413
        if (size > MAX_BODY * 4) {
          req.destroy(); // a client streaming without end is not worth answering
        } else if (size > MAX_BODY) {
          tooBig = true;
          chunks.length = 0;
          reject(Object.assign(new Error('Request too large'), { status: 413 }));
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return;
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('./db.js').Device} d */
  function authed(req, d) {
    const m = /^Bearer (.{32,200})$/.exec(String(req.headers.authorization ?? ''));
    return Boolean(m) && timingSafeEqual(sha(m?.[1] ?? ''), Buffer.from(d.secretHash, 'hex'));
  }

  /** @type {import('node:http').RequestListener} */
  async function handler(req, res) {
    const headers = cors(req);
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {}, headers);
      const ip = (env.RELAY_TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
      if (limited(ip)) return send(res, 429, { error: 'Too many requests. Try again in a minute.' }, { ...headers, 'Retry-After': '60' });
      const url = new URL(req.url ?? '/', 'http://relay');
      const path = url.pathname;

      if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true }, headers);
      if (req.method === 'GET' && path === '/v1/info') {
        return send(res, 200, { version: 1, channels: { ntfy: true, telegram: true, webhook: true, push: true, email: emailEnabled }, vapidPublicKey: o.vapid.publicKey }, headers);
      }

      const m = /^\/v1\/devices\/([^/]+)(\/test)?$/.exec(path);
      if (!m) return send(res, 404, { error: 'Not found' }, headers);
      const id = m[1];
      if (!ID_RE.test(id)) return send(res, 400, { error: 'Bad device id' }, headers);
      const existing = o.db.get(id);

      if (req.method === 'PUT' && !m[2]) {
        const body = /** @type {any} */ (await readBody(req));
        const bearer = /^Bearer (.{32,200})$/.exec(String(req.headers.authorization ?? ''));
        if (!bearer) return send(res, 401, { error: 'Missing device secret (32+ characters).' }, headers);
        if (existing && !authed(req, existing)) return send(res, 403, { error: 'Wrong device secret.' }, headers);
        if (!existing && o.db.count() >= maxDevices) return send(res, 503, { error: 'This relay is full.' }, headers);
        const ch = validateChannels(body.channels, { emailEnabled, allowPrivate: o.allowPrivate });
        if (!ch.ok) return send(res, 400, { error: ch.error }, headers);
        const reminders = validateReminders(body.reminders);
        const keep = new Set(reminders.map((r) => r.key));
        /** @type {Record<string, number>} */
        const sent = {};
        for (const [k, v] of Object.entries(existing?.sent ?? {})) if (keep.has(k)) sent[k] = v;
        const t = now();
        await o.db.put({ id, secretHash: existing?.secretHash ?? sha(bearer[1]).toString('hex'), channels: ch.channels, reminders, sent, createdAt: existing?.createdAt ?? t, updatedAt: t });
        return send(res, 200, { ok: true, reminders: reminders.length, channels: Object.keys(ch.channels) }, headers);
      }

      if (!existing) return send(res, 404, { error: 'Unknown device. Save your settings first.' }, headers);
      if (!authed(req, existing)) return send(res, 403, { error: 'Wrong device secret.' }, headers);

      if (req.method === 'DELETE' && !m[2]) {
        await o.db.remove(id);
        return send(res, 200, { ok: true }, headers);
      }
      if (req.method === 'POST' && m[2]) {
        const results = await deliver(existing.channels, { title: 'ShowUp test', body: 'Reminders from your relay are working.', key: `test:${now()}`, at: now() }, deps());
        return send(res, 200, { ok: Object.values(results).some((r) => r.ok), results }, headers);
      }
      return send(res, 405, { error: 'Method not allowed' }, headers);
    } catch (err) {
      const status = /** @type {any} */ (err)?.status ?? 500;
      if (status === 500) log(`error: ${err instanceof Error ? err.message : err}`);
      return send(res, status, { error: status === 500 ? 'Server error' : /** @type {Error} */ (err).message }, headers);
    }
  }

  let ticking = false;
  /** Send everything that came due. Safe to call at any time; overlapping calls are ignored. */
  async function tick() {
    if (ticking) return { sent: 0 };
    ticking = true;
    let count = 0;
    try {
      const t = now();
      for (const d of o.db.devices()) {
        if (t - d.updatedAt > DEVICE_TTL_MS) {
          await o.db.remove(d.id);
          continue;
        }
        const due = d.reminders.filter((r) => r.at <= t && !d.sent[r.key]).sort((a, b) => a.at - b.at);
        if (!due.length) continue;
        // Mark first so a crash can never cause a send loop.
        for (const r of due) d.sent[r.key] = t;
        await o.db.put(d);
        for (const r of due) {
          if (t - r.at > MAX_LATE_MS) continue;
          const results = await deliver(d.channels, { title: r.title, body: r.body, key: r.key, at: r.at }, deps());
          count++;
          if (results.push?.gone) {
            delete d.channels.push;
            await o.db.put(d);
          }
          log(`sent ${r.key.slice(0, 8)} to ${Object.entries(results).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'fail'}`).join(',') || 'no channels'}`);
        }
      }
    } finally {
      ticking = false;
    }
    return { sent: count };
  }

  return { handler, tick };
}
