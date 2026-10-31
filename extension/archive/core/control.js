// Pause / resume / cancel for a running job, plus abortable sleep.

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export class JobControl {
  constructor() {
    this.abort = new AbortController();
    this.paused = false;
    this._resume = null;
    this._pausePromise = null;
    this.listeners = new Set();
  }

  get signal() { return this.abort.signal; }
  get cancelled() { return this.abort.signal.aborted; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  pause() {
    if (this.paused || this.cancelled) return;
    this.paused = true;
    this._pausePromise = new Promise((resolve) => { this._resume = resolve; });
    this._emit();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this._resume?.();
    this._resume = null;
    this._pausePromise = null;
    this._emit();
  }

  cancel() {
    this.abort.abort();
    this.resume();
    this._emit();
  }

  /** Await between units of work: blocks while paused, throws once cancelled. */
  async checkpoint() {
    if (this.cancelled) throw new CancelledError();
    while (this.paused) {
      await this._pausePromise;
      if (this.cancelled) throw new CancelledError();
    }
  }

  sleep(ms) { return sleep(ms, this.signal); }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    function onAbort() {
      clearTimeout(timer);
      reject(new CancelledError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
