// @ts-check
import { excelSerialToISO, findDateInText, isValidISO, localISO, MONTHS } from '../domain/dates.js';
import { dedupeKey, normalizeEvent, validate } from '../domain/event.js';
import { guessType } from '../domain/capture.js';
import { parseTime } from '../domain/time.js';

/**
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {Array<Array<string|number|null>>} Rows
 * @typedef {{ row: number, reason: string, preview: string }} Skipped
 * @typedef {{ events: ShowUpEvent[], skipped: Skipped[], flagged: number }} ImportResult
 */

const HEADER_ALIASES = /** @type {Record<string,string>} */ ({
  date: 'date', day: 'date', when: 'date',
  time: 'time', start: 'time', 'start time': 'time',
  type: 'type', category: 'type', kind: 'type',
  title: 'title', event: 'title', name: 'title', 'event name': 'title', subject: 'title',
  location: 'location', venue: 'location', place: 'location', where: 'location',
  'company/event': 'organizer', company: 'organizer', organizer: 'organizer', organiser: 'organizer', host: 'organizer',
  status: 'status', state: 'status',
  notes: 'notes', note: 'notes', comments: 'notes', description: 'notes',
  link: 'url', url: 'url', website: 'url',
  stage: 'stage', progress: 'stage', 'application status': 'stage',
  deadline: 'deadline', 'due date': 'deadline', due: 'deadline', 'apply by': 'deadline', 'closing date': 'deadline',
});

/** @param {unknown} v */
const str = (v) => (v == null ? '' : String(v).trim());

/**
 * Locate the header row: the first row (within 20) that names >= 3 known columns.
 * @param {Rows} rows
 * @returns {{ index: number, columns: Record<string, number> } | null}
 */
export function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    /** @type {Record<string, number>} */
    const columns = {};
    (rows[i] ?? []).forEach((cell, c) => {
      const key = HEADER_ALIASES[str(cell).toLowerCase()];
      if (key && !(key in columns)) columns[key] = c;
    });
    if (Object.keys(columns).length >= 3 && 'date' in columns) return { index: i, columns };
  }
  return null;
}

