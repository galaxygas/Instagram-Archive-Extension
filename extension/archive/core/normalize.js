// Compact, documented records for exports and the offline viewer. The raw API data
// is saved separately (when enabled) so nothing Instagram returned is lost.
import { pkOf } from './ids.js';
import { audioInfo } from './media.js';

const iso = (ts) => (ts ? new Date(Number(ts) * 1000).toISOString() : null);
const userShort = (u) => (u ? {
  pk: String(u.pk ?? u.pk_id ?? u.id ?? ''),
  username: u.username ?? null,
  full_name: u.full_name ?? null,
  is_verified: u.is_verified ?? null,
  is_private: u.is_private ?? null,
} : null);

export function hashtags(text) {
  return [...new Set(String(text ?? '').match(/#[\p{L}\p{N}_]+/gu) || [])];
}
export function mentions(text) {
  return [...new Set(String(text ?? '').match(/@[A-Za-z0-9._]{1,30}/g) || [])];
}

function location(loc) {
  if (!loc) return null;
  return {
    pk: String(loc.pk ?? loc.id ?? ''),
    name: loc.name ?? null,
    short_name: loc.short_name ?? null,
    address: loc.address ?? null,
    city: loc.city ?? null,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
  };
}

function taggedUsers(item) {
  const out = [];
  for (const t of item?.usertags?.in || []) {
    out.push({ ...userShort(t.user), position: t.position ?? null });
  }
  return out;
}

export function storyStickers(item) {
  const s = {};
  if (item.reel_mentions?.length) s.mentions = item.reel_mentions.map((m) => userShort(m.user));
  if (item.story_hashtags?.length) s.hashtags = item.story_hashtags.map((h) => h.hashtag?.name ?? null);
  if (item.story_locations?.length) s.locations = item.story_locations.map((l) => location(l.location));
  if (item.story_link_stickers?.length) {
    s.links = item.story_link_stickers.map((l) => ({
      url: l.story_link?.url ?? null,
      title: l.story_link?.link_title ?? null,
      display_url: l.story_link?.display_url ?? null,
    }));
  }
  if (item.story_polls?.length) {
    s.polls = item.story_polls.map((p) => ({
      question: p.poll_sticker?.question ?? null,
      options: (p.poll_sticker?.tallies || []).map((t) => ({ text: t.text ?? null, count: t.count ?? null })),
    }));
  }
  if (item.story_feed_media?.length) {
    s.shared_posts = item.story_feed_media.map((m) => ({ media_id: m.media_id ?? null, code: m.media_code ?? null }));
  }
  if (item.story_music_stickers?.length) {
    s.music = item.story_music_stickers.map((m) => audioInfo(m)).filter(Boolean).map(({ url, ...rest }) => rest);
  }
  // Any other sticker arrays (CTA, quizzes, sliders, questions, countdowns, ...) are kept raw,
  // since their structure is not documented by any of the reference projects.
  for (const [key, value] of Object.entries(item)) {
    if (/^story_/.test(key) && Array.isArray(value) && value.length && !(key in KNOWN_STICKER_KEYS)) {
      s[key] = value;
    }
  }
  return s;
}
const KNOWN_STICKER_KEYS = {
  story_hashtags: 1, story_locations: 1, story_link_stickers: 1, story_polls: 1,
  story_feed_media: 1, story_music_stickers: 1,
};

export function postRecord(item, { category, username, files = [] }) {
  const caption = item.caption?.text ?? '';
  const pinned = item.timeline_pinned_user_ids || item.clips_tab_pinned_user_ids || [];
  const music = audioInfo(item.music_metadata?.music_info) || audioInfo(item.clips_metadata?.music_info);
  const rec = {
    pk: pkOf(item),
    id: item.id ?? null,
    shortcode: item.code ?? null,
    category,
    url: item.code ? `https://www.instagram.com/${item.product_type === 'clips' ? 'reel' : 'p'}/${item.code}/` : null,
    media_type: item.media_type ?? null,
    product_type: item.product_type ?? null,
    taken_at: item.taken_at ?? null,
    taken_at_iso: iso(item.taken_at),
    owner: userShort(item.user || item.owner),
    caption,
    hashtags: hashtags(caption),
    mentions: mentions(caption),
    like_count: item.like_count ?? null,
    comment_count: item.comment_count ?? null,
    view_count: item.view_count ?? null,
    play_count: item.play_count ?? item.ig_play_count ?? null,
    video_duration: item.video_duration ?? null,
    like_and_view_counts_disabled: item.like_and_view_counts_disabled ?? null,
    comments_disabled: item.comments_disabled ?? null,
    accessibility_caption: item.accessibility_caption ?? null,
    location: location(item.location),
    tagged_users: taggedUsers(item),
    coauthors: (item.coauthor_producers || []).map(userShort),
    sponsor_tags: (item.sponsor_tags || []).map((t) => userShort(t.sponsor ?? t)),
    is_paid_partnership: item.is_paid_partnership ?? null,
    pinned: Array.isArray(pinned) && pinned.length > 0,
    music: music ? (({ url, ...rest }) => rest)(music) : null,
    carousel_count: Array.isArray(item.carousel_media) ? item.carousel_media.length : null,
    children: Array.isArray(item.carousel_media)
      ? item.carousel_media.map((c) => ({
          pk: pkOf(c),
          media_type: c.media_type ?? null,
          accessibility_caption: c.accessibility_caption ?? null,
          tagged_users: taggedUsers(c),
        }))
      : null,
    crossposted_to_facebook: item.has_shared_to_fb ?? null,
    files,
    archived_at: new Date().toISOString(),
    username,
  };
  if (category === 'stories' || category === 'highlights') {
    rec.expiring_at = item.expiring_at ?? null;
    rec.expiring_at_iso = iso(item.expiring_at);
    rec.stickers = storyStickers(item);
    rec.reshared_from = userShort(item.reshared_story_media_author);
    rec.audience = item.audience ?? null;
  }
  return rec;
}

export function commentRecord(c, parentPk = null) {
  return {
    pk: String(c.pk ?? c.id ?? ''),
    parent_pk: parentPk,
    created_at: c.created_at ?? c.created_at_utc ?? null,
    created_at_iso: iso(c.created_at ?? c.created_at_utc),
    user: userShort(c.user),
    text: c.text ?? '',
    like_count: c.comment_like_count ?? c.like_count ?? null,
    reply_count: c.child_comment_count ?? null,
    is_pinned: c.is_pinned ?? null,
    replies: [],
  };
}

export function personRecord(u) {
  return {
    ...userShort(u),
    profile_pic_url: u?.profile_pic_url ?? null,
    has_anonymous_profile_picture: u?.has_anonymous_profile_picture ?? null,
  };
}

const count = (v) => (typeof v === 'number' ? v : v?.count ?? null);

/** Merge /users/{id}/info/ (v1) and web_profile_info (web) into one documented record. */
export function profileRecord(v1 = {}, web = {}) {
  v1 = v1 || {};
  web = web || {};
  const pic = v1.hd_profile_pic_url_info?.url
    || [...(v1.hd_profile_pic_versions || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url
    || web.profile_pic_url_hd || v1.profile_pic_url || web.profile_pic_url || null;
  return {
    pk: String(v1.pk ?? v1.pk_id ?? web.id ?? ''),
    username: v1.username ?? web.username ?? null,
    full_name: v1.full_name ?? web.full_name ?? null,
    biography: v1.biography ?? web.biography ?? '',
    bio_links: v1.bio_links ?? web.bio_links ?? [],
    external_url: v1.external_url ?? web.external_url ?? null,
    category: v1.category ?? web.category_name ?? web.business_category_name ?? null,
    pronouns: v1.pronouns ?? web.pronouns ?? null,
    is_private: v1.is_private ?? web.is_private ?? null,
    is_verified: v1.is_verified ?? web.is_verified ?? null,
    is_business: v1.is_business ?? web.is_business_account ?? null,
    is_professional: web.is_professional_account ?? null,
    account_type: v1.account_type ?? null,
    follower_count: v1.follower_count ?? count(web.edge_followed_by),
    following_count: v1.following_count ?? count(web.edge_follow),
    media_count: v1.media_count ?? count(web.edge_owner_to_timeline_media),
    reels_count: count(web.edge_felix_video_timeline),
    mutual_followers_count: count(web.edge_mutual_followed_by),
    highlight_reel_count: v1.highlight_reel_count ?? web.highlight_reel_count ?? null,
    profile_pic_url: pic,
    contact: {
      public_email: v1.public_email ?? web.business_email ?? null,
      public_phone_country_code: v1.public_phone_country_code ?? null,
      public_phone_number: v1.public_phone_number ?? web.business_phone_number ?? null,
      contact_phone_number: v1.contact_phone_number ?? null,
      business_contact_method: v1.business_contact_method ?? null,
      address_street: v1.address_street ?? null,
      city_name: v1.city_name ?? null,
      zip: v1.zip ?? null,
      latitude: v1.latitude ?? null,
      longitude: v1.longitude ?? null,
    },
    threads_badge: v1.show_text_post_app_badge ? (v1.text_post_app_badge_label ?? true) : null,
    broadcast_channels: (v1.pinned_channels_info?.pinned_channels_list || []).map((ch) => ({
      title: ch.title ?? null,
      invite_link: ch.invite_link ?? null,
      number_of_members: ch.number_of_members ?? null,
    })),
    friendship_status: v1.friendship_status ?? {
      following: web.followed_by_viewer ?? null,
      followed_by: web.follows_viewer ?? null,
      blocking: web.blocked_by_viewer ?? null,
      outgoing_request: web.requested_by_viewer ?? null,
    },
    archived_at: new Date().toISOString(),
  };
}

/** True when the viewer cannot see the account's posts. */
export function isPrivateNotFollowed(v1, web) {
  const isPrivate = v1?.is_private ?? web?.is_private;
  if (!isPrivate) return false;
  const following = v1?.friendship_status?.following ?? web?.followed_by_viewer;
  return following !== true;
}
