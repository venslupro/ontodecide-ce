/**
 * @fileoverview Tests for LLM redaction.
 */

import {describe, expect, it} from 'vitest';
import {buildFacts, factKeys, redactProps} from './redaction';
import {
  rid,
  subgraph,
  supplyChainGraph,
  supplyChainModel,
} from './testing/supply_chain_fixture';

describe('redaction', () => {
  const model = supplyChainModel();

  it('removes sensitive props (contactEmail)', () => {
    const out = redactProps(model, 'Supplier', {
      name: 'x',
      contactEmail: 'a@b.c',
      riskScore: 3,
    });
    expect(out).toEqual({name: 'x', riskScore: 3});
  });

  it('builds facts with the focus first and without sensitive values', () => {
    const s1 = rid('Supplier', 'S-001');
    const slice = subgraph(supplyChainGraph(), [s1]);
    const delta = new Map([[rid('Product', 'P-900'), -0.6]]);
    const facts = buildFacts(model, slice.nodes, delta, s1, 3);
    expect(facts).toHaveLength(3);
    expect(facts[0].rid).toBe(s1);
    expect(facts[1].rid).toBe(rid('Product', 'P-900'));
    expect(JSON.stringify(facts)).not.toContain('ops@szpp.example');
    expect(factKeys(facts).has(`${s1}|contactEmail`)).toBe(false);
    expect(factKeys(facts).has(`${s1}|riskScore`)).toBe(true);
  });
});
