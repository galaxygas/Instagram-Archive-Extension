import { clear, h } from '../shared/dom.js';
import { ext, HOST_ORIGINS, normalizeUsernameInput } from '../shared/ext.js';
import { applyTheme, loadSettings, saveSettings, SPEED_PRESETS, delayRange } from '../shared/settings.js';
import { InstagramApi } from './core/api.js';
import { Bridge } from './core/bridge-client.js';
import { JobControl } from './core/control.js';
import { KIND } from './core/errors.js';
import { ArchiveJob, labelOf, newJobRecord } from './core/job.js';
import { profileRecord, isPrivateNotFollowed } from './core/normalize.js';
import { CATEGORY_INFO, MEDIA_CATEGORIES, mergeOptions } from './core/options.js';
import { RateLimiter } from './core/ratelimit.js';
import * as store from './core/state.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let settings;
let options;
let profile = null; // {username, userId, rec, canSee}
let current = null; // running ArchiveJob
const queue = []; // [{record, extra}]
const supportsSavePicker = typeof window.showSaveFilePicker === 'function';

// ---- helpers ---------------------------------------------------------------------------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
const when = (t) => new Date(t).toLocaleString();

function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

// ---- log -------------------------------------------------------------------------------

const logEl = () => $('#log');
function log(level, msg) {
  if (level === 'debug' && !settings?.debugLog) return;
  const li = document.createElement('li');
  li.className = level;
  const t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const span = document.createElement('span');
  span.textContent = msg;
  li.append(t, span);
  const el = logEl();
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.append(li);
  while (el.children.length > 2000) el.firstChild.remove();
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ---- options form ----------------------------------------------------------------------

function renderCategories() {
  const box = $('#categories');
  clear(box);
  for (const c of CATEGORY_INFO) {
    box.append(h('label', { class: 'check', 'data-cat': c.key },
      h('input', { type: 'checkbox', 'data-opt': `categories.${c.key}` }),
      h('span', {}, h('b', { text: c.label }), h('small', { text: c.desc })),
      h('span', { class: 'count', 'data-count': c.key })));
  }
}

function bindOptions() {
  for (const input of $$('[data-opt]')) {
    const path = input.dataset.opt;
    const value = getPath(options, path);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.type === 'radio') input.checked = input.value === value;
    else input.value = value ?? '';
    input.addEventListener('change', () => {
      let v;
      if (input.type === 'checkbox') v = input.checked;
      else if (input.type === 'radio') { if (!input.checked) return; v = input.value; }
      else if (input.type === 'number') v = Math.max(Number(input.min || 0), Number(input.value) || 0);
      else v = input.value;
      setPath(options, path, v);
      saveSettings({ lastJobOptions: options }).catch(() => {});
      refreshDependent();
    });
  }
  refreshDependent();
}

function syncInputs() {
  for (const input of $$('[data-opt]')) {
    const value = getPath(options, input.dataset.opt);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.type === 'radio') input.checked = input.value === value;
  }
  refreshDependent();
}

function refreshDependent() {
  const dep = (path, parent) => {
    const el = $(`[data-opt="${path}"]`);
    if (!el) return;
    el.disabled = !getPath(options, parent);
    el.closest('.check, .field')?.classList.toggle('disabled', el.disabled);
  };
  dep('media.keepDashTracks', 'media.maxQuality');
  dep('extras.replies', 'extras.comments');
  dep('extras.maxComments', 'extras.comments');
  dep('metadata.rawSidecar', 'metadata.sidecar');
  const zip = options.output.mode === 'zip';
  $('#zipOptions').hidden = !zip;
  $('#zipStreamRow').hidden = !supportsSavePicker;
  const streaming = zip && supportsSavePicker && options.output.zipStream;
  $('[data-opt="output.partSizeMB"]').closest('.field').hidden = streaming;
  $('#outputHint').textContent = zip
    ? (streaming
      ? 'One ZIP file is written straight to the location you choose when the job starts.'
      : 'The archive is saved as ZIP files of the size below in your Downloads folder. Each part is held in memory until saved. A resumed job writes a new ZIP containing only the remaining items.')
    : `Files go to Downloads/${settings.rootFolder}/<username>/ in folders (posts, reels, stories, highlights, …). Re-runs only add what is new.`;
  updateEstimate();
}

