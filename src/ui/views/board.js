// @ts-check
import { localISO } from '../../domain/dates.js';
import { byStart } from '../../domain/event.js';
import { h } from '../dom.js';
import { dayLabel, time12, TYPE_LABEL } from '../format.js';
import { APPLICATION_TYPES, COMPETITION_TYPES, deadlineOf, effectiveStatus } from '../../domain/opportunity.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

const COLUMNS = /** @type {const} */ ([
  { status: 'upcoming', title: 'Upcoming', hint: 'Still to come' },
  { status: 'attended', title: 'Attended', hint: 'You showed up' },
  { status: 'missed', title: 'Missed', hint: 'It slipped by' },
  { status: 'cancelled', title: 'Cancelled', hint: 'Called off' },
]);

/** Stage columns per kind. Labels are neutral because one board mixes types. */
const STAGE_BOARDS = /** @type {const} */ ({
  applications: {
    title: 'Applications',
    types: APPLICATION_TYPES,
    columns: [['found', 'Found'], ['working', 'Preparing'], ['submitted', 'Applied'], ['interview', 'Interview'], ['won', 'Offer / awarded'], ['lost', 'Not selected'], ['closed', 'Dropped']],
  },
  competitions: {
    title: 'Hackathons & competitions',
    types: COMPETITION_TYPES,
    columns: [['found', 'Found'], ['registered', 'Registered'], ['working', 'Building'], ['submitted', 'Submitted'], ['won', 'Won / placed'], ['lost', 'Not selected'], ['closed', 'Dropped']],
  },
});

/** @type {{ mode: 'outcome'|'stage', kind: 'applications'|'competitions' }} */
const view = { mode: 'outcome', kind: 'applications' };

/**
 * Board of opportunities by stage: drag a card to move it along the pipeline.
 * @param {ViewCtx} ctx
 */
function renderStageBoard(ctx) {
  const { store, now, actions } = ctx;
  const spec = STAGE_BOARDS[view.kind];
  const events = store.getState().events.filter((e) => /** @type {readonly string[]} */ (spec.types).includes(e.type));

  const card = (/** @type {import('../../domain/event.js').ShowUpEvent} */ e) => {
    const dl = deadlineOf(e);
    const done = e.tasks.filter((t) => t.done).length;
    const el = h('article', { class: 'bd-card', draggable: 'true', dataset: { id: e.id, type: e.type, stage: e.stage ?? '' }, tabindex: '0' },
      h('span', { class: 'bd-type' }, TYPE_LABEL[e.type] ?? 'Other'),
      h('h3', { class: 'bd-title' }, e.title),
      e.organizer ? h('p', { class: 'bd-loc' }, e.organizer) : null,
      dl ? h('p', { class: 'bd-when' }, `Deadline ${dayLabel(dl, now)}`) : null,
      effectiveStatus(e) === 'missed' ? h('span', { class: 'bd-flag' }, 'Deadline missed') : null,
      e.tasks.length ? h('p', { class: 'bd-loc' }, `Checklist ${done}/${e.tasks.length}`) : null,
      h('div', { class: 'bd-foot' },
        h('select', { class: 'bd-move', 'aria-label': `Move ${e.title} to stage`, onchange: (/** @type {Event} */ ev) => {
          const v = /** @type {HTMLSelectElement} */ (ev.target).value;
          if (v) actions.setStage?.(e, v);
        } },
          h('option', { value: '' }, 'Move to…'),
          spec.columns.filter(([id]) => id !== e.stage).map(([id, label]) => h('option', { value: id }, label))),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.edit(e) }, 'Edit')));
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer?.setData('text/plain', e.id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  };

  const cols = spec.columns.map(([id, title]) => {
    const list = events.filter((e) => e.stage === id).sort(byStart);
    const col = h('section', { class: `bd-col bd-stage-${id}`, 'aria-label': title },
      h('header', { class: 'bd-head' }, h('h2', {}, title), h('span', { class: 'count' }, String(list.length))),
      h('div', { class: 'bd-body', dataset: { stage: id } }, list.length ? list.map(card) : h('p', { class: 'bd-empty' }, 'Drop here.')));
    col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (ev) => { if (!col.contains(/** @type {Node} */ (ev.relatedTarget))) col.classList.remove('over'); });
    col.addEventListener('drop', (ev) => {
      ev.preventDefault();
      col.classList.remove('over');
      const e = events.find((x) => x.id === ev.dataTransfer?.getData('text/plain'));
      if (e && e.stage !== id) actions.setStage?.(e, id);
    });
    return col;
  });

  const kindBtns = /** @type {Array<'applications'|'competitions'>} */ (['applications', 'competitions']).map((k) =>
    h('button', { class: `seg ${view.kind === k ? 'seg-on' : ''}`, type: 'button', 'aria-pressed': String(view.kind === k), onclick: () => { view.kind = k; ctx.repaint?.(); } }, STAGE_BOARDS[k].title));
  return h('div', { class: 'stack' },
    h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Pipeline' }, kindBtns),
    events.length ? null : h('p', { class: 'empty-note' }, `No ${STAGE_BOARDS[view.kind].title.toLowerCase()} yet. Add one with the Type set to ${view.kind === 'applications' ? 'Internship, Scholarship or Fellowship' : 'Hackathon or Competition'}.`),
    h('div', { class: 'board board-stages' }, cols));
}

/** Outcome / stage switch shown above both boards. @param {ViewCtx} ctx */
function modeSwitch(ctx) {
  return h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Board view' },
    /** @type {Array<['outcome'|'stage', string]>} */ ([['outcome', 'By outcome'], ['stage', 'By stage']]).map(([m, l]) =>
      h('button', { class: `seg ${view.mode === m ? 'seg-on' : ''}`, type: 'button', 'aria-pressed': String(view.mode === m), onclick: () => { view.mode = m; ctx.repaint?.(); } }, l)));
}

/**
 * Kanban board: drag a card to another column to change how the event went.
 * Touch screens and keyboards use the "Move to" menu on each card instead.
 * @param {ViewCtx} ctx
 */
export function renderBoard(ctx) {
  if (view.mode === 'stage') return h('div', { class: 'stack' }, modeSwitch(ctx), renderStageBoard(ctx));
  const { store, now, actions } = ctx;
  const today = localISO(now);
  const events = store.getState().events;
  const stat = effectiveStatus;

  const card = (/** @type {import('../../domain/event.js').ShowUpEvent} */ e) => {
    const overdue = stat(e) === 'upcoming' && e.date < today;
    const move = /** @type {HTMLSelectElement} */ (
      h('select', { class: 'bd-move', 'aria-label': `Move ${e.title} to`, onchange: (/** @type {Event} */ ev) => {
        const v = /** @type {HTMLSelectElement} */ (ev.target).value;
        if (v) actions.setStatus(e, /** @type {any} */ (v));
      } },
        h('option', { value: '' }, 'Move to…'),
        COLUMNS.filter((c) => c.status !== stat(e)).map((c) => h('option', { value: c.status }, c.title))));
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
    const list = events.filter((e) => stat(e) === c.status).sort(c.status === 'upcoming' ? byStart : (a, b) => byStart(b, a));
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
      if (e && stat(e) !== c.status) actions.setStatus(e, c.status);
    });
    return col;
  });

  return h('div', { class: 'stack' },
    modeSwitch(ctx),
    h('p', { class: 'muted' }, 'Drag a card to a new column to record how it went. On a phone, use “Move to”.'),
    h('div', { class: 'board' }, cols));
}
