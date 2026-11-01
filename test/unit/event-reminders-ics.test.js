import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byStart, dedupeKey, normalizeEvent, validate } from '../../src/domain/event.js';
import {
  buildAgenda, countdown, describeOffset, dueReminders, nextUp, reminderSchedule, startDate,
} from '../../src/domain/reminders.js';
import { escapeText, fold, googleCalendarUrl, toICS } from '../../src/domain/ics.js';

const NOW = new Date(2026, 9, 31, 12, 0);
const SETTINGS = { reminderOffsets: [1440, 60], allDayReminderHour: 9 };
const ev = (o = {}) => normalizeEvent({ title: 'Meetup', date: '2026-11-05', time: '18:00', ...o }, { id: o.id ?? 'e1', now: NOW });

test('normalizeEvent coerces garbage into safe values', () => {
  const e = normalizeEvent({ title: '  Hi\u0000  ', type: 'nonsense', status: 'weird', time: '25:99', reminders: [60, 60, -5, 1.5, 'x', 1440] }, { now: NOW });
  assert.equal(e.title, 'Hi');
  assert.equal(e.type, 'other');
  assert.equal(e.status, 'upcoming');
  assert.equal(e.time, null);
  assert.deepEqual(e.reminders, [1440, 60]);
  assert.match(e.id, /^[0-9a-f-]{36}$/);
});

test('validate catches real problems', () => {
  assert.equal(validate(ev()).ok, true);
  assert.ok(validate(ev({ title: '' })).errors.title);
  assert.ok(validate(ev({ date: '2026-02-30' })).errors.date);
  assert.ok(validate(ev({ time: '10:00', endTime: '09:00' })).errors.endTime);
  assert.ok(validate(ev({ time: null, endTime: '09:00' })).errors.endTime);
  assert.ok(validate(ev({ url: 'javascript:alert(1)' })).errors.url);
  assert.ok(validate(ev({ url: 'not a url' })).errors.url);
  assert.equal(validate(ev({ url: 'https://lu.ma/x' })).ok, true);
});

test('dedupeKey ignores case and spacing', () => {
  assert.equal(dedupeKey(ev({ title: 'AI  Meetup' })), dedupeKey(ev({ title: 'ai meetup' })));
});

test('byStart sorts all-day first, then by time', () => {
  const list = [ev({ id: 'c', time: '18:00' }), ev({ id: 'a', time: null }), ev({ id: 'b', time: '09:00' })].sort(byStart);
  assert.deepEqual(list.map((e) => e.id), ['a', 'b', 'c']);
});

test('reminderSchedule uses defaults and per-event overrides', () => {
  const s = reminderSchedule(ev(), SETTINGS);
  assert.deepEqual(s.map((r) => r.offset), [1440, 60]);
  assert.equal(s[1].at.getTime(), new Date(2026, 10, 5, 17, 0).getTime());
  assert.equal(s[0].at.getTime(), new Date(2026, 10, 4, 18, 0).getTime());
  assert.deepEqual(reminderSchedule(ev({ reminders: [15] }), SETTINGS).map((r) => r.offset), [15]);
});

test('all-day events remind relative to the configured hour', () => {
  const e = ev({ time: null });
  assert.equal(startDate(e, 9).getHours(), 9);
  assert.equal(reminderSchedule(e, SETTINGS)[1].at.getTime(), new Date(2026, 10, 5, 8, 0).getTime());
});

test('dueReminders: window is (from, to], skips non-upcoming and started events', () => {
  const e = ev();
  const from = new Date(2026, 10, 5, 16, 59);
  const to = new Date(2026, 10, 5, 17, 0);
  const due = dueReminders([e], SETTINGS, from, to);
  assert.equal(due.length, 1);
  assert.equal(due[0].offset, 60);
  assert.equal(dueReminders([e], SETTINGS, to, new Date(2026, 10, 5, 17, 1)).length, 0); // exclusive from
  assert.equal(dueReminders([ev({ status: 'cancelled' })], SETTINGS, from, to).length, 0);
  assert.equal(dueReminders([ev({ status: 'attended' })], SETTINGS, from, to).length, 0);
  // event already started before the window -> nothing
  assert.equal(dueReminders([e], SETTINGS, new Date(2026, 10, 5, 18, 5), new Date(2026, 10, 6)).length, 0);
});

test('reminders are DST-correct (clocks go back 25 Oct 2026)', () => {
  const e = ev({ date: '2026-10-25', time: '09:00' });
  const day = reminderSchedule(e, SETTINGS)[0];
  assert.equal(day.at.getHours(), 9);
  assert.equal(day.at.getDate(), 24);
});

