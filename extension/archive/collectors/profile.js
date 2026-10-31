// Profile information and HD profile picture.
import { KIND } from '../core/errors.js';
import { extFromUrl, utcParts } from '../core/naming.js';
import { isPrivateNotFollowed, profileRecord } from '../core/normalize.js';
import * as store from '../core/state.js';

const passThrough = (e) => e?.name === 'CancelledError' || e?.kind === KIND.FATAL;

export async function collectProfile(job, { saveFiles }) {
  let v1 = null;
  let web = null;
  try {
    v1 = await job.api.userInfo(job.userId);
  } catch (error) {
    if (passThrough(error)) throw error;
    job.log('warn', `users/{id}/info failed: ${error.message}`);
  }
  if (saveFiles || !v1) {
    try {
      web = await job.api.webProfileInfo(job.username);
    } catch (error) {
      if (passThrough(error)) throw error;
      job.log(v1 ? 'debug' : 'warn', `web_profile_info failed: ${error.message}`);
    }
  }
  if (!v1 && !web) throw new Error('Instagram did not return any profile information.');

  const rec = profileRecord(v1, web);
  job.profile = rec;
  let viewerId = null;
  try {
    viewerId = (await job.bridge.pageInfo())?.viewerId || null;
  } catch {
    viewerId = null;
  }
  const own = viewerId && String(viewerId) === String(job.userId);
  job.viewerCanSee = own || !isPrivateNotFollowed(v1, web);
  if (!job.viewerCanSee) {
    job.log('warn', `@${job.username} is private and you do not follow it. Only public profile information can be saved.`);
  }
  job.hooks.profile?.(rec);
  await store.putValue(job.username, 'profile', rec);
  if (!saveFiles) return;

  job.bump('profile', 'found');
  const { date } = utcParts(Date.now() / 1000);
  if (rec.profile_pic_url) {
    const path = job.rel('profile', `profile_picture_${date}.${extFromUrl(rec.profile_pic_url, 'jpg')}`);
    try {
      await job.saveUrl(path, rec.profile_pic_url);
      rec.profile_pic_file = path;
      job.bump('profile', 'files');
    } catch (error) {
      if (error?.name === 'CancelledError') throw error;
      job.log('warn', `Profile picture not saved: ${error.message}`);
    }
  }
  await job.saveJson(job.rel('profile', 'profile.json'), rec);
  // Everything Instagram returned, unmodified.
  await job.saveJson(job.rel('profile', `profile_raw_${date}.json`), { user_info: v1, web_profile_info: web });
  job.bump('profile', 'files', 2);
  await store.putValue(job.username, 'profile', rec);
  job.bump('profile', 'saved');
}