function applyPreset(name) {
  for (const c of CATEGORY_INFO) {
    if (name === 'all') options.categories[c.key] = c.key !== 'live';
    else if (name === 'none') options.categories[c.key] = false;
    else if (name === 'media') options.categories[c.key] = c.key === 'profile' || MEDIA_CATEGORIES.includes(c.key);
  }
  saveSettings({ lastJobOptions: options }).catch(() => {});
  syncInputs();
}

// ---- estimate --------------------------------------------------------------------------

function updateEstimate() {
  const el = $('#estimate');
  const p = profile?.rec;
  const c = options.categories;
  const selected = CATEGORY_INFO.filter((x) => c[x.key]);
  if (!selected.length) {
    el.textContent = 'Select at least one thing to archive.';
    setStartEnabled();
    return;
  }
  if (!p) {
    el.textContent = `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'} selected. Look up a profile to see an estimate.`;
    setStartEnabled();
    return;
  }
  const max = options.filters.maxItems || Infinity;
  const posts = Math.min(p.media_count || 0, max);
  let requests = 3;
  if (c.posts) requests += Math.ceil(posts / 30) || 1;
  if (c.reels) requests += Math.ceil(Math.min(p.reels_count ?? posts, max) / 50) || 1;
  if (c.tagged) requests += 3;
  if (c.highlights) requests += 1 + Math.ceil((p.highlight_reel_count || 0) / 5);
  if (c.stories) requests += 1;
  if (c.followers) requests += Math.ceil(Math.min(p.follower_count || 0, max) / 12);
  if (c.following) requests += Math.ceil(Math.min(p.following_count || 0, max) / 12);
  if (options.extras.comments) requests += posts * (options.extras.replies ? 1.5 : 1);
  if (options.extras.likers) requests += posts;
  const { min, max: dmax } = delayRange(settings);
  const ms = requests * ((min + dmax) / 2) * 1000;
  el.replaceChildren('About ', h('b', { text: fmt(Math.round(requests)) }), ' requests to Instagram, roughly ', h('b', { text: duration(ms) }),
    ` at the ${SPEED_PRESETS[settings.speed]?.label || 'current'} pace, plus download time.`);
  setStartEnabled();
}

function setStartEnabled() {
  const any = CATEGORY_INFO.some((x) => options.categories[x.key]);
  const name = normalizeUsernameInput($('#username').value);
  $('#startBtn').disabled = !any || !name;
  $('#queueBtn').disabled = !any || !name || !current;
  $('#startBtn').textContent = name ? (current ? `Queue @${name}` : `Archive @${name}`) : 'Archive';
}

// ---- permissions -----------------------------------------------------------------------

async function checkPermissions() {
  try {
    const ok = await ext.permissions.contains({ origins: HOST_ORIGINS });
    $('#permBanner').hidden = ok;
    return ok;
  } catch {
    return true;
  }
}

// ---- profile lookup --------------------------------------------------------------------

