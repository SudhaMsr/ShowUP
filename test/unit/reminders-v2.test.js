import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../../src/domain/event.js';
import {
  DEFAULT_REMINDER_SETTINGS, describeOffset, dueFollowUps, followUpAt, nextWakeAt, parseOffsetInput,
} from '../../src/domain/reminders.js';
import { MemoryRepository } from '../../src/storage/repository.js';
import { createStore } from '../../src/app/store.js';
import { createReminderEngine } from '../../src/app/reminder-engine.js';

const at = (d, hh = 0, mm = 0, ss = 0) => new Date(2026, 10, d, hh, mm, ss);
const ev = (o = {}) => normalizeEvent({ title: 'Meetup', date: '2026-11-05', time: '18:00', ...o }, { id: o.id ?? 'e1', now: at(1) });

test('defaults remind 1 hour and 1 minute before', () => {
  assert.deepEqual(DEFAULT_REMINDER_SETTINGS.reminderOffsets, [60, 1]);
});

test('describeOffset: singular, plural and mixed units', () => {
  assert.equal(describeOffset(1), '1 minute before');
  assert.equal(describeOffset(2), '2 minutes before');
  assert.equal(describeOffset(60), '1 hour before');
  assert.equal(describeOffset(90), '1 hour 30 minutes before');
  assert.equal(describeOffset(1440), '1 day before');
  assert.equal(describeOffset(1500), '1 day 1 hour before');
  assert.equal(describeOffset(0), 'at start time');
});

test('parseOffsetInput accepts sane custom values and rejects the rest', () => {
  assert.equal(parseOffsetInput('90', 'minutes'), 90);
  assert.equal(parseOffsetInput('2', 'hours'), 120);
  assert.equal(parseOffsetInput(3, 'days'), 4320);
  assert.equal(parseOffsetInput('30', 'days'), 43200);
  assert.equal(parseOffsetInput('0', 'minutes'), 0);
  for (const [v, u] of [['31', 'days'], ['', 'minutes'], ['-5', 'minutes'], ['1.5', 'hours'], ['abc', 'minutes'], ['5', 'weeks'], ['1e3', 'minutes'], [null, 'minutes'], ['9999999', 'minutes']]) {
    assert.equal(parseOffsetInput(v, u), null, `${v} ${u}`);
  }
});

test('followUpAt: end time, start+90min, or 8pm for all-day', () => {
  assert.deepEqual(followUpAt(ev({ endTime: '20:00' })), at(5, 20, 0));
  assert.deepEqual(followUpAt(ev()), at(5, 19, 30));
  assert.deepEqual(followUpAt(ev({ time: null })), at(5, 20, 0));
  assert.deepEqual(followUpAt(ev({ time: '23:30' })), at(6, 1, 0), 'rolls past midnight');
});

test('dueFollowUps: only upcoming events whose time falls in the window', () => {
  const list = [ev(), ev({ id: 'x', status: 'attended' }), ev({ id: 'y', status: 'cancelled' })];
  assert.equal(dueFollowUps(list, at(5, 19, 29), at(5, 19, 31)).length, 1);
  assert.equal(dueFollowUps(list, at(5, 19, 30), at(5, 19, 31)).length, 0, 'exclusive start');
  assert.equal(dueFollowUps(list, at(5, 18), at(5, 19, 29)).length, 0);
});

test('nextWakeAt finds the earliest upcoming reminder or follow-up', () => {
  const now = at(5, 12);
  assert.deepEqual(nextWakeAt([ev()], DEFAULT_REMINDER_SETTINGS, now), at(5, 17, 0));
  assert.deepEqual(nextWakeAt([ev()], DEFAULT_REMINDER_SETTINGS, at(5, 17, 30)), at(5, 17, 59));
  assert.deepEqual(nextWakeAt([ev()], DEFAULT_REMINDER_SETTINGS, at(5, 18, 30)), at(5, 19, 30));
  assert.equal(nextWakeAt([ev()], DEFAULT_REMINDER_SETTINGS, at(5, 20)), null);
  assert.equal(nextWakeAt([ev({ status: 'cancelled' })], DEFAULT_REMINDER_SETTINGS, now), null);
});

