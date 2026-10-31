# Third-party notices

## client-zip 2.5.1

`extension/lib/client-zip/index.js`. Unmodified copy of the npm release.
https://github.com/Touffy/client-zip. MIT License; the full text is in `extension/lib/client-zip/LICENSE.txt`.

## mp4box.js 2.5.0

`extension/lib/mp4box/`. Unmodified copy of the npm release files `dist/mp4box.all.mjs` and its two chunk files.
https://github.com/gpac/mp4box.js. BSD 3-Clause License; the full text is in `extension/lib/mp4box/LICENSE`.

## HOAIAN2/Instagram-Downloader 6.0.5 (adapted code)

`extension/archive/core/mux.js` is adapted from `src/muxer/muxer-frame.js` of
https://github.com/HOAIAN2/Instagram-Downloader. That code copies the samples of a DASH video track and audio track into a single non-fragmented MP4 with mp4box.js.

```
MIT License

Copyright (c) 2022 HOAI AN LE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Research references (no code copied)

Endpoint paths, headers, field names and pacing values were taken from the documented behaviour and source code of these projects:
- gallery-dl (GPL-2.0)
- instaloader (MIT)
- yt-dlp (Unlicense)
- instagrapi (MIT)
- instarec (GPL-3.0)

No code from them is included.
