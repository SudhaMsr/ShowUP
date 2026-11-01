import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, TEST_PASSWORD, advance, advanceUntil, captureText, expectText, launch, newPage, open, saveReview, startServer } from './helpers.js';

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
const IGNORE = /Failed to load resource/;

/** Create the account on a fresh page without "keep me signed in". */
async function signUp(page, { keep = false } = {}) {
  await page.goto(server.url);
  await page.waitForSelector('#auth-form');
  await page.fill('#auth-name', 'Sudha Madala');
  await page.fill('#auth-password', TEST_PASSWORD);
  await page.fill('#auth-confirm', TEST_PASSWORD);
  if (keep) await page.check('#auth-keep');
  await page.click('#auth-submit');
  await page.waitForSelector('html[data-ready="true"]');
}

test('login: create account, data is encrypted at rest, lock, wrong password, unlock', T, async () => {
  const page = await newPage(browser);
  await page.goto(server.url);
  await page.waitForSelector('#auth-form');
  assert.match(await page.textContent('h1'), /Create your space/);

  // validation
  await page.fill('#auth-name', 'Sudha');
  await page.fill('#auth-password', 'short');
  await page.fill('#auth-confirm', 'short');
  await page.click('#auth-submit');
  await expectText(page, '#auth-password-err', /at least 8/);
  await page.fill('#auth-password', TEST_PASSWORD);
  await page.fill('#auth-confirm', 'something-else-1');
  await page.click('#auth-submit');
  await expectText(page, '#auth-confirm-err', /do not match/);
  await page.fill('#auth-confirm', TEST_PASSWORD);
  await page.click('#auth-submit');
  await page.waitForSelector('html[data-ready="true"]');
  assert.match(await page.textContent('#who'), /Sudha/);

  await captureText(page, 'Secret Launch Party on 12 Nov at 7pm at The Vault');
  await saveReview(page);
  await page.waitForTimeout(300);

  // What is physically stored must not contain the title.
  const raw = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('showup');
        req.onsuccess = () => {
          const all = req.result.transaction('events').objectStore('events').getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  assert.ok(raw.includes('"enc":1'), 'records are sealed');
  assert.ok(!raw.includes('Secret Launch'), 'title is not stored in the clear');
  assert.ok(!raw.includes('The Vault'), 'location is not stored in the clear');

  // Reload: not remembered, so the password is required.
  await page.reload();
  await page.waitForSelector('#auth-form');
  assert.match(await page.textContent('h1'), /Welcome back, Sudha/);
  await page.fill('#auth-password', 'definitely-wrong');
  await page.click('#auth-submit');
  await expectText(page, '#auth-password-err', /not right/);
  assert.equal(await page.locator('html[data-ready="true"]').count(), 0);
  await page.fill('#auth-password', TEST_PASSWORD);
  await page.click('#auth-submit');
  await page.waitForSelector('html[data-ready="true"]');
  await page.click('nav a[href="#/upcoming"]');
  await page.waitForSelector('text=Secret Launch Party');

  // Lock button returns to the sign-in screen
  await page.click('#lock-btn');
  await page.waitForSelector('#auth-form');
  page.assertClean(IGNORE);
});

test('login: lockout after repeated wrong passwords; forgot password erases and restarts', T, async () => {
  const page = await newPage(browser);
  await signUp(page);
  await page.reload();
  await page.waitForSelector('#auth-form');
  for (let i = 0; i < 5; i++) {
    await page.fill('#auth-password', `wrong-password-${i}`);
    await page.click('#auth-submit');
    await page.waitForFunction(() => !document.querySelector('#auth-submit')?.hasAttribute('disabled') || /Too many/.test(document.querySelector('#auth-error')?.textContent ?? ''));
  }
  await expectText(page, '#auth-error', /Too many attempts\. Try again in/);
  assert.equal(await page.isDisabled('#auth-submit'), true);

  await page.click('#auth-forgot');
  await page.waitForSelector('#forgot-form');
  await page.fill('#forgot-confirm', 'nope');
  await page.click('#forgot-submit');
  await expectText(page, '#forgot-confirm-err', /ERASE/);
  await page.fill('#forgot-confirm', 'erase');
  await page.click('#forgot-submit');
  await page.waitForSelector('#auth-name');
  assert.match(await page.textContent('h1'), /Create your space/);
  page.assertClean(IGNORE);
});

test('login: "keep me signed in" resumes after reload; change password and account settings', T, async () => {
  const page = await newPage(browser);
  await signUp(page, { keep: true });
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.locator('#auth-form').count(), 0, 'no sign-in needed');

  await page.evaluate(() => (location.hash = '#/settings'));
  await page.waitForSelector('#acc-old');
  await page.fill('#acc-old', 'wrong-current-pw');
  await page.fill('#acc-new', 'a-brand-new-pass-7');
  await page.click('#acc-pw-save');
  await expectText(page, '#acc-pw-err', /not your current password/);
  await page.fill('#acc-old', TEST_PASSWORD);
  await page.click('#acc-pw-save');
  await page.waitForSelector('.toast:has-text("Password changed")');

  await page.click('#acc-lock');
  await page.waitForSelector('#auth-form');
  await page.fill('#auth-password', TEST_PASSWORD);
  await page.click('#auth-submit');
  await expectText(page, '#auth-password-err', /not right/);
  await page.fill('#auth-password', 'a-brand-new-pass-7');
  await page.click('#auth-submit');
  await page.waitForSelector('html[data-ready="true"]');
  page.assertClean(IGNORE);
});

