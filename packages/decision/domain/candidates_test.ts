/**
 * @fileoverview Tests of deterministic candidate generation and rule order.
 */

import {describe, expect, it} from 'vitest';
import type {Candidate} from '../contract';
import {
  actionHints,
  candidateSlots,
  compareByRules,
  pickSuggestion,
  preconditionsMet,
  prefillParams,
  ruleRanking,
  scoreCandidate,
  selectCandidates,
} from './candidates';
import {simulate} from './simulation';
import {
  M1,
  P1,
  P2,
  S1,
  S2,
  S3,
  testObjects,
  testSchema,
  testSlice,
} from './testing/supply_chain_fixture';

const schema = testSchema();
const base = [{rid: S1, property: 'riskScore', change: -0.8}];

describe('candidateSlots', () => {
  it('pairs action types with affected objects of their target type', () => {
    const slice = testSlice();
    const sim = simulate(schema, slice, base);
    const slots = candidateSlots(
      schema.actionTypes,
      slice.nodes,
      sim.impact,
      S1,
    );
    expect(slots.map(s => `${s.def.apiName}:${s.target.rid}`)).toEqual([
      `flagSupplier:${S1}`,
      `increaseSafetyStock:${P1}`,
      `increaseSafetyStock:${P2}`,
      `switchSupplier:${M1}`,
    ]);
  });

  it('skips action types whose target type is not affected', () => {
    const slice = testSlice();
    const sim = simulate(schema, slice, [
      {rid: P1, property: 'x', change: -0.5},
    ]);
    const slots = candidateSlots(schema.actionTypes, slice.nodes, sim.impact);
    expect(slots.map(s => s.def.apiName)).toEqual(['increaseSafetyStock']);
  });
});

describe('pickSuggestion', () => {
  const suggest = schema.actionTypes.switchSupplier.parameters[0].suggest!;

  it('picks the lowest-risk active object not excluded', () => {
    const pool = testObjects();
    expect(pickSuggestion(suggest, pool, new Set([S1]))).toBe(S2);
    // S3 has the lowest risk but is suspended.
    expect(pickSuggestion(suggest, pool, new Set([S1, S2]))).toBe(
      'ri.Supplier.01K6A000000000000000000004',
    );
  });

  it('is independent of the pool order', () => {
    const pool = testObjects();
    const reversed = [...pool].reverse();
    expect(pickSuggestion(suggest, reversed, new Set([S1]))).toBe(
      pickSuggestion(suggest, pool, new Set([S1])),
    );
  });

  it('breaks ties by rid and puts missing values last', () => {
    const pool = [
      {rid: S3, type: 'Supplier', title: '', props: {status: 'active'}},
      {
        rid: S2,
        type: 'Supplier',
        title: '',
        props: {status: 'active', riskScore: 9},
      },
      {
        rid: S1,
        type: 'Supplier',
        title: '',
        props: {status: 'active', riskScore: 9},
      },
    ];
    expect(pickSuggestion(suggest, pool, new Set())).toBe(S1);
  });
});

describe('prefill and preconditions', () => {
  it('uses defaults and suggestions, reports missing required params', () => {
    const def = schema.actionTypes.switchSupplier;
    expect(prefillParams(def, {newSupplier: S2})).toEqual({
      params: {newSupplier: S2},
      missing: [],
    });
    expect(prefillParams(def, {})).toEqual({
      params: {},
      missing: ['newSupplier'],
    });
    expect(
      prefillParams(schema.actionTypes.increaseSafetyStock, {}).params,
    ).toEqual({
      days: 7,
    });
  });

  it('evaluates JSONLogic preconditions over {target, params}', () => {
    const flag = schema.actionTypes.flagSupplier;
    expect(preconditionsMet(flag, {status: 'active'}, {})).toBe(true);
    expect(preconditionsMet(flag, {status: 'suspended'}, {})).toBe(false);
    const stock = schema.actionTypes.increaseSafetyStock;
    expect(preconditionsMet(stock, {}, {days: 7})).toBe(true);
    expect(preconditionsMet(stock, {}, {days: 40})).toBe(false);
  });
});

describe('actionHints', () => {
  it('uses impact hints, else numeric effects relative to the value', () => {
    const m1 = testObjects().find(o => o.rid === M1)!;
    expect(actionHints(schema.actionTypes.switchSupplier, m1, {})).toEqual([
      {rid: M1, property: 'capacity', change: 0.5},
    ]);
    const car = testObjects().find(o => o.rid === P1)!;
    expect(
      actionHints(schema.actionTypes.increaseSafetyStock, car, {days: 7}),
    ).toEqual([{rid: P1, property: 'inventoryDays', change: 0.7}]);
    const s1 = testObjects().find(o => o.rid === S1)!;
    expect(actionHints(schema.actionTypes.flagSupplier, s1, {})).toEqual([]);
  });
});

describe('selectCandidates', () => {
  it('scores, keeps the best three in rule order and numbers them', () => {
    const slice = testSlice();
    const sim = simulate(schema, slice, base);
    const slots = candidateSlots(
      schema.actionTypes,
      slice.nodes,
      sim.impact,
      S1,
    );
    const scored = slots.map(s =>
      scoreCandidate(
        schema,
        slice,
        base,
        sim,
        s,
        prefillParams(s.def, {newSupplier: S2}).params,
      ),
    );
    const {candidates, withActions} = selectCandidates(scored);
    expect(candidates).toHaveLength(3);
    expect(candidates.map(c => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(Object.keys(withActions)).toEqual(['c1', 'c2', 'c3']);
    for (let i = 1; i < candidates.length; i++) {
      expect(compareByRules(candidates[i - 1], candidates[i])).toBeLessThan(0);
    }
    const sw = candidates.find(c => c.actionType === 'switchSupplier')!;
    expect(sw.params).toEqual({newSupplier: S2});
    expect(sw.expectedImpact).toBeGreaterThan(0);
    expect(candidates[0].actionType).toBe('increaseSafetyStock');
    expect(candidates[0].target).toBe(P1);
    // The flag action has no numeric effect → dropped as the worst.
    expect(candidates.some(c => c.actionType === 'flagSupplier')).toBe(false);
    expect(ruleRanking(candidates)).toEqual(['c1', 'c2', 'c3']);
  });

  it('orders by impact desc, affected asc, action type, target', () => {
    const c = (id: string, e: number, a: number, t = 'x'): Candidate => ({
      id,
      actionType: t,
      displayName: t,
      target: S1,
      targetTitle: '',
      params: {},
      expectedImpact: e,
      affectedCount: a,
    });
    expect(
      ruleRanking([
        c('a', 0.1, 5),
        c('b', 0.2, 9),
        c('c', 0.1, 2),
        c('d', 0.1, 2, 'a'),
      ]),
    ).toEqual(['b', 'd', 'c', 'a']);
  });

  it('never exposes S3 (suspended) as a suggestion', () => {
    const suggest = schema.actionTypes.switchSupplier.parameters[0].suggest!;
    expect(pickSuggestion(suggest, testObjects(), new Set([S1, S2]))).not.toBe(
      S3,
    );
  });
});
