import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idFromShortcode, shortcodeFromId, pkOf } from '../../extension/archive/core/ids.js';
import { parseDashManifest, bestDash, parseLiveManifest, decodeXml } from '../../extension/archive/core/dash.js';
import { sanitizeSegment, joinPath, renderName, extFromUrl, utcParts } from '../../extension/archive/core/naming.js';
import { bestImage, bestVideo, mediaFiles, audioInfo } from '../../extension/archive/core/media.js';
import { postRecord, profileRecord, isPrivateNotFollowed, hashtags, mentions, storyStickers } from '../../extension/archive/core/normalize.js';
import { classifyResponse, KIND } from '../../extension/archive/core/errors.js';
import { RateLimiter, WINDOW_MAX, WINDOW_MS } from '../../extension/archive/core/ratelimit.js';
import { toCsv, csvCell } from '../../extension/archive/export/csv.js';
import { scriptJson } from '../../extension/archive/export/exports.js';
import { mergeOptions, defaultJobOptions, dateBound } from '../../extension/archive/core/options.js';
import { normalizeUsernameInput, usernameFromUrl } from '../../extension/shared/ext.js';
import { photoPost, videoReel, carouselPost, storyItem, DASH_MANIFEST } from '../fixtures/items.mjs';

test('shortcode <-> id matches gallery-dl test data', () => {
  // gallery-dl test/results/instagram.py: post_id / post_shortcode pairs
  assert.equal(idFromShortcode('BqvsDleB3lV'), '1922949326347663701');
  assert.equal(shortcodeFromId('1922949326347663701'), 'BqvsDleB3lV');
  assert.equal(idFromShortcode('BoHk1haB5tM'), '1875629777499953996');
  assert.equal(shortcodeFromId('1875629777499953996_25025320'), 'BoHk1haB5tM');
  // private-post shortcodes carry a 28-character suffix
  assert.equal(idFromShortcode(`BqvsDleB3lV${'x'.repeat(28)}`), '1922949326347663701');
  assert.throws(() => idFromShortcode('ab$'));
  assert.equal(pkOf({ id: '123_456' }), '123');
});

test('DASH manifest parsing picks largest video and best audio', () => {
  const reps = parseDashManifest(DASH_MANIFEST);
  assert.equal(reps.length, 4);
  assert.equal(reps[0].url, 'https://scontent.cdninstagram.com/v/t66/v1080.mp4?a=1&b=2');
  const best = bestDash({ video_dash_manifest: DASH_MANIFEST, has_audio: true });
  assert.equal(best.video.height, 1920);
  assert.equal(best.audio.bandwidth, 128000);
  assert.equal(bestDash({ video_dash_manifest: '' }), null);
  assert.equal(decodeXml('a&amp;b&#39;c&#x41;'), "a&b'cA");
});

