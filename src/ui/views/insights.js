// @ts-check
import { localISO } from '../../domain/dates.js';
import { eventsInWeek, overall, weeklyStats } from '../../domain/stats.js';
import { h, s } from '../dom.js';
import { countUp } from '../motion.js';
import { dayLabel, time12, TYPE_LABEL } from '../format.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

const SPANS = [4, 8, 12];
const view = { span: 8, week: /** @type {string|null} */ (null) };

const fmtRange = (/** @type {string} */ a, /** @type {string} */ b) => {
  const f = (/** @type {string} */ iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${f(a)} – ${f(b)}`;
};

/** Animated success-rate ring. @param {number|null} pct */
function ring(pct) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const arc = s('circle', { class: 'ring-arc', cx: 70, cy: 70, r, fill: 'none', 'stroke-width': 13, 'stroke-linecap': 'round', stroke: 'url(#ringGrad)', 'stroke-dasharray': c, 'stroke-dashoffset': c, transform: 'rotate(-90 70 70)' });
  const svg = s('svg', { class: 'ring', viewBox: '0 0 140 140', role: 'img', 'aria-label': pct === null ? 'No success rate yet' : `Success rate ${pct} percent` },
    s('defs', {}, (() => {
      const g = s('linearGradient', { id: 'ringGrad', x1: 0, y1: 0, x2: 1, y2: 1 });
      g.append(s('stop', { offset: '0%', 'stop-color': 'var(--teal)' }), s('stop', { offset: '100%', 'stop-color': 'var(--violet)' }));
      return g;
    })()),
    s('circle', { cx: 70, cy: 70, r, fill: 'none', 'stroke-width': 13, stroke: 'var(--line)' }),
    arc);
  // Fill after layout so the CSS transition has something to animate from.
  requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', String(c * (1 - (pct ?? 0) / 100)))));
  return svg;
}

/** @param {string} label @param {number} n @param {string} cls @param {string} [hint] */
function stat(label, n, cls, hint) {
  const num = h('strong', { class: 'stat-num' });
  countUp(num, n);
  return h('div', { class: `stat ${cls}` }, num, h('span', { class: 'stat-label' }, label), hint ? h('small', {}, hint) : null);
}

/** @param {ViewCtx} ctx */
export function renderInsights(ctx) {
  const { store, now } = ctx;
  const events = store.getState().events;
  const today = localISO(now);
  const all = overall(events, today);
  const root = h('div', { class: 'stack-lg insights' });

  if (!all.attended && !all.missed && !all.cancelled) {
    root.append(h('div', { class: 'empty' },
      h('h2', {}, 'Your stats start with your first event'),
      h('p', { class: 'muted' }, 'When an event ends, ShowUp asks how it went. Say “I went” or “I missed it” and your weekly success rate shows up here.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.goto('#/capture') }, 'Capture an event')));
    return root;
  }

  const body = h('div', { class: 'stack-lg' });
  const paint = () => {
    const weeks = weeklyStats(events, today, view.span);
    const current = weeks[weeks.length - 1];
    const selected = weeks.find((w) => w.start === view.week) ?? current;
    view.week = selected.start;
    const max = Math.max(1, ...weeks.map((w) => w.total));

    const chart = h('div', { class: 'wk-chart', role: 'group', 'aria-label': 'Events per week. Choose a week to see its events.' },
      weeks.map((w, i) => {
        const seg = (/** @type {string} */ cls, /** @type {number} */ n) => (n ? h('i', { class: `seg ${cls}`, style: undefined, dataset: { n: String(n) } }) : null);
        const col = h('div', { class: 'wk-col', style: undefined },
          seg('s-attended', w.attended), seg('s-missed', w.missed), seg('s-review', w.toReview), seg('s-upcoming', w.upcoming), seg('s-cancelled', w.cancelled));
        col.style.setProperty('--h', `${(w.total / max) * 100}%`);
        for (const sg of col.children) /** @type {HTMLElement} */ (sg).style.flexGrow = /** @type {HTMLElement} */ (sg).dataset.n ?? '1';
        const btn = h('button', {
          class: `wk${w.start === selected.start ? ' on' : ''}${w === current ? ' now' : ''}`, type: 'button', dataset: { week: w.start }, 'aria-pressed': String(w.start === selected.start),
          'aria-label': `${fmtRange(w.start, w.end)}: ${w.attended} attended, ${w.missed} missed, ${w.cancelled} cancelled${w.rate === null ? '' : `, ${w.rate} percent`}`,
          onclick: () => {
            view.week = w.start;
            paint();
          },
        }, h('span', { class: 'wk-rate' }, w.rate === null ? '·' : `${w.rate}%`), h('span', { class: 'wk-track' }, col), h('span', { class: 'wk-label' }, w === current ? 'This wk' : fmtRange(w.start, w.end).split(' – ')[0]));
        btn.style.setProperty('--i', String(i));
        return btn;
      }));

    const picked = eventsInWeek(events, selected.start);
    const detail = h('section', { class: 'panel wk-detail', 'aria-live': 'polite', id: 'wk-detail' },
      h('div', { class: 'wk-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, selected === current ? 'This week' : 'Week of'), h('h2', {}, fmtRange(selected.start, selected.end))),
        h('div', { class: 'wk-pills' },
          h('span', { class: 'pill p-attended' }, `${selected.attended} attended`),
          h('span', { class: 'pill p-missed' }, `${selected.missed} missed`),
          selected.cancelled ? h('span', { class: 'pill p-cancelled' }, `${selected.cancelled} cancelled`) : null,
          selected.toReview ? h('span', { class: 'pill p-review' }, `${selected.toReview} to review`) : null,
          selected.upcoming ? h('span', { class: 'pill p-upcoming' }, `${selected.upcoming} coming up`) : null,
          h('span', { class: 'pill p-rate' }, selected.rate === null ? 'No rate yet' : `${selected.rate}% success`))),
      picked.length
        ? h('ul', { class: 'wk-list' }, picked.map((e) =>
            h('li', { class: `wk-item st-${e.status}`, dataset: { type: e.type } },
              h('span', { class: 'wk-dot', 'aria-hidden': 'true' }),
              h('span', { class: 'wk-when' }, `${dayLabel(e.date, now)}${e.time ? ` · ${time12(e.time)}` : ''}`),
              h('span', { class: 'wk-title' }, e.title),
              h('span', { class: 'wk-status' }, e.status === 'upcoming' && e.date < today ? 'to review' : e.status))))
        : h('p', { class: 'muted' }, 'No events this week.'));

    const spanSwitch = h('div', { class: 'seg-switch', role: 'group', 'aria-label': 'Weeks shown' },
      SPANS.map((n) => h('button', { type: 'button', 'aria-pressed': String(n === view.span), class: n === view.span ? 'on' : '', onclick: () => { view.span = n; view.week = null; paint(); } }, `${n} weeks`)));

    const legend = h('ul', { class: 'legend', 'aria-hidden': 'true' },
      [['s-attended', 'Attended'], ['s-missed', 'Missed'], ['s-review', 'To review'], ['s-upcoming', 'Upcoming'], ['s-cancelled', 'Cancelled']].map(([c, t]) => h('li', {}, h('i', { class: `seg ${c}` }), t)));

    const byType = h('section', { class: 'panel' },
      h('h2', {}, 'By type of event'),
      all.byType.length
        ? h('div', { class: 'bt' }, all.byType.map((t, i) => {
            const bar = h('span', { class: 'bt-fill', dataset: { type: t.type } });
            bar.style.setProperty('--w', `${t.rate ?? 0}%`);
            bar.style.setProperty('--i', String(i));
            return h('div', { class: 'bt-row' }, h('span', { class: 'bt-name' }, TYPE_LABEL[t.type] ?? t.type), h('span', { class: 'bt-bar' }, bar), h('span', { class: 'bt-val' }, `${t.rate}% · ${t.attended}/${t.attended + t.missed}`));
          }))
        : h('p', { class: 'muted' }, 'Appears once you have marked events attended or missed.'));

    const hint = all.rate === null ? 'Needs an attended or missed event' : all.rate >= 80 ? 'Brilliant. Keep it up.' : all.rate >= 50 ? 'Solid. A bit more to go.' : 'Reminders can help. Try adding a 1-day nudge.';
    body.replaceChildren(
      h('div', { class: 'hero-stats' },
        h('div', { class: 'ring-card' }, ring(all.rate), h('div', { class: 'ring-center' }, (() => { const n = h('strong', {}); if (all.rate === null) n.textContent = '–'; else countUp(n, all.rate); return h('span', { class: 'ring-pct' }, n, all.rate === null ? '' : '%'); })(), h('small', {}, 'success rate'))),
        h('div', { class: 'stats-grid' },
          stat('Attended', all.attended, 'st-a'), stat('Missed', all.missed, 'st-m'), stat('Streak', all.streak, 'st-s', all.streak === 1 ? 'event in a row' : 'events in a row'), stat('To review', all.toReview, 'st-r'),
          h('p', { class: 'stats-hint' }, hint))),
      h('section', { class: 'panel' },
        h('div', { class: 'chart-head' }, h('h2', {}, 'Week by week'), spanSwitch),
        chart, legend),
      detail,
      byType);
  };
  paint();
  root.append(body);
  return root;
}
