// @ts-check
/**
 * Time-of-day parsing. Pure functions, no I/O.
 * Handles the messy formats found in real spreadsheets: "14:30", "6pm",
 * "2.30 pm", "11.15 am", "10.3" (= 10:30), Excel day fractions (0.5833 = 14:00),
 * and non-times such as "NA" or "Flexible".
 */

/**
 * @typedef {Object} TimeParse
 * @property {string|null} time       "HH:MM" (24h) or null
 * @property {boolean} ambiguous      am/pm had to be guessed
 * @property {boolean} flexible       explicitly "flexible"/"anytime"
 */

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {number} h
 * @param {number} m
 * @returns {string}
 */
export function formatHM(h, m) {
  return `${pad(h)}:${pad(m)}`;
}

/** @returns {TimeParse} */
const none = () => ({ time: null, ambiguous: false, flexible: false });

/**
 * Excel stores times as a fraction of a day.
 * @param {number} fraction
 * @returns {TimeParse}
 */
function fromFraction(fraction) {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) return none();
  const total = Math.round(fraction * 24 * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return { time: formatHM(h, m), ambiguous: false, flexible: false };
}

/**
 * Convert clock parts plus optional meridiem into a 24h time.
 * @param {number} hour
 * @param {number} minute
 * @param {string|undefined} meridiem  "am" | "pm" | undefined
 * @param {boolean} zeroPadded         hour was written with a leading zero or 24h form
 * @returns {TimeParse}
 */
function resolve(hour, minute, meridiem, zeroPadded) {
  if (minute < 0 || minute > 59) return none();
  if (meridiem) {
    if (hour < 1 || hour > 12) return none();
    let h = hour % 12;
    if (meridiem === 'pm') h += 12;
    return { time: formatHM(h, minute), ambiguous: false, flexible: false };
  }
  if (hour < 0 || hour > 23) return none();
  if (hour >= 13 || hour === 0 || zeroPadded) {
    return { time: formatHM(hour, minute), ambiguous: false, flexible: false };
  }
  // 1..12 with no am/pm and no leading zero: a human guess is needed.
  // Events rarely start at 1-6 in the morning, so assume afternoon there.
  const guessed = hour >= 1 && hour <= 6 ? hour + 12 : hour;
  return { time: formatHM(guessed === 24 ? 12 : guessed, minute), ambiguous: true, flexible: false };
}

const WORDS = /** @type {Record<string,string>} */ ({
  noon: '12:00',
  midday: '12:00',
  midnight: '00:00',
});

/**
 * Parse a single cell/field value into a time.
 * @param {unknown} input
 * @returns {TimeParse}
 */
export function parseTime(input) {
  if (input === null || input === undefined) return none();
  if (typeof input === 'number') return fromFraction(input);
  const raw = String(input).trim().toLowerCase();
  if (!raw || raw.length > 40) return none();
  if (/^(na|n\/a|tbc|tbd|-|—|none)$/.test(raw)) return none();
  if (/^(flexible|any ?time|all day)$/.test(raw)) return { time: null, ambiguous: false, flexible: true };
  if (raw in WORDS) return { time: WORDS[raw], ambiguous: false, flexible: false };
  if (/^0\.\d+$/.test(raw)) return fromFraction(Number(raw));

  const m = raw.match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{1,2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return none();
  const hourText = m[1];
  const minText = m[2];
  const meridiem = m[3] ? (m[3].startsWith('a') ? 'am' : 'pm') : undefined;
  const hour = Number(hourText);
  // "10.3" means 10:30 (a single trailing digit is tens of minutes).
  const minute = minText === undefined ? 0 : minText.length === 1 ? Number(minText) * 10 : Number(minText);
  const zeroPadded = hourText.length === 2 && hourText.startsWith('0');
  // A bare integer such as "14" or "7" is too weak to call a time.
  if (minText === undefined && !meridiem) return none();
  const result = resolve(hour, minute, meridiem, zeroPadded);
  // "10.3" has no colon and no meridiem: always flag as ambiguous.
  if (result.time && !meridiem && minText !== undefined && !raw.includes(':') && minText.length === 1) {
    result.ambiguous = true;
  }
  return result;
}

/**
 * Find the first time-of-day inside free text.
 * @param {string} text
 * @returns {{ time: string, ambiguous: boolean, index: number, length: number } | null}
 */
export function findTimeInText(text) {
  /** @type {{ time: string, ambiguous: boolean, index: number, length: number } | null} */
  let best = null;
  /** @param {RegExpExecArray | null} mm @param {TimeParse} parsed */
  const consider = (mm, parsed) => {
    if (!mm || !parsed.time) return;
    if (!best || mm.index < best.index) {
      best = { time: parsed.time, ambiguous: parsed.ambiguous, index: mm.index, length: mm[0].length };
    }
  };

  // 6pm, 6 pm, 2.30pm, 11:15 am
  const withMeridiem = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i;
  const a = withMeridiem.exec(text);
  if (a) consider(a, parseTime(a[0]));

  // 24h: 14:30, 09:00, 9:30
  const twentyFour = /(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/;
  const b = twentyFour.exec(text);
  if (b) consider(b, parseTime(b[0]));

  const word = /\b(noon|midday|midnight)\b/i.exec(text);
  if (word) consider(word, parseTime(word[1]));

  return best;
}
