import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, validate } from '../../src/domain/event.js';
import {
  APPLIED_STAGES, appendStageLog, defaultStage, deadlineOf, effectiveStatus, fieldsFor, hasPipeline, isOpen, nextStage,
  normalizeStage, opportunityStats, organizerLabel, pipelineFor, sanitizeDetails, sanitizeLinks, sanitizeStageLog, sanitizeTasks,
  stageLabel, templateTasks,
} from '../../src/domain/opportunity.js';
import { buildAgenda, dueReminders, DEFAULT_REMINDER_SETTINGS, nextWakeAt } from '../../src/domain/reminders.js';
import { overall } from '../../src/domain/stats.js';
import { MemoryRepository } from '../../src/storage/repository.js';
import { createStore } from '../../src/app/store.js';
import { buildRelayPayload } from '../../src/domain/relay-payload.js';
import { createRelay, normalizeRelayUrl } from '../../src/app/relay.js';
import { toEventsCSV } from '../../src/io/backup.js';
import { parseCapture } from '../../src/domain/capture.js';

const at = (m, d, hh = 0, mm = 0) => new Date(2026, m - 1, d, hh, mm, 0);
const NOW = at(11, 1, 8);
const ev = (o = {}) => normalizeEvent({ title: 'Thing', date: '2026-11-20', ...o }, { id: o.id ?? 'e1', now: NOW });

// ---- Pipelines and stage rules ----

test('types with pipelines get a valid default stage; plain events get none', () => {
  assert.equal(ev({ type: 'internship' }).stage, 'found');
  assert.equal(ev({ type: 'scholarship' }).stage, 'found');
  assert.equal(ev({ type: 'hackathon' }).stage, 'registered');
  assert.equal(ev({ type: 'meetup' }).stage, null);
  assert.equal(ev({ type: 'meetup', stage: 'submitted' }).stage, null, 'a stage on a plain event is dropped');
});

test('an invalid stage falls back to the default; a type change re-validates the stage', () => {
  assert.equal(normalizeStage('internship', 'registered'), 'found', 'internships have no "registered" step');
  assert.equal(normalizeStage('hackathon', 'registered'), 'registered');
  assert.equal(normalizeStage('hackathon', 'bogus'), 'registered');
  assert.equal(normalizeStage('internship', 5), 'found');
});

test('stage labels are specific to the type', () => {
  assert.equal(stageLabel('internship', 'won'), 'Offer');
  assert.equal(stageLabel('scholarship', 'won'), 'Awarded');
  assert.equal(stageLabel('hackathon', 'working'), 'Building');
  assert.equal(stageLabel('internship', null), '');
});

test('nextStage walks the path and stops at the end and on side exits', () => {
  assert.equal(nextStage('internship', 'found'), 'working');
  assert.equal(nextStage('internship', 'submitted'), 'interview');
  assert.equal(nextStage('internship', 'won'), null);
  assert.equal(nextStage('internship', 'lost'), null);
  assert.equal(nextStage('hackathon', 'registered'), 'working');
  assert.equal(nextStage('meetup', null), null);
  assert.deepEqual(pipelineFor('scholarship').map((s) => s.id), ['found', 'working', 'submitted', 'interview', 'won', 'lost', 'closed']);
  assert.deepEqual(pipelineFor('meetup'), []);
  assert.ok(hasPipeline('fellowship') && !hasPipeline('webinar'));
});

