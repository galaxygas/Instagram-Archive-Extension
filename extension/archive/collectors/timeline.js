// Posts grid, Reels tab and Tagged tab: paginated feeds of media items.
import { IgError, KIND } from '../core/errors.js';
import { pkOf } from '../core/ids.js';

const SOURCES = {
  posts: {
    rest: async (job, cursor) => {
      const d = await job.api.feedUser(job.userId, cursor);
      return { items: d?.items || [], more: Boolean(d?.more_available), next: d?.next_max_id ?? null };
    },
    gql: async (job, cursor) => {
      const c = await job.api.graphqlPosts(job.username, cursor);
      return { items: (c.edges || []).map((e) => e.node), more: Boolean(c.page_info?.has_next_page), next: c.page_info?.end_cursor ?? null };
    },
  },
  reels: {
    rest: async (job, cursor) => {
      const d = await job.api.clipsUser(job.userId, cursor);
      return {
        items: (d?.items || []).map((i) => i.media || i),
        more: Boolean(d?.paging_info?.more_available),
        next: d?.paging_info?.max_id ?? null,
      };
    },
    gql: async (job, cursor) => {
      const c = await job.api.graphqlReels(job.userId, cursor);
      return {
        items: (c.edges || []).map((e) => e.node?.media || e.node),
        more: Boolean(c.page_info?.has_next_page),
        next: c.page_info?.end_cursor ?? null,
        // instaloader: "Reels post info is incomplete relative to regular posts".
        incomplete: true,
      };
    },
  },
  tagged: {
    rest: async (job, cursor) => {
      const d = await job.api.usertagsFeed(job.userId, cursor);
      return { items: d?.items || [], more: Boolean(d?.more_available), next: d?.next_max_id ?? null };
    },
  },
};

const FALLBACK_ON = new Set([KIND.BAD_RESPONSE, KIND.FORBIDDEN, KIND.NOT_FOUND]);

export async function collectTimeline(job, category) {
  const source = SOURCES[category];
  const prog = job.progress(category);
  let mode = prog.mode || 'rest';
  let cursor = prog.cursor || null;
  let seenStreak = 0;

  for (;;) {
    await job.control.checkpoint();
    let page;
    try {
      page = await source[mode](job, cursor);
    } catch (error) {
      if (mode === 'rest' && source.gql && !prog.pages && FALLBACK_ON.has(error?.kind)) {
        job.log('warn', `${category}: REST endpoint failed (${error.message}); trying the web app's GraphQL query instead.`);
        mode = 'gql';
        prog.mode = 'gql';
        cursor = null;
        continue;
      }
      throw error;
    }

    if (!prog.pages && !page.items.length && job.profile?.is_private && !job.viewerCanSee) {
      throw new IgError(KIND.PRIVATE, 'This account is private and you do not follow it.');
    }

    let stop = false;
    const tasks = [];
    const pinnedFlags = [];
    for (let item of page.items) {
      if (page.incomplete) {
        try {
          item = (await job.api.mediaInfo(pkOf(item))) || item;
        } catch (error) {
          if (error?.name === 'CancelledError' || error?.kind === KIND.FATAL) throw error;
          job.log('warn', `Could not load full details of reel ${item.code || pkOf(item)}: ${error.message}`);
        }
      }
      const verdict = job.filterItem(item, category);
      if (verdict === 'stop') { stop = true; break; }
      if (verdict === 'skip') continue;
      pinnedFlags.push((item.timeline_pinned_user_ids || item.clips_tab_pinned_user_ids || []).length > 0);
      tasks.push(job.processItem(item, category));
    }
    const results = await Promise.all(tasks);

    if (job.opts.filters.stopAtExisting) {
      results.forEach((r, i) => {
        if (pinnedFlags[i]) return;
        seenStreak = r === 'seen' ? seenStreak + 1 : 0;
      });
      if (seenStreak >= 3) {
        job.log('info', `${category}: reached items archived in an earlier run; stopping (update mode).`);
        stop = true;
      }
    }

    prog.pages = (prog.pages || 0) + 1;
    prog.cursor = page.next;
    await job.persist();
    job.hooks.status?.({ state: 'page', category, pages: prog.pages });
    if (stop || !page.more || !page.next) break;
    cursor = page.next;
  }
}
