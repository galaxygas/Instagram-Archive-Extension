// Followers / following lists.
import { personRecord } from '../core/normalize.js';
import * as store from '../core/state.js';

export async function collectFriendships(job, which) {
  const prog = job.progress(which);
  const key = `people/${which}`;
  const list = (prog.cursor ? await store.getValue(job.username, key) : null) || [];
  const seen = new Set(list.map((u) => u.pk));
  let cursor = prog.cursor || null;
  const max = Number(job.opts.filters.maxItems) || 0;
  for (;;) {
    await job.control.checkpoint();
    const data = await job.api.friendships(job.userId, which, cursor);
    for (const u of data?.users || []) {
      const rec = personRecord(u);
      if (seen.has(rec.pk)) continue;
      seen.add(rec.pk);
      list.push(rec);
      job.bump(which, 'found');
      job.bump(which, 'saved');
    }
    cursor = data?.next_max_id ?? null;
    prog.cursor = cursor;
    prog.pages = (prog.pages || 0) + 1;
    await store.putValue(job.username, key, list);
    await job.persist();
    if (!cursor || (max && list.length >= max)) break;
  }
  const expected = which === 'followers' ? job.profile?.follower_count : job.profile?.following_count;
  if (expected && list.length < expected) {
    job.log('warn', `${which}: Instagram returned ${list.length} of ${expected} accounts.`);
  }
  await job.saveJson(job.rel('data', `${which}.json`), list);
}
