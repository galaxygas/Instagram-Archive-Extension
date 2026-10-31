// Instagram web API client. Every request goes through the content-script bridge
// (same-origin, user's own session) and the shared rate limiter.
//
// Endpoint sources (checked 2026-10): gallery-dl 1.32.18 extractor/instagram.py
// (InstagramRestAPI), instaloader 4.16 structures.py / instaloadercontext.py,
// yt-dlp 2026.10.26 extractor/instagram.py, instagrapi 3.2.2, instarec 1.8.0.
import { classifyResponse, IgError, KIND } from './errors.js';

/**
 * GraphQL document ids used by the Instagram web app. They rotate when Instagram ships a
 * new web build, so they are only used as fallbacks for the REST endpoints.
 * Source: instaloader 4.16 structures.py (Profile.get_posts, get_reels).
 */
export const GRAPHQL_DOCS = Object.freeze({
  profilePosts: {
    docId: '29104886249145907',
    friendlyName: 'PolarisProfilePostsTabContentQuery_connection',
    connection: 'xdt_api__v1__feed__user_timeline_graphql_connection',
    // "It must be sent to the web app's api/graphql endpoint" (instaloader 4.16).
    endpoint: '/api/graphql',
  },
  profileReels: {
    docId: '7845543455542541',
    friendlyName: 'PolarisProfileReelsTabContentQuery_connection',
    connection: 'xdt_api__v1__clips__user__connection_v2',
    // instaloader sends this query to graphql/query rather than api/graphql.
    endpoint: '/graphql/query',
  },
});

const MAX_RATE_LIMIT_RETRIES = 6;
const MAX_TRANSIENT_RETRIES = 4;

export class InstagramApi {
  /**
   * @param {object} deps
   * @param {import('./bridge-client.js').Bridge} deps.bridge
   * @param {import('./ratelimit.js').RateLimiter} deps.limiter
   * @param {import('./control.js').JobControl} deps.control
   * @param {(level:string,msg:string)=>void} [deps.log]
   * @param {(info:object)=>void} [deps.onStatus]
   * @param {(path:string,json:any)=>void} [deps.onRaw]
   */
  constructor({ bridge, limiter, control, log = () => {}, onStatus = () => {}, onRaw = null, hiRes = true }) {
    this.bridge = bridge;
    this.hiRes = hiRes;
    this.limiter = limiter;
    this.control = control;
    this.log = log;
    this.onStatus = onStatus;
    this.onRaw = onRaw;
    this.tokens = null;
    this.queue = Promise.resolve();
  }

  /** Requests are strictly sequential so the pacing applies to every call. */
  call(path, opts = {}) {
    const run = this.queue.then(() => this.callNow(path, opts));
    this.queue = run.catch(() => {});
    return run;
  }

  async callNow(path, { query, form, method, kind = 'api', expectJson = true, label = path, lsd, friendlyName } = {}) {
    let rateLimitHits = 0;
    let transientHits = 0;
    for (;;) {
      await this.control.checkpoint();
      const wait = this.limiter.nextDelay();
      if (wait > 0) {
        this.onStatus({ state: 'waiting', ms: wait, label });
        await this.control.sleep(wait);
        await this.control.checkpoint();
      }
      this.onStatus({ state: 'request', label });
      this.limiter.mark();

      let res;
      try {
        res = await this.bridge.request({ url: path, query, form, method, kind, lsd, friendlyName, hiRes: this.hiRes });
      } catch (error) {
        if (error?.name === 'CancelledError') throw error;
        transientHits += 1;
        if (transientHits > MAX_TRANSIENT_RETRIES) throw error;
        const ms = 5000 * transientHits;
        this.log('warn', `${error.message} Retrying in ${ms / 1000} s.`);
        await this.control.sleep(ms);
        continue;
      }

      const result = classifyResponse(res, { expectJson });
      if (!result.error) {
        this.limiter.success();
        if (this.onRaw && expectJson) this.onRaw(label, result.json);
        return expectJson ? result.json : result.text;
      }

      const err = result.error;
      if (err.kind === KIND.RATE_LIMIT) {
        rateLimitHits += 1;
        if (rateLimitHits > MAX_RATE_LIMIT_RETRIES) {
          throw new IgError(KIND.FATAL, 'Instagram kept rate-limiting requests. The job was paused at a resume point; try again later.', { reason: 'rate_limit' });
        }
        const ms = this.limiter.backoffDelay();
        this.log('warn', `Rate limited by Instagram (${err.message}). Waiting ${Math.round(ms / 1000)} s before retrying.`);
        this.onStatus({ state: 'backoff', ms, label });
        await this.control.sleep(ms);
        continue;
      }
      if (err.kind === KIND.TRANSIENT) {
        transientHits += 1;
        if (transientHits <= MAX_TRANSIENT_RETRIES) {
          const ms = 10000 * transientHits;
          this.log('warn', `${err.message} Retrying in ${ms / 1000} s.`);
          await this.control.sleep(ms);
          continue;
        }
      }
      err.label = label;
      throw err;
    }
  }

