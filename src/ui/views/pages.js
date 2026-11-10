// @ts-check
import { backlinks, blockLabel, BLOCK_TYPES, findByTitle, fromMarkdown, linksFrom, PAGE_LIMITS, progress, searchPages, TEMPLATES, toMarkdown } from '../../domain/page.js';
import { newId } from '../../domain/event.js';
import { confirmDialog, download, h, toast } from '../dom.js';

/** @typedef {import('../../domain/page.js').Page} Page */
/** @typedef {import('../../domain/page.js').Block} Block */
/** @typedef {import('./today.js').ViewCtx & { pageId?: string }} PagesCtx */

const MAX_IMPORT_BYTES = 1_000_000;

/** @param {Page} p */
function progressLabel(p) {
  const { done, total } = progress(p);
  return total ? `${done} of ${total} done` : '';
}

/** @param {string} iso */
function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The list of pages with templates, search and import. @param {PagesCtx} ctx */
export function renderPages(ctx) {
  const { store } = ctx;
  const { pages } = store.getState();
  const root = h('div', { class: 'stack-lg' });

  /** @param {string} templateId */
  const create = async (templateId) => {
    const page = await store.createPage(templateId);
    if (!page) return toast('Could not create that page.', { kind: 'error' });
    ctx.goto(`#/page/${page.id}`);
  };

  const gallery = h('section', { class: 'panel', 'aria-labelledby': 'pg-tpl' },
    h('h2', { id: 'pg-tpl' }, 'Start from a template'),
    h('p', { class: 'muted' }, 'Each one makes a ready-to-use page you can change.'),
    h('div', { class: 'pg-tpls' }, TEMPLATES.map((t) =>
      h('button', { class: 'pg-tpl', type: 'button', dataset: { template: t.id }, onclick: () => create(t.id) },
        h('strong', null, t.name), h('span', { class: 'muted' }, t.blurb)))));

  const results = h('div', { class: 'list', id: 'pg-results' });
  const search = /** @type {HTMLInputElement} */ (h('input', { id: 'pg-search', type: 'search', placeholder: 'Search pages…', autocomplete: 'off', 'aria-label': 'Search pages' }));
  const paintList = () => {
    const q = search.value.trim();
    const shown = q ? searchPages(pages, q) : pages;
    results.replaceChildren(...(shown.length
      ? shown.map((p) => h('a', { class: 'pg-row', href: `#/page/${encodeURIComponent(p.id)}`, dataset: { page: p.id } },
          h('span', { class: 'pg-title' }, p.title),
          h('span', { class: 'muted' }, [progressLabel(p), shortDate(p.updatedAt)].filter(Boolean).join(' · '))))
      : [h('p', { class: 'muted' }, pages.length ? 'No page matches that.' : 'No pages yet. Pick a template above.')]));
  };
  search.addEventListener('input', paintList);
  paintList();

  const file = /** @type {HTMLInputElement} */ (h('input', { type: 'file', id: 'pg-import', accept: '.md,.markdown,.txt,text/markdown,text/plain', class: 'sr-only', 'aria-label': 'Choose a Markdown file to import' }));
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) return toast('That file is too large to import.', { kind: 'error' });
    const parsed = fromMarkdown(await f.text());
    const title = parsed.title || f.name.replace(/\.[^.]+$/, '').slice(0, PAGE_LIMITS.title) || 'Imported page';
    const res = await store.savePage({ title, blocks: parsed.blocks.length ? parsed.blocks : [{ id: newId(), type: 'text', text: '', done: false }] });
    if (!res.ok) return toast(Object.values(res.errors)[0] ?? 'Could not import that file.', { kind: 'error' });
    toast('Page imported.');
    ctx.goto(`#/page/${res.page.id}`);
  });

  root.append(
    gallery,
    h('section', { class: 'panel', 'aria-labelledby': 'pg-all' },
      h('div', { class: 'row between' },
        h('h2', { id: 'pg-all' }, 'Your pages', h('span', { class: 'count' }, String(pages.length))),
        h('label', { class: 'btn btn-small', for: 'pg-import' }, 'Import Markdown')),
      file,
      h('div', { class: 'field' }, h('label', { for: 'pg-search', class: 'sr-only' }, 'Search pages'), search),
      results));
  return root;
}