test('effectiveStatus: submitted applications count as attended, dropped ones as cancelled, plain events unchanged', () => {
  assert.equal(effectiveStatus(ev({ type: 'internship', stage: 'found' })), 'upcoming');
  assert.equal(effectiveStatus(ev({ type: 'internship', stage: 'submitted' })), 'attended');
  assert.equal(effectiveStatus(ev({ type: 'internship', stage: 'interview' })), 'attended');
  assert.equal(effectiveStatus(ev({ type: 'internship', stage: 'lost' })), 'attended', 'you did apply');
  assert.equal(effectiveStatus(ev({ type: 'internship', stage: 'closed' })), 'cancelled');
  assert.equal(effectiveStatus(ev({ type: 'internship', stage: 'working', status: 'missed' })), 'missed');
  assert.equal(effectiveStatus(ev({ type: 'meetup', status: 'attended' })), 'attended');
  // Competitions keep attendance in `status`; submitting does not mean you attended.
  assert.equal(effectiveStatus(ev({ type: 'hackathon', stage: 'submitted' })), 'upcoming');
  assert.equal(effectiveStatus(ev({ type: 'hackathon', stage: 'closed' })), 'cancelled');
  assert.ok(isOpen(ev({ type: 'hackathon', stage: 'working' })));
  assert.ok(APPLIED_STAGES.includes('interview'));
});

test('stage log: appends, ignores repeats, caps its length, survives sanitising', () => {
  let log = [];
  log = appendStageLog(log, 'found', '2026-11-01T08:00:00.000Z');
  log = appendStageLog(log, 'found', '2026-11-01T09:00:00.000Z');
  log = appendStageLog(log, 'working', '2026-11-02T09:00:00.000Z');
  assert.deepEqual(log.map((l) => l.stage), ['found', 'working']);
  for (let i = 0; i < 60; i++) log = appendStageLog(log, i % 2 ? 'working' : 'submitted', `2026-12-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`);
  assert.ok(log.length <= 30);
  assert.deepEqual(sanitizeStageLog([{ stage: 'nope', at: '2026-01-01T00:00:00Z' }, { stage: 'found', at: 'garbage' }, { stage: 'found', at: '2026-01-01T00:00:00Z' }, 7, null], 'internship').length, 1);
});

// ---- Deadlines ----

test('deadlineOf: the date for applications, the optional deadline for competitions, nothing for plain events', () => {
  assert.equal(deadlineOf(ev({ type: 'internship', date: '2026-12-01' })), '2026-12-01');
  assert.equal(deadlineOf(ev({ type: 'hackathon', date: '2026-12-10', deadline: '2026-12-01' })), '2026-12-01');
  assert.equal(deadlineOf(ev({ type: 'hackathon', date: '2026-12-10' })), null);
  assert.equal(deadlineOf(ev({ type: 'meetup', deadline: '2026-12-01' })), null);
  assert.equal(ev({ type: 'meetup', deadline: '2026-12-01' }).deadline, null);
  assert.equal(validate({ ...ev({ type: 'hackathon' }), deadline: '2026-13-45' }).ok, false);
});

test('deadline reminders: 3 days and 1 day for applications, plus the morning of for competitions; none once submitted', () => {
  const settings = { reminderOffsets: [], allDayReminderHour: 9 };
  const app = ev({ type: 'scholarship', date: '2026-11-20', stage: 'working', reminders: null });
  const keys = (list) => list.map((r) => r.key);
  const due = dueReminders([app], settings, at(11, 1), at(11, 30));
  assert.deepEqual(keys(due), ['e1:dl3', 'e1:dl1']);
  assert.deepEqual(due.map((r) => r.at), [at(11, 17, 9), at(11, 19, 9)]);
  assert.ok(due.every((r) => r.kind === 'deadline'));

  const hack = ev({ type: 'hackathon', date: '2026-12-10', deadline: '2026-11-20', stage: 'registered', reminders: null });
  assert.deepEqual(keys(dueReminders([hack], settings, at(11, 1), at(11, 30))), ['e1:dl3', 'e1:dl1', 'e1:dl0']);

  assert.deepEqual(dueReminders([{ ...app, stage: 'submitted' }], settings, at(11, 1), at(11, 30)), [], 'submitted: stop nagging');
  assert.deepEqual(dueReminders([{ ...app, stage: 'closed' }], settings, at(11, 1), at(11, 30)), []);
  assert.deepEqual(dueReminders([{ ...app, reminders: [] }], settings, at(11, 1), at(11, 30)), [], 'no reminders means none');
});

