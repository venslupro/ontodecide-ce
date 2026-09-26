/**
 * @fileoverview Free-tier quota resources tracked by UsageGuard.
 */

/** Tracked free-tier resources. */
export const USAGE_RESOURCES = [
  'workers.requests',
  'd1.rowsWritten',
  'd1.rowsRead',
  'queues.ops',
  'kv.writes',
  'ai.neurons',
  'do.requests',
] as const;

/** A tracked resource. */
export type UsageResource = (typeof USAGE_RESOURCES)[number];

/** Daily free-tier limits (2026-09 verified values). */
export const USAGE_DAILY_LIMITS: Record<UsageResource, number> = {
  'workers.requests': 100_000,
  'd1.rowsWritten': 100_000,
  'd1.rowsRead': 5_000_000,
  'queues.ops': 10_000,
  'kv.writes': 1_000,
  'ai.neurons': 10_000,
  'do.requests': 100_000,
};

/** Threshold state: < warn normal, warn..stop warning, ≥ stop paused. */
export type UsageLevel = 'ok' | 'warn' | 'stop';

/** Current usage status. */
export interface UsageStatus {
  day: string;
  level: UsageLevel;
  /** Ratio 0..n per resource. */
  ratios: Partial<Record<UsageResource, number>>;
  used: Partial<Record<UsageResource, number>>;
}

/** Computes the level for a ratio given warn/stop thresholds. */
export function usageLevel(ratio: number, warn = 0.8, stop = 0.95): UsageLevel {
  if (ratio >= stop) return 'stop';
  if (ratio >= warn) return 'warn';
  return 'ok';
}
