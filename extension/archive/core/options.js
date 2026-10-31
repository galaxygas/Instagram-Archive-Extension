// Job option schema and defaults. Every category and extra is optional.

export const CATEGORY_INFO = [
  { key: 'profile', label: 'Profile info & picture', desc: 'Bio, links, counts, category, contact & business info, broadcast channels, HD profile picture.', default: true },
  { key: 'stories', label: 'Current stories', desc: 'Stories live right now (they expire after 24 h), including sticker data: mentions, links, polls, music, locations.', default: true },
  { key: 'highlights', label: 'Highlights', desc: 'Every highlight with its cover, title and all items.', default: true },
  { key: 'posts', label: 'Posts', desc: 'Every post on the grid: photos, videos and carousels, with captions, location, tags, collaborators, music and counts.', default: true },
  { key: 'reels', label: 'Reels', desc: 'The Reels tab, with plays, audio info and covers.', default: true },
  { key: 'tagged', label: 'Tagged posts', desc: 'Posts other accounts tagged this profile in.', default: false },
  { key: 'live', label: 'Live broadcast (beta)', desc: 'If the account is live right now, record it until it ends or the time limit is reached.', default: false },
  { key: 'followers', label: 'Followers list', desc: 'Usernames of followers. Slow and heavily rate-limited; Instagram may not return the full list.', default: false },
  { key: 'following', label: 'Following list', desc: 'Accounts this profile follows. Slow and heavily rate-limited.', default: false },
];

export const MEDIA_CATEGORIES = ['stories', 'highlights', 'posts', 'reels', 'tagged'];

export function defaultJobOptions() {
  return {
    categories: Object.fromEntries(CATEGORY_INFO.map((c) => [c.key, c.default])),
    media: {
      images: true,
      videos: true,
      covers: false,
      maxQuality: false,
      keepDashTracks: false,
      audio: false,
      hiRes: true,
    },
    extras: {
      comments: false,
      replies: true,
      maxComments: 0,
      likers: false,
    },
    metadata: {
      sidecar: true,
      rawSidecar: false,
      captions: false,
      csv: true,
      viewer: true,
      rawResponses: false,
    },
    filters: {
      from: '',
      to: '',
      maxItems: 0,
      skipExisting: true,
      stopAtExisting: false,
    },
    output: {
      mode: 'folder',
      zipStream: true,
      partSizeMB: 1024,
    },
    live: {
      maxMinutes: 120,
      mux: true,
    },
  };
}

/** Deep-merge saved options onto defaults so new options get defaults. */
export function mergeOptions(saved) {
  const base = defaultJobOptions();
  if (!saved || typeof saved !== 'object') return base;
  for (const [k, v] of Object.entries(base)) {
    if (saved[k] && typeof saved[k] === 'object') base[k] = { ...v, ...saved[k] };
  }
  return base;
}

/** "YYYY-MM-DD" -> unix seconds at 00:00 UTC (from) / 23:59:59 UTC (to). */
export function dateBound(value, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T${end ? '23:59:59' : '00:00:00'}Z`) / 1000;
  return Number.isFinite(t) ? t : null;
}
