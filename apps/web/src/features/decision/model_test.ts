/**
 * @fileoverview Pure decision view-model tests: tabs, status levels, model
 * names, ranking order, KPI trends, best candidate, impact graph, drafts →
 * ScenarioInput, candidate options and route ids.
 */

import {describe, expect, it} from 'vitest';
import {toUiModel} from '../../entities/schema/model';
import {
  M2231,
  makeRecommendations,
  makeScenario,
  ontologyDto,
  PO5530,
  S017,
} from '../../test/fixtures';
import {
  bestCandidateId,
  canAddPerturbation,
  candidateKey,
  candidateOptions,
  clampPct,
  defaultParams,
  impactGraph,
  isCompleteDraft,
  kpiRows,
  kpiTrend,
  modelShortName,
  newPerturbation,
  rankedCandidates,
  recStatusLevel,
  relDelta,
  routeId,
  tabStatus,
  toRecTab,
  toScenarioInput,
  clampDelay,
  delayProperties,
  delayToChange,
  isTimeProperty,
  topCandidate,
} from './model';

const model = toUiModel(ontologyDto, 'zh-CN');

describe('recommendation helpers', () => {
  it('maps tabs to statuses', () => {
    expect(tabStatus('pending')).toBe('Proposed');
    expect(tabStatus('executed')).toBe('Executed');
    expect(tabStatus('all')).toBeUndefined();
    expect(toRecTab('executed')).toBe('executed');
    expect(toRecTab('bogus')).toBe('pending');
    expect(toRecTab(undefined)).toBe('pending');
  });

  it('maps statuses to badge levels', () => {
    expect(recStatusLevel('Proposed')).toBe('warn');
    expect(recStatusLevel('Executed')).toBe('good');
    expect(recStatusLevel('Confirmed')).toBe('good');
    expect(recStatusLevel('ExecFailed')).toBe('crit');
    expect(recStatusLevel('Rejected')).toBe('info');
    expect(recStatusLevel('Expired')).toBe('info');
  });

  it('derives the short model name', () => {
    expect(modelShortName('@cf/qwen/qwen3-30b-a3b-fp8')).toBe('qwen3-30b-a3b');
    expect(modelShortName('@cf/openai/gpt-oss-20b')).toBe('gpt-oss-20b');
    expect(modelShortName(undefined)).toBe('qwen3');
  });

  it('orders candidates by ranking; top is ranking[0]', () => {
    const rec = makeRecommendations()[0];
    const reversed = {...rec, ranking: ['c2', 'c1', 'missing']};
    expect(rankedCandidates(reversed).map(c => c.id)).toEqual(['c2', 'c1']);
    expect(topCandidate(reversed)?.id).toBe('c2');
    expect(topCandidate({id: 'x'} as never)).toBeUndefined();
    expect(topCandidate({candidates: rec.candidates})?.id).toBe('c1');
  });
});

describe('KPI helpers', () => {
  it('computes relative deltas', () => {
    expect(relDelta(100, 90)).toBeCloseTo(-0.1);
    expect(relDelta(0, 0)).toBe(0);
    expect(relDelta(0, 5)).toBeNull();
    expect(relDelta(undefined, 5)).toBeNull();
  });

  it('colours trends by higherIsBetter', () => {
    expect(kpiTrend({higherIsBetter: true}, 91.4, 84)).toBe('bad');
    expect(kpiTrend({higherIsBetter: false}, 61, 29)).toBe('good');
    expect(kpiTrend({higherIsBetter: true}, 5, 5)).toBe('flat');
    expect(kpiTrend({higherIsBetter: true}, undefined, 5)).toBe('flat');
  });

  it('picks the best candidate and builds rows', () => {
    const s = makeScenario();
    expect(bestCandidateId(s.result, s.candidates)).toBe('c1');
    expect(bestCandidateId({withActions: {c9: {}}}, [])).toBe('c9');
    expect(bestCandidateId({}, s.candidates)).toBeUndefined();
    const rows = kpiRows(s.result, s.result.withActions?.c1);
    expect(rows[0]).toMatchObject({
      baseline: 91.4,
      scenario: 84,
      withActions: 90.2,
    });
  });
});

describe('impact graph', () => {
  it('normalizes |delta| and keeps edges between affected nodes only', () => {
    const s = makeScenario();
    const g = impactGraph(s.result, {
      edges: [
        {type: 'supplies', src: S017, dst: M2231, weight: 1},
        {type: 'supplies', src: S017, dst: M2231, weight: 1},
        {type: 'orders', src: PO5530, dst: S017, weight: null},
      ],
    });
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0]).toMatchObject({id: S017, impact: 1, root: true});
    expect(g.nodes[1].impact).toBeCloseTo(0.7);
    expect(g.edges).toHaveLength(1);
    expect(g.hops).toBe(2);
    expect(impactGraph(undefined)).toEqual({nodes: [], edges: [], hops: 0});
  });
});

