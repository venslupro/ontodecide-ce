/**
 * @fileoverview KPI maintenance: incremental updates on object changes,
 * recomputation from the object cache and 15-minute metric points.
 */

import {
  METRIC_RETENTION_MS,
  type ObjectView,
  applyKpiDelta,
  bucketStart,
  computeKpi,
  kpiContribution,
  nextBucket,
} from '../domain';
import type {KpiRecord, RoomStore} from './ports';
import {META, type RoomRuntime} from './support';

/** Recomputes a KPI from every cached object of its type. */
export function recomputeKpi(
  store: RoomStore,
  k: KpiRecord,
): KpiRecord['state'] {
  const contributions: number[] = [];
  for (const o of store.listObjects(k.objectType)) {
    const c = kpiContribution(k, o);
    if (c !== null) contributions.push(c);
  }
  return computeKpi(k, contributions);
}

/**
 * Tracks KPI changes over a batch of object changes. The object cache must
 * already hold `after` when {@link KpiTracker.apply} runs (min / max
 * recomputation reads it).
 */
export class KpiTracker {
  private readonly kpis: KpiRecord[];
  private readonly changed = new Set<string>();

  constructor(private readonly store: RoomStore) {
    this.kpis = store.listKpis();
  }

  /** Applies the change of one object. */
  apply(before: ObjectView | null, after: ObjectView | null): void {
    for (const k of this.kpis) {
      if (k.objectType !== before?.type && k.objectType !== after?.type) {
        continue;
      }
      const b = kpiContribution(k, before);
      const a = kpiContribution(k, after);
      if (b === a) continue;
      const next =
        applyKpiDelta(k, k.state, b, a) ?? recomputeKpi(this.store, k);
      if (next.value !== k.state.value || next.cnt !== k.state.cnt) {
        this.changed.add(k.id);
      }
      k.state = next;
    }
  }

  /** Saves changed KPIs; returns them (empty when nothing changed). */
  commit(now: number): KpiRecord[] {
    const out = this.kpis.filter(k => this.changed.has(k.id));
    for (const k of out) {
      this.store.saveKpiState(k.id, k.state, now);
      k.updatedAt = now;
    }
    return out;
  }
}

/** Requests a metric flush at the next 15-minute boundary. */
export function markMetricsDirty(rt: RoomRuntime): void {
  const store = rt.deps.store;
  if (store.getMeta(META.metricFlushAt) === null) {
    store.setMeta(META.metricFlushAt, String(nextBucket(rt.now())));
  }
}

/**
 * Writes one point per KPI whose value differs from its latest point, at
 * the bucket containing `now`, and prunes points older than 7 days.
 */
export function flushMetrics(rt: RoomRuntime, now: number): number {
  const store = rt.deps.store;
  const ts = bucketStart(now);
  let written = 0;
  for (const k of store.listKpis()) {
    const v = k.state.value;
    if (v === null) continue;
    const last = store.lastPoint(k.id);
    if (last && last.value === v) continue;
    store.putPoint({metric: k.id, ts, value: v});
    written++;
  }
  store.prunePoints(now - METRIC_RETENTION_MS);
  store.deleteMeta(META.metricFlushAt);
  return written;
}
