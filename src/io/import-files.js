// @ts-check
import { dedupeKey } from '../domain/event.js';
import { parseBackupJSON } from './backup.js';
import { parseCSV } from './csv.js';
import { parseICS } from './ical.js';
import { mapSheet, detectHeader } from './sheet-import.js';
import { readXlsx } from './xlsx.js';

/**
 * Read many files at once into one combined, de-duplicated import.
 * Pure of the DOM: files are anything with name, size, text() and arrayBuffer().
 *
 * @typedef {import('../domain/event.js').ShowUpEvent} ShowUpEvent
 * @typedef {{ row: number, reason: string, preview: string }} Skipped
 * @typedef {{ name: string, size: number, text: () => Promise<string>, arrayBuffer: () => Promise<ArrayBuffer> }} ImportableFile
 * @typedef {{ name: string, kind: string, count: number, flagged: number, notes: string[], error?: string }} FileSummary
 * @typedef {{ summaries: FileSummary[], events: ShowUpEvent[], skipped: Skipped[], flagged: number }} ImportBatch
 */

export const MAX_FILES = 20;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const ACCEPT = '.xlsx,.csv,.json,.ics';

/** @param {string} name */
function extension(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/**
 * @param {ImportableFile[]} files
 * @param {{ now?: Date, existing?: ShowUpEvent[] }} [opts]
 * @returns {Promise<ImportBatch>}
 */
export async function readImportFiles(files, opts = {}) {
  /** @type {ImportBatch} */
  const batch = { summaries: [], events: [], skipped: [], flagged: 0 };
  /** Everything already known plus what earlier files in this batch contributed. */
  const known = [...(opts.existing ?? [])];
  const seen = new Set(known.map(dedupeKey));

  if (files.length > MAX_FILES) {
    batch.skipped.push({ row: 0, reason: `Only the first ${MAX_FILES} files were read (you chose ${files.length})`, preview: '' });
  }

  for (const file of files.slice(0, MAX_FILES)) {
    /** @type {FileSummary} */
    const summary = { name: file.name, kind: extension(file.name), count: 0, flagged: 0, notes: [] };
    batch.summaries.push(summary);
    try {
      /** @type {{ events: ShowUpEvent[], skipped: Skipped[], flagged: number }[]} */
      const parts = [];

      if (summary.kind === 'xlsx') {
        const sheets = await readXlsx(await file.arrayBuffer());
        for (const sheet of sheets) {
          if (!detectHeader(sheet.rows)) {
            summary.notes.push(`Sheet “${sheet.name}”: no Date and Title columns, so it was left out.`);
            continue;
          }
          const r = mapSheet(sheet.rows, { now: opts.now, existing: known });
          summary.notes.push(`Sheet “${sheet.name}”: ${r.events.length} event${r.events.length === 1 ? '' : 's'}.`);
          r.events.forEach((e) => known.push(e));
          parts.push(r);
        }
        if (!parts.length) summary.error = 'No sheet in this workbook had Date and Title columns.';
      } else if (summary.kind === 'csv' || summary.kind === 'json' || summary.kind === 'ics') {
        if (file.size > MAX_TEXT_BYTES) throw new Error('That file is larger than 10 MB.');
        const text = await file.text();
        if (summary.kind === 'csv') {
          const r = mapSheet(parseCSV(text), { now: opts.now, existing: known });
          r.events.forEach((e) => known.push(e));
          parts.push(r);
        } else if (summary.kind === 'ics') {
          const r = parseICS(text, { now: opts.now, existing: known });
          r.events.forEach((e) => known.push(e));
          parts.push(r);
        } else {
          const { events, rejected } = parseBackupJSON(text);
          // Backups restore by id; only the ones not already identical are news.
          const have = new Map(known.map((e) => [e.id, e]));
          const fresh = events.filter((e) => {
            const cur = have.get(e.id);
            return !cur || e.updatedAt > cur.updatedAt;
          });
          fresh.forEach((e) => known.push(e));
          parts.push({
            events: fresh,
            flagged: 0,
            skipped: rejected ? [{ row: 0, reason: `${rejected} invalid event${rejected === 1 ? '' : 's'} ignored`, preview: '' }] : [],
          });
          summary.notes.push('Backup file: restores by event id.');
        }
      } else if (/^(png|jpe?g|webp|gif|heic)$/.test(summary.kind)) {
        summary.error = 'Images go in “Screenshot” capture, which reads the text for you.';
      } else {
        summary.error = 'Unsupported type. Use .xlsx, .csv, .json or .ics.';
      }

      for (const part of parts) {
        for (const e of part.events) {
          // Backups bring their own ids; everything else is de-duplicated by content.
          if (summary.kind !== 'json') {
            const key = dedupeKey(e);
            if (seen.has(key)) continue;
            seen.add(key);
          }
          batch.events.push(e);
          summary.count++;
          if (e.needsReview) summary.flagged++;
        }
        for (const s of part.skipped) batch.skipped.push({ ...s, preview: s.preview ? `${file.name}: ${s.preview}` : file.name });
      }
      batch.flagged += summary.flagged;
    } catch (err) {
      summary.error = /** @type {Error} */ (err).message || 'Could not read this file.';
    }
  }
  return batch;
}
