// @ts-check
import { localISO } from '../../domain/dates.js';
import { byStart } from '../../domain/event.js';
import { h } from '../dom.js';
import { dayLabel, time12, TYPE_LABEL } from '../format.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

const COLUMNS = /** @type {const} */ ([
  { status: 'upcoming', title: 'Upcoming', hint: 'Still to come' },
  { status: 'attended', title: 'Attended', hint: 'You showed up' },
  { status: 'missed', title: 'Missed', hint: 'It slipped by' },
  { status: 'cancelled', title: 'Cancelled', hint: 'Called off' },
]);

/**
 * Kanban board: drag a card to another column to change how the event went.
 * Touch screens and keyboards use the "Move to" menu on each card instead.
 * @param {ViewCtx} ctx
 */
export function renderBoard(ctx) {
  const { store, now, actions } = ctx;
  const today = localISO(now);
  const events = store.getState().events;

  const card = (/** @type {import('../../domain/event.js').ShowUpEvent} */ e) => {
    const overdue = e.status === 'upcoming' && e.date < today;
    const move = /** @type {HTMLSelectElement} */ (
      h('select', { class: 'bd-move', 'aria-label': `Move ${e.title} to`, onchange: (/** @type {Event} */ ev) => {
        const v = /** @type {HTMLSelectElement} */ (ev.target).value;
        if (v) actions.setStatus(e, /** @type {any} */ (v));
      } },
        h('option', { value: '' }, 'Move to…'),
        COLUMNS.filter((c) => c.status !== e.status).map((c) => h('option', { value: c.status }, c.title))));
    const el = h('article', { class: `bd-card${overdue ? ' overdue' : ''}`, draggable: 'true', dataset: { id: e.id, type: e.type }, tabindex: '0' },
      h('span', { class: 'bd-type' }, TYPE_LABEL[e.type] ?? 'Other'),
      h('h3', { class: 'bd-title' }, e.title),
      h('p', { class: 'bd-when' }, `${dayLabel(e.date, now)}${e.time ? ` · ${time12(e.time)}` : ''}`),
      e.location ? h('p', { class: 'bd-loc' }, e.location) : null,
      overdue ? h('span', { class: 'bd-flag' }, 'How did it go?') : null,
      h('div', { class: 'bd-foot' }, move, h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.edit(e) }, 'Edit')));
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer?.setData('text/plain', e.id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  };

  const cols = COLUMNS.map((c) => {
    const list = events.filter((e) => e.status === c.status).sort(c.status === 'upcoming' ? byStart : (a, b) => byStart(b, a));
    const body = h('div', { class: 'bd-body', dataset: { status: c.status } },
      list.length ? list.map(card) : h('p', { class: 'bd-empty' }, c.status === 'upcoming' ? 'Nothing planned.' : 'Drop events here.'));
    const col = h('section', { class: `bd-col bd-${c.status}`, 'aria-label': c.title },
      h('header', { class: 'bd-head' }, h('h2', {}, c.title), h('span', { class: 'count' }, String(list.length)), h('small', {}, c.hint)),
      body);
    col.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      col.classList.add('over');
    });
    col.addEventListener('dragleave', (ev) => {
      if (!col.contains(/** @type {Node} */ (ev.relatedTarget))) col.classList.remove('over');
    });
    col.addEventListener('drop', (ev) => {
      ev.preventDefault();
      col.classList.remove('over');
      const id = ev.dataTransfer?.getData('text/plain');
      const e = events.find((x) => x.id === id);
      if (e && e.status !== c.status) actions.setStatus(e, c.status);
    });
    return col;
  });

  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Drag a card to a new column to record how it went. On a phone, use “Move to”.'),
    h('div', { class: 'board' }, cols));
}
