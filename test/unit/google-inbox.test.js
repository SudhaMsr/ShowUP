import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogle, GoogleError } from '../../src/app/google.js';
import { createInbox } from '../../src/app/inbox.js';
import { createStore } from '../../src/app/store.js';
import { MemoryRepository } from '../../src/storage/repository.js';

const NOW = new Date(2026, 10, 1, 12, 0);
const b64 = (s) => Buffer.from(s).toString('base64url');
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** A fake Google sign-in script. */
function fakeGis({ fail = null, token = 'tok-1', expires = 3600 } = {}) {
  const calls = [];
  return {
    calls,
    google: {
      accounts: { oauth2: {
        initTokenClient: (cfg) => ({ requestAccessToken: (o) => { calls.push({ scope: cfg.scope, prompt: o.prompt }); fail ? cfg.error_callback({ type: 'popup_closed' }) : cfg.callback({ access_token: token, expires_in: expires }); } }),
        revoke: (t, cb) => { calls.push({ revoked: t }); cb(); },
      } },
    },
  };
}

const CAL = { items: [
  { id: 'e1', summary: 'AWS Summit conference', start: { dateTime: '2026-11-20T09:00:00Z' }, end: { dateTime: '2026-11-20T17:00:00Z' }, location: 'ExCeL' },
  { id: 'e2', status: 'cancelled', summary: 'Gone', start: { date: '2026-11-21' } },
] };
const MAILS = {
  messages: [{ id: 'm1' }, { id: 'm2' }],
  m1: { payload: { headers: [{ name: 'Subject', value: 'You are registered: Founders meetup' }, { name: 'From', value: 'Luma <hi@lu.ma>' }], mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('When: 25 Nov 2026 at 6pm\nWhere: Science Park') } }] } },
  m2: { payload: { headers: [{ name: 'Subject', value: 'Your invoice' }], mimeType: 'text/plain', body: { data: b64('Due 30 Nov 2026 at 5pm') } } },
};

function router({ cal = CAL, mails = MAILS, calStatus = 200, seen = [] } = {}) {
  return async (url, init) => {
    seen.push({ url, auth: init?.headers?.Authorization });
    if (url.includes('/calendar/v3/')) return json(cal, calStatus);
    if (/\/messages\?/.test(url)) return json({ messages: mails.messages });
    const id = /messages\/([^?]+)/.exec(url)?.[1];
    return json(mails[id]);
  };
}

test('connect asks for calendar scope only, or calendar + gmail when chosen', async () => {
  const gis = fakeGis();
  const g = createGoogle({ loadScript: async () => gis.google, now: () => NOW });
  await g.connect('cid', false);
  await g.connect('cid', true);
  assert.equal(gis.calls[0].scope, 'https://www.googleapis.com/auth/calendar.readonly');
  assert.match(gis.calls[1].scope, /calendar\.readonly .*gmail\.readonly/);
  assert.equal(gis.calls[0].prompt, 'consent');
  assert.equal(g.hasToken(), true);
});

test('closing the Google window is a friendly error; silent renew reports false instead of throwing', async () => {
  const g = createGoogle({ loadScript: async () => fakeGis({ fail: true }).google, now: () => NOW });
  await assert.rejects(() => g.connect('cid', false), /window was closed/);
  assert.equal(await g.renew('cid', false), false);
});

