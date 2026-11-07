# YouTube Guide v1.1.1 — Adaptive 100-hour schedules

A live-style YouTube channel guide hosted on GitHub Pages. The number of channels is **not predetermined**. Each new channel receives at least 100 hours of scheduled airtime immediately (reruns allowed). The GitHub Actions workflow runs every 30 minutes and proactively replenishes channels as their remaining scheduled airtime gets low, with staggered discovery rather than refreshing every channel at once.

**Start with `GITHUB-SETUP.md` for uploading, Pages deployment, an API key, GitHub Actions, and browser-based admin publishing.**

- `YouTube-Guide/`: static website, shared `channels.json`, Windows-only local launcher.
- `.github/workflows/refresh-and-publish.yml`: GitHub Actions check and Pages deployment, every 30 minutes.
- `scripts/update_channels.py`: reads actual channel list, fetches new content using YouTube Data API, creates additional 100-hour listings, and stages them for the next broadcast boundary.
- `scripts/schedule_engine.py`: timestamped 100-hour EPG generator and 30-minute stagger logic.
- `Feed-Companion-Extension/`: optionally captures examples from *your open YouTube Custom Feed* to teach independent recommendation search. Not an unattended YouTube Custom Feed API.
- `TV-APP-DATA-CONTRACT.md`: portable format for future Android/Google TV app.

A 100-hour listing can include repeats. A working YouTube API key and successful searches are required for genuinely new discoveries, and neither unique programming nor an on-time GitHub Actions run can be guaranteed. YouTube embedding restrictions still apply. No Android APK is included yet.

To test locally on Windows, run `YouTube-Guide/START-TV-GUIDE.bat`; this is not used by GitHub Pages. Example offline checks:

```bash
PYTHONPATH=scripts python -m unittest discover -s scripts -p 'test_staggered_schedule.py'
node scripts/test_schedules.js
node scripts/test_epg.js
```
