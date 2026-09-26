/**
 * @fileoverview Usage status computation for UsageGuard.
 */

import {
  USAGE_DAILY_LIMITS,
  USAGE_RESOURCES,
  type UsageLevel,
  type UsageResource,
  type UsageStatus,
  usageLevel,
} from '@ontodecide/shared-kernel';
import {USAGE_THRESHOLDS} from '../contract';

/** Warn / stop ratios. */
export interface UsageThresholds {
  warn: number;
  stop: number;
}

function ratio(value: string | undefined, fallback: number): number {
  const n = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parses USAGE_WARN / USAGE_STOP vars (defaults 0.8 / 0.95). */
export function usageThresholds(warn?: string, stop?: string): UsageThresholds {
  const w = ratio(warn, USAGE_THRESHOLDS.warn);
  const s = ratio(stop, USAGE_THRESHOLDS.stop);
  return s >= w ? {warn: w, stop: s} : {...USAGE_THRESHOLDS};
}

const LEVEL_RANK: Record<UsageLevel, number> = {ok: 0, warn: 1, stop: 2};

/** Whether a value names a tracked resource. */
export function isUsageResource(value: unknown): value is UsageResource {
  return (
    typeof value === 'string' &&
    (USAGE_RESOURCES as readonly string[]).includes(value)
  );
}

/** Builds the status of one UTC day; the level is the worst resource level. */
export function computeUsageStatus(
  day: string,
  used: Partial<Record<UsageResource, number>>,
  thresholds: UsageThresholds = USAGE_THRESHOLDS,
): UsageStatus {
  const ratios: Partial<Record<UsageResource, number>> = {};
  let level: UsageLevel = 'ok';
  for (const [resource, n] of Object.entries(used) as [
    UsageResource,
    number,
  ][]) {
    const r = n / USAGE_DAILY_LIMITS[resource];
    ratios[resource] = r;
    const l = usageLevel(r, thresholds.warn, thresholds.stop);
    if (LEVEL_RANK[l] > LEVEL_RANK[level]) level = l;
  }
  return {day, level, ratios, used: {...used}};
}
