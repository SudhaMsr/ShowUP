import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsInWeek, overall, rate, weekStart, weeklyStats } from '../../src/domain/stats.js';

const ev = (date, status, type = 'meetup', time = '10:00') => ({ id: `${date}${status}${type}${time}`, date, status, type, time });

test('weeks run Monday to Sunday', () => {
  assert.equal(weekStart('2026-11-02'), '2026-11-02'); // Monday
  assert.equal(weekStart('2026-11-01'), '2026-10-26'); // Sunday belongs to the week before
  assert.equal(weekStart('2026-11-04'), '2026-11-02');
  assert.equal(weekStart('2026-03-01'), '2026-02-23');
});

test('rate ignores cancelled and handles nothing to judge', () => {
  assert.equal(rate(3, 1), 75);
  assert.equal(rate(0, 0), null);
  assert.equal(rate(0, 2), 0);
  assert.equal(rate(1, 2), 33);
});

test('weeklyStats buckets by status and week, oldest first', () => {
  const today = '2026-11-04'; // Wednesday
  const events = [
    ev('2026-11-02', 'attended'), ev('2026-11-03', 'missed'), ev('2026-11-03', 'upcoming'), ev('2026-11-06', 'upcoming'),
    ev('2026-10-27', 'attended'), ev('2026-10-28', 'attended'), ev('2026-10-29', 'cancelled'),
    ev('2026-08-01', 'attended'),
  ];
  const w = weeklyStats(events, today, 4);
  assert.equal(w.length, 4);
  assert.deepEqual(w.map((x) => x.start), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  const [, , last, cur] = w;
  assert.deepEqual([last.attended, last.cancelled, last.rate, last.total], [2, 1, 100, 3]);
  assert.deepEqual([cur.attended, cur.missed, cur.toReview, cur.upcoming, cur.rate, cur.total], [1, 1, 1, 1, 50, 4]);
  assert.ok(w.every((x) => x.start !== '2026-07-27'), 'older events fall outside the window');
});

test('overall: totals, streak stops at first miss, per-type rates', () => {
  const today = '2026-11-10';
  const events = [
    ev('2026-11-01', 'attended', 'hackathon'), ev('2026-11-02', 'attended', 'meetup'), ev('2026-11-03', 'attended', 'meetup'),
    ev('2026-10-30', 'missed', 'meetup'), ev('2026-10-29', 'attended', 'meetup'), ev('2026-10-28', 'cancelled'),
    ev('2026-11-05', 'upcoming'), ev('2026-11-20', 'upcoming'),
  ];
  const o = overall(events, today);
  assert.deepEqual([o.attended, o.missed, o.cancelled, o.toReview, o.upcoming, o.total], [4, 1, 1, 1, 1, 8].map((n, i) => (i === 3 ? 1 : i === 4 ? 1 : n)));
  assert.equal(o.rate, 80);
  assert.equal(o.streak, 3);
  const meetup = o.byType.find((t) => t.type === 'meetup');
  assert.deepEqual([meetup.attended, meetup.missed, meetup.rate], [3, 1, 75]);
  assert.equal(o.byType[0].type, 'meetup', 'most-judged type first');
});

test('overall on nothing', () => {
  const o = overall([], '2026-11-01');
  assert.deepEqual([o.rate, o.streak, o.total, o.byType.length], [null, 0, 0, 0]);
});

test('eventsInWeek is inclusive and sorted', () => {
  const list = [ev('2026-11-08', 'upcoming', 'meetup', '09:00'), ev('2026-11-02', 'upcoming', 'meetup', '18:00'), ev('2026-11-02', 'upcoming', 'meetup', '08:00'), ev('2026-11-09', 'upcoming')];
  assert.deepEqual(eventsInWeek(list, '2026-11-02').map((e) => e.time), ['08:00', '18:00', '09:00']);
});
