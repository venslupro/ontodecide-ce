/**
 * @fileoverview Tests of the decisions.json page bound.
 */

import {describe, expect, it} from 'vitest';
import type {ScenarioDto} from '../contract';
import type {RecRecord} from '../domain';
import {exportText} from './lifecycle';

function scenario(i: number): ScenarioDto {
  return {
    id: `s${i}`,
    name: '',
    perturbations: [],
    candidates: [],
    result: {
      baseline: {},
      scenario: {},
      affected: Array.from({length: 50}, (_, j) => ({
        rid: `ri.X.${j}` as never,
        type: 'X',
        title: 'x'.repeat(40),
        delta: -0.1,
        hop: 1,
      })),
      riskLevel: 'LOW',
      kpis: [],
      nodeCount: 50,
      computedAt: '',
    },
    createdAt: '',
  };
}

function rec(i: number): RecRecord {
  return {
    id: `r${i}`,
    status: 'Proposed',
    focus: 'ri.X.1' as never,
    summary: '',
    rationale: 'y'.repeat(700),
    candidates: [],
    ranking: [],
    evidence: [],
    risks: [],
    confidence: 0,
    rankedBy: 'rules',
    simulation: scenario(i).result,
    locale: 'zh-CN',
    createdAt: '',
    expiresAt: '',
    version: 1,
    execAttempts: 0,
    decisionKey: 'secret-key',
  };
}

describe('exportText', () => {
  it('exports everything when it fits', () => {
    const doc = JSON.parse(exportText([scenario(1)], [rec(1)]));
    expect(doc.truncated).toBe(false);
    expect(doc.recommendations[0]).not.toHaveProperty('decisionKey');
    expect(doc.recommendations[0].simulation.affected).toHaveLength(50);
  });

  it('drops detail, then the oldest entries, to stay within the bound', () => {
    const s = Array.from({length: 20}, (_, i) => scenario(i));
    const r = Array.from({length: 20}, (_, i) => rec(i));
    const lean = JSON.parse(exportText(s, r, 30_000));
    expect(lean.truncated).toBe(true);
    expect(lean.recommendations[0]).not.toHaveProperty('simulation');
    const tiny = exportText(s, r, 8_000);
    expect(new TextEncoder().encode(tiny).length).toBeLessThanOrEqual(8_000);
    const doc = JSON.parse(tiny);
    expect(doc.recommendations.at(-1).id).toBe('r19');
  });
});
