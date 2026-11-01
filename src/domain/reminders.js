// @ts-check
import { addDays, diffDays, localISO } from './dates.js';
import { byStart } from './event.js';

/**
 * @typedef {import('./event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ reminderOffsets: number[], allDayReminderHour: number }} ReminderSettings
 * @typedef {{ key: string, eventId: string, at: Date, offset: number }} Reminder
 */

/** @type {ReminderSettings} */
export const DEFAULT_REMINDER_SETTINGS = { reminderOffsets: [1440, 60], allDayReminderHour: 9 };

/**
 * Local Date for the event's start. All-day events anchor at the configured hour.
 * @param {Pick<ShowUpEvent,'date'|'time'>} e
 * @param {number} allDayHour
 * @returns {Date}
 */
export function startDate(e, allDayHour = 9) {
  const [y, m, d] = e.date.split('-').map(Number);
  const [hh, mm] = e.time ? e.time.split(':').map(Number) : [allDayHour, 0];
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * All reminder instants for one event (including ones already in the past).
 * @param {ShowUpEvent} e
 * @param {ReminderSettings} settings
 * @returns {Reminder[]}
 */
export function reminderSchedule(e, settings = DEFAULT_REMINDER_SETTINGS) {
  const offsets = e.reminders ?? settings.reminderOffsets;
  const start = startDate(e, settings.allDayReminderHour);
  return offsets.map((offset) => {
    let at;
    if (offset > 0 && offset % 1440 === 0) {
      // "1 day before" means the same wall-clock time on the previous calendar day,
      // even across a DST change (a plain 24h subtraction would shift by an hour).
      at = new Date(start);
      at.setDate(at.getDate() - offset / 1440);
    } else {
      at = new Date(start.getTime() - offset * 60_000);
    }
    return { key: `${e.id}:${offset}`, eventId: e.id, at, offset };
  });
}

/**
 * Reminders whose time falls in (from, to]. Only for events still upcoming
 * and not yet started.
 * @param {ShowUpEvent[]} events
 * @param {ReminderSettings} settings
 * @param {Date} from exclusive
 * @param {Date} to inclusive
 * @returns {Array<Reminder & { event: ShowUpEvent }>}
 */
export function dueReminders(events, settings, from, to) {
  /** @type {Array<Reminder & { event: ShowUpEvent }>} */
  const out = [];
  for (const event of events) {
    if (event.status !== 'upcoming') continue;
    const startMs = startDate(event, settings.allDayReminderHour).getTime();
    if (startMs <= from.getTime()) continue; // already started before the window
    for (const r of reminderSchedule(event, settings)) {
      if (r.at > from && r.at <= to) out.push({ ...r, event });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Human text for an offset in minutes.
 * @param {number} minutes
 */
export function describeOffset(minutes) {
  if (minutes === 0) return 'at start time';
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? '1 day before' : `${d} days before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour before' : `${h} hours before`;
  }
  return `${minutes} minutes before`;
}

/**
 * Next upcoming event that has not started yet (or is in progress).
 * @param {ShowUpEvent[]} events @param {Date} now
 * @returns {ShowUpEvent|null}
 */
export function nextUp(events, now) {
  const today = localISO(now);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const candidates = events
    .filter((e) => e.status === 'upcoming' && (e.date > today || (e.date === today && (e.time === null || e.time >= hhmm || (e.endTime !== null && e.endTime > hhmm)))))
    .sort(byStart);
  return candidates[0] ?? null;
}

/**
 * Plain-language countdown, e.g. "in 2 hours", "tomorrow", "in 5 days".
 * @param {ShowUpEvent} e @param {Date} now
 */
export function countdown(e, now) {
  const today = localISO(now);
  const days = diffDays(today, e.date);
  if (days < 0) return days === -1 ? 'yesterday' : `${-days} days ago`;
  if (days === 0) {
    if (!e.time) return 'today';
    const mins = Math.round((startDate(e).getTime() - now.getTime()) / 60_000);
    if (mins <= -1) return e.endTime && now.getHours() * 60 + now.getMinutes() < toMinutes(e.endTime) ? 'happening now' : 'started';
    if (mins < 1) return 'starting now';
    if (mins < 60) return `in ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** @param {string} hm */
function toMinutes(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Split events into the buckets the UI shows.
 * @param {ShowUpEvent[]} events @param {Date} now
 */
export function buildAgenda(events, now) {
  const today = localISO(now);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const sorted = [...events].sort(byStart);
  const open = sorted.filter((e) => e.status === 'upcoming');
  return {
    today: open.filter((e) => e.date === today),
    // Today's events already marked attended/missed/cancelled stay visible (dimmed)
    // so a mis-tap can be undone and the day still reads as a complete record.
    todayClosed: sorted.filter((e) => e.date === today && e.status !== 'upcoming'),
    tomorrow: open.filter((e) => e.date === tomorrow),
    thisWeek: open.filter((e) => e.date > tomorrow && e.date <= weekEnd),
    later: open.filter((e) => e.date > weekEnd),
    // Past events still marked upcoming: user should confirm attended/missed.
    needsOutcome: open.filter((e) => e.date < today),
    needsReview: sorted.filter((e) => e.needsReview && e.status === 'upcoming'),
  };
}
