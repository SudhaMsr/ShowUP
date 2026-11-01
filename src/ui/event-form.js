// @ts-check
import { EVENT_TYPES, STATUSES } from '../domain/event.js';
import { h } from './dom.js';
import { DEFAULT_REMINDER_SETTINGS } from '../domain/reminders.js';
import { offsetsEditor } from './offsets-editor.js';
import { TYPE_LABEL } from './format.js';

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
    field('type', 'Type', /** @type {HTMLSelectElement} */ (select(EVENT_TYPES.map((t) => [t, TYPE_LABEL[t]]), draft.type ?? 'other'))),
    field('location', 'Location', /** @type {HTMLInputElement} */ (text('location', draft.location)), { wide: true }),
    opts.full ? field('endTime', 'End time', /** @type {HTMLInputElement} */ (h('input', { type: 'time', value: draft.endTime ?? '' }))) : null,
    opts.full ? field('organizer', 'Organiser / series', /** @type {HTMLInputElement} */ (text('organizer', draft.organizer))) : null,
    opts.full ? field('url', 'Link', /** @type {HTMLInputElement} */ (h('input', { type: 'url', value: draft.url ?? '', placeholder: 'https://', maxlength: 2000 })), { wide: true }) : null,
    opts.full ? field('status', 'Status', /** @type {HTMLSelectElement} */ (select(STATUSES.map((s) => [s, s.charAt(0).toUpperCase() + s.slice(1)]), draft.status ?? 'upcoming'))) : null,
    opts.full ? field('reminders', 'Remind me', reminderSelect) : null,
    opts.full ? offsetsBox : null,
    opts.full ? field('notes', 'Notes', /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 3, maxlength: 2000 }, draft.notes ?? '')), { wide: true }) : null,
  );

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
