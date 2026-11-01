// @ts-nocheck
/* ShowUp service worker: offline app shell + notification actions.
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

/* ---- Outcome taps ("Attended" / "Missed" buttons on a notification) ----
 * The encrypted event database is not readable from here, so the worker leaves
 * a note (event id + outcome only) in a tiny separate database. The page applies
 * it on its next start, or immediately if a window is already open. */
const OUTCOMES = ['attended', 'missed', 'cancelled'];

function leaveNote(id, status) {
  return new Promise((resolve) => {
    const req = indexedDB.open('showup-pending', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('outcomes')) req.result.createObjectStore('outcomes', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const tx = req.result.transaction('outcomes', 'readwrite');
      tx.objectStore('outcomes').put({ id, status, at: Date.now() });
      tx.oncomplete = () => {
        req.result.close();
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    };
    req.onerror = () => resolve(false);
  });
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  const eventId = n.data && typeof n.data.eventId === 'string' ? n.data.eventId : null;
  const isFollowUp = Boolean(n.data && n.data.followUp);
  const action = OUTCOMES.includes(event.action) ? event.action : null;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // A button was tapped: record the outcome without dragging the user into the app.
      if (eventId && isFollowUp && action) {
        await leaveNote(eventId, action);
        for (const w of windows) w.postMessage({ type: 'pending-outcomes' });
        return;
      }
      // Body tapped on a follow-up: bring the app forward and ask there.
      if (eventId && isFollowUp) await leaveNote(eventId, null);
      const open = windows.find((c) => 'focus' in c);
      if (open) {
        await open.focus();
        open.postMessage({ type: 'pending-outcomes' });
      } else {
        await self.clients.openWindow('./');
      }
    })(),
  );
});
