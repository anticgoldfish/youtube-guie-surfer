# Publish YouTube Guide on GitHub Pages + enable automatic replenishment

No fixed channel count is required. Create 1, 12, or 80 channels; the workflow reads the actual channel list. New channels are given a 100-hour program listing when created in the website. GitHub Actions checks every 30 minutes and refreshes a channel when its future schedule is getting low, using staggered slots (not all channels at once). It tries YouTube for eligible content and uses existing videos as reruns if none are returned.

## A. Upload the ZIP to GitHub (GitHub Desktop — recommended)

1. Download and **extract** the entire ZIP. Do not upload only the ZIP file.
2. Install GitHub Desktop (https://desktop.github.com/) and sign in.
3. In GitHub Desktop, choose **File > Add local repository**, select the *extracted root folder* containing `.github`, `YouTube-Guide`, and `scripts`; if asked, **create a repository here**.
4. Commit the files with message `Initial YouTube Guide upload` and choose **Publish repository** (Public recommended for public Pages). If you already made an empty repo on GitHub, use GitHub Desktop's `Repository > Repository settings` / origin configuration or clone the empty repo and copy extracted files into it, then commit/push.
5. Verify that GitHub contains `.github/workflows/refresh-and-publish.yml`, `scripts/update_channels.py`, and `YouTube-Guide/index.html`. These are three different things: the scheduled job, the updater, and the public website.

**Alternative browser upload:** GitHub repository > Add file > Upload files. Browser uploads can miss hidden `.github` folders, so inspect the resulting repo before relying on the workflow. GitHub Desktop or git is more reliable.

## B. Turn on the website

1. Your GitHub repo > **Settings > Pages**.
2. Under Build and deployment, set Source = **GitHub Actions**.
3. Your repo > **Actions** > **Refresh YouTube Guide and Publish** > **Run workflow** on branch `main`.
4. Wait for the deploy job to complete and open `https://USERNAME.github.io/REPOSITORY/` (replace USERNAME and REPOSITORY with yours). This URL serves the files inside `YouTube-Guide/`; it does NOT execute the `.bat` file.

## C. Connect YouTube to the automatic updater

1. Create a Google Cloud project at https://console.cloud.google.com/ and enable **YouTube Data API v3**.
2. Create an API key for the Data API. Do not commit the key in any project file. An API key restricted to GitHub Actions' varying IPs is tricky; use appropriate API restrictions and watch usage in Cloud Console.
3. On your GitHub repo, go to **Settings > Secrets and variables > Actions > New repository secret**.
4. Name the secret **`YOUTUBE_API_KEY`** (exact capitalization), paste its value, and save.
5. In **Settings > Actions > General**, allow workflows and select workflow permissions **Read and write permissions**, if that setting is offered. The YAML explicitly requests `contents: write`, `pages: write`, `id-token: write`.
6. Go back to **Actions > Refresh YouTube Guide and Publish > Run workflow** to test. View logs under `Refresh staggered channels and stage 100-hour schedules`; without channels it should report `0`, which is normal.

**Schedule:** `.github/workflows/refresh-and-publish.yml` triggers at UTC minutes `07` and `37` every hour. GitHub Actions may delay or skip a scheduled run and may disable schedules in inactive public repos. It is a periodic check, not an always-on server.

## D. Connect your live website to repository saving

The website itself is static. To save channels for all visitors, the admin browser must have permission to update the repository.

1. At https://github.com/settings/personal-access-tokens create a fine-grained personal access token for this repository with **Contents: Read and write**. Keep its expiry/renewal in mind. Do not put it into source code or the public GitHub repository.
2. Open your deployed YouTube Guide site. Open **Admin Options** (local UI PIN `1234`, **not** meaningful security for a public page).
3. Under **GitHub Publishing**, enter your GitHub username as **Owner**, repository name as **Repository**, `main` as **Branch**, and the token in the token field. Click **Save Connection**.
4. Create a test channel with a few valid publicly embeddable YouTube videos, then click **Generate & Save Channel**. The editor initially builds an approximately 100-hour schedule by repeating available programs as necessary.
5. The app should automatically try to publish, or you can click **Publish to GitHub**. Check for success in the admin message. Verify that GitHub's `YouTube-Guide/channels.json` now contains your channel and its `schedule` object. A local-only save is *not* globally published.
6. Open the public website in another browser/incognito window and verify that it shows the channel. GitHub Pages redeployment can take a little time; your webpage also periodically checks the published JSON.
7. The next GitHub Actions run checks whichever actual channels need replenishing soon. It does not assume 200 channels, and it doesn't need a dedicated runner per channel.

**Security note:** Admin PIN `1234` is visible to anyone inspecting your public JavaScript, and GitHub tokens in browser session storage can be stolen by malicious browser extensions or injected scripts. Use a narrowly scoped token, don't share the admin browser session, and revoke the token if exposed. For stronger admin security later, add a backend/OAuth-based publishing mechanism.

## E. What happens when a channel runs low

- Immediately upon creation: the website saves a timestamped 100-hour schedule containing new video IDs plus repeats where needed.
- GitHub Actions checks every 30 minutes. When a channel has 52 hours or less of future schedule, its refresh becomes eligible for a stable half-hour stagger slot across the next 24 hours. If the schedule falls to 28 hours or less before a successful check, every run tries it until a new schedule is staged.
- The updater checks YouTube for **new public uploads** (creator), **current contents** (public playlist), or **similar search results** (recommendation from your captured feed examples). These searches depend on API quota; it is NOT a private continuously synchronized Custom Feed.
- It stages a fresh 100-hour playlist for the next 72-hour broadcast boundary. If YouTube is unreachable, reruns are staged instead. The web viewer also has a fallback so populated channels keep playing if the published EPG is late.
- Newly published channel data is common to every viewer and can later be loaded by an Android TV APK.

**Limitations:** A fresh 100-hour *schedule* does not mean 100 hours of *unique* videos or guaranteed new uploads. YouTube may have no new matching videos or may restrict embedding. API quota may reduce discovery, especially if many channels are due at once; cached reruns maintain playback. GitHub's standard schedule is best-effort.

## F. Future Android/Google TV APK

The canonical public URL is `https://USERNAME.github.io/REPOSITORY/channels.json`. Both the website and future APK will retrieve that JSON. Each channel has an `id`, `number`, `videos`, UTC-millisecond `schedule`, optional `nextSchedule`, and `pendingVideos`/`activateAt`; see `TV-APP-DATA-CONTRACT.md`. No Android application is included yet.

## Troubleshooting

- **Actions workflow missing**: confirm `.github/workflows/refresh-and-publish.yml` exists on the default branch. Hidden folder likely was not uploaded.
- **Website is 404**: select GitHub Actions as Pages source, run workflow, inspect deploy errors, and use repository-specific Pages URL.
- **No new channels on another device**: check admin GitHub owner/repo/branch/token and whether `channels.json` was committed. Local storage does not sync automatically.
- **No discovered videos**: verify `YOUTUBE_API_KEY` and Actions logs, quotas, public video availability, valid creator/playlist URLs, and seed-reference metadata.
- **'Cannot push' / 403**: check workflow permissions and branch protection. Protected branches may require an alternate strategy to commit schedule updates.
- **Extension cannot capture feed**: it works in a supported desktop browser against your own opened YouTube page. GitHub Actions cannot run the signed-in browser extension; unattended discovery uses the YouTube API based on saved examples.
