// Accounts that liked a post (Instagram returns a limited list, in one page).
import { pkOf } from '../core/ids.js';
import { personRecord } from '../core/normalize.js';

export async function collectLikers(job, item) {
  const data = await job.api.likers(pkOf(item));
  return (data?.users || []).map(personRecord);
}
