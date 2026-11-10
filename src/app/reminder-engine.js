// @ts-check
import { dueFollowUps, dueReminders, FOLLOW_UP_MAX_AGE_MS, nextWakeAt } from '../domain/reminders.js';

/**
 * @typedef {import('./store.js').Store} Store
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ key: string, at: Date, offset: number, kind: 'start'|'deadline', event: ShowUpEvent }} Fired
 * @typedef {{ key: string, at: Date, event: ShowUpEvent }} FollowUp
 * @typedef {Object} Notifier
 * @property {(reminder: Fired) => void | Promise<void>} live      a reminder happening now
 * @property {(reminders: Fired[]) => void | Promise<void>} missed reminders that came due while away
 * @property {(items: FollowUp[]) => void | Promise<void>} followUp events that have ended and need an outcome
 */

const CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Works out which reminders and follow-up questions became due since the last
 * check, fires each exactly once (persisted dedupe), and separates "live" ones
 * from "came due while the app was closed".
 * @param {Store} store
 * @param {Notifier} notifier
 * @param {{ now?: () => Date }} [opts]
 */
export function createReminderEngine(store, notifier, opts = {}) {
  const clock = opts.now ?? (() => new Date());
  let running = false;

  async function tick() {
    if (running) return { live: [], missed: [], followUps: [], nextAt: null };
    running = true;
    try {
      const now = clock();
      const { events, settings } = store.getState();
      const lastRaw = await store.repo.getMeta('lastTickAt');
      const last = typeof lastRaw === 'number' ? lastRaw : now.getTime();
      const from = new Date(Math.max(last, now.getTime() - CATCH_UP_WINDOW_MS));
      const followFrom = new Date(Math.max(last, now.getTime() - FOLLOW_UP_MAX_AGE_MS));
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

      /** @type {FollowUp[]} */
      const followUps = [];
      for (const f of dueFollowUps(events, followFrom, now)) {
        if (fired[f.key]) continue;
        fired[f.key] = now.getTime();
        followUps.push(f);
      }

      for (const key of Object.keys(fired)) if (now.getTime() - fired[key] > PRUNE_AFTER_MS) delete fired[key];

      // Persist before notifying so a crash in the notifier cannot cause a re-fire loop.
      await store.repo.setMeta('firedReminders', fired);
      await store.repo.setMeta('lastTickAt', now.getTime());

      for (const r of live) await notifier.live(r);
      if (missed.length) await notifier.missed(missed);
      if (followUps.length) await notifier.followUp(followUps);
      return { live, missed, followUps, nextAt: nextWakeAt(store.getState().events, settings, now) };
    } finally {
      running = false;
    }
  }

  return { tick };
}
