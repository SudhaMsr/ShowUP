import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromCalendarItem, fromEmail, htmlToText, newSuggestions } from '../../src/domain/suggestions.js';

const NOW = new Date(2026, 10, 1, 12, 0); // Sun 1 Nov 2026, local (Europe/London)

test('calendar: timed event becomes local date, start and end', () => {
  const s = fromCalendarItem({ id: 'a1', summary: 'AI Meetup', location: 'Watershed, Bristol\nBS1', start: { dateTime: '2026-11-12T18:00:00Z' }, end: { dateTime: '2026-11-12T20:00:00Z' }, htmlLink: 'https://cal/x' }, { now: NOW });
  assert.equal(s.id, 'calendar:a1:2026-11-12');
  assert.deepEqual([s.draft.date, s.draft.time, s.draft.endTime, s.draft.location, s.draft.type], ['2026-11-12', '18:00', '20:00', 'Watershed, Bristol', 'meetup']);
  assert.equal(s.draft.url, 'https://cal/x');
});

test('calendar: all-day, no title, meet link; skips cancelled, declined and junk', () => {
  const a = fromCalendarItem({ id: 'b', start: { date: '2026-11-20' }, hangoutLink: 'https://meet.google.com/abc' }, { now: NOW });
  assert.deepEqual([a.draft.title, a.draft.time, a.draft.url], ['(No title)', null, 'https://meet.google.com/abc']);
  assert.equal(fromCalendarItem({ id: 'c', status: 'cancelled', summary: 'x', start: { date: '2026-11-20' } }), null);
  assert.equal(fromCalendarItem({ id: 'd', summary: 'x', start: { date: '2026-11-20' }, attendees: [{ self: true, responseStatus: 'declined' }] }), null);
  assert.equal(fromCalendarItem({ id: 'e', summary: 'x', start: {} }), null);
  assert.equal(fromCalendarItem({ id: 'f', summary: 'x', start: { dateTime: 'nonsense' } }), null);
  assert.equal(fromCalendarItem(null), null);
});

test('calendar: recurring instances get separate ids per day', () => {
  const x = fromCalendarItem({ id: 'r_20261105', summary: 'Standup', start: { date: '2026-11-05' } }, { now: NOW });
  const y = fromCalendarItem({ id: 'r_20261106', summary: 'Standup', start: { date: '2026-11-06' } }, { now: NOW });
  assert.notEqual(x.id, y.id);
});

test('email: confirmation with labelled date, time and location', () => {
  const s = fromEmail({
    id: 'm1', from: 'Eventbrite <no-reply@eventbrite.com>', subject: 'Fwd: You’re registered: Cloud Native Hackathon',
    text: 'Hi Sudha,\nThanks for signing up. Sent on 28 October.\n\nWhen: 14 Nov 2026 at 9:30am\nWhere: Engine Shed, Bristol\nLocation: Engine Shed, Bristol\nhttps://eventbrite.com/e/123\n',
  }, { now: NOW });
  assert.ok(s);
  assert.equal(s.draft.title, 'Cloud Native Hackathon');
  assert.deepEqual([s.draft.date, s.draft.time, s.draft.location, s.draft.type], ['2026-11-14', '09:30', 'Engine Shed, Bristol', 'hackathon']);
  assert.match(s.draft.url, /eventbrite/);
  assert.match(s.label, /Eventbrite/);
});

test('email: date only in the subject works; past dates, no date, and non-event mail are ignored', () => {
  assert.equal(fromEmail({ id: 'a', subject: 'Registration confirmed: DevConf on 20 Nov at 10am', text: '' }, { now: NOW }).draft.date, '2026-11-20');
  assert.equal(fromEmail({ id: 'b', subject: 'You’re registered: Old Meetup', text: 'When: 3 Oct 2026 at 6pm' }, { now: NOW }), null, 'in the past');
  assert.equal(fromEmail({ id: 'c', subject: 'You’re registered: Mystery Meetup', text: 'See you soon!' }, { now: NOW }), null, 'no date');
  assert.equal(fromEmail({ id: 'd', subject: 'Your invoice for October', text: 'Due 20 Nov 2026 at 5pm' }, { now: NOW }), null, 'not an event');
});

test('htmlToText strips markup and entities', () => {
  assert.equal(htmlToText('<style>p{}</style><p>When:&nbsp;14 Nov</p><div>Where: Hall &amp; Bar</div><script>x()</script>'), 'When: 14 Nov\nWhere: Hall & Bar');
});

test('newSuggestions drops existing events, waiting items, dismissed items and duplicates', () => {
  const mk = (id, title) => ({ id, source: 'calendar', label: 'x', ref: id, foundAt: '', draft: { title, date: '2026-11-12', time: '18:00' } });
  const found = [mk('1', 'Have It'), mk('2', 'Waiting'), mk('3', 'Dismissed'), mk('4', 'Fresh'), mk('5', 'fresh'), mk('6', 'Another')];
  const out = newSuggestions(found, {
    events: [{ title: 'Have It', date: '2026-11-12', time: '18:00' }],
    waiting: [mk('2', 'Waiting')],
    dismissed: new Set(['3']),
  });
  assert.deepEqual(out.map((s) => s.id), ['4', '6']);
});