  // ---- user ------------------------------------------------------------------------

  /** Resolve a username to a user id, using gallery-dl's default order: search, then web page, then web_profile_info. */
  async resolveUserId(username) {
    const name = username.toLowerCase();
    const attempts = [
      ['search', async () => {
        const data = await this.call('/web/search/topsearch/', { query: { query: username }, label: 'topsearch' });
        const hit = (data?.users || []).map((u) => u.user).find((u) => String(u?.username).toLowerCase() === name);
        const id = hit && (hit.pk ?? hit.pk_id ?? hit.id);
        return id ? String(id) : null;
      }],
      ['web page', async () => {
        const html = await this.call(`/${encodeURIComponent(username)}/`, { kind: 'html', expectJson: false, label: 'profile page' });
        const m = String(html).match(/"profile_id":"(\d+)"/);
        return m ? m[1] : null;
      }],
      ['web_profile_info', async () => {
        const data = await this.webProfileInfo(username);
        return data?.id ? String(data.id) : null;
      }],
    ];
    for (const [strategy, fn] of attempts) {
      try {
        const id = await fn();
        if (id) return id;
        this.log('debug', `User lookup via ${strategy} found nothing.`);
      } catch (error) {
        if (error?.name === 'CancelledError' || error?.kind === KIND.FATAL) throw error;
        this.log('debug', `User lookup via ${strategy} failed: ${error.message}`);
      }
    }
    throw new IgError(KIND.NOT_FOUND, `Could not find the Instagram account "${username}".`);
  }

  async userInfo(userId) {
    const data = await this.call(`/api/v1/users/${userId}/info/`, { label: 'user info' });
    return data?.user ?? null;
  }

  async webProfileInfo(username) {
    const data = await this.call('/api/v1/users/web_profile_info/', { query: { username }, label: 'web_profile_info' });
    return data?.data?.user ?? null;
  }

  // ---- timelines ----------------------------------------------------------------------

  feedUser(userId, maxId) {
    return this.call(`/api/v1/feed/user/${userId}/`, { query: { count: 30, max_id: maxId }, label: 'posts page' });
  }

  clipsUser(userId, maxId) {
    return this.call('/api/v1/clips/user/', {
      method: 'POST',
      form: { target_user_id: userId, page_size: 50, max_id: maxId ?? null, include_feed_video: 'true' },
      label: 'reels page',
    });
  }

  usertagsFeed(userId, maxId) {
    return this.call(`/api/v1/usertags/${userId}/feed/`, { query: { count: 20, max_id: maxId }, label: 'tagged page' });
  }

  async mediaInfo(pk) {
    const data = await this.call(`/api/v1/media/${pk}/info/`, { label: 'media info' });
    return data?.items?.[0] ?? null;
  }

  // ---- stories / highlights / live --------------------------------------------------

  async highlightsTray(userId) {
    const data = await this.call(`/api/v1/highlights/${userId}/highlights_tray/`, { label: 'highlights list' });
    return data?.tray ?? [];
  }

  /** Returns an array of reels (stories or highlights) with their items. */
  async reelsMedia(reelIds) {
    const data = await this.call('/api/v1/feed/reels_media/', { query: { reel_ids: reelIds }, label: 'reels media' });
    if (Array.isArray(data?.reels_media)) return data.reels_media;
    if (data?.reels && typeof data.reels === 'object') return Object.values(data.reels);
    return [];
  }

  async userStory(userId) {
    const data = await this.call(`/api/v1/feed/user/${userId}/story/`, { label: 'story' });
    return data ?? null;
  }

  liveWebInfo(userId) {
    return this.call('/api/v1/live/web_info/', { query: { target_user_id: userId }, label: 'live info' });
  }

