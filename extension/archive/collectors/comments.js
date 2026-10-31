// Comments and replies of a post.
// Pagination follows instagrapi 3.2.2 (mixins/comment.py): continue with max_id while
// has_more_comments, otherwise with min_id while has_more_headload_comments.
import { pkOf } from '../core/ids.js';
import { commentRecord } from '../core/normalize.js';

async function collectReplies(job, mediaPk, comment) {
  const total = Number(comment.child_comment_count || 0);
  const preview = comment.preview_child_comments || [];
  if (!total) return [];
  if (preview.length >= total) return preview.map((r) => commentRecord(r, String(comment.pk)));
  const out = [];
  const seen = new Set();
  let params = {};
  for (let guard = 0; guard < 500; guard++) {
    await job.control.checkpoint();
    const data = await job.api.childComments(mediaPk, comment.pk, params);
    let added = 0;
    for (const r of data?.child_comments || []) {
      const id = String(r.pk);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(commentRecord(r, String(comment.pk)));
      added += 1;
    }
    if (!added) break;
    // head/min_id is instagrapi's documented direction; tail/max_id is followed too
    // when Instagram includes those fields.
    if (data.has_more_head_child_comments && data.next_min_child_cursor) params = { minId: data.next_min_child_cursor };
    else if (data.has_more_tail_child_comments && data.next_max_child_cursor) params = { maxId: data.next_max_child_cursor };
    else break;
  }
  return out;
}

export async function collectComments(job, item) {
  const pk = pkOf(item);
  const max = Number(job.opts.extras.maxComments) || 0;
  const withReplies = job.opts.extras.replies;
  const list = [];
  const seen = new Set();
  let total = 0;
  let params = {};
  for (let guard = 0; guard < 5000; guard++) {
    await job.control.checkpoint();
    const data = await job.api.comments(pk, params);
    let added = 0;
    for (const c of data?.comments || []) {
      const id = String(c.pk);
      if (seen.has(id)) continue;
      seen.add(id);
      const rec = commentRecord(c);
      if (withReplies) {
        try {
          rec.replies = await collectReplies(job, pk, c);
        } catch (error) {
          if (error?.name === 'CancelledError' || error?.kind === 'fatal') throw error;
          job.log('warn', `Replies to a comment on ${item.code || pk} failed: ${error.message}`);
        }
      }
      list.push(rec);
      total += 1 + rec.replies.length;
      added += 1;
      if (max && list.length >= max) break;
    }
    if ((max && list.length >= max) || !added) break;
    if (data.has_more_comments && data.next_max_id) params = { maxId: data.next_max_id };
    else if (data.has_more_headload_comments && data.next_min_id) params = { minId: data.next_min_id };
    else break;
  }
  return { list, total };
}
