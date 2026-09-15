/**
 * FIFO mutex. Serializes async work so concurrent claimers cannot
 * interleave check-then-set on the same ticket.
 */
export class Mutex {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
        return;
      }
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

export class KeyedMutex {
  private readonly locks = new Map<string, Mutex>();

  async runExclusive<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    let mutex = this.locks.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.locks.set(key, mutex);
    }
    return mutex.runExclusive(fn);
  }
}
