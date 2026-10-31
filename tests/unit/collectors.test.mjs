import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectComments } from '../../extension/archive/collectors/comments.js';
import { collectTimeline } from '../../extension/archive/collectors/timeline.js';
import { coverUrl } from '../../extension/archive/collectors/highlights.js';
import { JobControl } from '../../extension/archive/core/control.js';
import { IgError, KIND } from '../../extension/archive/core/errors.js';

function fakeJob(api, opts = {}) {
  const progress = {};
  const stats = {};
  const processed = [];
  return {
    api,
    control: new JobControl(),
    opts: {
      extras: { maxComments: 0, replies: true, ...(opts.extras || {}) },
      filters: { skipExisting: true, stopAtExisting: false, maxItems: 0, ...(opts.filters || {}) },
    },
    username: 'example',
    userId: '42',
    profile: opts.profile || { is_private: false },
    viewerCanSee: opts.viewerCanSee ?? true,
    logs: [],
    log(level, msg) { this.logs.push([level, msg]); },
    hooks: {},
    progress(c) { return (progress[c] ??= { cursor: null, done: false, pages: 0 }); },
    stat(c) { return (stats[c] ??= { found: 0, saved: 0, skipped: 0, failed: 0, files: 0 }); },
    async persist() {},
    filterItem: opts.filterItem || (() => 'ok'),
    async processItem(item, category) {
      processed.push([category, item.pk]);
      return opts.seen?.has(item.pk) ? 'seen' : 'saved';
    },
    processed,
    progressState: progress,
  };
}

test('comments: follows max_id then min_id, dedupes, fetches replies', async () => {
  const calls = [];
  const pages = [
    { comments: [{ pk: 1, text: 'a', child_comment_count: 0 }, { pk: 2, text: 'b', child_comment_count: 3, preview_child_comments: [{ pk: 20 }] }], has_more_comments: true, next_max_id: 'M1' },
    { comments: [{ pk: 2, text: 'b dup' }, { pk: 3, text: 'c', child_comment_count: 1, preview_child_comments: [{ pk: 30, text: 'r' }] }], has_more_comments: false, has_more_headload_comments: true, next_min_id: 'N1' },
    { comments: [{ pk: 4, text: 'd' }], has_more_comments: false },
  ];
  const api = {
    async comments(pk, params) { calls.push(['comments', pk, params]); return pages.shift(); },
    async childComments(pk, cid, params) {
      calls.push(['replies', cid, params]);
      if (!params.minId) return { child_comments: [{ pk: 20 }, { pk: 21 }], has_more_head_child_comments: true, next_min_child_cursor: 'C1' };
      return { child_comments: [{ pk: 22 }], has_more_head_child_comments: false };
    },
  };
  const job = fakeJob(api);
  const res = await collectComments(job, { pk: '99', code: 'X' });
  assert.deepEqual(res.list.map((c) => c.pk), ['1', '2', '3', '4']);
  assert.deepEqual(res.list[1].replies.map((r) => r.pk), ['20', '21', '22']);
  assert.deepEqual(res.list[2].replies.map((r) => r.pk), ['30']);
  assert.equal(res.total, 4 + 3 + 1);
  assert.deepEqual(calls.filter((c) => c[0] === 'comments').map((c) => c[2]), [{}, { maxId: 'M1' }, { minId: 'N1' }]);
});

test('comments: respects max per post', async () => {
  const api = { async comments() { return { comments: [{ pk: 1 }, { pk: 2 }, { pk: 3 }], has_more_comments: true, next_max_id: 'x' }; } };
  const job = fakeJob(api, { extras: { maxComments: 2, replies: false } });
  const res = await collectComments(job, { pk: '1' });
  assert.equal(res.list.length, 2);
});

test('timeline: paginates posts until more_available is false', async () => {
  const cursors = [];
  const api = {
    async feedUser(id, cursor) {
      cursors.push(cursor);
      if (!cursor) return { items: [{ pk: '1' }, { pk: '2' }], more_available: true, next_max_id: 'A' };
      return { items: [{ pk: '3' }], more_available: false, next_max_id: null };
    },
  };
  const job = fakeJob(api);
  await collectTimeline(job, 'posts');
  assert.deepEqual(cursors, [null, 'A']);
  assert.deepEqual(job.processed.map((p) => p[1]), ['1', '2', '3']);
  assert.equal(job.progressState.posts.pages, 2);
});

