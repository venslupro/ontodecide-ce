/**
 * @fileoverview Isolate-memory token buckets. Fast first-line limiting;
 * approximate by design (each isolate has its own buckets).
 */

/** Outcome of taking a token. */
export interface TakeResult {
  ok: boolean;
  /** Tokens left after the take. */
  remaining: number;
  /** Seconds until one token is available (0 when ok). */
  retryAfterSec: number;
}

/** Bucket parameters. */
export interface BucketSpec {
  capacity: number;
  refillPerSec: number;
}

/**
 * Computes a token bucket take. Shared by the in-memory limiter and the
 * EdgeGuard Durable Object.
 */
export function takeToken(
  state: {tokens: number; updatedAt: number} | undefined,
  spec: BucketSpec,
  nowMs: number,
): {state: {tokens: number; updatedAt: number}; result: TakeResult} {
  const prev = state ?? {tokens: spec.capacity, updatedAt: nowMs};
  const elapsed = Math.max(0, nowMs - prev.updatedAt) / 1000;
  const tokens = Math.min(
    spec.capacity,
    prev.tokens + elapsed * spec.refillPerSec,
  );
  if (tokens >= 1) {
    const next = {tokens: tokens - 1, updatedAt: nowMs};
    return {
      state: next,
      result: {ok: true, remaining: Math.floor(next.tokens), retryAfterSec: 0},
    };
  }
  const retryAfterSec = Math.max(
    1,
    Math.ceil((1 - tokens) / Math.max(spec.refillPerSec, 1e-9)),
  );
  return {
    state: {tokens, updatedAt: nowMs},
    result: {ok: false, remaining: 0, retryAfterSec},
  };
}

/** In-memory token bucket limiter, bounded in size. */
export class MemoryRateLimiter {
  private readonly buckets = new Map<
    string,
    {tokens: number; updatedAt: number}
  >();

  constructor(private readonly maxBuckets = 10_000) {}

  /** Takes one token from the named bucket. */
  take(key: string, spec: BucketSpec, nowMs: number): TakeResult {
    const {state, result} = takeToken(this.buckets.get(key), spec, nowMs);
    this.buckets.delete(key);
    this.buckets.set(key, state);
    if (this.buckets.size > this.maxBuckets) {
      // Evict the least recently used bucket (Map keeps insertion order).
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    return result;
  }
}
