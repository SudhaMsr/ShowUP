import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, findTimeInText } from '../../src/domain/time.js';
import { addDays, diffDays, excelSerialToISO, findDateInText, isValidISO, weekday } from '../../src/domain/dates.js';

test('parseTime: common formats', () => {
  const cases = [
    ['14:30', '14:30', false],
    ['09:00', '09:00', false],
    ['6pm', '18:00', false],
    ['6 PM', '18:00', false],
    ['2.30 pm', '14:30', false],
    ['11.15 am', '11:15', false],
    ['12am', '00:00', false],
    ['12pm', '12:00', false],
    ['noon', '12:00', false],
    ['9:30am', '09:30', false],
    ['18:30', '18:30', false],
  ];
  for (const [input, time, ambiguous] of cases) {
    const r = parseTime(input);
    assert.equal(r.time, time, input);
    assert.equal(r.ambiguous, ambiguous, `${input} ambiguity`);
  }
});

test('parseTime: Excel day fractions', () => {
  assert.equal(parseTime(0.5).time, '12:00');
  assert.equal(parseTime(0.58333333333333337).time, '14:00');
  assert.equal(parseTime(0.75).time, '18:00');
  assert.equal(parseTime(0.44791666666666669).time, '10:45');
  assert.equal(parseTime('0.75').time, '18:00');
});

test('parseTime: sloppy spreadsheet values are flagged ambiguous, not trusted', () => {
  assert.deepEqual(parseTime('10.3'), { time: '10:30', ambiguous: true, flexible: false });
  const bare = parseTime('9:30');
  assert.equal(bare.time, '09:30');
  assert.equal(bare.ambiguous, true);
  const afternoon = parseTime('2:30');
  assert.equal(afternoon.time, '14:30');
  assert.equal(afternoon.ambiguous, true);
});

test('parseTime: non-times return null', () => {
  for (const v of ['NA', 'n/a', '', '   ', null, undefined, 'soon', '25:00', '13pm', '7', 1.5, -1]) {
    assert.equal(parseTime(v).time, null, String(v));
  }
  assert.equal(parseTime('Flexible').flexible, true);
});

test('findTimeInText picks the earliest time in free text', () => {
  const r = findTimeInText('Doors open 18:30, talk starts 7pm');
  assert.equal(r.time, '18:30');
  assert.equal(findTimeInText('no time here'), null);
  assert.equal(findTimeInText('lunch at noon').time, '12:00');
  assert.equal(findTimeInText('on 12.11 stuff'), null);
});

test('excelSerialToISO matches known dates', () => {
  assert.equal(excelSerialToISO(46023), '2026-01-01');
  assert.equal(excelSerialToISO(46133), '2026-04-21');
  assert.equal(excelSerialToISO(36526), '2000-01-01');
  assert.equal(excelSerialToISO(46133.9), '2026-04-21');
  assert.equal(excelSerialToISO(5), null);
  assert.equal(excelSerialToISO(NaN), null);
});

test('isValidISO rejects impossible dates', () => {
  assert.equal(isValidISO('2026-02-28'), true);
  assert.equal(isValidISO('2024-02-29'), true);
  assert.equal(isValidISO('2026-02-29'), false);
  assert.equal(isValidISO('2026-13-01'), false);
  assert.equal(isValidISO('2026-1-1'), false);
  assert.equal(isValidISO(null), false);
});

test('date arithmetic is DST-proof', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // UK clocks change 29 Mar 2026
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-10-31'), 6);
});

const REF = '2026-10-31'; // Saturday

test('findDateInText: explicit formats', () => {
  assert.equal(findDateInText('on 12 Nov 2026', REF).date, '2026-11-12');
  assert.equal(findDateInText('12th of November', REF).date, '2026-11-12');
  assert.equal(findDateInText('Nov 12th, 2026', REF).date, '2026-11-12');
  assert.equal(findDateInText('2026-11-12', REF).date, '2026-11-12');
  assert.equal(findDateInText('12/11/2026', REF).date, '2026-11-12'); // UK order
  assert.equal(findDateInText('12/11', REF).date, '2026-11-12');
});

test('findDateInText: year inference rolls forward', () => {
  assert.equal(findDateInText('5 Jan', REF).date, '2027-01-05');
  assert.equal(findDateInText('28 Oct', REF).date, '2026-10-28'); // within the last week stays
  assert.equal(findDateInText('1 Jun', REF).date, '2027-06-01');
});

test('findDateInText: relative words', () => {
  assert.equal(findDateInText('today', REF).date, '2026-10-31');
  assert.equal(findDateInText('tomorrow', REF).date, '2026-11-01');
  assert.equal(findDateInText('day after tomorrow', REF).date, '2026-11-02');
  assert.equal(findDateInText('on Monday', REF).date, '2026-11-02');
  assert.equal(findDateInText('Saturday', REF).date, '2026-10-31');
  const next = findDateInText('next Wednesday', REF);
  assert.equal(next.date, '2026-11-04');
  assert.equal(next.ambiguous, true);
});

test('findDateInText: rejects impossible and returns null when absent', () => {
  assert.equal(findDateInText('31 Feb', REF), null);
  assert.equal(findDateInText('nothing here', REF), null);
  assert.equal(findDateInText('', REF), null);
});
