// @ts-check
import { countdown } from '../domain/reminders.js';
import { googleCalendarUrl } from '../domain/ics.js';
import { h } from './dom.js';
import { dayLabel, mapsUrl, safeHref, TYPE_LABEL, time12 } from './format.js';

/**
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {Object} CardActions
 * @property {(e: ShowUpEvent) => void} edit
 * @property {(e: ShowUpEvent, status: import('../domain/event.js').EventStatus) => void} setStatus
 * @property {(e: ShowUpEvent) => void} remove
 * @property {(e: ShowUpEvent) => void} downloadIcs
 */

/**
 * One event as a "ticket" row: time stub on the left, details on the right.
 * @param {ShowUpEvent} e
 * @param {{ now: Date, actions: CardActions, showDate?: boolean, outcome?: boolean }} o
 */
export function eventCard(e, o) {
  const { now, actions } = o;
  const href = e.url ? safeHref(e.url) : null;
  const closed = e.status !== 'upcoming';
  const statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);

  const meta = h('p', { class: 'ev-meta' },
    h('span', { class: `chip chip-${e.type}` }, TYPE_LABEL[e.type] ?? 'Other'),
    e.location ? h('a', { class: 'ev-loc', href: mapsUrl(e.location), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${e.location} in maps` }, e.location) : null,
    e.organizer ? h('span', { class: 'ev-org' }, e.organizer) : null,
    closed ? h('span', { class: `chip chip-status chip-${e.status}` }, statusLabel) : null,
    e.needsReview ? h('span', { class: 'chip chip-review', title: 'Some details were uncertain when this was added' }, 'Check details') : null,
  );

  const primary = o.outcome
    ? [
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => actions.setStatus(e, 'attended') }, 'I went'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.setStatus(e, 'missed') }, 'I missed it'),
      ]
    : [];

  const more = h('details', { class: 'more' },
    h('summary', { class: 'btn btn-small', 'aria-label': `More actions for ${e.title}` }, 'More'),
    h('div', { class: 'more-menu', role: 'group' },
      h('button', { class: 'menu-item', type: 'button', onclick: () => actions.downloadIcs(e) }, 'Add to calendar (.ics)'),
      h('a', { class: 'menu-item', href: googleCalendarUrl(e), target: '_blank', rel: 'noopener noreferrer' }, 'Add to Google Calendar'),
      href ? h('a', { class: 'menu-item', href, target: '_blank', rel: 'noopener noreferrer' }, 'Open event page') : null,
      e.status !== 'attended' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'attended') }, 'Mark attended') : null,
      e.status !== 'missed' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'missed') }, 'Mark missed') : null,
      e.status !== 'cancelled' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'cancelled') }, 'Mark cancelled') : null,
      e.status !== 'upcoming' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'upcoming') }, 'Back to upcoming') : null,
      h('button', { class: 'menu-item menu-danger', type: 'button', onclick: () => actions.remove(e) }, 'Delete')));

  return h('article', { class: `ev ${closed ? 'ev-closed' : ''}`, dataset: { id: e.id, status: e.status }, 'aria-label': e.title },
    h('div', { class: 'ev-stub' },
      h('span', { class: 'ev-time' }, e.time ? time12(e.time) : 'All day'),
      o.showDate ? h('span', { class: 'ev-date' }, dayLabel(e.date, now)) : null,
      !closed ? h('span', { class: 'ev-count' }, countdown(e, now)) : null),
    h('div', { class: 'ev-body' },
      h('h3', { class: 'ev-title' }, e.title),
      meta,
      e.notes ? h('p', { class: 'ev-notes' }, e.notes) : null,
      h('div', { class: 'ev-actions' },
        ...primary,
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.edit(e) }, 'Edit'),
        more)));
}
