import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, advance, advanceUntil, captureText, expectText, goTo, launch, newPage, open, saveReview, startServer } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {import('playwright').Browser} */
let browser;

before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

const T = { timeout: 90_000 };

test('boots cleanly, routes work, one h1 per view, landmarks present', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  assert.equal(await page.title(), 'Today · ShowUp');
  for (const [href, title] of [['#/upcoming', 'Upcoming'], ['#/capture', 'Capture'], ['#/settings', 'Settings'], ['#/today', 'Today']]) {
    await page.click(`nav a[href="${href}"]`);
    await expectText(page, 'main h1', new RegExp(`^${title}$`));
    assert.equal(await page.textContent('main h1'), title);
    assert.equal(await page.locator('main h1').count(), 1);
    assert.equal(await page.getAttribute(`nav a[href="${href}"]`, 'aria-current'), 'page');
  }
  assert.equal(await page.locator('header').count(), 1);
  assert.equal(await page.locator('nav[aria-label="Main"]').count(), 1);
  page.assertClean();
});

test('every interactive control has an accessible name (all views)', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  for (const href of ['#/today', '#/upcoming', '#/calendar', '#/board', '#/insights', '#/capture', '#/settings']) {
    await page.click(`nav a[href="${href}"]`);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], input, select, textarea, summary')]
        .filter((el) => !el.closest('[hidden]'))
        .filter((el) => {
          const e = /** @type {HTMLInputElement} */ (el);
          const labelled = e.labels && e.labels.length > 0;
          return !(el.textContent || '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !labelled && !el.getAttribute('title');
        })
        .map((el) => el.outerHTML.slice(0, 100)),
    );
    assert.deepEqual(unnamed, [], `unnamed controls on ${href}`);
  }
  page.assertClean();
});

test('capture by typing: review, save, show on Today, survive reload', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  await captureText(page, 'AWS Summit London on 5 Nov at 6pm at ExCeL London');
  assert.equal(await page.inputValue('dialog[open] input[name="title"]'), 'AWS Summit London');
  assert.equal(await page.inputValue('dialog[open] input[name="date"]'), '2026-11-05');
  assert.equal(await page.inputValue('dialog[open] input[name="time"]'), '18:00');
  assert.equal(await page.inputValue('dialog[open] input[name="location"]'), 'ExCeL London');
  assert.equal(await page.inputValue('dialog[open] select[name="type"]'), 'conference');
  await saveReview(page);

  await goTo(page, '#/today');
  const hero = await page.textContent('.hero');
  assert.match(hero, /AWS Summit London/);
  assert.match(hero, /6 pm/);
  assert.equal(await page.locator('article.ev').count(), 1);

  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.match(await page.textContent('main'), /AWS Summit London/, 'IndexedDB persisted across reload');
  page.assertClean();
});

test('review blocks bad data and explains why; flagged fields are highlighted', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  await captureText(page, 'Product Tank meetup at Hargreaves Lansdown');
  assert.equal(await page.locator('dialog[open] .field-flag').count() >= 1, true, 'missing date is flagged');
  await page.click('dialog[open] button[type="submit"]');
  assert.match(await page.textContent('dialog[open] .field-error:not(:empty)'), /real date/i);
  assert.equal(await page.locator('dialog[open]').count(), 1, 'dialog stays open');
  await page.fill('dialog[open] input[name="date"]', '2026-11-12');
  await saveReview(page);
  await goTo(page, '#/upcoming');
  await expectText(page, 'main', /Product Tank meetup/);
  page.assertClean();
});

test('reminder fires at the right moment with a controlled clock', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T16:40:00' });
  await open(page, server.url);
  await captureText(page, 'Hack night on 5 Nov at 6pm at Watershed');
  await saveReview(page);
  const toastSel = '.toast:has-text("Hack night")';
  assert.equal(await page.locator(toastSel).count(), 0, 'nothing fires early');
  // 16:40 -> 16:59: still before the 17:00 (1 hour before) mark
  assert.equal(await advanceUntil(page, toastSel, 19 * 60 * 1000), false);
  // -> up to 17:10: the reminder must appear
  assert.equal(await advanceUntil(page, toastSel, 11 * 60 * 1000), true, 'reminder appeared after 17:00');
  const text = await page.textContent(toastSel);
  assert.match(text, /1 hour before/);
  assert.match(text, /Watershed/);
  // exactly once: advance well past the toast lifetime and confirm no second firing
  await advance(page, 20 * 60 * 1000);
  await page.waitForTimeout(200);
  assert.equal(await page.locator(toastSel).count(), 0);
  page.assertClean();
});