  // ---- interactions ------------------------------------------------------------------

  comments(pk, { maxId, minId } = {}) {
    return this.call(`/api/v1/media/${pk}/comments/`, {
      query: { can_support_threading: 'true', permalink_enabled: 'false', max_id: maxId, min_id: minId },
      label: 'comments page',
    });
  }

  childComments(pk, commentId, { maxId, minId } = {}) {
    return this.call(`/api/v1/media/${pk}/comments/${commentId}/child_comments/`, {
      query: { max_id: maxId ?? '', min_id: minId },
      label: 'replies page',
    });
  }

  likers(pk) {
    return this.call(`/api/v1/media/${pk}/likers/`, { label: 'likers' });
  }

  friendships(userId, which, maxId) {
    return this.call(`/api/v1/friendships/${userId}/${which}/`, {
      query: { count: 12, max_id: maxId, search_surface: 'follow_list_page' },
      label: `${which} page`,
    });
  }

  // ---- GraphQL fallback --------------------------------------------------------------

  async webTokens() {
    if (this.tokens) return this.tokens;
    let info = null;
    try {
      info = await this.bridge.pageInfo();
    } catch {
      info = null;
    }
    let { fbDtsg, lsd, av } = info || {};
    if (!lsd) {
      const html = String(await this.call('/', { kind: 'html', expectJson: false, label: 'start page' }));
      fbDtsg = fbDtsg || (html.match(/"DTSGInitialData",\[\],\{[^{}]*"token":"([^"]+)"/) || [])[1];
      lsd = (html.match(/"LSD",\[\],\{[^{}]*"token":"([^"]+)"/) || [])[1];
      av = av || (html.match(/"IG_USER_EIMU":"?(\d+)/) || [])[1];
    }
    if (!lsd) throw new IgError(KIND.BAD_RESPONSE, 'Could not read the web app tokens needed for the GraphQL fallback.');
    this.tokens = { fb_dtsg: fbDtsg, lsd, av };
    return this.tokens;
  }

  async graphql(doc, variables, label) {
    const tokens = await this.webTokens();
    const data = await this.call(doc.endpoint, {
      method: 'POST',
      kind: 'graphql',
      lsd: tokens.lsd,
      friendlyName: doc.friendlyName,
      form: {
        ...(tokens.av ? { av: tokens.av } : {}),
        ...(tokens.fb_dtsg ? { fb_dtsg: tokens.fb_dtsg } : {}),
        lsd: tokens.lsd,
        // Form fields as sent by the web app (instaloader 4.16 doc_id_graphql_query,
        // HOAIAN2/Instagram-Downloader 6.0.5 post.js).
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: doc.friendlyName,
        variables: JSON.stringify(variables),
        server_timestamps: 'true',
        doc_id: doc.docId,
      },
      label,
    });
    if (Array.isArray(data?.errors) && data.errors.length && !data.data) {
      throw new IgError(KIND.BAD_RESPONSE, `GraphQL error: ${data.errors[0]?.message || 'unknown'}`);
    }
    const conn = data?.data?.[doc.connection];
    if (!conn) throw new IgError(KIND.BAD_RESPONSE, `GraphQL answer had no ${doc.connection} (the doc_id may have rotated).`);
    return conn;
  }

  /** GraphQL posts page (fallback for feedUser). Variables as sent by the web app (instaloader 4.16). */
  graphqlPosts(username, after) {
    return this.graphql(GRAPHQL_DOCS.profilePosts, {
      ...(after ? { after } : {}),
      data: {
        count: 12,
        include_reel_media_seen_timestamp: true,
        include_relationship_info: true,
        latest_besties_reel_media: true,
        latest_reel_media: true,
      },
      first: 12,
      include_multi_captions: true,
      username,
      __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
      __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
      __relay_internal__pv__PolarisSEOIsCrawlerrelayprovider: false,
      __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
      __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
    }, 'posts page (GraphQL)');
  }

  /** GraphQL reels page (fallback for clipsUser). Variables as in instaloader 4.16 get_reels. */
  graphqlReels(userId, after) {
    return this.graphql(GRAPHQL_DOCS.profileReels, {
      ...(after ? { after } : {}),
      data: { include_feed_video: true, page_size: 12, target_user_id: String(userId) },
    }, 'reels page (GraphQL)');
  }
}