describe('scenario drafts', () => {
  it('clamps and snaps percents', () => {
    expect(clampPct(-62)).toBe(-60);
    expect(clampPct(140)).toBe(100);
    expect(clampPct(-101)).toBe(-100);
    expect(clampPct(Number.NaN)).toBe(0);
  });

  it('limits perturbations to 10', () => {
    expect(canAddPerturbation(Array.from({length: 9}))).toBe(true);
    expect(canAddPerturbation(Array.from({length: 10}))).toBe(false);
  });

  it('builds candidate options from matching action types', () => {
    const opts = candidateOptions(model, [
      {rid: S017, title: 'S-017'},
      {rid: PO5530, title: 'PO-5530', type: 'PurchaseOrder'},
      {rid: S017, title: 'dup'},
      {rid: 'not-a-rid', title: 'x'},
    ]);
    expect(opts.map(o => o.key)).toEqual([
      candidateKey({actionType: 'suspendSupplier', target: S017}),
      candidateKey({actionType: 'reactivateSupplier', target: S017}),
      candidateKey({actionType: 'switchSupplier', target: PO5530}),
    ]);
    const adjust = model.actionsByName.adjustSafetyStock;
    expect(defaultParams(adjust)).toEqual({delta: 100});
  });

  it('maps drafts and selections to the POST /scenarios body', () => {
    const opts = candidateOptions(model, [{rid: M2231, title: 'M-2231'}]);
    const drafts = [
      newPerturbation({rid: S017, property: 'capacityPerWeek', changePct: -60}),
      newPerturbation({rid: S017}),
    ];
    expect(isCompleteDraft(drafts[0])).toBe(true);
    expect(isCompleteDraft(drafts[1])).toBe(false);
    const body = toScenarioInput(
      drafts,
      {
        [opts[0].key]: {delta: 400, empty: ''},
        unknown: {},
      },
      opts,
    );
    expect(body).toEqual({
      perturbations: [{rid: S017, property: 'capacityPerWeek', change: -0.6}],
      candidateActions: [
        {actionType: 'adjustSafetyStock', target: M2231, params: {delta: 400}},
      ],
    });
    expect(toScenarioInput(drafts, {}, opts)).not.toHaveProperty(
      'candidateActions',
    );
  });
});

describe('routeId', () => {
  it('prefers the router param and falls back to the path', () => {
    expect(routeId({id: 'scn-1'}, '/x', 'scenarios')).toBe('scn-1');
    expect(routeId({}, '/scenarios/scn-041', 'scenarios')).toBe('scn-041');
    expect(routeId({}, '/scenarios', 'scenarios')).toBeUndefined();
    expect(routeId({}, '/recommendations/rec-203', 'recommendations')).toBe(
      'rec-203',
    );
  });
});

describe('延误时长 perturbations', () => {
  it('recognizes time properties by unit or name', () => {
    expect(isTimeProperty({apiName: 'leadTimeDays'})).toBe(true);
    expect(isTimeProperty({apiName: 'daysOfSupply', unit: 'd'})).toBe(true);
    expect(isTimeProperty({apiName: 'eta', unit: 'h'})).toBe(true);
    expect(isTimeProperty({apiName: 'capacityPerWeek'})).toBe(false);
    const nums = [{apiName: 'onHand'}, {apiName: 'leadTimeDays'}];
    expect(delayProperties(nums).map(p => p.apiName)).toEqual(['leadTimeDays']);
    expect(delayProperties([{apiName: 'onHand'}])).toHaveLength(1);
  });

  it('converts days of delay into the relative change (capped at ±100%)', () => {
    expect(delayToChange(3, 14)).toEqual({change: 0.2143, capped: false});
    expect(delayToChange(1, 48, 'h')).toEqual({change: 0.5, capped: false});
    expect(delayToChange(30, 10)).toEqual({change: 1, capped: true});
    expect(delayToChange(3, 0)).toBeNull();
    expect(delayToChange(3, null)).toBeNull();
    expect(delayToChange(3, 'x')).toBeNull();
    expect(clampDelay(0.84)).toBe(0.8);
    expect(clampDelay(-2)).toBe(0);
    expect(clampDelay(1000)).toBe(365);
  });

  it('builds the scenario body from delay drafts with the current value', () => {
    const rid = 'ri.Supplier.01J9AAAAAAAAAAAAAAAAAAAAAA';
    const d = newPerturbation({
      rid,
      property: 'leadTimeDays',
      mode: 'delay',
      delayDays: 7,
    });
    const body = toScenarioInput([d], {}, [], 'n', () => 14);
    expect(body).toEqual({
      name: 'n',
      perturbations: [{rid, property: 'leadTimeDays', change: 0.5}],
    });
    // Without a current value the delay cannot be converted (skipped).
    expect(toScenarioInput([d], {}, []).perturbations).toEqual([]);
  });
});
