// Folder output: every file is saved with downloads.download() into
// <Downloads>/<root>/<username>/... (MDN: `filename` may contain subfolders relative to
// the Downloads directory). CDN media URLs are handed to the browser directly, so large
// videos never pass through extension memory.
import { ext } from '../../shared/ext.js';
import { joinPath } from './naming.js';

export class DownloadError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'DownloadError';
    this.reason = reason;
  }
}

/** Reasons that mean the signed CDN link expired or was refused (re-fetching the post helps). */
const EXPIRED_REASONS = new Set(['SERVER_FORBIDDEN', 'SERVER_UNAUTHORIZED', 'SERVER_BAD_CONTENT']);
/** Interrupt reasons worth retrying with the same URL (chrome.downloads InterruptReason). */
const RETRY_REASONS = new Set(['NETWORK_FAILED', 'NETWORK_TIMEOUT', 'NETWORK_DISCONNECTED', 'NETWORK_SERVER_DOWN', 'SERVER_FAILED', 'FILE_TRANSIENT_ERROR', 'CRASH']);
const RETRIES = 2;

export class FolderWriter {
  constructor({ root, conflictAction = 'overwrite', eraseHistory = false, log = () => {} }) {
    this.kind = 'folder';
    this.root = root;
    this.conflictAction = conflictAction;
    this.eraseHistory = eraseHistory;
    this.log = log;
    this.waiters = new Map();
    this.bytes = 0;
    this.files = 0;
    this.onChanged = (delta) => this.handleChange(delta);
    ext.downloads.onChanged.addListener(this.onChanged);
  }

  handleChange(delta) {
    const waiter = this.waiters.get(delta.id);
    if (!waiter || !delta.state) return;
    if (delta.state.current === 'complete') {
      this.waiters.delete(delta.id);
      waiter.resolve();
    } else if (delta.state.current === 'interrupted') {
      this.waiters.delete(delta.id);
      ext.downloads.search({ id: delta.id }).then(([item]) => {
        waiter.reject(new DownloadError(`Download failed (${item?.error || 'interrupted'})`, item?.error || 'INTERRUPTED'));
      }).catch(() => waiter.reject(new DownloadError('Download failed', 'INTERRUPTED')));
    }
  }

  async waitFor(id) {
    const done = new Promise((resolve, reject) => this.waiters.set(id, { resolve, reject }));
    // Settled through either path below; never leave the promise unobserved.
    done.catch(() => {});
    // The download may already have finished before the listener was registered.
    const [item] = await ext.downloads.search({ id });
    if (item?.state === 'complete') {
      this.waiters.delete(id);
      return item;
    }
    if (item?.state === 'interrupted') {
      this.waiters.delete(id);
      throw new DownloadError(`Download failed (${item.error || 'interrupted'})`, item.error || 'INTERRUPTED');
    }
    await done;
    const [finished] = await ext.downloads.search({ id });
    return finished;
  }

  fullPath(path) {
    return joinPath(this.root, path);
  }

  async download(path, url) {
    const filename = this.fullPath(path);
    let id;
    try {
      id = await ext.downloads.download({ url, filename, conflictAction: this.conflictAction, saveAs: false });
    } catch (error) {
      throw new DownloadError(`Could not start download of ${filename}: ${error.message}`, 'START_FAILED');
    }
    const item = await this.waitFor(id);
    this.files += 1;
    this.bytes += Number(item?.fileSize || item?.bytesReceived || 0);
    if (this.eraseHistory) ext.downloads.erase({ id }).catch(() => {});
    return { bytes: Number(item?.fileSize || 0), filename: item?.filename || filename };
  }

  /** Save a remote media URL. Throws DownloadError with `expired` when a re-fetch may help. */
  async saveUrl(path, url) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.download(path, url);
      } catch (error) {
        if (error instanceof DownloadError && RETRY_REASONS.has(error.reason) && attempt < RETRIES) {
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          continue;
        }
        if (error instanceof DownloadError && EXPIRED_REASONS.has(error.reason)) error.expired = true;
        throw error;
      }
    }
  }

  async saveBlob(path, blob) {
    const url = URL.createObjectURL(blob);
    try {
      return await this.download(path, url);
    } finally {
      // Revoke only after the download completed (or failed).
      URL.revokeObjectURL(url);
    }
  }

  saveText(path, text, type = 'application/json') {
    return this.saveBlob(path, new Blob([text], { type: `${type};charset=utf-8` }));
  }

  saveJson(path, value) {
    return this.saveText(path, JSON.stringify(value, null, 2), 'application/json');
  }

  async fetchBlob(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      const err = new DownloadError(`HTTP ${res.status} for media`, `HTTP_${res.status}`);
      if (res.status === 403 || res.status === 410) err.expired = true;
      throw err;
    }
    return res.blob();
  }

  async close() {
    ext.downloads.onChanged.removeListener(this.onChanged);
  }
}
