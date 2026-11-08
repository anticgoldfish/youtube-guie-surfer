# YouTube Guide v1.1.3 — Embedded credentials edition

This build embeds the repository configuration and credentials in `YouTube-Guide/index.html` as explicitly requested. Anyone who can access the public GitHub Pages site or public GitHub repository can retrieve the credentials, regardless of the admin PIN.

- Repository: `anticgoldfish/youtube-guie-surfer` (branch `main`).
- Creating, editing and deleting a channel automatically calls the GitHub Contents API.
- Viewers use shared `YouTube-Guide/channels.json`; the website refreshes it periodically.
- GitHub Actions runs every 30 minutes, discovers eligible new YouTube content when needed and produces continuous 100-hour program guides. If discovery is unavailable it repeats saved videos.
- The future Android TV app can consume the same `channels.json` using the published URL.
- YouTube embed advertisements cannot be reliably suppressed from this static website.

**IMPORTANT: `channels.json` is intentionally absent from this upgrade ZIP. Do not delete your existing repository copy.**

See `GITHUB-SETUP.md` for installation and testing.
