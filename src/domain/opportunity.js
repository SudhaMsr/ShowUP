// @ts-check
/**
 * Opportunities: hackathons, internships, scholarships and the like.
 *
 * An opportunity is a normal ShowUp event that also carries
 *   - a `stage` (found, working, submitted, ...) for types that have an application pipeline,
 *   - typed `details` (prize, pay, amount...) chosen by its type,
 *   - `links`, and a `tasks` checklist for the work that leads to submitting.
 *
 * Everything here is pure: no DOM, no storage, no clock (callers pass `today`).
 *
 * @typedef {import('./event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ key: string, label: string, options?: string[], placeholder?: string }} FieldSpec
 * @typedef {{ id: string, label: string }} StageOption
 * @typedef {{ stage: string, at: string }} StageLogEntry
 * @typedef {{ text: string, done: boolean }} Task
 * @typedef {{ label: string, url: string }} Link
 */

/** Every stage id any type can use, in rough funnel order. */
export const STAGE_IDS = /** @type {const} */ (['found', 'registered', 'working', 'submitted', 'interview', 'won', 'lost', 'closed']);

/** Stages after which nothing more happens. */
export const TERMINAL_STAGES = /** @type {readonly string[]} */ (['won', 'lost', 'closed']);

/** Stages where the work of applying is not finished (a deadline still matters). */
export const PRE_SUBMIT_STAGES = /** @type {readonly string[]} */ (['found', 'registered', 'working']);

/** Stages that mean "you did apply / submit". */
export const APPLIED_STAGES = /** @type {readonly string[]} */ (['submitted', 'interview', 'won', 'lost']);

/**
 * Pure applications: the date is a deadline, and the question is "did you apply?".
 * @type {readonly string[]}
 */
export const APPLICATION_TYPES = ['internship', 'scholarship', 'fellowship'];

/**
 * Events you register for and also attend: a start date, plus an optional
 * registration or submission deadline.
 * @type {readonly string[]}
 */
export const COMPETITION_TYPES = ['hackathon', 'competition'];

/** Order of progress for each pipeline (terminal side-exits are added in PIPELINES). */
const PATHS = /** @type {Record<string, string[]>} */ ({
  hackathon: ['found', 'registered', 'working', 'submitted', 'won'],
  competition: ['found', 'registered', 'working', 'submitted', 'won'],
  internship: ['found', 'working', 'submitted', 'interview', 'won'],
  scholarship: ['found', 'working', 'submitted', 'interview', 'won'],
  fellowship: ['found', 'working', 'submitted', 'interview', 'won'],
});

/** Stage names, per type, so a scholarship says "Awarded" and an internship says "Offer". */
const LABELS = /** @type {Record<string, Record<string, string>>} */ ({
  hackathon: { found: 'Found', registered: 'Registered', working: 'Building', submitted: 'Submitted', won: 'Won / placed', lost: 'Not selected', closed: 'Dropped' },
  competition: { found: 'Found', registered: 'Registered', working: 'Preparing', submitted: 'Submitted', won: 'Won / placed', lost: 'Not selected', closed: 'Dropped' },
  internship: { found: 'Found', working: 'Preparing', submitted: 'Applied', interview: 'Interview', won: 'Offer', lost: 'Rejected', closed: 'Withdrawn' },
  scholarship: { found: 'Found', working: 'Preparing', submitted: 'Applied', interview: 'Interview', won: 'Awarded', lost: 'Not awarded', closed: 'Dropped' },
  fellowship: { found: 'Found', working: 'Preparing', submitted: 'Applied', interview: 'Interview', won: 'Accepted', lost: 'Not selected', closed: 'Dropped' },
});

/** @param {string} type */
export const isApplicationType = (type) => APPLICATION_TYPES.includes(type);
/** @param {string} type */
export const isCompetitionType = (type) => COMPETITION_TYPES.includes(type);
/** True when events of this type move through stages. @param {string} type */
export const hasPipeline = (type) => type in PATHS;

/**
 * The stages a type offers, in order: the path, then the two ways out.
 * @param {string} type
 * @returns {StageOption[]}
 */
export function pipelineFor(type) {
  const path = PATHS[type];
  if (!path) return [];
  return [...path, 'lost', 'closed'].map((id) => ({ id, label: LABELS[type][id] }));
}

/** @param {string} type @param {string|null} stage */
export function stageLabel(type, stage) {
  if (!stage) return '';
  return LABELS[type]?.[stage] ?? stage;
}

/** Stage a new item of this type starts in, or null for plain events. @param {string} type @returns {string|null} */
export function defaultStage(type) {
  if (!hasPipeline(type)) return null;
  return isCompetitionType(type) ? 'registered' : 'found';
}

/**
 * A stage that is valid for the type, else the default. Never throws.
 * @param {string} type @param {unknown} stage @returns {string|null}
 */
