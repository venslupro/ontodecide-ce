/**
 * @fileoverview Personal quotas. Each service counts its own scarce actions
 * locally and reports them through a `usage(ctx)` RPC; api-gateway merges
 * them into `GET /me` (修订说明书 12.7: no callback into identity-access).
 */

/** Personal quota keys shown in the web app. */
export const QUOTA_KEYS = [
  'objects',
  'links',
  'importRowsToday',
  'aiRecsToday',
  'mappingDraftsToday',
  'sessions',
] as const;

/** A personal quota key. */
export type QuotaKey = (typeof QUOTA_KEYS)[number];

/** Used vs limit. */
export interface Used {
  used: number;
  limit: number;
}

/** One quota reported by a service. */
export interface QuotaItem extends Used {
  key: QuotaKey;
}

/** Aggregated personal quotas (`GET /me`.quotas). */
export type Quotas = Record<QuotaKey, Used> & {
  /** Next UTC midnight, ISO 8601. */
  resetsAt: string;
};

/** Next UTC midnight after `now`, ISO 8601. */
export function nextUtcMidnight(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return d.toISOString();
}

/** Merges service reports into {@link Quotas}; missing keys become 0/0. */
export function mergeQuotas(items: readonly QuotaItem[], now: Date): Quotas {
  const out = {resetsAt: nextUtcMidnight(now)} as Quotas;
  for (const key of QUOTA_KEYS) out[key] = {used: 0, limit: 0};
  for (const item of items)
    out[item.key] = {used: item.used, limit: item.limit};
  return out;
}
