// Turn an Instagram media item (post, reel, story or highlight item) into the list of
// files to save. Selection rules follow gallery-dl's _parse_post_rest and the
// HOAIAN2/Instagram-Downloader extension (largest candidates, DASH for max quality).
import { bestDash } from './dash.js';
import { pkOf, shortcodeFromId } from './ids.js';
import { extFromUrl } from './naming.js';

const area = (c) => Number(c?.width || 0) * Number(c?.height || 0);

export function bestImage(item) {
  const candidates = item?.image_versions2?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return candidates.reduce((best, c) => (area(c) > area(best) ? c : best), candidates[0]);
}

export function bestVideo(item) {
  const versions = item?.video_versions;
  if (!Array.isArray(versions) || !versions.length) return null;
  // gallery-dl: max(video_versions, key=(width, height, type))
  return versions.reduce((best, v) => {
    const a = [Number(v.width || 0), Number(v.height || 0), Number(v.type || 0)];
    const b = [Number(best.width || 0), Number(best.height || 0), Number(best.type || 0)];
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i] ? v : best;
    }
    return best;
  }, versions[0]);
}

/** Audio track info from music_metadata.music_info or a story music sticker (gallery-dl _extract_audio). */
export function audioInfo(info) {
  const asset = info?.music_asset_info;
  if (!asset?.progressive_download_url) return null;
  const consumption = info.music_consumption_info || asset;
  return {
    id: String(asset.id ?? asset.audio_cluster_id ?? ''),
    url: asset.progressive_download_url,
    title: asset.title ?? null,
    artist: asset.display_artist ?? consumption.display_artist ?? null,
    durationMs: asset.duration_in_ms ?? null,
    coverUrl: asset.cover_artwork_uri ?? null,
  };
}

/**
 * @param {object} post media item
 * @param {{videos?:boolean,images?:boolean,covers?:boolean,maxQuality?:boolean,audio?:boolean}} opts
 * @returns {{files:Array<object>, warnings:string[]}}
 */
export function mediaFiles(post, opts = {}) {
  const { videos = true, images = true, covers = false, maxQuality = false, audio = false } = opts;
  const files = [];
  const warnings = [];
  const children = Array.isArray(post?.carousel_media) && post.carousel_media.length ? post.carousel_media : [post];
  const multi = children.length > 1;

  children.forEach((item, i) => {
    const index = multi ? i + 1 : 1;
    const pk = pkOf(item) || pkOf(post);
    const image = bestImage(item);
    const video = bestVideo(item);
    const takenAt = item.taken_at || post.taken_at;

    if (image && !video) {
      const ow = Number(item.original_width || 0);
      const oh = Number(item.original_height || 0);
      if ((ow && image.width * 1.1 < ow) || (oh && image.height * 1.1 < oh)) {
        warnings.push(`Largest image offered for ${post.code || pk} is ${image.width}x${image.height}, smaller than the original ${ow}x${oh}.`);
      }
    }

    if (video) {
      if (videos) {
        const file = {
          kind: 'video',
          url: video.url,
          ext: extFromUrl(video.url, 'mp4'),
          index,
          pk,
          width: Number(video.width || 0),
          height: Number(video.height || 0),
          takenAt,
        };
        if (maxQuality) {
          const dash = bestDash(item);
          if (dash && dash.video.width * dash.video.height > file.width * file.height) file.dash = dash;
        }
        files.push(file);
      }
      if (image && (covers || !videos)) {
        files.push({ kind: 'cover', url: image.url, ext: extFromUrl(image.url, 'jpg'), index, pk, width: image.width, height: image.height, takenAt, suffix: 'cover' });
      }
    } else if (image && images) {
      files.push({ kind: 'image', url: image.url, ext: extFromUrl(image.url, 'jpg'), index, pk, width: image.width, height: image.height, takenAt });
    } else if (!image) {
      warnings.push(`No media found in ${post.code || pk} item ${index}.`);
    }

    if (audio && Array.isArray(item.story_music_stickers) && item.story_music_stickers[0]) {
      const a = audioInfo(item.story_music_stickers[0]);
      if (a) files.push({ kind: 'audio', url: a.url, ext: extFromUrl(a.url, 'm4a'), index, pk, takenAt, suffix: 'audio', audio: a });
    }
  });

  if (audio) {
    const a = audioInfo(post?.music_metadata?.music_info) || audioInfo(post?.clips_metadata?.music_info);
    if (a) files.push({ kind: 'audio', url: a.url, ext: extFromUrl(a.url, 'm4a'), index: 1, pk: pkOf(post), takenAt: post.taken_at, suffix: 'audio', audio: a });
  }
  return { files, warnings };
}

export function shortcodeOf(item) {
  if (item?.code) return item.code;
  const pk = pkOf(item);
  try { return pk ? shortcodeFromId(pk) : ''; } catch { return ''; }
}
