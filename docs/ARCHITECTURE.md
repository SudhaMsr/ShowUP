# ShowUp — Architecture

ShowUp is a personal event tracker for people who register for many things
(hackathons, meetups, conferences, interviews, workshops) and forget them.
It is **capture-first**: say it, snap it, or paste it, review the draft, done.
Everything lands in one place with a "what's today, when, where" view.

## 1. Problem and research summary

| Category | Examples | What they do well | Gap for this user |
|---|---|---|---|
| Event platforms | Eventbrite, Meetup, Luma | Registration, tickets | Each app only knows its own events. Nothing aggregates across platforms. |
| Conference apps | Cvent, Convene, eventsPlace | Agenda for one event | Per-event, organiser-owned, useless across events. |
| General calendars | Google Calendar, Fantastical, Notion Calendar | Reminders, sync | Manual entry, no "events I registered for" concept, no status tracking. |
| AI calendars | Smart Calendars AI, Trace, Toki, Photo2Calendar, Calenshot, EasEvent | Voice/photo/text to calendar event | Mostly iOS/Android native, subscription or capped, write into the system calendar only (no registered/attended/missed lifecycle). |
| Spreadsheets | Excel, Notion DB | Total flexibility | Manual entry; you must open it to see today. |

**Where ShowUp stands out**

1. **Lifecycle, not just a calendar entry.** upcoming, attended, missed, cancelled, with notes. Your history becomes a record of what you went to.
2. **Review-before-save capture.** Voice, screenshot and text all produce an editable draft. Uncertain fields (ambiguous "2.30", missing month) are highlighted instead of silently guessed.
3. **Imports the spreadsheet you already have.** Reads `.xlsx` directly in the browser, including messy rows. No competitor does this.
4. **Local-first and private.** Data lives in your browser (IndexedDB), encrypted under a device password. No server, works offline. AI extraction is opt-in with your own API key.
5. **Reminders that survive a closed tab.** One-click `.ics` export carries real alarms for your native calendar.
6. **Zero-dependency runtime.** No framework or bundler; the shipped code is the code in `src/`.

## 2. Constraints that shaped the design

* **Hosting is GitHub Pages**: static files only, no server, no secrets.
* Therefore: no backend, **local-first PWA**. Payments and server load do not exist in this system; the sign-in is a device lock, not a cloud account. "Thousands of concurrent users" is satisfied structurally, since each user's data and compute live on their device and the host is a CDN.
* **Browsers cannot reliably fire notifications while fully closed without a push server.** The Notification Triggers API was abandoned. ShowUp is honest about this:
  * While open or installed and running, reminders fire via the service worker notification API, with an in-app banner fallback.
  * On open, missed reminders for events still ahead are surfaced as a catch-up banner.
  * For closed-app delivery, export `.ics` with `VALARM`s so the OS calendar does it.
  * A Web Push relay is a documented future extension (see ADR-004).

## 3. System context

```
 ┌────────────────────────── Browser (PWA) ───────────────────────────┐
 │  UI (vanilla ES modules, <dialog>, hash router)                     │
 │     │ actions                                                        │
 │  Store (state + subscribe)  ──►  Reminder loop (30s tick, SW notify) │
 │     │                                                                │
 │  Domain (pure, unit-tested)   Capture adapters        IO adapters    │
 │  time · dates · capture NLP   voice (Web Speech)      xlsx reader    │
 │  event · reminders · ics      screenshot (OCR/vision) csv · json     │
 │     │                                                                │
 │  Repository interface ─► IndexedDB (prod)  /  Memory (fallback/test) │
 │  Service worker: offline shell cache                                 │
 └──────────────────────────────────────────────────────────────────────┘
        optional, user-initiated, direct from browser:
        · Tesseract.js (CDN, on-device OCR)    · Anthropic API (user's own key)
```

### Layering rules (enforced by review and tests)

* `src/domain/*` is pure: no DOM, no storage, no network, clock injected. Runs under Node for fast tests.
* `src/io/*` converts bytes to domain objects (and back). No DOM.
* `src/storage/*` implements one `Repository` contract twice (IndexedDB, in-memory).
* `src/capture/*` wraps browser input APIs behind small feature-detected adapters.
* `src/ui/*` is the only layer that touches the DOM. It never builds HTML from strings; all user text goes through `textContent` (XSS-safe by construction).

## 4. Data model

See [SCHEMA.md](SCHEMA.md). Dates are **civil local date + optional civil time** (floating, no timezone). That matches how people think about "6pm at the venue" and avoids DST corruption for in-person events.

## 5. Key flows

**Capture (text/voice)** → `parseCapture(text, now)` → draft with `issues[]` → review dialog → `validate()` → `repo.put()` → store notifies → views re-render.

**Capture (screenshot)** → downscale in canvas → provider chain: (a) user's vision API key if set, (b) on-device Tesseract OCR → text → same `parseMany` path → review. Nothing is saved without confirmation.

**Import** → `readXlsx(bytes)` (zip + inflate via `DecompressionStream`, XML parsed with a small tokenizer) → `mapSheet(rows)` → `{events, skipped[]}` → dedupe against existing by `(title,date,time)` → preview counts → `putMany`.

**Reminders** → `reminderSchedule(event, offsets)` → each tick fires reminders with `at ∈ (lastTick, now]`, dedupes via persisted fired-keys, updates `lastTick`.

## 6. Security and privacy

* Strict CSP via `<meta>`: scripts only from self (plus the OCR CDN host), no inline script, no `eval`.
* No `innerHTML` with user data anywhere (checked by a unit test that greps `src/ui`).
* API key is stored only in the browser's IndexedDB, only sent to the provider's origin, never logged, never exported in backups.
* Imported files are parsed defensively: size caps, entry-count caps, decompression-size caps (zip-bomb guard), string length caps.
* All imported and captured fields are length-limited and type-checked by `validate()`; `url` must be `http(s):`.

