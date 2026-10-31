import { ext, usernameFromUrl } from '../shared/ext.js';
import { applyTheme, loadSettings } from '../shared/settings.js';

const $ = (s) => document.querySelector(s);

async function init() {
  applyTheme((await loadSettings()).theme);
  let username = null;
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    username = usernameFromUrl(tab?.url || '');
  } catch {
    username = null;
  }
  if (username) {
    $('#detected').hidden = false;
    $('#who').textContent = `@${username}`;
  } else {
    $('#notDetected').hidden = false;
  }
  $('#archiveThis').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'open-archiver', username });
    window.close();
  });
  $('#openArchiver').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'open-archiver', username: null });
    window.close();
  });
}

init();
