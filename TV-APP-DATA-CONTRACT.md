# Portable channel and programming contract — v1.1.2

## Stable public endpoint

`https://anticgoldfish.github.io/youtube-guie-surfer/channels.json`

The URL reflects the repository observed in the user's GitHub setup; adjust if the repository is renamed or a custom domain is used. **Viewers and the future APK need no GitHub token or YouTube API key.** The website fetches the file approximately every 60 seconds and the future Android/Google TV client can poll the same endpoint.

## Root fields

- `version`: 3 (compatible schema identifier)
- `scheduleSchemaVersion`: 1
- `scheduleHorizonHours`: 100 (each generated schedule contains >=100 hours of airtime)
- `refreshIntervalHours`: 72 (legacy/default refresh configuration, not a promise that every channel refreshes at exactly 72 hours)
- `updatedAt`: ISO 8601 UTC timestamp of latest saved channel data
- `channels`: array of channel records, variable length (not capped or preconfigured for 200)

## Channel fields

- `id` (stable unique channel ID), `number`, `name`, `category`
- `mode`: `seeds`, `creatorMulti`, `playlist`, or `multi` (legacy values may be supported)
- `seedIds`, `feedPrompt`, `sourceCreators`, `sourceChannel`, `playlists`: source configuration for backend discovery
- `order`, `anchor`: presentation and deterministic virtual schedule fallback
- `videos`: playable cached YouTube metadata; at minimum each entry has `id`, `title`, `creator`, and duration in **seconds**
- `pendingVideos`: staged lineup for later EPG activation, optional
- `schedule`, `nextSchedule`: 100-hour program listings, optional when no playable content exists
- `activateAt`: Unix millisecond timestamp for staged lineup activation, optional
- `lastRefreshAt`, `lastDiscoveryAt`: optional operational timestamps (Unix milliseconds)

**Time unit:** `start`, `end`, `activateAt`, and all schedule program timestamps are **Unix milliseconds in UTC**, never local timezone strings. Video `duration` uses **seconds**.

## EPG record

```json
{
  "schemaVersion": 1,
  "start": 1800000000000,
  "end": 1800360000000,
  "durationHours": 100,
  "programs": [
    {"videoId": "example123", "start": 1800000000000, "end": 1800003600000}
  ]
}
```

Example `programs` is shortened for clarity. A real EPG has contiguous entries spanning the entire window with repeats when needed. The refresh job **appends** a new 100-hour EPG starting exactly at the previous active EPG's `end` whenever possible, so a refreshed channel has no timetable gap. If GitHub Actions has been offline longer than the current EPG, the next generated EPG starts at or after current time, while the virtual fallback keeps cached videos playable.

## Website and APK playback algorithm

1. Fetch `channels.json`, ensure the root and channel records have the required fields.
2. Identify the selected channel by stable `id` or `number`.
3. Find a schedule covering the current UTC millisecond timestamp, preferring `nextSchedule` over `schedule` when both overlap.
4. Binary-search `programs` for the entry satisfying `start <= now < end`, then resolve `videoId` in `pendingVideos` or `videos`.
5. Compute `offsetSeconds = (now - program.start) / 1000` and start embedded playback from there where the platform allows. Do not allow skipping ahead of the shared on-air point.
6. If neither EPG covers the current time, fall back to repeating cached videos deterministically using the channel's `anchor`, `order`, and stored durations. Never show blank airtime solely because discovery failed.
7. Poll the endpoint for changes while preserving the current broadcast until its expected transition. Detect unavailable/private/nonembeddable videos gracefully; the website cannot bypass YouTube playback restrictions.

**Future APK:** A Kotlin Android/Google TV client or carefully packaged webview can consume this JSON independently of the Windows `.bat` file. Only the backend GitHub workflow writes channel schedules; a normal viewer or APK never needs write access. YouTube player policy and availability may differ on Android TV, requiring platform-specific integration. The APK itself is not in this package.
