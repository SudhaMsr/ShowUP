import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { expectText, launch, newPage, open, startServer } from './helpers.js';

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

/** Fill the editor for a new opportunity and save. */
async function addOpportunity(page, { type, title, date, org, details = {}, extra }) {
  await page.click('#add-btn');
  await page.waitForSelector('dialog[open] input[name="title"]');
  await page.fill('dialog[open] input[name="title"]', title);
  await page.selectOption('dialog[open] select[name="type"]', type);
  await page.fill('dialog[open] input[name="date"]', date);
  if (org) await page.fill('dialog[open] input[name="organizer"]', org);
  for (const [label, value] of Object.entries(details)) {
    const field = page.locator('dialog[open] .details-grid .field', { has: page.locator(`label:text-is("${label}")`) });
    if (await field.locator('select').count()) await field.locator('select').selectOption(value);
    else await field.locator('input').fill(value);
  }
  if (extra) await extra(page);
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
}

test('internship: typed fields, starter checklist, stages, notes and links persist and show on the card', T, async () => {
  const page = await newPage(browser, { now: '2026-11-02T09:00:00' });
  await open(page, server.url, '#/upcoming');
  await page.click('#add-btn');
  await page.waitForSelector('dialog[open] input[name="title"]');

  // The form adapts to the type.
  assert.equal(await page.locator('dialog[open] select[name="stage"]').isVisible(), false, 'plain meetup has no stage');
  await page.selectOption('dialog[open] select[name="type"]', 'internship');
  assert.equal(await page.locator('dialog[open] select[name="stage"]').isVisible(), true);
  assert.match(await page.textContent('dialog[open] label[for$="-date"]'), /Deadline/);
  assert.match(await page.textContent('dialog[open] label[for$="-organizer"]'), /Company/);
  assert.equal(await page.inputValue('dialog[open] select[name="stage"]'), 'found');
  await page.fill('dialog[open] input[name="title"]', 'Google STEP intern');
  await page.fill('dialog[open] input[name="date"]', '2026-11-20');
  await page.fill('dialog[open] input[name="organizer"]', 'Google');
  await page.fill('dialog[open] .details-grid .field:has(label:text-is("Pay")) input', '£2,500 / month');
  await page.selectOption('dialog[open] .details-grid .field:has(label:text-is("Where")) select', 'Remote');
  await page.fill('dialog[open] textarea[name="notes"]', 'Ask Priya for a referral.');
  await page.click('dialog[open] button:text-is("Use starter checklist")');
  assert.equal(await page.locator('dialog[open] .row-task').count(), 5);
  await page.click('dialog[open] button:text-is("Add link")');
  await page.fill('dialog[open] input[aria-label="Link label"]', 'Careers page');
  await page.fill('dialog[open] input[aria-label="Link address"]', 'https://careers.example.com/step');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });

  const card = page.locator('article.ev[data-type="internship"]');
  await card.waitFor();
  assert.match(await card.textContent(), /Google STEP intern/);
  assert.match(await card.textContent(), /Found/, 'stage chip');
  assert.match(await card.textContent(), /Pay: £2,500 \/ month · Where: Remote/);
  assert.match(await card.textContent(), /Ask Priya/);
  assert.match(await card.textContent(), /Checklist 0\/5/);
  assert.equal(await card.locator('.ev-links a').getAttribute('href'), 'https://careers.example.com/step');

  // Tick a task straight from the card.
  await card.locator('summary', { hasText: 'Checklist' }).click();
  await card.locator('.ev-tasks input[type="checkbox"]').first().check();
  await expectText(page, 'article.ev[data-type="internship"] summary', /Checklist 1\/5/);

  // Advance the stage with the primary button, then jump with the select.
  await page.click('article.ev[data-type="internship"] button:text-is("Move to Preparing")');
  await expectText(page, 'article.ev[data-type="internship"] .chip-stage', /Preparing/);
  await page.selectOption('article.ev[data-type="internship"] select.stage-select', 'submitted');
  // Applied items are done as far as the deadline goes: they leave Upcoming and show in History.
  await page.waitForSelector('article.ev[data-type="internship"]', { state: 'detached' });
  await page.click('.seg:text-is("History")');
  await expectText(page, 'article.ev[data-type="internship"] .chip-stage', /Applied/);

  // Everything survives a reload (stored encrypted).
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await page.click('.seg:text-is("History")');
  const again = page.locator('article.ev[data-type="internship"]');
  await expectText(page, 'article.ev[data-type="internship"] .ev-details', /Pay: £2,500/);
  assert.match(await again.textContent(), /Checklist 1\/5/);
  page.assertClean(IGNORE);
});