### 6.1 Device account and encryption

* A random 256-bit data key (DEK) encrypts every record with AES-GCM; each record's slot (`events:<id>`, `meta:<key>`) is bound as additional authenticated data, so ciphertext cannot be swapped between records.
* The DEK is wrapped by a key derived from the password (PBKDF2-SHA256, 310,000 iterations, random salt). A wrong password fails authentication and nothing else is revealed. Changing the password re-wraps the same DEK, so no record is re-encrypted.
* The unwrapped DEK is a non-extractable `CryptoKey`. "Keep me signed in" stores that key object in IndexedDB for 30 days; the key bytes are never readable by script.
* Repeated wrong passwords trigger a back-off (5 free attempts, then 30 s doubling to 15 min). Idle auto-lock reloads the app, discarding in-memory state.
* Honest limits: this protects data at rest against someone reading browser storage. It cannot protect against malware or a hostile browser extension on an unlocked device, and a forgotten password is unrecoverable. Data saved before sign-in existed is encrypted automatically on first unlock (`migrate()`).
* The notification service worker only ever stores `{event id, outcome}` in a separate `showup-pending` database. Titles and places are never written outside the encrypted store.

### 6.2 Google connection and the Approvals inbox

* `src/app/google.js` uses Google Identity Services' browser **token client** with a user-supplied Client ID, scopes `calendar.readonly` and (optionally) `gmail.readonly`. Access tokens (about 1 h) are held only in memory; a silent renewal is attempted, otherwise the UI shows Reconnect.
* `src/domain/suggestions.js` (pure, unit-tested) maps Calendar items and emails to *proposals*. Cancelled and declined events are skipped. For email, a labelled "When/Date:" line beats the first date in the body, past dates are ignored, and anything uncertain keeps the "check details" flag.
* `src/app/inbox.js` holds proposals in the encrypted `meta` store (`suggestions`, `dismissed`). Approving calls `store.save`; dismissing is remembered so an item never returns. Items already in your events (by title, date and time) are never proposed.
* CSP is widened only to `accounts.google.com` (script, frame, connect) and `www.googleapis.com` (connect).
* Limit: no server means no background sync. Polling runs while the app is open (every 20 min and on return to the tab). Notifications for new proposals follow the same rule as reminders.

## 7. Performance and scale

* Rendering is O(n) per view over in-memory events; a 10k-event dataset is validated in tests. IndexedDB access is indexed by `date`.
* Service worker precaches the shell; the app is interactive offline.
* Host scale is a static CDN, so concurrent users add no server load.

## 8. Testing strategy

| Level | Tool | Covers |
|---|---|---|
| Unit | `node --test` (TZ pinned to Europe/London) | time/date parsing, NLP, reminders, ICS, CSV, XLSX, import mapping, validation, memory repo |
| Static | `tsc --checkJs --strict` | Type safety via JSDoc across `src/` |
| Integration | Playwright + real Chrome | IndexedDB repo, import via file chooser, persistence across reload |
| End-to-end | Playwright + real Chrome | capture → review → today, reminders with a controlled clock, status changes, ICS download, offline load |
| Post-deploy | same E2E suite against the live Pages URL | smoke + critical path |

Browser tests use Playwright driving real Chrome rather than Selenium. Both automate a real browser through the WebDriver/CDP protocols; Playwright was used because the Selenium client libraries could not be installed in the build environment (package registries were blocked) and the bundled ChromeDriver (v147) does not match the installed Chrome (v153). Playwright also provides a controllable browser clock, which the reminder tests rely on.

## 9. Architecture decision records

* **ADR-001 Local-first, no backend.** Matches Pages hosting, privacy and cost. Trade-off: no cross-device sync (mitigated by JSON/ICS export).
* **ADR-002 Vanilla ES modules, no framework or bundler.** Zero supply-chain surface, no build breakage, small payload. A build step exists only to stamp the service-worker cache version.
* **ADR-003 Floating civil time.** No TZ column in events, so DST can never shift an event.
* **ADR-004 Closed-app reminders via ICS alarms; push relay deferred.** A relay needs a server and VAPID keys. It can be added behind the same `reminderSchedule` function.
* **ADR-006 Device-bound encryption instead of a cloud login.** A server-backed login would need a backend, a user database and breach responsibility, and would send event data off the device. A password-wrapped data key gives real protection at rest with none of that. Trade-off: no recovery and no sync.
* **ADR-007 Motion without animation libraries.** Native Web Animations/CSS, View-free entrance transitions, a hand-written WebGL fragment shader for the sign-in backdrop, SVG for the success ring, canvas for confetti. All honour `prefers-reduced-motion`. GSAP, Framer Motion, Three.js and Spline were not used: Framer Motion is React-only, and the others would add a runtime dependency (and a CDN) to an app whose design goal is zero dependencies.
* **ADR-008 Bring-your-own Google Client ID, read-only, approval-first.** A shared client would need a verified OAuth app and a backend for refresh tokens. A personal client works entirely in the browser. Nothing from Google is added without an explicit approval, because email parsing is a guess.
* **ADR-005 AI is optional and BYO-key.** Free, private default (rules + on-device OCR); better accuracy if the user opts in.

## 10. Known limitations

* No multi-device sync yet (export/import JSON).
* Closed-app notifications need the ICS route or a future push relay.
* On-device OCR quality depends on the screenshot; the review step exists for that reason.
* Web Speech API is Chromium/Safari only; typing is the fallback elsewhere.
