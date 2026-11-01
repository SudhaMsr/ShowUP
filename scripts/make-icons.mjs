// Renders public/icons/icon.svg to the PNG sizes the web app manifest needs.
// Dev-only (needs Playwright + Chrome); the PNGs are committed.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(execSync('npm root -g').toString().trim(), '/'));
const { chromium } = require('playwright');
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
async function render(size, name, { maskable = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Maskable icons need a full-bleed background and content inside the safe zone.
  const inner = maskable
    ? `<div style="width:100%;height:100%;background:#16181d;display:grid;place-items:center"><div style="width:72%;height:72%">${svg.replace(/<rect[^>]*\/>/, '')}</div></div>`
    : `<div style="width:100%;height:100%">${svg}</div>`;
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>${inner}`);
  writeFileSync(join(dir, name), await page.screenshot({ omitBackground: !maskable }));
  await page.close();
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', { maskable: true });
await browser.close();
console.log('Icons written to', dir);
