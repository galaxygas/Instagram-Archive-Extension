# Privacy

Gram Archiver collects no data. It has no servers, accounts, analytics, telemetry or advertising.

## What the extension does with data

- **Instagram requests:** It sends requests only to `www.instagram.com` and Instagram's media servers (`*.cdninstagram.com`, `*.fbcdn.net`). It does this from your own browser, using your own logged-in session, and only when you start an archive or look up a profile.
- **Saved files:** Everything it receives is saved on your computer: in your Downloads folder, or in a ZIP file you choose.
- **Stored in your browser:** It keeps the following in the browser's extension storage:
  - your settings
  - a record of what was archived for each profile, so re-runs can skip existing items
  - job history, so jobs can be resumed

  You can delete these at any time in **Settings → Stored archive data**. Uninstalling the extension removes them.
- **Instagram cookies:** On instagram.com it reads the `csrftoken` cookie, which the Instagram web app also sends with its requests, and `ds_user_id`, to recognise your own account. If you keep **Ask for the highest image resolution** on, it sets the `wd` and `dpr` viewport cookies.
- **Nothing else:** Nothing is sent to the extension's authors or any third party.

## Firefox data collection declaration

The manifest declares `"data_collection_permissions": { "required": ["none"] }`. Firefox's built-in consent system uses this declaration to show that the add-on collects and transmits nothing.
