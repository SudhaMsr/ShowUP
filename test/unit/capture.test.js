import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCapture, parseMany, guessType } from '../../src/domain/capture.js';

const NOW = new Date(2026, 9, 31, 12, 0); // Sat 31 Oct 2026, local

test('parseCapture: full sentence with two "at"s', () => {
  const d = parseCapture('AWS Summit London on 12 Nov at 9am at ExCeL London', { now: NOW });
  assert.equal(d.title, 'AWS Summit London');
  assert.equal(d.date, '2026-11-12');
  assert.equal(d.time, '09:00');
  assert.equal(d.location, 'ExCeL London');
  assert.equal(d.type, 'conference');
  assert.equal(d.confidence, 'high');
});

test('parseCapture: strips conversational filler', () => {
  const d = parseCapture('Remind me about Bristol AI meetup tomorrow at 6.30pm in Watershed', { now: NOW });
  assert.equal(d.title, 'Bristol AI meetup');
  assert.equal(d.date, '2026-11-01');
  assert.equal(d.time, '18:30');
  assert.equal(d.location, 'Watershed');
  assert.equal(d.type, 'meetup');
});

test('parseCapture: "I registered for" voice transcript', () => {
  const d = parseCapture('I registered for the Founders hackathon on Saturday 14 November 10am at Temple Studios', { now: NOW });
  assert.equal(d.title, 'Founders hackathon');
  assert.equal(d.date, '2026-11-14');
  assert.equal(d.time, '10:00');
  assert.equal(d.location, 'Temple Studios');
  assert.equal(d.type, 'hackathon');
});

test('parseCapture: URL is extracted and does not pollute the date', () => {
  const d = parseCapture('Webinar on 3 Dec 2pm https://lu.ma/abc.123/event', { now: NOW });
  assert.equal(d.url, 'https://lu.ma/abc.123/event');
  assert.equal(d.date, '2026-12-03');
  assert.equal(d.time, '14:00');
  assert.equal(d.type, 'webinar');
});

test('parseCapture: missing date is flagged low confidence, never invented', () => {
  const d = parseCapture('Product Tank meetup at Hargreaves Lansdown', { now: NOW });
  assert.equal(d.date, '');
  assert.ok(d.issues.includes('date'));
  assert.equal(d.confidence, 'low');
});

test('parseCapture: missing time is medium confidence', () => {
  const d = parseCapture('Data Curious event on 5 Nov', { now: NOW });
  assert.equal(d.time, null);
  assert.equal(d.date, '2026-11-05');
  assert.equal(d.confidence, 'medium');
});

test('parseCapture: ambiguous time is flagged', () => {
  const d = parseCapture('Mentor meeting tomorrow 2:30', { now: NOW });
  assert.equal(d.time, '14:30');
  assert.ok(d.issues.includes('time'));
});

test('parseCapture: hostile and empty input is safe', () => {
  assert.doesNotThrow(() => parseCapture('', { now: NOW }));
  assert.equal(parseCapture('', { now: NOW }).confidence, 'low');
  const long = 'a'.repeat(200_000);
  assert.ok(parseCapture(long, { now: NOW }).title.length <= 1000);
  const d = parseCapture('<img src=x onerror=alert(1)> on 1 Dec', { now: NOW });
  assert.equal(d.date, '2026-12-01'); // kept as text; UI uses textContent
});

test('parseMany: schedule text becomes one draft per dated line', () => {
  const text = 'Hack Night 5 Nov 6pm\nCloud Meetup 12 Nov 7pm\nrandom banner text';
  const drafts = parseMany(text, { now: NOW });
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].date, '2026-11-05');
  assert.equal(drafts[1].title, 'Cloud Meetup');
});

test('parseMany: a single poster stays one event', () => {
  const text = 'BRISTOL AI SHED\nWatershed\nFriday 6 Nov 9am';
  const drafts = parseMany(text, { now: NOW });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].date, '2026-11-06');
});

test('guessType', () => {
  assert.equal(guessType('Innovet Hackathon'), 'hackathon');
  assert.equal(guessType('Alan Turing interview'), 'interview');
  assert.equal(guessType('lunch with Sam'), 'other');
});
