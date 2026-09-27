/**
 * @fileoverview Situation view model and the pure realtime merge applied to
 * the overview cache (前端详细设计 §增量合并与渲染节流): KPIs overwrite by
 * id, alerts dedupe by id and go to the head of the list (≤ 200 kept),
 * recommendation messages update the pending list. The shared stream
 * (`shared/ws`, ≤ 1 render per second) merges KPI / alert / snapshot frames
 * and calls {@link mergeRecommendationFrames} through a registered merger.
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import type {Quotas} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  KpiTrend,
  KpiValue,
  RecommendationSummary,
  SituationOverview,
} from '@ontodecide/situation/contract';

/** A pending recommendation as listed on the cockpit. */
export type PendingRec = Pick<
  RecommendationDto,
  'id' | 'status' | 'summary' | 'confidence' | 'rankedBy' | 'focus'
> &
  Partial<Pick<RecommendationDto, 'candidates' | 'ranking' | 'model'>> & {
    expectedImpact?: number;
    createdAt: string;
    expiresAt: string;
  };

/**
 * `GET /situation/overview` as served by the gateway BFF: SITUATION.overview
 * + DECISION.listRecommendations(Proposed, 5) + quotas.
 */
export type OverviewView = SituationOverview & {
  pendingRecommendations?: PendingRec[];
  quotas?: Quotas;
};

/** Alerts kept in the live stream. */
export const ALERT_KEEP = 200;

function asArray<T>(d: unknown): T[] {
  return Array.isArray(d) ? (d as T[]) : d ? [d as T] : [];
}

/** Severity ordering (higher first). */
export const SEVERITY_RANK: Record<AlertDto['severity'], number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** Sorts alerts most severe first, then newest first; keeps 200. */
export function sortAlertsBySeverity(list: readonly AlertDto[]): AlertDto[] {
  return [...list]
    .sort((a, b) => {
      const s =
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
      if (s !== 0) return s;
      return a.raisedAt < b.raisedAt ? 1 : a.raisedAt > b.raisedAt ? -1 : 0;
    })
    .slice(0, ALERT_KEEP);
}

function summaryToPending(r: RecommendationSummary): PendingRec {
  return {
    id: r.id,
    status: r.status as PendingRec['status'],
    summary: r.summary,
    confidence: r.confidence,
    rankedBy: r.rankedBy,
    focus: r.focus,
    expectedImpact: r.expectedImpact,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/**
 * Applies `recommendation` frames to the cockpit's pending list (pure):
 * Proposed items go to the head (deduplicated by id), decided or expired
 * ones leave the list, and the impacted objects follow the newest
 * simulation. KPI / alert / snapshot frames are merged by the shared
 * stream (`shared/ws`); this merger only adds what it does not know.
 */
export function mergeRecommendationFrames(
  prev: OverviewView | undefined,
  frames: readonly {type: string; data: unknown}[],
): OverviewView | undefined {
  if (!prev) return prev;
  let ov = prev;
  for (const f of frames) {
    if (f.type !== 'recommendation') continue;
    const recs = asArray<RecommendationSummary>(f.data).filter(r => !!r?.id);
    if (!recs.length) continue;
    const ids = new Set(recs.map(r => r.id));
    ov = {
      ...ov,
      pendingRecommendations: [
        ...recs.filter(r => r.status === 'Proposed').map(summaryToPending),
        ...(ov.pendingRecommendations ?? []).filter(r => !ids.has(r.id)),
      ],
      impacted: recs.find(r => r.impacted?.length)?.impacted ?? ov.impacted,
    };
  }
  return ov;
}

/** KPI change vs 24 h ago (null when unknown). */
export function kpiDelta(
  k: Pick<KpiValue, 'value' | 'previous'>,
): {abs: number; rel: number | null} | null {
  if (k.value === null || k.previous === null) return null;
  const abs = k.value - k.previous;
  const rel = k.previous === 0 ? null : abs / Math.abs(k.previous);
  return {abs, rel};
}

/** Whether a KPI change is good given its direction (null: unchanged). */
export function kpiTrendIsGood(
  k: Pick<KpiValue, 'value' | 'previous' | 'higherIsBetter'>,
): boolean | null {
  const d = kpiDelta(k);
  if (!d || d.abs === 0) return null;
  return k.higherIsBetter ? d.abs > 0 : d.abs < 0;
}

/** Whether a KPI misses its target. */
export function kpiOffTarget(
  k: Pick<KpiValue, 'value' | 'target' | 'higherIsBetter'>,
): boolean {
  if (k.value === null || k.target === null) return false;
  return k.higherIsBetter ? k.value < k.target : k.value > k.target;
}

/** Trend series of one KPI (empty when missing). */
export function trendOf(
  trends: readonly KpiTrend[] | undefined,
  kpiId: string,
): KpiTrend['points'] {
  return trends?.find(t => t.kpiId === kpiId)?.points ?? [];
}

/** Alert markers inside the trend window (time + short title). */
export function alertMarkers(
  alerts: readonly AlertDto[],
  fromMs: number,
  max = 5,
): {ts: string; title: string; severity: AlertDto['severity']}[] {
  return sortAlertsBySeverity(alerts)
    .filter(a => Date.parse(a.raisedAt) >= fromMs)
    .slice(0, max)
    .map(a => ({ts: a.raisedAt, title: a.title, severity: a.severity}));
}

/** Expected impact of a pending recommendation (top candidate). */
export function recImpact(r: PendingRec): number | null {
  if (typeof r.expectedImpact === 'number') return r.expectedImpact;
  const top = r.candidates?.find(c => c.id === r.ranking?.[0]);
  return top ? top.expectedImpact : null;
}

/** Whether the workspace has no business data yet (sample-data CTA). */
export function isEmptyWorkspace(
  ov: Pick<OverviewView, 'kpis' | 'alerts'> | undefined,
  objects: number | undefined,
): boolean {
  if (objects !== undefined) return objects === 0;
  if (!ov) return false;
  return ov.kpis.every(k => !k.value) && ov.alerts.length === 0;
}
