/**
 * @fileoverview Tests for advice validation and the rule-based fallback.
 */

import {describe, expect, it} from 'vitest';
import {
  AdviceSchema,
  extractJson,
  ruleAdvice,
  ruleEvidence,
  validateAdvice,
} from './advice';
import type {ScoredCandidate} from './candidates';
import type {Fact} from './redaction';
import {primaryKpi} from './simulation';
import {rid, supplyChainModel} from './testing/supply_chain_fixture';

const M100 = rid('Material', 'M-100');
const M101 = rid('Material', 'M-101');
const P900 = rid('Product', 'P-900');
const S1 = rid('Supplier', 'S-001');
const S5 = rid('Supplier', 'S-005');

const CANDIDATES: ScoredCandidate[] = [
  {
    actionType: 'switchSupplier',
    displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
    target: M100,
    targetTitle: 'Aluminium housing',
    params: {newSupplier: S5},
    requiresApproval: true,
    eligible: true,
    expectedImpact: 0.35,
  },
  {
    actionType: 'switchSupplier',
    displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
    target: M101,
    targetTitle: 'Controller PCB',
    params: {newSupplier: S5},
    requiresApproval: true,
    eligible: true,
    expectedImpact: 0.2,
  },
  {
    actionType: 'increaseSafetyStock',
    displayName: {'zh-CN': '提高安全库存', 'en-US': 'Increase safety stock'},
    target: P900,
    targetTitle: 'Edge Gateway X1',
    params: {days: 7},
    requiresApproval: true,
    eligible: true,
    expectedImpact: 0.1,
  },
  {
    actionType: 'flagSupplier',
    displayName: 'Flag',
    target: S1,
    targetTitle: 'Shenzhen Precision Parts',
    params: {},
    requiresApproval: false,
    eligible: false,
    unmetPreconditions: ['x'],
    expectedImpact: 0,
  },
];

const FACTS: Fact[] = [
  {
    rid: S1,
    type: 'Supplier',
    title: 'Shenzhen Precision Parts',
    delta: -0.6,
    props: {capacity: 1200, riskScore: 35},
  },
  {
    rid: P900,
    type: 'Product',
    title: 'Edge Gateway X1',
    delta: -0.61,
    props: {dailyDemand: 320},
  },
];

function advice(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    summary: 'Switch M-100 to S-005',
    rationale: 'because',
    actions: [
      {
        actionType: 'switchSupplier',
        target: M100,
        params: {newSupplier: 'ri.t1.Supplier.EVIL'},
        expectedImpact: 99,
        rank: 1,
      },
    ],
    risks: ['r1'],
    confidence: 0.8,
    evidence: [{rid: S1, prop: 'capacity'}],
    ...over,
  });
}

describe('AdviceSchema', () => {
  it('enforces the design limits', () => {
    const base = JSON.parse(advice());
    expect(AdviceSchema.safeParse(base).success).toBe(true);
    expect(
      AdviceSchema.safeParse({...base, summary: 'x'.repeat(161)}).success,
    ).toBe(false);
    expect(AdviceSchema.safeParse({...base, actions: []}).success).toBe(false);
    expect(
      AdviceSchema.safeParse({
        ...base,
        actions: [1, 2, 3, 4].map(rank => ({actionType: 'a', rank})),
      }).success,
    ).toBe(false);
    expect(
      AdviceSchema.safeParse({...base, risks: ['1', '2', '3', '4', '5', '6']})
        .success,
    ).toBe(false);
    expect(AdviceSchema.safeParse({...base, confidence: 1.2}).success).toBe(
      false,
    );
    expect(AdviceSchema.safeParse({...base, evidence: []}).success).toBe(false);
  });
});

describe('extractJson', () => {
  it('tolerates code fences and prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({a: 1});
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({a: 2});
    expect(extractJson('nope')).toBeUndefined();
  });
});

