import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseICS } from '../../src/io/ical.js';
import { readImportFiles, MAX_FILES } from '../../src/io/import-files.js';
import { toICS } from '../../src/domain/ics.js';
import { toBackupJSON } from '../../src/io/backup.js';
import { normalizeEvent } from '../../src/domain/event.js';

const NOW = new Date(2026, 9, 31, 12, 0);

/** Build an in-memory "File". */
const file = (name, content) => {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return {
    name,
    size: buf.length,
    text: async () => buf.toString('utf8'),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};
const fixture = () => file('messy-events.xlsx', readFileSync(new URL('../fixtures/messy-events.xlsx', import.meta.url)));

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:1', 'DTSTART:20261112T180000', 'DTEND:20261112T200000', 'SUMMARY:Cloud Meetup\\, Bristol', 'LOCATION:Watershed', 'URL:https://lu.ma/x', 'DESCRIPTION:Line one\\nLine two', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2', 'DTSTART;VALUE=DATE:20261120', 'SUMMARY:Tech Show London hackathon', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:3', 'DTSTART:20261201T090000Z', 'SUMMARY:UTC event', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:4', 'SUMMARY:No start', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:5', 'DTSTART:20261301T090000', 'SUMMARY:Impossible date', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('ICS: reads timed, all-day, UTC and cancelled events; reports the unusable', () => {
  const r = parseICS(ICS, { now: NOW });
  assert.equal(r.events.length, 3);
  const [a, b, c] = r.events;
  assert.deepEqual([a.title, a.date, a.time, a.endTime, a.location, a.url], ['Cloud Meetup, Bristol', '2026-11-12', '18:00', '20:00', 'Watershed', 'https://lu.ma/x']);
  assert.equal(a.notes, 'Line one\nLine two');
  assert.deepEqual([b.date, b.time, b.status, b.type], ['2026-11-20', null, 'cancelled', 'hackathon']);
  assert.equal(c.date, '2026-12-01');
  assert.equal(c.time, '09:00', 'UTC 09:00 is 09:00 in London in December');
  const reasons = r.skipped.map((s) => s.reason).join('|');
  assert.match(reasons, /No usable start date/);
  assert.match(reasons, /repeating event/);
  assert.equal(r.skipped.filter((s) => /No usable/.test(s.reason)).length, 2);
});

test('ICS: round-trips what ShowUp itself exports', () => {
  const e = normalizeEvent({ title: 'Round; trip, test', date: '2026-11-05', time: '18:00', endTime: '19:30', location: 'Hall\nTwo', notes: 'n', url: 'https://x.test/a' }, { id: 'r1', now: NOW });
  const back = parseICS(toICS([e], { now: NOW }), { now: NOW }).events[0];
  assert.deepEqual([back.title, back.date, back.time, back.endTime, back.url], [e.title, e.date, e.time, e.endTime, e.url]);
});

test('ICS: rejects non-calendar text and oversized input; dedupes against existing', () => {
  assert.throws(() => parseICS('hello'), /does not look like a calendar/);
  assert.throws(() => parseICS(`BEGIN:VCALENDAR${'x'.repeat(5 * 1024 * 1024 + 1)}`), /larger than 5 MB/);
  const first = parseICS(ICS, { now: NOW });
  const again = parseICS(ICS, { now: NOW, existing: first.events });
  assert.equal(again.events.length, 0);
});

test('ICS: folded lines are unfolded', () => {
  const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261112T180000\r\nSUMMARY:A very long\r\n  title that was folded\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  assert.equal(parseICS(text, { now: NOW }).events[0].title, 'A very long title that was folded');
});

test('multi-file: workbook + csv + ics + backup combine into one de-duplicated import', async () => {
  const csv = 'Date,Time,Title,Type\n2026-12-10,10:00,CSV Workshop,workshop\n2026-12-10,10:00,CSV Workshop,workshop\n';
  const backupEvent = normalizeEvent({ title: 'From backup', date: '2026-12-15', time: '12:00' }, { id: 'b1', now: NOW });
  const batch = await readImportFiles(
    [fixture(), file('extra.csv', csv), file('cal.ics', ICS), file('backup.json', toBackupJSON([backupEvent])), file('photo.png', 'x'), file('notes.txt', 'x')],
    { now: NOW },
  );
  const byName = Object.fromEntries(batch.summaries.map((s) => [s.name, s]));
  assert.ok(byName['messy-events.xlsx'].count >= 6);
  assert.equal(byName['extra.csv'].count, 1, 'duplicate row inside the csv collapsed');
  assert.equal(byName['cal.ics'].count, 3);
  assert.equal(byName['backup.json'].count, 1);
  assert.match(byName['photo.png'].error, /Screenshot/);
  assert.match(byName['notes.txt'].error, /Unsupported/);
  assert.equal(batch.events.length, batch.summaries.reduce((n, s) => n + s.count, 0));
  assert.ok(batch.events.some((e) => e.id === 'b1'), 'backup ids preserved');
  assert.match(byName['messy-events.xlsx'].notes.join(' '), /Sheet “Notes”: no Date and Title columns/);
});

test('multi-file: the same event in two files is imported once', async () => {
  const a = file('a.csv', 'Date,Time,Title\n2026-12-10,10:00,Shared Event\n');
  const b = file('b.csv', 'Date,Time,Title\n2026-12-10,10:00,shared  event\n2026-12-11,10:00,Only in B\n');
  const batch = await readImportFiles([a, b], { now: NOW });
  assert.equal(batch.events.length, 2);
  assert.equal(batch.summaries[1].count, 1);
});

test('multi-file: a bad file is reported without stopping the others', async () => {
  const batch = await readImportFiles(
    [file('broken.xlsx', 'not a zip file at all, just text'), file('bad.json', '{nope'), file('ok.csv', 'Date,Title,Type\n2026-12-10,Good one,meetup\n')],
    { now: NOW },
  );
  assert.ok(batch.summaries[0].error);
  assert.match(batch.summaries[1].error, /valid JSON/);
  assert.equal(batch.summaries[2].count, 1);
  assert.equal(batch.events.length, 1);
});

test('multi-file: caps the number of files and skips existing events', async () => {
  const many = Array.from({ length: MAX_FILES + 3 }, (_, i) => file(`f${i}.csv`, `Date,Title,Type\n2026-12-${String(10 + (i % 15)).padStart(2, '0')},E${i},meetup\n`));
  const batch = await readImportFiles(many, { now: NOW });
  assert.equal(batch.summaries.length, MAX_FILES);
  assert.match(batch.skipped[0].reason, /first 20 files/);
  const again = await readImportFiles([many[0]], { now: NOW, existing: batch.events });
  assert.equal(again.events.length, 0);
});
