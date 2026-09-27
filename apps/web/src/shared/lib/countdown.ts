/**
 * @fileoverview Server-corrected countdown (前端详细设计 6.3.2 试用倒计时).
 *
 * - The remaining time uses `now + clockSkewMs` (skew estimated from the
 *   response `Date` header), so a wrong local clock does not matter.
 * - More than 1 hour left: re-render once a minute (aligned to the minute
 *   boundary of the remaining time); ≤ 1 hour: every second.
 * - While the page is hidden the timer pauses; on return it recomputes at
 *   once.
 * - `onZero` fires once when the remaining time reaches 0.
 */

import {useEffect, useRef, useState} from 'react';

/** One hour in ms. */
export const HOUR_MS = 3_600_000;

/** Remaining ms until `until` (epoch ms) at server-corrected `now`. */
export function remainingMs(
  until: number | null | undefined,
  nowMs: number,
  skewMs = 0,
): number {
  if (until === null || until === undefined || !Number.isFinite(until))
    return 0;
  return Math.max(0, until - (nowMs + skewMs));
}

/**
 * Delay until the next re-render: per second within the last hour, else up
 * to the next whole minute of the remaining time. null when finished.
 */
export function nextTickDelay(remaining: number): number | null {
  if (remaining <= 0) return null;
  if (remaining <= HOUR_MS) {
    const d = remaining % 1000;
    return d === 0 ? 1000 : d;
  }
  const d = remaining % 60_000;
  return d === 0 ? 60_000 : d;
}

/** Fraction of the period elapsed (0..1) between `start` and `end`. */
export function elapsedFraction(
  start: number,
  end: number,
  nowMs: number,
  skewMs = 0,
): number {
  if (!(end > start)) return 1;
  const f = (nowMs + skewMs - start) / (end - start);
  return Math.max(0, Math.min(1, f));
}

/** Minimal document surface for visibility handling (injectable). */
interface VisibilityDoc {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
  removeEventListener(type: 'visibilitychange', cb: () => void): void;
}

/**
 * Remaining ms until `until`, re-rendering per {@link nextTickDelay},
 * paused while hidden. `onZero` is called once when it reaches 0.
 */
export function useRemaining(
  until: number | null | undefined,
  skewMs: number,
  onZero?: () => void,
): number {
  const compute = () => remainingMs(until, Date.now(), skewMs);
  const [left, setLeft] = useState(compute);
  const zeroRef = useRef(onZero);
  zeroRef.current = onZero;
  const firedFor = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (until === null || until === undefined) {
      setLeft(0);
      return undefined;
    }
    const doc: VisibilityDoc | undefined =
      typeof document === 'undefined' ? undefined : document;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      const r = remainingMs(until, Date.now(), skewMs);
      setLeft(r);
      if (r <= 0) {
        if (firedFor.current !== until) {
          firedFor.current = until;
          zeroRef.current?.();
        }
        return;
      }
      if (doc?.visibilityState === 'hidden') return;
      const delay = nextTickDelay(r);
      if (delay !== null) timer = setTimeout(tick, delay);
    };
    const onVis = () => {
      if (doc?.visibilityState === 'hidden') clearTimeout(timer);
      else tick();
    };
    tick();
    doc?.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(timer);
      doc?.removeEventListener('visibilitychange', onVis);
    };
  }, [until, skewMs]);

  return left;
}
