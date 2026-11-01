// @ts-check
import { EVENT_TYPES, byStart } from '../../domain/event.js';
import { h } from '../dom.js';
import { eventCard } from '../event-card.js';
import { dayHeading, monthLabel, TYPE_LABEL } from '../format.js';

/**
 * @typedef {import('./today.js').ViewCtx} ViewCtx
 * @typedef {{ q: string, type: string, scope: 'upcoming'|'history'|'all' }} Filters
 */

/** @type {Filters} */
const filters = { q: '', type: 'all', scope: 'upcoming' };

/** @param {import('../../domain/event.js').ShowUpEvent} e @param {Filters} f @param {string} today */
function matches(e, f, today) {
  if (f.scope === 'upcoming' && !(e.status === 'upcoming')) return false;
  if (f.scope === 'history' && e.status === 'upcoming' && e.date >= today) return false;
  if (f.type !== 'all' && e.type !== f.type) return false;
  if (f.q) {
    const hay = `${e.title} ${e.location} ${e.organizer} ${e.notes}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** @param {ViewCtx} ctx */
export function renderUpcoming(ctx) {
  const { now, actions } = ctx;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const results = h('div', { class: 'stack-lg', 'aria-live': 'polite' });

  function paint() {
    const all = ctx.store.getState().events.filter((e) => matches(e, filters, today));
    all.sort(filters.scope === 'history' ? (a, b) => byStart(b, a) : byStart);
    results.replaceChildren();
    if (!all.length) {
      results.append(h('p', { class: 'empty-note' }, filters.q || filters.type !== 'all' ? 'No events match those filters.' : 'No events here yet.'));
      return;
    }
    /** @type {Map<string, Map<string, typeof all>>} */
    const months = new Map();
    for (const e of all) {
      const m = e.date.slice(0, 7);
      if (!months.has(m)) months.set(m, new Map());
      const days = /** @type {Map<string, typeof all>} */ (months.get(m));
      if (!days.has(e.date)) days.set(e.date, []);
      /** @type {typeof all} */ (days.get(e.date)).push(e);
    }
    for (const [m, days] of months) {
      results.append(
        h('section', { class: 'group' },
          h('h2', { class: 'group-title' }, monthLabel(`${m}-01`)),
          ...[...days].map(([date, list]) =>
            h('div', { class: 'day' },
              h('h3', { class: 'day-title' }, dayHeading(date, now)),
              h('div', { class: 'list' }, list.map((e) => eventCard(e, { now, actions, outcome: e.status === 'upcoming' && e.date < today })))))));
    }
  }

  const search = h('input', { type: 'search', id: 'q', value: filters.q, placeholder: 'Search title, place, organiser…', autocomplete: 'off', 'aria-label': 'Search events' });
  search.addEventListener('input', () => {
    filters.q = /** @type {HTMLInputElement} */ (search).value.trim();
    paint();
  });
  const typeSel = h('select', { id: 'type-filter', 'aria-label': 'Filter by type' },
    h('option', { value: 'all' }, 'All types'),
    EVENT_TYPES.map((t) => h('option', { value: t, selected: filters.type === t }, TYPE_LABEL[t])));
  typeSel.addEventListener('change', () => {
    filters.type = /** @type {HTMLSelectElement} */ (typeSel).value;
    paint();
  });
  const scopeBtns = /** @type {Array<['upcoming'|'history'|'all', string]>} */ ([['upcoming', 'Upcoming'], ['history', 'History'], ['all', 'All']]).map(([v, l]) => {
    const b = h('button', { class: `seg ${filters.scope === v ? 'seg-on' : ''}`, type: 'button', 'aria-pressed': String(filters.scope === v) }, l);
    b.addEventListener('click', () => {
      filters.scope = v;
      scopeBtns.forEach((x, i) => {
        const on = ['upcoming', 'history', 'all'][i] === v;
        x.classList.toggle('seg-on', on);
        x.setAttribute('aria-pressed', String(on));
      });
      paint();
    });
    return b;
  });

  paint();
  return h('div', { class: 'stack-lg' },
    h('div', { class: 'toolbar' }, h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Show' }, scopeBtns), typeSel, search),
    results);
}
