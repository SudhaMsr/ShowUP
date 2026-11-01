// @ts-check
import { dedupeKey, normalizeEvent } from '../domain/event.js';
import { h, toast } from './dom.js';
import { eventForm } from './event-form.js';

/**
 * @typedef {import('../app/store.js').Store} Store
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {import('../domain/capture.js').Draft} Draft
 */

/** @param {HTMLDialogElement} dlg */
function mount(dlg) {
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/**
 * Add or edit a single event with every field.
 * @param {Store} store
 * @param {ShowUpEvent | null} event  null to create
 * @param {{ defaults?: Record<string, unknown> }} [opts]
 */
export function openEditor(store, event, opts = {}) {
  const form = eventForm(event ?? { type: 'meetup', status: 'upcoming', ...opts.defaults }, { full: true });
  const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog', 'aria-labelledby': 'editor-title' }));
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, event ? 'Save changes' : 'Add event');
  const formEl = h('form', { class: 'stack', novalidate: true },
    h('h2', { id: 'editor-title' }, event ? 'Edit event' : 'Add event'),
    form.el,
    h('div', { class: 'row end' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
      saveBtn));
  formEl.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    saveBtn.setAttribute('disabled', '');
    try {
      const res = await store.save({
        ...(event ? { id: event.id, source: event.source } : { source: 'manual' }),
        ...form.read(),
        needsReview: false,
      });
      if (!res.ok) {
        form.setErrors(res.errors);
        return;
      }
      toast(event ? 'Changes saved.' : 'Event added.');
      dlg.close();
    } catch {
      toast('Could not save. Your browser may be blocking storage.', { kind: 'error' });
    } finally {
      saveBtn.removeAttribute('disabled');
    }
  });
  dlg.append(formEl);
  mount(dlg);
}

/**
 * Review captured drafts before anything is saved.
 * @param {Store} store
 * @param {Draft[]} drafts
 * @param {'voice'|'screenshot'|'text'} source
 * @param {{ note?: string }} [opts]
 * @returns {Promise<number>} number of events saved
 */
export function openReview(store, drafts, source, opts = {}) {
  return new Promise((resolve) => {
    let savedTotal = 0;
    const existingKeys = new Set(store.getState().events.map(dedupeKey));
    /** @type {Array<{ card: HTMLElement, form: ReturnType<typeof eventForm>, draft: Draft }>} */
    let rows = [];
    const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog dialog-wide', 'aria-labelledby': 'review-title' }));
    const list = h('div', { class: 'stack' });
    const saveAll = h('button', { class: 'btn btn-primary', type: 'submit' });

    function updateButton() {
      saveAll.textContent = rows.length === 1 ? 'Save event' : `Save ${rows.length} events`;
      if (!rows.length) saveAll.setAttribute('disabled', '');
    }

    /** @param {Draft} d */
    function addRow(d) {
      const form = eventForm(d);
      const dup = d.title && d.date ? existingKeys.has(dedupeKey(normalizeEvent({ ...d, time: d.time }))) : false;
      const remove = h('button', { class: 'btn btn-small', type: 'button', 'aria-label': `Discard draft ${d.title || ''}`.trim() }, 'Discard');
      const card = h('section', { class: 'draft', 'aria-label': d.title || 'Draft event' },
        h('div', { class: 'draft-head' },
          h('span', { class: `chip chip-conf-${d.confidence}` }, d.confidence === 'high' ? 'Looks complete' : d.confidence === 'medium' ? 'Check the details' : 'Needs your input'),
          dup ? h('span', { class: 'chip chip-review' }, 'Looks like one you already have') : null,
          remove),
        form.el);
      remove.addEventListener('click', () => {
        rows = rows.filter((r) => r.card !== card);
        card.remove();
        updateButton();
        if (!rows.length) dlg.close();
      });
      rows.push({ card, form, draft: d });
      list.append(card);
    }
    drafts.forEach(addRow);
    updateButton();

    const formEl = h('form', { class: 'stack', novalidate: true },
      h('h2', { id: 'review-title' }, drafts.length === 1 ? 'Review this event' : `Review ${drafts.length} events`),
      h('p', { class: 'muted' }, opts.note ?? 'Nothing is saved until you confirm. Fix anything that looks off.'),
      list,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        saveAll));

    formEl.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      saveAll.setAttribute('disabled', '');
      try {
        for (const row of [...rows]) {
          const res = await store.save({ ...row.form.read(), source, needsReview: false });
          if (res.ok) {
            savedTotal++;
            rows = rows.filter((r) => r !== row);
            row.card.remove();
          } else {
            row.form.setErrors(res.errors);
          }
        }
        if (!rows.length) {
          toast(savedTotal === 1 ? 'Event saved.' : `${savedTotal} events saved.`);
          dlg.close();
        } else {
          toast('Some events need fixing before they can be saved.', { kind: 'error' });
        }
      } catch {
        toast('Could not save. Your browser may be blocking storage.', { kind: 'error' });
      } finally {
        updateButton();
        if (rows.length) saveAll.removeAttribute('disabled');
      }
    });

    dlg.addEventListener('close', () => resolve(savedTotal));
    dlg.append(formEl);
    mount(dlg);
  });
}

/**
 * Preview an import and let the user confirm.
 * @param {{ title: string, total: number, flagged: number, skipped: Array<{ row: number, reason: string, preview: string }>, extra?: string }} s
 * @returns {Promise<boolean>}
 */
export function openImportPreview(s) {
  return new Promise((resolve) => {
    const shown = s.skipped.slice(0, 8);
    const dlg = /** @type {HTMLDialogElement} */ (
      h('dialog', { class: 'dialog', 'aria-labelledby': 'import-title' },
        h('form', { method: 'dialog', class: 'stack' },
          h('h2', { id: 'import-title' }, s.title),
          h('p', null, h('strong', null, `${s.total} event${s.total === 1 ? '' : 's'}`), ' ready to import.',
            s.flagged ? ` ${s.flagged} ${s.flagged === 1 ? 'has' : 'have'} uncertain details and will be marked "Check details".` : ''),
          s.extra ? h('p', { class: 'muted' }, s.extra) : null,
          s.skipped.length
            ? h('div', null,
                h('p', null, h('strong', null, `${s.skipped.length} row${s.skipped.length === 1 ? '' : 's'} skipped`)),
                h('ul', { class: 'skipped' },
                  shown.map((k) => h('li', null, h('span', { class: 'muted' }, k.row ? `Row ${k.row}: ` : ''), k.reason, k.preview ? h('span', { class: 'muted' }, ` (${k.preview})`) : null)),
                  s.skipped.length > shown.length ? h('li', { class: 'muted' }, `…and ${s.skipped.length - shown.length} more`) : null))
            : null,
          h('div', { class: 'row end' },
            h('button', { class: 'btn', value: 'cancel', type: 'submit' }, 'Cancel'),
            h('button', { class: 'btn btn-primary', value: 'ok', type: 'submit', disabled: s.total === 0 }, 'Import')))));
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'));
    mount(dlg);
  });
}
