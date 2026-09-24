/**
 * @fileoverview Tests for simulation KPIs, risk levels and expected impact.
 */

import {describe, expect, it} from 'vitest';
import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphSlice} from '@ontodecide/object-graph/contract';
import type {SimulationKpiDef} from '@ontodecide/ontology/contract';
import {
  actionKey,
  computeKpis,
  expectedImpact,
  primaryKpi,
  riskLevel,
  simulate,
} from './simulation';
import {
  rid,
  subgraph,
  supplyChainGraph,
  supplyChainModel,
} from './testing/supply_chain_fixture';

const r = (id: string): Rid => `ri.t1.P.${id}`;

const SLICE: GraphSlice = {
  nodes: [
    {rid: r('a'), type: 'P', title: 'a', props: {demand: 100}},
    {rid: r('b'), type: 'P', title: 'b', props: {demand: 50}},
    {rid: r('c'), type: 'P', title: 'c', props: {demand: 'n/a'}},
    {rid: r('s'), type: 'S', title: 's', props: {demand: 1000}},
  ],
  edges: [],
};

const KPIS: SimulationKpiDef[] = [
  {
    apiName: 'total',
    displayName: 'total',
    objectType: 'P',
    property: 'demand',
    agg: 'sum',
    higherIsBetter: true,
  },
  {
    apiName: 'mean',
    displayName: 'mean',
    objectType: 'P',
    property: 'demand',
    agg: 'avg',
    higherIsBetter: true,
  },
  {
    apiName: 'healthy',
    displayName: 'healthy',
    objectType: 'P',
    agg: 'count',
    higherIsBetter: true,
  },
];

describe('computeKpis', () => {
  it('computes the baseline with Δ = 0', () => {
    expect(computeKpis(SLICE, KPIS)).toEqual({
      total: 150,
      mean: 75,
      healthy: 3,
    });
  });

  it('applies prop·(1+Δ) and counts nodes with Δ > −0.1', () => {
    const delta = new Map<Rid, number>([
      [r('a'), -0.5],
      [r('b'), -0.1],
      [r('c'), -0.05],
    ]);
    expect(computeKpis(SLICE, KPIS, delta)).toEqual({
      total: 95,
      mean: 47.5,
      healthy: 1,
    });
  });
});

describe('riskLevel', () => {
  it.each([
    [[0, -0.05], 'LOW'],
    [[-0.1], 'MEDIUM'],
    [[0.29, -0.2], 'MEDIUM'],
    [[-0.3], 'HIGH'],
    [[0.5], 'HIGH'],
  ] as const)('%j → %s', (deltas, level) => {
    expect(riskLevel(deltas)).toBe(level);
  });
});

describe('expectedImpact', () => {
  it('is relative to the baseline and flips sign when lower is better', () => {
    const k = {apiName: 'k', higherIsBetter: true};
    expect(expectedImpact(k, {k: 200}, {k: 100}, {k: 150})).toBe(0.25);
    expect(
      expectedImpact(
        {...k, higherIsBetter: false},
        {k: 200},
        {k: 100},
        {k: 150},
      ),
    ).toBe(-0.25);
    expect(expectedImpact(k, {k: 0}, {k: 0}, {k: 0})).toBe(0);
  });
});

describe('simulate (supply chain)', () => {
  const model = supplyChainModel();
  const s1 = rid('Supplier', 'S-001');
  const slice = subgraph(supplyChainGraph(), [s1], ['supplies', 'usedIn']);
  const perturbations = [{rid: s1, property: 'capacity', change: -0.6}];

  it('uses the first simulation KPI as primary', () => {
    expect(primaryKpi(model).apiName).toBe('fulfillableDemand');
  });

  it('computes baseline, scenario, affected and risk', () => {
    const {result} = simulate({model, slice, perturbations, now: new Date(0)});
    // M-100 / M-101 = 0.7 × −0.6 × 0.9 = −0.378; P-900 = 2 × (−0.378 × 0.81), P-901 = −0.378 × 0.81.
    expect(result.baseline.fulfillableDemand).toBe(500);
    const p900 = -0.378 * 0.81 * 2;
    const p901 = -0.378 * 0.81;
    expect(result.scenario.fulfillableDemand).toBeCloseTo(
      320 * (1 + p900) + 180 * (1 + p901),
      5,
    );
    expect(result.baseline.healthyProducts).toBe(2);
    expect(result.scenario.healthyProducts).toBe(0);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.affected[0]).toMatchObject({
      rid: rid('Product', 'P-900'),
      hop: 2,
    });
    expect(result.affected.map(a => a.type)).toContain('Material');
    expect(result.kpis.map(k => k.apiName)).toEqual([
      'fulfillableDemand',
      'healthyProducts',
    ]);
  });

  it('improves the primary KPI with switchSupplier and increaseSafetyStock', () => {
    const actions = [
      {actionType: 'switchSupplier', target: rid('Material', 'M-100')},
      {actionType: 'increaseSafetyStock', target: rid('Product', 'P-900')},
      {actionType: 'flagSupplier', target: s1},
    ];
    const {result} = simulate({
      model,
      slice,
      perturbations,
      actions,
      now: new Date(0),
    });
    const primary = primaryKpi(model);
    const impact = (i: number) =>
      expectedImpact(
        primary,
        result.baseline,
        result.scenario,
        result.withActions![actionKey(actions[i])],
      );
    expect(impact(0)).toBeGreaterThan(0);
    expect(impact(1)).toBeGreaterThan(0);
    expect(impact(2)).toBe(0);
  });
});
