# ShowUp

Never miss an event you registered for.

ShowUp keeps every hackathon, meetup, conference, interview and workshop in one place. Add an event by **voice**, by **screenshot** (a registration email, ticket or flyer), or by **typing one line**. Open the app and the first thing you see is what is on **today**, at what time, and where.

It runs entirely in your browser. There is no account and no server. Your events are stored on your device and work offline.

**Live app:** https://sudhamsr.github.io/ShowUP/

## What it does

| Need | How ShowUp handles it |
|---|---|
| "Show me today" | The Today view leads with the next event, a live countdown, the place (opens in maps) and what is coming tomorrow and this week. |
| Fast capture | Speak or type `AI meetup Thursday 6pm at Watershed`; paste or drop a screenshot. You always review a draft before it is saved, and uncertain fields are highlighted. |
| Bring your spreadsheet | Import an `.xlsx` or `.csv`. Messy cells such as `2.30 pm`, `10.3`, Excel time fractions and `NA` are understood or flagged, never silently guessed. Unusable rows are listed with the reason. |
| Reminders | In-app reminders and system notifications while the app is open, a catch-up banner for anything that came due while it was closed, and a calendar file (`.ics`) with real alarms for your phone or desktop calendar. |
| Outcomes | Mark events attended, missed or cancelled so you keep a history of what you actually went to. |
| Privacy | Local-first. Optional AI screenshot reading uses your own API key, stored only on your device and sent only to the AI provider. |

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
