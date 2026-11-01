// Shared browser-test plumbing: a static server mimicking GitHub Pages, a
// Playwright launcher, and a page factory that fails tests on console errors.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadPlaywright() {
  const attempts = [
    () => createRequire(join(root, 'package.json'))('playwright'),
    () => createRequire(join(execSync('npm root -g').toString().trim(), '/'))('playwright'),
  ];
  for (const a of attempts) {
    try {
      return a();
    } catch {
      /* try next */
    }
  }
  throw new Error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
}
export const { chromium } = loadPlaywright();

export const PREFIX = process.env.BASE_PREFIX ?? '/ShowUP/';
export const FIXTURE = join(root, 'test', 'fixtures', 'messy-events.xlsx');

/** Start the local server unless BASE_URL points at a deployed site. */
export async function startServer(port = 4300 + Math.floor(Math.random() * 500)) {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL.replace(/\/?$/, '/'), stop: async () => {} };
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing. Run `npm run build` first.');
  const child = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), dist, String(port), PREFIX], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
    setTimeout(() => reject(new Error('server did not start')), 8000);
  });
  return { url: `http://127.0.0.1:${port}${PREFIX}`, stop: async () => void child.kill() };
}

export async function launch() {
  const executablePath = process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  return chromium.launch({ executablePath, args: ['--no-sandbox'] });
}

/**
 * New isolated browser context + page. Console errors and uncaught exceptions
 * are collected; call `page.assertClean()` at the end of a test.
 * @param {import('playwright').Browser} browser
 * @param {{ now?: string, viewport?: { width: number, height: number }, context?: import('playwright').BrowserContext, init?: string }} [o]
 */
export async function newPage(browser, o = {}) {
  const context = o.context ?? (await browser.newContext({ viewport: o.viewport ?? { width: 1100, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/London', acceptDownloads: true }));
  const page = await context.newPage();
  /** @type {string[]} */
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  if (o.init) await page.addInitScript(o.init);
  if (o.now) await page.clock.install({ time: new Date(o.now) });
  return Object.assign(page, {
    assertClean(/** @type {RegExp} */ ignore) {
      const real = ignore ? problems.filter((p) => !ignore.test(p)) : problems;
      if (real.length) throw new Error(`Browser reported problems:\n${real.join('\n')}`);
    },
  });
}

/** @param {import('playwright').Page} page @param {string} url */
export async function open(page, url, hash = '') {
  await page.goto(url + hash);
  await page.waitForSelector('html[data-ready="true"]');
}

/** Capture-by-typing, then save from the review dialog. */
export async function captureText(page, text) {
  await page.click('nav a[href="#/capture"]');
  await page.fill('#capture-text', text);
  await page.click('#capture-go');
  await page.waitForSelector('dialog[open] input[name="title"]');
}

export async function saveReview(page) {
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForSelector('dialog[open]', { state: 'detached' });
}

/**
 * Advance the fake clock in 30s steps, yielding between steps so async work
 * (IndexedDB inside the reminder tick) can finish, as it would in real time.
 */
export async function advance(page, ms) {
  for (let left = ms; left > 0; left -= 30_000) {
    await page.clock.runFor(Math.min(30_000, left));
    await page.waitForTimeout(40);
  }
}

/**
 * Advance the fake clock in 30s steps until `selector` is visible.
 * Returns true if it appeared within `maxMs` of fake time.
 */
export async function advanceUntil(page, selector, maxMs) {
  for (let left = maxMs; left > 0; left -= 30_000) {
    await page.clock.runFor(Math.min(30_000, left));
    await page.waitForTimeout(40);
    if (await page.locator(selector).count()) return true;
  }
  return false;
}

/** Poll until an element's text matches (the UI repaints a tick after a dialog closes). */
export async function expectText(page, selector, re, timeout = 5000) {
  await page.waitForFunction(
    ([sel, src, flags]) => new RegExp(src, flags).test(document.querySelector(sel)?.textContent ?? ''),
    [selector, re.source, re.flags],
    { timeout },
  );
}

const ROUTE_TITLES = /** @type {Record<string,string>} */ ({ '#/today': 'Today', '#/upcoming': 'Upcoming', '#/capture': 'Capture', '#/settings': 'Settings' });

/**
 * Click a main-nav link and wait until that view has actually rendered
 * (its <h1> shows), so later assertions never read the previous view.
 * @param {import('playwright').Page} page
 * @param {string} hash e.g. "#/upcoming"
 */
export async function goTo(page, hash) {
  await page.click(`nav a[href="${hash}"]`);
  await expectText(page, 'main h1', new RegExp(`^${ROUTE_TITLES[hash]}$`));
}
