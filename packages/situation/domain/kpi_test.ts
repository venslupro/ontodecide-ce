/**
 * @fileoverview Tests of KPI math: contributions, full computation and
 * incremental updates (including min / max recompute signalling).
 */

import {describe, expect, it} from 'vitest';
import {
  type KpiDefinition,
  type KpiState,
  METRIC_BUCKET_MS,
  applyKpiDelta,
  bucketStart,
  computeKpi,
  kpiContribution,
  nextBucket,
} from './kpi';

const def = (
  fn: KpiDefinition['aggregate']['fn'],
  extra: Partial<KpiDefinition> = {},
): KpiDefinition => ({
  id: `k-${fn}`,
  name: fn,
  objectType: 'Supplier',
  aggregate: fn === 'count' ? {fn} : {fn, prop: 'risk'},
  unit: null,
  target: null,
  higherIsBetter: false,
  ...extra,
});

const obj = (props: Record<string, unknown>, type = 'Supplier') => ({
  rid: 'ri.Supplier.1',
  type,
  title: 't',
  props,
});

/** Applies a sequence of (before, after) changes incrementally. */
function run(
  d: KpiDefinition,
  initial: number[],
  changes: [number | null, number | null][],
): {state: KpiState; recomputes: number} {
  const values = [...initial];
  let state = computeKpi(d, values);
  let recomputes = 0;
  for (const [b, a] of changes) {
    if (b !== null) values.splice(values.indexOf(b), 1);
    if (a !== null) values.push(a);
    const next = applyKpiDelta(d, state, b, a);
    if (next === null) {
      recomputes++;
      state = computeKpi(d, values);
    } else {
      state = next;
    }
    expect(state.value).toEqual(computeKpi(d, values).value);
  }
  return {state, recomputes};
}

describe('kpiContribution', () => {
  it('counts matching objects of the KPI type only', () => {
    const d = def('count', {filter: {op: 'gte', prop: 'risk', value: 50}});
    expect(kpiContribution(d, obj({risk: 60}))).toBe(1);
    expect(kpiContribution(d, obj({risk: 10}))).toBeNull();
    expect(kpiContribution(d, obj({risk: 60}, 'Part'))).toBeNull();
    expect(kpiContribution(d, null)).toBeNull();
  });

  it('ignores non-numeric values for numeric aggregates', () => {
    expect(kpiContribution(def('sum'), obj({risk: '7'}))).toBeNull();
    expect(kpiContribution(def('sum'), obj({}))).toBeNull();
    expect(kpiContribution(def('sum'), obj({risk: 7.5}))).toBe(7.5);
  });
});

describe('computeKpi', () => {
  it('computes every aggregate', () => {
    const v = [3, 9, 6];
    expect(computeKpi(def('count'), [1, 1, 1]).value).toBe(3);
    expect(computeKpi(def('sum'), v).value).toBe(18);
    expect(computeKpi(def('avg'), v).value).toBe(6);
    expect(computeKpi(def('min'), v).value).toBe(3);
    expect(computeKpi(def('max'), v).value).toBe(9);
  });

  it('handles empty inputs', () => {
    expect(computeKpi(def('count'), []).value).toBe(0);
    expect(computeKpi(def('sum'), []).value).toBe(0);
    expect(computeKpi(def('avg'), []).value).toBeNull();
    expect(computeKpi(def('max'), []).value).toBeNull();
  });
});

describe('applyKpiDelta', () => {
  it('keeps sum and avg exact across inserts, updates and removals', () => {
    for (const fn of ['sum', 'avg', 'count'] as const) {
      const {recomputes} = run(
        def(fn),
        [10, 20],
        [
          [null, 30],
          [10, 15],
          [20, null],
          [null, 0.1],
          [0.1, 0.2],
        ],
      );
      expect(recomputes).toBe(0);
    }
  });

  it('avoids floating-point drift', () => {
    const d = def('sum');
    let s = computeKpi(d, []);
    s = applyKpiDelta(d, s, null, 0.1)!;
    s = applyKpiDelta(d, s, null, 0.2)!;
    expect(s.value).toBe(0.3);
  });

  it('asks for a recompute only when the extremum leaves', () => {
    const {recomputes} = run(
      def('max'),
      [10, 50, 30],
      [
        [10, 20], // not the max
        [null, 60], // new max
        [60, 70], // max grows: incremental
        [70, 40], // max shrinks: recompute
        [30, null], // non-max removal
        [50, null], // max removed: recompute
      ],
    );
    expect(recomputes).toBe(2);
    const min = run(
      def('min'),
      [5, 8],
      [
        [5, 1],
        [1, 9],
      ],
    );
    expect(min.recomputes).toBe(1);
    expect(min.state.value).toBe(8);
  });

  it('is a no-op when the contribution does not change', () => {
    const d = def('sum');
    const s = computeKpi(d, [1]);
    expect(applyKpiDelta(d, s, 1, 1)).toBe(s);
  });

  it('empties min / max when the last object leaves', () => {
    const d = def('min');
    expect(applyKpiDelta(d, computeKpi(d, [4]), 4, null)).toEqual({
      cnt: 0,
      total: 0,
      value: null,
    });
  });
});

describe('metric buckets', () => {
  it('snaps to 15-minute boundaries', () => {
    const t = Date.parse('2026-09-24T10:07:30Z');
    expect(new Date(bucketStart(t)).toISOString()).toBe(
      '2026-09-24T10:00:00.000Z',
    );
    expect(nextBucket(t) - bucketStart(t)).toBe(METRIC_BUCKET_MS);
    expect(nextBucket(bucketStart(t))).toBe(bucketStart(t) + METRIC_BUCKET_MS);
  });
});
