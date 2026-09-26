/**
 * @fileoverview Situation view model and the pure realtime merge applied to
 * the overview cache (前端详细设计 §增量合并与渲染节流):
 * KPIs overwrite by id, alerts dedupe by id newest first (keep 200),
 * recommendation messages update the pending list and are invalidated.
 */

import type {DataHealthDto} from '@ontodecide/integration/contract';
import type {UsageStatus} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  CockpitLayout,
  CockpitWidget,
  KpiValue,
  RecommendationSummary,
  SituationOverview,
  WsMsg,
} from '@ontodecide/situation/contract';

/** Overview as served by the gateway BFF. */
export type Overview = SituationOverview & {dataHealth?: DataHealthDto[]};

/** Alerts kept in the realtime stream. */
export const ALERT_KEEP = 200;

/** Result of merging a batch of frames. */
export interface MergeResult {
  overview: Overview | undefined;
  /** Recommendation ids whose detail queries must be invalidated. */
  invalidateRecs: string[];
  usage?: UsageStatus;
  /** Alert ids that are new in this batch (for the flash animation). */
  newAlertIds: string[];
  /** True when a snapshot replaced the cache. */
  replaced: boolean;
}

function asArray<T>(d: unknown): T[] {
  return Array.isArray(d) ? (d as T[]) : d ? [d as T] : [];
}

function sortAlerts(list: AlertDto[]): AlertDto[] {
  return [...list].sort((a, b) =>
    a.raisedAt < b.raisedAt ? 1 : a.raisedAt > b.raisedAt ? -1 : 0,
  );
}

/** Merges realtime frames into the overview (pure). */
export function mergeFrames(
  prev: Overview | undefined,
  frames: readonly WsMsg[],
): MergeResult {
  let ov = prev;
  const invalidate = new Set<string>();
  const newAlerts: string[] = [];
  let usage: UsageStatus | undefined;
  let replaced = false;
  for (const f of frames) {
    switch (f.type) {
      case 'snapshot': {
        // SituationRoom snapshots carry only {kpis, alerts}; keep the rest
        // (recommendations, usage, data health) from the REST overview.
        const snap = f.data as Partial<Overview>;
        const base = ov ?? prev;
        ov = {
          ...base,
          ...snap,
          kpis: snap.kpis ?? base?.kpis ?? [],
          alerts: snap.alerts ?? base?.alerts ?? [],
          recommendations: snap.recommendations ?? base?.recommendations ?? [],
          dataHealth: snap.dataHealth ?? base?.dataHealth,
        } as Overview;
        replaced = true;
        if (snap.usage) usage = snap.usage;
        break;
      }
      case 'kpi': {
        if (!ov) break;
        const byId = new Map(ov.kpis.map(k => [k.id, k] as const));
        for (const k of asArray<KpiValue>(f.data))
          byId.set(k.id, {...byId.get(k.id), ...k});
        const order = ov.kpis.map(k => k.id);
        for (const id of byId.keys()) if (!order.includes(id)) order.push(id);
        ov = {...ov, kpis: order.map(id => byId.get(id)!)};
        break;
      }
      case 'alert': {
        if (!ov) break;
        const incoming = asArray<AlertDto>(f.data);
        const known = new Set(ov.alerts.map(a => a.id));
        for (const a of incoming) if (!known.has(a.id)) newAlerts.push(a.id);
        const ids = new Set(incoming.map(a => a.id));
        ov = {
          ...ov,
          alerts: sortAlerts([
            ...incoming,
            ...ov.alerts.filter(a => !ids.has(a.id)),
          ]).slice(0, ALERT_KEEP),
        };
        break;
      }
      case 'recommendation': {
        const recs = asArray<RecommendationSummary>(f.data);
        for (const r of recs) invalidate.add(r.id);
        if (!ov) break;
        const ids = new Set(recs.map(r => r.id));
        const merged = [
          ...recs.filter(r => r.status === 'Proposed'),
          ...ov.recommendations.filter(r => !ids.has(r.id)),
        ];
        ov = {...ov, recommendations: merged};
        break;
      }
      case 'usage': {
        usage = f.data as UsageStatus;
        if (ov) ov = {...ov, usage};
        break;
      }
      default:
        break;
    }
  }
  return {
    overview: ov,
    invalidateRecs: [...invalidate],
    usage,
    newAlertIds: newAlerts,
    replaced,
  };
}

/** KPI change vs previous (null when unknown). */
export function kpiDelta(
  k: Pick<KpiValue, 'value' | 'previous'>,
): {abs: number; rel: number | null} | null {
  if (k.value === null || k.previous === null) return null;
  const abs = k.value - k.previous;
  const rel = k.previous === 0 ? null : abs / Math.abs(k.previous);
  return {abs, rel};
}

/** Whether a KPI change is good given its direction. */
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

// ----------------------------------------------------------------------------
// Cockpit view helpers
// ----------------------------------------------------------------------------

/** Severity ordering used by the alert stream (higher first). */
export const SEVERITY_RANK: Record<AlertDto['severity'], number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** Sorts alerts by severity (CRITICAL > HIGH > MEDIUM > LOW), then newest first; keeps {@link ALERT_KEEP}. */
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

/** Built-in cockpit layout used when the tenant layout cannot be loaded. */
export const DEFAULT_COCKPIT_LAYOUT: CockpitLayout = {
  id: 'builtin-default',
  name: 'Default',
  columns: 12,
  widgets: [
    {id: 'w-kpi', kind: 'kpi', x: 0, y: 0, w: 12, h: 2},
    {id: 'w-trend', kind: 'trend', x: 0, y: 2, w: 8, h: 4},
    {id: 'w-alerts', kind: 'alerts', x: 8, y: 2, w: 4, h: 4},
    {id: 'w-recs', kind: 'recommendations', x: 0, y: 6, w: 4, h: 4},
    {id: 'w-impacted', kind: 'impacted', x: 4, y: 6, w: 4, h: 4},
    {id: 'w-health', kind: 'dataHealth', x: 8, y: 6, w: 4, h: 4},
  ],
};

/** Clamps widgets into the 12-column grid and orders them top-left first. */
export function normalizeWidgets(
  widgets: readonly CockpitWidget[],
): CockpitWidget[] {
  return widgets
    .map(w => {
      const x = Math.max(0, Math.min(11, Math.floor(w.x)));
      const width = Math.max(1, Math.min(12 - x, Math.floor(w.w)));
      return {
        ...w,
        x,
        w: width,
        y: Math.max(0, Math.floor(w.y)),
        h: Math.max(1, Math.min(12, Math.floor(w.h))),
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Splits a list into chunks of `size` (wall-mode KPI groups). */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += Math.max(1, size))
    out.push(list.slice(i, i + size));
  return out;
}

/** Newest recommendation with status `Proposed`, if any. */
export function newestProposed(
  recs: readonly RecommendationSummary[],
): RecommendationSummary | undefined {
  return recs
    .filter(r => r.status === 'Proposed')
    .reduce<RecommendationSummary | undefined>(
      (best, r) => (!best || r.createdAt > best.createdAt ? r : best),
      undefined,
    );
}
