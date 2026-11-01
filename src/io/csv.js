// @ts-check
/**
 * Minimal RFC 4180 CSV reader/writer. No dependencies.
 */

const MAX_CELLS = 500_000;

/**
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  /** @type {string[][]} */
  const rows = [];
  let row = /** @type {string[]} */ ([]);
  let cell = '';
  let quoted = false;
  let cells = 0;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
      if (++cells > MAX_CELLS) throw new Error('CSV too large');
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Quote a field; also neutralise spreadsheet formula injection (leading equals, plus, minus or at-sign).
 * @param {unknown} v
 */
export function csvField(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {string[]} header
 * @param {unknown[][]} rows
 */
export function toCSV(header, rows) {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
