// @ts-check
import { addDays, diffDays, localISO } from './dates.js';
import { byStart } from './event.js';
import { DEADLINE_DAYS, deadlineOf, hasPipeline, isApplicationType, isOpen, PRE_SUBMIT_STAGES } from './opportunity.js';

/**
 * @typedef {import('./event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ reminderOffsets: number[], allDayReminderHour: number }} ReminderSettings
 * @typedef {{ key: string, eventId: string, at: Date, offset: number, kind: 'start'|'deadline' }} Reminder
 */

/** @type {ReminderSettings} */
export const DEFAULT_REMINDER_SETTINGS = { reminderOffsets: [60, 1], allDayReminderHour: 9 };

/** Largest reminder lead time a user may set (minutes) and how many they may stack. */
export const MAX_OFFSET_MINUTES = 60 * 24 * 30;
export const MAX_OFFSETS = 8;

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
  /** @type {Reminder[]} */
  const out = offsets.map((offset) => {
    let at;
    if (offset > 0 && offset % 1440 === 0) {
      // "1 day before" means the same wall-clock time on the previous calendar day,
      // even across a DST change (a plain 24h subtraction would shift by an hour).
      at = new Date(start);
      at.setDate(at.getDate() - offset / 1440);
    } else {
      at = new Date(start.getTime() - offset * 60_000);
    }
    return { key: `${e.id}:${offset}`, eventId: e.id, at, offset, kind: /** @type {const} */ ('start') };
  });
  return [...out, ...deadlineReminders(e, settings)];
}

/**
 * Nudges 3 days, 1 day and (for competitions) the morning of a deadline, while
 * the work is not yet submitted. Applications already remind on their own date
 * (which is the deadline), so the "morning of" nudge is left to the usual ones.
 * Respects "no reminders" (an empty list on the event).
 * @param {ShowUpEvent} e
 * @param {ReminderSettings} settings
 * @returns {Reminder[]}
 */
