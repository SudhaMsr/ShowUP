// @ts-check
import { toICS } from '../domain/ics.js';
import { describeOffset } from '../domain/reminders.js';
import { openRepository } from '../storage/repository.js';
import { createStore } from './store.js';
import { createReminderEngine } from './reminder-engine.js';
import { showSystemNotification } from './notify.js';
import { byId, confirmDialog, download, h, setChildren, toast } from '../ui/dom.js';
import { openEditor } from '../ui/dialogs.js';
import { renderToday } from '../ui/views/today.js';
import { renderUpcoming } from '../ui/views/upcoming.js';
import { renderCapture } from '../ui/views/capture.js';
import { renderSettings } from '../ui/views/settings.js';
import { time12 } from '../ui/format.js';

const ROUTES = /** @type {Record<string, { title: string, render: (ctx: any) => HTMLElement }>} */ ({
  '#/today': { title: 'Today', render: renderToday },
  '#/upcoming': { title: 'Upcoming', render: renderUpcoming },
  '#/capture': { title: 'Capture', render: renderCapture },
  '#/settings': { title: 'Settings', render: renderSettings },
});

async function start() {
  const repo = await openRepository();
  const store = createStore(repo);
  await store.init();

  const view = byId('view');
  const catchup = byId('catchup');

  /** @type {import('../ui/event-card.js').CardActions} */
  const actions = {
    edit: (e) => openEditor(store, e),
    setStatus: async (e, status) => {
      await store.setStatus(e.id, status);
      toast(status === 'attended' ? 'Marked as attended.' : status === 'missed' ? 'Marked as missed.' : status === 'cancelled' ? 'Marked as cancelled.' : 'Moved back to upcoming.');
    },
    remove: async (e) => {
      if (await confirmDialog('Delete this event?', `“${e.title}” will be removed from this browser.`, 'Delete')) {
        await store.remove(e.id);
        toast('Event deleted.');
      }
    },
    downloadIcs: (e) => {
      download(`${e.title.replace(/[^\w-]+/g, '-').slice(0, 40) || 'event'}.ics`, toICS([e], { settings: store.getState().settings }), 'text/calendar;charset=utf-8');
      toast('Calendar file downloaded. Open it to add the event with its reminders.');
    },
  };

  const ctx = {
    store,
    actions,
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
  paint();

  // ---- Reminders ----
  const engine = createReminderEngine(store, {
    live: async (r) => {
      const when = r.event.time ? time12(r.event.time) : 'today';
      const body = `${when}${r.event.location ? ` · ${r.event.location}` : ''} (${describeOffset(r.offset)})`;
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
  });
  const tick = () => engine.tick().catch(() => {});
  tick();
  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick();
      if (!busy()) paint();
    }
  });
  // Keep countdowns fresh without disturbing editing.
  setInterval(() => {
    if (document.visibilityState === 'visible' && !busy() && currentRoute() !== '#/capture') paint();
  }, 60_000);

  if (!repo.persistent) {
    toast('Storage is blocked in this browser, so events will not be kept after you close the tab.', { kind: 'error', ms: 12000 });
  }

  // ---- Service worker (offline shell) ----
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.documentElement.dataset.ready = 'true';
}

start().catch((err) => {
  console.error(err);
  const view = document.getElementById('view');
  if (view) view.textContent = 'ShowUp could not start in this browser. Please try a current version of Chrome, Edge, Firefox or Safari.';
});
