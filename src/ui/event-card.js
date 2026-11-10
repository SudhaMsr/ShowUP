// @ts-check
import { countdown } from '../domain/reminders.js';
import { googleCalendarUrl } from '../domain/ics.js';
import { h } from './dom.js';
import { dayLabel, mapsUrl, safeHref, TYPE_LABEL, time12 } from './format.js';
import { deadlineOf, effectiveStatus, fieldsFor, hasPipeline, isApplicationType, nextStage, pipelineFor, stageLabel } from '../domain/opportunity.js';

/**
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {Object} CardActions
 * @property {(e: ShowUpEvent) => void} edit
 * @property {(e: ShowUpEvent, status: import('../domain/event.js').EventStatus) => void} setStatus
 * @property {(e: ShowUpEvent) => void} remove
 * @property {(e: ShowUpEvent) => void} downloadIcs
 * @property {(e: ShowUpEvent) => void} [duplicate]
 * @property {(e: ShowUpEvent, stage: string) => void} [setStage]
 * @property {(e: ShowUpEvent, index: number, done: boolean) => void} [setTask]
 */

/**
 * One event as a "ticket" row: time stub on the left, details on the right.
 * @param {ShowUpEvent} e
 * @param {{ now: Date, actions: CardActions, showDate?: boolean, outcome?: boolean }} o
 */
export function eventCard(e, o) {
  const { now, actions } = o;
  const href = e.url ? safeHref(e.url) : null;
  const status = effectiveStatus(e);
  const closed = status !== 'upcoming';
  const application = isApplicationType(e.type);
  const pipeline = hasPipeline(e.type);
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const deadline = deadlineOf(e);
  const detailBits = fieldsFor(e.type).map((f) => (e.details[f.key] ? `${f.label}: ${e.details[f.key]}` : '')).filter(Boolean);
  const doneTasks = e.tasks.filter((t) => t.done).length;

  const meta = h('p', { class: 'ev-meta' },
    h('span', { class: `chip chip-${e.type}` }, TYPE_LABEL[e.type] ?? 'Other'),
    e.location ? h('a', { class: 'ev-loc', href: mapsUrl(e.location), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${e.location} in maps` }, e.location) : null,
    e.organizer ? h('span', { class: 'ev-org' }, e.organizer) : null,
    pipeline && e.stage ? h('span', { class: `chip chip-stage chip-stage-${e.stage}` }, stageLabel(e.type, e.stage)) : null,
    deadline && !application ? h('span', { class: 'chip chip-deadline', title: 'Registration or submission deadline' }, `Due ${dayLabel(deadline, now)}`) : null,
    closed && !(pipeline && status === 'attended') ? h('span', { class: `chip chip-status chip-${status}` }, statusLabel) : null,
    e.needsReview ? h('span', { class: 'chip chip-review', title: 'Some details were uncertain when this was added' }, 'Check details') : null,
  );

  const next = nextStage(e.type, e.stage);
  const primary = o.outcome
    ? application
      ? [
          h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => actions.setStatus(e, 'attended') }, 'I applied'),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.setStatus(e, 'missed') }, 'I missed the deadline'),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.setStatus(e, 'cancelled') }, 'Not pursuing'),
        ]
      : [
          h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => actions.setStatus(e, 'attended') }, 'I went'),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.setStatus(e, 'missed') }, 'I missed it'),
        ]
    : pipeline && next && actions.setStage && e.stage !== 'closed' && status !== 'missed'
      ? [h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => actions.setStage?.(e, next) }, `Move to ${stageLabel(e.type, next)}`)]
      : [];

  const stageSelect = pipeline && actions.setStage
    ? h('select', { class: 'stage-select', 'aria-label': `Stage for ${e.title}`, onchange: (/** @type {Event} */ ev) => actions.setStage?.(e, /** @type {HTMLSelectElement} */ (ev.target).value) },
        pipelineFor(e.type).map((st) => h('option', { value: st.id, selected: st.id === e.stage }, st.label)))
    : null;

  const extras = e.links.length || e.tasks.length
    ? h('details', { class: 'ev-extras' },
        h('summary', null,
          [e.tasks.length ? `Checklist ${doneTasks}/${e.tasks.length}` : '', e.links.length ? `${e.links.length} link${e.links.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')),
        e.tasks.length
          ? h('ul', { class: 'ev-tasks' }, e.tasks.map((t, i) =>
              h('li', null, h('label', null,
                h('input', { type: 'checkbox', checked: t.done, disabled: !actions.setTask, onchange: (/** @type {Event} */ ev) => actions.setTask?.(e, i, /** @type {HTMLInputElement} */ (ev.target).checked) }),
                h('span', { class: t.done ? 'task-done' : '' }, t.text)))))
          : null,
        e.links.length
          ? h('ul', { class: 'ev-links' }, e.links.map((l) => {
              const lh = safeHref(l.url);
              return h('li', null, lh ? h('a', { href: lh, target: '_blank', rel: 'noopener noreferrer' }, l.label || l.url) : (l.label || l.url));
            }))
          : null)
    : null;

  const more = h('details', { class: 'more' },
    h('summary', { class: 'btn btn-small', 'aria-label': `More actions for ${e.title}` }, 'More'),
    h('div', { class: 'more-menu', role: 'group' },
      h('button', { class: 'menu-item', type: 'button', onclick: () => actions.downloadIcs(e) }, 'Add to calendar (.ics)'),
      actions.duplicate ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.duplicate?.(e) }, 'Duplicate') : null,
      h('a', { class: 'menu-item', href: googleCalendarUrl(e), target: '_blank', rel: 'noopener noreferrer' }, 'Add to Google Calendar'),
      href ? h('a', { class: 'menu-item', href, target: '_blank', rel: 'noopener noreferrer' }, 'Open event page') : null,
      status !== 'attended' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'attended') }, application ? 'Mark applied' : 'Mark attended') : null,
      status !== 'missed' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'missed') }, application ? 'Missed the deadline' : 'Mark missed') : null,
      status !== 'cancelled' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'cancelled') }, application ? 'Not pursuing' : 'Mark cancelled') : null,
      status !== 'upcoming' ? h('button', { class: 'menu-item', type: 'button', onclick: () => actions.setStatus(e, 'upcoming') }, application ? 'Reopen' : 'Back to upcoming') : null,
      h('button', { class: 'menu-item menu-danger', type: 'button', onclick: () => actions.remove(e) }, 'Delete')));

  return h('article', { class: `ev ${closed ? 'ev-closed' : ''}`, dataset: { id: e.id, status, type: e.type, stage: e.stage ?? '' }, 'aria-label': e.title },
    h('div', { class: 'ev-stub' },
      h('span', { class: 'ev-time' }, e.time ? time12(e.time) : 'All day'),
      o.showDate ? h('span', { class: 'ev-date' }, dayLabel(e.date, now)) : null,
      !closed ? h('span', { class: 'ev-count' }, countdown(e, now)) : null),
    h('div', { class: 'ev-body' },
      h('h3', { class: 'ev-title' }, e.title),
      meta,
      detailBits.length ? h('p', { class: 'ev-details' }, detailBits.join(' · ')) : null,
      e.notes ? h('p', { class: 'ev-notes' }, e.notes) : null,
      extras,
      h('div', { class: 'ev-actions' },
        ...primary,
        stageSelect,
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => actions.edit(e) }, 'Edit'),
        more)));
}
