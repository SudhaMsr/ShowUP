# Data schema

Storage: IndexedDB database `showup`, version 1.

## Object store `events` (keyPath `id`)

| Field | Type | Rules |
|---|---|---|
| `id` | string | UUID v4, immutable |
| `title` | string | required, 1–200 chars |
| `type` | string | one of `EVENT_TYPES` (`hackathon, meetup, conference, workshop, webinar, interview, meeting, networking, submission, personal, other`) |
| `date` | string | required, civil date `YYYY-MM-DD`, must be a real calendar date |
| `time` | string or null | `HH:MM` 24h, or null for all-day or unknown |
| `endTime` | string or null | `HH:MM`, must be after `time` when both set |
| `location` | string | 0–200 chars |
| `organizer` | string | 0–200 chars (company or event series) |
| `url` | string | empty, or `http(s)://` URL, max 2000 |
| `notes` | string | 0–2000 chars |
| `status` | string | `upcoming`, `attended`, `missed`, `cancelled` |
| `reminders` | number[] or null | minutes before start; null means use global defaults |
| `source` | string | `manual`, `voice`, `screenshot`, `import`, `text` |
| `needsReview` | boolean | true when capture or import left uncertain fields |
| `createdAt`, `updatedAt` | string | ISO-8601 UTC |

Indexes: `date` (range scans for agenda), `status`.

## Object store `meta` (keyPath `key`)

Key/value settings and runtime state: `settings`, `lastTickAt`, `firedReminders` (rolling, pruned at 30 days), `aiKey` (never exported).

## Encrypted records

When signed in, rows in `events` and `meta` are stored as `{ id | key, enc: 1, iv, ct }`: `iv` is a random 96-bit nonce and `ct` is AES-GCM ciphertext (base64) of the JSON record, authenticated against its slot (`events:<id>` or `meta:<key>`). Only the id/key stays readable so lookups work. Plain rows from older versions are still readable and are converted by `migrate()` on first unlock.

## Auth database `showup-auth`

* `profile/main`: `{ v, name, vault: { kdf, iterations, salt, iv, wrapped }, createdAt, failed, lockedUntil, idleMinutes }`. The vault holds the *wrapped* data key, never the password or the key in the clear.
* `session/main`: `{ key: CryptoKey (non-extractable), expiresAt }` when "keep me signed in" is on.

## Pending outcomes database `showup-pending`

Written by the service worker when you press a notification action: `{ id, status }` only, applied and cleared by the page on its next start.

## Meta keys added for Google and Approvals

* `google`: `{ clientId, gmail, connected, lastSync, lastAdded, errors[], needsReconnect }` (encrypted).
* `suggestions`: array of `{ id, source: 'calendar'|'email', label, ref, foundAt, draft }` waiting for approval (encrypted, max 200).
* `dismissed`: array of suggestion ids never to propose again (max 3000).
* Events gain `source` values `calendar` and `email` when approved from Approvals.

## Settings object

```json
{ "reminderOffsets": [60, 1], "allDayReminderHour": 9, "notifications": true,
  "aiModel": "claude-sonnet-5-5", "theme": "system" }
```

## Migrations

`onupgradeneeded` is versioned. v1 creates both stores. Future versions must be additive; each migration has a test that opens a v(N-1) database fixture.

## Opportunities (added in backup version 2)

Events of type `hackathon`, `internship`, `scholarship`, `fellowship` and `competition` carry extra fields.
Older backups load unchanged; missing fields get defaults.

| Field | Type | Notes |
| --- | --- | --- |
| `stage` | string or null | `found`, `registered`, `working`, `submitted`, `interview`, `won`, `lost`, `closed`. Valid ids depend on the type; plain events are `null` |
| `stageLog` | `{stage, at}[]` | Up to 30 entries, appended when the stage changes |
| `deadline` | `YYYY-MM-DD` or null | Competitions only. For internships, scholarships and fellowships the event `date` is the deadline |
| `details` | `Record<string,string>` | Typed fields per type (prize, pay, amount, ...), see `FIELD_SPECS` in `src/domain/opportunity.js` |
| `links` | `{label, url}[]` | Up to 10, http(s) only |
| `tasks` | `{text, done}[]` | Up to 20 checklist items |

`effectiveStatus(e)` maps a stage onto attendance (submitted counts as showing up, dropped as cancelled) so
existing statistics keep working. CSV export gained `Stage` and `Deadline` as the last two columns.
