// Connection from the archiver page to the content-script bridge in an instagram.com tab.
import { ext, IG_ORIGIN, IG_TAB_PATTERN } from '../../shared/ext.js';
import { IgError, KIND } from './errors.js';

const PING_TIMEOUT_MS = 4000;
const TAB_LOAD_TIMEOUT_MS = 45000;

export class Bridge {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.port = null;
    this.tabId = null;
    this.createdTab = false;
    this.nextId = 1;
    this.pending = new Map();
    this.connecting = null;
  }

  async findTab() {
    const tabs = await ext.tabs.query({ url: IG_TAB_PATTERN });
    if (this.tabId !== null) {
      const same = tabs.find((t) => t.id === this.tabId);
      if (same) return same;
    }
    return tabs.find((t) => t.status === 'complete' && !t.discarded) || tabs.find((t) => !t.discarded) || null;
  }

  waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ext.tabs.onUpdated.removeListener(listener);
        reject(new IgError(KIND.TRANSIENT, 'The instagram.com tab took too long to load.'));
      }, TAB_LOAD_TIMEOUT_MS);
      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timer);
          ext.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      ext.tabs.onUpdated.addListener(listener);
      ext.tabs.get(tabId).then((t) => {
        if (t.status === 'complete') listener(tabId, { status: 'complete' });
      }).catch(() => {});
    });
  }

  async ensureTab() {
    let tab = await this.findTab();
    if (!tab) {
      this.log('info', 'Opening an instagram.com tab in the background for requests.');
      tab = await ext.tabs.create({ url: `${IG_ORIGIN}/`, active: false });
      this.createdTab = true;
    }
    this.tabId = tab.id;
    try {
      await ext.tabs.update(tab.id, { autoDiscardable: false });
    } catch {
      /* not supported in every browser version */
    }
    await this.waitForTabComplete(tab.id);
    return tab.id;
  }

  openPort(tabId) {
    const port = ext.tabs.connect(tabId, { name: 'gram-bridge' });
    port.onMessage.addListener((msg) => {
      const entry = this.pending.get(msg?.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new IgError(KIND.TRANSIENT, `Bridge error: ${msg.error}`));
    });
    port.onDisconnect.addListener(() => {
      void ext.runtime.lastError;
      if (this.port === port) this.port = null;
      for (const [id, entry] of this.pending) {
        if (entry.port !== port) continue;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(new IgError(KIND.TRANSIENT, 'The instagram.com tab was closed or navigated away.'));
      }
    });
    return port;
  }

  send(port, type, payload, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IgError(KIND.TRANSIENT, `No answer from the instagram.com tab after ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, port });
      try {
        port.postMessage({ id, type, ...payload });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new IgError(KIND.TRANSIENT, `Could not reach the instagram.com tab: ${error.message}`));
      }
    });
  }

  async connect() {
    if (this.port) return this.port;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const tabId = await this.ensureTab();
      let port = this.openPort(tabId);
      try {
        await this.send(port, 'ping', {}, PING_TIMEOUT_MS);
      } catch {
        // The tab was open before the extension was installed or updated; inject the bridge.
        try { port.disconnect(); } catch { /* ignore */ }
        await ext.scripting.executeScript({ target: { tabId }, files: ['content/bridge.js'] });
        port = this.openPort(tabId);
        await this.send(port, 'ping', {}, PING_TIMEOUT_MS);
      }
      this.port = port;
      return port;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async request(req, timeoutMs = 90000) {
    const port = await this.connect();
    return this.send(port, 'request', { req }, timeoutMs);
  }

  async pageInfo() {
    const port = await this.connect();
    return this.send(port, 'pageInfo', {}, PING_TIMEOUT_MS * 2);
  }

  async close() {
    try { this.port?.disconnect(); } catch { /* ignore */ }
    this.port = null;
    if (this.createdTab && this.tabId !== null) {
      await ext.tabs.remove(this.tabId).catch(() => {});
    }
  }
}