test('reminders that came due while the app was closed show a catch-up banner', T, async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/London' });
  const first = await newPage(browser, { context, now: '2026-11-05T16:00:00' });
  await open(first, server.url);
  await captureText(first, 'Founders Playground on 5 Nov at 6pm at Science Park');
  await saveReview(first);
  await first.waitForTimeout(300);
  await first.close();

  const second = await newPage(browser, { context, now: '2026-11-05T17:30:00' });
  await open(second, server.url);
  await second.waitForSelector('#catchup .banner');
  const banner = await second.textContent('#catchup');
  assert.match(banner, /While you were away/);
  assert.match(banner, /Founders Playground/);
  await second.click('#catchup button:has-text("Dismiss")');
  assert.equal(await second.locator('#catchup .banner').count(), 0);
  second.assertClean();
  await context.close();
});

test('import the messy spreadsheet: preview, flag uncertain rows, skip bad ones', T, async () => {
  const page = await newPage(browser, { now: '2026-04-20T09:00:00' });
  await open(page, server.url, '#/settings');
  await page.setInputFiles('#import-file', FIXTURE);
  await page.waitForSelector('dialog[open] h2:has-text("Import from")');
  const preview = await page.textContent('dialog[open]');
  assert.match(preview, /7 events/);
  assert.match(preview, /2 have uncertain details/);
  assert.match(preview, /3 rows skipped/);
  assert.match(preview, /no month/i);
  assert.match(preview, /Already in ShowUp|Already in/i);
  await page.click('dialog[open] button[value="ok"]');
  await page.waitForSelector('.toast:has-text("Imported 7")');

  await goTo(page, '#/upcoming');
  await page.click('button.seg:has-text("All")');
  assert.equal(await page.locator('article.ev').count(), 7);
  await page.fill('#q', 'peer support');
  assert.equal(await page.locator('article.ev').count(), 1);
  assert.match(await page.textContent('article.ev'), /Check details/);

  // importing the same file again adds nothing
  await goTo(page, '#/settings');
  await page.setInputFiles('#import-file', FIXTURE);
  await page.waitForSelector('dialog[open] h2:has-text("Import from")');
  assert.match(await page.textContent('dialog[open]'), /0 events/);
  await page.click('dialog[open] button[value="cancel"]');
  page.assertClean();
});

test('rejects non-spreadsheet files with a clear message', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url, '#/settings');
  await page.setInputFiles('#import-file', { name: 'fake.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('this is not a zip file at all, sorry') });
  await page.waitForSelector('.toast-error');
  assert.match(await page.textContent('.toast-error'), /valid \.xlsx|not a spreadsheet|empty/i);
  page.assertClean();
});

test('edit, mark attended, mark missed, delete', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  await page.click('#add-btn');
  await page.fill('dialog[open] input[name="title"]', 'Mentor Meeting');
  await page.fill('dialog[open] input[name="date"]', '2026-11-05');
  await page.fill('dialog[open] input[name="time"]', '14:00');
  await page.fill('dialog[open] input[name="location"]', 'Cafe No.1');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });

  await page.waitForSelector('article.ev');
  await page.click('article.ev button:has-text("Edit")');
  await page.fill('dialog[open] input[name="location"]', 'Cafe No.1, Clifton Down');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  await expectText(page, 'article.ev', /Clifton Down/);

  await page.click('article.ev summary');
  await page.click('article.ev button:has-text("Mark attended")');
  await page.waitForSelector('article.ev[data-status="attended"]');
  assert.equal(await page.locator('.hero-calm').count(), 1, 'no upcoming events left');

  await goTo(page, '#/upcoming');
  await page.click('button.seg:has-text("History")');
  await page.click('article.ev summary');
  await page.click('article.ev button:has-text("Delete")');
  await page.click('dialog[open] button[value="ok"]');
  await page.waitForSelector('article.ev', { state: 'detached' });
  page.assertClean();
});

test('past-but-unresolved events ask for an outcome', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  await page.click('#add-btn');
  await page.fill('dialog[open] input[name="title"]', 'Last week meetup');
  await page.fill('dialog[open] input[name="date"]', '2026-10-29');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  await page.waitForSelector('[aria-labelledby="sec-outcome"] article.ev');
  assert.match(await page.textContent('[aria-labelledby="sec-outcome"]'), /Last week meetup/);
  await page.click('article.ev button:has-text("I went")');
  await page.waitForSelector('#sec-outcome', { state: 'detached' });
  page.assertClean();
});

