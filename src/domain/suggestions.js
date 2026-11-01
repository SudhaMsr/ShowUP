// @ts-check
import { findDateInText, localISO } from './dates.js';
import { dedupeKey } from './event.js';
import { guessType, parseCapture } from './capture.js';
import { formatHM } from './time.js';

/**
 * Turning things found in a connected account into *proposed* events. Nothing
 * here saves anything: proposals wait in the Approvals inbox until you say yes.
 *
 * @typedef {{ title: string, type: string, date: string, time: string|null, endTime: string|null, location: string, organizer: string, url: string, notes: string, source: 'calendar'|'email', needsReview: boolean }} Draft
 * @typedef {{ id: string, source: 'calendar'|'email', label: string, ref: string, foundAt: string, draft: Draft }} Suggestion
 */

/** @param {Date} d */
const hmOf = (d) => formatHM(d.getHours(), d.getMinutes());

/**
 * One Google Calendar API event -> suggestion, or null when it should not be proposed.
 * @param {any} item @param {{ now?: Date }} [o]
 * @returns {Suggestion|null}
 */
export function fromCalendarItem(item, o = {}) {
  const now = o.now ?? new Date();
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') return null;
  if (item.status === 'cancelled') return null;
  const me = Array.isArray(item.attendees) ? item.attendees.find((/** @type {any} */ a) => a && a.self) : null;
  if (me && me.responseStatus === 'declined') return null;
  const start = item.start;
  if (!start || typeof start !== 'object') return null;
  /** @type {string} */ let date;
  /** @type {string|null} */ let time = null;
  /** @type {string|null} */ let endTime = null;
  if (typeof start.dateTime === 'string') {
    const s = new Date(start.dateTime);
    if (Number.isNaN(s.getTime())) return null;
    date = localISO(s);
    time = hmOf(s);
    const e = typeof item.end?.dateTime === 'string' ? new Date(item.end.dateTime) : null;
    if (e && !Number.isNaN(e.getTime()) && localISO(e) === date && e > s) endTime = hmOf(e);
  } else if (typeof start.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start.date)) {
    date = start.date;
  } else return null;
  const title = typeof item.summary === 'string' && item.summary.trim() ? item.summary.trim() : '(No title)';
  const url = typeof item.hangoutLink === 'string' ? item.hangoutLink : typeof item.htmlLink === 'string' ? item.htmlLink : '';
  const text = `${title} ${typeof item.description === 'string' ? item.description.slice(0, 300) : ''}`;
  return {
    id: `calendar:${item.id}:${date}`,
    source: 'calendar',
    label: 'Google Calendar',
    ref: item.id,
    foundAt: now.toISOString(),
    draft: {
      title, type: guessType(text), date, time, endTime,
      location: typeof item.location === 'string' ? item.location.split('\n')[0] : '',
      organizer: typeof item.organizer?.displayName === 'string' ? item.organizer.displayName : '',
      url, notes: '', source: 'calendar', needsReview: false,
    },
  };
}

/** @param {string} html */
export function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

const SUBJECT_NOISE = /^(?:(?:re|fwd?|fw)\s*:\s*)+/i;
const CONFIRMATION_WORDS = /\b(?:you(?:'|’)?re (?:registered|confirmed|in|going)|registration (?:confirmed|confirmation|complete)|confirmed|your ticket|ticket|rsvp|invitation|invited|see you (?:at|on)|reminder:|webinar|hackathon|meetup|conference|workshop|interview|summit)\b/i;

/**
 * An email -> suggestion, or null when it does not look like an event with a future date.
 * @param {{ id: string, subject: string, from?: string, text: string }} msg
 * @param {{ now?: Date }} [o]
 * @returns {Suggestion|null}
 */
export function fromEmail(msg, o = {}) {
  const now = o.now ?? new Date();
  const today = localISO(now);
  const subject = (msg.subject || '').replace(SUBJECT_NOISE, '').trim();
  const body = (msg.text || '').slice(0, 6000);
  if (!subject || !CONFIRMATION_WORDS.test(`${subject}\n${body.slice(0, 1500)}`)) return null;

  // The event's date is rarely the email's own date. Prefer a labelled line ("Date:", "When:").
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && l.length < 220).slice(0, 120);
  const labelled = /^(?:date(?:\s*(?:&|and)\s*time)?|when|starts?|time|event date)\s*[:\-–]/i;
  const withDate = lines.filter((l) => findDateInText(l, today));
  const line = withDate.find((l) => labelled.test(l)) ?? withDate[0] ?? '';
  const fromSubject = findDateInText(subject, today) ? subject : '';
  const dateSource = fromSubject || line;
  if (!dateSource) return null;
  const parsed = parseCapture(dateSource.replace(labelled, ''), { now });
  if (!parsed.date || parsed.date < today) return null;

  const where = lines.find((l) => /^(?:location|where|venue|address)\s*[:\-–]/i.test(l));
  const link = /https?:\/\/[^\s)>"']+/i.exec(body);
  const title = subject
    .replace(/^(?:confirmed|registration confirmed|you(?:(?:'|’)?re| are) (?:registered|confirmed)|reminder)\s*[:\-–]\s*/i, '')
    .replace(/\s+/g, ' ').slice(0, 200);
  return {
    id: `email:${msg.id}`,
    source: 'email',
    label: msg.from ? `Gmail · ${msg.from.replace(/<.*>/, '').trim() || msg.from}` : 'Gmail',
    ref: msg.id,
    foundAt: now.toISOString(),
    draft: {
      title, type: guessType(`${subject} ${body.slice(0, 500)}`), date: parsed.date, time: parsed.time, endTime: null,
      location: where ? where.replace(/^[^:\-–]+[:\-–]\s*/, '').slice(0, 200) : '',
      organizer: '', url: parsed.url || (link ? link[0] : ''), notes: '', source: 'email',
      // An email is a guess, so the approval step is the check; keep it flagged afterwards if unsure.
      needsReview: parsed.confidence !== 'high',
    },
  };
}

/**
 * Keep only genuinely new proposals: not already an event, already waiting, or dismissed before.
 * @param {Suggestion[]} found
 * @param {{ events: import('./event.js').ShowUpEvent[], waiting: Suggestion[], dismissed: Set<string> }} known
 * @returns {Suggestion[]}
 */
export function newSuggestions(found, known) {
  const have = new Set(known.events.map(dedupeKey));
  const waiting = new Set(known.waiting.map((s) => s.id));
  /** @type {Suggestion[]} */
  const out = [];
  for (const s of found) {
    if (waiting.has(s.id) || known.dismissed.has(s.id)) continue;
    const key = dedupeKey({ title: s.draft.title, date: s.draft.date, time: s.draft.time });
    if (have.has(key)) continue;
    have.add(key);
    waiting.add(s.id);
    out.push(s);
  }
  return out;
}
