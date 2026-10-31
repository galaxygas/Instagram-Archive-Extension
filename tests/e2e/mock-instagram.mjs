// A simulated instagram.com + CDN for end-to-end tests. Response shapes follow the
// fields the extension reads (see tests/fixtures/items.mjs for sources); all data is fake.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const USER_ID = '25025320';
export const USERNAME = 'test.account';
export const CDN_HOST = 'scontent-test.cdninstagram.com';
const CDN = `https://${CDN_HOST}`;

function makeMedia() {
  const dir = mkdtempSync(join(tmpdir(), 'ga-media-'));
  const jpg = join(dir, 'a.jpg');
  const mp4 = join(dir, 'a.mp4');
  const m4a = join(dir, 'a.m4a');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=480x600', '-frames:v', '1', jpg]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-c:a', 'aac', m4a]);
  return { jpg: readFileSync(jpg), mp4: readFileSync(mp4), m4a: readFileSync(m4a) };
}

const user = { pk: USER_ID, username: USERNAME, full_name: 'Test Account', is_verified: true, is_private: false };
const img = (name, w = 480, h = 600) => ({ candidates: [{ width: w, height: h, url: `${CDN}/v/${name}.jpg?stp=dst-jpg` }, { width: 240, height: 300, url: `${CDN}/v/${name}_s.jpg` }] });

function post(n, extra = {}) {
  const pk = String(3000000000000000000n + BigInt(n));
  return {
    pk, id: `${pk}_${USER_ID}`, code: `TEST${n}`, taken_at: 1700000000 - n * 86400, media_type: 1, product_type: 'feed', user,
    caption: { text: `Post number ${n} #test @friend` }, like_count: 10 * n, comment_count: n === 1 ? 3 : 0,
    image_versions2: img(`post${n}`), original_width: 480, original_height: 600,
    ...extra,
  };
}

function video(n, extra = {}) {
  const pk = String(3100000000000000000n + BigInt(n));
  return {
    pk, id: `${pk}_${USER_ID}`, code: `REEL${n}`, taken_at: 1700000000 - n * 3600, media_type: 2, product_type: 'clips', user,
    caption: { text: `Reel ${n}` }, play_count: 1000 + n, comment_count: 0,
    image_versions2: img(`reel${n}`, 320, 568),
    video_versions: [{ type: 101, width: 320, height: 568, url: `${CDN}/v/reel${n}.mp4` }],
    music_metadata: { music_info: { music_asset_info: { id: `9${n}`, title: `Song ${n}`, display_artist: 'Artist', progressive_download_url: `${CDN}/v/song${n}.m4a` } } },
    ...extra,
  };
}

