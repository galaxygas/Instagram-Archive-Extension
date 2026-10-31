// Archive job: runs every selected category for one username, saving files through the
// chosen writer and keeping a resume point in IndexedDB after each page.
import { InstagramApi } from './api.js';
import { Bridge } from './bridge-client.js';
import { CancelledError, JobControl } from './control.js';
import { IgError, KIND } from './errors.js';
import { pkOf } from './ids.js';
import { mediaFiles, shortcodeOf } from './media.js';
import { muxDash } from './mux.js';
import { joinPath, renderName, sanitizeSegment, utcParts } from './naming.js';
import { postRecord } from './normalize.js';
import { CATEGORY_INFO, dateBound } from './options.js';
import { Pool } from './pool.js';
import { RateLimiter } from './ratelimit.js';
import * as store from './state.js';
import { FolderWriter } from './writer-folder.js';
import { ZipWriter } from './writer-zip.js';
import { collectProfile } from '../collectors/profile.js';
import { collectTimeline } from '../collectors/timeline.js';
import { collectHighlights } from '../collectors/highlights.js';
import { collectStories } from '../collectors/stories.js';
import { collectLive } from '../collectors/live.js';
import { collectComments } from '../collectors/comments.js';
import { collectLikers } from '../collectors/likers.js';
import { collectFriendships } from '../collectors/friendships.js';
import { writeExports } from '../export/exports.js';

const ORDER = ['profile', 'stories', 'live', 'highlights', 'posts', 'reels', 'tagged', 'followers', 'following'];

export function newJobRecord(username, options) {
  return {
    id: `${username}-${Date.now().toString(36)}`,
    username,
    userId: null,
    options,
    status: 'queued',
    progress: {},
    stats: {},
    warnings: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
    runFolder: null,
  };
}

export class ArchiveJob {
  /**
   * @param {object} record job record (from newJobRecord or IndexedDB)
   * @param {object} settings extension settings
   * @param {object} hooks {log(level,msg), status(info), stats(stats), state(status)}
   * @param {object} [extra] {zipHandle}
   */
  constructor(record, settings, hooks, extra = {}) {
    this.rec = record;
    this.settings = settings;
    this.hooks = hooks;
    this.extra = extra;
    this.opts = record.options;
    this.username = record.username;
    this.control = new JobControl();
    this.pool = new Pool(settings.mediaConcurrency || 3);
    this.resuming = Object.keys(record.progress || {}).length > 0;
    this.viewerCanSee = true;
    this.profile = null;
    this.rawCounter = 0;
  }

  // ---- logging & progress -------------------------------------------------------------

  log(level, msg) {
    if (level === 'warn') {
      this.rec.warnings.push(msg);
      if (this.rec.warnings.length > 500) this.rec.warnings.splice(0, this.rec.warnings.length - 500);
    }
    this.hooks.log?.(level, msg);
  }

  stat(category) {
    if (!this.rec.stats[category]) {
      this.rec.stats[category] = { found: 0, saved: 0, skipped: 0, failed: 0, files: 0, done: false };
    }
    return this.rec.stats[category];
  }

  bump(category, field, n = 1) {
    this.stat(category)[field] += n;
    this.hooks.stats?.(this.rec.stats);
  }

  progress(category) {
    if (!this.rec.progress[category]) this.rec.progress[category] = { cursor: null, done: false, pages: 0 };
    return this.rec.progress[category];
  }

  async persist() {
    try {
      await store.saveJob(this.rec);
    } catch (error) {
      this.hooks.log?.('warn', `Could not save the resume point: ${error.message}`);
    }
  }

  setStatus(status) {
    this.rec.status = status;
    this.hooks.state?.(status, this.rec);
  }

  // ---- paths --------------------------------------------------------------------------

  /** Path inside the username folder. */
  rel(...parts) {
    return joinPath(...parts);
  }

  /** Path handed to the writer (prefixed with the username folder). */
  out(relPath) {
    return joinPath(sanitizeSegment(this.username), relPath);
  }

  baseName(item, category, index = '') {
    return renderName(this.settings.filenameTemplate, {
      takenAt: item.taken_at,
      shortcode: shortcodeOf(item),
      pk: pkOf(item),
      index,
      username: this.username,
      type: category,
      caption: item.caption?.text,
    });
  }

  // ---- writer helpers -----------------------------------------------------------------

  async saveJson(relPath, value) {
    await this.writer.saveJson(this.out(relPath), value);
  }

