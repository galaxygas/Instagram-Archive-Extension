// End-of-job exports: JSON data files, CSV tables and the offline HTML viewer.
// They are rebuilt from IndexedDB, so they cover every run of this username.
import { ext } from '../../shared/ext.js';
import * as store from '../core/state.js';
import { COMMENT_COLUMNS, MEDIA_COLUMNS, PEOPLE_COLUMNS, toCsv } from './csv.js';

const MEDIA = ['posts', 'reels', 'tagged', 'stories', 'highlights'];

const byNewest = (a, b) => (b.taken_at || 0) - (a.taken_at || 0);

function flattenComments(list, shortcode) {
  const rows = [];
  for (const c of list || []) {
    rows.push({ ...c, post_shortcode: shortcode });
    for (const r of c.replies || []) rows.push({ ...r, post_shortcode: shortcode });
  }
  return rows;
}

/** JSON for embedding in a <script>, safe against "</script>" in captions. */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

async function template(path) {
  const res = await fetch(ext.runtime.getURL(path));
  return res.text();
}

export async function writeExports(job) {
  const u = job.username;
  const profile = (await store.getValue(u, 'profile')) || job.profile || null;
  const highlights = (await store.getValue(u, 'highlights')) || [];
  const records = {};
  for (const cat of MEDIA) records[cat] = (await store.getRecords(u, cat)).sort(byNewest);
  const all = MEDIA.flatMap((c) => records[c]);

  const comments = {};
  for (const r of all) {
    if (!r.comments_file) continue;
    const list = await store.getValue(u, `comments/${r.pk}`);
    if (list) comments[r.pk] = list;
  }
  const people = {
    followers: (await store.getValue(u, 'people/followers')) || null,
    following: (await store.getValue(u, 'people/following')) || null,
  };

  const info = {
    generator: `Gram Archiver ${ext.runtime.getManifest().version}`,
    generated_at: new Date().toISOString(),
    username: u,
    user_id: job.userId,
    output: job.opts.output.mode,
    options: job.opts,
    stats: job.rec.stats,
    totals: Object.fromEntries(MEDIA.map((c) => [c, records[c].length])),
    warnings: job.rec.warnings.slice(-200),
  };

  if (job.opts.metadata.sidecar || job.opts.metadata.viewer || job.opts.metadata.csv) {
    for (const cat of MEDIA) {
      if (records[cat].length) await job.saveJson(job.rel('data', `${cat}.json`), records[cat]);
    }
    if (Object.keys(comments).length) await job.saveJson(job.rel('data', 'comments.json'), comments);
    await job.saveJson(job.rel('data', 'archive-info.json'), info);
  }

  if (job.opts.metadata.csv) {
    if (all.length) await job.saveText(job.rel('data', 'media.csv'), toCsv(all, MEDIA_COLUMNS), 'text/csv');
    const commentRows = all.flatMap((r) => flattenComments(comments[r.pk], r.shortcode));
    if (commentRows.length) await job.saveText(job.rel('data', 'comments.csv'), toCsv(commentRows, COMMENT_COLUMNS), 'text/csv');
    for (const which of ['followers', 'following']) {
      if (people[which]) await job.saveText(job.rel('data', `${which}.csv`), toCsv(people[which], PEOPLE_COLUMNS), 'text/csv');
    }
  }

  if (job.opts.metadata.viewer) {
    const data = { info, profile, highlights, records, comments, people };
    await job.saveText(job.rel('viewer', 'archive-data.js'), `window.GRAM_ARCHIVE = ${scriptJson(data)};\n`, 'text/javascript');
    await job.saveText(job.rel('viewer', 'viewer.css'), await template('viewer/viewer.css'), 'text/css');
    await job.saveText(job.rel('viewer', 'viewer.js'), await template('viewer/viewer.js'), 'text/javascript');
    const html = (await template('viewer/index.html')).replace(/\{\{USERNAME\}\}/g, u.replace(/[<>&"]/g, ''));
    await job.saveText(job.rel('index.html'), html, 'text/html');
    job.log('info', `Offline viewer: open ${job.settings.rootFolder}/${u}/index.html${job.opts.output.mode === 'zip' ? ' after extracting the ZIP' : ''}.`);
  }
}
