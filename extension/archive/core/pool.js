// Small concurrency limiter for media downloads.
export class Pool {
  constructor(size) {
    this.size = Math.max(1, size | 0);
    this.active = 0;
    this.waiters = [];
  }

  async run(fn) {
    while (this.active >= this.size) {
      await new Promise((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}
