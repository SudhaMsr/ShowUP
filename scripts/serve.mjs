// Minimal static server for local runs and tests.
// Usage: node scripts/serve.mjs <dir> <port> [prefix]
// With a prefix such as /ShowUP/ it mimics a GitHub Pages project site.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);
let prefix = process.argv[4] ?? '/';
if (!prefix.endsWith('/')) prefix += '/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (!path.startsWith(prefix)) {
      if (path === prefix.slice(0, -1)) {
        res.writeHead(301, { location: prefix }).end();
        return;
      }
      res.writeHead(404).end('Not found');
      return;
    }
    path = path.slice(prefix.length - 1);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(dir, path));
    if (file !== dir && !file.startsWith(dir + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${dir} at http://127.0.0.1:${port}${prefix}`));