let lookupBridge = null;
async function lookup(username) {
  const card = $('#profileCard');
  card.hidden = false;
  card.replaceChildren(h('div', { style: { gridColumn: '1 / -1', color: 'var(--muted)' }, text: 'Looking up profile…' }));
  $('#lookupBtn').disabled = true;
  setConnection('run', 'Connecting…');
  try {
    lookupBridge ??= new Bridge({ log });
    const api = new InstagramApi({ bridge: lookupBridge, limiter: new RateLimiter({ min: 1, max: 2, windowCap: false }), control: new JobControl(), log });
    const userId = await api.resolveUserId(username);
    setConnection('ok', 'Connected');
    let v1 = null;
    let web = null;
    try { v1 = await api.userInfo(userId); } catch (e) { if (e?.kind === KIND.FATAL) throw e; }
    if (!v1) { try { web = await api.webProfileInfo(username); } catch (e) { if (e?.kind === KIND.FATAL) throw e; } }
    const rec = profileRecord(v1, web);
    const info = await lookupBridge.pageInfo().catch(() => null);
    const own = info?.viewerId && String(info.viewerId) === String(userId);
    const canSee = own || !isPrivateNotFollowed(v1, web);
    profile = { username, userId, rec, canSee };
    renderProfileCard();
  } catch (error) {
    profile = null;
    const fatal = error?.kind === KIND.FATAL;
    setConnection(fatal ? 'err' : 'warn', fatal ? 'Blocked / logged out' : 'Connected');
    card.replaceChildren(h('div', { class: 'note', text: error.message }));
  } finally {
    $('#lookupBtn').disabled = false;
    updateEstimate();
  }
}

function renderProfileCard() {
  const p = profile.rec;
  const card = $('#profileCard');
  const img = h('img', { alt: '', referrerpolicy: 'no-referrer' });
  card.replaceChildren(
    img,
    h('div', {},
      h('div', { class: 'name' }, `@${p.username}`,
        p.is_verified ? h('span', { class: 'tag verified', text: 'Verified' }) : null,
        p.is_private ? h('span', { class: 'tag', text: 'Private' }) : null,
        p.category ? h('span', { class: 'tag', text: p.category }) : null),
      h('div', { class: 'full', text: p.full_name || '' }),
      h('div', { class: 'stats' },
        h('span', {}, h('b', { text: fmt(p.media_count) }), ' posts'),
        h('span', {}, h('b', { text: fmt(p.follower_count) }), ' followers'),
        h('span', {}, h('b', { text: fmt(p.following_count) }), ' following'),
        p.highlight_reel_count != null ? h('span', {}, h('b', { text: fmt(p.highlight_reel_count) }), ' highlights') : null),
      p.biography ? h('div', { class: 'bio', text: p.biography }) : null),
    profile.canSee ? null : h('div', { class: 'note', text: 'This account is private and you do not follow it. Only its public profile information can be archived.' }));
  // Profile pictures come from Instagram's CDN, which the extension has host access to.
  if (p.profile_pic_url) {
    fetch(p.profile_pic_url, { credentials: 'omit' }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b) img.src = URL.createObjectURL(b);
    }).catch(() => {});
  }
  for (const [key, n] of Object.entries({ posts: p.media_count, reels: p.reels_count, highlights: p.highlight_reel_count, followers: p.follower_count, following: p.following_count })) {
    const el = $(`[data-count="${key}"]`);
    if (el) el.textContent = n != null ? fmt(n) : '';
  }
  for (const key of MEDIA_CATEGORIES.concat(['followers', 'following', 'live'])) {
    $(`[data-cat="${key}"]`)?.classList.toggle('disabled', !profile.canSee);
  }
}

function setConnection(kind, text) {
  const el = $('#connection');
  el.className = `pill ${kind}`;
  el.textContent = text;
}

// ---- jobs ------------------------------------------------------------------------------

function cloneOptions() {
  return JSON.parse(JSON.stringify(options));
}

