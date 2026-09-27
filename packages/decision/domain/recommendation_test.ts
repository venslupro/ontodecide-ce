/**
 * @fileoverview Tests of recommendation rules, focus perturbation and
 * Neurons accounting.
 */

import {describe, expect, it} from 'vitest';
import {AI_MODELS, type CallCtx} from '@ontodecide/shared-kernel';
import type {Candidate} from '../contract';
import {focusPerturbation, riskProperty} from './focus';
import {estimateNeurons, neuronsFor, reservation} from './neurons';
import {
  bestCandidate,
  canRetryExecution,
  decidedByRole,
  isDue,
  ruleTexts,
  toDto,
  toSummary,
  withValues,
  type RecRecord,
} from './recommendation';
import {M1, P1, S1, testSchema} from './testing/supply_chain_fixture';

const schema = testSchema();

const cand = (id: string, e: number): Candidate => ({
  id,
  actionType: 'switchSupplier',
  displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
  target: M1,
  targetTitle: 'Steel',
  params: {},
  expectedImpact: e,
  affectedCount: 2,
});

function rec(over: Partial<RecRecord> = {}): RecRecord {
  return {
    id: 'r1',
    status: 'Proposed',
    focus: S1,
    summary: 's',
    rationale: 'r',
    candidates: [cand('c1', 0.2), cand('c2', 0.1)],
    ranking: ['c2', 'c1'],
    evidence: [],
    risks: [],
    confidence: 0.5,
    rankedBy: 'rules',
    locale: 'zh-CN',
    createdAt: '2026-09-24T00:00:00.000Z',
    expiresAt: '2026-09-25T00:00:00.000Z',
    version: 1,
    execAttempts: 0,
    decisionKey: 'k',
    ...over,
  };
}

describe('focusPerturbation', () => {
  it('derives the change from the risk property', () => {
    expect(riskProperty(schema.objectTypes.Supplier)).toBe('riskScore');
    expect(
      focusPerturbation(schema.objectTypes.Supplier, {
        rid: S1,
        props: {riskScore: 80},
      }),
    ).toEqual({rid: S1, property: 'riskScore', change: -0.8});
    expect(
      focusPerturbation(schema.objectTypes.Supplier, {
        rid: S1,
        props: {riskScore: 3},
      }),
    ).toEqual({rid: S1, property: 'riskScore', change: -0.1});
    expect(
      focusPerturbation(schema.objectTypes.Supplier, {
        rid: S1,
        props: {riskScore: 0.45},
      }),
    ).toEqual({rid: S1, property: 'riskScore', change: -0.45});
  });

  it('uses −0.5 without a numeric risk', () => {
    expect(
      focusPerturbation(schema.objectTypes.Product, {rid: P1, props: {}}),
    ).toEqual({rid: P1, property: 'risk', change: -0.5});
    expect(
      focusPerturbation(schema.objectTypes.Supplier, {
        rid: S1,
        props: {riskScore: 'n/a'},
      }),
    ).toMatchObject({change: -0.5});
  });
});

describe('state helpers', () => {
  it('evaluates expiry of Proposed items only', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    expect(isDue(rec(), now)).toBe(true);
    expect(isDue(rec(), new Date('2026-09-24T12:00:00Z'))).toBe(false);
    expect(isDue(rec({status: 'Rejected'}), now)).toBe(false);
  });

  it('allows ≤ 3 execution attempts', () => {
    expect(
      canRetryExecution(rec({status: 'ExecFailed', execAttempts: 2})),
    ).toBe(true);
    expect(
      canRetryExecution(rec({status: 'ExecFailed', execAttempts: 3})),
    ).toBe(false);
    expect(canRetryExecution(rec({status: 'Executed', execAttempts: 1}))).toBe(
      false,
    );
  });

  it('records the human role and refuses services', () => {
    const ctx = (role: CallCtx['actor']['role']): CallCtx => ({
      tid: 't',
      sub: 'u',
      actor: {role, actingAs: role === 'admin'},
      requestId: 'r',
      locale: 'zh-CN',
    });
    expect(decidedByRole(ctx('owner'))).toBe('owner');
    expect(decidedByRole(ctx('admin'))).toBe('admin');
    expect(() => decidedByRole(ctx('service'))).toThrow(/FORBIDDEN/);
  });

  it('strips internal fields and summarizes ranking[0]', () => {
    const dto = toDto(rec());
    expect(dto).not.toHaveProperty('decisionKey');
    expect(dto).not.toHaveProperty('execAttempts');
    expect(bestCandidate(dto)?.id).toBe('c2');
    expect(toSummary(dto)).toMatchObject({
      id: 'r1',
      expectedImpact: 0.1,
      rankedBy: 'rules',
    });
  });

  it('attaches evidence values once per rid/prop', () => {
    const ev = withValues(
      [
        {rid: S1, prop: 'riskScore'},
        {rid: S1, prop: 'riskScore'},
      ],
      () => 80,
    );
    expect(ev).toEqual([{rid: S1, prop: 'riskScore', value: 80}]);
  });
});

describe('ruleTexts', () => {
  const base = {
    focusTitle: 'Alpha',
    result: {riskLevel: 'HIGH' as const, affected: []},
    primary: {
      apiName: 'fulfillableDemand',
      displayName: {'zh-CN': '可满足日需求', 'en-US': 'Fulfillable demand'},
      higherIsBetter: true,
    },
    ranked: [cand('c1', 0.25), cand('c2', 0)],
  };

  it('renders zh-CN and en-US templates deterministically', () => {
    const zh = ruleTexts({...base, locale: 'zh-CN'});
    const en = ruleTexts({...base, locale: 'en-US'});
    expect(zh.summary).toContain('规则排序');
    expect(zh.summary).toContain('切换供应商');
    expect(zh.summary).toContain('+25%');
    expect(en.summary).toContain('Switch supplier');
    expect(en.rationale).toContain('Fulfillable demand');
    expect(en.risks.at(-1)).toContain('without AI');
    expect(zh.confidence).toBe(0.6);
    expect(ruleTexts({...base, locale: 'en-US'})).toEqual(en);
    expect(zh.summary.length).toBeLessThanOrEqual(160);
  });
});

describe('neurons', () => {
  it('matches the design estimates (≈38 / ≈76 per recommendation)', () => {
    const u = {inputTokens: 3000, outputTokens: 800};
    expect(neuronsFor(AI_MODELS.primary, u)).toBe(39);
    expect(neuronsFor(AI_MODELS.fallback, u)).toBe(77);
    expect(reservation(38, 1.3)).toBe(50);
    expect(estimateNeurons(AI_MODELS.primary, 9000, 800)).toBe(39);
  });
});
