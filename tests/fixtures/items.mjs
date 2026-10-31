// Synthetic Instagram items. Field names follow the REST responses as parsed by
// gallery-dl 1.32.18 (_parse_post_rest), instagrapi 3.2.2 (extract_media_v1,
// extract_story_v1) and yt-dlp; values are made up.

export const DASH_MANIFEST = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period>
<AdaptationSet contentType="video" mimeType="video/mp4">
<Representation id="1" codecs="vp09.00.31.08" width="1080" height="1920" bandwidth="2500000" FBQualityLabel="1080p"><BaseURL>https://scontent.cdninstagram.com/v/t66/v1080.mp4?a=1&amp;b=2</BaseURL></Representation>
<Representation id="2" codecs="avc1.4d401f" width="720" height="1280" bandwidth="1500000" FBQualityLabel="720p"><BaseURL>https://scontent.cdninstagram.com/v/t66/v720.mp4</BaseURL></Representation>
</AdaptationSet>
<AdaptationSet contentType="audio" mimeType="audio/mp4">
<Representation id="3" codecs="mp4a.40.5" bandwidth="64000"><BaseURL>https://scontent.cdninstagram.com/v/t66/a64.mp4</BaseURL></Representation>
<Representation id="4" codecs="mp4a.40.2" bandwidth="128000"><BaseURL>https://scontent.cdninstagram.com/v/t66/a128.mp4</BaseURL></Representation>
</AdaptationSet></Period></MPD>`;

const user = { pk: '25025320', username: 'example', full_name: 'Example Account', is_verified: true, is_private: false };

export const photoPost = {
  pk: '1922949326347663701',
  id: '1922949326347663701_25025320',
  code: 'BqvsDleB3lV',
  taken_at: 1700000000,
  media_type: 1,
  product_type: 'feed',
  user,
  caption: { text: 'Sunset #beach #travel with @friend.one' },
  like_count: 120,
  comment_count: 4,
  accessibility_caption: 'Photo of a beach',
  location: { pk: 123, name: 'Venice Beach', short_name: 'Venice', lat: 33.98, lng: -118.47 },
  usertags: { in: [{ user: { pk: '1', username: 'friend.one', full_name: 'Friend' }, position: [0.5, 0.5] }] },
  timeline_pinned_user_ids: [25025320],
  original_width: 1440,
  original_height: 1800,
  image_versions2: {
    candidates: [
      { width: 640, height: 800, url: 'https://scontent.cdninstagram.com/v/t51/small.jpg?stp=dst-jpg' },
      { width: 1440, height: 1800, url: 'https://scontent.cdninstagram.com/v/t51/large.jpg?x=1' },
      { width: 1080, height: 1350, url: 'https://scontent.cdninstagram.com/v/t51/mid.webp?stp=dst-jpg_e35' },
    ],
  },
};

export const videoReel = {
  pk: '3000000000000000001',
  code: 'Cabc123',
  taken_at: 1710000000,
  media_type: 2,
  product_type: 'clips',
  user,
  caption: null,
  play_count: 5000,
  has_audio: true,
  video_duration: 12.5,
  image_versions2: { candidates: [{ width: 720, height: 1280, url: 'https://scontent.cdninstagram.com/v/t51/cover.jpg' }] },
  video_versions: [
    { type: 101, width: 720, height: 1280, url: 'https://scontent.cdninstagram.com/v/t50/720.mp4' },
    { type: 102, width: 480, height: 854, url: 'https://scontent.cdninstagram.com/v/t50/480.mp4' },
    { type: 103, width: 720, height: 1280, url: 'https://scontent.cdninstagram.com/v/t50/720b.mp4' },
  ],
  video_dash_manifest: DASH_MANIFEST,
  clips_tab_pinned_user_ids: [],
  music_metadata: {
    music_info: {
      music_asset_info: {
        id: '777', title: 'Song', display_artist: 'Artist', duration_in_ms: 30000,
        progressive_download_url: 'https://scontent.cdninstagram.com/v/t39/song.m4a',
        cover_artwork_uri: 'https://scontent.cdninstagram.com/v/t39/art.jpg',
      },
    },
  },
};

export const carouselPost = {
  pk: '1875629777499953996',
  code: 'BoHk1haB5tM',
  taken_at: 1690000000,
  media_type: 8,
  product_type: 'carousel_container',
  user,
  caption: { text: 'Two things' },
  coauthor_producers: [{ pk: '9', username: 'collab', full_name: 'Collab' }],
  carousel_media: [
    { pk: '1875629777499953990', media_type: 1, image_versions2: { candidates: [{ width: 1080, height: 1080, url: 'https://scontent.cdninstagram.com/c1.jpg' }] } },
    {
      pk: '1875629777499953991', media_type: 2,
      image_versions2: { candidates: [{ width: 1080, height: 1080, url: 'https://scontent.cdninstagram.com/c2.jpg' }] },
      video_versions: [{ type: 101, width: 1080, height: 1080, url: 'https://scontent.cdninstagram.com/c2.mp4' }],
    },
  ],
};

export const storyItem = {
  pk: '3100000000000000001',
  taken_at: 1720000000,
  expiring_at: 1720086400,
  media_type: 1,
  user,
  image_versions2: { candidates: [{ width: 1080, height: 1920, url: 'https://scontent.cdninstagram.com/s1.jpg' }] },
  reel_mentions: [{ user: { pk: '5', username: 'mentioned', full_name: 'M' } }],
  story_link_stickers: [{ story_link: { url: 'https://example.com/a', link_title: 'A', display_url: 'example.com' } }],
  story_polls: [{ poll_sticker: { question: 'Yes?', tallies: [{ text: 'Yes', count: 3 }, { text: 'No', count: 1 }] } }],
  story_quizs: [{ quiz_sticker: { question: 'Q' } }],
  story_music_stickers: [{
    music_asset_info: { id: '42', title: 'Track', display_artist: 'Band', progressive_download_url: 'https://scontent.cdninstagram.com/m.m4a' },
  }],
};
