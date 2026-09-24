/**
 * @fileoverview Tests for impact propagation against a hand-computed example.
 */

import {describe, expect, it} from 'vitest';
import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphSlice} from '@ontodecide/object-graph/contract';
import type {LinkTypeDef} from '@ontodecide/ontology/contract';
import {propagate, propagatingLinkTypes} from './propagation';

const r = (id: string): Rid => `ri.t1.N.${id}`;

const LINKS: Record<string, LinkTypeDef> = {
  p: {
    apiName: 'p',
    displayName: 'p',
    from: 'N',
    to: 'N',
    cardinality: 'many',
    propagation: {defaultWeight: 0.8},
  },
  q: {apiName: 'q', displayName: 'q', from: 'N', to: 'N', cardinality: 'many'},
};

function slice(): GraphSlice {
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  return {
    nodes: ids.map(id => ({rid: r(id), type: 'N', title: id, props: {}})),
    edges: [
      {type: 'p', src: r('A'), dst: r('B'), weight: 0.5},
      {type: 'p', src: r('A'), dst: r('C'), weight: null},
      {type: 'p', src: r('B'), dst: r('D'), weight: 1},
      {type: 'p', src: r('C'), dst: r('D'), weight: 1},
      {type: 'p', src: r('D'), dst: r('E'), weight: 1},
      {type: 'p', src: r('E'), dst: r('F'), weight: 1},
      {type: 'p', src: r('D'), dst: r('A'), weight: 1},
      {type: 'q', src: r('A'), dst: r('G'), weight: 1},
      {type: 'p', src: r('B'), dst: r('H'), weight: 0.02},
    ],
  };
}

describe('propagate', () => {
  const {delta, hop} = propagate(slice(), LINKS, [
    {rid: r('A'), property: 'capacity', change: -0.5},
  ]);

  it('decays by γ^(d+1) and uses edge weight or the default weight', () => {
    expect(delta.get(r('B'))).toBeCloseTo(-0.225, 10);
    expect(delta.get(r('C'))).toBeCloseTo(-0.36, 10);
    // D receives from B and C at hop 2 (γ² = 0.81).
    expect(delta.get(r('D'))).toBeCloseTo(-0.47385, 10);
    // E at hop 3 (γ³ = 0.729).
    expect(delta.get(r('E'))).toBeCloseTo(-0.47385 * 0.729, 10);
    expect(hop.get(r('B'))).toBe(1);
    expect(hop.get(r('D'))).toBe(2);
    expect(hop.get(r('E'))).toBe(3);
  });

  it('stops at maxHops', () => {
    expect(delta.has(r('F'))).toBe(false);
  });

  it('ignores link types without propagation', () => {
    expect(delta.has(r('G'))).toBe(false);
    expect(propagatingLinkTypes(LINKS)).toEqual(['p']);
  });

  it('prunes contributions below 0.5%', () => {
    expect(delta.has(r('H'))).toBe(false);
  });

  it('handles cycles without re-enqueueing visited nodes', () => {
    // The cycle D → A adds to A once, but A keeps hop 0 and is not revisited.
    expect(delta.get(r('A'))).toBeCloseTo(-0.5 - 0.47385 * 0.729, 10);
    expect(hop.get(r('A'))).toBe(0);
  });

  it('clamps to [-1, 1]', () => {
    const s: GraphSlice = {
      nodes: ['X', 'Z', 'Y'].map(id => ({
        rid: r(id),
        type: 'N',
        title: id,
        props: {},
      })),
      edges: [
        {type: 'p', src: r('X'), dst: r('Y'), weight: 1},
        {type: 'p', src: r('Z'), dst: r('Y'), weight: 1},
      ],
    };
    const out = propagate(s, LINKS, [
      {rid: r('X'), property: 'c', change: -1},
      {rid: r('Z'), property: 'c', change: -1},
      {rid: r('X'), property: 'c', change: -1},
    ]);
    expect(out.delta.get(r('Y'))).toBe(-1);
    expect(out.delta.get(r('X'))).toBe(-1);
  });

  it('honours custom maxHops and gamma', () => {
    const out = propagate(
      slice(),
      LINKS,
      [{rid: r('A'), property: 'c', change: -0.5}],
      {maxHops: 1, gamma: 1},
    );
    expect(out.delta.get(r('B'))).toBeCloseTo(-0.25, 10);
    expect(out.delta.has(r('D'))).toBe(false);
  });
});
