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

## Settings object

```json
{ "reminderOffsets": [1440, 60], "allDayReminderHour": 9, "notifications": true,
  "aiModel": "claude-sonnet-5-5", "theme": "system" }
```

## Migrations

`onupgradeneeded` is versioned. v1 creates both stores. Future versions must be additive; each migration has a test that opens a v(N-1) database fixture.
