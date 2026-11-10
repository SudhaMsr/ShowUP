// @ts-check
import { downscale } from './image.js';
import { parseMany } from '../domain/capture.js';
import { isValidISO } from '../domain/dates.js';
import { findTimeInText, parseTime } from '../domain/time.js';

/**
 * @typedef {import('../domain/capture.js').Draft} Draft
 * @typedef {{ provider: 'vision'|'ocr', drafts: Draft[], rawText?: string }} ScreenshotResult
 */

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const VISION_URL = 'https://api.anthropic.com/v1/messages';

/** @type {Promise<any>|null} */
let tesseractLoad = null;

/** Lazy-load Tesseract.js once (only when the user actually scans an image). */
function loadTesseract() {
  const w = /** @type {any} */ (globalThis);
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  tesseractLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(w.Tesseract);
    s.onerror = () => {
      tesseractLoad = null;
      reject(new Error('Could not load the on-device text reader. Check your connection, or paste the text instead.'));
    };
    document.head.append(s);
  });
  return tesseractLoad;
}

/**
 * On-device OCR -> text -> rule-based parser.
 * @param {Blob} blob @param {{ now?: Date }} [opts]
 * @returns {Promise<ScreenshotResult>}
 */
export async function ocrDrafts(blob, opts = {}) {
  const T = await loadTesseract();
  const { data } = await T.recognize(blob, 'eng');
  const text = String(data?.text ?? '').trim();
  if (!text) throw new Error('No text found in that image.');
  return { provider: 'ocr', drafts: parseMany(text, opts), rawText: text };
}

/**
 * Convert a model's JSON answer into drafts. Defensive: the model is untrusted
 * input, so each field is type-checked and clipped.
 * @param {string} answer
 * @returns {Draft[]}
 */
export function draftsFromModelJSON(answer) {
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('The reader did not return any events.');
  let arr;
  try {
    arr = JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw new Error('The reader returned something unreadable. Try again or paste the text.');
  }
  if (!Array.isArray(arr)) throw new Error('The reader did not return a list of events.');
  /** @param {unknown} v @param {number} n */
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return arr.slice(0, 50).map((raw) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const date = isValidISO(r.date) ? r.date : '';
    let time = typeof r.time === 'string' ? parseTime(r.time).time ?? findTimeInText(r.time)?.time ?? null : null;
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) time = null;
    /** @type {string[]} */
    const issues = [];
    if (!date) issues.push('date');
    const title = s(r.title, 200);
    if (!title) issues.push('title');
    return {
      title,
      type: s(r.type, 20).toLowerCase() || 'other',
      date,
      time,
      location: s(r.location, 200),
      url: /^https?:\/\//i.test(s(r.url, 2000)) ? s(r.url, 2000) : '',
      issues,
      confidence: !title || !date ? 'low' : time ? 'high' : 'medium',
    };
  });
}

/**
 * Vision extraction through the user's own API key. The request goes straight
 * from the browser to the provider; the key never touches any other server.
 * @param {Blob} blob
 * @param {{ apiKey: string, model: string, today: string }} cfg
 * @returns {Promise<ScreenshotResult>}
 */
export async function visionDrafts(blob, cfg) {
  const img = await downscale(blob);
  const prompt = [
    `Today's date is ${cfg.today}. Extract every event from this image (a screenshot or photo of an event registration, ticket, email, flyer or schedule).`,
    'Reply with ONLY a JSON array. Each item: {"title": string, "type": one of hackathon|internship|scholarship|fellowship|competition|meetup|conference|workshop|webinar|interview|meeting|networking|submission|personal|other (for internships, scholarships and fellowships use the application deadline as the date),',
    '"date": "YYYY-MM-DD" or null, "time": "HH:MM" 24-hour or null, "location": string, "organizer": string, "url": string}.',
    'Do not invent details. If the year is missing choose the next occurrence on or after today. Use null for anything not shown. If there are no events, reply [].',
  ].join(' ');
  const res = await fetch(VISION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (res.status === 401) throw new Error('The AI key was rejected. Check it in Settings.');
  if (res.status === 429) throw new Error('The AI service is rate-limiting you. Wait a moment and retry.');
  if (!res.ok) throw new Error(`The AI service returned an error (${res.status}).`);
  const body = await res.json();
  const answer = (body?.content ?? []).map((/** @type {any} */ c) => (c?.type === 'text' ? c.text : '')).join('');
  return { provider: 'vision', drafts: draftsFromModelJSON(answer), rawText: answer };
}
