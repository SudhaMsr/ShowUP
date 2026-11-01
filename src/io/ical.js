// @ts-check
import { isValidISO, toISO } from '../domain/dates.js';
import { dedupeKey, normalizeEvent, validate } from '../domain/event.js';
import { guessType } from '../domain/capture.js';

/**
 * Minimal, defensive iCalendar (.ics) reader for the fields ShowUp uses.
 * Handles line folding, escaped text, all-day dates, floating/local times and
 * UTC times (converted to the viewer's local time). Recurrence rules are not
 * expanded; recurring events are imported once and reported.
 *
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ row: number, reason: string, preview: string }} Skipped
 */

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 5000;

/** @param {string} s */
function unfold(s) {
  return s.replace(/\r?\n[ \t]/g, '');
}

/** @param {string} s */
function unescapeText(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/**
 * @param {string} line
 * @returns {{ name: string, params: Record<string,string>, value: string } | null}
 */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 1) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  /** @type {Record<string,string>} */
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/**
 * @param {string} value @param {Record<string,string>} params
 * @returns {{ date: string, time: string | null } | null}
 */
function parseWhen(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (params.VALUE === 'DATE' || m[4] === undefined) {
    const date = toISO(y, mo, d);
    return isValidISO(date) ? { date, time: null } : null;
  }
  if (m[7] === 'Z') {
    const local = new Date(Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5])));
    return {
      date: toISO(local.getFullYear(), local.getMonth() + 1, local.getDate()),
      time: `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`,
    };
  }
  const date = toISO(y, mo, d);
  return isValidISO(date) ? { date, time: `${m[4]}:${m[5]}` } : null;
}

/**
 * @param {string} text
 * @param {{ now?: Date, existing?: ShowUpEvent[] }} [opts]
 * @returns {{ events: ShowUpEvent[], skipped: Skipped[], flagged: number }}
 */
export function parseICS(text, opts = {}) {
  /** @type {Skipped[]} */
  const skipped = [];
  if (text.length > MAX_BYTES) throw new Error('That calendar file is larger than 5 MB.');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That does not look like a calendar (.ics) file.');
  const lines = unfold(text).split(/\r?\n/);
  const seen = new Set((opts.existing ?? []).map(dedupeKey));
  /** @type {ShowUpEvent[]} */
  const events = [];
  /** @type {Array<{ name: string, params: Record<string,string>, value: string }> | null} */
  let current = null;
  let index = 0;
  let recurring = 0;

  for (const raw of lines) {
    const up = raw.trim().toUpperCase();
    if (up === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }
    if (up === 'END:VEVENT' && current) {
      index++;
      const props = current;
      current = null;
      if (events.length >= MAX_EVENTS) {
        skipped.push({ row: index, reason: `Only the first ${MAX_EVENTS} events are imported`, preview: '' });
        break;
      }
      const get = (/** @type {string} */ n) => props.find((p) => p.name === n);
      const start = get('DTSTART');
      const title = unescapeText(get('SUMMARY')?.value ?? '').trim();
      const when = start ? parseWhen(start.value, start.params) : null;
      const preview = title.slice(0, 80);
      if (!when) {
        skipped.push({ row: index, reason: 'No usable start date', preview });
        continue;
      }
      if (!title) {
        skipped.push({ row: index, reason: 'No title', preview: when.date });
        continue;
      }
      const end = get('DTEND');
      const endWhen = end ? parseWhen(end.value, end.params) : null;
      const endTime = when.time && endWhen?.time && endWhen.date === when.date && endWhen.time > when.time ? endWhen.time : null;
      if (get('RRULE')) recurring++;
      const event = normalizeEvent(
        {
          title,
          type: guessType(title),
          date: when.date,
          time: when.time,
          endTime,
          location: unescapeText(get('LOCATION')?.value ?? ''),
          notes: unescapeText(get('DESCRIPTION')?.value ?? ''),
          url: /^https?:\/\//i.test(get('URL')?.value ?? '') ? get('URL')?.value : '',
          status: get('STATUS')?.value.toUpperCase() === 'CANCELLED' ? 'cancelled' : 'upcoming',
          source: 'import',
        },
        { now: opts.now },
      );
      if (!validate(event).ok) {
        skipped.push({ row: index, reason: 'Invalid after cleanup', preview });
        continue;
      }
      const key = dedupeKey(event);
      if (seen.has(key)) {
        skipped.push({ row: index, reason: 'Already in ShowUp', preview });
        continue;
      }
      seen.add(key);
      events.push(event);
      continue;
    }
    if (current) {
      const p = parseLine(raw);
      if (p) current.push(p);
    }
  }
  if (recurring) skipped.push({ row: 0, reason: `${recurring} repeating event${recurring === 1 ? '' : 's'} imported once (repeats are not expanded)`, preview: '' });
  return { events, skipped, flagged: 0 };
}
