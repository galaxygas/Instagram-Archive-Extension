// Highlights: the tray (titles, covers) and every item of every highlight.
import { extFromUrl, sanitizeSegment } from '../core/naming.js';
import * as store from '../core/state.js';

/** First image URL inside a cover_media object (its exact shape is not documented). */
export function coverUrl(cover) {
  if (!cover || typeof cover !== 'object') return null;
  const known = cover.cropped_image_version?.url || cover.full_image_version?.url;
  if (known) return known;
  const stack = [cover];
  while (stack.length) {
    const cur = stack.pop();
    for (const [k, v] of Object.entries(cur)) {
      if (k === 'url' && typeof v === 'string' && /^https:\/\//.test(v)) return v;
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

export async function collectHighlights(job) {
  const prog = job.progress('highlights');
  prog.doneIds = prog.doneIds || [];
  const tray = await job.api.highlightsTray(job.userId);
  const trayRec = tray.map((h) => ({
    id: String(h.id),
    pk: String(h.id).split(':').pop(),
    title: h.title ?? '',
    media_count: h.media_count ?? null,
    created_at: h.created_at ?? null,
    latest_reel_media: h.latest_reel_media ?? null,
    is_pinned_highlight: h.is_pinned_highlight ?? null,
    cover_url: coverUrl(h.cover_media),
  }));
  trayRec.forEach((h) => { h.dir = job.rel('highlights', `${sanitizeSegment(h.title || 'Highlight', 60)}_${h.pk}`); });
  await store.putValue(job.username, 'highlights', trayRec);
  await job.saveJson(job.rel('highlights', 'highlights.json'), { highlights: trayRec, raw: tray });
  job.log('info', `Highlights: ${tray.length} found.`);

  const pending = trayRec.filter((h) => !prog.doneIds.includes(h.id));
  // gallery-dl requests highlight items five reels at a time.
  for (let i = 0; i < pending.length; i += 5) {
    await job.control.checkpoint();
    const chunk = pending.slice(i, i + 5);
    const reels = await job.api.reelsMedia(chunk.map((h) => h.id));
    for (const meta of chunk) {
      const reel = reels.find((r) => String(r.id) === meta.id);
      if (!reel) {
        job.log('warn', `Highlight "${meta.title}" returned no items.`);
        continue;
      }
      if (meta.cover_url) {
        try {
          const path = job.rel(meta.dir, `_cover.${extFromUrl(meta.cover_url, 'jpg')}`);
          await job.saveUrl(path, meta.cover_url);
          meta.cover_file = path;
        } catch (error) {
          if (error?.name === 'CancelledError') throw error;
          job.log('warn', `Cover of "${meta.title}" not saved: ${error.message}`);
        }
      }
      const tasks = (reel.items || []).map((item) => job.processItem(item, 'highlights', {
        dir: meta.dir,
        extra: { highlight_id: meta.id, highlight_title: meta.title },
      }));
      await Promise.all(tasks);
      prog.doneIds.push(meta.id);
      await store.putValue(job.username, 'highlights', trayRec);
      await job.persist();
    }
  }
}
