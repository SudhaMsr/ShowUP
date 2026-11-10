import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { createApp } from '../../server/lib/app.js';
import { createDb } from '../../server/lib/db.js';
import { assertPublicUrl, isPrivateIp } from '../../server/lib/netguard.js';
import { b64u, encryptPayload, generateVapid, unb64u, vapidHeader } from '../../server/lib/webpush.js';

// ---- Web Push encryption against the RFC 8291 Appendix A test vector ----

test('web push: aes128gcm output matches the RFC 8291 test vector', () => {
  const asPrivate = unb64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(asPrivate);
  const body = encryptPayload(
    Buffer.from('When I grow up, I want to be a watermelon'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), ecdh },
  );
  const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  assert.equal(b64u(body), expected);
});

test('web push: VAPID header is an ES256 JWT for the endpoint origin', () => {
  const v = generateVapid();
  const hdr = vapidHeader(v, 'https://push.example.net/send/abc', 'mailto:a@b.co', 1_700_000_000_000);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(hdr);
  assert.ok(m, hdr);
  const claims = JSON.parse(unb64u(m[2]).toString());
  assert.equal(claims.aud, 'https://push.example.net');
  assert.equal(claims.exp, 1_700_000_000 + 12 * 3600);
  assert.equal(unb64u(m[3]).length, 64);
  assert.equal(unb64u(m[4]).length, 65);
});

// ---- SSRF guard ----

test('netguard: private and loopback addresses are refused, public https passes', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  const pub = async () => [{ address: '93.184.216.34' }];
  await assertPublicUrl('https://ntfy.sh/x', { lookup: pub });
  await assert.rejects(assertPublicUrl('http://ntfy.sh/x', { lookup: pub }), /https/);
  await assert.rejects(assertPublicUrl('https://localhost/x', { lookup: async () => [{ address: '127.0.0.1' }] }), /private/);
  await assert.rejects(assertPublicUrl('https://user:pw@ntfy.sh/', { lookup: pub }), /login/);
  await assert.rejects(assertPublicUrl('https://169.254.169.254/latest', {}), /private/);
});

// ---- The relay end to end, with a fake clock and a fake outbound fetch ----

const SECRET = 'a'.repeat(40);
const ID = 'device-0123456789abcdef';

async function setup(extraEnv = {}) {
  let t = Date.UTC(2026, 5, 1, 9, 0, 0);
  /** @type {Array<{ url: string, init: any }>} */
  const outbound = [];
  const app = createApp({
    db: createDb(null),
    env: { RELAY_ALLOWED_ORIGINS: '*', ...extraEnv },
    vapid: generateVapid(),
    now: () => t,
    lookup: async () => [{ address: '93.184.216.34' }],
    fetch: async (url, init) => {
      outbound.push({ url: String(url), init });
      return new Response('ok', { status: 200 });
    },
  });
  const server = createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, secret = SECRET) =>
    fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return {
    app, outbound, call,
    advance: (ms) => { t += ms; },
    now: () => t,
    close: () => new Promise((r) => server.close(r)),
  };
}

test('relay: sends a due reminder once, even after the client re-syncs', async () => {
  const r = await setup();
  try {
    const reminders = [
      { key: 'e1:60', at: r.now() + 60_000, title: 'Hack Night', body: 'Starts in 1 hour' },
      { key: 'e2:60', at: r.now() + 2 * 3600_000, title: 'Later', body: 'Later body' },
    ];
    const put = await r.call('PUT', `/v1/devices/${ID}`, { channels: { ntfy: { topic: 'my-showup-topic' } }, reminders });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { ok: true, reminders: 2, channels: ['ntfy'] });

    assert.equal((await r.app.tick()).sent, 0, 'nothing is due yet');
    r.advance(61_000);
    assert.equal((await r.app.tick()).sent, 1);
    assert.equal(r.outbound.length, 1);
    assert.equal(r.outbound[0].url, 'https://ntfy.sh');
    const sent = JSON.parse(r.outbound[0].init.body);
    assert.equal(sent.topic, 'my-showup-topic');
    assert.equal(sent.title, 'Hack Night');
    assert.equal(sent.message, 'Starts in 1 hour');

    assert.equal((await r.app.tick()).sent, 0, 'not sent twice');
    // The app syncs again with the same list: the already-sent reminder must not repeat.
    await r.call('PUT', `/v1/devices/${ID}`, { channels: { ntfy: { topic: 'my-showup-topic' } }, reminders });
    assert.equal((await r.app.tick()).sent, 0);
    r.advance(2 * 3600_000);
    assert.equal((await r.app.tick()).sent, 1);
    assert.equal(JSON.parse(r.outbound[1].init.body).title, 'Later');
  } finally {
    await r.close();
  }
});

