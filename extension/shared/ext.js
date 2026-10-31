// One handle for the WebExtension API in Chrome and Firefox.
// Firefox exposes `browser`; Chrome exposes `chrome` (MV3 APIs return promises).
export const ext = globalThis.browser ?? globalThis.chrome;

export const IG_ORIGIN = 'https://www.instagram.com';
export const IG_TAB_PATTERN = 'https://www.instagram.com/*';
export const HOST_ORIGINS = [
  'https://www.instagram.com/*',
  'https://*.cdninstagram.com/*',
  'https://*.fbcdn.net/*',
];

export const isFirefox = typeof globalThis.browser !== 'undefined' &&
  typeof globalThis.browser.runtime?.getBrowserInfo === 'function';

/** Usernames that are Instagram routes, not profiles. */
const RESERVED_PATHS = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal',
  'developer', 'web', 'api', 'graphql', 'challenge', 'emails', 'session', 'privacy', 'terms',
  'static', 'press', 'topics', 'directory', 'lite', 'ar', 'threads', 'oauth', 'nametag',
  'invites', 'qr', 'your_activity', 'meta-verified', 'popular', 'sw.js',
]);

/** Instagram usernames: letters, numbers, periods and underscores, up to 30 characters. */
export const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/** Extract a profile username from an instagram.com URL, or null. */
export function usernameFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  let candidate = parts[0];
  // /stories/<username>/<id>/ points at a user's story
  if (candidate === 'stories' && parts[1] && parts[1] !== 'highlights') candidate = parts[1];
  if (RESERVED_PATHS.has(candidate.toLowerCase())) return null;
  return USERNAME_RE.test(candidate) ? candidate.toLowerCase() : null;
}

/** Normalize user input ("@name", profile URL, or bare name) to a username, or null. */
export function normalizeUsernameInput(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (/instagram\.com/i.test(v)) {
    return usernameFromUrl(v.startsWith('http') ? v : `https://${v}`);
  }
  const name = v.replace(/^@/, '');
  return USERNAME_RE.test(name) ? name.toLowerCase() : null;
}
