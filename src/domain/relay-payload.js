// @ts-check
/**
 * What ShowUp tells an optional reminder relay: only (time, title, text) tuples for
 * reminders that are still to come. The relay never sees dates, notes, links or
 * the rest of an event, and with `hideTitles` it does not see titles either.
 *
 * @typedef {{ key: string, at: number, title: string, body: string }} RelayReminder
 */
import { describeOffset, dueReminders } from './reminders.js';
import { stageLabel } from './opportunity.js';

export const RELAY_HORIZON_DAYS = 60;
export const RELAY_MAX_REMINDERS = 400;

/** @param {string} hhmm */
function clock12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * @param {import('./event.js').ShowUpEvent[]} events
 * @param {import('./reminders.js').ReminderSettings} settings
 * @param {Date} now
 * @param {{ hideTitles?: boolean, horizonDays?: number }} [o]
 * @returns {RelayReminder[]}
 */
export function buildRelayPayload(events, settings, now, o = {}) {
  const to = new Date(now.getTime() + (o.horizonDays ?? RELAY_HORIZON_DAYS) * 86_400_000);
  return dueReminders(events, settings, now, to)
    .slice(0, RELAY_MAX_REMINDERS)
    .map((r) => {
      const e = r.event;
      if (o.hideTitles) {
        return { key: r.key, at: r.at.getTime(), title: 'ShowUp reminder', body: r.kind === 'deadline' ? 'A deadline is coming up.' : 'You have something coming up.' };
      }
      const body = r.kind === 'deadline'
        ? `Deadline ${r.offset === 0 ? 'today' : r.offset === 1440 ? 'tomorrow' : `in ${r.offset / 1440} days`}${e.stage ? ` · ${stageLabel(e.type, e.stage)}` : ''}`
        : `${e.time ? clock12(e.time) : 'All day'}${e.location ? ` · ${e.location}` : ''} (${describeOffset(r.offset)})`;
      return { key: r.key, at: r.at.getTime(), title: e.title, body };
    });
}
