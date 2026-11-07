# Shared TV guide data contract (website + future APK)

**Stable public endpoint** (substitute the repo owner/name):

`https://YOUR_USERNAME.github.io/youtube-guide/channels.json`

The JSON is a static public file served by GitHub Pages. Both clients should poll for new data (the website currently polls about once per minute). Do not put API keys, secrets or viewer data in this file.

Top-level keys: `version` (3 when published from v1.1), `updatedAt` (UTC ISO string), `scheduleSchemaVersion` (1), `scheduleHorizonHours` (100), `refreshIntervalHours` (72), `channels` (array).

For each channel, retain its existing `id`, `number`, `name`, `mode`, `order`, `anchor`, and `videos`. The updater also sets `pendingVideos`, `activateAt`, and `nextSchedule`. Once activation time is reached, a later updater invocation can promote these to `videos` and `schedule`; the **clients must also handle a future `nextSchedule` directly, without waiting for promotion**.

Both `schedule` and `nextSchedule` use this shape:

```json
{
  "schemaVersion": 1,
  "start": 1800000000000,
  "end": 1800360000000,
  "durationHours": 100,
  "programs": [
    { "videoId": "ExampleVideoId", "start": 1800000000000, "end": 1800001800000 }
  ]
}
```

The sample shows one illustrative program; a real 100-hour EPG contains all entries and is contiguous from `start` to `end`. All times are **UTC Unix milliseconds**. Each program's `videoId` references a video in `pendingVideos` or `videos`, with metadata such as `title`, `creator`, `duration` in seconds.

Playback algorithm:

1. Fetch `channels.json` (no authorization required for viewing).
2. For the tuned channel and the current Unix millisecond timestamp, prefer a matching `nextSchedule` over `schedule` if both cover now; binary-search its `programs` for the record where `start <= now < end`.
3. Resolve its `videoId` in `pendingVideos` then `videos`; compute `offsetSeconds = (now - program.start) / 1000`.
4. Play that YouTube video using a platform-appropriate player subject to YouTube's embed/playback terms and availability.
5. When the EPG doesn't cover now, use the existing deterministic 72-hour rotation based on `anchor`, `order`, and saved video durations. This ensures reruns continue if the updater is offline.
6. Poll for changes. Don't jump mid-program solely because metadata was updated; switch at a scheduled boundary or program transition.

**Future Android TV app design:** a Kotlin/Java-based Google TV client can reuse this JSON contract and channel numbers, EPG timestamps, and synchronization semantics. The website's HTML/JS and the Windows `.bat` are **not** required inside the APK; the APK and webpage read the same public schedule service. This package does not include an Android TV app or promise that all YouTube videos will be embeddable on TV.
