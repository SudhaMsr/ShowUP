import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backlinks, extractLinks, findByTitle, fromMarkdown, normalizePage, pageFromTemplate, progress, searchPages, TEMPLATES, toMarkdown, validatePage } from '../../src/domain/page.js';
import { MemoryRepository } from '../../src/storage/repository.js';
import { createStore } from '../../src/app/store.js';

const NOW = new Date('2026-03-01T10:00:00Z');

test('normalizePage never throws and drops junk', () => {
  const p = normalizePage({ title: '  Plan\u0000  ', blocks: [null, 5, { type: 'nope', text: 'x' }, { type: 'todo', text: 'a', done: true }, { type: 'divider', text: 'ignored' }], icon: 'x'.repeat(99) }, { now: NOW });
  assert.equal(p.title, 'Plan');
  assert.equal(p.blocks.length, 3);
  assert.equal(p.blocks[0].type, 'text');
  assert.equal(p.blocks[1].done, true);
  assert.equal(p.blocks[2].text, '');
  assert.ok(p.icon.length <= 4);
  assert.equal(normalizePage({}).blocks.length, 0);
});

test('normalizePage keeps ids unique and valid, and caps block count and length', () => {
  const same = { id: 'dup', type: 'text', text: 'a' };
  const p = normalizePage({ blocks: [same, same, { id: '../bad id', type: 'text', text: 'b' }] });
  assert.equal(new Set(p.blocks.map((b) => b.id)).size, 3);
  assert.ok(p.blocks.every((b) => /^[\w-]{1,64}$/.test(b.id)));
  const many = normalizePage({ blocks: Array.from({ length: 800 }, () => ({ type: 'text', text: 'x'.repeat(5000) })) });
  assert.equal(many.blocks.length, 500);
  assert.equal(many.blocks[0].text.length, 2000);
});

test('validatePage needs a title', () => {
  assert.equal(validatePage(normalizePage({ title: '   ' })).ok, false);
  assert.equal(validatePage(normalizePage({ title: 'Ok' })).ok, true);
});

test('links and backlinks are case-insensitive and exclude the page itself', () => {
  assert.deepEqual(extractLinks('see [[Alpha]] and [[ beta ]] but not [[]] or [[a\nb]]'), ['Alpha', 'beta']);
  const a = normalizePage({ id: 'a', title: 'Alpha', blocks: [{ type: 'text', text: 'about [[alpha]]' }] });
  const b = normalizePage({ id: 'b', title: 'Beta', blocks: [{ type: 'text', text: 'links to [[ALPHA]]' }], updatedAt: '2026-03-02T00:00:00Z' });
  const c = normalizePage({ id: 'c', title: 'Gamma', blocks: [{ type: 'text', text: 'nothing' }] });
  assert.deepEqual(backlinks([a, b, c], a).map((p) => p.id), ['b']);
  assert.equal(findByTitle([a, b], ' beta ')?.id, 'b');
});

test('progress counts only to-dos', () => {
  const p = normalizePage({ title: 'x', blocks: [{ type: 'todo', text: '1', done: true }, { type: 'todo', text: '2' }, { type: 'text', text: 'n' }] });
  assert.deepEqual(progress(p), { done: 1, total: 2 });
});

test('searchPages matches every word in title or text', () => {
  const p = normalizePage({ title: 'Scholarship season', blocks: [{ type: 'text', text: 'Transcript due Friday' }] });
  assert.equal(searchPages([p], 'transcript friday').length, 1);
  assert.equal(searchPages([p], 'transcript monday').length, 0);
  assert.equal(searchPages([p], '   ').length, 0);
});

test('markdown round trip keeps structure', () => {
  const p = pageFromTemplate('exams', { now: NOW });
  const md = toMarkdown(p);
  const back = fromMarkdown(md);
  assert.equal(back.title, p.title);
  assert.deepEqual(back.blocks.map((b) => [b.type, b.text, b.done]), p.blocks.map((b) => [b.type, b.text, b.done]));
  const ticked = fromMarkdown('# T\n- [x] done\n- [ ] open\n> q\n---\n### h\nplain');
  assert.deepEqual(ticked.blocks.map((b) => b.type), ['todo', 'todo', 'quote', 'divider', 'h2', 'text']);
  assert.equal(ticked.blocks[0].done, true);
});

test('every template makes a valid page', () => {
  for (const t of TEMPLATES) {
    const p = pageFromTemplate(t.id, { now: NOW });
    assert.ok(p && validatePage(p).ok, t.id);
    assert.ok(p.blocks.length > 0);
  }
  assert.equal(pageFromTemplate('missing'), null);
});

test('store: create from template, edit, backlink, delete', async () => {
  const repo = new MemoryRepository();
  const store = createStore(repo, { now: () => NOW });
  await store.init();
  const made = await store.createPage('internship');
  assert.ok(made);
  assert.equal(store.getState().pages.length, 1);
  assert.equal((await repo.allPages()).length, 1);
  const bad = await store.savePage({ id: made.id, title: '  ' });
  assert.equal(bad.ok, false);
  const ok = await store.savePage({ id: made.id, title: 'Renamed', blocks: [{ type: 'todo', text: 'x', done: true }] });
  assert.equal(ok.ok, true);
  assert.equal(store.getState().pages[0].title, 'Renamed');
  assert.equal(store.getState().pages[0].createdAt, made.createdAt);
  // pages survive a reload from the same repository
  const again = createStore(repo);
  await again.init();
  assert.equal(again.getState().pages[0].title, 'Renamed');
  await store.removePage(made.id);
  assert.equal(store.getState().pages.length, 0);
  assert.equal((await repo.allPages()).length, 0);
  // clearing events leaves notes alone
  await store.createPage('blank');
  await store.clearAll();
  assert.equal(store.getState().pages.length, 1);
});