async function startFromForm() {
  const username = normalizeUsernameInput($('#username').value);
  if (!username) return;
  if (!(await checkPermissions())) {
    log('error', 'Grant site access first (banner at the top).');
    return;
  }
  const record = newJobRecord(username, cloneOptions());
  const extra = {};
  if (record.options.output.mode === 'zip' && supportsSavePicker && record.options.output.zipStream) {
    try {
      extra.zipHandle = await window.showSaveFilePicker({
        suggestedName: `${username}_instagram_archive.zip`,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      log('warn', `Could not open the save dialog (${error.message}); saving the ZIP in parts instead.`);
    }
  }
  await store.saveJob(record);
  queue.push({ record, extra });
  log('info', `Queued @${username}.`);
  renderJobs();
  pump();
}

async function pump() {
  if (current || !queue.length) return;
  const { record, extra } = queue.shift();
  settings = await loadSettings();
  const job = new ArchiveJob(record, settings, {
    log,
    status: onStatus,
    stats: () => renderProgress(job),
    state: (status) => onState(job, status),
    profile: () => {},
  }, extra);
  current = job;
  $('#idle').hidden = true;
  $('#runPanel').hidden = false;
  $('#runTitle').textContent = `@${record.username}`;
  $('#pauseBtn').disabled = false;
  $('#cancelBtn').disabled = false;
  renderProgress(job);
  renderJobs();
  setStartEnabled();
  try {
    await job.run();
  } finally {
    current = null;
    $('#pauseBtn').disabled = true;
    $('#cancelBtn').disabled = true;
    $('#pauseBtn').textContent = 'Pause';
    setActivity(null);
    badge('');
    renderJobs();
    setStartEnabled();
    pump();
  }
}

const STATUS_TEXT = {
  queued: ['', 'Queued'], running: ['run', 'Running'], paused: ['warn', 'Paused'], done: ['ok', 'Finished'],
  failed: ['err', 'Failed'], blocked: ['err', 'Stopped by Instagram'], cancelled: ['warn', 'Stopped'], interrupted: ['warn', 'Interrupted'],
};

function onState(job, status) {
  const [kind, text] = STATUS_TEXT[status] || ['', status];
  const el = $('#runStatus');
  el.className = `pill ${kind}`;
  el.textContent = text;
  $('#pauseBtn').textContent = status === 'paused' ? 'Resume' : 'Pause';
  if (status === 'running') setConnection('ok', 'Connected');
  if (status === 'blocked') setConnection('err', 'Blocked / logged out');
  renderProgress(job);
}

let countdown = null;
function setActivity(text, { spinning = true, until = null } = {}) {
  const el = $('#activity');
  clearInterval(countdown);
  if (!text) {
    clear(el);
    return;
  }
  const draw = () => {
    const left = until ? ` ${Math.max(0, Math.ceil((until - Date.now()) / 1000))} s` : '';
    el.replaceChildren(spinning ? h('span', { class: 'spinner' }) : '', h('span', { text: `${text}${left}` }));
  };
  draw();
  if (until) countdown = setInterval(draw, 500);
}

let currentLabel = '';
function onStatus(s) {
  if (s.state === 'category') currentLabel = s.label;
  if (s.state === 'waiting') setActivity(`${currentLabel}: next request (${s.label}) in`, { until: Date.now() + s.ms });
  else if (s.state === 'backoff') setActivity(`Instagram asked to slow down. Waiting`, { until: Date.now() + s.ms });
  else if (s.state === 'request') setActivity(`${currentLabel}: requesting ${s.label}…`);
  else if (s.state === 'live') setActivity(s.label);
  else if (s.state === 'category') setActivity(`${s.label}…`);
}

function badge(text) {
  ext.runtime.sendMessage({ type: 'badge', text, color: '#7c3aed' }).catch(() => {});
}

function renderProgress(job) {
  const box = $('#catProgress');
  const keys = CATEGORY_INFO.map((c) => c.key).filter((k) => job.opts.categories[k]);
  const expected = {
    posts: profile?.username === job.username ? profile.rec.media_count : null,
    reels: profile?.username === job.username ? profile.rec.reels_count : null,
    followers: profile?.username === job.username ? profile.rec.follower_count : null,
    following: profile?.username === job.username ? profile.rec.following_count : null,
  };
  let totalSaved = 0;
  clear(box);
  for (const key of keys) {
    const s = job.rec.stats[key] || { found: 0, saved: 0, skipped: 0, failed: 0, files: 0, done: false };
    const done = job.rec.progress[key]?.done || s.done;
    totalSaved += s.saved;
    const started = Boolean(job.rec.stats[key]);
    const exp = expected[key];
    const pct = done ? 100 : exp ? Math.min(99, ((s.saved + s.skipped) / exp) * 100) : null;
    const nums = [`${s.saved} saved`, s.skipped ? `${s.skipped} skipped` : '', s.failed ? `${s.failed} failed` : '', s.files ? `${s.files} files` : ''].filter(Boolean).join(' · ');
    const row = h('div', { class: `cat-row ${done ? 'done' : started ? '' : 'pending'}` },
      h('span', { class: 'label', text: labelOf(key) }),
      h('div', { class: `bar ${!done && started && pct === null ? 'indeterminate' : ''}` }, h('i', { style: { width: `${pct ?? 0}%` } })),
      h('span', { class: 'nums', text: nums }));
    box.append(row);
  }
  badge(totalSaved ? String(totalSaved > 999 ? `${Math.floor(totalSaved / 1000)}k` : totalSaved) : '…');
}

async function renderJobs() {
  const qBox = $('#queue');
  clear(qBox);
  if (queue.length) {
    qBox.append(h('div', { class: 'section-label', text: 'Queued' }));
    queue.forEach((q, i) => {
      qBox.append(h('div', { class: 'job' },
        h('div', {}, h('div', { class: 'who', text: `@${q.record.username}` }), h('div', { class: 'when', text: 'waiting' })),
        h('div', { class: 'acts' }, h('button', {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            queue.splice(i, 1);
            await store.deleteJob(q.record.id).catch(() => {});
            renderJobs();
          },
        }, 'Remove'))));
    });
  }
  const hBox = $('#history');
  clear(hBox);
  let jobs = [];
  try { jobs = await store.listJobs(); } catch { jobs = []; }
  const queuedIds = new Set(queue.map((q) => q.record.id));
  jobs = jobs.filter((j) => !queuedIds.has(j.id) && j.id !== current?.rec.id).slice(0, 25);
  if (!jobs.length && !queue.length) {
    hBox.append(h('div', { class: 'empty', text: 'No archives yet.' }));
    return;
  }
  if (jobs.length) hBox.append(h('div', { class: 'section-label', text: 'Recent' }));
  for (const j of jobs) {
    const [kind, text] = STATUS_TEXT[j.status] || ['', j.status];
    const saved = Object.values(j.stats || {}).reduce((a, s) => a + (s.saved || 0), 0);
    const resumable = ['failed', 'blocked', 'cancelled', 'interrupted', 'paused', 'running'].includes(j.status);
    const again = () => {
      $('#username').value = j.username;
      options = mergeOptions(j.options);
      syncInputs();
      lookup(j.username);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const remove = async () => {
      await store.deleteJob(j.id);
      renderJobs();
    };
    const div = h('div', { class: 'job' },
      h('div', {},
        h('div', { class: 'who' }, `@${j.username} `, h('span', { class: `pill ${kind}`, text })),
        h('div', { class: 'when', text: `${when(j.updatedAt)} · ${saved} items${j.error ? ` · ${j.error}` : ''}` })),
      h('div', { class: 'acts' },
        resumable ? h('button', { class: 'btn', type: 'button', onclick: () => resumeJob(j) }, 'Resume') : null,
        h('button', { class: 'btn', type: 'button', onclick: again }, 'Run again'),
        h('button', { class: 'btn', type: 'button', title: 'Remove from history', 'aria-label': 'Remove from history', onclick: remove }, '✕')));
    hBox.append(div);
  }
}

async function resumeJob(j) {
  if (current?.rec.id === j.id) return;
  const record = await store.getJob(j.id);
  if (!record) return;
  record.options = mergeOptions(record.options);
  const extra = {};
  if (record.options.output.mode === 'zip' && supportsSavePicker && record.options.output.zipStream) {
    try {
      extra.zipHandle = await window.showSaveFilePicker({ suggestedName: `${record.username}_instagram_archive_resumed.zip` });
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  queue.push({ record, extra });
  log('info', `Resuming @${record.username}.`);
  renderJobs();
  pump();
}

/** Jobs that were running when the page was closed are marked as interrupted. */
async function markInterrupted() {
  try {
    for (const j of await store.listJobs()) {
      if (j.status === 'running' || j.status === 'paused' || j.status === 'queued') {
        j.status = 'interrupted';
        await store.saveJob(j);
      }
    }
  } catch { /* ignore */ }
}

// ---- init ------------------------------------------------------------------------------

async function init() {
  settings = await loadSettings();
  applyTheme(settings.theme);
  options = mergeOptions(settings.lastJobOptions);
  $('#speedLabel').textContent = SPEED_PRESETS[settings.speed]?.label || 'Custom';
  renderCategories();
  bindOptions();
  await markInterrupted();
  renderJobs();
  checkPermissions();

  $('#grantPerms').addEventListener('click', async () => {
    try {
      await ext.permissions.request({ origins: HOST_ORIGINS });
    } catch (error) {
      log('error', `Permission request failed: ${error.message}`);
    }
    checkPermissions();
  });
  ext.permissions.onAdded?.addListener(checkPermissions);
  ext.permissions.onRemoved?.addListener(checkPermissions);

  $('#lookupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = normalizeUsernameInput($('#username').value);
    if (!name) {
      log('warn', 'Enter a valid Instagram username or profile link.');
      return;
    }
    $('#username').value = name;
    lookup(name);
  });
  $('#username').addEventListener('input', setStartEnabled);
  $('#startBtn').addEventListener('click', () => startFromForm());
  $('#queueBtn').addEventListener('click', () => startFromForm());
  $('#pauseBtn').addEventListener('click', () => {
    if (!current) return;
    if (current.control.paused) current.resume();
    else current.pause();
  });
  $('#cancelBtn').addEventListener('click', () => {
    if (current && confirm(`Stop archiving @${current.username}? Files saved so far are kept and you can resume later.`)) current.cancel();
  });
  for (const b of $$('[data-preset]')) b.addEventListener('click', () => applyPreset(b.dataset.preset));
  for (const b of $$('[data-log]')) {
    b.addEventListener('click', () => {
      $$('[data-log]').forEach((x) => x.classList.toggle('on', x === b));
      logEl().className = `log ${b.dataset.log === 'all' ? '' : `f-${b.dataset.log}`}`;
    });
  }
  $('#copyLog').addEventListener('click', () => {
    const text = [...logEl().children].map((li) => `${li.querySelector('time').textContent} [${li.className}] ${li.querySelector('span').textContent}`).join('\n');
    navigator.clipboard.writeText(text).then(() => log('info', 'Log copied.')).catch(() => {});
  });
  $('#clearLog').addEventListener('click', () => clear(logEl()));
  $('#themeToggle').addEventListener('click', async () => {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    settings = await saveSettings({ theme: next });
    applyTheme(next);
    log('info', `Theme: ${next}.`);
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = { ...settings, ...changes.settings.newValue };
    applyTheme(settings.theme);
    $('#speedLabel').textContent = SPEED_PRESETS[settings.speed]?.label || 'Custom';
    refreshDependent();
  });

  ext.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'select-username' && msg.username) {
      $('#username').value = msg.username;
      lookup(msg.username);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (current) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const initial = new URLSearchParams(location.search).get('username');
  if (initial) {
    const name = normalizeUsernameInput(initial);
    if (name) {
      $('#username').value = name;
      lookup(name);
    }
  }
  setStartEnabled();
  log('info', 'Ready. Keep this tab open while an archive runs.');
}

init();
