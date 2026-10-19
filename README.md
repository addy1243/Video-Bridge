# VideoBridge

A Windows Chrome/Edge extension that sends video/page URLs to a local yt-dlp helper, with optional per-site sharing of your signed-in session. It supports yt-dlp's site extractors, generic webpage extraction, and direct media/manifests such as MP4, WebM, HLS and DASH where supported. The helper lists available video formats, downloads your selection, and joins separate audio/video tracks with FFmpeg. It runs locally without a hosted backend or automatic cookie export.

## Windows installer (0.4.1)

For friends, use [GitHub Releases](https://github.com/addy1243/Video-Bridge/releases/latest) and download the `VideoBridge-…-Setup-x64.exe` asset. The GitHub **Code > Download ZIP** option contains source code and requires the prerequisites documented below.

The installer includes the extension, an isolated Python runtime, Node.js, FFmpeg, and downloader dependencies. It installs for the current Windows user under `%LOCALAPPDATA%\Programs\VideoBridge` without changing PATH or requiring administrator rights. Close browser windows and active downloads before installing/updating. The installer is currently unsigned; Windows may show an unknown-publisher warning. This installer targets Windows 10/11 x64.

After installation, leave **Connect the extension to Chrome or Edge** checked. The connection window opens the installed extension folder. Open `chrome://extensions` or `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, select that folder, and paste the extension ID into the connection window. Browser approval is required; the installer does not silently install extensions. Run **Connect VideoBridge to browser** from the Start menu again to connect another browser. Each browser uses its own extension ID and signed-in session.

Bundled setup works without installing dependencies from the internet. Downloader updates still use PyPI and remain isolated to the bundled runtime; extension/runtime updates require a newer installer plus **Reload** in the extensions page. Existing helper settings are preserved when updating in the same install folder. Source-folder installations remain separate: install and connect the release once to switch to its helper. Downloaded files are kept outside the install folder. The initial installer has no uninstaller; remove the browser extension before manually removing the installation folder when no longer needed.

Releases are built by `.github/workflows/release.yml` on Windows. A tag matching the manifest version (for example `v0.4.1`) runs the unit tests, builds/checks a relocatable runtime, runs the local media/resume/authentication fixture against that runtime, compiles the installer with Inno Setup, and publishes it with a SHA-256 checksum. Manual workflow runs create downloadable build artifacts without publishing a release. Build locally with Python 3.13 on Windows and Inno Setup 6 installed:

```powershell
python packaging/build_release.py --iscc 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe'
```

The build downloads checksum-pinned official Python/Node archives and dependencies from PyPI; third-party runtime/package license files are retained in the bundle. Generated installers and build data are excluded from Git.

## Signed-in sites in 0.4.0

For a registered-users/login-required error, first confirm the exact video plays in the same browser and profile where VideoBridge is installed. For the reported Hotstar case, use Edge:

1. Wait for downloads to finish and Reload VideoBridge from `edge://extensions`. Confirm the popup says **v0.4.1** for the current release.
2. Open the signed-in Hotstar video tab. Enable **Use this site's signed-in session** and approve the optional cookie permission.
3. Click **Show available choices**, then download a supported format. If a DRM error follows, session sharing cannot resolve it.

Sharing is off whenever a popup opens. Changing to a different site and Clear history switch it off. The browser remembers the permission grant, but the extension does not read cookies unless sharing is enabled for the request. Only cookies applicable to the page URL are read, from the current tab's cookie store; regular and InPrivate sessions are not mixed. The tab must belong to the site whose session you share. No browser-wide cookie database extraction or cookie file export is used.

Cookie values are passed to the local helper in memory, validated against the approved site, and added to yt-dlp's cookie jar. Cookie scope/path/secure rules are retained. The helper disables yt-dlp disk caching for authenticated requests and does not write a cookie file. Values are not included in saved jobs/history; only the approved page URL and tab ID are retained with choices. Resume requires enabling sharing again and reads fresh cookies from the current tab. Requests are limited to 100 cookies / 32 KiB. Partitioned-cookie-only sessions, expired sessions, provider changes, and extractors that do not support the site's current authentication can still fail.

This has been verified with synthetic cookies and a local authenticated fixture. Your actual Edge cookies have not been read during development, and Hotstar playback/download through the helper remains unverified. Authentication does not remove DRM or extend your subscription rights.

## Activating version 0.3.1

Close the popup, open `chrome://extensions` or `edge://extensions`, and click VideoBridge's **Reload** button. Approve HTTP/HTTPS site access if prompted. Under Details > Site access, allow access **On all sites** for cross-origin stream detection. The popup displays version 0.3.1 after activation. No helper reinstall is needed.

An unpacked popup can read changed files immediately while its service worker and manifest remain from the last extension reload. This produces **Unknown action** for new commands and **Only permissions specified in the manifest may be requested** when the new popup requests permissions absent from the loaded manifest. Version 0.3.1 adds explicit HTTP/HTTPS host_permissions, removes the redundant Detect-button permission request, and checks the loaded manifest/background build before enabling actions. A mismatched popup shows **Reload extension**; the button waits until the current helper operation finishes. If the background is unreachable, use Reload on the extensions page after any downloads finish. Downloader auto-updates do not activate extension code or manifest changes.

## Cloudflare / HTTP 403 errors

Setup and downloader updates install `yt-dlp[default,curl-cffi]`, including yt-dlp's documented browser-compatibility transport. If generic extraction reports its specific Cloudflare anti-bot challenge error, the helper retries once with `generic:impersonate=chrome`. Ordinary requests retain their default transport. This is not a CAPTCHA solver, browser-cookie importer, or DRM feature, and the website can still refuse the request.

If blocked after that retry, the popup recommends starting playback in the browser and using **Detect streaming video** to select an underlying media link instead of the webpage. This also may fail when the media host requires browser-only verification or login. Error messages are stripped of terminal formatting codes. Existing installations can install the added dependency using **Update downloader now** or Setup.cmd; no browser extension reload is needed for helper-only changes once the new files and dependency are in place.

## General website support in 0.3

Wait for downloads to finish, then Reload VideoBridge from `chrome://extensions` or `edge://extensions`. Accept added scripting/webRequest permissions if the browser prompts. YouTube and X still work, but they are no longer the only allowed domains. General URLs retain query parameters, including signed media tokens. Only HTTP/HTTPS links without embedded usernames/passwords are accepted; file/data/javascript and browser-only blob links are not sent to the helper.

1. Open the video webpage and start playback. Open VideoBridge and try **Show available choices** on the webpage URL first.
2. If extraction fails, click **Find videos on this page**. Select a media or embedded-player link from the dropdown, then Show available choices or Download. The scan reads video/source elements, media links, embedded players, open shadow roots and resource timing entries. Frames can be scanned only where browser permissions allow it.
3. For a JavaScript/blob player, click **Detect streaming video**. Close the popup and start or seek playback so new media requests occur. Reopen VideoBridge and select a **Detected stream**. If the player already buffered its manifest, keep detection enabled and reload the same page, then start playback again. If site access is withheld, the popup directs you to Details > Site access.
4. Detection watches response URL/content-type metadata only for the selected tab. It stops on navigation to another page, tab closure, 15-minute expiry, Stop streaming detection, or Clear history. It does not read cookies or response bodies. HTTP/HTTPS host access is declared in the manifest to observe cross-origin players/CDNs. Monitoring and capture remain inactive until you explicitly start detection for a tab.
5. Captured links stay in session storage (up to 100 per tab); page-scan choices stay in the popup. Selected download/resume links remain in local extension storage until Clear history. Regular/private windows share extension storage. Detection may see ads/previews as well as the desired video: check your choice. Signed URLs can expire; rescan if needed. Referrer context is passed to the helper for discovered sources and saved with resume choices.

This is broad website support, not a promise that every website works. DRM, login-only playback, anti-bot challenges, proprietary protocols, inaccessible cross-origin players, and sites that require browser session cookies can still fail. A blob URL is a browser media handle, not a standalone downloadable file. Detection helps find underlying media/manifests only when observable in browser requests. No DRM or access-control bypass is implemented. Playlist extraction is bounded to the first 50 entries; scan and choose one video to avoid downloading multiple items.

The supplied AnimeNana example returned HTTP 403 to a direct request and redirected to the site's homepage in the test browser. Downloading that specific episode has not been verified.

## Updating an existing installation to 0.2

Wait for any running download to finish. Open `chrome://extensions` or `edge://extensions` and click **Reload** on VideoBridge. Accept the added `alarms` permission if the browser asks. The installed helper uses the updated files in this folder, so another PowerShell command is not needed.

- Click **Show available choices**, then choose the resolution, frame rate, and container exposed by the source. For a post containing several videos, select which video first. File sizes are shown when available; video-only sizes exclude the additional audio. Choosing Best available after scanning applies to the selected video. Without scanning, the existing best/quality preferences still work and an X post can download all its videos.
- The status shows bytes received, size when known, speed, and ETA for the current media stream. Audio and video streams have separate progress.
- After a failure or browser restart, **Resume interrupted download** retries the last saved link and choices. yt-dlp resumes existing `.part` and fragment files when the source permits it. Automatic network retries also retain partial data. This is not a guarantee against restarting: a server that refuses Range requests, changed media/format/title, expired access, or missing partial files can require a fresh download. Keep the destination and partial files in place. Only the latest download's resume command is retained.
- **Clear history** removes saved download status, link, file path, and resume choices, and stops detection/clears captured links. Downloaded and partial files, helper setup, and update settings are kept. Wait for the current helper operation to finish before clearing. It removes Resume for that record and remains cleared after reopening the browser. Only the latest download record is retained; this does not clear the browser's browsing history.
- Downloader updates check PyPI daily while the browser is running, and defer while this extension's helper is busy. **Setup & updates → Update downloader now** runs the same check on demand. Updates apply to yt-dlp and its dependencies inside `.venv`, not global Python, Node.js, FFmpeg, or the extension's JavaScript. Updates can fail without network access; the result is shown under Setup & updates. Different browser profiles are prevented from updating and downloading through this helper at the same time.
- This remains an unpacked extension. Automatic distribution of extension code requires a separately configured signed release/store channel. Local code edits still need **Reload**; a downloader update does not update the extension UI.

Site-specific extraction can stop working when sites change. DRM-protected, unsupported private/login-only or age-gated sessions, and live videos remain outside this version's scope. Public videos can still require authentication or encounter anti-bot restrictions.

## Install on Windows

Prerequisites: Python 3.10+ and Node.js 22+ available on PATH. Setup downloads yt-dlp with its default dependencies, curl-cffi browser-compatibility transport, and imageio-ffmpeg, whose Windows wheel includes FFmpeg. Dependencies stay in this project's `.venv`; no administrator rights are needed.

1. Keep this project folder in a permanent location.
2. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's **extension** folder.
3. Double-click **Setup.cmd** in this project folder. On first setup it asks for the extension's 32-character ID, which you can copy from the extensions page or **VideoBridge → Setup & updates → Copy extension ID**. Paste it and press Enter. On later runs it reuses registered IDs and the existing download folder automatically.
4. Setup downloads dependencies and registers the local helper for your Windows user. No administrator access or manually typed PowerShell command is needed. If you prefer the command line, open PowerShell in this project folder and run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId YOUR_EXTENSION_ID
   ```

   Setup.cmd uses that process-scoped execution-policy option automatically. The installer creates a local Python environment, installs dependencies from PyPI, writes helper configuration, and registers this helper under the current user's Chrome and Edge NativeMessagingHosts registry keys. It does not change global Python packages or browser cookies. If using both browsers and their extension IDs differ, add the other ID from PowerShell:

   ```powershell
   .\install.ps1 -ExtensionId 'CHROME_EXTENSION_ID','EDGE_EXTENSION_ID'
   ```

   A custom destination can be supplied with `-OutputDirectory 'D:\Videos'`. For a new installation the default is your Windows Downloads folder's `VideoBridge` subfolder. Setup can be rerun to update dependencies; existing extension IDs and the destination are preserved unless you supply a different destination.

5. Open the popup and click **Check local helper**. Then open a video page, open the extension, select quality, and click **Download video**. You can also paste a webpage/direct media link, or use page/stream detection as described above.

## Behavior and limits

Private browsing is disabled for extensions by the browser by default. To enable it, open `chrome://extensions` or `edge://extensions`, choose VideoBridge's Details, and enable **Allow in Incognito** / **Allow in InPrivate**. VideoBridge uses the default shared extension context: regular and private windows share the latest download record and the one-operation limit. Incognito downloads can therefore leave a saved record visible in regular windows until you use Clear history. Downloaded files remain on disk. This version does not provide separate private-window storage.

- One helper operation at a time. A post with several videos can save several files unless you scan and choose one.
- Closing the popup keeps the download running. Closing the browser, disabling/reloading the extension, or losing the native connection interrupts it. Retrying can resume partial files. Browser crash recovery is not guaranteed.
- Progress describes the current audio/video stream, so it can restart when the next stream begins. Completion is reported only after the final file exists.
- The initial 1080p/720p preferences are not strict caps. Scanning lists explicit formats: an explicit choice does not fall back to a different resolution if unavailable later. Audio is added when available. Output uses the available media container (often MP4, WebM, or MKV); it does not force a lossy re-encode.
- Existing final files are not overwritten. FFmpeg may remove intermediate audio/video files after merging; final files and partial-download files are not intentionally deleted by this project.
- Downloads appear in the extension's status, not the browser's Downloads manager. This is a native helper download.
- No payment/subscription bypass, DRM decryption, or access-control bypass is implemented. Session sharing only supplies your approved site's cookies to its extractor. Use content you have permission to save.
- Extension permissions are `activeTab`, `nativeMessaging`, `storage`, `alarms`, `scripting` (explicit page scans), and `webRequest` (opt-in stream detection). The manifest declares HTTP/HTTPS host access; the browser controls the grant. The page scanner runs only on explicit request, and detected media is retained only for tabs where detection was started. There is no listening HTTP server in production. The helper validates links and format selections again independently of the popup. Only registered extension IDs can invoke it through browser native messaging.
- yt-dlp can contact the source site's media/CDN servers and run its installed YouTube JavaScript support using Node. Keep dependencies updated. The helper is a local user process, not a security sandbox.
- This project is for unpacked installation; store publication has not been prepared or verified.

If the helper is not found, check the extension ID and rerun setup. If extraction fails, rerun setup to update yt-dlp and inspect the error in the popup. A public URL is not a guarantee of download availability. Do not move the project after registering the helper; rerun setup if you move it.

## Development checks

```powershell
node --test tests/*.test.js
python -m unittest discover -s tests -p 'test_*.py'
```

The tests cover general URL handling, trust boundaries, native-message framing including partial reads, live filtering, explicit choices, popup selection, page scanning and network classification, capture scoping/navigation cleanup, download progress labels, stored resume commands across service-worker restarts, Clear history, and updater scheduling/defer behavior. They do not establish live compatibility with every site, or actual browser permission/capture behavior.

After installing dependencies, `.\.venv\Scripts\python.exe tests/smoke_pipeline.py` generates short audio/video fixtures, serves them on loopback, lists formats, selects an explicit format, seeds a partial download, verifies a resumed Range request at the saved byte offset, and verifies both merged streams decode. It also exercises the real generic extractor on an HTML video page, direct MP4, HLS and DASH. Generated test artifacts stay under `.tmp`. It makes no request to third-party media sites.

Primary references: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Edge native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg).