  async saveText(relPath, text, type) {
    await this.writer.saveText(this.out(relPath), text, type);
  }

  async saveUrl(relPath, url) {
    return this.writer.saveUrl(this.out(relPath), url);
  }

  async saveBlob(relPath, blob) {
    return this.writer.saveBlob(this.out(relPath), blob);
  }

  onRaw(label, json) {
    if (!this.opts.metadata.rawResponses || !this.writer) return;
    this.rawCounter += 1;
    const name = `${String(this.rawCounter).padStart(6, '0')}_${label.replace(/[^a-z0-9]+/gi, '-')}.json`;
    this.writer.saveJson(this.out(this.rel('data', 'raw', name)), json).catch((e) => this.log('debug', `Raw response not saved: ${e.message}`));
  }

  // ---- filters ------------------------------------------------------------------------

  /** @returns {'ok'|'skip'|'stop'} */
  filterItem(item, category) {
    const f = this.opts.filters;
    const ts = Number(item.taken_at || 0);
    const from = dateBound(f.from);
    const to = dateBound(f.to, true);
    const pinned = (item.timeline_pinned_user_ids || item.clips_tab_pinned_user_ids || []).length > 0;
    if (to && ts && ts > to) return 'skip';
    if (from && ts && ts < from) {
      // The posts grid is newest-first (pinned posts aside), so nothing older follows.
      return category === 'posts' && !pinned ? 'stop' : 'skip';
    }
    if (f.maxItems > 0 && this.stat(category).saved + this.stat(category).skipped >= f.maxItems) return 'stop';
    return 'ok';
  }

  // ---- media items --------------------------------------------------------------------

  /**
   * Save one media item (post / reel / story item / highlight item) with its files,
   * sidecars, comments and likers.
   * @returns {Promise<'saved'|'seen'|'failed'>}
   */
  async processItem(item, category, { dir = category, extra = {} } = {}) {
    await this.control.checkpoint();
    const pk = pkOf(item);
    if (!pk) return 'failed';
    this.bump(category, 'found');
    if ((this.opts.filters.skipExisting || this.resuming) && await store.hasRecord(this.username, category, pk)) {
      this.bump(category, 'skipped');
      return 'seen';
    }

    const media = this.opts.media;
    const { files, warnings } = mediaFiles(item, media);
    warnings.forEach((w) => this.log('warn', w));
    const multi = new Set(files.map((f) => f.index)).size > 1;
    const base = this.baseName(item, category);
    const saved = [];
    let failed = 0;

    const tasks = files.map((file) => this.pool.run(async () => {
      const name = this.baseName(item, category, multi ? file.index : '') + (file.suffix ? `_${file.suffix}` : '');
      const relPath = this.rel(dir, `${name}.${file.ext}`);
      try {
        const result = await this.saveMediaFile(item, file, relPath, dir, name);
        saved.push(...result);
        this.bump(category, 'files', result.length);
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        failed += 1;
        this.log('warn', `Could not save ${relPath}: ${error.message}`);
      }
    }));

    // Interactions are fetched while the media downloads run.
    const extraRecord = { ...extra };
    try {
      if (this.opts.extras.comments && ['posts', 'reels', 'tagged'].includes(category) && Number(item.comment_count) !== 0 && !item.comments_disabled) {
        const comments = await collectComments(this, item);
        if (comments) {
          await store.putValue(this.username, `comments/${pk}`, comments.list);
          await this.saveJson(this.rel(dir, `${base}_comments.json`), comments.list);
          extraRecord.comments_saved = comments.total;
          extraRecord.comments_file = this.rel(dir, `${base}_comments.json`);
        }
      }
      if (this.opts.extras.likers && ['posts', 'reels', 'tagged'].includes(category)) {
        const likers = await collectLikers(this, item);
        if (likers) {
          await store.putValue(this.username, `likers/${pk}`, likers);
          await this.saveJson(this.rel(dir, `${base}_likers.json`), likers);
          extraRecord.likers_saved = likers.length;
        }
      }
    } catch (error) {
      if (error instanceof CancelledError || error?.kind === KIND.FATAL) {
        await Promise.allSettled(tasks);
        throw error;
      }
      this.log('warn', `Comments/likers for ${shortcodeOf(item) || pk} failed: ${error.message}`);
    }

    const results = await Promise.allSettled(tasks);
    const cancelled = results.find((r) => r.status === 'rejected' && r.reason instanceof CancelledError);
    if (cancelled) throw cancelled.reason;

    const record = { ...postRecord(item, { category, username: this.username, files: saved }), ...extraRecord };
    try {
      if (this.opts.metadata.sidecar) {
        await this.saveJson(this.rel(dir, `${base}.json`), this.opts.metadata.rawSidecar ? { record, raw: item } : record);
      }
      if (this.opts.metadata.captions && record.caption) {
        await this.saveText(this.rel(dir, `${base}.txt`), record.caption, 'text/plain');
      }
    } catch (error) {
      this.log('warn', `Metadata file for ${shortcodeOf(item) || pk} failed: ${error.message}`);
    }

    if (failed && !saved.length && files.length) {
      this.bump(category, 'failed');
      return 'failed';
    }
    await store.putRecord(record);
    this.bump(category, 'saved');
    if (failed) this.bump(category, 'failed');
    return 'saved';
  }

