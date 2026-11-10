// @ts-check
import { h } from './dom.js';
import { dayLabel, time12 } from './format.js';
import { isApplicationType } from '../domain/opportunity.js';

/** @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent */
/** @typedef {'attended'|'missed'|'cancelled'|'later'} Outcome */

/**
 * "How did it go?" prompt shown once an event has ended.
 * Resolves with the chosen outcome; Escape or "Ask me later" resolves 'later'
 * (the event then waits under "How did these go?" on Today).
 * @param {ShowUpEvent} event
 * @param {{ remaining?: number, now?: Date }} [o]
 * @returns {Promise<Outcome>}
 */
export function askOutcome(event, o = {}) {
  return new Promise((resolve) => {
    const when = `${dayLabel(event.date, o.now ?? new Date())}${event.time ? ` · ${time12(event.time)}` : ''}`;
    const app = isApplicationType(event.type);
    const choice = (/** @type {Outcome} */ value, /** @type {string} */ label, /** @type {string} */ hint, /** @type {string} */ cls) =>
      h('button', { class: `outcome-btn ${cls}`, type: 'submit', value, dataset: { outcome: value } },
        h('span', { class: 'outcome-icon', 'aria-hidden': 'true' }, value === 'attended' ? '✓' : value === 'missed' ? '✕' : '∅'),
        h('span', { class: 'outcome-text' }, h('strong', null, label), h('small', null, hint)));
    const dlg = /** @type {HTMLDialogElement} */ (
      h('dialog', { class: 'dialog dialog-small outcome-dialog', 'aria-labelledby': 'outcome-title', id: 'outcome-dialog' },
        h('form', { method: 'dialog', class: 'stack' },
          h('p', { class: 'eyebrow' }, app ? 'Did you apply?' : 'How did it go?'),
          h('h2', { id: 'outcome-title' }, event.title),
          h('p', { class: 'muted' }, [when, event.location].filter(Boolean).join(' · ')),
          h('div', { class: 'outcome-choices' },
            app ? choice('attended', 'I applied', 'Track it through interviews and results', 'outcome-yes') : choice('attended', 'I went', 'Add it to your history', 'outcome-yes'),
            app ? choice('missed', 'I missed the deadline', 'Keep a record that it slipped', 'outcome-no') : choice('missed', 'I missed it', 'Keep a record that it slipped', 'outcome-no'),
            app ? choice('cancelled', 'Not pursuing', 'Drop it from your list', 'outcome-cx') : choice('cancelled', 'It was cancelled', 'The organiser called it off', 'outcome-cx')),
          h('div', { class: 'row end' },
            o.remaining ? h('span', { class: 'muted' }, `${o.remaining} more to check`) : null,
            h('button', { class: 'btn btn-small', type: 'submit', value: 'later', id: 'outcome-later' }, 'Ask me later'))))
    );
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      resolve(v === 'attended' || v === 'missed' || v === 'cancelled' ? v : 'later');
      dlg.remove();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
