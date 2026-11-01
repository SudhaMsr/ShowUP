# ShowUp

Never miss an event you registered for.

ShowUp keeps every hackathon, meetup, conference, interview and workshop in one place. Add an event by **voice**, by **screenshot** (a registration email, ticket or flyer), or by **typing one line**. Open the app and the first thing you see is what is on **today**, at what time, and where.

It runs entirely in your browser. There is no server. You sign in with a name and password that exist only on your device, and your events are encrypted with that password and work offline.

**Live app:** https://sudhamsr.github.io/ShowUP/

## What it does

| Need | How ShowUp handles it |
|---|---|
| "Show me today" | The Today view leads with the next event, a live countdown, the place (opens in maps) and what is coming tomorrow and this week. |
| Fast capture | Speak or type `AI meetup Thursday 6pm at Watershed`; paste or drop a screenshot. You always review a draft before it is saved, and uncertain fields are highlighted. |
| Bring your spreadsheet | Import an `.xlsx` or `.csv`. Messy cells such as `2.30 pm`, `10.3`, Excel time fractions and `NA` are understood or flagged, never silently guessed. Unusable rows are listed with the reason. |
| Reminders | Default nudges **1 hour** and **1 minute** before, plus any **custom** times you add (per event or globally, up to 30 days ahead). In-app alerts and system notifications while the app is open, a catch-up banner for anything that came due while it was closed, and a calendar file (`.ics`) with real alarms. |
| "Did you go?" | When an event ends, ShowUp asks: **I went / I missed it / It was cancelled** and updates the event for you. Notification buttons answer it too, where the browser supports actions. |
| Weekly insights | An interactive week-by-week chart (4, 8 or 12 weeks), an animated success-rate ring, streak, and a per-type breakdown. Success rate is attended ÷ (attended + missed); cancelled events never count against you. |
| Board, Calendar, Palette | A drag-and-drop **Board** (Upcoming / Attended / Missed / Cancelled), a month **Calendar** with day details, a **Ctrl/⌘ K command palette**, light/dark theme, and Duplicate on any event. |
| Upload everything | Choose several files at once: Excel (every sheet), CSV, calendar `.ics` and ShowUp backups. Each file gets its own result, duplicates across files collapse, and one bad file never blocks the rest. |
| Sign-in and privacy | A device account (name + password). Events and settings are encrypted at rest with AES-GCM; the key is wrapped by your password (PBKDF2-SHA256, 310k rounds). Lockout back-off, optional "keep me signed in" for 30 days, idle auto-lock. Optional AI screenshot reading uses your own API key. |

## Sign-in: what it is and is not

The login protects the data on **this device**. There is no server, so there is no "reset by email": if you forget the password, the only way back in is to erase the device and restore from a backup file or re-upload your spreadsheet. Export a backup now and then (**Settings → Backup**). It is not a cloud account, and it does not sync between devices.

## Reminders: what to expect

Browsers cannot reliably wake a closed web page without a push server, and this app has none by design. So:

* While ShowUp is open or installed and running, reminders fire as notifications and in-app alerts.
* If it was closed, a banner on next open lists the reminders you missed.
* For alerts when the app is closed, use **Settings → Download calendar file (.ics)**, or "Add to calendar" on any event. Your calendar app then does the alerting.

## Develop

Requires Node 20+ and Chrome. There are no runtime dependencies and no bundler.

```bash
npm run typecheck   # strict TypeScript checking of the JS via JSDoc
npm run test:unit   # domain logic, parsers, import, ICS, storage contract
npm run build       # copies the app to dist/ and stamps the service worker
npm run serve       # http://localhost:4173
npm run test:e2e    # real Chrome via Playwright (needs: npm i -g playwright)
```

Layout: `src/domain` (pure logic), `src/io` (xlsx/csv/ics/backup), `src/storage` (IndexedDB repository), `src/capture` (voice, image, OCR/vision), `src/app` (store, reminder engine), `src/ui` (views). Design notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), data model: [`docs/SCHEMA.md`](docs/SCHEMA.md).

## Deployment

Pushing to `main` runs type checks, unit tests and browser tests, then publishes `dist/` to GitHub Pages (`.github/workflows/deploy.yml`).

## Known limitations

* No cross-device sync yet. Use **Backup (.json)** to move data between devices.
* Voice input needs a Chromium-based browser or Safari. Typing works everywhere.
* On-device screenshot reading depends on image quality, which is why every result is reviewed before saving.

## Licence

MIT