  /** Save one file; handles max-quality muxing and expired CDN links. Returns saved file descriptors. */
  async saveMediaFile(item, file, relPath, dir, name, retried = false) {
    const out = [];
    const desc = (path, extra = {}) => ({ path, kind: file.kind, index: file.index, width: file.width ?? null, height: file.height ?? null, ...extra });
    try {
      if (file.dash) {
        try {
          const blob = await muxDash(file.dash, (u) => this.writer.fetchBlob(u));
          await this.saveBlob(relPath, blob);
          out.push(desc(relPath, { width: file.dash.video.width, height: file.dash.video.height, quality: file.dash.video.qualityLabel || 'dash' }));
          return out;
        } catch (error) {
          if (error instanceof CancelledError) throw error;
          this.log('warn', `Max-quality mux failed for ${relPath} (${error.message}); saving the standard file instead.`);
          if (this.opts.media.keepDashTracks) {
            const v = this.rel(dir, `${name}_video-track.mp4`);
            await this.saveUrl(v, file.dash.video.url);
            out.push(desc(v, { width: file.dash.video.width, height: file.dash.video.height, track: 'video' }));
            if (file.dash.audio) {
              const a = this.rel(dir, `${name}_audio-track.m4a`);
              await this.saveUrl(a, file.dash.audio.url);
              out.push(desc(a, { track: 'audio' }));
            }
          }
        }
      }
      await this.saveUrl(relPath, file.url);
      out.push(desc(relPath));
      return out;
    } catch (error) {
      if (!error?.expired || retried) throw error;
      // Signed CDN links expire; fetch the media again for fresh links and retry once.
      this.log('info', `Refreshing expired media links for ${shortcodeOf(item) || pkOf(item)}.`);
      const fresh = await this.api.mediaInfo(pkOf(item));
      if (!fresh) throw error;
      const again = mediaFiles(fresh, this.opts.media).files.find((f) => f.index === file.index && f.kind === file.kind);
      if (!again) throw error;
      return this.saveMediaFile(fresh, again, relPath, dir, name, true);
    }
  }

  // ---- run ----------------------------------------------------------------------------

  async createWriter() {
    const root = sanitizeSegment(this.settings.rootFolder || 'Gram Archiver');
    const folder = new FolderWriter({
      root,
      conflictAction: this.settings.conflictAction || 'overwrite',
      eraseHistory: Boolean(this.settings.eraseDownloadHistory),
      log: (l, m) => this.log(l, m),
    });
    if (this.opts.output.mode !== 'zip') return folder;
    const { date, time } = utcParts(Date.now() / 1000);
    const zip = new ZipWriter({
      mode: this.extra.zipHandle ? 'stream' : 'parts',
      fileHandle: this.extra.zipHandle,
      partSize: Math.max(50, Number(this.opts.output.partSizeMB) || 1024) * 1024 * 1024,
      baseName: joinPath(sanitizeSegment(this.username), `${sanitizeSegment(this.username)}_${date}_${time}`),
      saver: folder,
      log: (l, m) => this.log(l, m),
    });
    zip.folder = folder;
    await zip.init();
    return zip;
  }