/** Build a store + engine with a movable clock and a recording notifier. */
async function rig(repo = new MemoryRepository()) {
  const clock = { t: at(5, 16, 59, 30) };
  const log = { live: [], missed: [], followUp: [] };
  const store = createStore(repo, { now: () => clock.t });
  await store.init();
  const engine = createReminderEngine(
    store,
    { live: (r) => void log.live.push(r.offset), missed: (l) => void log.missed.push(l.map((r) => r.offset)), followUp: (l) => void log.followUp.push(l.map((f) => f.event.id)) },
    { now: () => clock.t },
  );
  return { clock, log, store, engine, repo };
}

test('engine: a full event timeline fires 1h, 1min, then the outcome question, each once', async () => {
  const { clock, log, store, engine } = await rig();
  await store.save({ id: 'e1', title: 'Meetup', date: '2026-11-05', time: '18:00' });
  await engine.tick();
  assert.deepEqual(log.live, []);

  clock.t = at(5, 17, 0, 10);
  const r1 = await engine.tick();
  assert.deepEqual(log.live, [60]);
  assert.deepEqual(r1.nextAt, at(5, 17, 59));

  clock.t = at(5, 17, 0, 40);
  await engine.tick();
  assert.deepEqual(log.live, [60], 'not repeated');

  clock.t = at(5, 17, 59, 20);
  await engine.tick();
  assert.deepEqual(log.live, [60, 1]);

  clock.t = at(5, 19, 30, 30);
  const r2 = await engine.tick();
  assert.deepEqual(log.followUp, [['e1']]);
  assert.equal(r2.nextAt, null, 'nothing left to wake for');

  clock.t = at(5, 19, 45);
  await engine.tick();
  assert.equal(log.followUp.length, 1, 'asked only once');

  // once answered, it is never asked again, even after a restart-like reset
  await store.setStatus('e1', 'attended');
  assert.equal(store.getState().events[0].status, 'attended');
});

test('engine: a closed app catches up on reminders and the outcome question', async () => {
  const repo = new MemoryRepository();
  const first = await rig(repo);
  await first.store.save({ id: 'e1', title: 'Meetup', date: '2026-11-05', time: '18:00' });
  await first.repo.setMeta('lastTickAt', at(5, 9).getTime());

  const { clock, log, engine } = await rig(repo);
  clock.t = at(5, 21);
  await engine.tick();
  assert.deepEqual(log.live, []);
  assert.deepEqual(log.missed, [[60, 1]], 'both reminders reported as missed while away');
  assert.deepEqual(log.followUp, [['e1']]);
});

test('engine: does not nag about events that ended more than 48 hours ago', async () => {
  const repo = new MemoryRepository();
  const first = await rig(repo);
  await first.store.save({ id: 'old', title: 'Old', date: '2026-11-05', time: '18:00' });
  await first.repo.setMeta('lastTickAt', at(1).getTime());
  const { clock, log, engine } = await rig(repo);
  clock.t = at(8, 12);
  await engine.tick();
  assert.deepEqual(log.followUp, []);
});

test('engine: events that are not upcoming never trigger anything', async () => {
  const { clock, log, store, engine } = await rig();
  await store.save({ id: 'c', title: 'Called off', date: '2026-11-05', time: '18:00', status: 'cancelled' });
  await engine.tick();
  clock.t = at(5, 20);
  await engine.tick();
  assert.deepEqual([log.live, log.missed, log.followUp], [[], [], []]);
});

test('engine: custom per-event reminders are honoured', async () => {
  const { clock, log, store, engine } = await rig();
  clock.t = at(5, 16, 0);
  await store.save({ id: 'k', title: 'Custom', date: '2026-11-05', time: '18:00', reminders: [90, 5] });
  await engine.tick();
  clock.t = at(5, 16, 30, 10);
  await engine.tick();
  clock.t = at(5, 17, 55, 10);
  await engine.tick();
  assert.deepEqual(log.live, [90, 5]);
});
