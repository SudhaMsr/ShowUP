// @ts-check
import { localISO, addDays } from '../domain/dates.js';
import { fromCalendarItem, fromEmail, htmlToText } from '../domain/suggestions.js';

/**
 * Google Calendar + Gmail, read-only, straight from the browser.
 *
 * There is no ShowUp server, so this uses Google's browser sign-in (an OAuth
 * "token client") with a Client ID you create in your own Google Cloud project.
 * Access tokens last about an hour and live only in memory. ShowUp reads, it
 * never writes to Google, and every find waits in Approvals.
 *
 * @typedef {import('../domain/suggestions.js').Suggestion} Suggestion
 */

export const GIS_URL = 'https://accounts.google.com/gsi/client';
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://www.googleapis.com';

export class GoogleError extends Error {
  /** @param {string} message @param {'auth'|'api-disabled'|'rate'|'network'|'other'} kind */
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/** Load Google's sign-in script once. @returns {Promise<any>} the `google` global */
export function loadGis() {
  const w = /** @type {any} */ (window);
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => (w.google?.accounts?.oauth2 ? resolve(w.google) : reject(new GoogleError('Google sign-in did not load.', 'network')));
    s.onerror = () => reject(new GoogleError('Could not reach Google. Check your connection.', 'network'));
    document.head.appendChild(s);
  });
}

/**
 * @param {{ fetchImpl?: typeof fetch, loadScript?: () => Promise<any>, now?: () => Date }} [deps]
 */
export function createGoogle(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? ((...a) => fetch(...a));
  const load = deps.loadScript ?? loadGis;
  const now = deps.now ?? (() => new Date());
  /** @type {{ value: string, expiresAt: number }|null} */
  let token = null;

  /** @param {string} clientId @param {boolean} gmail @param {'consent'|'none'|''} prompt */
  async function requestToken(clientId, gmail, prompt) {
    const google = await load();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: gmail ? `${CAL_SCOPE} ${GMAIL_SCOPE}` : CAL_SCOPE,
        callback: (/** @type {any} */ res) => {
          if (res.error || !res.access_token) return reject(new GoogleError(res.error_description || 'Google did not grant access.', 'auth'));
          token = { value: res.access_token, expiresAt: now().getTime() + (Number(res.expires_in) || 3600) * 1000 - 60_000 };
          resolve(true);
        },
        error_callback: (/** @type {any} */ err) => reject(new GoogleError(err?.type === 'popup_closed' ? 'The Google window was closed.' : 'Google sign-in was blocked or failed.', 'auth')),
      });
      client.requestAccessToken({ prompt });
    });
  }

  /** @param {string} path @param {Record<string,string>} [params] */
  async function api(path, params = {}) {
    if (!token || token.expiresAt <= now().getTime()) throw new GoogleError('Google access expired. Reconnect to keep syncing.', 'auth');
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    let res;
    try {
      res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token.value}` } });
    } catch {
      throw new GoogleError('Could not reach Google. Check your connection.', 'network');
    }
    if (res.status === 401) {
      token = null;
      throw new GoogleError('Google access expired. Reconnect to keep syncing.', 'auth');
    }
    if (res.status === 403) {
      const body = /** @type {any} */ (await res.json().catch(() => ({})));
      const reason = JSON.stringify(body).toLowerCase();
      if (reason.includes('has not been used') || reason.includes('disabled')) throw new GoogleError('That Google API is not switched on in your Google Cloud project. See the setup steps.', 'api-disabled');
      throw new GoogleError('Google refused access. Check the permissions you granted.', 'auth');
    }
    if (res.status === 429) throw new GoogleError('Google is rate-limiting requests. Try again in a few minutes.', 'rate');
    if (!res.ok) throw new GoogleError(`Google returned an error (${res.status}).`, 'other');
    return res.json();
  }

  /** Calendar events in the next `days` days. @param {{ days?: number }} [o] @returns {Promise<Suggestion[]>} */
  async function calendar(o = {}) {
    const n = now();
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const to = new Date(`${addDays(localISO(n), o.days ?? 60)}T23:59:59`);
    const data = /** @type {any} */ (await api('/calendar/v3/calendars/primary/events', {
      timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    }));
    return (Array.isArray(data.items) ? data.items : []).map((/** @type {any} */ i) => fromCalendarItem(i, { now: n })).filter(Boolean);
  }

  /** @param {any} part @returns {string} */
  function bodyText(part) {
    if (!part) return '';
    const decode = (/** @type {string} */ d) => {
      try {
        const bin = atob(d.replace(/-/g, '+').replace(/_/g, '/'));
        return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      } catch {
        return '';
      }
    };
    if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
    if (Array.isArray(part.parts)) {
      const plain = part.parts.map(bodyText).filter(Boolean);
      if (plain.length) return plain.join('\n');
    }
    if (part.mimeType === 'text/html' && part.body?.data) return htmlToText(decode(part.body.data));
    return '';
  }

  /** Recent mail that looks like an event confirmation. @param {{ max?: number }} [o] @returns {Promise<Suggestion[]>} */
  async function gmail(o = {}) {
    const q = 'newer_than:30d (registered OR registration OR confirmed OR ticket OR RSVP OR invitation OR webinar OR hackathon OR meetup OR conference OR workshop OR interview)';
    const list = /** @type {any} */ (await api('/gmail/v1/users/me/messages', { q, maxResults: String(o.max ?? 25) }));
    /** @type {Suggestion[]} */
    const out = [];
    for (const m of (Array.isArray(list.messages) ? list.messages : []).slice(0, o.max ?? 25)) {
      const full = /** @type {any} */ (await api(`/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}`, { format: 'full' }));
      const header = (/** @type {string} */ name) => full.payload?.headers?.find((/** @type {any} */ h) => h.name?.toLowerCase() === name)?.value ?? '';
      const s = fromEmail({ id: m.id, subject: header('subject'), from: header('from'), text: bodyText(full.payload) }, { now: now() });
      if (s) out.push(s);
    }
    return out;
  }

  return {
    hasToken: () => Boolean(token && token.expiresAt > now().getTime()),
    /** Interactive sign-in (needs a click). @param {string} clientId @param {boolean} wantGmail */
    connect: (clientId, wantGmail) => requestToken(clientId, wantGmail, 'consent'),
    /** Quietly renew access for someone who already agreed. Resolves false when a click is needed. @param {string} clientId @param {boolean} wantGmail */
    renew: (clientId, wantGmail) => requestToken(clientId, wantGmail, 'none').then(() => true, () => false),
    /** @param {{ gmail: boolean }} o @returns {Promise<{ found: Suggestion[], errors: string[] }>} */
    async sync(o) {
      /** @type {Suggestion[]} */
      let found = [];
      /** @type {string[]} */
      const errors = [];
      try {
        found = found.concat(await calendar());
      } catch (e) {
        if (e instanceof GoogleError && e.kind === 'auth') throw e;
        errors.push(`Calendar: ${/** @type {Error} */ (e).message}`);
      }
      if (o.gmail) {
        try {
          found = found.concat(await gmail());
        } catch (e) {
          if (e instanceof GoogleError && e.kind === 'auth') throw e;
          errors.push(`Gmail: ${/** @type {Error} */ (e).message}`);
        }
      }
      return { found, errors };
    },
    /** Revoke access at Google and forget the token. */
    async disconnect() {
      const t = token?.value;
      token = null;
      if (!t) return;
      try {
        const google = await load();
        await new Promise((r) => google.accounts.oauth2.revoke(t, () => r(undefined)));
      } catch {
        /* the token expires within the hour anyway */
      }
    },
  };
}
