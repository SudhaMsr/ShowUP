// @ts-check
import { h } from './dom.js';

/**
 * Command palette (Ctrl/Cmd+K): jump anywhere or run an action by typing.
 * @typedef {{ id: string, label: string, hint?: string, run: () => void }} Command
 * @param {() => Command[]} getCommands
 */
export function installPalette(getCommands) {
  /** @type {HTMLDialogElement|null} */
  let dlg = null;

  const open = () => {
    if (dlg || document.querySelector('dialog[open]')) return;
    const commands = getCommands();
    let active = 0;
    /** @type {Command[]} */
    let shown = commands;
    const input = /** @type {HTMLInputElement} */ (h('input', { id: 'palette-input', type: 'text', placeholder: 'Type a command or search events…', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', 'aria-label': 'Command palette' }));
    const list = h('ul', { class: 'pal-list', id: 'palette-list', role: 'listbox' });
    const d = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog pal', id: 'palette', 'aria-label': 'Command palette' }, h('div', { class: 'pal-box' }, input, list, h('p', { class: 'pal-foot' }, '↑ ↓ to move · Enter to run · Esc to close'))));
    dlg = d;

    const close = () => d.close();
    const paint = () => {
      list.replaceChildren(...(shown.length
        ? shown.map((c, i) => {
            const li = h('li', { class: `pal-item${i === active ? ' on' : ''}`, role: 'option', 'aria-selected': String(i === active), dataset: { id: c.id }, onclick: () => { close(); c.run(); } },
              h('span', {}, c.label), c.hint ? h('small', {}, c.hint) : null);
            return li;
          })
        : [h('li', { class: 'pal-empty' }, 'Nothing matches.')]));
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      shown = commands.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(w))).slice(0, 12);
      active = 0;
      paint();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { active = Math.min(shown.length - 1, active + 1); paint(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && shown[active]) { const c = shown[active]; close(); c.run(); ev.preventDefault(); }
    });
    d.addEventListener('click', (ev) => { if (ev.target === d) close(); });
    d.addEventListener('close', () => { d.remove(); dlg = null; });
    document.body.appendChild(d);
    paint();
    d.showModal();
    input.focus();
  };

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      open();
    }
  });
  return open;
}
