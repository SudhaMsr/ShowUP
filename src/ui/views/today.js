// @ts-check
import { buildAgenda, countdown, nextUp } from '../../domain/reminders.js';
import { localISO } from '../../domain/dates.js';
import { h } from '../dom.js';
import { eventCard } from '../event-card.js';
import { dayLabel, mapsUrl, time12 } from '../format.js';
import { welcome } from '../welcome.js';

/**
 * @typedef {import('../event-card.js').CardActions} CardActions
 * @typedef {{ store: import('../../app/store.js').Store, now: Date, actions: CardActions, add: () => void, goto: (route: string) => void, repaint?: () => void, inbox?: ReturnType<typeof import('../../app/inbox.js').createInbox>, connections?: import('../../app/connections.js').Connections, relay?: import('../../app/relay.js').Relay, account?: import('../account-panel.js').Account | null }} ViewCtx
 */

/** @param {ViewCtx} ctx */
export function renderToday(ctx) {
  const { events } = ctx.store.getState();
  const { now, actions } = ctx;
  const agenda = buildAgenda(events, now);
  const next = nextUp(events, now);
  const root = h('div', { class: 'stack-lg' });

  if (!events.length) {
    root.append(welcome(ctx));
    return root;
  }

  // Hero: the single most important thing right now.
  root.append(
    next
      ? h('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
          h('p', { class: 'eyebrow' }, next.date === localISO(now) ? 'Next up today' : 'Next up'),
          h('h2', { id: 'hero-title', class: 'hero-title' }, next.title),
          h('p', { class: 'hero-when' },
            h('span', { class: 'hero-count' }, countdown(next, now)),
            ' · ', dayLabel(next.date, now), next.time ? ` · ${time12(next.time)}` : ' · all day'),
          next.location ? h('p', { class: 'hero-where' }, h('a', { href: mapsUrl(next.location), target: '_blank', rel: 'noopener noreferrer' }, next.location)) : null,
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-hero', type: 'button', onclick: () => actions.edit(next) }, 'Details'),
            h('button', { class: 'btn btn-hero', type: 'button', onclick: () => actions.downloadIcs(next) }, 'Add to calendar')))
      : h('section', { class: 'hero hero-calm' },
          h('p', { class: 'eyebrow' }, 'All clear'),
          h('h2', { class: 'hero-title' }, 'No upcoming events'),
          h('p', null, 'Capture the next thing you sign up for so it never slips.')),
  );

  /** @param {string} id @param {string} title @param {import('../../domain/event.js').ShowUpEvent[]} list @param {{ showDate?: boolean, outcome?: boolean, hint?: string }} [o] */
  const section = (id, title, list, o = {}) =>
    list.length
      ? h('section', { class: 'group', 'aria-labelledby': id },
          h('h2', { id, class: 'group-title' }, title, h('span', { class: 'count' }, String(list.length))),
          o.hint ? h('p', { class: 'muted group-hint' }, o.hint) : null,
          h('div', { class: 'list' }, list.map((e) => eventCard(e, { now, actions, showDate: o.showDate, outcome: o.outcome }))))
      : null;

  const todayEmpty = !agenda.today.length && !agenda.todayClosed.length;
  /** @type {Array<HTMLElement | null>} */
  const parts = [
    section('sec-outcome', 'How did these go?', agenda.needsOutcome, { showDate: true, outcome: true, hint: 'These dates have passed. Mark them so your history stays accurate.' }),
    section('sec-review', 'Check these details', agenda.needsReview.filter((e) => !agenda.needsOutcome.includes(e)), { showDate: true, hint: 'Imported or captured with a guess. Open Edit to confirm the time.' }),
    section('sec-deadlines', 'Deadlines this week', agenda.deadlines ?? [], { showDate: true, hint: 'Registration or submission closes soon.' }),
    todayEmpty ? h('p', { class: 'muted today-empty' }, 'Nothing scheduled for today.') : null,
    section('sec-today', 'Today', [...agenda.today, ...agenda.todayClosed]),
    section('sec-tomorrow', 'Tomorrow', agenda.tomorrow),
    section('sec-week', 'Next 7 days', agenda.thisWeek, { showDate: true }),
    agenda.later.length
      ? h('p', { class: 'muted' }, `${agenda.later.length} more later. `, h('a', { href: '#/upcoming' }, 'See everything coming up'))
      : null,
  ];
  root.append(...parts.filter((p) => p !== null));
  return root;
}