test('start reminders still behave for a competition whose deadline reminder is due', () => {
  const hack = ev({ type: 'hackathon', date: '2026-11-20', time: '10:00', deadline: '2026-11-10', stage: 'registered' });
  const due = dueReminders([hack], DEFAULT_REMINDER_SETTINGS, at(11, 9), at(11, 10, 23));
  assert.deepEqual(due.map((r) => r.key), ['e1:dl1', 'e1:dl0']);
  assert.ok(due.every((r) => r.kind === 'deadline'));
  // The usual 1-hour and 1-minute start reminders are still scheduled for the event itself.
  const startDue = dueReminders([hack], DEFAULT_REMINDER_SETTINGS, at(11, 20, 8), at(11, 20, 10));
  assert.deepEqual(startDue.map((r) => r.kind), ['start', 'start']);
});

test('nextWakeAt and agenda ignore closed opportunities', () => {
  const closed = ev({ type: 'internship', date: '2026-11-20', stage: 'closed' });
  const open = ev({ id: 'e2', type: 'internship', date: '2026-11-21', stage: 'working' });
  assert.equal(nextWakeAt([closed], DEFAULT_REMINDER_SETTINGS, NOW), null);
  const agenda = buildAgenda([closed, open], at(11, 20, 8));
  assert.equal(agenda.tomorrow.length, 1);
  assert.equal(agenda.tomorrow[0].id, 'e2');
  const hack = ev({ id: 'h', type: 'hackathon', date: '2026-12-10', deadline: '2026-11-23', stage: 'working' });
  assert.deepEqual(buildAgenda([hack], at(11, 20, 8)).deadlines.map((e) => e.id), ['h']);
});

// ---- Typed fields, tasks, links ----

test('typed details: only fields the type defines, trimmed, select fields limited to their options', () => {
  assert.deepEqual(sanitizeDetails('internship', { role: '  SWE intern ', pay: '£2k', mode: 'Remote', junk: 'x', prize: 'no' }), { role: 'SWE intern', pay: '£2k', mode: 'Remote' });
  assert.deepEqual(sanitizeDetails('internship', { mode: 'Underwater' }), {});
  assert.deepEqual(sanitizeDetails('scholarship', { essay: 'Yes', amount: 'x'.repeat(500) }).amount.length, 120);
  assert.deepEqual(sanitizeDetails('meetup', { role: 'x' }), {});
  assert.deepEqual(sanitizeDetails('internship', 'oops'), {});
  assert.ok(fieldsFor('hackathon').some((f) => f.key === 'prize'));
  assert.equal(organizerLabel('internship'), 'Company');
});

test('changing a type drops details that no longer apply', () => {
  const e = ev({ type: 'internship', details: { role: 'Intern' } });
  assert.equal(e.details.role, 'Intern');
  assert.deepEqual(normalizeEvent({ ...e, type: 'scholarship' }, { now: NOW }).details, {});
});

test('tasks and links are sanitised and capped', () => {
  assert.deepEqual(sanitizeTasks([{ text: '  Write   essay ', done: true }, { text: '' }, { text: 'x', done: 'yes' }, null, 'str']), [{ text: 'Write essay', done: true }, { text: 'x', done: false }]);
  assert.equal(sanitizeTasks(Array.from({ length: 50 }, (_, i) => ({ text: `t${i}` }))).length, 20);
  assert.deepEqual(sanitizeLinks([{ label: 'Rules', url: 'https://a.example/rules' }, { label: 'Bad', url: 'javascript:alert(1)' }, { url: 'ftp://x' }, { url: 'not a url' }, { url: 'http://ok.example' }]).map((l) => l.url), ['https://a.example/rules', 'http://ok.example']);
  assert.equal(sanitizeLinks(Array.from({ length: 30 }, () => ({ url: 'https://x.example' }))).length, 10);
  assert.deepEqual(templateTasks('internship')[0], { text: 'Check eligibility and requirements', done: false });
  assert.deepEqual(templateTasks('meetup'), []);
});