export function createMock() {
  const media = makeMedia();
  const posts = [post(1, { timeline_pinned_user_ids: [Number(USER_ID)] }), post(2), post(3, {
    media_type: 8, product_type: 'carousel_container',
    carousel_media: [
      { pk: '3000000000000000301', media_type: 1, image_versions2: img('car1') },
      { pk: '3000000000000000302', media_type: 2, image_versions2: img('car2'), video_versions: [{ type: 101, width: 320, height: 568, url: `${CDN}/v/car2.mp4` }] },
    ],
  }), post(4), post(5)];
  const reels = [video(1), video(2)];
  const storyItems = [{
    pk: '3200000000000000001', taken_at: 1700050000, expiring_at: 1700136400, media_type: 1, user, image_versions2: img('story1', 360, 640),
    story_link_stickers: [{ story_link: { url: 'https://example.com/link', link_title: 'Link' } }],
    story_polls: [{ poll_sticker: { question: 'Like it?', tallies: [{ text: 'Yes', count: 5 }, { text: 'No', count: 1 }] } }],
  }];
  const highlightItems = {
    'highlight:17900000000000001': [{ pk: '3300000000000000001', taken_at: 1690000000, media_type: 1, user, image_versions2: img('hl1', 360, 640) },
      { pk: '3300000000000000002', taken_at: 1690000100, media_type: 2, user, image_versions2: img('hl2', 360, 640), video_versions: [{ type: 101, width: 320, height: 568, url: `${CDN}/v/hl2.mp4` }] }],
    'highlight:17900000000000002': [{ pk: '3300000000000000003', taken_at: 1680000000, media_type: 1, user, image_versions2: img('hl3', 360, 640) }],
  };
  const requests = [];

  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  function api(url, method, body) {
    const p = url.pathname;
    if (p === '/web/search/topsearch/') return json({ users: [{ position: 0, user: { pk: USER_ID, id: USER_ID, username: USERNAME } }], status: 'ok' });
    if (p === `/api/v1/users/${USER_ID}/info/`) {
      return json({
        user: {
          ...user, pk: USER_ID, biography: 'Archive test profile\nSecond line', external_url: 'https://example.com',
          bio_links: [{ title: 'Site', url: 'https://example.com' }], category: 'Artist',
          follower_count: 3, following_count: 2, media_count: posts.length, highlight_reel_count: 2,
          hd_profile_pic_url_info: { url: `${CDN}/v/avatar.jpg`, width: 320, height: 320 },
          friendship_status: { following: true }, public_email: 'hello@example.com',
        },
        status: 'ok',
      });
    }
    if (p === '/api/v1/users/web_profile_info/') return json({ data: { user: { id: USER_ID, username: USERNAME, edge_felix_video_timeline: { count: reels.length } } }, status: 'ok' });
    if (p === `/api/v1/feed/user/${USER_ID}/`) {
      const maxId = url.searchParams.get('max_id');
      const items = maxId ? posts.slice(3) : posts.slice(0, 3);
      return json({ items, more_available: !maxId, next_max_id: maxId ? null : 'PAGE2', status: 'ok' });
    }
    if (p === '/api/v1/clips/user/' && method === 'POST') {
      const form = new URLSearchParams(body || '');
      if (form.get('target_user_id') !== USER_ID) return json({ message: 'bad', status: 'fail' }, 400);
      return json({ items: reels.map((media) => ({ media })), paging_info: { more_available: false, max_id: null }, status: 'ok' });
    }
    if (p === `/api/v1/usertags/${USER_ID}/feed/`) return json({ items: [post(9, { user: { pk: '77', username: 'other' } })], more_available: false, status: 'ok' });
    if (p === `/api/v1/highlights/${USER_ID}/highlights_tray/`) {
      return json({
        tray: [
          { id: 'highlight:17900000000000001', title: 'Travel', media_count: 2, created_at: 1690000000, cover_media: { cropped_image_version: { url: `${CDN}/v/cover1.jpg` } } },
          { id: 'highlight:17900000000000002', title: 'Food/Drinks', media_count: 1, created_at: 1680000000, cover_media: { cropped_image_version: { url: `${CDN}/v/cover2.jpg` } } },
        ],
        status: 'ok',
      });
    }
    if (p === '/api/v1/feed/reels_media/') {
      const ids = url.searchParams.getAll('reel_ids');
      const reelsMedia = ids.map((id) => (id === USER_ID
        ? { id: USER_ID, user, items: storyItems, expiring_at: 1700136400 }
        : { id, title: 'x', user, items: highlightItems[id] || [] }));
      return json({ reels_media: reelsMedia, status: 'ok' });
    }
    if (/^\/api\/v1\/media\/\d+\/comments\/$/.test(p)) {
      return json({ comments: [
        { pk: '1', text: 'First!', created_at: 1700000100, user: { pk: '8', username: 'fan' }, comment_like_count: 2, child_comment_count: 1, preview_child_comments: [{ pk: '2', text: 'reply', created_at: 1700000200, user: { pk: USER_ID, username: USERNAME } }] },
        { pk: '3', text: '=cool, "quoted"', created_at: 1700000300, user: { pk: '9', username: 'fan2' }, child_comment_count: 0 },
      ], has_more_comments: false, status: 'ok' });
    }
    if (/^\/api\/v1\/friendships\/\d+\/(followers|following)\/$/.test(p)) {
      const which = p.includes('followers') ? 'followers' : 'following';
      const maxId = url.searchParams.get('max_id');
      if (which === 'followers' && !maxId) return json({ users: [{ pk: '8', username: 'fan', full_name: 'Fan' }, { pk: '9', username: 'fan2' }], next_max_id: '2', status: 'ok' });
      if (which === 'followers') return json({ users: [{ pk: '10', username: 'fan3' }], status: 'ok' });
      return json({ users: [{ pk: '11', username: 'friend' }, { pk: '12', username: 'brand' }], status: 'ok' });
    }
    const info = p.match(/^\/api\/v1\/media\/(\d+)\/info\/$/);
    if (info) {
      const all = [...posts, ...reels, ...storyItems, ...Object.values(highlightItems).flat()];
      const found = all.find((m) => m.pk === info[1]);
      return found ? json({ items: [found], num_results: 1, status: 'ok' }) : json({ message: 'Media not found', status: 'fail' }, 404);
    }
    if (p === '/api/v1/live/web_info/') return json({ message: 'User is not live', status: 'fail' }, 404);
    if (/^\/api\/v1\/feed\/user\/\d+\/story\/$/.test(p)) return json({ reel: null, broadcast: null, status: 'ok' });
    return json({ message: `unmocked ${p}`, status: 'fail' }, 404);
  }

  async function handleInstagram(route) {
    const req = route.request();
    const url = new URL(req.url());
    requests.push({ method: req.method(), path: url.pathname + url.search, headers: req.headers() });
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/web/') || url.pathname.startsWith('/graphql')) {
      return route.fulfill(api(url, req.method(), req.postData()));
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Instagram</title><script type="application/json">{"require":[["DTSGInitialData",[],{"token":"DTSG"}],["LSD",[],{"token":"LSDTOKEN"}]]}</script></head><body><h1>Mock Instagram ${url.pathname}</h1><script>document.cookie="csrftoken=CSRF123; path=/";document.cookie="ds_user_id=111; path=/";</script>"profile_id":"${USER_ID}"</body></html>`,
    });
  }

  async function handleCdn(route) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.endsWith('.mp4')) return route.fulfill({ status: 200, contentType: 'video/mp4', body: media.mp4 });
    if (p.endsWith('.m4a')) return route.fulfill({ status: 200, contentType: 'audio/mp4', body: media.m4a });
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: media.jpg });
  }

  function cdnBody(pathname) {
    if (pathname.endsWith('.mp4')) return ['video/mp4', media.mp4];
    if (pathname.endsWith('.m4a')) return ['audio/mp4', media.m4a];
    return ['image/jpeg', media.jpg];
  }

  /** node:https request handler serving the same CDN files (for the browser's download manager). */
  function cdnServer(req, res) {
    const [type, body] = cdnBody(new URL(req.url, 'https://x').pathname);
    res.writeHead(200, { 'content-type': type, 'content-length': body.length });
    res.end(body);
  }

  return { handleInstagram, handleCdn, cdnServer, requests, counts: { posts: posts.length, reels: reels.length, stories: storyItems.length, highlights: 3 } };
}
