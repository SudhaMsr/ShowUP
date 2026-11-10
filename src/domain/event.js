// @ts-check
import { isValidISO } from './dates.js';
import {
  appendStageLog, normalizeStage, sanitizeDetails, sanitizeLinks, sanitizeStageLog, sanitizeTasks,
} from './opportunity.js';

export const EVENT_TYPES = /** @type {const} */ ([
  'hackathon', 'internship', 'scholarship', 'fellowship', 'competition',
  'meetup', 'conference', 'workshop', 'webinar', 'interview',
  'meeting', 'networking', 'submission', 'personal', 'other',
]);
export const STATUSES = /** @type {const} */ (['upcoming', 'attended', 'missed', 'cancelled']);
export const SOURCES = /** @type {const} */ (['manual', 'voice', 'screenshot', 'import', 'text', 'calendar', 'email']);

/** @typedef {typeof EVENT_TYPES[number]} EventType */
/** @typedef {typeof STATUSES[number]} EventStatus */
/** @typedef {typeof SOURCES[number]} EventSource */

/**
 * @typedef {Object} ShowUpEvent
 * @property {string} id
 * @property {string} title
 * @property {EventType} type
 * @property {string} date          civil date YYYY-MM-DD
 * @property {string|null} time     HH:MM or null
 * @property {string|null} endTime  HH:MM or null
 * @property {string} location
 * @property {string} organizer
 * @property {string} url
 * @property {string} notes
 * @property {string|null} deadline     registration or submission deadline (YYYY-MM-DD), pipeline types only
 * @property {string|null} stage        application stage, or null for plain events
 * @property {import('./opportunity.js').StageLogEntry[]} stageLog
 * @property {Record<string,string>} details   typed fields (prize, pay, amount...)
 * @property {import('./opportunity.js').Link[]} links
 * @property {import('./opportunity.js').Task[]} tasks
 * @property {EventStatus} status
 * @property {number[]|null} reminders  minutes before start; null = defaults
 * @property {EventSource} source
 * @property {boolean} needsReview
 * @property {string} createdAt
 * @property {string} updatedAt
 */

export const LIMITS = { title: 200, location: 200, organizer: 200, notes: 10000, url: 2000 };

/** @returns {string} */
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC4122 v4 fallback for very old engines
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * @param {unknown} v @param {number} max
 * @returns {string}
 */
function text(v, max) {
  return (typeof v === 'string' ? v : v == null ? '' : String(v))
    // strip control chars except tab/newline
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

/** @param {unknown} v @returns {string|null} */
function hm(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
}

/**
 * @template T
 * @param {readonly T[]} list @param {unknown} v @param {T} fallback
 * @returns {T}
 */
function oneOf(list, v, fallback) {
  return /** @type {T|undefined} */ (list.find((x) => x === v)) ?? fallback;
}

/**
 * Normalise arbitrary input into a well-formed event. Never throws; invalid
 * fields are coerced to safe defaults. Call validate() to learn what is wrong.
 * @param {Record<string, unknown>} input
 * @param {{ now?: Date, id?: string }} [opts]
 * @returns {ShowUpEvent}
 */
export function normalizeEvent(input, opts = {}) {
  const nowIso = (opts.now ?? new Date()).toISOString();
  const reminders = Array.isArray(input.reminders)
    ? [...new Set(input.reminders.filter((n) => Number.isInteger(n) && n >= 0 && n <= 60 * 24 * 30))].sort((a, b) => b - a)
    : null;
  const type = oneOf(EVENT_TYPES, input.type, 'other');
  const stage = normalizeStage(type, input.stage);
  const deadline = typeof input.deadline === 'string' && isValidISO(input.deadline) && stage !== null ? input.deadline : null;
  return {
    id: typeof input.id === 'string' && input.id ? input.id.slice(0, 100) : opts.id ?? newId(),
    title: text(input.title, LIMITS.title),
    type,
    date: typeof input.date === 'string' ? input.date : '',
    time: hm(input.time),
    endTime: hm(input.endTime),
    location: text(input.location, LIMITS.location),
    organizer: text(input.organizer, LIMITS.organizer),
    url: text(input.url, LIMITS.url),
    notes: text(input.notes, LIMITS.notes),
    deadline,
    stage,
    stageLog: stage === null ? [] : sanitizeStageLog(input.stageLog, type),
    details: sanitizeDetails(type, input.details),
    links: sanitizeLinks(input.links),
    tasks: sanitizeTasks(input.tasks),
    status: oneOf(STATUSES, input.status, 'upcoming'),
    reminders,
    source: oneOf(SOURCES, input.source, 'manual'),
    needsReview: input.needsReview === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : nowIso,
  };
}

/**
 * @param {ShowUpEvent} e
 * @returns {{ ok: boolean, errors: Record<string,string> }}
 */
export function validate(e) {
  /** @type {Record<string,string>} */
  const errors = {};
  if (!e.title) errors.title = 'Give the event a title.';
  if (!isValidISO(e.date)) errors.date = 'Pick a real date.';
  if (e.deadline && !isValidISO(e.deadline)) errors.deadline = 'Pick a real deadline date.';
  if (e.endTime && !e.time) errors.endTime = 'Add a start time before an end time.';
  if (e.time && e.endTime && e.endTime <= e.time) errors.endTime = 'End time must be after the start time.';
  if (e.url) {
    try {
      const u = new URL(e.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') errors.url = 'Link must start with http:// or https://';
    } catch {
      errors.url = 'That link does not look right.';
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Move an event to a stage, logging the change. No-op for types without a pipeline.
 * @param {ShowUpEvent} e @param {string} stage @param {Date} now
 * @returns {ShowUpEvent}
 */
export function withStage(e, stage, now) {
  const next = normalizeStage(e.type, stage);
  if (next === null || next === e.stage) return e;
  return { ...e, stage: next, stageLog: appendStageLog(e.stageLog, next, now.toISOString()) };
}

/** Stable key for duplicate detection. @param {Pick<ShowUpEvent,'title'|'date'|'time'>} e */
export function dedupeKey(e) {
  return `${e.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${e.date}|${e.time ?? ''}`;
}

/**
 * Chronological comparator (date, then time with all-day first, then title).
 * @param {ShowUpEvent} a @param {ShowUpEvent} b
 */
export function byStart(a, b) {
  return (
    a.date.localeCompare(b.date) ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    a.title.localeCompare(b.title)
  );
}
