// @ts-check
/**
 * Dependency-free .xlsx reader. An .xlsx file is a ZIP of XML parts; we read the
 * central directory, inflate entries with the platform's DecompressionStream,
 * and tokenise the few XML parts we need. Only stored cell values are read
 * (dates arrive as serial numbers), which is what the importer wants.
 *
 * Hostile-input guards: total size, entry count, and per-entry inflated size.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_INFLATED_BYTES = 60 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_COLS = 50;

/**
 * @typedef {Object} ZipEntry
 * @property {string} name
 * @property {number} method
 * @property {number} compressedSize
 * @property {number} size
 * @property {number} offset
 */

/** @param {DataView} v @returns {ZipEntry[]} */
function readCentralDirectory(v) {
  // Find End Of Central Directory record (scan back over a possible comment).
  let eocd = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (zip directory not found).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new Error('Spreadsheet has too many internal parts.');
  const dec = new TextDecoder();
  /** @type {ZipEntry[]} */
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > v.byteLength || v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory.');
    const method = v.getUint16(p + 10, true);
    const compressedSize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(v.buffer, v.byteOffset + p + 46, nameLen));
    entries.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * @param {Uint8Array} bytes @param {DataView} v @param {ZipEntry} e
 * @returns {Promise<string>}
 */
async function readEntryText(bytes, v, e) {
  if (e.size > MAX_INFLATED_BYTES) throw new Error('Spreadsheet part is too large.');
  const p = e.offset;
  if (v.getUint32(p, true) !== 0x04034b50) throw new Error('Corrupt zip entry.');
  const nameLen = v.getUint16(p + 26, true);
  const extraLen = v.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + e.compressedSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error(`Unsupported zip compression method ${e.method}.`);
  const stream = new Blob([/** @type {BlobPart} */ (data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel();
      throw new Error('Spreadsheet part inflates beyond the safety limit.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

/** @param {string} s */
function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** @param {number} cp */
function safeChar(cp) {
  return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
}

/** Concatenate all <t>…</t> text in a fragment (handles rich-text runs). @param {string} xml */
function textOf(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1]);
  return out;
}

/** @param {string} xml @returns {string[]} */
function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/** "AB12" -> zero-based column index. @param {string} ref */
function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * @param {string} xml
 * @param {string[]} shared
 * @returns {Array<Array<string|number|null>>}
 */
function parseSheet(xml, shared) {
  /** @type {Array<Array<string|number|null>>} */
  const rows = [];
  let rowNo = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]);
    rowNo = rAttr ? Number(rAttr[1]) : rowNo + 1;
    if (rowNo > MAX_ROWS) break;
    /** @type {Array<string|number|null>} */
    const cells = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = cm[2] ?? '';
      const idx = ref ? colIndex(ref) : cells.length;
      if (idx >= MAX_COLS) continue;
      /** @type {string|number|null} */
      let value = null;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str' || type === 'e') value = v === undefined ? null : unescapeXml(v);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined && v !== '') value = Number.isFinite(Number(v)) ? Number(v) : unescapeXml(v);
      while (cells.length < idx) cells.push(null);
      cells[idx] = value;
    }
    while (rows.length < rowNo - 1) rows.push([]);
    rows[rowNo - 1] = cells;
  }
  return rows;
}

/**
 * @typedef {Object} Sheet
 * @property {string} name
 * @property {Array<Array<string|number|null>>} rows
 */

/**
 * Read every worksheet of an .xlsx file.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Sheet[]>}
 */
export async function readXlsx(buffer) {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('That file is larger than 25 MB.');
  if (buffer.byteLength < 22) throw new Error('That file is empty or not a spreadsheet.');
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = readCentralDirectory(view);
  /** @param {string} name */
  const find = (name) => entries.find((e) => e.name === name);
  /** @param {string} name */
  const read = async (name) => {
    const e = find(name);
    return e ? readEntryText(bytes, view, e) : null;
  };

  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('Not an Excel workbook (xl/workbook.xml missing).');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  /** @type {Record<string,string>} */
  const relTarget = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) relTarget[id] = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  /** @type {Sheet[]} */
  const sheets = [];
  let fallback = 1;
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? `Sheet${fallback}`);
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const path = (rid && relTarget[rid]) || `xl/worksheets/sheet${fallback}.xml`;
    fallback++;
    const xml = await read(path);
    if (xml) sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  if (!sheets.length) throw new Error('No worksheets found in that file.');
  return sheets;
}
