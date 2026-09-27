/**
 * @fileoverview Countdown math: skew correction, tick cadence (per minute
 * above 1 h, per second below), elapsed fraction.
 */

import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  elapsedFraction,
  HOUR_MS,
  nextTickDelay,
  remainingMs,
  useRemaining,
} from './countdown';

describe('countdown math', () => {
  it('corrects the local clock with the server skew', () => {
    expect(remainingMs(10_000, 4_000, 0)).toBe(6_000);
    expect(remainingMs(10_000, 4_000, 5_000)).toBe(1_000);
    expect(remainingMs(10_000, 4_000, 7_000)).toBe(0);
    expect(remainingMs(null, 0)).toBe(0);
  });

  it('ticks per minute above one hour and per second below', () => {
    expect(nextTickDelay(2 * HOUR_MS + 30_500)).toBe(30_500);
    expect(nextTickDelay(2 * HOUR_MS)).toBe(60_000);
    expect(nextTickDelay(HOUR_MS)).toBe(1000);
    expect(nextTickDelay(59_250)).toBe(250);
    expect(nextTickDelay(0)).toBeNull();
  });

  it('computes the elapsed fraction', () => {
    expect(elapsedFraction(0, 100, 25)).toBe(0.25);
    expect(elapsedFraction(0, 100, 200)).toBe(1);
    expect(elapsedFraction(0, 100, 10, 40)).toBe(0.5);
  });
});

describe('useRemaining', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('counts down and fires onZero once', () => {
    const onZero = vi.fn();
    const until = Date.now() + 3_000;
    const {result} = renderHook(() => useRemaining(until, 0, onZero));
    expect(result.current).toBe(3_000);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(2_000);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(0);
    expect(onZero).toHaveBeenCalledTimes(1);
  });

  it('uses the skew: server ahead means less time left', () => {
    const until = Date.now() + 2 * HOUR_MS;
    const {result} = renderHook(() => useRemaining(until, 30 * 60_000));
    expect(result.current).toBe(1.5 * HOUR_MS);
  });
});