  async run() {
    const { min, max } = this.delayRange();
    this.limiter = new RateLimiter({ min, max, windowCap: this.settings.windowCap !== false });
    this.bridge = new Bridge({ log: (l, m) => this.log(l, m) });
    this.api = new InstagramApi({
      bridge: this.bridge,
      limiter: this.limiter,
      control: this.control,
      hiRes: this.opts.media.hiRes,
      log: (l, m) => this.log(l, m),
      onStatus: (s) => this.hooks.status?.(s),
      onRaw: (label, json) => this.onRaw(label, json),
    });

    this.setStatus('running');
    this.rec.error = null;
    await this.persist();
    let ok = false;
    try {
      this.writer = await this.createWriter();
      if (!this.rec.userId) {
        this.log('info', `Looking up @${this.username}...`);
        this.rec.userId = await this.api.resolveUserId(this.username);
        await this.persist();
      }
      this.userId = this.rec.userId;
      this.log('info', `@${this.username} has user id ${this.userId}.`);

      const selected = ORDER.filter((k) => this.opts.categories[k]);
      // The profile step also decides whether the viewer can see the account's media.
      if (!selected.includes('profile')) selected.unshift('profile:check');

      for (const key of selected) {
        await this.control.checkpoint();
        if (key === 'profile:check') {
          await collectProfile(this, { saveFiles: false });
          continue;
        }
        const prog = this.progress(key);
        if (prog.done) {
          this.log('info', `${labelOf(key)}: already finished in an earlier run, skipping.`);
          continue;
        }
        if (!this.viewerCanSee && key !== 'profile') {
          this.log('warn', `${labelOf(key)}: skipped, the account is private and you do not follow it.`);
          continue;
        }
        this.hooks.status?.({ state: 'category', category: key, label: labelOf(key) });
        this.log('info', `${labelOf(key)}: starting.`);
        try {
          await this.runCategory(key);
          prog.done = true;
          this.stat(key).done = true;
          await this.persist();
          const s = this.stat(key);
          this.log('success', `${labelOf(key)}: done (${s.saved} saved, ${s.skipped} already archived, ${s.failed} failed, ${s.files} files).`);
        } catch (error) {
          if (error instanceof CancelledError || error?.kind === KIND.FATAL) throw error;
          if (error?.kind === KIND.PRIVATE) {
            this.viewerCanSee = false;
            this.log('warn', `${labelOf(key)}: ${error.message}`);
            continue;
          }
          this.log('error', `${labelOf(key)} stopped: ${error.message}`);
          this.bump(key, 'failed');
        }
        await this.persist();
      }

      if (this.opts.metadata.csv || this.opts.metadata.viewer || this.opts.metadata.sidecar) {
        this.hooks.status?.({ state: 'category', category: 'exports', label: 'Exports' });
        this.log('info', 'Writing exports (JSON, CSV, offline viewer)...');
        await writeExports(this);
      }
      ok = true;
      this.setStatus('done');
      this.log('success', `Archive of @${this.username} finished.`);
    } catch (error) {
      if (error instanceof CancelledError) {
        this.setStatus('cancelled');
        this.log('warn', 'Job cancelled. Files saved so far are kept; you can resume later.');
      } else {
        this.rec.error = error.message;
        this.setStatus(error?.kind === KIND.FATAL ? 'blocked' : 'failed');
        this.log('error', error.message);
        if (error?.kind === KIND.FATAL) this.log('info', 'Your progress is saved. Use Resume once the issue is resolved.');
      }
    } finally {
      try {
        await this.writer?.close();
        if (this.writer?.folder) await this.writer.folder.close();
      } catch (error) {
        this.log('warn', `Finishing output failed: ${error.message}`);
        ok = false;
      }
      await this.persist();
      await this.bridge.close().catch(() => {});
    }
    return ok;
  }

  delayRange() {
    const s = this.settings;
    if (s.speed === 'custom') return { min: Number(s.customMin) || 0, max: Math.max(Number(s.customMin) || 0, Number(s.customMax) || 0) };
    return { safe: { min: 6, max: 12 }, balanced: { min: 3, max: 6 }, fast: { min: 1, max: 2 } }[s.speed] || { min: 6, max: 12 };
  }

  async runCategory(key) {
    switch (key) {
      case 'profile': return collectProfile(this, { saveFiles: true });
      case 'posts':
      case 'reels':
      case 'tagged': return collectTimeline(this, key);
      case 'highlights': return collectHighlights(this);
      case 'stories': return collectStories(this);
      case 'live': return collectLive(this);
      case 'followers':
      case 'following': return collectFriendships(this, key);
      default: throw new IgError(KIND.BAD_RESPONSE, `Unknown category ${key}`);
    }
  }

  pause() { this.control.pause(); this.setStatus('paused'); }
  resume() { this.control.resume(); this.setStatus('running'); }
  cancel() { this.control.cancel(); }
}

export function labelOf(key) {
  return CATEGORY_INFO.find((c) => c.key === key)?.label || key;
}
