// File and folder naming. downloads.download rejects absolute paths, ".." and
// components that start or end with "." (MDN downloads.download); Windows also
// forbids <>:"/\|?* and reserved device names.

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function sanitizeSegment(name, maxLength = 100) {
  let s = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*​-‏‪-‮⁦-⁩]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/[.\s]+$/g, '');
  if (!s) s = '_';
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

export function joinPath(...parts) {
  return parts
    .flatMap((p) => String(p ?? '').split('/'))
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => sanitizeSegment(p, 120))
    .join('/');
}

const pad = (n) => String(n).padStart(2, '0');

/** Unix seconds -> {date:'YYYY-MM-DD', time:'HH-MM-SS'} in UTC. */
export function utcParts(ts) {
  const d = new Date(Number(ts) * 1000);
  if (!Number.isFinite(d.getTime()) || !ts) return { date: 'undated', time: '00-00-00' };
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`,
  };
}

export const TEMPLATE_TOKENS = ['{date}', '{time}', '{shortcode}', '{pk}', '{index}', '{username}', '{type}', '{caption}'];

/**
 * Render a filename (without extension).
 * @param {string} template e.g. "{date}_{shortcode}_{index}"
 */
export function renderName(template, values) {
  const { date, time } = utcParts(values.takenAt);
  const caption = String(values.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const map = {
    date,
    time,
    shortcode: values.shortcode ?? '',
    pk: values.pk ?? '',
    index: values.index ?? '',
    username: values.username ?? '',
    type: values.type ?? '',
    caption,
  };
  let out = String(template || '{date}_{shortcode}_{index}').replace(/\{(\w+)\}/g, (m, k) => (k in map ? String(map[k]) : m));
  out = out.replace(/_+/g, '_').replace(/^[_\-\s]+|[_\-\s]+$/g, '');
  return sanitizeSegment(out || values.pk || 'item', 150);
}

/** File extension from a CDN URL; Instagram serves e.g. .jpg, .webp, .heic, .mp4, .m4a. */
export function extFromUrl(url, fallback) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-z0-9]{2,5})$/i);
    let ext = m ? m[1].toLowerCase() : fallback;
    // gallery-dl: .webp URLs with "stp=dst-jpg" are served as JPEG.
    if (ext === 'webp' && url.includes('stp=dst-jpg')) ext = 'jpg';
    return ext || fallback;
  } catch {
    return fallback;
  }
}