test('describeOffset', () => {
  assert.equal(describeOffset(0), 'at start time');
  assert.equal(describeOffset(60), '1 hour before');
  assert.equal(describeOffset(180), '3 hours before');
  assert.equal(describeOffset(1440), '1 day before');
  assert.equal(describeOffset(2880), '2 days before');
  assert.equal(describeOffset(45), '45 minutes before');
});

test('nextUp and countdown', () => {
  const past = ev({ id: 'p', date: '2026-10-31', time: '09:00' });
  const soon = ev({ id: 's', date: '2026-10-31', time: '14:30' });
  const later = ev({ id: 'l', date: '2026-11-05' });
  assert.equal(nextUp([later, past, soon], NOW).id, 's');
  assert.equal(nextUp([past], NOW), null);
  assert.equal(countdown(soon, NOW), 'in 2h 30m');
  assert.equal(countdown(later, NOW), 'in 5 days');
  assert.equal(countdown(ev({ date: '2026-11-01' }), NOW), 'tomorrow');
  assert.equal(countdown(ev({ date: '2026-10-31', time: null }), NOW), 'today');
});

test('buildAgenda buckets and flags past-but-unresolved events', () => {
  const events = [
    ev({ id: 'a', date: '2026-10-31', time: '15:00' }),
    ev({ id: 'b', date: '2026-11-01' }),
    ev({ id: 'c', date: '2026-11-04' }),
    ev({ id: 'd', date: '2026-12-01' }),
    ev({ id: 'e', date: '2026-10-20' }),
    ev({ id: 'f', date: '2026-11-02', status: 'cancelled' }),
    ev({ id: 'g', date: '2026-11-03', needsReview: true }),
    ev({ id: 'h', date: '2026-10-31', time: '09:00', status: 'attended' }),
    ev({ id: 'i', date: '2026-10-30', status: 'attended' }),
  ];
  const a = buildAgenda(events, NOW);
  assert.deepEqual(a.today.map((e) => e.id), ['a']);
  assert.deepEqual(a.todayClosed.map((e) => e.id), ['h'], "only today's finished events");
  assert.deepEqual(a.tomorrow.map((e) => e.id), ['b']);
  assert.deepEqual(a.thisWeek.map((e) => e.id), ['g', 'c']);
  assert.deepEqual(a.later.map((e) => e.id), ['d']);
  assert.deepEqual(a.needsOutcome.map((e) => e.id), ['e']);
  assert.deepEqual(a.needsReview.map((e) => e.id), ['g']);
});

test('ICS: structure, escaping, alarms, CRLF', () => {
  const events = [
    ev({ id: 'x1', title: 'A, B; C', location: 'Hall\nTwo', notes: 'bring ID', url: 'https://x.test/a' }),
    ev({ id: 'x2', time: null, title: 'All day' }),
    ev({ id: 'x3', status: 'attended' }),
    ev({ id: 'x4', status: 'cancelled' }),
  ];
  const ics = toICS(events, { now: new Date(Date.UTC(2026, 9, 31, 12)), settings: SETTINGS });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!ics.includes('x3@'), 'attended events are not exported');
  assert.match(ics, /UID:x1@showup\.local/);
  assert.match(ics, /DTSTART:20261105T180000/);
  assert.match(ics, /DTEND:20261105T190000/);
  assert.match(ics, /SUMMARY:A\\, B\\; C/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261105/);
  assert.match(ics, /DTEND;VALUE=DATE:20261106/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /TRIGGER:-PT\d+M|TRIGGER:PT\d+M/);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 3);
  assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
  // all-day 09:00 anchor, 60 min before -> 08:00 = +480 min after midnight
  assert.match(ics, /TRIGGER:PT480M/);
});

test('ICS: lines fold at 75 octets without splitting UTF-8', () => {
  const line = `SUMMARY:${'é'.repeat(100)}`;
  const folded = fold(line);
  for (const part of folded.split('\r\n')) assert.ok(new TextEncoder().encode(part).length <= 75, part.length);
  assert.equal(folded.replace(/\r\n /g, ''), line);
  assert.equal(escapeText('a\\b'), 'a\\\\b');
});

test('Google Calendar link carries the details', () => {
  const url = new URL(googleCalendarUrl(ev({ location: 'Bristol', title: 'Hack & Co' })));
  assert.equal(url.hostname, 'calendar.google.com');
  assert.equal(url.searchParams.get('text'), 'Hack & Co');
  assert.equal(url.searchParams.get('dates'), '20261105T180000/20261105T190000');
  assert.equal(url.searchParams.get('location'), 'Bristol');
});