export function deadlineReminders(e, settings = DEFAULT_REMINDER_SETTINGS) {
  const dl = deadlineOf(e);
  if (!dl || !hasPipeline(e.type) || !e.stage || !PRE_SUBMIT_STAGES.includes(e.stage)) return [];
  if (e.reminders !== null && e.reminders.length === 0) return [];
  const days = isApplicationType(e.type) ? DEADLINE_DAYS.filter((d) => d > 0) : DEADLINE_DAYS;
  return days.map((n) => {
    const [y, m, d] = dl.split('-').map(Number);
    const at = new Date(y, m - 1, d - n, settings.allDayReminderHour, 0, 0, 0);
    return { key: `${e.id}:dl${n}`, eventId: e.id, at, offset: n * 1440, kind: /** @type {const} */ ('deadline') };
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
    if (!isOpen(event)) continue;
    const startMs = startDate(event, settings.allDayReminderHour).getTime();
    const started = startMs <= from.getTime(); // already started before the window
    for (const r of reminderSchedule(event, settings)) {
      if (started && r.kind === 'start') continue;
      if (r.at > from && r.at <= to) out.push({ ...r, event });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Human text for an offset in minutes: "1 minute before", "1 hour 30 minutes before".
 * @param {number} minutes
 */
export function describeOffset(minutes) {
  if (minutes === 0) return 'at start time';
  const d = Math.floor(minutes / 1440);
  const hh = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  /** @type {string[]} */
  const parts = [];
  if (d) parts.push(d === 1 ? '1 day' : `${d} days`);
  if (hh) parts.push(hh === 1 ? '1 hour' : `${hh} hours`);
  if (m) parts.push(m === 1 ? '1 minute' : `${m} minutes`);
  return `${parts.join(' ')} before`;
}

/**
 * Turn a user-typed custom reminder ("90", "minutes") into minutes.
 * Returns null for anything that is not a whole number from 0 up to 30 days.
 * @param {unknown} amount @param {string} unit  "minutes" | "hours" | "days"
 * @returns {number|null}
 */
export function parseOffsetInput(amount, unit) {
  const text = String(amount ?? '').trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const factor = unit === 'days' ? 1440 : unit === 'hours' ? 60 : unit === 'minutes' ? 1 : 0;
  if (!factor) return null;
  const minutes = Number(text) * factor;
  return minutes <= MAX_OFFSET_MINUTES ? minutes : null;
}

// ---- "How did it go?" follow-up -------------------------------------------

/** Assume this long when an event has a start time but no end time. */
export const FOLLOW_UP_DEFAULT_MINUTES = 90;
/** All-day events are asked about at this local hour. */
export const FOLLOW_UP_ALL_DAY_HOUR = 20;
/** Do not nag about events that ended more than this long ago. */
export const FOLLOW_UP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * When to ask "did you go?" for an event: its end time, or start + 90 min,
 * or 20:00 for all-day events.
 * @param {Pick<ShowUpEvent,'date'|'time'|'endTime'>} e
 * @returns {Date}
 */
export function followUpAt(e) {
  const [y, m, d] = e.date.split('-').map(Number);
  if (e.time && e.endTime) {
    const [hh, mm] = e.endTime.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }
  if (e.time) {
    const start = startDate(e);
    return new Date(start.getTime() + FOLLOW_UP_DEFAULT_MINUTES * 60_000);
  }
  return new Date(y, m - 1, d, FOLLOW_UP_ALL_DAY_HOUR, 0, 0, 0);
}

/**
 * Events whose follow-up time falls in (from, to] and that are still "upcoming".
 * @param {ShowUpEvent[]} events @param {Date} from exclusive @param {Date} to inclusive
 * @returns {Array<{ key: string, at: Date, event: ShowUpEvent }>}
 */
export function dueFollowUps(events, from, to) {
  /** @type {Array<{ key: string, at: Date, event: ShowUpEvent }>} */
  const out = [];
  for (const event of events) {
    if (!isOpen(event)) continue;
    const at = followUpAt(event);
    if (at > from && at <= to) out.push({ key: `${event.id}:after`, at, event });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The next future moment (a reminder or a follow-up) that needs attention,
 * so the app can wake exactly then instead of only polling.
 * @param {ShowUpEvent[]} events @param {ReminderSettings} settings @param {Date} now
 * @returns {Date|null}
 */
export function nextWakeAt(events, settings, now) {
  let best = /** @type {Date|null} */ (null);
  const consider = (/** @type {Date} */ t) => {
    if (t > now && (!best || t < best)) best = t;
  };
  for (const e of events) {
    if (!isOpen(e)) continue;
    for (const r of reminderSchedule(e, settings)) consider(r.at);
    consider(followUpAt(e));
  }
  return best;
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
    .filter((e) => isOpen(e) && (e.date > today || (e.date === today && (e.time === null || e.time >= hhmm || (e.endTime !== null && e.endTime > hhmm)))))
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
  const open = sorted.filter(isOpen);
  return {
    today: open.filter((e) => e.date === today),
    // Today's events already marked attended/missed/cancelled stay visible (dimmed)
    // so a mis-tap can be undone and the day still reads as a complete record.
    todayClosed: sorted.filter((e) => e.date === today && !isOpen(e)),
    tomorrow: open.filter((e) => e.date === tomorrow),
    thisWeek: open.filter((e) => e.date > tomorrow && e.date <= weekEnd),
    later: open.filter((e) => e.date > weekEnd),
    // Past events still marked upcoming: user should confirm attended/missed.
    needsOutcome: open.filter((e) => e.date < today),
    needsReview: sorted.filter((e) => e.needsReview && isOpen(e)),
    // Competitions whose registration/submission deadline falls this week (the
    // event itself is later). Applications already show on their own date.
    deadlines: open
      .filter((e) => {
        const dl = deadlineOf(e);
        return dl !== null && dl !== e.date && !isApplicationType(e.type) && e.stage !== null && PRE_SUBMIT_STAGES.includes(e.stage) && dl >= today && dl <= weekEnd;
      })
      .sort((a, b) => (deadlineOf(a) ?? '').localeCompare(deadlineOf(b) ?? '')),
  };
}