/** @param {string} raw */
function mapStatus(raw) {
  const s = raw.toLowerCase();
  if (!s) return 'upcoming';
  if (/^(done|attended|completed|went|yes)\b/.test(s)) return 'attended';
  if (/^(cancel|canceled|cancelled|called off)/.test(s)) return 'cancelled';
  if (/^(missed|skipped|no show|didn'?t go)/.test(s)) return 'missed';
  return 'upcoming';
}

/** Spreadsheet wording for a stage -> stage id (unknown wording gives '' so the default applies). @param {string} raw */
function mapStage(raw) {
  const s = raw.toLowerCase();
  if (!s) return '';
  if (/(offer|accepted|awarded|won|winner|placed|selected)/.test(s)) return 'won';
  if (/(reject|declined|unsuccessful|not selected|not awarded|lost)/.test(s)) return 'lost';
  if (/(withdr|dropped|not applying|abandon)/.test(s)) return 'closed';
  if (/interview/.test(s)) return 'interview';
  if (/(submitted|applied|sent)/.test(s)) return 'submitted';
  if (/(preparing|working|building|drafting|in progress)/.test(s)) return 'working';
  if (/(registered|signed up)/.test(s)) return 'registered';
  if (/(found|saved|interested|to apply|todo|to do)/.test(s)) return 'found';
  return '';
}

/** @param {string} raw @param {string} title */
function mapType(raw, title) {
  const s = raw.toLowerCase();
  const direct = ['hackathon', 'internship', 'scholarship', 'fellowship', 'competition', 'meetup', 'conference', 'workshop', 'webinar', 'interview', 'meeting', 'networking', 'submission', 'personal'];
  const hit = direct.find((d) => s.includes(d));
  if (hit) return hit;
  if (/friends|outing|volunteer|trip|party/.test(s)) return 'personal';
  const guessed = guessType(`${raw} ${title}`);
  return guessed;
}

/**
 * Interpret a date cell. Numbers are Excel serials; strings may be ISO or
 * "12 Nov 2026". Anything without a full date is reported, never guessed.
 * @param {string|number|null} cell
 * @param {string} ref
 * @returns {{ date: string|null, reason?: string }}
 */
function readDate(cell, ref) {
  if (cell == null || cell === '') return { date: null, reason: 'No date' };
  if (typeof cell === 'number') {
    const iso = excelSerialToISO(cell);
    return iso ? { date: iso } : { date: null, reason: `Unreadable date (${cell})` };
  }
  const s = cell.trim();
  if (isValidISO(s)) return { date: s };
  const m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:,?\s+(\d{4}))?$/i.exec(s);
  if (m) {
    const mon = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3))) + 1;
    if (mon) {
      const year = m[3] ? Number(m[3]) : Number(ref.slice(0, 4));
      const iso = `${year}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
      if (isValidISO(iso)) return { date: iso };
    }
  }
  // Whole-cell dates such as 12/11/2026 (CSV exports).
  const whole = findDateInText(s, ref);
  if (whole && whole.index === 0 && whole.length === s.length) return { date: whole.date };
  return { date: null, reason: `Date has no month/year: "${s.slice(0, 30)}"` };
}

/**
 * Convert a worksheet's rows to events.
 * Rows that cannot become a valid event are returned in `skipped` with a reason.
 * @param {Rows} rows
 * @param {{ now?: Date, existing?: ShowUpEvent[] }} [opts]
 * @returns {ImportResult}
 */
export function mapSheet(rows, opts = {}) {
  const now = opts.now ?? new Date();
  const ref = localISO(now);
  const header = detectHeader(rows);
  /** @type {ShowUpEvent[]} */
  const events = [];
  /** @type {Skipped[]} */
  const skipped = [];
  let flagged = 0;
  if (!header) return { events, skipped: [{ row: 0, reason: 'Could not find a header row with Date, Title, Type, etc.', preview: '' }], flagged };

  const seen = new Set((opts.existing ?? []).map(dedupeKey));
  const { columns } = header;
  /** @param {Array<string|number|null>} r @param {string} key */
  const cell = (r, key) => (key in columns ? r[columns[key]] ?? null : null);

  for (let i = header.index + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const filled = r.filter((c) => str(c) !== '');
    if (!filled.length) continue;
    const preview = filled.map(str).join(' | ').slice(0, 80);
    const rowNo = i + 1;

    const title = str(cell(r, 'title'));
    const { date, reason } = readDate(cell(r, 'date'), ref);
    if (!date) {
      // Section labels ("INTERVIEWS", "CONFERENCES") have no date and no row structure.
      if (filled.length === 1) continue;
      skipped.push({ row: rowNo, reason: reason ?? 'No date', preview });
      continue;
    }
    if (!title) {
      skipped.push({ row: rowNo, reason: 'No title', preview });
      continue;
    }

    const t = parseTime(cell(r, 'time'));
    const rawTime = str(cell(r, 'time'));
    const typeRaw = str(cell(r, 'type'));
    const event = normalizeEvent(
      {
        title,
        type: mapType(typeRaw, title),
        date,
        time: t.time,
        location: str(cell(r, 'location')),
        organizer: str(cell(r, 'organizer')),
        status: mapStatus(str(cell(r, 'status'))),
        stage: mapStage(str(cell(r, 'stage')) || str(cell(r, 'status'))),
        deadline: readDate(cell(r, 'deadline'), ref).date,
        notes: [str(cell(r, 'notes')), t.time === null && rawTime && !t.flexible && !/^(na|n\/a)$/i.test(rawTime) ? `Original time: ${rawTime}` : '']
          .filter(Boolean)
          .join('\n'),
        url: /^https?:\/\//i.test(str(cell(r, 'url'))) ? str(cell(r, 'url')) : '',
        source: 'import',
        needsReview: t.ambiguous || (t.time === null && rawTime !== '' && !t.flexible && !/^(na|n\/a)$/i.test(rawTime)),
      },
      { now },
    );
    if (!validate(event).ok) {
      skipped.push({ row: rowNo, reason: 'Invalid after cleanup', preview });
      continue;
    }
    const key = dedupeKey(event);
    if (seen.has(key)) {
      skipped.push({ row: rowNo, reason: 'Already in ShowUp', preview });
      continue;
    }
    seen.add(key);
    if (event.needsReview) flagged++;
    events.push(event);
  }
  return { events, skipped, flagged };
}

/**
 * Pick the sheet that looks like an events table (most importable rows).
 * @param {Array<{ name: string, rows: Rows }>} sheets
 * @param {{ now?: Date, existing?: ShowUpEvent[] }} [opts]
 * @returns {ImportResult & { sheetName: string }}
 */
export function mapWorkbook(sheets, opts = {}) {
  /** @type {(ImportResult & { sheetName: string }) | null} */
  let best = null;
  for (const s of sheets) {
    if (!detectHeader(s.rows)) continue;
    const r = mapSheet(s.rows, opts);
    if (!best || r.events.length > best.events.length) best = { ...r, sheetName: s.name };
  }
  return (
    best ?? {
      events: [],
      skipped: [{ row: 0, reason: 'No sheet had a header row with Date and Title columns.', preview: '' }],
      flagged: 0,
      sheetName: sheets[0]?.name ?? '',
    }
  );
}