test('timeline: reels unwrap items[].media and use paging_info', async () => {
  const api = {
    async clipsUser(id, cursor) {
      if (!cursor) return { items: [{ media: { pk: 'r1' } }], paging_info: { more_available: true, max_id: 'B' } };
      return { items: [{ media: { pk: 'r2' } }], paging_info: { more_available: false } };
    },
  };
  const job = fakeJob(api);
  await collectTimeline(job, 'reels');
  assert.deepEqual(job.processed, [['reels', 'r1'], ['reels', 'r2']]);
});

test('timeline: falls back to GraphQL when the REST feed fails on the first page', async () => {
  const api = {
    async feedUser() { throw new IgError(KIND.BAD_RESPONSE, 'bad'); },
    async graphqlPosts(username, after) {
      assert.equal(username, 'example');
      if (!after) return { edges: [{ node: { pk: 'g1' } }], page_info: { has_next_page: true, end_cursor: 'E' } };
      return { edges: [{ node: { pk: 'g2' } }], page_info: { has_next_page: false } };
    },
  };
  const job = fakeJob(api);
  await collectTimeline(job, 'posts');
  assert.deepEqual(job.processed.map((p) => p[1]), ['g1', 'g2']);
  assert.equal(job.progressState.posts.mode, 'gql');
});

test('timeline: fatal errors are not swallowed by the fallback', async () => {
  const api = { async feedUser() { throw new IgError(KIND.FATAL, 'checkpoint'); } };
  await assert.rejects(collectTimeline(fakeJob(api), 'posts'), (e) => e.kind === KIND.FATAL);
});

test('timeline: private + empty first page reports PRIVATE', async () => {
  const api = { async feedUser() { return { items: [], more_available: false }; } };
  const job = fakeJob(api, { profile: { is_private: true }, viewerCanSee: false });
  await assert.rejects(collectTimeline(job, 'posts'), (e) => e.kind === KIND.PRIVATE);
});

test('timeline: update mode stops after three already-archived items', async () => {
  let calls = 0;
  const api = {
    async feedUser() {
      calls += 1;
      return { items: [{ pk: 'n1' }, { pk: 'o1' }, { pk: 'o2' }, { pk: 'o3' }], more_available: true, next_max_id: `C${calls}` };
    },
  };
  const job = fakeJob(api, { filters: { stopAtExisting: true }, seen: new Set(['o1', 'o2', 'o3']) });
  await collectTimeline(job, 'posts');
  assert.equal(calls, 1);
});

test('timeline: filter "stop" ends the feed', async () => {
  const api = { async feedUser() { return { items: [{ pk: '1' }, { pk: '2' }], more_available: true, next_max_id: 'Z' }; } };
  const job = fakeJob(api, { filterItem: (item) => (item.pk === '2' ? 'stop' : 'ok') });
  await collectTimeline(job, 'posts');
  assert.deepEqual(job.processed.map((p) => p[1]), ['1']);
});

test('highlight cover url lookup', () => {
  assert.equal(coverUrl({ cropped_image_version: { url: 'https://a/c.jpg' } }), 'https://a/c.jpg');
  assert.equal(coverUrl({ x: { y: [{ url: 'https://b/d.jpg' }] } }), 'https://b/d.jpg');
  assert.equal(coverUrl(null), null);
});

test('job control: pause blocks, resume continues, cancel throws', async () => {
  const c = new JobControl();
  c.pause();
  let passed = false;
  const p = c.checkpoint().then(() => { passed = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(passed, false);
  c.resume();
  await p;
  assert.equal(passed, true);
  c.cancel();
  await assert.rejects(c.checkpoint(), (e) => e.name === 'CancelledError');
  await assert.rejects(c.sleep(1000), (e) => e.name === 'CancelledError');
});
