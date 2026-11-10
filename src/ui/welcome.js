// @ts-check
import { h, s } from './dom.js';
import { reducedMotion } from './motion.js';

/** @typedef {import('./views/today.js').ViewCtx} ViewCtx */

const TABS = [
  {
    id: 'capture', label: 'Capture',
    title: 'Paste it, say it or snap it.',
    body: 'Found a hackathon poster, a scholarship email or a deadline in a group chat? Drop in the text or a screenshot, or just say it out loud. ShowUp fills in the date, the type and the organiser for you to confirm.',
    mock: ['“Rhodes Scholarship closes 28 Nov”', 'Type: Scholarship', 'Deadline: Sat 28 Nov', 'Stage: Found'],
    href: '#/capture', cta: 'Open Capture',
  },
  {
    id: 'track', label: 'Track',
    title: 'Every opportunity, start to result.',
    body: 'Move each one from Found to Preparing, Applied, Interview and Offer. Add a checklist, links and notes, and see what you submitted and what slipped by.',
    mock: ['Found  ›  Preparing  ›  Applied', 'Checklist 3/5', 'careers.example.com', 'Ask Priya for a referral'],
    href: '#/board', cta: 'Open the board',
  },
  {
    id: 'remind', label: 'Remind',
    title: 'Nudges that arrive before it is too late.',
    body: 'Get a heads-up 3 days and 1 day before a deadline, and stop hearing about it the moment you submit. Optionally send reminders to your phone through ntfy, Telegram or email, even when the app is closed.',
    mock: ['3 days before · 9:00', '1 day before · 9:00', 'Submitted: reminders stop', 'Sent to ntfy ✓'],
    href: '#/settings', cta: 'Set up reminders',
  },
];