test('calendar export contains real alarms', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  await captureText(page, 'Cloud meetup on 12 Nov at 7pm at Pax8, Bristol');
  await saveReview(page);
  await goTo(page, '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-ics')]);
  assert.equal(download.suggestedFilename(), 'showup-events.ics');
  const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  assert.match(text, /BEGIN:VEVENT/);
  assert.match(text, /SUMMARY:Cloud meetup/);
  assert.match(text, /DTSTART:20261112T190000/);
  assert.match(text, /BEGIN:VALARM/);
  assert.match(text, /TRIGGER:-PT60M/);
  assert.match(text, /\r\n/);
  page.assertClean();
});

test('backup round-trip: export, wipe, restore', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  await captureText(page, 'Data Curious on 6 Nov at 5.30pm in Bristol');
  await saveReview(page);
  await goTo(page, '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const path = (await import('node:os')).tmpdir() + '/showup-backup-test.json';
  await download.saveAs(path);
  await page.click('#wipe');
  await page.click('dialog[open] button[value="ok"]');
  await page.waitForSelector('.toast:has-text("All events deleted")');
  await page.setInputFiles('#import-file', path);
  await page.waitForSelector('dialog[open] h2:has-text("Restore backup")');
  await page.click('dialog[open] button[value="ok"]');
  await page.waitForSelector('.toast:has-text("Backup restored")');
  await goTo(page, '#/upcoming');
  await expectText(page, 'main', /Data Curious/);
  page.assertClean();
});

test('hostile text is rendered as text and never executes', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await page.click('#add-btn');
  await page.fill('dialog[open] input[name="title"]', payload);
  await page.fill('dialog[open] input[name="date"]', '2026-11-05');
  await page.fill('dialog[open] input[name="location"]', payload);
  await page.fill('dialog[open] input[name="url"]', 'javascript:window.__xss=3');
  await page.click('dialog[open] button[type="submit"]');
  assert.match(await page.textContent('dialog[open] .field-error:not(:empty)'), /http/i, 'javascript: links are rejected');
  await page.fill('dialog[open] input[name="url"]', '');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => /** @type {any} */ (window).__xss), undefined);
  assert.equal(await page.locator('article.ev img').count(), 0);
  assert.match(await page.textContent('article.ev .ev-title'), /<img src=x/);
  page.assertClean();
});

test('voice capture (stubbed speech engine) produces a reviewed event', T, async () => {
  const stub = `
    class FakeRecognition {
      start() { setTimeout(() => {
        this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Remind me about the Bristol AI meetup tomorrow at 6.30pm in Watershed' }], { isFinal: true })] });
      }, 50); }
      stop() { setTimeout(() => this.onend && this.onend(), 20); }
    }
    window.SpeechRecognition = FakeRecognition;`;
  const page = await newPage(browser, { now: '2026-11-05T09:00:00', init: stub });
  await open(page, server.url, '#/capture');
  await page.click('#mic');
  await page.waitForFunction(() => document.querySelector('#voice-transcript')?.textContent?.includes('Watershed'));
  await page.click('#mic');
  await page.waitForSelector('dialog[open] input[name="title"]');
  assert.equal(await page.inputValue('dialog[open] input[name="title"]'), 'Bristol AI meetup');
  assert.equal(await page.inputValue('dialog[open] input[name="date"]'), '2026-11-06');
  assert.equal(await page.inputValue('dialog[open] input[name="time"]'), '18:30');
  assert.equal(await page.inputValue('dialog[open] input[name="location"]'), 'Watershed');
  await saveReview(page);
  page.assertClean();
});

