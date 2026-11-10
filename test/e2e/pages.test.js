import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newPage, open, startServer } from './helpers.js';

let server;
let browser;
before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.stop();
});
const T = { timeout: 120_000 };

test('pages: template, typing saves, to-do progress, links and backlinks, search, markdown export, delete', T, async () => {
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await open(page, server.url, '#/pages');
  await page.waitForSelector('.pg-tpl');
  assert.equal(await page.locator('.pg-tpl').count(), 5);

  // A template makes a page and opens it.
  await page.click('.pg-tpl[data-template="scholarship"]');
  await page.waitForSelector('#pg-title-input');
  assert.equal(await page.inputValue('#pg-title-input'), 'Scholarship season');
  assert.ok((await page.locator('.pg-block').count()) > 5);
  const todos = await page.locator('.pg-check').count();
  assert.ok(todos >= 4);
  assert.match(await page.textContent('#pg-progress'), new RegExp(`0 of ${todos} done`));

  // Tick a to-do: progress changes, and it is saved.
  await page.locator('.pg-check').first().check();
  assert.match(await page.textContent('#pg-progress'), new RegExp(`1 of ${todos} done`));

  // Typing saves without losing focus, and Enter makes a new block.
  await page.fill('#pg-title-input', 'Awards 2027');
  await page.locator('.pg-text').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Remember: ask referees early');
  await page.waitForFunction(() => document.querySelector('#pg-status')?.textContent === 'Saved');
  assert.equal(await page.evaluate(() => document.activeElement?.className.includes('pg-text')), true, 'focus stays in the editor');

  // Reload: everything is still there (stored encrypted, signed in on this device).
  await page.reload();
  await page.waitForSelector('#pg-title-input');
  assert.equal(await page.inputValue('#pg-title-input'), 'Awards 2027');
  assert.equal(await page.locator('.pg-check:checked').count(), 1);
  assert.ok((await page.locator('.pg-text').evaluateAll((els) => els.map((e) => e.value))).includes('Remember: ask referees early'));
  const raw = await page.evaluate(
    () => new Promise((resolve) => {
      const req = indexedDB.open('showup');
      req.onsuccess = () => {
        const all = req.result.transaction('pages').objectStore('pages').getAll();
        all.onsuccess = () => resolve(JSON.stringify(all.result));
      };
    }),
  );
  assert.ok(raw.includes('"enc":1') && !raw.includes('Awards 2027'), 'page content is encrypted at rest');

  // Link to another page: it offers to create it, and the new page shows a backlink.
  await page.locator('#pg-add').click();
  await page.keyboard.type('See [[Internship hunt]] for the other plan');
  await page.locator('.pg-text').last().blur();
  await page.waitForSelector('#pg-links');
  await page.click('#pg-links ~ ul button:has-text("Create page")');
  await page.waitForFunction(() => document.querySelector('#pg-title-input')?.value === 'Internship hunt');
  assert.equal(await page.inputValue('#pg-title-input'), 'Internship hunt');
  await page.waitForSelector('#pg-backlinks a');
  assert.match(await page.textContent('#pg-backlinks'), /Awards 2027/);

  // The sidebar nav marks Pages as current while a page is open.
  assert.equal(await page.getAttribute('nav a[href="#/pages"]', 'aria-current'), 'page');

  // Markdown export.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pg-md')]);
  assert.match(dl.suggestedFilename(), /Internship-hunt\.md$/);

  // Search the list and the command palette.
  await page.click('nav a[href="#/pages"]');
  await page.fill('#pg-search', 'referees');
  assert.equal(await page.locator('.pg-row').count(), 1);
  assert.match(await page.textContent('.pg-row'), /Awards 2027/);
  await page.keyboard.press('Control+k');
  await page.fill('#palette-input', 'Internship');
  assert.ok((await page.locator('.pal-item', { hasText: 'Internship hunt' }).count()) >= 1);
  await page.keyboard.press('Escape');

  // Delete.
  await page.locator('.pg-row', { hasText: 'Awards 2027' }).click();
  await page.click('#pg-delete');
  await page.click('#confirm-ok');
  await page.waitForSelector('#pg-results');
  assert.equal(await page.locator('.pg-row', { hasText: 'Awards 2027' }).count(), 0);
  page.assertClean(/Failed to load resource/);
});

test('pages: a missing page says so; deleting events leaves pages; import Markdown', T, async () => {
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await open(page, server.url, '#/page/does-not-exist');
  await page.waitForSelector('text=That page no longer exists.');
  await page.evaluate(() => (location.hash = '#/pages'));
  await page.setInputFiles('#pg-import', { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Reading list\n\n## Books\n- [x] One\n- [ ] Two\n> a line\n') });
  await page.waitForSelector('#pg-title-input');
  assert.equal(await page.inputValue('#pg-title-input'), 'Reading list');
  assert.equal(await page.locator('.pg-check:checked').count(), 1);
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.click('#wipe');
  await page.click('#confirm-ok');
  await page.evaluate(() => (location.hash = '#/pages'));
  await page.waitForSelector('.pg-row');
  assert.equal(await page.locator('.pg-row', { hasText: 'Reading list' }).count(), 1);
  page.assertClean(/Failed to load resource/);
});
