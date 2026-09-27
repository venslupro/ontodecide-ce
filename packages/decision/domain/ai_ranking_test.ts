/**
 * @fileoverview Tests of AI prompt facts, prompt content and output checks.
 */

import {describe, expect, it} from 'vitest';
import type {Candidate} from '../contract';
import {
  buildFacts,
  buildRankingPrompt,
  factKeys,
  parseAiOutput,
  rankingJsonSchema,
  retryPrompt,
  validateRanking,
} from './ai_ranking';
import {simulate} from './simulation';
import {
  M1,
  S1,
  S2,
  testSchema,
  testSlice,
} from './testing/supply_chain_fixture';

const schema = testSchema();
const slice = testSlice();
const sim = simulate(schema, slice, [
  {rid: S1, property: 'riskScore', change: -0.8},
]);
const facts = buildFacts(schema.objectTypes, slice.nodes, sim.impact, M1);
const keys = factKeys(facts);

const candidates: Candidate[] = [
  {
    id: 'c1',
    actionType: 'switchSupplier',
    displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
    target: M1,
    targetTitle: 'Steel',
    params: {newSupplier: S2},
    expectedImpact: 0.3,
    affectedCount: 3,
  },
  {
    id: 'c2',
    actionType: 'flagSupplier',
    displayName: 'flag',
    target: S1,
    targetTitle: 'Alpha',
    params: {reason: 'SECRET-PARAM'},
    expectedImpact: 0,
    affectedCount: 0,
  },
];

const valid = {
  ranking: ['c2', 'c1'],
  summary: 's',
  rationale: 'r',
  risks: ['x'],
  confidence: 0.7,
  evidence: [{rid: S1, prop: 'riskScore'}],
};

describe('buildFacts', () => {
  it('puts the focus first and drops sensitive properties', () => {
    expect(facts[0].rid).toBe(M1);
    const s1 = facts.find(f => f.rid === S1)!;
    expect(s1.props.riskScore).toBe(80);
    expect(s1.props).not.toHaveProperty('contactEmail');
    expect(keys.has(`${S1}|riskScore`)).toBe(true);
    expect(keys.has(`${S1}|contactEmail`)).toBe(false);
  });

  it('truncates long strings and caps the fact count', () => {
    const big = {
      ...slice,
      nodes: slice.nodes.map(n => ({
        ...n,
        props: {...n.props, name: 'x'.repeat(500)},
      })),
    };
    const f = buildFacts(schema.objectTypes, big.nodes, sim.impact, M1, 3);
    expect(f).toHaveLength(3);
    expect(String(f[0].props.name).length).toBe(120);
  });
});

describe('buildRankingPrompt', () => {
  it('never contains candidate parameters or sensitive values', () => {
    const p = buildRankingPrompt({
      locale: 'en-US',
      focus: M1,
      facts,
      kpis: [],
      baseline: sim.baseline,
      scenario: sim.scenario,
      riskLevel: 'HIGH',
      candidates,
    });
    const text = p.system + p.user;
    expect(text).not.toContain('SECRET-PARAM');
    expect(text).not.toContain('newSupplier');
    expect(text).not.toContain('alpha@example.com');
    expect(text).toContain('"id":"c1"');
    expect(p.system).toContain('English');
    expect(retryPrompt(p, 'bad').user).toContain('REJECTED');
  });

  it('gives the model the strict ranking JSON Schema', () => {
    const s = rankingJsonSchema();
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties as object)).not.toContain('params');
    expect(s).not.toHaveProperty('$schema');
  });
});

describe('parseAiOutput', () => {
  it('accepts objects, JSON text, fences and think blocks', () => {
    expect(parseAiOutput(valid)).toEqual(valid);
    expect(parseAiOutput(JSON.stringify(valid))).toEqual(valid);
    expect(
      parseAiOutput(
        `<think>hmm {"a":1}</think>\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``,
      ),
    ).toEqual(valid);
    expect(parseAiOutput(`Here: ${JSON.stringify(valid)} done`)).toEqual(valid);
    expect(parseAiOutput('no json')).toBeUndefined();
    expect(parseAiOutput(42)).toBeUndefined();
  });
});

describe('validateRanking', () => {
  const ids = candidates.map(c => c.id);

  it('accepts a valid ranking', () => {
    const r = validateRanking(valid, ids, keys);
    expect(r.ok && r.ranking.ranking).toEqual(['c2', 'c1']);
  });

  it('rejects unknown and duplicate candidate ids', () => {
    expect(
      validateRanking({...valid, ranking: ['c9']}, ids, keys),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('unknown candidate'),
    });
    expect(
      validateRanking({...valid, ranking: ['c1', 'c1']}, ids, keys),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('duplicate'),
    });
  });

  it('rejects extra fields such as params (strict schema)', () => {
    const r = validateRanking(
      {
        ...valid,
        params: {newSupplier: 'ri.Supplier.01K6A000000000000000000099'},
      },
      ids,
      keys,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects evidence outside the input facts (incl. sensitive props)', () => {
    expect(
      validateRanking(
        {...valid, evidence: [{rid: S1, prop: 'contactEmail'}]},
        ids,
        keys,
      ).ok,
    ).toBe(false);
    expect(
      validateRanking(
        {
          ...valid,
          evidence: [
            {rid: 'ri.Supplier.01K6A000000000000000000099', prop: 'riskScore'},
          ],
        },
        ids,
        keys,
      ).ok,
    ).toBe(false);
  });

  it('enforces the schema bounds', () => {
    expect(validateRanking({...valid, confidence: 2}, ids, keys).ok).toBe(
      false,
    );
    expect(
      validateRanking({...valid, summary: 'x'.repeat(161)}, ids, keys).ok,
    ).toBe(false);
    expect(validateRanking({...valid, evidence: []}, ids, keys).ok).toBe(false);
    expect(validateRanking('garbage', ids, keys).ok).toBe(false);
  });
});