test('live manifest SegmentTemplate parsing', () => {
  const xml = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>
  <AdaptationSet mimeType="video/mp4"><Representation id="v1" mimeType="video/mp4" bandwidth="900000" width="720" height="1280">
  <SegmentTemplate initialization="../init-v1.m4v" media="seg-v1-$Time$.m4v"><SegmentTimeline><S t="1000" d="2000"/><S t="3000" d="2000"/></SegmentTimeline></SegmentTemplate></Representation>
  <Representation id="v2" mimeType="video/mp4" bandwidth="400000"><SegmentTemplate initialization="init-v2.m4v" media="seg-v2-$Time$.m4v"><SegmentTimeline><S t="1000"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet>
  <AdaptationSet mimeType="audio/mp4"><Representation id="a1" mimeType="audio/mp4" bandwidth="96000"><SegmentTemplate initialization="init-a1.m4a" media="seg-a1-$Time$.m4a"><SegmentTimeline><S t="1000"/><S t="3000"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet>
  </Period></MPD>`;
  const m = parseLiveManifest(xml, 'https://instagram.fxyz1-1.fna.fbcdn.net/hvideo-ash/live/dash.mpd?x=1');
  assert.equal(m.video.id, 'v1');
  assert.deepEqual(m.video.times, [1000, 3000]);
  assert.equal(m.video.init, 'https://instagram.fxyz1-1.fna.fbcdn.net/hvideo-ash/init-v1.m4v');
  assert.equal(m.segmentUrl(m.audio, 3000), 'https://instagram.fxyz1-1.fna.fbcdn.net/hvideo-ash/live/seg-a1-3000.m4a');
});

test('file naming', () => {
  assert.equal(sanitizeSegment('a/b:c*d?'), 'a_b_c_d_');
  assert.equal(sanitizeSegment('..hidden.'), 'hidden');
  assert.equal(sanitizeSegment('CON'), '_CON');
  assert.equal(sanitizeSegment(''), '_');
  assert.equal(joinPath('root', '../x', 'posts/a.jpg'), 'root/x/posts/a.jpg');
  assert.deepEqual(utcParts(1700000000), { date: '2023-11-14', time: '22-13-20' });
  assert.equal(renderName('{date}_{shortcode}_{index}', { takenAt: 1700000000, shortcode: 'ABC', index: '' }), '2023-11-14_ABC');
  assert.equal(renderName('{username}-{pk}-{index}', { username: 'u', pk: '1', index: 2 }), 'u-1-2');
  assert.equal(extFromUrl('https://x.cdninstagram.com/a/b.webp?stp=dst-jpg_e35', 'jpg'), 'jpg');
  assert.equal(extFromUrl('https://x.cdninstagram.com/a/b.heic?x', 'jpg'), 'heic');
  assert.equal(extFromUrl('not a url', 'mp4'), 'mp4');
});

test('media selection', () => {
  assert.equal(bestImage(photoPost).width, 1440);
  assert.equal(bestVideo(videoReel).url, 'https://scontent.cdninstagram.com/v/t50/720b.mp4');
  const photo = mediaFiles(photoPost);
  assert.equal(photo.files.length, 1);
  assert.equal(photo.files[0].kind, 'image');
  assert.equal(photo.files[0].ext, 'jpg');
  const reel = mediaFiles(videoReel, { covers: true, maxQuality: true, audio: true });
  assert.deepEqual(reel.files.map((f) => f.kind), ['video', 'cover', 'audio']);
  assert.equal(reel.files[0].dash.video.height, 1920);
  const carousel = mediaFiles(carouselPost);
  assert.deepEqual(carousel.files.map((f) => [f.kind, f.index]), [['image', 1], ['video', 2]]);
  const noVideos = mediaFiles(videoReel, { videos: false });
  assert.deepEqual(noVideos.files.map((f) => f.kind), ['cover']);
  const story = mediaFiles(storyItem, { audio: true });
  assert.deepEqual(story.files.map((f) => f.kind), ['image', 'audio']);
  assert.equal(audioInfo(null), null);
});

test('post and story records', () => {
  const r = postRecord(photoPost, { category: 'posts', username: 'example' });
  assert.equal(r.shortcode, 'BqvsDleB3lV');
  assert.equal(r.url, 'https://www.instagram.com/p/BqvsDleB3lV/');
  assert.deepEqual(r.hashtags, ['#beach', '#travel']);
  assert.deepEqual(r.mentions, ['@friend.one']);
  assert.equal(r.pinned, true);
  assert.equal(r.location.name, 'Venice Beach');
  assert.equal(r.tagged_users[0].username, 'friend.one');
  const reel = postRecord(videoReel, { category: 'reels', username: 'example' });
  assert.equal(reel.url, 'https://www.instagram.com/reel/Cabc123/');
  assert.equal(reel.music.title, 'Song');
  assert.equal(reel.music.url, undefined);
  const c = postRecord(carouselPost, { category: 'posts', username: 'example' });
  assert.equal(c.carousel_count, 2);
  assert.equal(c.coauthors[0].username, 'collab');
  const s = storyStickers(storyItem);
  assert.equal(s.links[0].url, 'https://example.com/a');
  assert.equal(s.polls[0].options[1].count, 1);
  assert.equal(s.mentions[0].username, 'mentioned');
  assert.ok(s.story_quizs, 'unknown sticker types are kept raw');
  assert.deepEqual(hashtags('#a #a #b'), ['#a', '#b']);
  assert.deepEqual(mentions('hi @x and @y.z'), ['@x', '@y.z']);
});

test('profile record merges v1 and web shapes', () => {
  const v1 = {
    pk: '25025320', username: 'example', full_name: 'E', biography: 'bio', follower_count: 10, following_count: 2, media_count: 5,
    is_private: true, friendship_status: { following: false },
    hd_profile_pic_versions: [{ width: 320, url: 'small' }, { width: 1080, url: 'big' }],
    pinned_channels_info: { pinned_channels_list: [{ title: 'Ch', invite_link: 'https://ig.me/j/x', number_of_members: 9 }] },
  };
  const r = profileRecord(v1, null);
  assert.equal(r.profile_pic_url, 'big');
  assert.equal(r.broadcast_channels[0].title, 'Ch');
  assert.equal(isPrivateNotFollowed(v1, null), true);
  const web = { id: '1', username: 'w', edge_followed_by: { count: 7 }, edge_follow: { count: 3 }, is_private: true, followed_by_viewer: true, profile_pic_url_hd: 'hd' };
  const w = profileRecord(null, web);
  assert.equal(w.follower_count, 7);
  assert.equal(w.profile_pic_url, 'hd');
  assert.equal(isPrivateNotFollowed(null, web), false);
});

test('response classification', () => {
  const ok = classifyResponse({ status: 200, url: 'https://www.instagram.com/api/v1/x', redirected: false, text: '{"status":"ok","a":1}' });
  assert.equal(ok.json.a, 1);
  const r429 = classifyResponse({ status: 429, url: '', redirected: false, text: '' });
  assert.equal(r429.error.kind, KIND.RATE_LIMIT);
  const wait = classifyResponse({ status: 400, url: '', redirected: false, text: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' });
  assert.equal(wait.error.kind, KIND.RATE_LIMIT);
  const cp = classifyResponse({ status: 400, url: '', redirected: false, text: '{"message":"checkpoint_required","status":"fail"}' });
  assert.equal(cp.error.kind, KIND.FATAL);
  const fb = classifyResponse({ status: 400, url: '', redirected: false, text: '{"message":"feedback_required","feedback_message":"Try later","status":"fail"}' });
  assert.match(fb.error.message, /Try later/);
  const login = classifyResponse({ status: 200, url: 'https://www.instagram.com/accounts/login/?next=x', redirected: true, text: '<html>' });
  assert.equal(login.error.kind, KIND.FATAL);
  const priv = classifyResponse({ status: 400, url: '', redirected: false, text: '{"message":"Not authorized to view user","status":"fail"}' });
  assert.equal(priv.error.kind, KIND.PRIVATE);
  const html = classifyResponse({ status: 200, url: 'https://www.instagram.com/api/v1/x', redirected: false, text: '<!DOCTYPE html><html>' });
  assert.equal(html.error.kind, KIND.FATAL);
  const textOk = classifyResponse({ status: 200, url: '', redirected: false, text: '<html>profile</html>' }, { expectJson: false });
  assert.equal(textOk.text, '<html>profile</html>');
  assert.equal(classifyResponse({ status: 503, url: '', redirected: false, text: '' }).error.kind, KIND.TRANSIENT);
});

test('rate limiter pacing, window cap and backoff', () => {
  let now = 1_000_000;
  const rl = new RateLimiter({ min: 6, max: 12, now: () => now, random: () => 0.5 });
  assert.equal(rl.nextDelay(), 0);
  rl.mark();
  assert.equal(rl.nextDelay(), 9000);
  now += 4000;
  assert.equal(rl.nextDelay(), 5000);
  assert.equal(rl.backoffDelay(), 60000);
  assert.equal(rl.backoffDelay(), 120000);
  rl.success();
  assert.equal(rl.backoffDelay(), 60000);
  const fast = new RateLimiter({ min: 0, max: 0, now: () => now, random: () => 0 });
  for (let i = 0; i < WINDOW_MAX; i++) fast.mark();
  assert.equal(fast.nextDelay(), WINDOW_MS);
  const nocap = new RateLimiter({ min: 0, max: 0, windowCap: false, now: () => now });
  for (let i = 0; i < WINDOW_MAX; i++) nocap.mark();
  assert.equal(nocap.nextDelay(), 0);
});

test('csv escaping and formula neutralization', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(null), '');
  const out = toCsv([{ a: 1, b: 'x\ny' }], [['A', (r) => r.a], ['B', (r) => r.b]]);
  assert.equal(out, '﻿A,B\r\n1,"x\ny"\r\n');
});

test('viewer data embedding is script-safe', () => {
  const s = scriptJson({ c: '</script><b> ' });
  assert.ok(!s.includes('</script>'));
  assert.ok(!s.includes(' '));
  assert.deepEqual(JSON.parse(s), { c: '</script><b> ' });
});

test('options and usernames', () => {
  const merged = mergeOptions({ media: { maxQuality: true }, unknown: 1 });
  assert.equal(merged.media.maxQuality, true);
  assert.equal(merged.media.images, true);
  assert.equal(merged.unknown, undefined);
  assert.equal(defaultJobOptions().categories.live, false);
  assert.equal(dateBound('2024-01-02'), 1704153600);
  assert.equal(dateBound('2024-01-02', true), 1704239999);
  assert.equal(dateBound('nope'), null);
  assert.equal(normalizeUsernameInput('@NatGeo'), 'natgeo');
  assert.equal(normalizeUsernameInput('https://www.instagram.com/nasa/reels/'), 'nasa');
  assert.equal(normalizeUsernameInput('instagram.com/p/BqvsDleB3lV'), null);
  assert.equal(normalizeUsernameInput('bad name!'), null);
  assert.equal(usernameFromUrl('https://www.instagram.com/stories/someone/123/'), 'someone');
  assert.equal(usernameFromUrl('https://www.instagram.com/explore/'), null);
  assert.equal(usernameFromUrl('https://example.com/nasa'), null);
});