test('reminders: custom time, default 1 hour and 1 minute, then asks how it went and updates the event', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T16:00:00' });
  await open(page, server.url, '#/settings');
  await page.waitForSelector('#account-panel');
  const pressed = await page.$$eval('.chips .chip-toggle[aria-pressed="true"]', (b) => b.map((x) => x.textContent));
  assert.deepEqual(pressed.sort(), ['1 hr', '1 min']);
  // add a custom 90-minute reminder
  await page.fill('.off-amount', '90');
  await page.selectOption('.off-unit', 'minutes');
  await page.click('[data-role="add-custom"]');
  await page.waitForSelector('.chip-toggle:has-text("1 hr 30 min")');

  await captureText(page, 'Hack night on 5 Nov at 6pm at Watershed');
  await saveReview(page);
  const toast = (re) => `.toast:has-text("${re}")`;
  assert.equal(await advanceUntil(page, toast('1 hour 30 minutes before'), 100 * 60_000), true, '90 minute reminder');
  assert.equal(await advanceUntil(page, toast('1 hour before'), 40 * 60_000), true, '1 hour reminder');
  assert.equal(await advanceUntil(page, toast('1 minute before'), 70 * 60_000), true, '1 minute reminder');

  // The event has no end time: the follow-up comes 90 minutes after the start.
  assert.equal(await advanceUntil(page, '#outcome-dialog', 3 * 60 * 60_000), true, 'asks how it went');
  assert.match(await page.textContent('#outcome-dialog'), /Hack night/);
  assert.equal(await page.locator('.outcome-btn').count(), 3);
  await page.click('.outcome-btn[data-outcome="missed"]');
  await page.waitForSelector('#outcome-dialog', { state: 'detached' });
  await page.click('nav a[href="#/insights"]');
  await page.waitForSelector('.pill.p-missed');
  assert.match(await page.textContent('.pill.p-missed'), /1 missed/);
  page.assertClean(IGNORE);
});

