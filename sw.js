// @ts-nocheck
/* ShowUp service worker: offline app shell + notification clicks.
 * The two constants below are stamped by scripts/build.mjs. */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const STAMPED = !VERSION.startsWith('__');

self.addEventListener('install', (event) => {
  if (!STAMPED) return self.skipWaiting();
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!STAMPED || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache third-party (CDN, API)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
