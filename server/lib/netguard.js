// Refuse to make server-side requests to private networks (SSRF guard).
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/** @param {string} ip */
export function isPrivateIp(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
  }
  return true;
}

/**
 * Throws unless the URL is https and every address it resolves to is public.
 * @param {string} urlStr
 * @param {{ lookup?: (host: string) => Promise<Array<{ address: string }>>, allowPrivate?: boolean }} [o]
 */
export async function assertPublicUrl(urlStr, o = {}) {
  const u = new URL(urlStr);
  if (o.allowPrivate) return u;
  if (u.protocol !== 'https:') throw new Error('Only https:// addresses are allowed.');
  if (u.username || u.password) throw new Error('Addresses with a login are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host)
    ? [{ address: host }]
    : await (o.lookup ?? ((/** @type {string} */ h) => dnsLookup(h, { all: true })))(host);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address points to a private network.');
  return u;
}
