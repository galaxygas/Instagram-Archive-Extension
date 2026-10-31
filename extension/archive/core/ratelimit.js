// Request pacing for Instagram API calls.
//
// Defaults follow the projects that have been archiving Instagram the longest:
// - gallery-dl waits a random 6-12 s between Instagram requests (request_interval)
//   and 60 s after HTTP 429 (sleep-429).
// - instaloader allows 75 non-GraphQL requests per 11-minute sliding window.

export const WINDOW_MS = 11 * 60 * 1000;
export const WINDOW_MAX = 75;
export const BASE_429_MS = 60 * 1000;
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

export class RateLimiter {
  /**
   * @param {{min:number,max:number,windowCap?:boolean,now?:()=>number,random?:()=>number}} opts
   *   min/max in seconds.
   */
  constructor({ min, max, windowCap = true, now = Date.now, random = Math.random }) {
    this.setRange(min, max);
    this.windowCap = windowCap;
    this.now = now;
    this.random = random;
    this.last = 0;
    this.history = [];
    this.backoffLevel = 0;
    this.requestCount = 0;
  }

  setRange(min, max) {
    this.minMs = Math.max(0, Number(min) * 1000);
    this.maxMs = Math.max(this.minMs, Number(max) * 1000);
  }

  /** Milliseconds to wait before the next request is allowed. */
  nextDelay() {
    const now = this.now();
    let wait = 0;
    if (this.last) {
      const gap = this.minMs + this.random() * (this.maxMs - this.minMs);
      wait = Math.max(0, this.last + gap - now);
    }
    if (this.windowCap) {
      this.history = this.history.filter((t) => now - t < WINDOW_MS);
      if (this.history.length >= WINDOW_MAX) {
        wait = Math.max(wait, this.history[0] + WINDOW_MS - now);
      }
    }
    return Math.ceil(wait);
  }

  /** Record that a request was sent. */
  mark() {
    const now = this.now();
    this.last = now;
    this.history.push(now);
    this.requestCount += 1;
  }

  /** Delay after a rate-limit answer: 60 s, then doubling, capped at 15 min. */
  backoffDelay() {
    const ms = Math.min(MAX_BACKOFF_MS, BASE_429_MS * 2 ** this.backoffLevel);
    this.backoffLevel += 1;
    return ms;
  }

  /** Call after a successful response. */
  success() {
    this.backoffLevel = 0;
  }
}
