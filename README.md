# Gram Archiver

A browser extension for **Chrome and Firefox** that bulk-archives an Instagram profile from your own logged-in browser session. You can save every post, reel, tagged post, highlight, current story, live broadcast, comment, liker, follower and the profile itself, with all of its metadata. Each category is optional. Everything is saved on your computer and nothing is sent anywhere else.

> Gram Archiver is not affiliated with, endorsed by, or connected to Instagram or Meta.

---

## Contents

- [What it archives](#what-it-archives)
- [What it cannot archive (and why)](#what-it-cannot-archive-and-why)
- [Install](#install)
- [How to use it](#how-to-use-it)
- [What you get](#what-you-get)
- [Options](#options)
- [Speed and account safety](#speed-and-account-safety)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Research sources](#research-sources)
- [Development](#development)
- [Known limitations](#known-limitations)
- [Privacy and legal](#privacy-and-legal)

---

## What it archives

| Category | What is saved |
|---|---|
| **Profile** | Username, name, biography, bio links, external URL, category, pronouns (when Instagram returns them), follower, following and post counts, verified/private/business flags, public contact and address info, broadcast channels, Threads badge and your relationship to the account. Also the **HD profile picture** and the raw, unmodified profile data. |
| **Posts** | Every grid post: photos, videos and carousels (each item). Includes caption, hashtags, mentions, date, location, tagged users, collaborators (collab posts), pinned status, music, like/comment/view counts and alt text. |
| **Reels** | The Reels tab: video, play count and duration, plus the optional cover image and original audio track. |
| **Tagged** | Posts other accounts tagged this profile in. |
| **Highlights** | Every highlight with its title and cover, and every item in it. Sticker data is saved too: mentions, links, polls, locations, music and any other sticker type. |
| **Stories** | Current stories (they expire after 24 h), with the same sticker data. |
| **Live (beta)** | If the account is live, records the broadcast from the moment you start until it ends or a time limit is reached. |
| **Comments** | All comments on each post, optionally with every reply thread. |
| **Likers** | The accounts Instagram lists as having liked each post. |
| **Followers / following** | Full lists as far as Instagram returns them. |
| **Exports** | JSON per post, caption text files, CSV spreadsheets, the raw API responses, and an **offline viewer** (`index.html`) to browse the archive like a profile, without internet. |

Media is saved at the largest size Instagram offers. **Maximum video quality** is optional: it downloads the separate high-quality video and audio tracks (often 1080p) and joins them into one MP4 in the browser, without re-encoding.

## What it cannot archive (and why)

| Item | Reason |
|---|---|
| Private accounts you do not follow | Instagram does not give their posts to anyone outside the follower list. Gram Archiver cannot bypass this, and neither can any of the tools it is based on. Only the public profile information is saved. |
| Live replays | No current, verifiable way to fetch them from the web was found. Lives are recorded only while they are live. |
| Guides | Instagram retired Guides on 2023-12-15. |
| Notes | A direct-message inbox feature, not part of a profile. |
| Reposts tab | No documented web endpoint could be verified. |
| Stories older than 24 h that are not in a highlight | Instagram deletes them. Only the account owner can see their own story archive. |

## Install

The `extension/` folder loads as-is in both browsers. There is no build step.

### Chrome (and Edge, Brave and other Chromium browsers), version 121 or newer

1. Download this repository (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`extension`** folder.
5. Pin **Gram Archiver** from the puzzle-piece menu.

### Firefox, version 140 or newer

Firefox only permanently installs add-ons that Mozilla has signed. There are three options:

- **Quick test (any Firefox):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and select `extension/manifest.json`. It stays installed until Firefox restarts. A temporary install does not show permission prompts, so if the archiver shows a **Site access needed** banner, click **Grant access**.
- **Permanent, unsigned:** in **Firefox Developer Edition, Nightly or ESR**, set `xpinstall.signatures.required` to `false` in `about:config`. Then build the package (see [Development](#development)) and install `dist/gram-archiver-<version>-firefox.zip` via **about:addons → ⚙ → Install Add-on From File**.
- **Permanent, signed:** upload `dist/gram-archiver-<version>-firefox.zip` to [addons.mozilla.org](https://addons.mozilla.org/developers/) as a self-distributed (unlisted) add-on. Mozilla signs it and you install the signed file in any Firefox.

## How to use it

1. **Log in to instagram.com** in the same browser.
2. Open the archiver in one of three ways:
   - click the toolbar icon → **Open archiver**;
   - on a profile page, click the **Archive @username** button in the corner;
   - right-click a profile → **Archive this profile with Gram Archiver**.
3. Type a username or paste a profile link and press **Look up**. The card shows the profile and its counts.
4. Choose what to save (**All**, **Media** or individual items) and adjust the options.
5. Press **Archive**. Keep the archiver tab open while it runs. You can **Pause**, **Stop**, or queue more profiles with **Add to queue**.
6. When it finishes, open `Downloads/Gram Archiver/<username>/index.html` to browse the archive.

You can stop at any time and resume later from **Queue & history → Resume**, even after restarting the browser. Running the same profile again only downloads what is new.

## What you get

```
Downloads/Gram Archiver/<username>/
├── index.html                 ← offline viewer (open in any browser)
├── viewer/                    ← viewer code and data
├── profile/
│   ├── profile.json           ← normalized profile data
│   ├── profile_raw_<date>.json← everything Instagram returned
│   └── profile_picture_<date>.jpg
├── posts/                     ← 2024-05-01_C6abc123_1.jpg, …_2.mp4, …json, …txt, …_comments.json
├── reels/
├── tagged/
├── stories/
├── highlights/<title>_<id>/   ← _cover.jpg + items
├── live/                      ← recorded broadcasts (10-minute parts)
└── data/
    ├── posts.json, reels.json, tagged.json, stories.json, highlights.json
    ├── comments.json, followers.json, following.json
    ├── media.csv, comments.csv, followers.csv, following.csv
    └── archive-info.json      ← run date, options, statistics, warnings
```

File names follow the template you set in **Settings** (default `{date}_{shortcode}_{index}`, dates in UTC).

**ZIP output** (optional):

- **Chrome** writes one ZIP straight to a file you choose (no size limit).
- **Firefox** has no API for writing straight to a file, so the archive is saved as ZIP parts of a size you choose (default 1 GB). Each part is held in memory until it is saved.

## Options

| Group | Option | Default |
|---|---|---|
| Media | Photos, Videos | on |
| | Maximum video quality (join DASH tracks) | off |
| | Keep separate tracks if joining fails | off |
| | Video cover images | off |
| | Music / original audio | off |
| | Ask for the highest image resolution (sets Instagram's `wd`/`dpr` viewport cookies) | on |
| Comments & likes | Comments, Include replies, Max per post | off / on / all |
| | Likers | off |
| Metadata | JSON per post (optionally with the raw data), caption `.txt`, CSV, offline viewer, every raw API response | JSON, CSV and viewer on |
| Filters | Date range, max items per category | none |
| | Skip items already archived | on |
| | Update mode: stop a feed after 3 already-archived posts | off |
| Output | Folders or ZIP, ZIP part size, live recording limit | Folders, 1024 MB, 120 min |
| Settings page | Speed, request cap, simultaneous downloads, folder name, file name template, replace or keep duplicate files, clear download list, theme, profile-page button, detailed log | |

## Speed and account safety

Instagram temporarily limits accounts that make too many requests. Gram Archiver paces its requests the way the longest-running Instagram archivers do:

| Preset | Delay between requests | Source |
|---|---|---|
| **Safe** (default) | 6–12 s, random | gallery-dl's default `sleep-request` for Instagram |
| Balanced | 3–6 s | |
| Fast | 1–2 s | Risky |
| Custom | your range | |

Further safeguards:

- **Request cap:** never more than **75 requests in any 11 minutes**, instaloader's limit.
- **When Instagram says "slow down"** (HTTP 429 / "Please wait a few minutes"): wait 60 s, then back off exponentially up to 15 min.
- **When Instagram asks for a check:** `checkpoint_required`, `challenge_required`, `feedback_required`, `login_required`, a redirect to the login page, or HTTP 401 stops the job immediately. It keeps a resume point, so you can fix the issue on instagram.com and press **Resume**.
- **Media downloads don't count:** downloads from Instagram's media servers are separate from the request pacing and run 3 at a time by default.

The archiver shows an estimate before you start. Use it to judge the time; comments on thousands of posts can take hours at the Safe pace.

## Troubleshooting

| Message | What to do |
|---|---|
| **Site access needed** | Click **Grant access** (Firefox users can revoke host permissions at any time). |
| **Could not find the Instagram account** | Check the spelling, and that you are logged in to instagram.com in this browser. |
| **Instagram redirected to the login page** / **401** | Log in to instagram.com, then **Resume**. |
| **checkpoint / challenge / feedback_required** | Open instagram.com and complete any prompt. Wait (often hours for `feedback_required`), switch to the Safe speed, then **Resume**. |
| **Rate limited… waiting** | Nothing; it continues by itself. |
| **REST endpoint failed; trying the web app's GraphQL query** | Normal fallback. If both fail, Instagram has changed its API; please open an issue with the log (**Copy log**). |
| **Max-quality mux failed** | The standard MP4 was saved instead. |
| **Largest image offered is smaller than the original** | Instagram served smaller images to this session. Keep **highest image resolution** on, or log out and back in. |
| Videos are 720p in Firefox | Instagram decides quality by browser. gallery-dl maintainers observed 1080p only for desktop Chrome user agents ([#8078](https://github.com/mikf/gallery-dl/issues/8078), [#8450](https://github.com/mikf/gallery-dl/issues/8450)). |

## How it works

```
 popup / page button / context menu
            │ opens
            ▼
 ┌──────────────────────────┐   runtime port   ┌──────────────────────────────┐
 │ Archiver tab (extension) │ ───────────────▶ │ bridge.js (content script)   │
 │  job, queue, UI, writers │ ◀─────────────── │ on www.instagram.com         │
 └──────────────────────────┘    JSON/text     │ same-origin fetch with your  │
            │                                  │ session + web-app headers    │
            │ downloads.download / fetch       └──────────────────────────────┘
            ▼
   Instagram CDN (cdninstagram.com, fbcdn.net) → Downloads folder or ZIP
```

- **Requests to Instagram run in the page context.** In Manifest V3, a content script's `fetch` runs in the context of the instagram.com page (MDN), so it carries your session and the instagram.com origin exactly like the web app. The bridge adds the same headers the web app, gallery-dl and yt-dlp send:
  - `X-IG-App-ID: 936619743392459`
  - `X-CSRFToken` (from the `csrftoken` cookie)
  - `X-IG-WWW-Claim`
  - `X-ASBD-ID`
  - `X-Requested-With`
- **The job runs in an extension tab, not the background script.** Chrome stops idle service workers after 30 s, and Firefox unloads idle event pages and has no offscreen documents. A tab is the only context that can run a multi-hour job in both browsers.
- **One manifest for both browsers.** It declares `background.service_worker` (used by Chrome 121+) and `background.scripts` (used by Firefox 121+), as MDN recommends.
- **Resume state lives in IndexedDB.** Cursors, finished items and job history are kept there, so jobs resume after a restart and re-runs skip existing items.
- **Endpoints, with fallbacks:**

  | Data | Endpoint |
  |---|---|
  | User lookup | `/web/search/topsearch/` → profile page `profile_id` → `/api/v1/users/web_profile_info/` |
  | Profile | `/api/v1/users/{id}/info/` |
  | Posts | `/api/v1/feed/user/{id}/` (GraphQL `PolarisProfilePostsTabContentQuery` fallback) |
  | Reels | `POST /api/v1/clips/user/` (GraphQL fallback) |
  | Tagged | `/api/v1/usertags/{id}/feed/` |
  | Highlights | `/api/v1/highlights/{id}/highlights_tray/` → `/api/v1/feed/reels_media/` (5 per request) |
  | Stories | `/api/v1/feed/reels_media/` → `/api/v1/feed/user/{id}/story/` |
  | Live | `/api/v1/live/web_info/` |
  | Comments | `/api/v1/media/{pk}/comments/` + `/child_comments/` |
  | Likers | `/api/v1/media/{pk}/likers/` |
  | Followers / following | `/api/v1/friendships/{id}/followers|following/` |
  | Refresh expired media links | `/api/v1/media/{pk}/info/` |

## Research sources

Every endpoint, header, field and limit comes from the current source code of actively maintained projects, checked in October 2026:

| Project | Version | Used for |
|---|---|---|
| [gallery-dl](https://github.com/mikf/gallery-dl) `gallery_dl/extractor/instagram.py` | 1.32.18 | REST endpoints, headers, pagination, user-lookup order, highlight batching, media selection, 6–12 s pacing |
| [instaloader](https://github.com/instaloader/instaloader) `structures.py`, `instaloadercontext.py` | 4.16 | GraphQL doc_ids and variables, web tokens, comment endpoints, rate-control windows, error handling |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) `yt_dlp/extractor/instagram.py` | 2026.10.26 | Headers, shortcode ↔ id, DASH handling |
| [instagrapi](https://github.com/subzeroid/instagrapi) | 3.2.2 | Field names (profile, story stickers), comment and reply pagination, error types |
| [HOAIAN2/Instagram-Downloader](https://github.com/HOAIAN2/Instagram-Downloader) | 6.0.5 | MV3 extension headers, resolution cookies, DASH muxing with mp4box.js |
| [instarec](https://github.com/qwer-lives/instarec) | 1.8.0 | Live MPD discovery, segment polling, end detection |
| MDN, Chrome developer docs, Firefox Extension Workshop | | Background scripts in both browsers, content-script fetch, downloads API, host permissions, `data_collection_permissions`, signing |

GraphQL `doc_id`s rotate whenever Instagram ships a new web build; they are only used as fallbacks and live in one table (`extension/archive/core/api.js`).

## Development

Requires Node 22+ for the scripts; the extension itself has no dependencies or build.

```bash
npm test
```

Runs 25 unit tests: IDs, DASH parsing, naming, media selection, records, error classification, rate limiter, CSV, comment and timeline pagination, ZIP output, and muxing (needs ffmpeg).

```bash
npm run test:e2e
```

Loads the real extension in Chromium (Playwright) against a simulated instagram.com and CDN. It archives a profile in folder mode and in ZIP mode, checks every file, re-runs to confirm existing items are skipped, and opens the offline viewer. It needs Playwright, Chromium, ffmpeg, openssl and unzip.

```bash
npm run package
```

Writes `dist/gram-archiver-<version>-chrome.zip` and `-firefox.zip`. The Firefox package passes Mozilla's `addons-linter` 10.15.0 with 0 errors and 0 warnings.

Vendored libraries (unmodified releases, no remote code): `extension/lib/client-zip` 2.5.1 (MIT) and `extension/lib/mp4box` 2.5.0 (BSD-3-Clause). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Known limitations

- **Not yet tested against live Instagram.** The automated tests use a simulated Instagram built from the response formats in the sources above. Instagram changes its private web API without notice, so test with a small profile first. If something breaks, the log names the endpoint that failed.
- **Firefox:** validated with Mozilla's linter and written against MDN's compatibility data. The automated browser test runs in Chromium.
- Instagram may cap how many likers, followers or following it returns. The log warns when a list is shorter than the profile's count.
- In ZIP mode a resumed job writes a new ZIP containing only the remaining items.
- Live recording keeps up to 10 minutes of stream in memory before saving each part.

## Privacy and legal

- **Privacy:** See [PRIVACY.md](PRIVACY.md). The extension has no servers, analytics or telemetry. It talks only to instagram.com and Instagram's media servers, as you, and saves files on your computer.
- **Terms of Use:** Instagram's Terms of Use restrict automated collection of data. Read them and make sure your use is permitted. The project could not retrieve the current terms for verification at the time of writing.
- **Copyright and privacy of others:** Only archive content you have the right to keep, for example your own account, an account you manage, or content for personal backup where the law allows it. Respect copyright and other people's privacy, and do not republish what you archive without permission.
- **Store listings:** Store listings that use the "Instagram" name have faced trademark problems, which is why this extension is called Gram Archiver.

Licensed under the [MIT License](LICENSE).