test('relay: a reminder that is hours late is skipped rather than sent as stale news', async () => {
  const r = await setup();
  try {
    await r.call('PUT', `/v1/devices/${ID}`, { channels: { webhook: { url: 'https://hooks.example.com/x' } }, reminders: [{ key: 'old', at: r.now() + 1000, title: 'Old', body: '' }] });
    r.advance(7 * 3600_000);
    assert.equal((await r.app.tick()).sent, 0);
    assert.equal(r.outbound.length, 0);
  } finally {
    await r.close();
  }
});

test('relay: authentication, validation and limits', async () => {
  const r = await setup({ RELAY_RATE_PER_MIN: '40' });
  try {
    const ok = { channels: { ntfy: { topic: 'abcdef' } }, reminders: [] };
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, ok, null)).status, 401, 'no secret');
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, ok, 'short')).status, 401, 'weak secret');
    assert.equal((await r.call('PUT', '/v1/devices/bad', ok)).status, 400, 'bad id');
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, ok)).status, 200);
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, ok, 'b'.repeat(40))).status, 403, 'another secret cannot take over');
    assert.equal((await r.call('POST', `/v1/devices/${ID}/test`, undefined, 'b'.repeat(40))).status, 403);
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, { channels: { webhook: { url: 'http://insecure.example.com' } }, reminders: [] })).status, 400);
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, { channels: { email: { to: 'a@b.co' } }, reminders: [] })).status, 400, 'email disabled without an API key');
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, { channels: { telegram: { botToken: 'nope', chatId: '1' } }, reminders: [] })).status, 400);
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, 'not json')).status, 400);
    assert.equal((await r.call('PUT', `/v1/devices/${ID}`, { ...ok, pad: 'x'.repeat(300_000) })).status, 413);
    assert.equal((await r.call('GET', '/nope')).status, 404);
    assert.equal((await r.call('GET', '/healthz', undefined, null)).status, 200);
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await r.call('GET', '/healthz', undefined, null)).status === 429) limited++;
    assert.ok(limited > 0, 'rate limit kicks in');
  } finally {
    await r.close();
  }
});

test('relay: webhook to a private address is refused at send time', async () => {
  let t = Date.UTC(2026, 5, 1);
  const outbound = [];
  const app = createApp({
    db: createDb(null), env: {}, vapid: generateVapid(), now: () => t,
    lookup: async () => [{ address: '10.0.0.5' }],
    fetch: async (u) => { outbound.push(u); return new Response('ok'); },
  });
  const server = createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${base}/v1/devices/${ID}`, { method: 'PUT', headers: { Authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ channels: { webhook: { url: 'https://internal.example.com/hook' } }, reminders: [{ key: 'k', at: t + 1000, title: 't', body: 'b' }] }) });
    t += 2000;
    await app.tick();
    assert.equal(outbound.length, 0);
    const test = await (await fetch(`${base}/v1/devices/${ID}/test`, { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` } })).json();
    assert.equal(test.ok, false);
    assert.match(test.results.webhook.detail, /private/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('relay: web push delivers an encrypted message the browser can decrypt, and drops dead subscriptions', async () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const authSecret = Buffer.from('0123456789abcdef');
  const sub = { endpoint: 'https://push.example.net/s/xyz', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(authSecret) } };
  const vapid = generateVapid();
  let status = 201;
  /** @type {any[]} */
  const calls = [];
  let t = Date.UTC(2026, 5, 1);
  const db = createDb(null);
  const app = createApp({
    db, env: {}, vapid, now: () => t,
    lookup: async () => [{ address: '93.184.216.34' }],
    fetch: async (url, init) => { calls.push({ url, init }); return new Response('', { status }); },
  });
  const server = createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const put = (id, reminders) => fetch(`${base}/v1/devices/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ channels: { push: { subscription: sub } }, reminders }) });
    assert.equal((await put(ID, [{ key: 'k1', at: t + 1000, title: 'Deadline tomorrow', body: 'Scholarship' }])).status, 200);
    t += 2000;
    await app.tick();
    assert.equal(calls.length, 1);
    const { init } = calls[0];
    assert.match(init.headers.Authorization, /^vapid t=.+, k=.+$/);
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm');

    // Decrypt like a browser would (RFC 8291 section 3.4).
    const body = Buffer.from(init.body);
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const ct = body.subarray(21 + idlen);
    const shared = ua.computeSecret(asPublic);
    const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2);
    assert.deepEqual(JSON.parse(plain.subarray(0, plain.length - 1).toString()), { title: 'Deadline tomorrow', body: 'Scholarship', tag: 'k1' });

    // A 410 from the push service removes the subscription so it is not retried forever.
    status = 410;
    await put(ID, [{ key: 'k2', at: t + 1000, title: 'Again', body: '' }]);
    t += 2000;
    await app.tick();
    assert.equal(calls.length, 2);
    assert.equal(db.get(ID).channels.push, undefined, 'the dead subscription is dropped');
    t += 2000;
    await put(ID, [{ key: 'k3', at: t + 1000, title: 'Third', body: '' }]); // a re-sync re-adds whatever the client holds
    t += 2000;
    await app.tick();
    assert.equal(calls.length, 3);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
