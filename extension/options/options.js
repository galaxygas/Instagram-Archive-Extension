import { clear, h } from '../shared/dom.js';
import { applyTheme, loadSettings, saveSettings, SPEED_PRESETS } from '../shared/settings.js';
import { renderName } from '../archive/core/naming.js';
import * as store from '../archive/core/state.js';

const $ = (s) => document.querySelector(s);
let settings;
let savedTimer;

function flashSaved() {
  $('#saved').hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('#saved').hidden = true; }, 1200);
}

async function update(patch) {
  settings = await saveSettings(patch);
  applyTheme(settings.theme);
  flashSaved();
  render();
}

function renderSpeeds() {
  const box = $('#speeds');
  clear(box);
  for (const [key, p] of Object.entries(SPEED_PRESETS)) {
    const range = p.min !== null ? `${p.min}–${p.max} s` : 'your range';
    box.append(h('label', { class: `speed ${settings.speed === key ? 'on' : ''}` },
      h('input', { type: 'radio', name: 'speed', value: key, checked: settings.speed === key, onchange: () => update({ speed: key }) }),
      h('b', { text: p.label }), h('small', { text: range }), h('small', { text: p.note })));
  }
  $('#customRow').hidden = settings.speed !== 'custom';
}

function render() {
  renderSpeeds();
  $('#namePreview').textContent = `${renderName(settings.filenameTemplate, { takenAt: 1730000000, shortcode: 'DBx3kLmP9aQ', pk: '3478123456789012345', index: 2, username: 'example', type: 'posts', caption: 'Sunset at the beach' })}.jpg`;
}

async function renderArchives() {
  const box = $('#archives');
  clear(box);
  let list = [];
  try { list = await store.archivedUsernames(); } catch { list = []; }
  if (!list.length) {
    box.append(h('p', { class: 'muted small', text: 'Nothing stored yet.' }));
    return;
  }
  for (const a of list.sort((x, y) => x.username.localeCompare(y.username))) {
    const forget = async () => {
      if (!confirm(`Forget what was archived for @${a.username}? The next run will download everything again. Downloaded files are not deleted.`)) return;
      await store.forgetUsername(a.username);
      renderArchives();
    };
    const row = h('div', { class: 'archive' },
      h('span', {}, h('b', { text: `@${a.username}` }), ' ', h('span', { class: 'muted small', text: `${a.items.toLocaleString()} items` })),
      h('button', { class: 'btn', type: 'button', onclick: forget }, 'Forget'));
    box.append(row);
  }
}

function bindInput(id, key, parse = (v) => v) {
  const el = $(`#${id}`);
  if (el.type === 'checkbox') el.checked = Boolean(settings[key]);
  else el.value = settings[key] ?? '';
  el.addEventListener('change', () => update({ [key]: el.type === 'checkbox' ? el.checked : parse(el.value) }));
}

async function init() {
  settings = await loadSettings();
  applyTheme(settings.theme);
  bindInput('customMin', 'customMin', (v) => Math.max(0, Number(v) || 0));
  bindInput('customMax', 'customMax', (v) => Math.max(0, Number(v) || 0));
  bindInput('windowCap', 'windowCap');
  bindInput('mediaConcurrency', 'mediaConcurrency', (v) => Math.min(8, Math.max(1, Math.round(Number(v) || 3))));
  bindInput('rootFolder', 'rootFolder', (v) => v.trim() || 'Gram Archiver');
  bindInput('filenameTemplate', 'filenameTemplate', (v) => v.trim() || '{date}_{shortcode}_{index}');
  bindInput('conflictAction', 'conflictAction');
  bindInput('eraseDownloadHistory', 'eraseDownloadHistory');
  bindInput('theme', 'theme');
  bindInput('profileButton', 'profileButton');
  bindInput('debugLog', 'debugLog');
  $('#filenameTemplate').addEventListener('input', (e) => {
    $('#namePreview').textContent = `${renderName(e.target.value, { takenAt: 1730000000, shortcode: 'DBx3kLmP9aQ', pk: '3478123456789012345', index: 2, username: 'example', type: 'posts', caption: 'Sunset at the beach' })}.jpg`;
  });
  $('#clearAll').addEventListener('click', async () => {
    if (!confirm('Forget all stored archive data and job history? Downloaded files are not deleted.')) return;
    for (const a of await store.archivedUsernames()) await store.forgetUsername(a.username);
    for (const j of await store.listJobs()) await store.deleteJob(j.id);
    renderArchives();
  });
  render();
  renderArchives();
}

init();
