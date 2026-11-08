# Updating the existing GitHub website

1. Download and extract this archive. Keep a backup of `YouTube-Guide/channels.json` from GitHub.
2. Copy the extracted project files into the **root** of the existing `anticgoldfish/youtube-guie-surfer` repository, keeping `YouTube-Guide/channels.json` as-is. Do **not** delete it or replace it with an empty example file.
3. Commit and push to `main` (GitHub Desktop is recommended).
4. GitHub > Settings > Pages > Source: **GitHub Actions**.
5. GitHub > Settings > Actions > General > Workflow permissions: **Read and write**.
6. GitHub > Actions > **Refresh YouTube Guide and Publish** > **Run workflow**. The workflow also triggers automatically every 30 minutes (`:07` and `:37` UTC).
7. Open the published Pages URL (normally `https://anticgoldfish.github.io/youtube-guie-surfer/`), enter your admin PIN, and create a small test channel. Verify it is committed to `YouTube-Guide/channels.json` on GitHub, and appears in a private browser window after deployment.
8. To test replenishment, manually run the workflow with its `force_refresh` input and inspect its logs and the committed JSON. Be aware of YouTube API quotas.

### Credentials
Both credentials are embedded directly in `YouTube-Guide/index.html` under `window.YOUTUBE_GUIDE_SETTINGS`. You do not need to paste credentials again in the admin panel, nor configure the YouTube Actions secret for this version (the script falls back to the embedded key). A pre-existing `YOUTUBE_API_KEY` Actions secret overrides the embedded key.

**Warning:** This exposes both credentials to everyone with access to the public site/repo. The PIN hides the admin menu only and does not restrict GitHub API access. If you later change your mind, revoke the exposed GitHub token and rotate the YouTube key immediately.

### Future Android TV APK
The APK should **read only** the publicly published `YouTube-Guide/channels.json` and use its timestamps and YouTube IDs; never include a GitHub write token in the APK.