/** One page: title, blocks, linked pages. Keeps its own draft so typing never repaints the view. @param {PagesCtx} ctx */
export function renderPage(ctx) {
  const { store } = ctx;
  const id = ctx.pageId ?? '';
  const stored = store.getState().pages.find((p) => p.id === id);
  if (!stored) {
    return h('div', { class: 'stack' }, h('p', null, 'That page no longer exists.'), h('a', { class: 'btn', href: '#/pages' }, 'Back to Pages'));
  }
  /** @type {{ title: string, blocks: Block[] }} */
  const draft = { title: stored.title, blocks: stored.blocks.map((b) => ({ ...b })) };
  if (!draft.blocks.length) draft.blocks.push({ id: newId(), type: 'text', text: '', done: false });

  const status = h('p', { class: 'muted pg-status', id: 'pg-status', role: 'status' }, 'Saved');
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const save = async () => {
    clearTimeout(timer);
    if (!draft.title.trim()) { status.textContent = 'Give the page a title to save it.'; return; }
    const res = await store.savePage({ id, title: draft.title, blocks: draft.blocks });
    status.textContent = res.ok ? 'Saved' : Object.values(res.errors)[0] ?? 'Not saved';
    paintSide();
  };
  const later = () => {
    status.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  // Leaving the page (or locking) flushes any edit still waiting to be saved.
  window.addEventListener('hashchange', () => { if (timer) void save(); }, { once: true });

  const title = /** @type {HTMLInputElement} */ (h('input', { id: 'pg-title-input', class: 'pg-title-input', type: 'text', value: draft.title, maxlength: String(PAGE_LIMITS.title), 'aria-label': 'Page title', placeholder: 'Untitled' }));
  title.addEventListener('input', () => { draft.title = title.value; later(); });

  const blocksEl = h('div', { class: 'pg-blocks', id: 'pg-blocks' });
  const meter = h('div', { class: 'pg-progress', id: 'pg-progress' });
  const side = h('div', { class: 'stack', id: 'pg-side' });

  const paintMeter = () => {
    const todos = draft.blocks.filter((b) => b.type === 'todo');
    const done = todos.filter((b) => b.done).length;
    meter.replaceChildren(...(todos.length
      ? [h('progress', { max: String(todos.length), value: String(done), 'aria-label': 'To-do progress' }), h('span', { class: 'muted' }, `${done} of ${todos.length} done`)]
      : []));
  };

  /** @param {string} blockId */
  const focusBlock = (blockId) => /** @type {HTMLElement|null} */ (blocksEl.querySelector(`[data-block="${blockId}"] .pg-text`))?.focus();

  const paintBlocks = () => {
    blocksEl.replaceChildren(...draft.blocks.map((b, i) => {
      const type = /** @type {HTMLSelectElement} */ (h('select', { class: 'pg-type', 'aria-label': `Block ${i + 1} type` }, BLOCK_TYPES.map((t) => h('option', { value: t, selected: t === b.type }, blockLabel(t)))));
      type.value = b.type;
      type.addEventListener('change', () => {
        b.type = /** @type {Block['type']} */ (type.value);
        if (b.type !== 'todo') b.done = false;
        if (b.type === 'divider') b.text = '';
        later();
        paintBlocks();
        paintSide();
      });
      const check = b.type === 'todo'
        ? h('input', { type: 'checkbox', class: 'pg-check', checked: b.done, 'aria-label': `Done: ${b.text || 'to-do'}`, onchange: (/** @type {Event} */ e) => { b.done = /** @type {HTMLInputElement} */ (e.target).checked; later(); paintMeter(); } })
        : null;
      const text = b.type === 'divider'
        ? h('hr', { class: 'pg-rule' })
        : /** @type {HTMLInputElement} */ (h('input', { class: `pg-text pg-${b.type}${b.done ? ' is-done' : ''}`, type: 'text', value: b.text, maxlength: String(PAGE_LIMITS.text), 'aria-label': `Block ${i + 1} text`, placeholder: i === 0 ? 'Write something, or link a page with [[Title]]' : '' }));
      if (b.type !== 'divider') {
        const input = /** @type {HTMLInputElement} */ (text);
        input.addEventListener('input', () => { b.text = input.value; later(); });
        input.addEventListener('blur', () => { paintSide(); });
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && !ev.isComposing) {
            ev.preventDefault();
            if (draft.blocks.length >= PAGE_LIMITS.blocks) return;
            const next = { id: newId(), type: /** @type {Block['type']} */ (b.type === 'todo' || b.type === 'bullet' ? b.type : 'text'), text: '', done: false };
            draft.blocks.splice(i + 1, 0, next);
            later();
            paintBlocks();
            focusBlock(next.id);
          } else if (ev.key === 'Backspace' && !input.value && draft.blocks.length > 1) {
            ev.preventDefault();
            const prev = draft.blocks[i - 1] ?? draft.blocks[i + 1];
            draft.blocks.splice(i, 1);
            later();
            paintBlocks();
            paintMeter();
            if (prev) focusBlock(prev.id);
          }
        });
      }
      const row = h('div', { class: 'pg-block', dataset: { block: b.id } },
        type, check, text,
        h('button', { class: 'btn btn-icon btn-small', type: 'button', 'aria-label': `Remove block ${i + 1}`, onclick: () => {
          draft.blocks.splice(i, 1);
          if (!draft.blocks.length) draft.blocks.push({ id: newId(), type: 'text', text: '', done: false });
          later();
          paintBlocks();
          paintMeter();
        } }, '×'));
      return row;
    }));
    paintMeter();
  };

  /** Pages this one links to (and can create), and pages that link here. */
  const paintSide = () => {
    const current = { ...stored, title: draft.title, blocks: draft.blocks };
    const all = store.getState().pages;
    const out = linksFrom(current);
    const back = backlinks(all, current);
    side.replaceChildren(...[
      out.length
        ? h('section', { class: 'panel', 'aria-labelledby': 'pg-links' },
            h('h2', { id: 'pg-links' }, 'Links on this page'),
            h('ul', { class: 'pg-linklist' }, out.map((t) => {
              const target = findByTitle(all, t);
              const label = current.blocks.flatMap((b) => [...b.text.matchAll(/\[\[([^\[\]\n]{1,120})\]\]/g)].map((m) => m[1].trim())).find((x) => x.toLowerCase() === t) ?? t;
              return h('li', null, target
                ? h('a', { href: `#/page/${encodeURIComponent(target.id)}` }, target.title)
                : h('button', { class: 'linklike', type: 'button', onclick: async () => {
                    await save();
                    const res = await store.savePage({ title: label, blocks: [{ id: newId(), type: 'text', text: '', done: false }] });
                    if (res.ok) ctx.goto(`#/page/${res.page.id}`);
                  } }, `Create page “${label}”`));
            })))
        : null,
      h('section', { class: 'panel', 'aria-labelledby': 'pg-back' },
        h('h2', { id: 'pg-back' }, 'Linked from'),
        back.length
          ? h('ul', { class: 'pg-linklist', id: 'pg-backlinks' }, back.map((p) => h('li', null, h('a', { href: `#/page/${encodeURIComponent(p.id)}` }, p.title))))
          : h('p', { class: 'muted' }, 'No other page links here yet. Use [[Page title]] in another page.')),
    ].filter((x) => x !== null));
  };

  paintBlocks();
  paintSide();

  return h('div', { class: 'stack-lg pg' },
    h('div', { class: 'row between' }, h('a', { class: 'btn btn-small', href: '#/pages' }, 'All pages'), status),
    title, meter, blocksEl,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', id: 'pg-add', onclick: () => {
        if (draft.blocks.length >= PAGE_LIMITS.blocks) return toast('This page has reached its block limit.', { kind: 'error' });
        const next = { id: newId(), type: /** @type {Block['type']} */ ('text'), text: '', done: false };
        draft.blocks.push(next);
        later();
        paintBlocks();
        focusBlock(next.id);
      } }, 'Add block'),
      h('button', { class: 'btn', type: 'button', id: 'pg-md', onclick: () => download(`${(draft.title || 'page').replace(/[^\w-]+/g, '-').slice(0, 40)}.md`, toMarkdown({ ...stored, title: draft.title, blocks: draft.blocks }), 'text/markdown;charset=utf-8') }, 'Export Markdown'),
      h('button', { class: 'btn btn-danger', type: 'button', id: 'pg-delete', onclick: async () => {
        if (await confirmDialog('Delete this page?', `“${draft.title || 'Untitled'}” will be removed from this browser.`, 'Delete')) {
          clearTimeout(timer);
          timer = undefined;
          await store.removePage(id);
          toast('Page deleted.');
          ctx.goto('#/pages');
        }
      } }, 'Delete page')),
    side);
}