test('upload several files at once: workbook + csv + calendar are previewed per file and imported together', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await open(page, server.url, '#/capture');
  const csv = 'Date,Time,Title,Type\n2026-12-10,10:00,CSV Workshop,workshop\n';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:1', 'DTSTART:20261112T180000', 'SUMMARY:ICS Meetup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  await page.setInputFiles('#import-file', [
    { name: 'messy-events.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(FIXTURE) },
    { name: 'extra.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
    { name: 'cal.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) },
  ]);
  await page.waitForSelector('dialog[open] .file-results');
  const summary = await page.textContent('dialog[open] .file-results');
  for (const name of ['messy-events.xlsx', 'extra.csv', 'cal.ics']) assert.match(summary, new RegExp(name.replace('.', '\\.')));
  await page.click('dialog[open] button[value="ok"]');
  await page.waitForSelector('.toast:has-text("from 3 files")');
  page.assertClean(IGNORE);
});

const iso = (d) => `2026-11-${String(d).padStart(2, '0')}`;
const STATS_CSV = [
  'Date,Time,Title,Type,Status',
  `${iso(2)},10:00,Won 1,hackathon,attended`,
  `${iso(3)},10:00,Won 2,meetup,attended`,
  `${iso(4)},10:00,Won 3,meetup,attended`,
  `${iso(4)},12:00,Lost 1,meetup,missed`,
  `${iso(4)},14:00,Called off,webinar,cancelled`,
  `${iso(20)},10:00,Later one,conference,upcoming`,
].join('\n');

async function importStats(page) {
  await open(page, server.url, '#/capture');
  await page.setInputFiles('#import-file', { name: 'stats.csv', mimeType: 'text/csv', buffer: Buffer.from(STATS_CSV) });
  await page.waitForSelector('dialog[open] button[value="ok"]');
  await page.click('dialog[open] button[value="ok"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
}

test('insights: weekly success rate is correct and the chart is interactive', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await importStats(page);
  await page.click('nav a[href="#/insights"]');
  await page.waitForSelector('.ring');
  // 3 attended, 1 missed -> 75%; the cancelled event does not count against you
  assert.equal(await page.getAttribute('.ring', 'aria-label'), 'Success rate 75 percent');
  await page.waitForSelector('.wk.on.now');
  assert.match(await page.textContent('.pill.p-rate'), /75% success/);
  assert.match(await page.textContent('.pill.p-attended'), /3 attended/);
  assert.match(await page.textContent('.pill.p-cancelled'), /1 cancelled/);
  assert.equal(await page.locator('.wk').count(), 8);
  await page.click('.seg-switch button:has-text("12 weeks")');
  assert.equal(await page.locator('.wk').count(), 12);
  await page.click('.wk:nth-child(11)');
  await expectText(page, '#wk-detail', /No events this week/);
  assert.equal(await page.getAttribute('.wk:nth-child(11)', 'aria-pressed'), 'true');
  page.assertClean(IGNORE);
});

test('board: move a card between columns; calendar: month navigation and day details', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await importStats(page);
  await page.click('nav a[href="#/board"]');
  await page.waitForSelector('.board');
  const count = (status) => page.textContent(`.bd-${status} .count`);
  assert.equal(await count('upcoming'), '1');
  assert.equal(await count('attended'), '3');
  await page.selectOption('.bd-upcoming .bd-move', 'attended');
  await expectText(page, '.bd-attended .count', /^4$/);
  assert.equal(await count('upcoming'), '0');

  // drag and drop between columns
  await page.dragAndDrop('.bd-attended .bd-card >> nth=0', '.bd-missed .bd-body');
  await expectText(page, '.bd-missed .count', /^2$/);

  await page.click('nav a[href="#/calendar"]');
  await page.waitForSelector('.cal');
  assert.match(await page.textContent('.cal-title'), /November 2026/);
  await page.click('.cal-cell[data-date="2026-11-04"]');
  await page.waitForSelector('#cal-day .ev');
  assert.equal(await page.locator('#cal-day .ev').count(), 3);
  await page.click('#cal-next');
  await expectText(page, '.cal-title', /December 2026/);
  await page.click('#cal-today');
  await expectText(page, '.cal-title', /November 2026/);
  page.assertClean(IGNORE);
});

test('command palette (Ctrl+K) jumps to a view and finds events; theme toggle persists', T, async () => {
  const page = await newPage(browser, { now: '2026-11-05T09:00:00' });
  await importStats(page);
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#palette-input');
  await page.fill('#palette-input', 'insights');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ring');
  await page.keyboard.press('Control+k');
  await page.fill('#palette-input', 'later one');
  await page.waitForSelector('.pal-item:has-text("Later one")');
  await page.keyboard.press('Escape');
  await page.click('#theme-btn');
  const t = await page.getAttribute('html', 'data-theme');
  assert.ok(t === 'dark' || t === 'light');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.getAttribute('html', 'data-theme'), t);
  page.assertClean(IGNORE);
});
