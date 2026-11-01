// @ts-check
import { normalizeEvent, validate } from '../domain/event.js';
import { DEFAULT_REMINDER_SETTINGS } from '../domain/reminders.js';

/**
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {import('../storage/repository.js').Repository} Repository
 * @typedef {{ reminderOffsets: number[], allDayReminderHour: number, notifications: boolean, aiModel: string }} Settings
 * @typedef {{ events: ShowUpEvent[], settings: Settings, ready: boolean, persistent: boolean }} State
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  ...DEFAULT_REMINDER_SETTINGS,
  notifications: true,
  aiModel: 'claude-sonnet-5-5',
};

/** Keep only known, well-typed settings. @param {unknown} raw @returns {Settings} */
export function sanitizeSettings(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
  const offsets = Array.isArray(r.reminderOffsets)
    ? [...new Set(r.reminderOffsets.filter((n) => Number.isInteger(n) && n >= 0 && n <= 60 * 24 * 30))].sort((a, b) => b - a)
    : DEFAULT_SETTINGS.reminderOffsets;
  const hour = Number.isInteger(r.allDayReminderHour) && /** @type {number} */ (r.allDayReminderHour) >= 0 && /** @type {number} */ (r.allDayReminderHour) <= 23
    ? /** @type {number} */ (r.allDayReminderHour)
    : DEFAULT_SETTINGS.allDayReminderHour;
  return {
    reminderOffsets: /** @type {number[]} */ (offsets),
    allDayReminderHour: hour,
    notifications: r.notifications !== false,
    aiModel: typeof r.aiModel === 'string' && r.aiModel.length <= 100 && r.aiModel ? r.aiModel : DEFAULT_SETTINGS.aiModel,
  };
}

/**
 * Application state with change subscriptions. Every mutation validates,
 * persists, then notifies, so views never observe unsaved data.
 * @param {Repository} repo
 * @param {{ now?: () => Date }} [opts]
 */
export function createStore(repo, opts = {}) {
  const clock = opts.now ?? (() => new Date());
  /** @type {State} */
  let state = { events: [], settings: { ...DEFAULT_SETTINGS }, ready: false, persistent: repo.persistent };
  /** @type {Set<(s: State) => void>} */
  const listeners = new Set();

  /** @param {Partial<State>} patch */
  function set(patch) {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  }

  return {
    repo,
    getState: () => state,
    /** @param {(s: State) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async init() {
      const [events, rawSettings] = await Promise.all([repo.all(), repo.getMeta('settings')]);
      set({
        events: events.map((e) => normalizeEvent(/** @type {Record<string, unknown>} */ (e))),
        settings: sanitizeSettings(rawSettings),
        ready: true,
      });
    },

    /**
     * Create or update an event. Returns validation errors instead of throwing
     * so forms can show them inline.
     * @param {Record<string, unknown>} input
     * @returns {Promise<{ ok: true, event: ShowUpEvent } | { ok: false, errors: Record<string,string> }>}
     */
    async save(input) {
      const existing = typeof input.id === 'string' ? state.events.find((e) => e.id === input.id) : undefined;
      const now = clock();
      const event = normalizeEvent(
        { ...existing, ...input, createdAt: existing?.createdAt, updatedAt: now.toISOString() },
        { now },
      );
      const v = validate(event);
      if (!v.ok) return { ok: false, errors: v.errors };
      await repo.put(event);
      set({ events: existing ? state.events.map((e) => (e.id === event.id ? event : e)) : [...state.events, event] });
      return { ok: true, event };
    },

    /** @param {ShowUpEvent[]} events validated, already normalised */
    async saveMany(events) {
      const now = clock().toISOString();
      const byId = new Map(state.events.map((e) => [e.id, e]));
      const accepted = events.filter((e) => validate(e).ok).map((e) => ({ ...e, updatedAt: now }));
      await repo.putMany(accepted);
      for (const e of accepted) byId.set(e.id, e);
      set({ events: [...byId.values()] });
      return accepted.length;
    },

    /** @param {string} id @param {import('../domain/event.js').EventStatus} status */
    async setStatus(id, status) {
      return this.save({ id, status, needsReview: false });
    },

    /** @param {string} id */
    async remove(id) {
      await repo.delete(id);
      set({ events: state.events.filter((e) => e.id !== id) });
    },

    async clearAll() {
      await repo.clearEvents();
      await repo.deleteMeta('firedReminders');
      set({ events: [] });
    },

    /** @param {Partial<Settings>} patch */
    async updateSettings(patch) {
      const settings = sanitizeSettings({ ...state.settings, ...patch });
      await repo.setMeta('settings', settings);
      set({ settings });
      return settings;
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */
