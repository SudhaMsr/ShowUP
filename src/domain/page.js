// @ts-check
import { newId } from './event.js';

/**
 * Pages: simple Notion-style notes made of blocks. Pure rules only (no DOM, no storage),
 * so they are easy to test. Everything read from storage or a backup goes through
 * normalizePage, which never throws and never keeps unknown fields.
 *
 * @typedef {'text'|'h1'|'h2'|'todo'|'bullet'|'quote'|'divider'} BlockType
 * @typedef {{ id: string, type: BlockType, text: string, done: boolean }} Block
 * @typedef {{ id: string, title: string, icon: string, blocks: Block[], template: string, createdAt: string, updatedAt: string }} Page
 */

export const BLOCK_TYPES = /** @type {const} */ (['text', 'h1', 'h2', 'todo', 'bullet', 'quote', 'divider']);
export const PAGE_LIMITS = { title: 120, text: 2000, blocks: 500, icon: 4, pages: 5000 };

/** @param {string} s @param {number} max */
function clean(s, max) {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

/** @param {unknown} v @param {string} fallback */
function str(v, fallback = '') {
  return typeof v === 'string' ? v : fallback;
}

/** @param {unknown} raw @returns {Block|null} */
export function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const type = BLOCK_TYPES.includes(/** @type {any} */ (r.type)) ? /** @type {BlockType} */ (r.type) : 'text';
  const id = typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : newId();
  return { id, type, text: type === 'divider' ? '' : clean(str(r.text), PAGE_LIMITS.text), done: type === 'todo' && r.done === true };
}

/**
 * @param {Record<string, unknown>} input
 * @param {{ now?: Date }} [opts]
 * @returns {Page}
 */
export function normalizePage(input, opts = {}) {
  const now = (opts.now ?? new Date()).toISOString();
  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  /** @type {Block[]} */
  const blocks = [];
  const seen = new Set();
  for (const b of rawBlocks.slice(0, PAGE_LIMITS.blocks)) {
    const nb = normalizeBlock(b);
    if (!nb) continue;
    if (seen.has(nb.id)) nb.id = newId();
    seen.add(nb.id);
    blocks.push(nb);
  }
  const id = typeof input.id === 'string' && /^[\w-]{1,64}$/.test(input.id) ? input.id : newId();
  return {
    id,
    title: clean(str(input.title), PAGE_LIMITS.title).trim(),
    icon: clean(str(input.icon), PAGE_LIMITS.icon).trim(),
    blocks,
    template: /^[\w-]{0,40}$/.test(str(input.template)) ? str(input.template) : '',
    createdAt: typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt)) ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : now,
  };
}

/** @param {Page} p @returns {{ ok: true } | { ok: false, errors: Record<string, string> }} */
export function validatePage(p) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!p.title) errors.title = 'Give the page a title.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

/** @param {string} type */
export function blockLabel(type) {
  return /** @type {Record<string, string>} */ ({
    text: 'Text', h1: 'Heading', h2: 'Subheading', todo: 'To-do', bullet: 'Bullet', quote: 'Quote', divider: 'Divider',
  })[type] ?? 'Text';
}

/** Titles mentioned as [[Title]] in some text. @param {string} text @returns {string[]} */
export function extractLinks(text) {
  const out = [];
  for (const m of text.matchAll(/\[\[([^\[\]\n]{1,120})\]\]/g)) out.push(m[1].trim());
  return out.filter(Boolean);
}

/** @param {Page} p @returns {string[]} unique titles linked from this page */
export function linksFrom(p) {
  const set = new Set(p.blocks.flatMap((b) => extractLinks(b.text)).map((t) => t.toLowerCase()));
  return [...set];
}

/**
 * Pages that link to `page` with [[Title]] (case-insensitive), most recently edited first.
 * @param {Page[]} pages @param {Page} page
 */
