// @ts-check
import { addDays, weekday } from './dates.js';
import { effectiveStatus } from './opportunity.js';

/**
 * Attendance statistics. Pure functions over events, so every number the
 * Insights page shows is unit-tested.
 *
 * Success rate = attended / (attended + missed). Cancelled events are the
 * organiser's doing, not yours, so they never count against you. Events still
 * marked "upcoming" whose day has passed are "to review": not counted until
 * you say how they went.
 *
 * @typedef {import('./event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ start: string, end: string, attended: number, missed: number, cancelled: number, toReview: number, upcoming: number, total: number, rate: number|null }} Week
 */

/** Monday of the week containing `iso` (weeks run Monday to Sunday). @param {string} iso */
export function weekStart(iso) {
  const dow = weekday(iso); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/** @param {number} attended @param {number} missed @returns {number|null} 0..100, or null with nothing to judge */
export function rate(attended, missed) {
  const d = attended + missed;
  return d ? Math.round((attended / d) * 100) : null;
}

/** @param {ShowUpEvent[]} events @param {string} start Monday @param {string} today */
function summarise(events, start, today) {
  const end = addDays(start, 6);
  /** @type {Week} */
  const w = { start, end, attended: 0, missed: 0, cancelled: 0, toReview: 0, upcoming: 0, total: 0, rate: null };
  for (const e of events) {
    if (e.date < start || e.date > end) continue;
    w.total++;
    const st = effectiveStatus(e);
    if (st === 'attended') w.attended++;
    else if (st === 'missed') w.missed++;
    else if (st === 'cancelled') w.cancelled++;
    else if (e.date < today) w.toReview++;
    else w.upcoming++;
  }
  w.rate = rate(w.attended, w.missed);
  return w;
}

/**
 * The last `count` weeks, oldest first, ending with the week that holds `today`.
 * @param {ShowUpEvent[]} events @param {string} today @param {number} [count]
 * @returns {Week[]}
 */
export function weeklyStats(events, today, count = 8) {
  const thisWeek = weekStart(today);
  return Array.from({ length: count }, (_, i) => summarise(events, addDays(thisWeek, -7 * (count - 1 - i)), today));
}

/** @param {ShowUpEvent[]} events @param {string} start Monday */
export function eventsInWeek(events, start) {
  const end = addDays(start, 6);
  return events.filter((e) => e.date >= start && e.date <= end).sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
}

/**
 * Whole-history numbers.
 * @param {ShowUpEvent[]} events @param {string} today
 */
export function overall(events, today) {
  let attended = 0, missed = 0, cancelled = 0, toReview = 0, upcoming = 0;
  /** @type {Map<string, { attended: number, missed: number }>} */
  const types = new Map();
  for (const e of events) {
    const st = effectiveStatus(e);
    if (st === 'attended') attended++;
    else if (st === 'missed') missed++;
    else if (st === 'cancelled') cancelled++;
    else if (e.date < today) toReview++;
    else upcoming++;
    if (st === 'attended' || st === 'missed') {
      const t = types.get(e.type) ?? { attended: 0, missed: 0 };
      t[st]++;
      types.set(e.type, t);
    }
  }
  // Streak: consecutive attended events, newest first, stopping at the first miss.
  const judged = events.filter((e) => ['attended', 'missed'].includes(effectiveStatus(e))).sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));
  let streak = 0;
  for (const e of judged) {
    if (effectiveStatus(e) !== 'attended') break;
    streak++;
  }
  const byType = [...types].map(([type, v]) => ({ type, ...v, rate: rate(v.attended, v.missed) })).sort((a, b) => b.attended + b.missed - (a.attended + a.missed));
  return { attended, missed, cancelled, toReview, upcoming, total: events.length, rate: rate(attended, missed), streak, byType };
}
