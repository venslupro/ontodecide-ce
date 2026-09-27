/**
 * @fileoverview KPI math (详细设计 6.11.4): contribution of one object to a
 * KPI, full computation and incremental updates, plus the 15-minute metric
 * point grid used for trends.
 */

import {
  DAY_MS,
  type FilterExpr,
  type I18nText,
  MINUTE_MS,
  matchFilter,
} from '@ontodecide/shared-kernel';
import type {KpiAggregate} from '@ontodecide/ontology/contract';

/** A KPI definition installed in a room. */
export interface KpiDefinition {
  id: string;
  name: I18nText;
  objectType: string;
  aggregate: KpiAggregate;
  filter?: FilterExpr;
  unit: string | null;
  target: number | null;
  higherIsBetter: boolean;
}

/** Aggregation state kept per KPI so updates are O(1). */
export interface KpiState {
  /** Number of contributing objects. */
  cnt: number;
  /** Sum of contributions (sum / avg). */
  total: number;
  /** Current KPI value. */
  value: number | null;
}

/** An object as seen by KPI and rule evaluation. */
export interface ObjectView {
  rid: string;
  type: string;
  title: string;
  props: Record<string, unknown>;
}

/** Metric point resolution. */
export const METRIC_BUCKET_MS = 15 * MINUTE_MS;

/** How long trend points are kept (the latest point per KPI is kept). */
export const METRIC_RETENTION_MS = 7 * DAY_MS;

/** Range → milliseconds. */
export function rangeMs(range: '24h' | '7d'): number {
  return range === '7d' ? 7 * DAY_MS : DAY_MS;
}

/** Start of the 15-minute bucket containing `ms`. */
export function bucketStart(ms: number): number {
  return Math.floor(ms / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
}

/** First bucket boundary strictly after `ms`. */
export function nextBucket(ms: number): number {
  return bucketStart(ms) + METRIC_BUCKET_MS;
}

/** Rounds away floating-point noise from incremental sums. */
export function roundKpi(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * The value an object contributes to a KPI, or null when it does not
 * contribute (other type, filtered out, or non-numeric property).
 */
export function kpiContribution(
  def: KpiDefinition,
  obj: ObjectView | null,
): number | null {
  if (!obj || obj.type !== def.objectType) return null;
  if (!matchFilter(def.filter, obj.props)) return null;
  if (def.aggregate.fn === 'count') return 1;
  const v = def.aggregate.prop ? obj.props[def.aggregate.prop] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function valueOf(
  fn: KpiAggregate['fn'],
  cnt: number,
  total: number,
): number | null {
  if (fn === 'count') return cnt;
  if (fn === 'sum') return roundKpi(total);
  if (fn === 'avg') return cnt > 0 ? roundKpi(total / cnt) : null;
  return null;
}

/** Computes a KPI from all contributions. */
export function computeKpi(
  def: KpiDefinition,
  contributions: readonly number[],
): KpiState {
  const cnt = contributions.length;
  const total = contributions.reduce((a, b) => a + b, 0);
  const fn = def.aggregate.fn;
  if (fn === 'min' || fn === 'max') {
    const value =
      cnt === 0
        ? null
        : fn === 'min'
          ? Math.min(...contributions)
          : Math.max(...contributions);
    return {cnt, total, value};
  }
  return {cnt, total, value: valueOf(fn, cnt, total)};
}

/**
 * Applies the change of one object's contribution (`before` → `after`).
 * Returns null when the new value cannot be derived incrementally (the
 * current min / max left) and the KPI must be recomputed.
 */
export function applyKpiDelta(
  def: KpiDefinition,
  state: KpiState,
  before: number | null,
  after: number | null,
): KpiState | null {
  if (before === after) return state;
  const cnt = state.cnt + (after !== null ? 1 : 0) - (before !== null ? 1 : 0);
  const total = state.total + (after ?? 0) - (before ?? 0);
  const fn = def.aggregate.fn;
  if (fn !== 'min' && fn !== 'max') {
    return {cnt, total, value: valueOf(fn, cnt, total)};
  }
  if (cnt === 0) return {cnt, total, value: null};
  const better = (a: number, b: number): boolean =>
    fn === 'min' ? a < b : a > b;
  const current = state.value;
  if (
    before !== null &&
    current !== null &&
    before === current &&
    (after === null || better(before, after))
  ) {
    return null;
  }
  let value = current;
  if (after !== null && (value === null || better(after, value))) {
    value = after;
  }
  return {cnt, total, value};
}
