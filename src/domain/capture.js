// @ts-check
import { findDateInText, localISO } from './dates.js';
import { findTimeInText } from './time.js';

/**
 * @typedef {Object} Draft
 * @property {string} title
 * @property {string} type
 * @property {string} date          "" when unknown
 * @property {string|null} time
 * @property {string} location
 * @property {string} url
 * @property {string[]} issues      human-readable things to double-check
 * @property {'high'|'medium'|'low'} confidence
 */

/** Keyword -> type. Order matters: first match wins. */
const TYPE_RULES = /** @type {Array<[RegExp, string]>} */ ([
  [/\bhack(?:athon|day|fest)\b/i, 'hackathon'],
  [/\b(?:interview|screening call|assessment centre)\b/i, 'interview'],
  [/\b(?:internship|intern|work placement|placement year|graduate scheme|summer analyst)\b/i, 'internship'],
  [/\b(?:scholarship|bursary|studentship|grant)\b/i, 'scholarship'],
  [/\b(?:fellowship)\b/i, 'fellowship'],
  [/\b(?:competition|contest|olympiad|coding challenge|case challenge)\b/i, 'competition'],
  [/\b(?:conference|summit|expo|symposium|congress|convention|trade ?show)\b/i, 'conference'],
  [/\b(?:webinar|online session|livestream)\b/i, 'webinar'],
  [/\b(?:workshop|bootcamp|masterclass|training|class)\b/i, 'workshop'],
  [/\b(?:meet-?up|meet up)\b/i, 'meetup'],
  [/\b(?:networking|mixer|social|fair|drinks)\b/i, 'networking'],
  [/\b(?:deadline|submission|submit|due)\b/i, 'submission'],
  [/\b(?:meeting|catch-?up|1:1|sync|mentor)\b/i, 'meeting'],
]);

/** @param {string} s */
export function guessType(s) {
  for (const [re, type] of TYPE_RULES) if (re.test(s)) return type;
  return 'other';
}

const FILLER = [
  /^(?:please\s+)?(?:remind me(?: about| of| to go to| to attend)?|add|create|new event|note that|i(?:'ve| have)? (?:registered|signed up|booked)(?: for)?|i(?:'m| am) (?:going|attending)(?: to)?|register(?:ed)? for)\s*[:,-]?\s*/i,
  /^(?:the|a|an)\s+/i,
];

/** @param {string} s */
function tidy(s) {
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s,;:\-–—@]+|[\s,;:\-–—@]+$/g, '').trim();
}

/** @param {string} s */
function stripLeadingPrepositions(s) {
  return s.replace(/^(?:on|at|from|for|this|next)\s+/i, '').replace(/\s+(?:on|at|from|for|in)$/i, '');
}

/**
 * Cut `[index, index+length)` out of a string.
 * @param {string} s @param {number} index @param {number} length
 */
function cut(s, index, length) {
  return `${s.slice(0, index)} ${s.slice(index + length)}`;
}

/**
 * Like cut(), but also removes a joining word ("on", "at", "from"...) directly
 * before the span, so "on 12 Nov at 9am at ExCeL" does not leave stray "at"s.
 * @param {string} s @param {number} index @param {number} length
 */
function cutWithPreposition(s, index, length) {
  const before = s.slice(0, index).replace(/\s(?:on|at|from|by|around|@)\s*$/i, ' ');
  return `${before} ${s.slice(index + length)}`;
}

/**
 * Turn one free-text description into a draft event.
 * "AWS Summit London on 12 Nov at 9am at ExCeL London" -> title/date/time/location.
 * @param {string} input
 * @param {{ now?: Date }} [opts]
 * @returns {Draft}
 */
export function parseCapture(input, opts = {}) {
  const ref = localISO(opts.now ?? new Date());
  let rest = ` ${input.replace(/\s+/g, ' ').trim().slice(0, 1000)} `;
  /** @type {string[]} */
  const issues = [];

  // URL first so its dots/slashes do not confuse the date matcher.
  let url = '';
  const urlMatch = /https?:\/\/[^\s)]+/i.exec(rest);
  if (urlMatch) {
    url = urlMatch[0].replace(/[.,;]+$/, '');
    rest = cut(rest, urlMatch.index, urlMatch[0].length);
  }

  // Time before date: "11.30" must not be mistaken for a dd.mm date.
  let time = /** @type {string|null} */ (null);
  const t = findTimeInText(rest);
  if (t) {
    time = t.time;
    if (t.ambiguous) issues.push('time');
    rest = cutWithPreposition(rest, t.index, t.length);
  }

  let date = '';
  const d = findDateInText(rest, ref);
  if (d) {
    date = d.date;
    if (d.ambiguous) issues.push('date');
    rest = cutWithPreposition(rest, d.index, d.length);
  } else {
    issues.push('date');
  }

  // Location: "at X", "@ X", "in X" (only when X starts with a capital).
  let location = '';
  const loc = /\s(?:at|@)\s+([^,;]+?)(?=\s+(?:on|from|for|starting)\s|[,;]|\s*$)|\s(in)\s+([A-Z][^,;]*?)(?=\s+(?:on|from|for|at)\s|[,;]|\s*$)/.exec(rest);
  if (loc) {
    location = tidy(loc[1] ?? loc[3] ?? '');
    rest = cut(rest, loc.index, loc[0].length);
  }

  let title = tidy(rest);
  for (const f of FILLER) title = title.replace(f, '');
  title = tidy(stripLeadingPrepositions(tidy(title)));
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  if (!title) issues.push('title');

  const type = guessType(input);
  const confidence = !title || !date ? 'low' : time && !issues.length ? 'high' : 'medium';
  return { title, type, date, time, location, url, issues, confidence };
}

/**
 * Parse text that may describe several events (OCR of a schedule, a list).
 * A line that contains its own date becomes its own draft; otherwise the whole
 * text is treated as one event.
 * @param {string} input
 * @param {{ now?: Date }} [opts]
 * @returns {Draft[]}
 */
export function parseMany(input, opts = {}) {
  const ref = localISO(opts.now ?? new Date());
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dated = lines.filter((l) => findDateInText(l, ref));
  if (dated.length >= 2) return dated.slice(0, 50).map((l) => parseCapture(l, opts));
  return [parseCapture(lines.join(' '), opts)];
}
