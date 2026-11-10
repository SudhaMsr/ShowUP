// @ts-check
import { effectiveStatus } from '../../domain/opportunity.js';
import { addDays, localISO, toISO, weekday } from '../../domain/dates.js';
import { byStart } from '../../domain/event.js';
import { h } from '../dom.js';
import { eventCard } from '../event-card.js';
import { openEditor } from '../dialogs.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

const view = { month: /** @type {string|null} */ (null), day: /** @type {string|null} */ (null) };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** First of the month `delta` months from `iso`. @param {string} iso @param {number} delta */
function shiftMonth(iso, delta) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Month grid, Monday first. @param {ViewCtx} ctx */
export function renderCalendar(ctx) {
  const { store, now, actions } = ctx;
  const today = localISO(now);
  const month = view.month ?? `${today.slice(0, 7)}-01`;
  const events = store.getState().events;

  const first = month;
  const lead = (weekday(first) + 6) % 7;
  const gridStart = addDays(first, -lead);
  const monthIdx = month.slice(0, 7);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // Trim a trailing all-outside week.
  const rows = days.slice(35).every((d) => !d.startsWith(monthIdx)) ? days.slice(0, 35) : days;
  const selected = view.day && rows.includes(view.day) ? view.day : rows.includes(today) ? today : first;

  const go = (/** @type {string} */ m, /** @type {string|null} */ d = null) => {
    view.month = m;
    view.day = d;
    ctx.repaint?.();
  };

  const title = new Date(`${month}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const bar = h('div', { class: 'cal-bar' },
    h('h2', { class: 'cal-title', 'aria-live': 'polite' }, title),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'btn btn-small', type: 'button', id: 'cal-prev', 'aria-label': 'Previous month', onclick: () => go(shiftMonth(month, -1)) }, '‹'),
      h('button', { class: 'btn btn-small', type: 'button', id: 'cal-today', onclick: () => go(`${today.slice(0, 7)}-01`, today) }, 'Today'),
      h('button', { class: 'btn btn-small', type: 'button', id: 'cal-next', 'aria-label': 'Next month', onclick: () => go(shiftMonth(month, 1)) }, '›')));

  const cells = rows.map((d, i) => {
    const list = events.filter((e) => e.date === d).sort(byStart);
    const cell = h('button', {
      type: 'button', class: `cal-cell${d.startsWith(monthIdx) ? '' : ' out'}${d === today ? ' today' : ''}${d === selected ? ' sel' : ''}`, dataset: { date: d },
      'aria-label': `${d}, ${list.length} event${list.length === 1 ? '' : 's'}`, 'aria-pressed': String(d === selected),
      onclick: () => { view.day = d; ctx.repaint?.(); },
    },
      h('span', { class: 'cal-num' }, String(Number(d.slice(8)))),
      h('span', { class: 'cal-chips' },
        list.slice(0, 3).map((e) => h('i', { class: `cal-chip st-${effectiveStatus(e)}`, dataset: { type: e.type } }, e.time ? `${e.time} ${e.title}` : e.title)),
        list.length > 3 ? h('em', { class: 'cal-more' }, `+${list.length - 3} more`) : null));
    cell.style.setProperty('--i', String(i));
    return cell;
  });

  const dayEvents = events.filter((e) => e.date === selected).sort(byStart);
  const label = new Date(`${selected}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const panel = h('section', { class: 'panel cal-day', 'aria-live': 'polite', id: 'cal-day' },
    h('div', { class: 'wk-head' }, h('h2', {}, label),
      h('button', { class: 'btn btn-primary btn-small', type: 'button', id: 'cal-add', onclick: () => openEditor(store, null, { defaults: { date: selected } }) }, '+ Add on this day')),
    dayEvents.length ? h('div', { class: 'list' }, dayEvents.map((e) => eventCard(e, { now, actions }))) : h('p', { class: 'muted' }, 'Nothing on this day.'));

  return h('div', { class: 'stack' }, bar,
    h('div', { class: 'cal', role: 'group', 'aria-label': title },
      DOW.map((d) => h('span', { class: 'cal-dow', 'aria-hidden': 'true' }, d)), cells),
    panel);
}
