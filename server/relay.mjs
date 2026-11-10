#!/usr/bin/env node
// ShowUp reminder relay. Zero dependencies, Node 20+.
//   PORT=8787 RELAY_DATA=./data node server/relay.mjs
// See server/README.md for deployment and the full list of environment variables.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from './lib/db.js';
import { createApp } from './lib/app.js';
import { generateVapid } from './lib/webpush.js';

const dataDir = process.env.RELAY_DATA || './data';
mkdirSync(dataDir, { recursive: true });

const vapidFile = join(dataDir, 'vapid.json');
let vapid;
if (existsSync(vapidFile)) vapid = JSON.parse(readFileSync(vapidFile, 'utf8'));
else {
  vapid = generateVapid();
  writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 });
}

const app = createApp({
  db: createDb(join(dataDir, 'relay.json')),
  env: process.env,
  vapid,
  log: (m) => console.log(new Date().toISOString(), m),
});

const server = createServer(app.handler);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
const port = Number(process.env.PORT) || 8787;
server.listen(port, () => console.log(`ShowUp relay listening on :${port}`));

const timer = setInterval(() => app.tick().catch((e) => console.error('tick failed:', e.message)), 30_000);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
