// @ts-check
import { addDays, diffDays, localISO, weekday } from '../domain/dates.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Thu 5 Nov" (adds the year when it is not the current one). @param {string} iso @param {Date} now */
export function dayLabel(iso, now) {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${DAYS[weekday(iso)]} ${d} ${MONTHS[m - 1]}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}

/** Relative heading: Today, Tomorrow, or a date. @param {string} iso @param {Date} now */
export function dayHeading(iso, now) {
  const today = localISO(now);
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (diffDays(today, iso) === -1) return 'Yesterday';
  return dayLabel(iso, now);
}

/** "March 2026" @param {string} iso */
export function monthLabel(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${LONG_MONTHS[m - 1]} ${y}`;
}

/** 24h "14:30" -> "2:30 pm". @param {string|null} hm */
export function time12(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${suffix}` : `${hh} ${suffix}`;
}

/** Google Maps search URL for a free-text place. @param {string} place */
export function mapsUrl(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

/** Only http(s) links may be rendered as hrefs. @param {string} url */
export function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export const TYPE_LABEL = /** @type {Record<string,string>} */ ({
  hackathon: 'Hackathon', internship: 'Internship', scholarship: 'Scholarship', fellowship: 'Fellowship', competition: 'Competition', meetup: 'Meetup', conference: 'Conference', workshop: 'Workshop',
  webinar: 'Webinar', interview: 'Interview', meeting: 'Meeting', networking: 'Networking',
  submission: 'Submission', personal: 'Personal', other: 'Other',
});
