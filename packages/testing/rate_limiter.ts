/**
 * @fileoverview Fake Rate Limiting binding: a fixed window per key.
 */

/** Fake `RateLimit` binding. */
export class FakeRateLimiter {
  private readonly hits = new Map<string, number>();

  constructor(private readonly max: number) {}

  async limit_(key: string): Promise<{success: boolean}> {
    const n = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, n);
    return {success: n <= this.max};
  }

  /** Clears all windows (a new period). */
  reset(): void {
    this.hits.clear();
  }

  /** Returns this as the Workers `RateLimit` type. */
  asRateLimit(): RateLimit {
    return {limit: ({key}: {key: string}) => this.limit_(key)} as RateLimit;
  }
}
