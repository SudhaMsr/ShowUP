// @ts-check
import { describeOffset, MAX_OFFSETS, parseOffsetInput } from '../domain/reminders.js';
import { h } from './dom.js';

/** Quick-pick reminder times, in minutes before the start. */
export const PRESET_OFFSETS = [1440, 180, 60, 15, 5, 1, 0];

/** Short label used on chips ("1 hr", "15 min"). @param {number} m */
export function chipLabel(m) {
  if (m === 0) return 'At start';
  const d = Math.floor(m / 1440);
  const hh = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return [d ? `${d} day${d === 1 ? '' : 's'}` : '', hh ? `${hh} hr` : '', mm ? `${mm} min` : ''].filter(Boolean).join(' ');
}

let uid = 0;

/**
 * Pick any combination of reminder times: tap presets, or add a custom one
 * (for example 90 minutes, or 3 days).
 * @param {number[]} initial
 * @param {(offsets: number[]) => void} [onChange]
 */
export function offsetsEditor(initial, onChange) {
  const n = ++uid;
  const chosen = new Set(initial);
  const chipRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Reminder times' });
  const error = h('p', { class: 'field-error', id: `off-err-${n}`, role: 'alert' });
  const amount = /** @type {HTMLInputElement} */ (
    h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '43200', step: '1', placeholder: '90', id: `off-amount-${n}`, 'aria-label': 'Custom reminder amount', class: 'off-amount', 'aria-describedby': `off-err-${n}` })
  );
  const unit = /** @type {HTMLSelectElement} */ (
    h('select', { id: `off-unit-${n}`, 'aria-label': 'Custom reminder unit', class: 'off-unit' },
      h('option', { value: 'minutes' }, 'minutes before'),
      h('option', { value: 'hours' }, 'hours before'),
      h('option', { value: 'days' }, 'days before'))
  );

  const sorted = () => [...chosen].sort((a, b) => b - a);
  const emit = () => onChange?.(sorted());

  function paint() {
    const all = [...new Set([...PRESET_OFFSETS, ...chosen])].sort((a, b) => b - a);
    chipRow.replaceChildren(
      ...all.map((m) => {
        const on = chosen.has(m);
        const custom = !PRESET_OFFSETS.includes(m);
        return h('button', {
          type: 'button',
          class: `chip-toggle${on ? ' on' : ''}${custom ? ' custom' : ''}`,
          'aria-pressed': String(on),
          title: describeOffset(m),
          dataset: { offset: String(m) },
          onclick: () => {
            if (on) chosen.delete(m);
            else if (chosen.size >= MAX_OFFSETS) {
              error.textContent = `You can set up to ${MAX_OFFSETS} reminders per event.`;
              return;
            } else chosen.add(m);
            error.textContent = '';
            paint();
            emit();
          },
        }, chipLabel(m));
      }),
    );
  }

  function addCustom() {
    const minutes = parseOffsetInput(amount.value, unit.value);
    if (minutes === null) {
      error.textContent = 'Enter a whole number, up to 30 days.';
      amount.setAttribute('aria-invalid', 'true');
      amount.focus();
      return;
    }
    if (!chosen.has(minutes) && chosen.size >= MAX_OFFSETS) {
      error.textContent = `You can set up to ${MAX_OFFSETS} reminders per event.`;
      return;
    }
    chosen.add(minutes);
    amount.value = '';
    amount.removeAttribute('aria-invalid');
    error.textContent = '';
    paint();
    emit();
  }
  amount.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      addCustom();
    }
  });

  paint();
  const el = h('div', { class: 'offsets-editor' },
    chipRow,
    h('div', { class: 'off-custom' },
      h('span', { class: 'off-custom-label' }, 'Custom'),
      amount, unit,
      h('button', { type: 'button', class: 'btn btn-small', id: `off-add-${n}`, dataset: { role: 'add-custom' }, onclick: addCustom }, 'Add')),
    error);
  return { el, get: sorted };
}