test('board by stage: drag between stages; insights shows the funnel and follow-through', T, async () => {
  const page = await newPage(browser, { now: '2026-11-02T09:00:00' });
  await open(page, server.url, '#/upcoming');
  await addOpportunity(page, { type: 'internship', title: 'Meta intern', date: '2026-11-25', org: 'Meta' });
  await addOpportunity(page, { type: 'scholarship', title: 'Rhodes', date: '2026-11-28', org: 'Rhodes Trust' });
  await addOpportunity(page, { type: 'internship', title: 'Stripe intern', date: '2026-12-05' });

  await page.click('nav a[href="#/board"]');
  await page.waitForSelector('.board');
  await page.click('.seg:text-is("By stage")');
  await page.waitForSelector('.board-stages');
  assert.equal(await page.textContent('.bd-stage-found .count'), '3');
  await page.dragAndDrop('.bd-stage-found .bd-card >> nth=0', '.bd-stage-submitted .bd-body');
  await expectText(page, '.bd-stage-submitted .count', /^1$/);
  await page.selectOption('.bd-stage-found .bd-card >> nth=0 >> select.bd-move', 'closed');
  await expectText(page, '.bd-stage-closed .count', /^1$/);
  await page.selectOption('.bd-stage-submitted .bd-card >> select.bd-move', 'won');
  await expectText(page, '.bd-stage-won .count', /^1$/);

  // The outcome board agrees: won and applied count as attended, dropped as cancelled, one still open.
  await page.click('.seg:text-is("By outcome")');
  await expectText(page, '.bd-attended .count', /^1$/);
  await expectText(page, '.bd-cancelled .count', /^1$/);
  await expectText(page, '.bd-upcoming .count', /^1$/);

  await page.click('nav a[href="#/insights"]');
  await page.waitForSelector('#opp-panel');
  // Numbers count up on animation frames, which the fake clock only advances when told to.
  await page.clock.runFor(2000);
  await expectText(page, '#opp-panel', /3\s*Tracked/, 8000);
  const text = await page.textContent('#opp-panel');
  assert.match(text, /1\s*Submitted/);
  assert.match(text, /Follow-through 100%/);
  assert.match(text, /Win rate 100%/, 'the one decision so far is a win');
  page.assertClean(IGNORE);
});

test('deadline reminder fires for an unfinished application, and not after it is submitted', T, async () => {
  const page = await newPage(browser, {
    now: '2026-11-14T08:00:00',
    // Toasts disappear after a few fake seconds; record every one that ever appeared.
    init: `window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.textContent) window.__toasts.push(n.textContent); }).observe(document, { childList: true, subtree: true });`,
  });
  await open(page, server.url, '#/upcoming');
  await addOpportunity(page, { type: 'scholarship', title: 'Chevening', date: '2026-11-17' });
  await page.click('#add-btn');
  await page.waitForSelector('dialog[open] input[name="title"]');
  await page.fill('dialog[open] input[name="title"]', 'Hack the North');
  await page.selectOption('dialog[open] select[name="type"]', 'hackathon');
  await page.fill('dialog[open] input[name="date"]', '2026-12-05');
  await page.fill('dialog[open] input[name="deadline"]', '2026-11-16');
  await page.selectOption('dialog[open] select[name="stage"]', 'working');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
  const seen = () => page.evaluate(() => window.__toasts.filter((t) => /Deadline/.test(t)));
  const hourly = async (hours) => {
    for (let i = 0; i < hours; i++) {
      await page.clock.runFor(3600_000);
      await page.waitForTimeout(60);
    }
  };

  // 14 Nov 08:00 -> 10:00: the 3-day nudge for Chevening (due 17 Nov) arrives at 09:00.
  await hourly(2);
  let t = await seen();
  assert.ok(t.some((x) => /Chevening: Deadline in 3 days/.test(x)), t.join(' | '));

  // Submit it. Its 1-day nudge (16 Nov) must now stay quiet; the hackathon's still arrive.
  await page.selectOption('article.ev[data-type="scholarship"] select.stage-select', 'submitted');
  await hourly(50); // to 16 Nov 12:00
  t = await seen();
  assert.ok(!t.some((x) => /Chevening: Deadline in 1 day/.test(x)), t.join(' | '));
  assert.ok(t.some((x) => /Hack the North: Deadline in 1 day/.test(x)), t.join(' | '));
  assert.ok(t.some((x) => /Hack the North: Deadline today/.test(x)), t.join(' | '));
  page.assertClean(IGNORE);
});

test('relay panel: connects to a relay, syncs reminders, sends a test, disconnects', T, async () => {
  const origin = 'https://relay.test';
  /** @type {Array<{ method: string, url: string, body: any, auth?: string }>} */
  const seen = [];
  const page = await newPage(browser);
  const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS' };
  // A stand-in relay. (Chrome blocks page-to-loopback fetches between local ports, so a real local server
  // cannot be used here; the relay itself is covered by test/unit/relay.test.js.)
  await page.route(`${origin}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push({ method: req.method(), url: new URL(req.url()).pathname, body: req.postData() ? JSON.parse(req.postData()) : null, auth: req.headers().authorization });
    const body = req.url().endsWith('/test') ? { ok: true, results: { ntfy: { ok: true, detail: 'ntfy 200' } } } : { ok: true };
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  });
  // The shipped page only allows fetches to relays named at build time (SHOWUP_RELAY_ORIGINS); add this one.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: (await res.text()).replace("connect-src 'self'", `connect-src 'self' ${origin}`) });
  });
  await open(page, server.url, '#/upcoming');
  await addOpportunity(page, { type: 'meetup', title: 'Hack Night', date: soon });
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.waitForSelector('#relay-panel');
  await page.click('#relay-panel summary');
  await page.fill('#r-url', 'http://relay.example.org');
  await page.fill('#r-ntfy', 'showup-test-topic');
  await page.click('#r-connect');
  await expectText(page, '#r-errors', /https/);
  await page.fill('#r-url', origin);
  await page.check('#r-hide');
  await page.click('#r-connect');
  await expectText(page, '#r-status', /Connected\. \d+ upcoming reminder/, 8000);
  const put = seen.find((s) => s.method === 'PUT');
  assert.ok(put, 'PUT sent');
  assert.deepEqual(put.body.channels, { ntfy: { topic: 'showup-test-topic' } });
  assert.ok(put.body.reminders.length >= 1 && put.body.reminders.every((r) => r.title === 'ShowUp reminder'), 'titles hidden');
  assert.ok(put.auth.startsWith('Bearer ') && put.auth.length > 40);
  await page.click('#r-test');
  await expectText(page, '#toasts', /Test sent/);
  await page.click('#r-off');
  await page.waitForFunction(() => document.querySelector('#r-test')?.hidden === true);
  assert.ok(seen.some((s) => s.method === 'DELETE'));
});
