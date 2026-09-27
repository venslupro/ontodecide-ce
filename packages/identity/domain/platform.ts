/**
 * @fileoverview Platform-wide constants shown on the admin overview
 * (修订说明书 7.4): capacities and Cloudflare free-tier limits used for the
 * 80 % automatic sign-up stop.
 */

/** Maximum retained archives (估算口径: 140 ZIPs). */
export const ARCHIVE_CAPACITY = 140;

/** Account-wide daily free-tier limits checked hourly. */
export const FREE_TIER_DAILY = {
  workers: 100_000,
  d1Writes: 100_000,
  neurons: 10_000,
  queues: 10_000,
} as const;

/** Analytics metric keys. */
export type AnalyticsMetric = keyof typeof FREE_TIER_DAILY;

/** Share of a free-tier limit at which sign-up closes automatically. */
export const AUTO_CLOSE_RATIO = 0.8;

/** Whether an analytics snapshot crosses the automatic stop threshold. */
export function crossesAutoClose(
  snapshot: Partial<Record<AnalyticsMetric, number>>,
): boolean {
  return (Object.keys(FREE_TIER_DAILY) as AnalyticsMetric[]).some(
    k => (snapshot[k] ?? 0) >= FREE_TIER_DAILY[k] * AUTO_CLOSE_RATIO,
  );
}

/** Admin-list statuses accepted by the `status` filter. */
export const ADMIN_LIST_STATUSES = [
  'ACTIVE',
  'EXPIRED',
  'ARCHIVING',
  'ARCHIVE_ONLY',
] as const;
