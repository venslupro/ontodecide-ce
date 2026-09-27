/**
 * @fileoverview Tests of impact propagation (Δj = Σ w·Δi·γ^d).
 */

import {describe, expect, it} from 'vitest';
import {clamp, propagate, propagatingLinkTypes} from './propagation';
import {
  M1,
  M2,
  P1,
  P2,
  S1,
  S2,
  S4,
  testSchema,
  testSlice,
} from './testing/supply_chain_fixture';

const schema = testSchema();

describe('propagate', () => {
  it('follows the design formula with γ = 0.9 over two hops', () => {
    const {delta, hop} = propagate(testSlice(), schema.linkTypes, [
      {rid: S1, property: 'riskScore', change: -0.8},
    ]);
    expect(delta.get(S1)).toBeCloseTo(-0.8, 10);
    expect(delta.get(M1)).toBeCloseTo(0.6 * -0.8 * 0.9, 10);
    expect(delta.get(P1)).toBeCloseTo(1 * 0.6 * -0.8 * 0.9 * 0.81, 10);
    expect(delta.get(P2)).toBeCloseTo(0.5 * 0.6 * -0.8 * 0.9 * 0.81, 10);
    expect(hop.get(S1)).toBe(0);
    expect(hop.get(M1)).toBe(1);
    expect(hop.get(P1)).toBe(2);
  });

  it('only follows links with propagation', () => {
    const {delta} = propagate(testSlice(), schema.linkTypes, [
      {rid: S1, property: 'riskScore', change: -0.8},
    ]);
    // S1 → S4 is `locatedNear` (no propagation).
    expect(delta.has(S4)).toBe(false);
    expect(propagatingLinkTypes(schema.linkTypes)).toEqual([
      'supplies',
      'usedIn',
    ]);
  });

  it('uses the default weight for links without a weight', () => {
    const {delta} = propagate(testSlice(), schema.linkTypes, [
      {rid: S4, property: 'riskScore', change: -0.5},
    ]);
    expect(delta.get(M2)).toBeCloseTo(-0.5 * 1 * 0.9, 10);
  });

  it('stops after maxHops (depth ≤ 2)', () => {
    const slice = testSlice();
    const {delta} = propagate(
      slice,
      schema.linkTypes,
      [{rid: S1, property: 'x', change: -1}],
      {maxHops: 1},
    );
    expect(delta.has(M1)).toBe(true);
    expect(delta.has(P1)).toBe(false);
  });

  it('prunes contributions below 0.5%', () => {
    const {delta} = propagate(testSlice(), schema.linkTypes, [
      {rid: S2, property: 'x', change: -0.02},
    ]);
    // M1: 0.4 × 0.02 × 0.9 = 0.0072 ≥ 0.005 → kept.
    // P1: 1 × 0.0072 × 0.81 = 0.00583 → kept; P2: 0.5 × … = 0.0029 → pruned.
    expect(delta.get(M1)).toBeCloseTo(-0.0072, 10);
    expect(delta.get(P1)).toBeCloseTo(-0.0072 * 0.81, 10);
    expect(delta.has(P2)).toBe(false);
  });

  it('sums contributions and clamps to [−1, 1]', () => {
    const {delta} = propagate(testSlice(), schema.linkTypes, [
      {rid: S1, property: 'x', change: -1},
      {rid: S2, property: 'x', change: -1},
      {rid: S1, property: 'y', change: -1},
    ]);
    expect(delta.get(S1)).toBe(-1);
    expect(delta.get(M1)).toBeCloseTo(-0.9, 10);
    expect(clamp(3, -1, 1)).toBe(1);
    expect(clamp(-3, -1, 1)).toBe(-1);
  });

  it('is deterministic', () => {
    const p = [{rid: S1, property: 'x', change: -0.7}];
    const a = propagate(testSlice(), schema.linkTypes, p);
    const b = propagate(testSlice(), schema.linkTypes, p);
    expect([...a.delta]).toEqual([...b.delta]);
  });
});
