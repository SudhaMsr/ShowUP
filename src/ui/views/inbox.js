// @ts-check
import { h } from '../dom.js';
import { confetti } from '../motion.js';
import { dayLabel, time12, TYPE_LABEL } from '../format.js';
import { toast } from '../dom.js';

/** @typedef {import('./today.js').ViewCtx} ViewCtx */

/** Approvals: events ShowUp found in your connected accounts, waiting for your yes. @param {ViewCtx} ctx */
export function renderInbox(ctx) {
  const { store, inbox, now } = ctx;
  if (!inbox) return h('p', { class: 'muted' }, 'Approvals are not available.');
  const items = inbox.list();
  const root = h('div', { class: 'stack' });

  const status = h('p', { class: 'muted', id: 'inbox-status', role: 'status' });
  ctx.connections?.config().then((c) => {
    status.textContent = !c.connected
      ? 'Not connected. Connect Google in Settings and ShowUp will propose events it finds.'
      : c.needsReconnect
        ? 'Google access has expired. Open Settings and press Reconnect to keep syncing.'
        : c.lastSync
          ? `Last checked ${new Date(c.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. ShowUp checks every 20 minutes while it is open.`
          : 'Connected. Checking…';
  });

  if (!items.length) {
    root.append(h('div', { class: 'empty' },
      h('h2', {}, 'Nothing waiting for approval'),
      h('p', { class: 'muted' }, 'When ShowUp finds an event in your Google Calendar or a registration email, it appears here first. Nothing is added until you approve it.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.goto('#/settings') }, 'Connect Google in Settings'),
        h('button', { class: 'btn', type: 'button', id: 'inbox-sync', onclick: async (/** @type {Event} */ ev) => {
          const b = /** @type {HTMLButtonElement} */ (ev.currentTarget);
          b.disabled = true;
          const r = await ctx.connections?.syncNow();
          b.disabled = false;
          if (r && !r.added && !r.needsReconnect && !r.errors.length) toast('Checked. Nothing new.');
        } }, 'Check now'))), status);
    return root;
  }

  root.append(
    h('div', { class: 'wk-head' },
      h('p', { class: 'muted' }, `${items.length} found. Approve to add to your events, dismiss to never see it again.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary btn-small', type: 'button', id: 'approve-all', onclick: async () => {
          const n = await inbox.approveAll(store);
          confetti();
          toast(`Added ${n} event${n === 1 ? '' : 's'}.`);
        } }, 'Approve all'),
        h('button', { class: 'btn btn-small', type: 'button', id: 'dismiss-all', onclick: () => inbox.dismissAll() }, 'Dismiss all'))),
    h('div', { class: 'list' }, items.map((s) => {
      const d = s.draft;
      return h('article', { class: 'sg', dataset: { id: s.id, type: d.type }, 'aria-label': d.title },
        h('div', { class: 'sg-main' },
          h('span', { class: 'sg-src' }, s.label),
          h('h3', { class: 'sg-title' }, d.title),
          h('p', { class: 'sg-when' }, `${dayLabel(d.date, now)}${d.time ? ` · ${time12(d.time)}` : ' · All day'}${d.endTime ? ` to ${time12(d.endTime)}` : ''}`),
          h('p', { class: 'ev-meta' },
            h('span', { class: `chip chip-${d.type}` }, TYPE_LABEL[d.type] ?? 'Other'),
            d.location ? h('span', {}, d.location) : null,
            d.needsReview ? h('span', { class: 'chip chip-review' }, 'Check details') : null)),
        h('div', { class: 'sg-actions' },
          h('button', { class: 'btn btn-primary btn-small sg-approve', type: 'button', onclick: async () => {
            if (await inbox.approve(s.id, store)) toast(`Added “${d.title}”.`);
            else toast('Could not add that one. Edit it from your calendar and try again.', { kind: 'error' });
          } }, 'Approve'),
          h('button', { class: 'btn btn-small sg-dismiss', type: 'button', onclick: () => inbox.dismiss(s.id) }, 'Dismiss')));
    })),
    status);
  return root;
}
