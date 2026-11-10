// @ts-check
import { toICS } from '../domain/ics.js';
import { describeOffset } from '../domain/reminders.js';
import { openRepository } from '../storage/repository.js';
import { createStore } from './store.js';
import { createInbox } from './inbox.js';
import { createGoogle } from './google.js';
import { createConnections } from './connections.js';
import { createRelay } from './relay.js';
import { renderInbox } from '../ui/views/inbox.js';
import { createAuth } from './auth.js';
import { authSupported, deleteDatabases, idbAuthStorage } from './auth-storage.js';
import { makeCodec } from './crypto.js';
import { installPalette } from '../ui/palette.js';
import { applyTheme, toggleTheme } from '../ui/theme.js';
import { confetti } from '../ui/motion.js';
import { showAuthScreen } from '../ui/auth-screen.js';
import { createReminderEngine } from './reminder-engine.js';
import { showSystemNotification } from './notify.js';
import { takePending } from './pending.js';
import { byId, confirmDialog, download, h, setChildren, toast } from '../ui/dom.js';
import { openEditor } from '../ui/dialogs.js';
import { askOutcome } from '../ui/outcome.js';
import { renderToday } from '../ui/views/today.js';
import { renderUpcoming } from '../ui/views/upcoming.js';
import { renderInsights } from '../ui/views/insights.js';
import { renderBoard } from '../ui/views/board.js';
import { renderCalendar } from '../ui/views/calendar.js';
import { renderCapture } from '../ui/views/capture.js';
import { renderSettings } from '../ui/views/settings.js';
import { time12 } from '../ui/format.js';
import { effectiveStatus, isApplicationType, isOpen, stageLabel } from '../domain/opportunity.js';

const ROUTES = /** @type {Record<string, { title: string, render: (ctx: any) => HTMLElement }>} */ ({
  '#/today': { title: 'Today', render: renderToday },
  '#/upcoming': { title: 'Upcoming', render: renderUpcoming },
  '#/calendar': { title: 'Calendar', render: renderCalendar },
  '#/board': { title: 'Board', render: renderBoard },
  '#/insights': { title: 'Insights', render: renderInsights },
  '#/inbox': { title: 'Approvals', render: renderInbox },
  '#/capture': { title: 'Capture', render: renderCapture },
  '#/settings': { title: 'Settings', render: renderSettings },
});

const ALL_DBS = ['showup', 'showup-auth', 'showup-pending'];

/** Sign in (or create the device account), then open the encrypted store. */
async function start() {
  applyTheme();
  if (!authSupported()) {
    // No Web Crypto (very old browser or insecure origin): run without a sign-in rather than not at all.
    const repo = await openRepository();
    return run(repo, null);
  }
  const auth = createAuth(idbAuthStorage());
  const root = byId('auth-root');
  const resumed = await auth.resume();
  const { key, profile } = resumed ?? (await showAuthScreen(root, auth, { onErase: () => deleteDatabases(ALL_DBS).then(() => undefined) }));
  const repo = await openRepository('showup', makeCodec(key));
  // Anything saved before sign-in existed is encrypted on first unlock.
  if ('migrate' in repo) await /** @type {any} */ (repo).migrate();
  return run(repo, {
    name: profile.name,
    idleMinutes: profile.idleMinutes,
    auth,
    lock: async () => {
      await auth.lock();
      location.reload();
    },
    eraseAll: async () => {
      /** @type {any} */ (repo).close?.();
      await auth.reset();
      await deleteDatabases(ALL_DBS);
      location.reload();
    },
  });
}

/**
 * @param {import('../storage/repository.js').Repository} repo
 * @param {null | { name: string, idleMinutes: number, auth: import('./auth.js').Auth, lock: () => Promise<void>, eraseAll: () => Promise<void> }} account
 */
