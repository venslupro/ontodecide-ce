/**
 * @fileoverview Collects items and flushes them inside requestAnimationFrame
 * at most once per `minIntervalMs` (realtime rendering ≤ 1/s).
 */

/** Scheduler surface (injectable for tests). */
export interface BatcherEnv {
  now(): number;
  raf(cb: () => void): unknown;
  setTimeout(cb: () => void, ms: number): unknown;
}

const defaultEnv: BatcherEnv = {
  now: () => Date.now(),
  raf: cb =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => cb())
      : setTimeout(cb, 16),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
};

/** A batcher handle. */
export interface FrameBatcher<T> {
  push(item: T): void;
  /** Flushes synchronously (tests, teardown). */
  flushNow(): void;
  size(): number;
  dispose(): void;
}

/** Creates a batcher calling `flush(items)` at most once per interval. */
export function createFrameBatcher<T>(
  flush: (items: T[]) => void,
  minIntervalMs = 1000,
  env: BatcherEnv = defaultEnv,
): FrameBatcher<T> {
  let queue: T[] = [];
  let last = Number.NEGATIVE_INFINITY;
  let scheduled = false;
  let disposed = false;

  const run = () => {
    scheduled = false;
    if (disposed || queue.length === 0) return;
    const items = queue;
    queue = [];
    last = env.now();
    flush(items);
  };

  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    const wait = Math.max(0, last + minIntervalMs - env.now());
    if (wait === 0) env.raf(run);
    else env.setTimeout(() => env.raf(run), wait);
  };

  return {
    push(item) {
      queue.push(item);
      schedule();
    },
    flushNow() {
      run();
    },
    size: () => queue.length,
    dispose() {
      disposed = true;
      queue = [];
    },
  };
}
