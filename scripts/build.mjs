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
writeFileSync(join(dist, '.nojekyll'), '');

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
