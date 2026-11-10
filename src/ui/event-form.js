// @ts-check
import { EVENT_TYPES, STATUSES } from '../domain/event.js';
import { h } from './dom.js';
import { DEFAULT_REMINDER_SETTINGS } from '../domain/reminders.js';
import { offsetsEditor } from './offsets-editor.js';
import { TYPE_LABEL } from './format.js';
import {
  APPLICATION_TYPES, COMPETITION_TYPES, MAX_LINKS, MAX_TASKS,
  dateLabel, defaultStage, fieldsFor, hasPipeline, isCompetitionType, organizerLabel, pipelineFor, templateTasks,
} from '../domain/opportunity.js';

const OPPORTUNITY_TYPES = [...APPLICATION_TYPES, ...COMPETITION_TYPES];
const ORDERED_OPPORTUNITIES = ['hackathon', 'internship', 'scholarship', 'fellowship', 'competition'];

let uid = 0;

/**
 * Event fields as a reusable form body.
 * @param {Record<string, any>} draft  event-like object (may carry `issues`)
 * @param {{ full?: boolean }} [opts]
 */
export function eventForm(draft, opts = {}) {
  const n = ++uid;
  const issues = new Set(/** @type {string[]} */ (draft.issues ?? []));
  /** @type {Record<string, HTMLElement>} */
  const errorSlots = {};
  /** @type {Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>} */
  const inputs = {};

  /**
   * @param {string} name @param {string} label @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} input
   * @param {{ hint?: string, wide?: boolean, flag?: boolean }} [o]
   */
  function field(name, label, input, o = {}) {
    const id = `f${n}-${name}`;
    input.id = id;
    input.name = name;
    inputs[name] = input;
    const err = h('p', { class: 'field-error', id: `${id}-err`, role: 'alert' });
    errorSlots[name] = err;
    input.setAttribute('aria-describedby', `${id}-err${o.hint ? ` ${id}-hint` : ''}`);
    return h('div', { class: `field ${o.wide ? 'field-wide' : ''} ${o.flag ? 'field-flag' : ''}` },
      h('label', { for: id }, label),
      input,
      o.hint ? h('p', { class: 'field-hint', id: `${id}-hint` }, o.hint) : null,
      err);
  }

  const text = (/** @type {string} */ name, /** @type {any} */ v, extra = {}) => h('input', { type: 'text', value: v ?? '', autocomplete: 'off', maxlength: 200, ...extra });
  const select = (/** @type {Array<[string,string]>} */ options, /** @type {string} */ value) =>
    h('select', null, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

  /** Type select, grouped so opportunities are easy to find. @param {string} value */
  function typeSelect(value) {
    const opt = (/** @type {string} */ t) => h('option', { value: t, selected: t === value }, TYPE_LABEL[t] ?? t);
    return h('select', null,
      h('optgroup', { label: 'Opportunities' }, ORDERED_OPPORTUNITIES.filter((t) => EVENT_TYPES.includes(/** @type {any} */ (t))).map(opt)),
      h('optgroup', { label: 'Events' }, EVENT_TYPES.filter((t) => !OPPORTUNITY_TYPES.includes(t)).map(opt)));
  }

  // Reminders: use my defaults / none / pick my own (presets + custom times).
  const reminderMode = draft.reminders == null ? 'default' : draft.reminders.length ? 'custom' : 'none';
  const offsets = offsetsEditor(draft.reminders?.length ? draft.reminders : DEFAULT_REMINDER_SETTINGS.reminderOffsets);
  const offsetsBox = h('div', { class: 'field field-wide', id: `f${n}-offsets`, hidden: reminderMode !== 'custom' }, offsets.el);
  const reminderSelect = /** @type {HTMLSelectElement} */ (
    select([['default', 'My default reminders'], ['none', 'No reminders'], ['custom', 'Choose times…']], reminderMode)
  );
  reminderSelect.addEventListener('change', () => {
    offsetsBox.hidden = reminderSelect.value !== 'custom';
  });

  const typeField = field('type', 'Type', /** @type {HTMLSelectElement} */ (opts.full ? typeSelect(draft.type ?? 'other') : select(EVENT_TYPES.map((t) => [t, TYPE_LABEL[t]]), draft.type ?? 'other')));
  // ---- Opportunity parts (full form only): stage, deadline, typed details, links, checklist ----
  const typeInput = /** @type {HTMLSelectElement} */ (inputs.type);
  const stageSel = /** @type {HTMLSelectElement} */ (h('select'));
  const stageField = field('stage', 'Stage', stageSel);
  const deadlineField = field('deadline', 'Registration / submission deadline', /** @type {HTMLInputElement} */ (h('input', { type: 'date', value: draft.deadline ?? '' })), {
    hint: 'Optional. You get reminders 3 days, 1 day and the morning of.',
  });
  const detailsBox = h('div', { class: 'field field-wide details-grid' });
  /** @type {Record<string, HTMLInputElement | HTMLSelectElement>} */
  const detailInputs = {};
  /** @type {Record<string, string>} */
  const detailValues = { ...(draft.details ?? {}) };

  /** @param {string} type */
  function renderStage(type) {
    const stages = pipelineFor(type);
    const keep = stageSel.value || draft.stage || '';
    const pick = stages.some((x) => x.id === keep) ? keep : defaultStage(type);
    stageSel.textContent = '';
    for (const st of stages) stageSel.append(h('option', { value: st.id, selected: st.id === pick }, st.label));
  }

  /** @param {string} type */
  function renderDetails(type) {
    for (const [k, inp] of Object.entries(detailInputs)) detailValues[k] = inp.value;
    detailsBox.textContent = '';
    for (const k of Object.keys(detailInputs)) delete detailInputs[k];
    for (const spec of fieldsFor(type)) {
      const id = `f${n}-d-${spec.key}`;
      const inp = spec.options
        ? /** @type {HTMLSelectElement} */ (h('select', { id }, h('option', { value: '' }, 'Not set'), spec.options.map((o) => h('option', { value: o, selected: detailValues[spec.key] === o }, o))))
        : /** @type {HTMLInputElement} */ (h('input', { id, type: 'text', maxlength: 120, autocomplete: 'off', value: detailValues[spec.key] ?? '', placeholder: spec.placeholder ?? '' }));
      detailInputs[spec.key] = inp;
      detailsBox.append(h('div', { class: 'field' }, h('label', { for: id }, spec.label), inp));
    }
    detailsBox.hidden = detailsBox.childElementCount === 0;
  }

  // Links editor
  /** @type {Array<{ row: HTMLElement, label: HTMLInputElement, url: HTMLInputElement }>} */
  const linkRows = [];
  const linksList = h('div', { class: 'rows' });
  const addLinkBtn = h('button', { class: 'btn btn-small', type: 'button' }, 'Add link');
  /** @param {{label?: string, url?: string}} [l] */
  function addLink(l = {}) {
    if (linkRows.length >= MAX_LINKS) return;
    const label = /** @type {HTMLInputElement} */ (h('input', { type: 'text', maxlength: 60, placeholder: 'Label (e.g. Rules)', value: l.label ?? '', 'aria-label': 'Link label' }));
    const url = /** @type {HTMLInputElement} */ (h('input', { type: 'url', maxlength: 2000, placeholder: 'https://', value: l.url ?? '', 'aria-label': 'Link address' }));
    const row = h('div', { class: 'row-edit' }, label, url,
      h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Remove link', onclick: () => {
        linkRows.splice(linkRows.findIndex((r) => r.row === row), 1);
        row.remove();
        addLinkBtn.hidden = false;
      } }, 'Remove'));
    linkRows.push({ row, label, url });
    linksList.append(row);
    addLinkBtn.hidden = linkRows.length >= MAX_LINKS;
  }
  addLinkBtn.addEventListener('click', () => addLink());
  for (const l of draft.links ?? []) addLink(l);
  const linksBox = h('div', { class: 'field field-wide' }, h('span', { class: 'label' }, 'Links'), linksList, addLinkBtn);

  // Checklist editor
  /** @type {Array<{ row: HTMLElement, done: HTMLInputElement, text: HTMLInputElement }>} */
  const taskRows = [];
  const tasksList = h('div', { class: 'rows' });
  const addTaskBtn = h('button', { class: 'btn btn-small', type: 'button' }, 'Add task');
  const starterBtn = h('button', { class: 'btn btn-small', type: 'button' }, 'Use starter checklist');
  /** @param {{text?: string, done?: boolean}} [t] */
  function addTask(t = {}) {
    if (taskRows.length >= MAX_TASKS) return;
    const done = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: t.done === true, 'aria-label': 'Done' }));
    const textInp = /** @type {HTMLInputElement} */ (h('input', { type: 'text', maxlength: 120, placeholder: 'What needs doing?', value: t.text ?? '', 'aria-label': 'Task' }));
    const row = h('div', { class: 'row-edit row-task' }, done, textInp,
      h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Remove task', onclick: () => {
        taskRows.splice(taskRows.findIndex((r) => r.row === row), 1);
        row.remove();
        refreshStarter();
      } }, 'Remove'));
    taskRows.push({ row, done, text: textInp });
    tasksList.append(row);
    refreshStarter();
  }
  function refreshStarter() {
    starterBtn.hidden = taskRows.length > 0 || templateTasks(typeInput.value).length === 0;
    addTaskBtn.hidden = taskRows.length >= MAX_TASKS;
  }
  addTaskBtn.addEventListener('click', () => addTask());
  starterBtn.addEventListener('click', () => {
    for (const t of templateTasks(typeInput.value)) addTask(t);
  });
  for (const t of draft.tasks ?? []) addTask(t);
  const tasksBox = h('div', { class: 'field field-wide' }, h('span', { class: 'label' }, 'Checklist'), tasksList, h('div', { class: 'row' }, addTaskBtn, starterBtn));

  /** Re-label and show/hide everything that depends on the type. */
  function applyType() {
    const type = typeInput.value;
    stageField.hidden = !hasPipeline(type);
    deadlineField.hidden = !isCompetitionType(type);
    renderStage(type);
    renderDetails(type);
    const dateLabelEl = el.querySelector(`label[for="f${n}-date"]`);
    if (dateLabelEl) dateLabelEl.textContent = dateLabel(type);
    const orgLabelEl = el.querySelector(`label[for="f${n}-organizer"]`);
    if (orgLabelEl) orgLabelEl.textContent = organizerLabel(type);
    refreshStarter();
  }
  const el = h('div', { class: 'form-grid' },
    field('title', 'Title', /** @type {HTMLInputElement} */ (text('title', draft.title, { required: true, maxlength: 200 })), { wide: true, flag: issues.has('title') }),
    field('date', 'Date', /** @type {HTMLInputElement} */ (h('input', { type: 'date', value: draft.date ?? '', required: true })), {
      flag: issues.has('date'),
      hint: issues.has('date') ? 'Check this date, it was not clear in the source.' : undefined,
    }),
    field('time', 'Start time', /** @type {HTMLInputElement} */ (h('input', { type: 'time', value: draft.time ?? '' })), {
      flag: issues.has('time'),
      hint: issues.has('time') ? 'Check am/pm, it was not clear in the source.' : 'Leave empty for all day.',
    }),
    typeField,
    opts.full ? stageField : null,
    opts.full ? deadlineField : null,
    opts.full ? detailsBox : null,
    field('location', 'Location', /** @type {HTMLInputElement} */ (text('location', draft.location)), { wide: true }),
    opts.full ? field('endTime', 'End time', /** @type {HTMLInputElement} */ (h('input', { type: 'time', value: draft.endTime ?? '' }))) : null,
    opts.full ? field('organizer', 'Organiser / series', /** @type {HTMLInputElement} */ (text('organizer', draft.organizer))) : null,
    opts.full ? field('url', 'Link', /** @type {HTMLInputElement} */ (h('input', { type: 'url', value: draft.url ?? '', placeholder: 'https://', maxlength: 2000 })), { wide: true }) : null,
    opts.full ? field('status', 'Status', /** @type {HTMLSelectElement} */ (select(STATUSES.map((s) => [s, s.charAt(0).toUpperCase() + s.slice(1)]), draft.status ?? 'upcoming'))) : null,
    opts.full ? field('reminders', 'Remind me', reminderSelect) : null,
    opts.full ? offsetsBox : null,
    opts.full ? field('notes', 'Notes', /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 5, maxlength: 10000 }, draft.notes ?? '')), { wide: true }) : null,
    opts.full ? linksBox : null,
    opts.full ? tasksBox : null,
  );
  if (opts.full) {
    typeInput.addEventListener('change', applyType);
    applyType();
  }

  return {
    el,
    /** Current values as an event-shaped object (id/source carried from the draft). */
    read() {
      const v = (/** @type {string} */ k) => inputs[k]?.value ?? '';
      /** @type {Record<string, unknown>} */
      const out = {
        title: v('title'),
        date: v('date'),
        time: v('time') || null,
        type: v('type'),
        location: v('location'),
      };
      if (opts.full) {
        out.endTime = v('endTime') || null;
        out.organizer = v('organizer');
        out.url = v('url');
        out.status = v('status');
        out.notes = v('notes');
        out.stage = hasPipeline(v('type')) ? v('stage') || null : null;
        out.deadline = isCompetitionType(v('type')) ? v('deadline') || null : null;
        out.details = Object.fromEntries(Object.entries(detailInputs).map(([k, inp]) => [k, inp.value]));
        out.links = linkRows.map((r) => ({ label: r.label.value, url: r.url.value })).filter((l) => l.url.trim());
        out.tasks = taskRows.map((r) => ({ text: r.text.value, done: r.done.checked })).filter((t) => t.text.trim());
        const mode = v('reminders');
        out.reminders = mode === 'none' ? [] : mode === 'custom' ? offsets.get() : null;
      }
      return out;
    },
    /** @param {Record<string,string>} errors */
    setErrors(errors) {
      for (const [name, slot] of Object.entries(errorSlots)) {
        slot.textContent = errors[name] ?? '';
        inputs[name]?.setAttribute('aria-invalid', errors[name] ? 'true' : 'false');
      }
      const first = Object.keys(errors).find((k) => inputs[k]);
      if (first) inputs[first].focus();
    },
  };
}