test('sync reads calendar and gmail, sending the bearer token, and skips non-events', async () => {
  const seen = [];
  const g = createGoogle({ loadScript: async () => fakeGis().google, fetchImpl: router({ seen }), now: () => NOW });
  await g.connect('cid', true);
  const { found, errors } = await g.sync({ gmail: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(found.map((s) => [s.source, s.draft.title, s.draft.date]), [
    ['calendar', 'AWS Summit conference', '2026-11-20'],
    ['email', 'Founders meetup', '2026-11-25'],
  ]);
  assert.ok(seen.every((r) => r.auth === 'Bearer tok-1'));
  assert.ok(seen.every((r) => r.url.startsWith('https://www.googleapis.com/')), 'only Google is contacted');
  const email = found[1];
  assert.deepEqual([email.draft.time, email.draft.location], ['18:00', 'Science Park']);
});

test('gmail is not touched unless asked', async () => {
  const seen = [];
  const g = createGoogle({ loadScript: async () => fakeGis().google, fetchImpl: router({ seen }), now: () => NOW });
  await g.connect('cid', false);
  await g.sync({ gmail: false });
  assert.ok(seen.every((r) => !r.url.includes('/gmail/')));
});

test('expired or rejected tokens ask to reconnect; disabled API and rate limits are explained', async () => {
  let t = NOW.getTime();
  const g = createGoogle({ loadScript: async () => fakeGis({ expires: 3600 }).google, fetchImpl: router(), now: () => new Date(t) });
  await assert.rejects(() => g.sync({ gmail: false }), (e) => e instanceof GoogleError && e.kind === 'auth', 'no token yet');
  await g.connect('cid', false);
  t += 2 * 3600_000;
  await assert.rejects(() => g.sync({ gmail: false }), /expired/);

  const g401 = createGoogle({ loadScript: async () => fakeGis().google, fetchImpl: async () => json({}, 401), now: () => NOW });
  await g401.connect('cid', false);
  await assert.rejects(() => g401.sync({ gmail: false }), /expired/);
  assert.equal(g401.hasToken(), false);

  const gDis = createGoogle({ loadScript: async () => fakeGis().google, fetchImpl: async () => json({ error: { message: 'Google Calendar API has not been used in project 1 before or it is disabled.' } }, 403), now: () => NOW });
  await gDis.connect('cid', false);
  assert.match((await gDis.sync({ gmail: false })).errors[0], /not switched on/);

  const gRate = createGoogle({ loadScript: async () => fakeGis().google, fetchImpl: async () => json({}, 429), now: () => NOW });
  await gRate.connect('cid', true);
  const r = await gRate.sync({ gmail: true });
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /rate-limiting/);
});

test('disconnect revokes the token at Google and forgets it', async () => {
  const gis = fakeGis();
  const g = createGoogle({ loadScript: async () => gis.google, now: () => NOW });
  await g.connect('cid', false);
  await g.disconnect();
  assert.ok(gis.calls.some((c) => c.revoked === 'tok-1'));
  assert.equal(g.hasToken(), false);
});

test('inbox: add, de-duplicate, approve into real events, dismiss for good', async () => {
  const repo = new MemoryRepository();
  const store = createStore(repo);
  await store.init();
  const inbox = createInbox(repo);
  await inbox.init();
  const mk = (id, title, date = '2026-11-12') => ({ id, source: 'calendar', label: 'Google Calendar', ref: id, foundAt: NOW.toISOString(), draft: { title, type: 'meetup', date, time: '18:00', endTime: null, location: '', organizer: '', url: '', notes: '', source: 'calendar', needsReview: false } });
  let changes = 0;
  inbox.subscribe(() => changes++);

  assert.equal((await inbox.add([mk('a', 'One'), mk('b', 'Two'), mk('c', 'Three', '2026-11-13')], store.getState().events)).length, 3);
  assert.equal((await inbox.add([mk('a', 'One')], [])).length, 0, 'already waiting');
  assert.equal(inbox.count(), 3);

  assert.equal(await inbox.approve('a', store), true);
  assert.equal(store.getState().events.length, 1);
  assert.deepEqual([store.getState().events[0].title, store.getState().events[0].source, store.getState().events[0].status], ['One', 'calendar', 'upcoming']);
  assert.equal(inbox.count(), 2);

  await inbox.dismiss('b');
  assert.equal((await inbox.add([mk('b', 'Two')], store.getState().events)).length, 0, 'dismissed items never come back');
  assert.equal((await inbox.add([mk('a2', 'One')], store.getState().events)).length, 0, 'already an event');

  assert.equal(await inbox.approveAll(store), 1);
  assert.equal(store.getState().events.length, 2);
  assert.equal(inbox.count(), 0);
  assert.ok(changes >= 4);

  // survives a restart
  const again = createInbox(repo);
  await again.init();
  assert.equal(again.count(), 0);
  assert.equal((await again.add([mk('b', 'Two')], [])).length, 0, 'dismissals persisted');
});