test('old events (saved before opportunities existed) load with sensible defaults', () => {
  const old = normalizeEvent({ id: 'x', title: 'Old', date: '2026-01-01', type: 'hackathon', status: 'attended', createdAt: '2025-01-01T00:00:00.000Z' }, { now: NOW });
  assert.equal(old.stage, 'registered');
  assert.deepEqual([old.details, old.links, old.tasks, old.stageLog], [{}, [], [], []]);
  assert.equal(effectiveStatus(old), 'attended');
});

// ---- Store ----

async function newStore() {
  const clock = { t: new Date(2026, 10, 1, 8) };
  const store = createStore(new MemoryRepository(), { now: () => clock.t });
  await store.init();
  return { store, clock };
}

test('store: new pipeline items log their first stage and each later change', async () => {
  const { store, clock } = await newStore();
  const r = await store.save({ title: 'Google STEP', type: 'internship', date: '2026-11-20' });
  assert.ok(r.ok);
  assert.deepEqual(r.event.stageLog.map((l) => l.stage), ['found']);
  clock.t = new Date(2026, 10, 3, 8);
  await store.setStage(r.event.id, 'working');
  clock.t = new Date(2026, 10, 5, 8);
  await store.setStage(r.event.id, 'submitted');
  const e = store.getState().events[0];
  assert.deepEqual(e.stageLog.map((l) => l.stage), ['found', 'working', 'submitted']);
  assert.equal(effectiveStatus(e), 'attended');
  await store.save({ id: e.id, notes: 'edited' });
  assert.equal(store.getState().events[0].stageLog.length, 3, 'unrelated edits do not add log entries');
});

test('store.setStatus is application-aware', async () => {
  const { store } = await newStore();
  const a = (await store.save({ title: 'Scholarship', type: 'scholarship', date: '2026-11-20' })).event;
  await store.setStatus(a.id, 'attended');
  assert.equal(store.getState().events[0].stage, 'submitted');
  await store.setStatus(a.id, 'cancelled');
  assert.equal(store.getState().events[0].stage, 'closed');
  assert.equal(effectiveStatus(store.getState().events[0]), 'cancelled');
  await store.setStatus(a.id, 'upcoming');
  assert.equal(store.getState().events[0].stage, 'found');
  assert.ok(isOpen(store.getState().events[0]));

  const m = (await store.save({ title: 'Meetup', type: 'meetup', date: '2026-11-20' })).event;
  await store.setStatus(m.id, 'attended');
  assert.equal(store.getState().events.find((e) => e.id === m.id).status, 'attended');
  assert.equal(store.getState().events.find((e) => e.id === m.id).stage, null);
});

test('store.setStage reopens a missed application and refuses stageless events', async () => {
  const { store } = await newStore();
  const a = (await store.save({ title: 'Fellowship', type: 'fellowship', date: '2026-11-02', status: 'missed' })).event;
  assert.equal(effectiveStatus(store.getState().events[0]), 'missed');
  await store.setStage(a.id, 'working');
  assert.ok(isOpen(store.getState().events[0]));
  const m = (await store.save({ title: 'Meetup', type: 'meetup', date: '2026-11-20' })).event;
  const res = await store.setStage(m.id, 'found');
  assert.equal(res.ok, false);
});

test('store.setTask ticks one item and rejects a stale index', async () => {
  const { store } = await newStore();
  const a = (await store.save({ title: 'Hack', type: 'hackathon', date: '2026-11-20', tasks: [{ text: 'A' }, { text: 'B' }] })).event;
  await store.setTask(a.id, 1, true);
  assert.deepEqual(store.getState().events[0].tasks.map((t) => t.done), [false, true]);
  assert.equal((await store.setTask(a.id, 9, true)).ok, false);
});

