// Zero-dependency build: copies the app into dist/ and stamps the service worker
// with a content hash and precache list. There is no bundling or minification:
// what ships is exactly what is in src/.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const f of ['index.html', 'manifest.webmanifest']) cpSync(join(root, f), join(dist, f));
cpSync(join(root, 'src'), join(dist, 'src'), { recursive: true });
cpSync(join(root, 'styles'), join(dist, 'styles'), { recursive: true });
cpSync(join(root, 'public', 'icons'), join(dist, 'icons'), { recursive: true });
cpSync(join(root, 'public', 'media'), join(dist, 'media'), { recursive: true });
cpSync(join(root, 'public', 'vendor'), join(dist, 'vendor'), { recursive: true });
writeFileSync(join(dist, '.nojekyll'), '');

// Optional reminder relays the app may talk to. The page's Content-Security-Policy only allows
// fetches to origins named here, so a relay must be listed at build time:
//   SHOWUP_RELAY_ORIGINS="https://relay.example.org https://other.example.net" npm run build
const relayOrigins = (process.env.SHOWUP_RELAY_ORIGINS ?? '').split(/\s+/).filter(Boolean).map((o) => {
  const u = new URL(o);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.origin !== o.replace(/\/$/, '') || (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))) {
    throw new Error(`SHOWUP_RELAY_ORIGINS: "${o}" must be a bare https origin such as https://relay.example.org`);
  }
  return u.origin;
});
if (relayOrigins.length) {
  const indexPath = join(dist, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes("connect-src 'self'")) throw new Error('index.html has no connect-src to extend');
  writeFileSync(indexPath, html.replace("connect-src 'self'", `connect-src 'self' ${relayOrigins.join(' ')}`));
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const assets = walk(dist)
  .map((p) => relative(dist, p).split('\\').join('/'))
  .filter((p) => p !== '.nojekyll')
  .sort();

const hash = createHash('sha256');
for (const a of assets) hash.update(a).update(readFileSync(join(dist, a)));
const version = `showup-${hash.digest('hex').slice(0, 12)}`;

const precache = ['./', ...assets];
const template = readFileSync(join(root, 'sw.js'), 'utf8');
const stamped = template
  .replace("const VERSION = '__VERSION__';", `const VERSION = ${JSON.stringify(version)};`)
  .replace('const ASSETS = __ASSETS__;', `const ASSETS = ${JSON.stringify(precache)};`);
if (stamped.includes('__VERSION__') || stamped.includes('__ASSETS__')) throw new Error('Service worker placeholders were not stamped');
const sw = stamped;
writeFileSync(join(dist, 'sw.js'), sw);

console.log(`Built ${assets.length} files into dist/ (${version})`);
