// DASH manifest helpers (video_dash_manifest of posts/reels, and live MPDs).
// Instagram's MPDs are small and regular; a tolerant regex parser keeps this module
// usable both in the browser and in Node tests (Node has no DOMParser).

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

export function decodeXml(s) {
  return String(s ?? '').replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, _n, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[m.toLowerCase()] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = decodeXml(m[3] ?? m[4] ?? '');
  return out;
}

/** Elements named `name` (namespace prefixes ignored), with attributes and inner XML. */
function elements(xml, name) {
  const out = [];
  const re = new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: attrs(m[1]), inner: m[2] ?? '' });
  return out;
}

/** Parse a progressive-download MPD (each Representation has a BaseURL). */
export function parseDashManifest(manifest) {
  if (!manifest || typeof manifest !== 'string') return [];
  const reps = [];
  for (const set of elements(manifest, 'AdaptationSet')) {
    for (const rep of elements(set.inner, 'Representation')) {
      const base = elements(rep.inner, 'BaseURL')[0];
      const url = base ? decodeXml(base.inner.trim()) : '';
      if (!url) continue;
      const a = { ...set.attrs, ...rep.attrs };
      reps.push({
        id: a.id || '',
        url,
        mimeType: a.mimeType || (a.contentType ? `${a.contentType}/mp4` : ''),
        codecs: a.codecs || '',
        width: Number(a.width || 0),
        height: Number(a.height || 0),
        bandwidth: Number(a.bandwidth || a.FBAvgBitrate || 0),
        contentLength: Number(a.FBContentLength || 0),
        qualityLabel: a.FBQualityLabel || '',
      });
    }
  }
  return reps;
}

export function selectBest(reps, type) {
  const list = reps.filter((r) => r.mimeType.startsWith(`${type}/`));
  list.sort((a, b) => {
    if (type === 'video') {
      const px = b.width * b.height - a.width * a.height;
      if (px) return px;
    }
    return b.bandwidth - a.bandwidth || b.contentLength - a.contentLength;
  });
  return list[0] || null;
}

/** Highest quality video + audio tracks from an item's video_dash_manifest, or null. */
export function bestDash(item) {
  const reps = parseDashManifest(item?.video_dash_manifest);
  const video = selectBest(reps, 'video');
  if (!video) return null;
  const audio = selectBest(reps, 'audio');
  if (item?.has_audio === true && !audio) return null;
  return { video, audio };
}

/**
 * Parse a live MPD that uses SegmentTemplate + SegmentTimeline ($Time$ addressing),
 * as instarec does. Returns the best video and audio representations.
 */
export function parseLiveManifest(xml, mpdUrl) {
  const base = mpdUrl ? mpdUrl.replace(/[^/]*$/, '') : '';
  const resolve = (u) => (u ? new URL(u, base || undefined).href : '');
  const reps = [];
  for (const set of elements(xml, 'AdaptationSet')) {
    for (const rep of elements(set.inner, 'Representation')) {
      const a = { ...set.attrs, ...rep.attrs };
      const tpl = elements(rep.inner, 'SegmentTemplate')[0] || elements(set.inner, 'SegmentTemplate')[0];
      if (!tpl) continue;
      const times = elements(tpl.inner, 'S').map((s) => Number(s.attrs.t)).filter((t) => Number.isFinite(t));
      reps.push({
        id: a.id || '',
        mimeType: a.mimeType || '',
        codecs: a.codecs || '',
        width: Number(a.width || 0),
        height: Number(a.height || 0),
        bandwidth: Number(a.bandwidth || 0),
        init: tpl.attrs.initialization ? resolve(tpl.attrs.initialization) : '',
        media: tpl.attrs.media || '',
        times,
      });
    }
  }
  const pick = (type) => reps.filter((r) => r.mimeType === `${type}/mp4`).sort((a, b) => b.bandwidth - a.bandwidth)[0] || null;
  return {
    video: pick('video'),
    audio: pick('audio'),
    segmentUrl: (rep, t) => resolve(rep.media.replace('$Time$', String(t))),
  };
}