export function normalizeStage(type, stage) {
  if (!hasPipeline(type)) return null;
  return typeof stage === 'string' && pipelineFor(type).some((s) => s.id === stage) ? stage : defaultStage(type);
}

/** The next step along the path, or null at the end or on a side-exit. @param {string} type @param {string|null} stage @returns {string|null} */
export function nextStage(type, stage) {
  const path = PATHS[type];
  if (!path || !stage) return null;
  const i = path.indexOf(stage);
  return i >= 0 && i < path.length - 1 ? path[i + 1] : null;
}

/** @param {string|null} stage */
export const isTerminalStage = (stage) => stage !== null && TERMINAL_STAGES.includes(stage);

/**
 * How an item counts in attendance statistics and which lists it belongs in.
 *
 * Plain events: their own `status`. Applications: once you have submitted,
 * you "showed up"; dropping it cancels it; a missed deadline stays missed;
 * anything else is still open. Competitions keep attendance in `status`, but
 * dropping one cancels it.
 *
 * @param {Pick<ShowUpEvent,'type'|'status'|'stage'>} e
 * @returns {'upcoming'|'attended'|'missed'|'cancelled'}
 */
export function effectiveStatus(e) {
  if (!hasPipeline(e.type)) return e.status;
  if (e.stage === 'closed') return 'cancelled';
  if (isApplicationType(e.type)) {
    if (e.status === 'missed' || e.status === 'cancelled') return e.status;
    if (e.stage && APPLIED_STAGES.includes(e.stage)) return 'attended';
  }
  return e.status;
}

/** Still something to do or attend. @param {Pick<ShowUpEvent,'type'|'status'|'stage'>} e */
export const isOpen = (e) => effectiveStatus(e) === 'upcoming';

/**
 * The deadline that matters for an item, or null.
 * @param {Pick<ShowUpEvent,'type'|'date'|'deadline'>} e
 * @returns {string|null}
 */
export function deadlineOf(e) {
  if (!hasPipeline(e.type)) return null;
  return isApplicationType(e.type) ? e.date : e.deadline || null;
}

/** Days before a deadline that get a nudge (0 = the morning of the deadline). */
export const DEADLINE_DAYS = [3, 1, 0];

/**
 * Append a stage change to the log, capped so it cannot grow forever.
 * @param {StageLogEntry[]} log @param {string} stage @param {string} atIso
 * @returns {StageLogEntry[]}
 */
export function appendStageLog(log, stage, atIso) {
  if (log.length && log[log.length - 1].stage === stage) return log;
  return [...log, { stage, at: atIso }].slice(-30);
}

// ---- Typed fields ---------------------------------------------------------

const MODE = ['In person', 'Online', 'Hybrid'];
const WORK_MODE = ['On-site', 'Remote', 'Hybrid'];
const YES_NO = ['Yes', 'No'];

/** @type {Record<string, FieldSpec[]>} */
export const FIELD_SPECS = {
  hackathon: [
    { key: 'mode', label: 'Format', options: MODE },
    { key: 'teamSize', label: 'Team size', placeholder: 'e.g. 2 to 4' },
    { key: 'track', label: 'Track or theme', placeholder: 'e.g. Health, Open' },
    { key: 'prize', label: 'Prize', placeholder: 'e.g. £5,000' },
  ],
  competition: [
    { key: 'mode', label: 'Format', options: MODE },
    { key: 'teamSize', label: 'Team size' },
    { key: 'prize', label: 'Prize' },
  ],
  internship: [
    { key: 'role', label: 'Role', placeholder: 'e.g. Software intern' },
    { key: 'pay', label: 'Pay', placeholder: 'e.g. £2,000 / month, unpaid' },
    { key: 'duration', label: 'Duration', placeholder: 'e.g. 12 weeks, summer' },
    { key: 'mode', label: 'Where', options: WORK_MODE },
    { key: 'contact', label: 'Contact', placeholder: 'Recruiter name or email' },
  ],
  scholarship: [
    { key: 'amount', label: 'Amount', placeholder: 'e.g. £3,000' },
    { key: 'essay', label: 'Essay needed', options: YES_NO },
    { key: 'eligibility', label: 'Eligibility', placeholder: 'e.g. Year 2, GPA 3.5+' },
    { key: 'renewable', label: 'Renewable', options: YES_NO },
  ],
  fellowship: [
    { key: 'stipend', label: 'Stipend', placeholder: 'e.g. $1,500 / month' },
    { key: 'duration', label: 'Duration' },
    { key: 'eligibility', label: 'Eligibility' },
  ],
};

/** @param {string} type @returns {FieldSpec[]} */
export const fieldsFor = (type) => FIELD_SPECS[type] ?? [];

/**
 * Keep only the fields the type defines, as short trimmed strings. Select
 * fields must hold one of their options. Empty values are dropped.
 * @param {string} type @param {unknown} raw @returns {Record<string, string>}
 */
