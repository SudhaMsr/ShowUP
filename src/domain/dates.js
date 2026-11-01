// @ts-check
/**
 * Civil-date helpers. A civil date is the string "YYYY-MM-DD" with no timezone.
 * All arithmetic is done in UTC on those strings, so DST can never shift a date.
 */

const DAY_MS = 86_400_000;

/** @param {number} n @param {number} [w] */
const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * @param {number} y @param {number} m 1-12 @param {number} d
 * @returns {string}
 */
export function toISO(y, m, d) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/**
 * True when the string is a real calendar date (rejects 2026-02-30).
 * @param {unknown} s
 * @returns {boolean}
 */
export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** @param {string} iso @returns {Date} */
function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** @param {Date} dt */
function fromUTC(dt) {
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
  return fromUTC(new Date(toUTC(iso).getTime() + days * DAY_MS));
}

/**
 * Whole days from a to b (b - a).
 * @param {string} a @param {string} b
 */
export function diffDays(a, b) {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday @param {string} iso */
export function weekday(iso) {
  return toUTC(iso).getUTCDay();
}

/** Today's civil date in the runtime's local timezone. @param {Date} [now] */
export function localISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Excel serial date to civil date. Excel's epoch is 1899-12-30 (it counts the
 * non-existent 1900-02-29, so this is correct for every date after 1900-03-01).
 * @param {number} serial
 * @returns {string|null}
 */
export function excelSerialToISO(serial) {
  if (!Number.isFinite(serial) || serial < 61 || serial > 2_958_465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS;
  return fromUTC(new Date(ms));
}

export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ALT = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ALT = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';

/** @param {string} name 1-12 or 0 */
function monthIndex(name) {
  const key = name.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(key)) + 1;
}

/** @param {string} name */
function weekdayIndex(name) {
  const key = name.toLowerCase().slice(0, 3);
  return WEEKDAYS.findIndex((w) => w.startsWith(key));
}

/**
 * Pick the year for a day+month with no year: this year, unless that date is
 * already more than a week in the past, then next year.
 * @param {number} m @param {number} d @param {string} ref
 */
function inferYear(m, d, ref) {
  const refYear = Number(ref.slice(0, 4));
  const candidate = toISO(refYear, m, d);
  return diffDays(candidate, ref) > 7 ? refYear + 1 : refYear;
}

/**
 * @typedef {Object} DateMatch
 * @property {string} date
 * @property {number} index
 * @property {number} length
 * @property {boolean} ambiguous
 */

/**
 * Find the first date expression in free text. UK conventions (day before month).
 * "Saturday 14 November" resolves to the explicit date and consumes both words.
 * @param {string} text
 * @param {string} ref  civil date used for relative expressions ("tomorrow")
 * @returns {DateMatch|null}
 */
export function findDateInText(text, ref) {
  /** @type {Array<DateMatch & { kind: 'explicit'|'relative'|'weekday' }>} */
  const found = [];
  /** @param {RegExpExecArray|null} m @param {string|null} date @param {'explicit'|'relative'|'weekday'} kind @param {boolean} [ambiguous] */
  const take = (m, date, kind, ambiguous = false) => {
    if (!m || !date || !isValidISO(date)) return;
    found.push({ date, index: m.index, length: m[0].length, ambiguous, kind });
  };

  // ISO 2026-11-12
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) take(m, toISO(+m[1], +m[2], +m[3]), 'explicit');

  // 12/11/2026, 12.11.26, 12/11
  m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b(?![:.]\d)/.exec(text);
  if (m) {
    const day = +m[1];
    const mon = +m[2];
    let year = m[3] ? +m[3] : inferYear(mon, day, ref);
    if (m[3] && m[3].length === 2) year += 2000;
    if (mon >= 1 && mon <= 12) take(m, toISO(year, mon, day), 'explicit');
  }

  // 12 Nov 2026 / 12th of November / 12 November
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b\\.?(?:,?\\s+(\\d{4}))?`, 'i').exec(text);
  if (m) {
    const mon = monthIndex(m[2]);
    take(m, toISO(m[3] ? +m[3] : inferYear(mon, +m[1], ref), mon, +m[1]), 'explicit');
  }

  // Nov 12th, 2026 / November 12
  m = new RegExp(`\\b(${MONTH_ALT})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i').exec(text);
  if (m) {
    const mon = monthIndex(m[1]);
    take(m, toISO(m[3] ? +m[3] : inferYear(mon, +m[2], ref), mon, +m[2]), 'explicit');
  }

  // today / tonight / tomorrow / day after tomorrow
  m = /\b(day after tomorrow|tomorrow|tonight|today)\b/i.exec(text);
  if (m) {
    const w = m[1].toLowerCase();
    take(m, w === 'day after tomorrow' ? addDays(ref, 2) : w === 'tomorrow' ? addDays(ref, 1) : ref, 'relative');
  }

  // (this|next) Friday / Friday
  m = new RegExp(`\\b(?:(this|next)\\s+)?(${WEEKDAY_ALT})\\b`, 'i').exec(text);
  if (m) {
    const target = weekdayIndex(m[2]);
    let delta = (target - weekday(ref) + 7) % 7;
    if (m[1]?.toLowerCase() === 'next') {
      if (delta === 0) delta = 7;
      // "next Friday" said on Monday: the Friday after this week.
      const mondayIndexToday = (weekday(ref) + 6) % 7;
      const mondayIndexTarget = (target + 6) % 7;
      if (mondayIndexTarget > mondayIndexToday && delta < 7) delta += 7;
      take(m, addDays(ref, delta), 'weekday', true);
    } else {
      take(m, addDays(ref, delta), 'weekday', false);
    }
  }

  if (!found.length) return null;

  // A weekday directly in front of an explicit date ("Saturday 14 November")
  // is decoration: keep the explicit date and swallow both words.
  for (const wd of found.filter((f) => f.kind === 'weekday')) {
    const end = wd.index + wd.length;
    const explicit = found.find((f) => f.kind === 'explicit' && f.index >= end && /^[\s,]*$/.test(text.slice(end, f.index)));
    if (explicit) {
      const explicitEnd = explicit.index + explicit.length;
      explicit.index = wd.index;
      explicit.length = explicitEnd - wd.index;
      found.splice(found.indexOf(wd), 1);
    }
  }
  found.sort((a, b) => a.index - b.index);
  const { date, index, length, ambiguous } = found[0];
  return { date, index, length, ambiguous };
}
