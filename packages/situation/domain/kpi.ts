/**
 * @fileoverview KPI time-series helpers: 5-minute buckets, the value 24 h
 * ago, and the 24-point hourly sparkline.
 */

import {DAY_MS, HOUR_MS, MINUTE_MS} from '@ontodecide/shared-kernel';
import type {MetricPoint} from '../contract';

/** Metric point in epoch milliseconds. */
export interface RawPoint {
  ts: number;
  value: number;
}

/** Metric point granularity. */
export const METRIC_BUCKET_MS = 5 * MINUTE_MS;

/** Tolerance around "24 h ago" when picking the previous value. */
export const PREVIOUS_TOLERANCE_MS = HOUR_MS;

/** Start of the 5-minute bucket containing `ms`. */
export function bucket5m(ms: number): number {
  return Math.floor(ms / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
}

/** Metric key used for a KPI in sit_metric_point. */
export function kpiMetric(kpiId: string): string {
  return `kpi:${kpiId}`;
}

/**
 * The value closest to 24 h before `nowMs`, within ±1 h; null when no
 * point is close enough.
 */
export function previousValue(
  points: readonly RawPoint[],
  nowMs: number,
): number | null {
  const target = nowMs - DAY_MS;
  let best: RawPoint | null = null;
  for (const p of points) {
    const d = Math.abs(p.ts - target);
    if (d > PREVIOUS_TOLERANCE_MS) continue;
    if (!best || d < Math.abs(best.ts - target)) best = p;
  }
  return best ? best.value : null;
}

/**
 * Up to 24 hourly points covering the last 24 h (oldest first): the last
 * value recorded in each hour; hours without data are skipped.
 */
export function sparkline(
  points: readonly RawPoint[],
  nowMs: number,
): number[] {
  return hourly(points, nowMs - DAY_MS, nowMs).map(p => p.value);
}

/** Downsamples to the last value per hour within [fromMs, toMs]. */
export function hourly(
  points: readonly RawPoint[],
  fromMs: number,
  toMs: number,
): RawPoint[] {
  const byHour = new Map<number, RawPoint>();
  for (const p of points) {
    if (p.ts <= fromMs || p.ts > toMs) continue;
    const h = Math.floor(p.ts / HOUR_MS) * HOUR_MS;
    const cur = byHour.get(h);
    if (!cur || p.ts >= cur.ts) byHour.set(h, p);
  }
  return [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

/** Trend window length. */
export function trendRangeMs(range: '24h' | '7d'): number {
  return range === '7d' ? 7 * DAY_MS : DAY_MS;
}

/**
 * Builds a trend: raw 5-minute points for 24 h, hourly points for 7 d.
 */
export function trend(
  points: readonly RawPoint[],
  range: '24h' | '7d',
  nowMs: number,
): MetricPoint[] {
  const from = nowMs - trendRangeMs(range);
  const selected =
    range === '7d'
      ? hourly(points, from, nowMs)
      : [...points]
          .filter(p => p.ts > from && p.ts <= nowMs)
          .sort((a, b) => a.ts - b.ts);
  return selected.map(p => ({
    ts: new Date(p.ts).toISOString(),
    value: p.value,
  }));
}