const ROWS = [
  { href: '#/capture', title: 'Capture an opportunity in seconds', hint: 'Voice, screenshot, text or a spreadsheet', icon: 'M4 7h4l2-2h4l2 2h4v12H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' },
  { href: '#/board', title: 'Move applications through stages', hint: 'Drag cards across a board that fits your pipeline', icon: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z' },
  { href: '#/insights', title: 'See how much you actually submit', hint: 'Follow-through, win rate and what is closing soon', icon: 'M4 19V9M10 19V5M16 19v-7M22 19H2' },
  { href: '#/settings', title: 'Get reminders even when the app is closed', hint: 'Bring your own relay: ntfy, Telegram, email or Web Push', icon: 'M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5zM10 20a2 2 0 0 0 4 0' },
];

const TYPES = ['Hackathons', 'Internships', 'Scholarships', 'Fellowships', 'Competitions', 'Webinars', 'Workshops', 'Interviews', 'Conferences', 'Meetups'];

/** Stagger index for CSS animations (set through CSSOM: the page's CSP blocks style attributes). @param {HTMLElement} el @param {number} i */
const stagger = (el, i) => {
  el.style.setProperty('--i', String(i));
  return el;
};

/** @param {string} d @param {number} [size] */
const icon = (d, size = 22) =>
  s('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s('path', { d }));

/**
 * The first thing someone sees before they have added anything: what ShowUp is for,
 * a looping demo, and ways in. Everything animates in on scroll and respects reduced motion.
 * @param {ViewCtx} ctx
 */
export function welcome(ctx) {
  const video = /** @type {HTMLVideoElement} */ (h('video', { class: 'wl-video', muted: true, loop: true, playsinline: true, preload: 'metadata', poster: 'media/hero-poster.png', 'aria-label': 'Demo: an opportunity moves from Found to Offer while a deadline reminder appears', tabindex: '-1' }, h('source', { src: 'media/hero.mp4', type: 'video/mp4' })));
  video.muted = true;
  if (!reducedMotion()) video.autoplay = true;
  const frame = h('div', { class: 'wl-frame', 'data-reveal': '' },
    video,
    h('span', { class: 'wl-float wl-float-a' }, 'Deadline in 3 days'),
    h('span', { class: 'wl-float wl-float-b' }, 'Applied ✓'));
  const playBtn = h('button', { class: 'wl-play', type: 'button', 'aria-label': 'Pause the demo', 'aria-pressed': 'false' }, 'Pause');
  playBtn.addEventListener('click', () => {
    const paused = !video.paused;
    if (paused) video.pause(); else void video.play();
    playBtn.textContent = paused ? 'Play' : 'Pause';
    playBtn.setAttribute('aria-label', paused ? 'Play the demo' : 'Pause the demo');
    playBtn.setAttribute('aria-pressed', String(paused));
  });
  frame.append(playBtn);

  // Pointer-driven tilt and floating chips.
  if (!reducedMotion()) {
    frame.addEventListener('pointermove', (ev) => {
      const r = frame.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width - 0.5;
      const y = (ev.clientY - r.top) / r.height - 0.5;
      frame.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`);
      frame.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
      frame.style.setProperty('--px', `${(x * 14).toFixed(1)}px`);
      frame.style.setProperty('--py', `${(y * 10).toFixed(1)}px`);
    });
    frame.addEventListener('pointerleave', () => ['--rx', '--ry', '--px', '--py'].forEach((p) => frame.style.removeProperty(p)));
  }

  // Tabs
  const panel = h('div', { class: 'wl-panel', role: 'tabpanel', id: 'wl-panel', tabindex: '0' });
  const tabBtns = TABS.map((t) =>
    h('button', { class: 'wl-tab', type: 'button', role: 'tab', id: `wl-tab-${t.id}`, 'aria-controls': 'wl-panel', 'aria-selected': 'false', tabindex: '-1', dataset: { tab: t.id } }, t.label));
  /** @param {number} i @param {boolean} [focus] */
  function select(i, focus = false) {
    const t = TABS[i];
    tabBtns.forEach((b, j) => {
      b.setAttribute('aria-selected', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
      b.classList.toggle('on', i === j);
    });
    panel.setAttribute('aria-labelledby', `wl-tab-${t.id}`);
    panel.classList.remove('swap');
    void panel.offsetWidth; // restart the entrance animation
    panel.classList.add('swap');
    panel.replaceChildren(
      h('div', { class: 'wl-copy' },
        h('h3', null, t.title),
        h('p', null, t.body),
        h('a', { class: 'wl-link', href: t.href }, `${t.cta} →`)),
      h('ul', { class: 'wl-mock', 'aria-hidden': 'true' }, t.mock.map((line, k) => stagger(h('li', null, line), k))));
    if (focus) tabBtns[i].focus();
  }
  tabBtns.forEach((b, i) => {
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', (ev) => {
      const k = /** @type {KeyboardEvent} */ (ev).key;
      if (k === 'ArrowRight') select((i + 1) % TABS.length, true);
      else if (k === 'ArrowLeft') select((i + TABS.length - 1) % TABS.length, true);
    });
  });
  select(0);

  const pills = [...TYPES, ...TYPES].map((t) => h('span', { class: 'wl-pill' }, t));

  // The page title is redundant above the hero; hide it while this screen is showing.
  queueMicrotask(() => document.getElementById('view')?.classList.add('welcome-page'));
  const root = h('div', { class: 'welcome' },
    h('section', { class: 'wl-hero', 'aria-labelledby': 'wl-title' },
      h('p', { class: 'wl-eyebrow' }, 'For students and first-time applicants'),
      h('h2', { id: 'wl-title', class: 'wl-title' }, 'Never miss the ', h('span', { class: 'wl-grad' }, 'opportunity'), ' that changes your year.'),
      h('p', { class: 'wl-sub' }, 'Hackathons, internships, scholarships and deadlines all in one calm place. Nothing here yet, so add your first one below.'),
      h('div', { class: 'row wl-cta' },
        h('button', { class: 'btn btn-primary wl-btn', type: 'button', onclick: () => ctx.add() }, 'Add an opportunity'),
        h('button', { class: 'btn wl-btn', type: 'button', onclick: () => ctx.goto('#/capture') }, 'Capture an event'),
        h('button', { class: 'btn wl-btn', type: 'button', onclick: () => ctx.goto('#/settings') }, 'Import a spreadsheet')),
      frame),
    h('section', { class: 'wl-marquee', 'aria-label': 'What you can track', 'data-reveal': '' }, h('div', { class: 'wl-track', 'aria-hidden': 'true' }, pills), h('p', { class: 'sr-only' }, TYPES.join(', '))),
    h('section', { class: 'wl-tabs', 'data-reveal': '', 'aria-labelledby': 'wl-how' },
      h('h2', { id: 'wl-how' }, 'One place for the whole journey'),
      h('div', { class: 'wl-tablist', role: 'tablist', 'aria-label': 'How ShowUp helps' }, tabBtns),
      panel),
    h('section', { class: 'wl-rows', 'data-reveal': '', 'aria-labelledby': 'wl-can' },
      h('h2', { id: 'wl-can' }, 'See what ShowUp can do'),
      h('ul', null, ROWS.map((r, i) =>
        stagger(h('li', null, h('a', { class: 'wl-row', href: r.href },
          h('span', { class: 'wl-ico' }, icon(r.icon)),
          h('span', { class: 'wl-row-text' }, h('strong', null, r.title), h('small', null, r.hint)),
          h('span', { class: 'wl-arrow', 'aria-hidden': 'true' }, '→'))), i)))),
    h('section', { class: 'wl-quote', 'data-reveal': '' },
      h('blockquote', null, 'Most chances are not lost to talent. They are lost to a date you did not see.'),
      h('p', { class: 'muted' }, 'Your events stay in your browser, encrypted. No account, no tracking.')));

  // Reveal on scroll (falls back to showing everything).
  const targets = [...root.querySelectorAll('[data-reveal]')];
  if (!('IntersectionObserver' in window) || reducedMotion()) targets.forEach((t) => t.classList.add('in'));
  else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.15 });
    requestAnimationFrame(() => targets.forEach((t) => io.observe(t)));
  }
  return root;
}