async function run(repo, account) {
  const store = createStore(repo);
  await store.init();
  const inbox = createInbox(repo);
  await inbox.init();

  const view = byId('view');
  const catchup = byId('catchup');

  /** @type {import('../ui/event-card.js').CardActions} */
  const actions = {
    edit: (e) => openEditor(store, e),
    setStatus: async (e, status) => {
      await store.setStatus(e.id, status);
      if (status === 'attended') confetti();
      const app = isApplicationType(e.type);
      toast(status === 'attended' ? (app ? 'Marked as applied. Well done!' : 'Marked as attended.')
        : status === 'missed' ? (app ? 'Marked as a missed deadline.' : 'Marked as missed.')
        : status === 'cancelled' ? (app ? 'Marked as not pursuing.' : 'Marked as cancelled.')
        : 'Moved back to upcoming.');
    },
    setStage: async (e, stage) => {
      const res = await store.setStage(e.id, stage);
      if (!res.ok) return toast(Object.values(res.errors)[0] ?? 'Could not change the stage.', { kind: 'error' });
      if (stage === 'won') confetti();
      toast(`${e.title}: ${stageLabel(e.type, stage)}.`);
    },
    setTask: async (e, index, done) => {
      await store.setTask(e.id, index, done);
    },
    remove: async (e) => {
      if (await confirmDialog('Delete this event?', `“${e.title}” will be removed from this browser.`, 'Delete')) {
        await store.remove(e.id);
        toast('Event deleted.');
      }
    },
    duplicate: (e) => openEditor(store, null, { defaults: { ...e, id: undefined, status: 'upcoming', stage: undefined, stageLog: undefined, tasks: e.tasks.map((t) => ({ ...t, done: false })), needsReview: false, firedReminders: undefined } }),
    downloadIcs: (e) => {
      download(`${e.title.replace(/[^\w-]+/g, '-').slice(0, 40) || 'event'}.ics`, toICS([e], { settings: store.getState().settings }), 'text/calendar;charset=utf-8');
      toast('Calendar file downloaded. Open it to add the event with its reminders.');
    },
  };

  /** New proposals found in a connected account: say so in the app, and in a system notification if the app is in the background. @param {import('../domain/suggestions.js').Suggestion[]} added */
  const onFound = (added) => {
    const n = added.length;
    const title = `${n} new event${n === 1 ? '' : 's'} to approve`;
    toast(`${title}. Open Approvals to add ${n === 1 ? 'it' : 'them'}.`, { ms: 9000 });
    if (document.visibilityState !== 'visible') {
      void showSystemNotification({ title, body: added.slice(0, 3).map((s) => s.draft.title).join(' · '), tag: 'showup-inbox', data: { inbox: true } });
    }
  };
  const connections = createConnections({ repo, store, inbox, google: createGoogle(), onFound });
  const relay = createRelay({ repo, store });
  relay.start();

  const ctx = {
    store,
    inbox,
    connections,
    relay,
    account,
    actions,
    repaint: () => paint(),
    get now() {
      return new Date();
    },
    add: () => openEditor(store, null),
    /** @param {string} route */
    goto: (route) => {
      location.hash = route;
    },
  };

  function currentRoute() {
    return ROUTES[location.hash] ? location.hash : '#/today';
  }

  function paint(moveFocus = false) {
    const route = currentRoute();
    const def = ROUTES[route];
    for (const a of document.querySelectorAll('nav a')) {
      const on = a.getAttribute('href') === route;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = `${def.title} · ShowUp`;
    view.classList.remove('welcome-page');
    setChildren(view, h('h1', { class: 'page-title', id: 'page-title' }, def.title), def.render(ctx));
    if (moveFocus) view.focus({ preventScroll: true });
  }

  // Do not repaint a view out from under an open dialog or a field being edited.
  const busy = () =>
    document.querySelector('dialog[open]') !== null ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '') ||
    document.querySelector('details.more[open]') !== null;

  store.subscribe(() => {
    if (!document.querySelector('dialog[open]')) paint();
  });
  // Saves happen while a dialog is still open, so repaint once it closes.
  // (`close` does not bubble, hence the capture phase.)
  document.addEventListener('close', () => paint(), true);
  window.addEventListener('hashchange', () => paint(true));
  byId('add-btn').addEventListener('click', () => ctx.add());

  // ---- Approvals badge ----
  const badge = byId('inbox-badge');
  const updateBadge = () => {
    const n = inbox.count();
    badge.hidden = n === 0;
    badge.textContent = String(n);
    byId('inbox-link').setAttribute('aria-label', n ? `Approvals, ${n} waiting` : 'Approvals');
  };
  inbox.subscribe(() => {
    updateBadge();
    if (currentRoute() === '#/inbox' && !document.querySelector('dialog[open]')) paint();
  });
  updateBadge();
  paint();

  // ---- "How did it go?" prompts ----
  const OUTCOME_TOAST = { attended: 'Marked as attended. Nice one!', missed: 'Marked as missed.', cancelled: 'Marked as cancelled.' };
  /** @type {string[]} */
  const outcomeQueue = [];
  let draining = false;
  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

  /** @param {string} id @param {'attended'|'missed'|'cancelled'} status */
  async function applyOutcome(id, status) {
    const e = store.getState().events.find((x) => x.id === id);
    if (!e || !isOpen(e)) return;
    await store.setStatus(id, status);
    if (status === 'attended') confetti();
    toast(`${e.title}: ${OUTCOME_TOAST[status]}`);
  }

  async function drainOutcomes() {
    if (draining) return;
    draining = true;
    try {
      while (outcomeQueue.length) {
        // Never stack on top of an editor or another dialog; try again shortly.
        if (document.querySelector('dialog[open]')) {
          await sleep(2000);
          continue;
        }
        const id = /** @type {string} */ (outcomeQueue.shift());
        const e = store.getState().events.find((x) => x.id === id);
        if (!e || !isOpen(e)) continue;
        const answer = await askOutcome(e, { remaining: outcomeQueue.length });
        if (answer !== 'later') await applyOutcome(id, answer);
      }
    } finally {
      draining = false;
    }
  }

  /** @param {string[]} ids */
  function enqueueOutcomes(ids) {
    for (const id of ids) if (!outcomeQueue.includes(id)) outcomeQueue.push(id);
    drainOutcomes();
  }

  /** Apply taps made on notification buttons while the app was closed. */
  async function applyPending() {
    for (const note of await takePending()) {
      if (note.status) await applyOutcome(note.id, note.status);
      else enqueueOutcomes([note.id]);
    }
  }

  // ---- Reminders ----
  const engine = createReminderEngine(store, {
    live: async (r) => {
      const isDeadline = r.kind === 'deadline';
      const when = isDeadline ? 'Deadline' : r.event.time ? time12(r.event.time) : 'today';
      const body = isDeadline
        ? `Deadline ${r.offset === 0 ? 'today' : `in ${r.offset / 1440} day${r.offset === 1440 ? '' : 's'}`}${r.event.stage ? ` · ${stageLabel(r.event.type, r.event.stage)}` : ''}`
        : `${when}${r.event.location ? ` · ${r.event.location}` : ''} (${describeOffset(r.offset)})`;
      toast(`${r.event.title}: ${body}`, { ms: 15000 });
      await showSystemNotification({ title: r.event.title, body, tag: r.key });
    },
    missed: (list) => {
      setChildren(catchup,
        h('div', { class: 'banner banner-info', role: 'status' },
          h('strong', null, 'While you were away'),
          h('ul', null, list.slice(0, 5).map((r) => h('li', null, `${r.event.title} · ${r.event.date}${r.event.time ? ` ${time12(r.event.time)}` : ''}`))),
          list.length > 5 ? h('p', { class: 'muted' }, `…and ${list.length - 5} more`) : null,
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => catchup.replaceChildren() }, 'Dismiss')));
    },
    followUp: async (items) => {
      const asked = items.slice(0, 3);
      enqueueOutcomes(asked.map((i) => i.event.id));
      if (items.length > asked.length) toast(`${items.length - asked.length} more events need an outcome. Find them under “How did these go?” on Today.`, { ms: 8000 });
      // If the app is in the background, also reach out through a notification with buttons.
      if (document.visibilityState !== 'visible') {
        for (const { event, key } of asked) {
          await showSystemNotification({
            title: `How did “${event.title}” go?`,
            body: 'Tap Attended, Missed or Cancelled.',
            tag: key,
            requireInteraction: true,
            data: { eventId: event.id, followUp: true },
            actions: [
              { action: 'attended', title: 'Attended' },
              { action: 'missed', title: 'Missed' },
              { action: 'cancelled', title: 'Cancelled' },
            ],
          });
        }
      }
    },
  });

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let wakeTimer;
  /** Run the engine, then sleep until the very next reminder instead of waiting for a poll. */
  async function tick() {
    const result = await engine.tick().catch(() => null);
    clearTimeout(wakeTimer);
    if (result?.nextAt) {
      const ms = result.nextAt.getTime() - Date.now() + 300;
      if (ms < 2_000_000_000) wakeTimer = setTimeout(tick, Math.max(500, ms));
    }
  }
  tick();
  applyPending();
  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick();
      applyPending();
      if (!busy()) paint();
    }
  });
  navigator.serviceWorker?.addEventListener('message', (ev) => {
    if (ev.data?.type === 'open-inbox') location.hash = '#/inbox';
    if (ev.data?.type === 'pending-outcomes') applyPending();
  });
  // Keep countdowns fresh without disturbing editing.
  setInterval(() => {
    if (document.visibilityState === 'visible' && !busy() && currentRoute() !== '#/capture' && currentRoute() !== '#/insights') paint();
  }, 60_000);

  if (!repo.persistent) {
    toast('Storage is blocked in this browser, so events will not be kept after you close the tab.', { kind: 'error', ms: 12000 });
  }

  // ---- Service worker (offline shell) ----
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  connections.startAuto();

  // ---- Command palette and theme ----
  byId('theme-btn').addEventListener('click', () => toggleTheme());
  const openPalette = installPalette(() => {
    const go = (/** @type {string} */ r, /** @type {string} */ label) => ({ id: `go${r}`, label: `Go to ${label}`, hint: 'Navigate', run: () => ctx.goto(r) });
    const cmds = [
      { id: 'add', label: 'Add event', hint: 'Create', run: () => ctx.add() },
      go('#/today', 'Today'), go('#/upcoming', 'Upcoming'), go('#/calendar', 'Calendar'), go('#/board', 'Board'), go('#/inbox', 'Approvals'), go('#/insights', 'Insights'), go('#/capture', 'Capture & upload'), go('#/settings', 'Settings'),
      { id: 'theme', label: 'Toggle light / dark theme', hint: 'Appearance', run: () => toggleTheme() },
    ];
    if (account) cmds.push({ id: 'lock', label: 'Lock ShowUp', hint: 'Security', run: () => account.lock() });
    for (const e of store.getState().events.slice(0, 300)) cmds.push({ id: e.id, label: e.title, hint: `${e.date} · ${e.stage ? stageLabel(e.type, e.stage) : effectiveStatus(e)}`, run: () => openEditor(store, e) });
    return cmds;
  });
  byId('palette-btn').addEventListener('click', () => openPalette());

  // ---- Lock button and idle auto-lock ----
  const lockBtn = byId('lock-btn');
  if (account) {
    lockBtn.hidden = false;
    lockBtn.addEventListener('click', () => account.lock());
    byId('who').textContent = account.name.split(' ')[0];
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let idleTimer;
    const arm = () => {
      clearTimeout(idleTimer);
      if (account.idleMinutes > 0) idleTimer = setTimeout(() => account.lock(), account.idleMinutes * 60_000);
    };
    for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart', 'change']) document.addEventListener(ev, arm, { passive: true, capture: true });
    arm();
  }

  document.documentElement.dataset.ready = 'true';
}

start().catch((err) => {
  console.error(err);
  const view = document.getElementById('view');
  if (view) view.textContent = 'ShowUp could not start in this browser. Please try a current version of Chrome, Edge, Firefox or Safari.';
});