export function backlinks(pages, page) {
  const t = page.title.trim().toLowerCase();
  if (!t) return [];
  return pages
    .filter((p) => p.id !== page.id && linksFrom(p).includes(t))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** @param {Page} p @returns {{ done: number, total: number }} */
export function progress(p) {
  const todos = p.blocks.filter((b) => b.type === 'todo');
  return { done: todos.filter((b) => b.done).length, total: todos.length };
}

/** Find a page by exact title, ignoring case. @param {Page[]} pages @param {string} title */
export function findByTitle(pages, title) {
  const t = title.trim().toLowerCase();
  return pages.find((p) => p.title.trim().toLowerCase() === t);
}

/** Pages whose title or text contains every word typed. @param {Page[]} pages @param {string} query */
export function searchPages(pages, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return pages.filter((p) => {
    const hay = `${p.title}\n${p.blocks.map((b) => b.text).join('\n')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Markdown for download or copy. @param {Page} p */
export function toMarkdown(p) {
  const lines = [`# ${p.icon ? `${p.icon} ` : ''}${p.title}`, ''];
  for (const b of p.blocks) {
    switch (b.type) {
      case 'h1': lines.push(`## ${b.text}`, ''); break;
      case 'h2': lines.push(`### ${b.text}`, ''); break;
      case 'todo': lines.push(`- [${b.done ? 'x' : ' '}] ${b.text}`); break;
      case 'bullet': lines.push(`- ${b.text}`); break;
      case 'quote': lines.push(`> ${b.text}`, ''); break;
      case 'divider': lines.push('---', ''); break;
      default: lines.push(b.text, '');
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * Read simple Markdown back into blocks (headings, to-dos, bullets, quotes, rules).
 * @param {string} md @returns {{ title: string, blocks: Block[] }}
 */
export function fromMarkdown(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  let title = '';
  /** @type {Block[]} */
  const blocks = [];
  /** @param {BlockType} type @param {string} text @param {boolean} [done] */
  const add = (type, text, done = false) => {
    if (blocks.length < PAGE_LIMITS.blocks) blocks.push({ id: newId(), type, text: clean(text, PAGE_LIMITS.text), done });
  };
  for (const line of lines) {
    const t = line.trimEnd();
    if (!t.trim()) continue;
    let m;
    if ((m = /^#\s+(.*)$/.exec(t)) && !title) title = clean(m[1], PAGE_LIMITS.title).trim();
    else if ((m = /^##\s+(.*)$/.exec(t))) add('h1', m[1]);
    else if ((m = /^#{3,6}\s+(.*)$/.exec(t))) add('h2', m[1]);
    else if ((m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(t))) add('todo', m[2], m[1].toLowerCase() === 'x');
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(t))) add('bullet', m[1]);
    else if ((m = /^>\s?(.*)$/.exec(t))) add('quote', m[1]);
    else if (/^(-{3,}|\*{3,})$/.test(t.trim())) add('divider', '');
    else add('text', t.trim());
  }
  return { title, blocks };
}

/** @param {BlockType} type @param {string} text @param {boolean} [done] @returns {Block} */
const b = (type, text, done = false) => ({ id: newId(), type, text, done });

/**
 * Starter kits: one tap makes a ready-made page. Text here is plain, no personal data.
 * @typedef {{ id: string, name: string, icon: string, blurb: string, title: string, make: () => Block[] }} Template
 * @type {Template[]}
 */
export const TEMPLATES = [
  {
    id: 'internship', name: 'Internship hunt', icon: '', blurb: 'Targets, applications and follow-ups in one place.', title: 'Internship hunt',
    make: () => [
      b('h1', 'Goal'), b('text', 'What kind of role, where, and by when?'),
      b('h1', 'This week'), b('todo', 'Shortlist 5 companies'), b('todo', 'Tailor my CV for the first one'), b('todo', 'Ask a referee for a reference'),
      b('h1', 'Applications'), b('bullet', 'Add each application as an opportunity so its deadline is tracked.'),
      b('h1', 'Interview prep'), b('todo', 'Prepare 3 stories'), b('todo', 'Practise common questions out loud'),
      b('h1', 'Notes'), b('text', ''),
    ],
  },
  {
    id: 'scholarship', name: 'Scholarship season', icon: '', blurb: 'Documents, essays and deadlines for every award.', title: 'Scholarship season',
    make: () => [
      b('h1', 'Documents to gather'), b('todo', 'Transcript'), b('todo', 'ID or proof of status'), b('todo', 'Two references'), b('todo', 'Personal statement draft'),
      b('h1', 'Essay plan'), b('text', 'One strong story, reused and reshaped for each prompt.'),
      b('h1', 'Awards'), b('bullet', 'Add each award as an opportunity with its deadline.'),
      b('quote', 'Start the essay a week before you think you need to.'),
    ],
  },
  {
    id: 'hackathon', name: 'Hackathon team kit', icon: '', blurb: 'Team, idea, timeline and the submission checklist.', title: 'Hackathon team kit',
    make: () => [
      b('h1', 'Team'), b('bullet', 'Name, role, contact'),
      b('h1', 'Idea in one sentence'), b('text', ''),
      b('h1', 'Timeline'), b('todo', 'Register and confirm the team'), b('todo', 'Agree scope that fits the time'), b('todo', 'Working demo'), b('todo', 'Record a short video'),
      b('h1', 'Submission checklist'), b('todo', 'Repository link'), b('todo', 'Demo link'), b('todo', 'Slides or description'), b('todo', 'Submit before the deadline'),
    ],
  },
  {
    id: 'exams', name: 'Exam revision plan', icon: '', blurb: 'Topics to cover and a progress count as you tick them off.', title: 'Exam revision plan',
    make: () => [
      b('h1', 'Exam'), b('text', 'Course, date and what it covers.'),
      b('h1', 'Topics'), b('todo', 'Topic 1'), b('todo', 'Topic 2'), b('todo', 'Topic 3'), b('todo', 'Topic 4'),
      b('h1', 'Past papers'), b('todo', 'Paper 1'), b('todo', 'Paper 2'),
      b('h1', 'Weak spots'), b('bullet', 'Write what to revisit here.'),
    ],
  },
  {
    id: 'blank', name: 'Blank page', icon: '', blurb: 'Start from nothing.', title: 'Untitled',
    make: () => [b('text', '')],
  },
];

/** @param {string} templateId @param {{ now?: Date, title?: string }} [opts] @returns {Page|null} */
export function pageFromTemplate(templateId, opts = {}) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) return null;
  return normalizePage({ title: opts.title ?? t.title, icon: t.icon, blocks: t.make(), template: t.id }, { now: opts.now });
}
