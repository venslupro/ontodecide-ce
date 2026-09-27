/**
 * @fileoverview Tests of KPI computation, risk level and scenario results.
 */

import {describe, expect, it} from 'vitest';
import {
  affectedList,
  changedCount,
  computeKpis,
  expectedImpact,
  FALLBACK_KPI,
  riskLevel,
  scenarioResult,
  simulate,
  simulateWith,
  simulationKpis,
} from './simulation';
import {
  M1,
  P1,
  P2,
  S1,
  testSchema,
  testSlice,
} from './testing/supply_chain_fixture';

const schema = testSchema();

describe('computeKpis', () => {
  it('computes sum, avg and count', () => {
    const slice = testSlice();
    const defs = [
      ...schema.simulationKpis,
      {
        apiName: 'avgDemand',
        displayName: 'a',
        objectType: 'Product',
        property: 'dailyDemand',
        agg: 'avg' as const,
        higherIsBetter: true,
      },
    ];
    expect(computeKpis(slice, defs)).toEqual({
      fulfillableDemand: 150,
      healthyProducts: 2,
      avgDemand: 75,
    });
    const delta = new Map([
      [P1, -0.5],
      [P2, -0.05],
    ]);
    expect(computeKpis(slice, defs, delta)).toEqual({
      fulfillableDemand: 50 + 47.5,
      healthyProducts: 1,
      avgDemand: 48.75,
    });
  });

  it('falls back to a count KPI', () => {
    const defs = simulationKpis({simulationKpis: []});
    expect(defs[0].apiName).toBe(FALLBACK_KPI);
    expect(computeKpis(testSlice(), defs)[FALLBACK_KPI]).toBe(8);
  });
});

describe('riskLevel', () => {
  it('maps the largest |Δ|', () => {
    expect(riskLevel([0.05])).toBe('LOW');
    expect(riskLevel([0.05, -0.1])).toBe('MEDIUM');
    expect(riskLevel([-0.3])).toBe('HIGH');
    expect(riskLevel([])).toBe('LOW');
  });
});

describe('simulate', () => {
  const p = [{rid: S1, property: 'riskScore', change: -0.8}];

  it('produces baseline, scenario, affected and risk', () => {
    const slice = testSlice();
    const sim = simulate(schema, slice, p);
    expect(sim.baseline.fulfillableDemand).toBe(150);
    expect(sim.scenario.fulfillableDemand).toBeLessThan(150);
    const r = scenarioResult(slice, sim, undefined, new Date(0));
    expect(r.riskLevel).toBe('HIGH');
    expect(r.nodeCount).toBe(8);
    expect(r.affected.map(a => a.rid)).toEqual([S1, M1, P1, P2]);
    expect(r.withActions).toBeUndefined();
    expect(r.kpis.map(k => k.apiName)).toEqual([
      'fulfillableDemand',
      'healthyProducts',
    ]);
  });

  it('scores an action as the relative primary KPI improvement', () => {
    const slice = testSlice();
    const sim = simulate(schema, slice, p);
    const w = simulateWith(schema, slice, p, [
      {rid: M1, property: 'capacity', change: 0.5},
    ]);
    const gain = expectedImpact(
      schema.simulationKpis[0],
      sim.baseline,
      sim.scenario,
      w.kpis,
    );
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeCloseTo(
      (w.kpis.fulfillableDemand - sim.scenario.fulfillableDemand) / 150,
      4,
    );
    expect(changedCount(w.impact, sim.impact)).toBe(3);
    expect(
      expectedImpact(
        {apiName: 'fulfillableDemand', higherIsBetter: false},
        sim.baseline,
        sim.scenario,
        w.kpis,
      ),
    ).toBeCloseTo(-gain, 4);
  });

  it('sorts affected objects by |Δ| then hop', () => {
    const slice = testSlice();
    const sim = simulate(schema, slice, p);
    const list = affectedList(slice, sim.impact);
    for (let i = 1; i < list.length; i++) {
      expect(Math.abs(list[i - 1].delta)).toBeGreaterThanOrEqual(
        Math.abs(list[i].delta),
      );
    }
  });
});
