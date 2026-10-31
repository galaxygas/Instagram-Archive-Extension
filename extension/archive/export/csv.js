// RFC 4180 CSV with a UTF-8 BOM so spreadsheet apps detect the encoding.

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralize spreadsheet formula injection (cells starting with = + - @).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {Array<object>} rows
 * @param {Array<[string, (row:object)=>any]>} columns header + getter
 */
export function toCsv(rows, columns) {
  const lines = [columns.map(([h]) => csvCell(h)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => csvCell(get(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const MEDIA_COLUMNS = [
  ['category', (r) => r.category],
  ['shortcode', (r) => r.shortcode],
  ['pk', (r) => r.pk],
  ['url', (r) => r.url],
  ['taken_at_utc', (r) => r.taken_at_iso],
  ['product_type', (r) => r.product_type],
  ['media_type', (r) => r.media_type],
  ['pinned', (r) => r.pinned],
  ['caption', (r) => r.caption],
  ['hashtags', (r) => (r.hashtags || []).join(' ')],
  ['mentions', (r) => (r.mentions || []).join(' ')],
  ['like_count', (r) => r.like_count],
  ['comment_count', (r) => r.comment_count],
  ['view_count', (r) => r.view_count],
  ['play_count', (r) => r.play_count],
  ['video_duration', (r) => r.video_duration],
  ['location', (r) => r.location?.name],
  ['location_pk', (r) => r.location?.pk],
  ['tagged_users', (r) => (r.tagged_users || []).map((u) => u.username).join(' ')],
  ['coauthors', (r) => (r.coauthors || []).map((u) => u.username).join(' ')],
  ['music', (r) => (r.music ? [r.music.title, r.music.artist].filter(Boolean).join(' - ') : '')],
  ['accessibility_caption', (r) => r.accessibility_caption],
  ['highlight', (r) => r.highlight_title],
  ['expiring_at_utc', (r) => r.expiring_at_iso],
  ['files', (r) => (r.files || []).map((f) => f.path).join(' | ')],
  ['comments_saved', (r) => r.comments_saved],
];

export const COMMENT_COLUMNS = [
  ['post_shortcode', (r) => r.post_shortcode],
  ['comment_pk', (r) => r.pk],
  ['parent_pk', (r) => r.parent_pk],
  ['created_at_utc', (r) => r.created_at_iso],
  ['username', (r) => r.user?.username],
  ['user_pk', (r) => r.user?.pk],
  ['text', (r) => r.text],
  ['like_count', (r) => r.like_count],
  ['reply_count', (r) => r.reply_count],
];

export const PEOPLE_COLUMNS = [
  ['username', (r) => r.username],
  ['full_name', (r) => r.full_name],
  ['pk', (r) => r.pk],
  ['is_verified', (r) => r.is_verified],
  ['is_private', (r) => r.is_private],
  ['profile_url', (r) => (r.username ? `https://www.instagram.com/${r.username}/` : '')],
];
