// Web Push (RFC 8030 + VAPID RFC 8292 + aes128gcm RFC 8291) using only node:crypto.
import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, createCipheriv, sign } from 'node:crypto';

/** @param {Buffer|Uint8Array|string} b */
export const b64u = (b) => Buffer.from(b).toString('base64url');
/** @param {string} s */
export const unb64u = (s) => Buffer.from(s, 'base64url');

/** New VAPID key pair as JWK (private) plus the public key in uncompressed form. */
export function generateVapid() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), unb64u(String(jwk.x)), unb64u(String(jwk.y))]);
  return { privateJwk: jwk, publicKey: b64u(pub) };
}

/**
 * Authorization header for a push endpoint.
 * @param {{ privateJwk: any, publicKey: string }} vapid @param {string} endpoint @param {string} subject @param {number} nowMs
 */
export function vapidHeader(vapid, endpoint, subject, nowMs) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject }));
  const data = `${head}.${body}`;
  const sig = sign('sha256', Buffer.from(data), { key: createPrivateKey({ key: vapid.privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/**
 * Encrypt a payload for one subscription (single record, aes128gcm).
 * @param {Buffer} payload @param {string} p256dh base64url, 65 bytes @param {string} auth base64url, 16 bytes
 * @param {{ salt?: Buffer, ecdh?: import('node:crypto').ECDH }} [fixed] fixed inputs for tests
 */
export function encryptPayload(payload, p256dh, auth, fixed = {}) {
  const ua = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (ua.length !== 65 || ua[0] !== 4 || authSecret.length !== 16) throw new Error('bad push subscription keys');
  const ecdh = fixed.ecdh ?? createECDH('prime256v1');
  if (!fixed.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = fixed.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  if (payload.length > 3800) throw new Error('push payload too large');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = 65;
  return Buffer.concat([header, asPublic, ct]);
}

/**
 * Send one push message. Returns { ok, status, gone } where gone means the subscription is dead.
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} sub
 * @param {object} message JSON-able
 * @param {{ vapid: any, subject: string, fetch: typeof fetch, now: () => number }} deps
 */
export async function sendWebPush(sub, message, deps) {
  const body = encryptPayload(Buffer.from(JSON.stringify(message)), sub.keys.p256dh, sub.keys.auth);
  const res = await deps.fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(deps.vapid, sub.endpoint, deps.subject, deps.now()),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
}
