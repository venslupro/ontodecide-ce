/**
 * @fileoverview Local usage accumulation. Counts are batched and reported
 * to UsageGuard every 100 events or 30 seconds so the guard itself does not
 * consume the Durable Object request budget.
 */

import type {UsageResource} from './usage';

/** Reports accumulated usage. */
export type UsageReporter = (
  batch: {resource: UsageResource; n: number}[],
) => Promise<unknown>;

/** Accumulates usage in isolate memory and flushes in batches. */
export class UsageMeter {
  private pending = new Map<UsageResource, number>();
  private events = 0;
  private lastFlush: number;

  constructor(
    private readonly reporter: UsageReporter,
    private readonly flushEvery = 100,
    private readonly flushMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {
    this.lastFlush = now();
  }

  /** Records n units; returns a flush promise when a flush was triggered. */
  record(resource: UsageResource, n = 1): Promise<void> | undefined {
    this.pending.set(resource, (this.pending.get(resource) ?? 0) + n);
    this.events++;
    if (
      this.events >= this.flushEvery ||
      this.now() - this.lastFlush >= this.flushMs
    ) {
      return this.flush();
    }
    return undefined;
  }

  /** Flushes pending counts; errors are swallowed (best effort). */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = [...this.pending].map(([resource, n]) => ({resource, n}));
    this.pending.clear();
    this.events = 0;
    this.lastFlush = this.now();
    try {
      await this.reporter(batch);
    } catch {
      // Best effort: losing a batch only under-counts.
    }
  }
}
