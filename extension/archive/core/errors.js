// Classification of Instagram responses. The rules follow how instaloader
// (instaloadercontext.py), instagrapi (mixins/private.py) and gallery-dl
// (instagram.py request()) recognise blocks and rate limits.

export class IgError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'IgError';
    this.kind = kind; // see KIND
    Object.assign(this, details);
  }
}

export const KIND = Object.freeze({
  RATE_LIMIT: 'rate_limit', // wait and retry
  FATAL: 'fatal', // stop the job, keep resume point (checkpoint/challenge/login)
  NOT_FOUND: 'not_found',
  PRIVATE: 'private',
  FORBIDDEN: 'forbidden',
  TRANSIENT: 'transient', // network or 5xx; retry a few times
  BAD_RESPONSE: 'bad_response',
});

const FATAL_MESSAGES = ['checkpoint_required', 'challenge_required', 'feedback_required', 'login_required', 'consent_required'];

/**
 * @param {{status:number,url:string,redirected:boolean,text:string}} res
 * @returns {{json:any}|{error:IgError}}
 */
export function classifyResponse(res, { expectJson = true } = {}) {
  const url = res.url || '';
  if (res.redirected) {
    if (url.includes('/accounts/login')) {
      return { error: new IgError(KIND.FATAL, 'Instagram redirected to the login page. Log in to instagram.com in this browser and resume.', { reason: 'login' }) };
    }
    if (url.includes('/challenge')) {
      return { error: new IgError(KIND.FATAL, 'Instagram is asking for a security check (challenge). Open instagram.com, complete it, then resume.', { reason: 'challenge' }) };
    }
    if (/^https:\/\/www\.instagram\.com\/?(\?.*)?$/.test(url)) {
      return { error: new IgError(KIND.FATAL, 'Instagram redirected to the home page. The session may be logged out or blocked.', { reason: 'home' }) };
    }
  }

  let json = null;
  if (expectJson) {
    try {
      json = res.text ? JSON.parse(res.text) : null;
    } catch {
      json = null;
    }
  }
  const message = String(json?.message ?? '');
  const errorType = String(json?.error_type ?? '');

  if (res.status === 429 || /please wait a few minutes/i.test(message) || errorType === 'rate_limit_error') {
    return { error: new IgError(KIND.RATE_LIMIT, message || 'Too many requests (HTTP 429).', { status: res.status }) };
  }
  for (const fatal of FATAL_MESSAGES) {
    if (message === fatal || errorType === fatal || json?.[fatal]) {
      const extra = json?.feedback_message ? ` ${json.feedback_message}` : '';
      return { error: new IgError(KIND.FATAL, `Instagram stopped the session: ${fatal}.${extra} Open instagram.com, resolve any prompt, wait, then resume.`, { reason: fatal, status: res.status }) };
    }
  }
  if (errorType === 'sentry_block') {
    return { error: new IgError(KIND.FATAL, 'Instagram blocked this activity (sentry_block). Stop for a while before resuming.', { reason: errorType, status: res.status }) };
  }
  if (/not authorized to view user/i.test(message)) {
    return { error: new IgError(KIND.PRIVATE, 'This account is private and you do not follow it.', { status: res.status }) };
  }
  if (res.status === 401) {
    return { error: new IgError(KIND.FATAL, 'Instagram answered 401 Unauthorized. Log in to instagram.com and resume.', { reason: 'unauthorized', status: 401 }) };
  }
  if (res.status === 404) {
    return { error: new IgError(KIND.NOT_FOUND, message || 'Not found (HTTP 404).', { status: 404 }) };
  }
  if (res.status === 403) {
    return { error: new IgError(KIND.FORBIDDEN, message || 'Forbidden (HTTP 403).', { status: 403 }) };
  }
  if (res.status >= 500 || res.status === 0) {
    return { error: new IgError(KIND.TRANSIENT, `Server error (HTTP ${res.status}).`, { status: res.status }) };
  }
  if (res.status === 400) {
    return { error: new IgError(KIND.BAD_RESPONSE, message || 'Bad request (HTTP 400).', { status: 400, json }) };
  }
  if (res.status < 200 || res.status >= 300) {
    return { error: new IgError(KIND.BAD_RESPONSE, `Unexpected HTTP ${res.status}.`, { status: res.status }) };
  }
  if (expectJson) {
    if (json === null) {
      if (/<html/i.test(res.text || '')) {
        return { error: new IgError(KIND.FATAL, 'Instagram returned a web page instead of data. The session may be logged out.', { reason: 'html' }) };
      }
      return { error: new IgError(KIND.BAD_RESPONSE, 'Instagram returned an unreadable response.') };
    }
    if (json.status === 'fail') {
      return { error: new IgError(KIND.BAD_RESPONSE, message || 'Instagram reported a failure.', { json }) };
    }
  }
  return { json, text: res.text };
}