describe('validateAdvice', () => {
  it('accepts whitelisted actions and keeps candidate params and impact authoritative', () => {
    const v = validateAdvice(advice(), CANDIDATES, FACTS);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.advice.actions).toEqual([
      expect.objectContaining({
        actionType: 'switchSupplier',
        target: M100,
        params: {newSupplier: S5},
        expectedImpact: 0.35,
        rank: 1,
      }),
    ]);
    expect(v.advice.evidence).toEqual([{rid: S1, prop: 'capacity'}]);
  });

  it('picks the best candidate when the target is omitted and re-ranks by LLM order', () => {
    const v = validateAdvice(
      advice({
        actions: [
          {actionType: 'increaseSafetyStock', rank: 2},
          {actionType: 'switchSupplier', rank: 1},
        ],
      }),
      CANDIDATES,
      FACTS,
    );
    expect(
      v.ok && v.advice.actions.map(a => [a.actionType, a.target, a.rank]),
    ).toEqual([
      ['switchSupplier', M100, 1],
      ['increaseSafetyStock', P900, 2],
    ]);
  });

  it('rejects actions outside the whitelist or ineligible ones', () => {
    expect(
      validateAdvice(
        advice({actions: [{actionType: 'deleteEverything', rank: 1}]}),
        CANDIDATES,
        FACTS,
      ),
    ).toEqual({ok: false, error: 'Action not allowed: deleteEverything'});
    expect(
      validateAdvice(
        advice({actions: [{actionType: 'flagSupplier', rank: 1}]}),
        CANDIDATES,
        FACTS,
      ).ok,
    ).toBe(false);
    expect(
      validateAdvice(
        advice({
          actions: [{actionType: 'switchSupplier', target: P900, rank: 1}],
        }),
        CANDIDATES,
        FACTS,
      ).ok,
    ).toBe(false);
  });

  it('rejects evidence that is not in the input subgraph', () => {
    expect(
      validateAdvice(
        advice({evidence: [{rid: S1, prop: 'contactEmail'}]}),
        CANDIDATES,
        FACTS,
      ).ok,
    ).toBe(false);
    expect(
      validateAdvice(
        advice({evidence: [{rid: 'ri.t1.Supplier.S-999', prop: 'capacity'}]}),
        CANDIDATES,
        FACTS,
      ).ok,
    ).toBe(false);
  });

  it('rejects non-JSON and schema violations', () => {
    expect(
      validateAdvice('I think you should switch.', CANDIDATES, FACTS).ok,
    ).toBe(false);
    expect(validateAdvice(advice({confidence: 3}), CANDIDATES, FACTS).ok).toBe(
      false,
    );
  });
});

describe('ruleAdvice', () => {
  const model = supplyChainModel();
  const primary = primaryKpi(model);
  const evidence = ruleEvidence(
    FACTS,
    [{rid: S1, property: 'capacity', change: -0.6}],
    primary,
  );
  const input = {
    focusTitle: 'Shenzhen Precision Parts',
    primary,
    baseline: 500,
    scenario: 250,
    riskLevel: 'HIGH' as const,
    affectedCount: 5,
    candidates: CANDIDATES,
    evidence,
  };

  it('collects evidence from perturbed props and KPI inputs', () => {
    expect(evidence).toEqual([
      {rid: S1, prop: 'capacity'},
      {rid: P900, prop: 'dailyDemand'},
    ]);
  });

  it('ranks eligible candidates by expected impact (zh-CN)', () => {
    const a = ruleAdvice({...input, locale: 'zh-CN'});
    expect(a.actions.map(x => [x.target, x.rank])).toEqual([
      [M100, 1],
      [M101, 2],
      [P900, 3],
    ]);
    expect(a.summary).toContain('可满足日需求预计下降 50%');
    expect(a.summary).toContain('切换供应商');
    expect(a.summary.length).toBeLessThanOrEqual(160);
    expect(a.confidence).toBe(0.6);
    expect(a.risks.some(r => r.includes('审批'))).toBe(true);
    expect(a.evidence).toBe(evidence);
  });

  it('writes English text for en-US', () => {
    const a = ruleAdvice({...input, locale: 'en-US'});
    expect(a.summary).toMatch(
      /^Shenzhen Precision Parts: Fulfillable daily demand expected to drop 50%/,
    );
    expect(a.summary).toContain('Switch supplier');
    expect(a.rationale).toContain('Ranked by simulated benefit');
    expect(a.risks.join(' ')).toContain('requires approval');
  });

  it('handles no eligible candidates', () => {
    const a = ruleAdvice({
      ...input,
      locale: 'en-US',
      candidates: [CANDIDATES[3]],
    });
    expect(a.actions).toEqual([]);
    expect(a.summary).toContain('No eligible action');
  });
});
