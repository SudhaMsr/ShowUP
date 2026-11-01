import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, toCSV, csvField } from '../../src/io/csv.js';
import { readXlsx } from '../../src/io/xlsx.js';
import { detectHeader, mapSheet, mapWorkbook } from '../../src/io/sheet-import.js';

const NOW = new Date(2026, 9, 31, 12, 0);
const fixture = () => {
  const b = readFileSync(new URL('../fixtures/messy-events.xlsx', import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

test('CSV: quotes, commas, newlines, BOM, CRLF round-trip', () => {
  const rows = [['a', 'b,c', 'd"e', 'line1\nline2'], ['', ' x ', '', '']];
  const text = toCSV(['h1', 'h2', 'h3', 'h4'], rows);
  const parsed = parseCSV('﻿' + text);
  assert.deepEqual(parsed[0], ['h1', 'h2', 'h3', 'h4']);
  assert.deepEqual(parsed[1], rows[0]);
  assert.deepEqual(parsed[2], rows[1]);
});

test('CSV: formula injection is neutralised on export', () => {
  assert.equal(csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvField('+1'), "'+1");
  assert.equal(csvField('safe'), 'safe');
});

test('XLSX: reads sheets, shared strings, numbers, gaps', async () => {
  const sheets = await readXlsx(fixture());
  assert.deepEqual(sheets.map((s) => s.name), ['Master Tracker', 'Notes']);
  const rows = sheets[0].rows;
  assert.deepEqual(rows[0], []);
  assert.equal(rows[1][0], 'Date');
  assert.equal(rows[2][0], 46133);
  assert.equal(rows[2][1], '14:30');
  assert.equal(rows[3][1], 0.75);
});

test('XLSX: rejects garbage and truncated input safely', async () => {
  await assert.rejects(() => readXlsx(new ArrayBuffer(0)), /empty|not a spreadsheet/i);
  await assert.rejects(() => readXlsx(new TextEncoder().encode('hello world, definitely not a zip file!').buffer), /valid \.xlsx/i);
  const good = new Uint8Array(fixture());
  await assert.rejects(() => readXlsx(good.slice(0, good.length - 40).buffer));
});

test('detectHeader finds the header below blank rows', async () => {
  const sheets = await readXlsx(fixture());
  const h = detectHeader(sheets[0].rows);
  assert.equal(h.index, 1);
  assert.equal(h.columns.title, 3);
  assert.equal(detectHeader(sheets[1].rows), null);
});

test('mapWorkbook: imports good rows, flags uncertain ones, reports skips', async () => {
  const sheets = await readXlsx(fixture());
  const r = mapWorkbook(sheets, { now: NOW });
  assert.equal(r.sheetName, 'Master Tracker');
  const byTitle = (t) => r.events.filter((e) => e.title === t);

  const mentor = byTitle('Mentor Meeting');
  assert.equal(mentor.length, 2, 'duplicate row removed, different-day row kept');
  assert.equal(mentor[0].date, '2026-04-21');
  assert.equal(mentor[0].time, '14:30');
  assert.equal(mentor[0].status, 'attended');
  assert.equal(mentor[0].type, 'meeting');
  assert.equal(mentor[0].source, 'import');

  assert.equal(byTitle('AI Meetup')[0].time, '18:00'); // 0.75 fraction
  const sport = byTitle('Team Sport')[0];
  assert.equal(sport.time, '14:30');
  assert.equal(sport.type, 'interview');
  assert.equal(sport.needsReview, true, 'no am/pm -> ambiguous');

  const peer = byTitle('Peer Support')[0];
  assert.equal(peer.time, '10:30');
  assert.equal(peer.needsReview, true);

  const pack = byTitle('Work pack')[0];
  assert.equal(pack.time, null);
  assert.equal(pack.needsReview, false, '"NA" is a deliberate no-time');

  assert.equal(byTitle('Connections')[0].status, 'cancelled');

  const reasons = r.skipped.map((s) => s.reason).join(' | ');
  assert.match(reasons, /no month/i, '"08 to 12th" is reported, not guessed');
  assert.match(reasons, /No date/);
  assert.match(reasons, /Already in ShowUp/);
  assert.ok(!r.events.some((e) => e.title === 'INTERVIEWS'), 'section labels ignored silently');
  assert.ok(r.flagged >= 2);
});

test('mapSheet: dedupes against existing events', async () => {
  const sheets = await readXlsx(fixture());
  const first = mapWorkbook(sheets, { now: NOW });
  const second = mapWorkbook(sheets, { now: NOW, existing: first.events });
  assert.equal(second.events.length, 0);
});

test('mapSheet: no header -> clear message, nothing imported', () => {
  const r = mapSheet([['foo', 'bar'], [1, 2]], { now: NOW });
  assert.equal(r.events.length, 0);
  assert.match(r.skipped[0].reason, /header/i);
});

test('mapSheet: handles 10k rows quickly', () => {
  const rows = [['Date', 'Time', 'Title']];
  for (let i = 0; i < 10_000; i++) rows.push([46133 + (i % 300), '18:00', `Event ${i}`]);
  const t0 = performance.now();
  const r = mapSheet(rows, { now: NOW });
  assert.equal(r.events.length, 10_000);
  assert.ok(performance.now() - t0 < 2000);
});
