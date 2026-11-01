// @ts-check
import { addDays } from './dates.js';
import { DEFAULT_REMINDER_SETTINGS } from './reminders.js';

/** @typedef {import('./event.js').ShowUpEvent} ShowUpEvent */

/** @param {string} s */
export function escapeText(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 line folding at 75 octets, never splitting a UTF-8 sequence.
 * @param {string} line
 * @returns {string}
 */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = ch;
      bytes = n;
      limit = 74; // continuation lines start with one space
    } else {
      current += ch;
      bytes += n;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** @param {string} iso @param {string} [hm] */
function local(iso, hm) {
  const d = iso.replace(/-/g, '');
  return hm ? `${d}T${hm.replace(':', '')}00` : d;
}

/** @param {Date} d */
function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** @param {number} minutes signed */
function duration(minutes) {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  // Nominal days stay on the same wall-clock time across DST changes (RFC 5545).
  if (abs > 0 && abs % 1440 === 0) return `${sign}P${abs / 1440}D`;
  return `${sign}PT${abs}M`;
}

/**
 * Build an iCalendar document with real VALARMs.
 * Times are floating (no TZID) to match ShowUp's civil-time model.
 * @param {ShowUpEvent[]} events
 * @param {{ now?: Date, name?: string, settings?: { reminderOffsets: number[], allDayReminderHour: number } }} [opts]
 * @returns {string} CRLF-delimited ICS text
 */
export function toICS(events, opts = {}) {
  const now = opts.now ?? new Date();
  const settings = opts.settings ?? DEFAULT_REMINDER_SETTINGS;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShowUp//Event Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name ?? 'ShowUp events')}`,
  ];
  for (const e of events) {
    if (e.status === 'attended' || e.status === 'missed') continue;
    lines.push('BEGIN:VEVENT', `UID:${e.id}@showup.local`, `DTSTAMP:${utcStamp(now)}`);
    if (e.time) {
      lines.push(`DTSTART:${local(e.date, e.time)}`);
      if (e.endTime) lines.push(`DTEND:${local(e.date, e.endTime)}`);
      else {
        const [h, m] = e.time.split(':').map(Number);
        const end = h * 60 + m + 60;
        if (end < 24 * 60) {
          lines.push(`DTEND:${local(e.date, `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`)}`);
        } else {
          lines.push(`DTEND:${local(addDays(e.date, 1), '00:00')}`);
        }
      }
    } else {
      lines.push(`DTSTART;VALUE=DATE:${local(e.date)}`, `DTEND;VALUE=DATE:${local(addDays(e.date, 1))}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    const description = [e.organizer && `Organiser: ${e.organizer}`, e.notes, e.url].filter(Boolean).join('\n');
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push(`CATEGORIES:${escapeText(e.type)}`);
    if (e.status === 'cancelled') lines.push('STATUS:CANCELLED');
    else lines.push('STATUS:CONFIRMED');

    const offsets = e.reminders ?? settings.reminderOffsets;
    for (const offset of offsets) {
      // For all-day events the trigger is relative to 00:00 on the day.
      const minutes = e.time ? -offset : settings.allDayReminderHour * 60 - offset;
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(`${e.title}${e.time ? ` at ${e.time}` : ''}${e.location ? `, ${e.location}` : ''}`)}`,
        `TRIGGER:${duration(minutes)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * Link that opens Google Calendar's "new event" form prefilled.
 * @param {ShowUpEvent} e
 */
export function googleCalendarUrl(e) {
  const start = local(e.date, e.time ?? undefined);
  let end;
  if (e.time) {
    end = local(e.date, e.endTime ?? undefined);
    if (!e.endTime) {
      const [h, m] = e.time.split(':').map(Number);
      const t = Math.min(h * 60 + m + 60, 23 * 60 + 59);
      end = local(e.date, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
  } else {
    end = local(addDays(e.date, 1));
  }
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${start}/${end}`,
    details: [e.organizer, e.notes, e.url].filter(Boolean).join('\n'),
    location: e.location,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
