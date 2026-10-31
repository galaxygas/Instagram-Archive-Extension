// End-to-end test: loads the unpacked extension in Chromium (Playwright), serves a
// simulated instagram.com and CDN, archives a profile through the real UI and checks
// what was saved. Run with: npm run test:e2e   (needs Playwright + Chromium and ffmpeg)
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { createMock, USERNAME, CDN_HOST } from './mock-instagram.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const EXT = resolve('extension');
const SHOTS = process.env.SHOTS_DIR || null;
const userDataDir = mkdtempSync(join(tmpdir(), 'ga-profile-'));
const downloads = mkdtempSync(join(tmpdir(), 'ga-downloads-'));

// Make Chromium save downloads into a known folder without prompting.
mkdirSync(join(userDataDir, 'Default'), { recursive: true });
const { writeFileSync } = await import('node:fs');
writeFileSync(join(userDataDir, 'Default', 'Preferences'), JSON.stringify({
  download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
  savefile: { default_directory: downloads },
}));

const mock = createMock();

// The browser's download manager does not go through Playwright's request routing, so
// the CDN is also served by a local HTTPS server that the CDN hostname is mapped to.
const certDir = mkdtempSync(join(tmpdir(), 'ga-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${CDN_HOST}`,
  '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { stdio: 'ignore' });
const server = createServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, mock.cdnServer);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium',
  acceptDownloads: true,
  viewport: { width: 1360, height: 900 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP ${CDN_HOST} 127.0.0.1:${port}`,
    '--ignore-certificate-errors',
    '--no-proxy-server',
  ],
});

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let failed = false;
try {
  await context.route('https://www.instagram.com/**', mock.handleInstagram);
  await context.route(/https:\/\/[^/]*\.(cdninstagram\.com|fbcdn\.net)\//, mock.handleCdn);

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  console.log('extension id', extId);

  // An instagram.com tab for the bridge (as a logged-in user would have).
  const ig = await context.newPage();
  await ig.goto(`https://www.instagram.com/${USERNAME}/`);
  await ig.waitForSelector('.gram-archiver-fab', { timeout: 10000 });
  console.log('profile button shown:', await ig.textContent('.gram-archiver-fab'));

  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()); });
  page.on('pageerror', (e) => { console.log('[page exception]', e.message); failed = true; });
  await page.goto(`chrome-extension://${extId}/options/options.html`);
  // Fast pacing for the test run.
  await page.click('input[value="custom"]');
  await page.fill('#customMin', '0');
  await page.dispatchEvent('#customMin', 'change');
  await page.fill('#customMax', '0.2');
  await page.dispatchEvent('#customMax', 'change');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'options.png'), fullPage: true });

  await page.goto(`chrome-extension://${extId}/archive/archive.html?username=${USERNAME}`);
  await page.waitForSelector('#profileCard .name', { timeout: 20000 });
  console.log('profile card:', (await page.textContent('#profileCard .name')).trim());

  // Select everything except live, plus comments, captions and max quality off.
  await page.click('[data-preset="all"]');
  await page.$$eval('details.card', (ds) => ds.forEach((d) => { d.open = true; }));
  await page.check('[data-opt="extras.comments"]');
  await page.check('[data-opt="metadata.captions"]');
  await page.check('[data-opt="media.covers"]');
  await page.check('[data-opt="media.audio"]');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'archive-setup.png'), fullPage: true });

  // Playwright stores downloads under random names; remember what the extension asked for.
  await page.evaluate(() => {
    window.__requested = {};
    const original = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = async (opts) => {
      const id = await original(opts);
      window.__requested[id] = opts.filename;
      return id;
    };
  });
  await page.click('#startBtn');
  await page.waitForFunction(() => {
    const t = document.querySelector('#runStatus')?.textContent || '';
    return ['Finished', 'Failed', 'Stopped by Instagram'].includes(t);
  }, null, { timeout: 180000 });
  const status = await page.textContent('#runStatus');
  const logText = await page.$$eval('#log li', (lis) => lis.map((li) => `${li.className}: ${li.textContent}`));
  console.log(logText.join('\n'));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'archive-done.png'), fullPage: true });
  assert.equal(status, 'Finished');

  const items = await page.evaluate(async () => (await chrome.downloads.search({})).map((d) => ({ id: d.id, requested: window.__requested[d.id], filename: d.filename, state: d.state, url: d.url.slice(0, 60) })));
  const complete = items.filter((d) => d.state === 'complete');
  console.log(`downloads: ${complete.length} complete of ${items.length}`);
  const failedDl = items.filter((d) => d.state !== 'complete');
  assert.equal(failedDl.length, 0, `incomplete downloads: ${JSON.stringify(failedDl)}`);

  const { copyFileSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  for (const d of complete) {
    assert.ok(d.requested, `download ${d.id} has no requested filename`);
    const target = join(downloads, d.requested);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(d.filename, target);
  }
  const files = existsSync(downloads) ? walk(downloads).map((f) => relative(downloads, f)) : [];
  console.log(files.sort().join('\n'));
  const has = (re) => files.some((f) => re.test(f));
  const base = `Gram Archiver/${USERNAME}/`;
  const expectations = [
    [`${base}profile/profile.json`, /profile\/profile\.json$/],
    ['profile picture', /profile\/profile_picture_\d{4}-\d\d-\d\d\.jpg$/],
    ['posts image', /posts\/2023-11-13_TEST1\.jpg$/],
    ['carousel item 2 video', /posts\/2023-11-11_TEST3_2\.mp4$/],
    ['post sidecar', /posts\/2023-11-13_TEST1\.json$/],
    ['caption txt', /posts\/2023-11-13_TEST1\.txt$/],
    ['comments file', /posts\/2023-11-13_TEST1_comments\.json$/],
    ['reel video', /reels\/2023-11-14_REEL1\.mp4$/],
    ['reel cover', /reels\/2023-11-14_REEL1_cover\.jpg$/],
    ['reel audio', /reels\/2023-11-14_REEL1_audio\.m4a$/],
    ['tagged', /tagged\/.*TEST9\.jpg$/],
    ['story', /stories\/.*\.jpg$/],
    ['highlight folder sanitized', /highlights\/Food_Drinks_17900000000000002\/_cover\.jpg$/],
    ['highlight video', /highlights\/Travel_17900000000000001\/.*\.mp4$/],
    ['followers', /data\/followers\.(json|csv)$/],
    ['media csv', /data\/media\.csv$/],
    ['comments csv', /data\/comments\.csv$/],
    ['viewer', new RegExp(`${USERNAME.replace('.', '\\.')}/index\\.html$`)],
    ['viewer data', /viewer\/archive-data\.js$/],
  ];
  for (const [name, re] of expectations) assert.ok(has(re), `missing ${name}`);
  const followers = JSON.parse(readFileSync(join(downloads, base, 'data', 'followers.json'), 'utf8'));
  assert.equal(followers.length, 3);
  const csv = readFileSync(join(downloads, base, 'data', 'comments.csv'), 'utf8');
  assert.ok(csv.includes(`"'=cool, ""quoted"""`), 'CSV escapes and neutralizes formulas');

  // Bridge requests carried the web app headers.
  const apiReq = mock.requests.find((r) => r.path.startsWith('/api/v1/feed/user/'));
  assert.equal(apiReq.headers['x-ig-app-id'], '936619743392459');
  assert.equal(apiReq.headers['x-csrftoken'], 'CSRF123');
  assert.equal(apiReq.headers['x-requested-with'], 'XMLHttpRequest');
  const clips = mock.requests.find((r) => r.path.startsWith('/api/v1/clips/user/'));
  assert.equal(clips.method, 'POST');

  // Viewer renders from file://
  const viewer = await context.newPage();
  viewer.on('pageerror', (e) => { console.log('[viewer exception]', e.message); failed = true; });
  await viewer.goto(`file://${join(downloads, base, 'index.html')}`);
  await viewer.waitForSelector('.tile', { timeout: 10000 });
  const tiles = await viewer.$$eval('.tile', (t) => t.length);
  console.log('viewer tiles:', tiles);
  assert.equal(tiles, mock.counts.posts);
  if (SHOTS) await viewer.screenshot({ path: join(SHOTS, 'viewer.png'), fullPage: false });
  await viewer.click('.tile');
  await viewer.waitForSelector('.modal.open .sheet');
  if (SHOTS) await viewer.screenshot({ path: join(SHOTS, 'viewer-post.png') });

  // Second run: everything is skipped as already archived.
  await page.click('#startBtn');
  await page.waitForFunction(() => document.querySelector('#runStatus')?.textContent === 'Finished' && document.querySelector('#log').textContent.includes('Posts: done (0 saved'), null, { timeout: 120000 });
  console.log('second run skipped existing items');

  // Third run: ZIP output in parts (the mode Firefox uses), everything re-downloaded.
  await page.$$eval('details.card', (ds) => ds.forEach((d) => { d.open = true; }));
  await page.check('input[name="outputMode"][value="zip"]');
  await page.uncheck('[data-opt="output.zipStream"]');
  await page.uncheck('[data-opt="filters.skipExisting"]');
  await page.uncheck('[data-opt="extras.comments"]');
  await page.click('[data-preset="media"]');
  await page.click('#startBtn');
  await page.waitForFunction(() => /Saved test\.account\/.*\.part001\.zip/.test(document.querySelector('#log').textContent)
    && document.querySelector('#runStatus')?.textContent === 'Finished', null, { timeout: 120000 });
  const zips = await page.evaluate(async () => (await chrome.downloads.search({})).filter((d) => d.state === 'complete' && /\.part\d{3}\.zip$/.test(window.__requested[d.id] || '')).map((d) => ({ requested: window.__requested[d.id], filename: d.filename })));
  assert.equal(zips.length, 1, 'one ZIP part for a small archive');
  const listing = execFileSync('unzip', ['-Z1', zips[0].filename]).toString().trim().split('\n');
  execFileSync('unzip', ['-tq', zips[0].filename]);
  console.log(`zip ${zips[0].requested}: ${listing.length} entries`);
  for (const re of [/^test\.account\/posts\/2023-11-13_TEST1\.jpg$/, /^test\.account\/reels\/2023-11-14_REEL1\.mp4$/, /^test\.account\/index\.html$/, /^test\.account\/highlights\/Travel_17900000000000001\//]) {
    assert.ok(listing.some((n) => re.test(n)), `zip is missing ${re}`);
  }

  // Popup renders.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 300 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'popup.png') });

  console.log(failed ? 'E2E FAILED (page exceptions)' : 'E2E PASSED');
} catch (error) {
  failed = true;
  console.error('E2E FAILED:', error);
} finally {
  await context.close();
  server.close();
  process.exitCode = failed ? 1 : 0;
}
