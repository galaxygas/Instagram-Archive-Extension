// Shortcode <-> media id conversion.
// Instagram shortcodes are the media id written in base 64 with this alphabet
// (gallery-dl `_ALPHABET`, yt-dlp `_ENCODING_CHARS`). Ids exceed 2^53, so BigInt.
export const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function idFromShortcode(shortcode) {
  let code = String(shortcode);
  // Shortcodes of private posts carry a 28-character suffix that is not part of the id
  // (gallery-dl InstagramRestAPI.media, yt-dlp _id_to_pk).
  if (code.length > 28) code = code.slice(0, -28);
  let id = 0n;
  for (const ch of code) {
    const idx = SHORTCODE_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid shortcode character "${ch}"`);
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

export function shortcodeFromId(id) {
  // Media ids may come as "<pk>_<owner id>"; only the pk is encoded.
  let n = BigInt(String(id).split('_')[0]);
  if (n === 0n) return 'A';
  let out = '';
  while (n > 0n) {
    out = SHORTCODE_ALPHABET[Number(n % 64n)] + out;
    n /= 64n;
  }
  return out;
}

/** "123_456" -> "123" (media.pk), numbers -> strings. */
export function pkOf(media) {
  if (!media) return null;
  if (media.pk !== undefined && media.pk !== null) return String(media.pk);
  if (media.id !== undefined && media.id !== null) return String(media.id).split('_')[0];
  return null;
}