// ---- Stats ----

test('attendance stats count submitted applications as showing up', () => {
  const events = [
    ev({ id: 'a', type: 'internship', date: '2026-10-01', stage: 'submitted' }),
    ev({ id: 'b', type: 'internship', date: '2026-10-02', stage: 'working', status: 'missed' }),
    ev({ id: 'c', type: 'meetup', date: '2026-10-03', status: 'attended' }),
    ev({ id: 'd', type: 'internship', date: '2026-10-04', stage: 'closed' }),
  ];
  const o = overall(events, '2026-11-01');
  assert.deepEqual([o.attended, o.missed, o.cancelled], [2, 1, 1]);
});

test('opportunityStats: funnel, follow-through, win rate, due soon', () => {
  const events = [
    ev({ id: '1', type: 'internship', date: '2026-11-10', stage: 'found' }),
    ev({ id: '2', type: 'internship', date: '2026-11-05', stage: 'submitted' }),
    ev({ id: '3', type: 'scholarship', date: '2026-10-01', stage: 'won' }),
    ev({ id: '4', type: 'scholarship', date: '2026-10-02', stage: 'lost' }),
    ev({ id: '5', type: 'fellowship', date: '2026-10-15', stage: 'working', status: 'missed' }),
    ev({ id: '6', type: 'hackathon', date: '2026-12-01', deadline: '2026-11-28', stage: 'registered' }),
    ev({ id: '7', type: 'meetup', date: '2026-11-03' }),
    ev({ id: '8', type: 'internship', date: '2026-10-20', stage: 'working' }),
  ];
  const s = opportunityStats(events, '2026-11-01');
  assert.equal(s.total, 7, 'meetups are not opportunities');
  assert.equal(s.applied, 3);
  assert.equal(s.missed, 1);
  assert.equal(s.followThrough, 75);
  assert.equal(s.winRate, 50);
  assert.equal(s.toReview, 1, 'a past-deadline item still in progress');
  assert.deepEqual(s.dueSoon.map((d) => d.event.id), ['1', '6']);
  assert.equal(opportunityStats([], '2026-11-01').followThrough, null);
});

// ---- Capture / import / export ----

test('capture and import recognise the new types', () => {
  assert.equal(parseCapture('Google internship application closes Nov 20', { now: NOW }).type, 'internship');
  assert.equal(parseCapture('Chevening scholarship deadline 12 Dec', { now: NOW }).type, 'scholarship');
  assert.equal(parseCapture('Mozilla fellowship application due 5 Dec', { now: NOW }).type, 'fellowship');
});

test('csv export carries stage and deadline at the end', () => {
  const csv = toEventsCSV([ev({ type: 'hackathon', deadline: '2026-11-10', stage: 'working' })]);
  const [head, row] = csv.split(/\r?\n/);
  assert.ok(head.endsWith('Stage,Deadline'));
  assert.ok(row.endsWith('working,2026-11-10'));
});

// ---- Relay client ----

