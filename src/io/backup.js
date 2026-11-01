// @ts-check
import { normalizeEvent, validate } from '../domain/event.js';
import { toCSV } from './csv.js';

/** @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent */

const MAX_BACKUP_EVENTS = 50_000;

/**
 * @param {ShowUpEvent[]} events
 * @param {Date} [now]
 */
export function toBackupJSON(events, now = new Date()) {
  return JSON.stringify({ app: 'showup', version: 1, exportedAt: now.toISOString(), events }, null, 2);
}

/**
 * Parse and sanitise a backup. Untrusted: every event goes through normalizeEvent.
 * @param {string} text
 * @returns {{ events: ShowUpEvent[], rejected: number }}
 */
export function parseBackupJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || data.app !== 'showup' || !Array.isArray(data.events)) {
    throw new Error('That file is not a ShowUp backup.');
  }
  if (data.events.length > MAX_BACKUP_EVENTS) throw new Error('Backup has too many events.');
  /** @type {ShowUpEvent[]} */
  const events = [];
  let rejected = 0;
  for (const raw of data.events) {
    if (!raw || typeof raw !== 'object') {
      rejected++;
      continue;
    }
    const e = normalizeEvent(raw);
    if (validate(e).ok) events.push(e);
    else rejected++;
  }
  return { events, rejected };
}

/**
 * Merge incoming events into existing by id; the newer `updatedAt` wins.
 * @param {ShowUpEvent[]} existing @param {ShowUpEvent[]} incoming
 * @returns {{ merged: ShowUpEvent[], added: number, updated: number }}
 */
export function mergeById(existing, incoming) {
  const map = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  for (const e of incoming) {
    const cur = map.get(e.id);
    if (!cur) {
      map.set(e.id, e);
      added++;
    } else if (e.updatedAt > cur.updatedAt) {
      map.set(e.id, e);
      updated++;
    }
  }
  return { merged: [...map.values()], added, updated };
}

export const CSV_HEADER = ['Date', 'Time', 'Type', 'Title', 'Location', 'Organizer', 'Status', 'Notes', 'Link'];

/** @param {ShowUpEvent[]} events */
export function toEventsCSV(events) {
  const label = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);
  return toCSV(
    CSV_HEADER,
    events.map((e) => [e.date, e.time ?? '', e.type, e.title, e.location, e.organizer, label(e.status), e.notes, e.url]),
  );
}