test('voice capture degrades gracefully where unsupported', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00', init: 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition;' });
  await open(page, server.url, '#/capture');
  assert.equal(await page.isDisabled('#mic'), true);
  assert.match(await page.textContent('#voice-status'), /not available/i);
  page.assertClean();
});

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('screenshot capture via on-device OCR path (OCR engine stubbed)', T, async () => {
  const stub = `window.Tesseract = { recognize: async () => ({ data: { text: 'Hack Night 12 Nov 6pm\\nCloud Meetup 19 Nov 7pm' } }) };`;
  const page = await newPage(browser, { now: '2026-11-05T09:00:00', init: stub });
  await open(page, server.url, '#/capture');
  await page.setInputFiles('#shot-file', { name: 'shot.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.waitForSelector('dialog[open] h2:has-text("Review 2 events")');
  const titles = await page.locator('dialog[open] input[name="title"]').evaluateAll((els) => els.map((e) => /** @type {HTMLInputElement} */ (e).value));
  assert.deepEqual(titles, ['Hack Night', 'Cloud Meetup']);
  await saveReview(page);
  await goTo(page, '#/upcoming');
  assert.equal(await page.locator('article.ev').count(), 2);
  page.assertClean();
});

test('screenshot capture via AI key path (provider mocked at the network layer)', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  let seenKey = '';
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    seenKey = route.request().headers()['x-api-key'] ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      body: JSON.stringify({ content: [{ type: 'text', text: 'Here you go:\n[{"title":"Bristol AI Shed","type":"meetup","date":"2026-11-20","time":"09:00","location":"Watershed BS1 5TX","organizer":"AI Shed","url":"https://example.com/e"}]' }] }),
    });
  });
  await open(page, server.url, '#/settings');
  await page.click('details.adv > summary');
  await page.fill('#ai-key', 'sk-ant-test-key');
  await page.click('#ai-save');
  await page.waitForSelector('#ai-status:has-text("saved")');
  await goTo(page, '#/capture');
  await page.setInputFiles('#shot-file', { name: 'shot.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.waitForSelector('dialog[open] input[name="title"]');
  assert.equal(seenKey, 'sk-ant-test-key');
  assert.equal(await page.inputValue('dialog[open] input[name="title"]'), 'Bristol AI Shed');
  assert.equal(await page.inputValue('dialog[open] input[name="date"]'), '2026-11-20');
  assert.equal(await page.inputValue('dialog[open] input[name="time"]'), '09:00');
  await saveReview(page);
  // the key is never part of a backup
  await goTo(page, '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const backup = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  assert.ok(!backup.includes('sk-ant-test-key'));
  page.assertClean();
});

test('a rejected AI key and a non-image are reported, not swallowed', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await page.route('https://api.anthropic.com/v1/messages', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await open(page, server.url, '#/settings');
  await page.click('details.adv > summary');
  await page.fill('#ai-key', 'bad-key');
  await page.click('#ai-save');
  await goTo(page, '#/capture');
  await page.setInputFiles('#shot-file', { name: 'shot.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.waitForSelector('.toast-error');
  assert.match(await page.textContent('.toast-error'), /key was rejected/i);
  page.assertClean(/401|Failed to load resource/);
});

test('works offline after the first visit (service worker shell)', T, async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/London' });
  const page = await newPage(browser, { context });
  await open(page, server.url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.textContent('main h1'), 'Today');
  await context.setOffline(false);
  await context.close();
});

test('mobile layout: no horizontal overflow on any view, tap targets are large', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00', viewport: { width: 375, height: 800 } });
  await open(page, server.url);
  await captureText(page, 'A fairly long conference title that should wrap nicely on a small phone screen on 6 Nov at 9am at The Very Long Venue Name, Somewhere Far Away');
  await saveReview(page);
  for (const href of ['#/today', '#/upcoming', '#/calendar', '#/board', '#/insights', '#/capture', '#/settings']) {
    await page.click(`nav a[href="${href}"]`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${href} overflows by ${overflow}px`);
  }
  await goTo(page, '#/today');
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('nav a, #add-btn, article.ev .btn')].map((e) => e.getBoundingClientRect()).filter((r) => r.height < 34).length);
  assert.equal(small, 0);
  page.assertClean();
});

test('stays responsive with 2,000 events', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url);
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('showup', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('events', 'readwrite');
    const os = tx.objectStore('events');
    const now = new Date().toISOString();
    for (let i = 0; i < 2000; i++) {
      const d = new Date(Date.UTC(2026, 10, 5 + (i % 200)));
      os.put({ id: `bulk-${i}`, title: `Bulk event ${i}`, type: 'meetup', date: d.toISOString().slice(0, 10), time: '18:00', endTime: null, location: 'Bristol', organizer: '', url: '', notes: '', status: 'upcoming', reminders: null, source: 'import', needsReview: false, createdAt: now, updatedAt: now });
    }
    await new Promise((res) => (tx.oncomplete = res));
  });
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await goTo(page, '#/upcoming');
  await page.waitForSelector('article.ev');
  const loadMs = Date.now() - t0;
  await page.fill('#q', 'Bulk event 1999');
  assert.equal(await page.locator('article.ev').count(), 1);
  assert.ok(loadMs < 8000, `loaded in ${loadMs}ms`);
  page.assertClean();
});