test('relay payload: future reminders only, with a readable body; hideTitles removes the title and details', () => {
  const events = [
    ev({ id: 'a', title: 'Hack Night', type: 'meetup', date: '2026-11-05', time: '18:00', location: 'Room 4', reminders: [60] }),
    ev({ id: 'b', title: 'Rhodes', type: 'scholarship', date: '2026-11-20', stage: 'working', reminders: [] , notes: 'secret essay idea' }),
    ev({ id: 'c', title: 'Old', type: 'meetup', date: '2026-10-01', time: '10:00' }),
  ];
  const settings = { reminderOffsets: [60], allDayReminderHour: 9 };
  const payload = buildRelayPayload(events, settings, NOW);
  assert.deepEqual(payload.map((p) => p.key), ['a:60']);
  assert.equal(payload[0].title, 'Hack Night');
  assert.match(payload[0].body, /6:00 pm · Room 4 \(1 hour before\)/);
  assert.equal(payload[0].at, at(11, 5, 17).getTime());
  const hidden = buildRelayPayload(events, settings, NOW, { hideTitles: true });
  assert.equal(hidden[0].title, 'ShowUp reminder');
  assert.ok(!JSON.stringify(hidden).includes('Hack Night') && !JSON.stringify(hidden).includes('Room 4'));
  const dl = buildRelayPayload([ev({ id: 'd', title: 'Rhodes', type: 'scholarship', date: '2026-11-20', stage: 'working', reminders: null })], settings, NOW);
  assert.ok(dl.some((p) => p.key === 'd:dl3' && /Deadline in 3 days · Preparing/.test(p.body)));
  assert.ok(!JSON.stringify(payload).includes('secret essay'));
});

test('relay url: https only (localhost may use http), no credentials or query', () => {
  assert.equal(normalizeRelayUrl('https://relay.example.org/'), 'https://relay.example.org');
  assert.equal(normalizeRelayUrl('http://localhost:8787'), 'http://localhost:8787');
  for (const bad of ['http://relay.example.org', 'ftp://x', 'https://u:p@x.org', 'https://x.org/?a=1', 'nope', '']) assert.equal(normalizeRelayUrl(bad), null, bad);
});

test('relay client: connect syncs once, unchanged state is not re-sent, disconnect deletes remotely', async () => {
  const { store } = await newStore();
  await store.save({ title: 'Hack Night', type: 'meetup', date: '2026-11-05', time: '18:00' });
  const repo = new MemoryRepository();
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, auth: init.headers?.Authorization });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const relay = createRelay({ repo, store, fetch: fetchFn, now: () => NOW });
  await assert.rejects(relay.connect({ url: 'http://evil.example', channels: { ntfy: { topic: 'abcdef' } }, hideTitles: false }), /https/);
  await assert.rejects(relay.connect({ url: 'https://relay.example.org', channels: {}, hideTitles: false }), /at least one/);
  const cfg = await relay.connect({ url: 'https://relay.example.org', channels: { ntfy: { topic: 'my-topic-123' } }, hideTitles: false });
  assert.equal(cfg.enabled, true);
  assert.ok(cfg.secret.length >= 32 && cfg.deviceId.length >= 16);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].auth, `Bearer ${cfg.secret}`);
  assert.equal(JSON.parse(calls[0].body).reminders.length, 2, 'default 1h and 1min reminders');
  await relay.sync();
  assert.equal(calls.length, 1, 'nothing changed, nothing sent');
  await relay.sync({ force: true });
  assert.equal(calls.length, 2);
  const out = await relay.disconnect();
  assert.equal(out.remoteGone, true);
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.equal((await relay.config()).enabled, false);
  assert.equal((await relay.config()).secret, '');
});

test('relay client: failures are recorded for Settings, not thrown from sync', async () => {
  const { store } = await newStore();
  const repo = new MemoryRepository();
  let mode = 'ok';
  const fetchFn = async () => {
    if (mode === 'down') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ error: 'Wrong device secret.' }), { status: 403 });
  };
  const relay = createRelay({ repo, store, fetch: async (...a) => (mode === 'ok' ? new Response('{}', { status: 200 }) : fetchFn(...a)), now: () => NOW });
  await relay.connect({ url: 'https://relay.example.org', channels: { webhook: { url: 'https://h.example/x' } }, hideTitles: true });
  mode = 'down';
  assert.equal((await relay.sync({ force: true })).ok, false);
  assert.match((await relay.config()).lastError, /Could not reach the relay/);
  mode = 'forbidden';
  await relay.sync({ force: true });
  assert.equal((await relay.config()).lastError, 'Wrong device secret.');
  mode = 'ok';
  await relay.sync({ force: true });
  assert.equal((await relay.config()).lastError, null);
});
