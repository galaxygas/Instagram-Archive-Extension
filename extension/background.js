// Gram Archiver background script.
// Chrome runs this as a service worker, Firefox as an event page. It only wires up
// entry points (popup, context menu, page button) and the toolbar badge. The archive
// job itself runs in the archiver tab, because extension service workers and event
// pages are stopped when idle and cannot host multi-hour jobs.
import { ext, usernameFromUrl } from './shared/ext.js';

const ARCHIVE_PAGE = 'archive/archive.html';

async function findArchiverTab() {
  const base = ext.runtime.getURL(ARCHIVE_PAGE);
  const tabs = await ext.tabs.query({});
  return tabs.find((t) => t.url && t.url.startsWith(base)) || null;
}

async function openArchiver(username) {
  const existing = await findArchiverTab();
  if (existing) {
    await ext.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await ext.windows.update(existing.windowId, { focused: true }).catch(() => {});
    if (username) {
      await ext.runtime.sendMessage({ type: 'select-username', username }).catch(() => {});
    }
    return existing;
  }
  const url = ext.runtime.getURL(ARCHIVE_PAGE) + (username ? `?username=${encodeURIComponent(username)}` : '');
  return ext.tabs.create({ url });
}

async function createMenus() {
  // Promise form: Firefox's browser.* API does not take callbacks; Chrome MV3 returns promises too.
  try { await ext.contextMenus.removeAll(); } catch { /* none yet */ }
  ext.contextMenus.create({
    id: 'gram-archive-profile',
    title: ext.i18n.getMessage('contextMenuArchive') || 'Archive this profile',
    contexts: ['page', 'link'],
    documentUrlPatterns: ['https://www.instagram.com/*'],
  });
  ext.contextMenus.create({
    id: 'gram-open',
    title: ext.i18n.getMessage('contextMenuOpen') || 'Open Gram Archiver',
    contexts: ['action'],
  });
}

ext.runtime.onInstalled.addListener(createMenus);
ext.runtime.onStartup?.addListener(createMenus);

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'gram-open') {
    openArchiver(null);
    return;
  }
  if (info.menuItemId === 'gram-archive-profile') {
    const username = usernameFromUrl(info.linkUrl || '') || usernameFromUrl(info.pageUrl || tab?.url || '');
    openArchiver(username);
  }
});

ext.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== 'object') return undefined;
  if (msg.type === 'open-archiver') {
    return openArchiver(msg.username || null).then(() => ({ ok: true }));
  }
  if (msg.type === 'badge') {
    const text = String(msg.text ?? '');
    const tasks = [ext.action.setBadgeText({ text })];
    if (msg.color) tasks.push(ext.action.setBadgeBackgroundColor({ color: msg.color }));
    return Promise.all(tasks).then(() => ({ ok: true })).catch(() => ({ ok: false }));
  }
  return undefined;
});
