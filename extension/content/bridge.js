/*
 * Gram Archiver: instagram.com bridge (content script).
 *
 * Carries out same-origin requests to www.instagram.com for the archiver page.
 * In Manifest V3 (Chrome and Firefox) a content-script fetch runs in the context of
 * the page, so it carries the user's own instagram.com cookies and origin, the
 * same as the Instagram web app's own requests. No data is sent anywhere else.
 *
 * Content scripts cannot be ES modules, so this file is self-contained.
 */
(() => {
  if (window.__gramArchiverBridge) return;
  window.__gramArchiverBridge = true;

  const ext = globalThis.browser ?? globalThis.chrome;

  // The web app's application id, sent by the Instagram web client and by
  // gallery-dl, yt-dlp, instaloader and instagrapi alike.
  const IG_APP_ID = '936619743392459';
  // X-ASBD-ID value used by gallery-dl's REST client and instagrapi.
  const ASBD_ID = '129477';

  let wwwClaim = null;

  function getCookie(name) {
    const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  }

  function currentClaim() {
    if (wwwClaim) return wwwClaim;
    try {
      return sessionStorage.getItem('www-claim-v2') || '0';
    } catch {
      return '0';
    }
  }

  function buildUrl(req) {
    const url = new URL(req.url, location.origin);
    if (url.origin !== location.origin) throw new Error(`Refusing cross-origin request to ${url.origin}`);
    for (const [key, value] of Object.entries(req.query || {})) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
      else url.searchParams.set(key, String(value));
    }
    return url;
  }

  function buildHeaders(req) {
    const headers = new Headers();
    if (req.kind === 'html') {
      headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      return headers;
    }
    headers.set('Accept', '*/*');
    headers.set('X-IG-App-ID', IG_APP_ID);
    headers.set('X-ASBD-ID', ASBD_ID);
    headers.set('X-IG-WWW-Claim', currentClaim());
    headers.set('X-Requested-With', 'XMLHttpRequest');
    const csrf = getCookie('csrftoken');
    if (csrf) headers.set('X-CSRFToken', csrf);
    if (req.kind === 'graphql') {
      if (req.lsd) headers.set('X-FB-LSD', req.lsd);
      if (req.friendlyName) headers.set('X-FB-Friendly-Name', req.friendlyName);
    }
    return headers;
  }

  function buildBody(req) {
    if (!req.form) return undefined;
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(req.form)) {
      if (value === undefined || value === null) continue;
      body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return body;
  }

  let hiResSet = false;
  // Instagram sizes image candidates from the viewport cookies `wd` and `dpr`.
  // HOAIAN2/Instagram-Downloader sets wd=1920x980 and dpr=2 to receive the largest
  // candidates; this does the same when the user enables "highest image resolution".
  function setResolutionCookies() {
    if (hiResSet) return;
    hiResSet = true;
    document.cookie = 'wd=1920x980; path=/; secure; samesite=lax';
    document.cookie = 'dpr=2; path=/; secure; samesite=lax';
  }

  async function doRequest(req) {
    if (req.hiRes) setResolutionCookies();
    const url = buildUrl(req);
    const method = req.method || (req.form ? 'POST' : 'GET');
    const res = await fetch(url, {
      method,
      headers: buildHeaders(req),
      body: method === 'GET' ? undefined : buildBody(req),
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    });
    const claim = res.headers.get('x-ig-set-www-claim');
    if (claim) wwwClaim = claim;
    const text = await res.text();
    const headers = {};
    res.headers.forEach((value, key) => { headers[key] = value; });
    return {
      status: res.status,
      ok: res.ok,
      url: res.url,
      redirected: res.redirected,
      headers,
      text,
    };
  }

  function pageInfo() {
    let html = '';
    for (const script of document.querySelectorAll('script')) {
      const t = script.textContent;
      if (t && (t.includes('DTSGInitialData') || t.includes('"LSD"') || t.includes('IG_USER_EIMU'))) html += t;
    }
    const pick = (re) => (html.match(re) || [])[1] || null;
    return {
      href: location.href,
      hasCsrf: Boolean(getCookie('csrftoken')),
      // ds_user_id is the logged-in account's id; it is readable from page script on
      // instagram.com when set. Its absence does not prove the user is logged out.
      viewerId: getCookie('ds_user_id'),
      fbDtsg: pick(/"DTSGInitialData",\[\],\{[^{}]*"token":"([^"]+)"/),
      lsd: pick(/"LSD",\[\],\{[^{}]*"token":"([^"]+)"/),
      av: pick(/"IG_USER_EIMU":"?(\d+)/),
    };
  }

  ext.runtime.onConnect.addListener((port) => {
    if (port.name !== 'gram-bridge') return;
    port.onMessage.addListener(async (msg) => {
      if (!msg || typeof msg.id === 'undefined') return;
      try {
        let result;
        if (msg.type === 'request') result = await doRequest(msg.req);
        else if (msg.type === 'pageInfo') result = pageInfo();
        else if (msg.type === 'ping') result = { pong: true, href: location.href };
        else throw new Error(`Unknown bridge message ${msg.type}`);
        port.postMessage({ id: msg.id, ok: true, result });
      } catch (error) {
        try {
          port.postMessage({ id: msg.id, ok: false, error: String(error?.message || error) });
        } catch {
          /* port closed */
        }
      }
    });
  });

  // ---- "Archive" button on profile pages -------------------------------------------------

  const RESERVED = new Set([
    'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal',
    'developer', 'web', 'api', 'graphql', 'challenge', 'emails', 'session', 'privacy', 'terms',
    'static', 'press', 'topics', 'directory', 'lite', 'ar', 'threads', 'oauth', 'nametag',
    'invites', 'qr', 'your_activity', 'meta-verified', 'popular',
  ]);

  function profileFromLocation() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (!parts.length || parts.length > 2) return null;
    const name = parts[0];
    if (RESERVED.has(name.toLowerCase())) return null;
    if (parts[1] && !['reels', 'tagged', 'saved', 'feed'].includes(parts[1])) return null;
    return /^[A-Za-z0-9._]{1,30}$/.test(name) ? name.toLowerCase() : null;
  }

  let button = null;
  let enabled = true;
  let lastHref = '';

  function ensureButton() {
    const username = enabled ? profileFromLocation() : null;
    if (!username) {
      button?.remove();
      button = null;
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.className = 'gram-archiver-fab';
      button.type = 'button';
      button.addEventListener('click', () => {
        const name = button.dataset.username;
        ext.runtime.sendMessage({ type: 'open-archiver', username: name }).catch(() => {});
      });
      document.documentElement.appendChild(button);
    }
    button.dataset.username = username;
    button.textContent = `Archive @${username}`;
    button.title = 'Open Gram Archiver for this profile';
  }

  function tick() {
    if (location.href === lastHref && (button || !enabled)) return;
    lastHref = location.href;
    ensureButton();
  }

  ext.storage?.local.get('settings').then((s) => {
    enabled = s?.settings?.profileButton !== false;
    tick();
  }).catch(() => tick());

  ext.storage?.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    enabled = changes.settings.newValue?.profileButton !== false;
    lastHref = '';
    tick();
  });

  // Instagram is a single-page app; watch for in-app navigation.
  setInterval(tick, 1000);
})();