export function sanitizeDetails(type, raw) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = /** @type {Record<string, unknown>} */ (raw);
  for (const spec of fieldsFor(type)) {
    const v = typeof src[spec.key] === 'string' ? /** @type {string} */ (src[spec.key]).trim().slice(0, 120) : '';
    if (!v) continue;
    if (spec.options && !spec.options.includes(v)) continue;
    out[spec.key] = v;
  }
  return out;
}

/** What a type calls the organising body. @param {string} type */
export function organizerLabel(type) {
  return type === 'internship' ? 'Company'
    : type === 'scholarship' ? 'Provider'
    : type === 'fellowship' ? 'Programme'
    : type === 'hackathon' || type === 'competition' ? 'Organiser'
    : 'Organiser / series';
}

/** What a type calls its main date. @param {string} type */
export const dateLabel = (type) => (isApplicationType(type) ? 'Deadline' : 'Date');

// ---- Checklist and links ---------------------------------------------------

/** Starter checklists, so a beginner knows what applying involves. @type {Record<string, string[]>} */
export const TASK_TEMPLATES = {
  internship: ['Check eligibility and requirements', 'Update CV / resume', 'Tailor cover letter', 'Submit application', 'Follow up after a week'],
  scholarship: ['Check eligibility', 'Gather documents and transcripts', 'Write the essay', 'Ask for references', 'Submit application'],
  fellowship: ['Check eligibility', 'Draft personal statement', 'Request recommendations', 'Submit application'],
  hackathon: ['Form a team', 'Agree on an idea', 'Set up repo and tools', 'Prepare the demo', 'Submit the project'],
  competition: ['Read the rules', 'Register', 'Prepare your entry', 'Submit'],
};

/** @param {string} type @returns {Task[]} */
export const templateTasks = (type) => (TASK_TEMPLATES[type] ?? []).map((text) => ({ text, done: false }));

export const MAX_TASKS = 20;
export const MAX_LINKS = 10;

/** @param {unknown} raw @returns {Task[]} */
export function sanitizeTasks(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Task[]} */
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const text = typeof t.text === 'string' ? t.text.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (text) out.push({ text, done: t.done === true });
    if (out.length >= MAX_TASKS) break;
  }
  return out;
}

/** @param {unknown} raw @returns {Link[]} */
export function sanitizeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Link[]} */
  const out = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object') continue;
    const url = typeof l.url === 'string' ? l.url.trim().slice(0, 2000) : '';
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    const label = typeof l.label === 'string' ? l.label.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    out.push({ label, url });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** @param {unknown} raw @param {string} type @returns {StageLogEntry[]} */
export function sanitizeStageLog(raw, type) {
  if (!Array.isArray(raw)) return [];
  /** @type {StageLogEntry[]} */
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.stage !== 'string' || !pipelineFor(type).some((s) => s.id === e.stage)) continue;
    if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) continue;
    out.push({ stage: e.stage, at: e.at });
  }
  return out.slice(-30);
}

// ---- Statistics ------------------------------------------------------------

/**
 * Funnel numbers for everything that has a pipeline.
 *
 * follow-through = applied / (applied + missed): of the opportunities whose
 * deadline you could act on, how many did you actually submit.
 * win rate = won / (won + lost): of the decisions you have heard back on.
 *
 * @param {ShowUpEvent[]} events @param {string} today
 */
export function opportunityStats(events, today) {
  const items = events.filter((e) => hasPipeline(e.type));
  /** @type {Record<string, number>} */
  const byStage = Object.fromEntries(STAGE_IDS.map((s) => [s, 0]));
  let applied = 0;
  let won = 0;
  let lost = 0;
  let missed = 0;
  let toReview = 0;
  /** @type {Array<{ event: ShowUpEvent, deadline: string }>} */
  const dueSoon = [];
  for (const e of items) {
    const stage = e.stage ?? defaultStage(e.type) ?? 'found';
    byStage[stage]++;
    if (APPLIED_STAGES.includes(stage)) applied++;
    if (stage === 'won') won++;
    if (stage === 'lost') lost++;
    const eff = effectiveStatus(e);
    if (eff === 'missed') missed++;
    const dl = deadlineOf(e);
    if (eff === 'upcoming' && stage !== 'closed' && PRE_SUBMIT_STAGES.includes(stage) && dl) {
      if (dl < today) toReview++;
      else dueSoon.push({ event: e, deadline: dl });
    }
  }
  dueSoon.sort((a, b) => a.deadline.localeCompare(b.deadline) || a.event.title.localeCompare(b.event.title));
  const pct = (/** @type {number} */ a, /** @type {number} */ b) => (a + b ? Math.round((a / (a + b)) * 100) : null);
  return {
    total: items.length,
    byStage,
    applied,
    won,
    lost,
    missed,
    toReview,
    dueSoon,
    followThrough: pct(applied, missed),
    winRate: pct(won, lost),
  };
}
