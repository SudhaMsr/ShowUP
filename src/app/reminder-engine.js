// @ts-check
import { dueReminders } from '../domain/reminders.js';

/**
 * @typedef {import('./store.js').Store} Store
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ key: string, at: Date, offset: number, event: ShowUpEvent }} Fired
 * @typedef {Object} Notifier
 * @property {(reminder: Fired) => void | Promise<void>} live      a reminder happening now
 * @property {(reminders: Fired[]) => void | Promise<void>} missed reminders that came due while away
 */

const CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Evaluates which reminders became due since the last check, fires each exactly
 * once (persisted dedupe), and separates "live" from "missed while away".
 * @param {Store} store
 * @param {Notifier} notifier
 * @param {{ now?: () => Date }} [opts]
 */
export function createReminderEngine(store, notifier, opts = {}) {
  const clock = opts.now ?? (() => new Date());
  let running = false;

  async function tick() {
    if (running) return { live: [], missed: [] };
    running = true;
    try {
      const now = clock();
      const { events, settings } = store.getState();
      const lastRaw = await store.repo.getMeta('lastTickAt');
      const last = typeof lastRaw === 'number' ? lastRaw : now.getTime();
      const from = new Date(Math.max(last, now.getTime() - CATCH_UP_WINDOW_MS));
      const firedRaw = await store.repo.getMeta('firedReminders');
      /** @type {Record<string, number>} */
      const fired = firedRaw && typeof firedRaw === 'object' ? { .../** @type {Record<string, number>} */ (firedRaw) } : {};

      /** @type {Fired[]} */
      const live = [];
      /** @type {Fired[]} */
      const missed = [];
      for (const r of dueReminders(events, settings, from, now)) {
        if (fired[r.key]) continue;
        fired[r.key] = now.getTime();
        (now.getTime() - r.at.getTime() <= LIVE_WINDOW_MS ? live : missed).push(r);
      }
      for (const key of Object.keys(fired)) if (now.getTime() - fired[key] > PRUNE_AFTER_MS) delete fired[key];

      // Persist before notifying so a crash in the notifier cannot cause a re-fire loop.
      await store.repo.setMeta('firedReminders', fired);
      await store.repo.setMeta('lastTickAt', now.getTime());

      for (const r of live) await notifier.live(r);
      if (missed.length) await notifier.missed(missed);
      return { live, missed };
    } finally {
      running = false;
    }
  }

  return { tick };
}
