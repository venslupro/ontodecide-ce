/**
 * @fileoverview Tests of traversal bounds and slice assembly.
 */

import {describe, expect, it} from 'vitest';
import {AppError} from '@ontodecide/shared-kernel';
import type {Rid} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import {buildSlice, checkDepth, clampNodes} from './traversal';
import type {StoredObject} from './stored_object';

const schema = {objectTypes: {}} as unknown as CompiledSchema;

function obj(id: string): StoredObject {
  return {
    rid: `ri.T.${id}` as Rid,
    type: 'T',
    primaryKey: id,
    title: id,
    props: {},
    provenance: {},
    propsHash: '',
    version: 1,
    updatedAt: 0,
  };
}

describe('traversal bounds', () => {
  it('accepts depth 1 or 2 only', () => {
    expect(checkDepth(1)).toBe(1);
    expect(checkDepth(2)).toBe(2);
    for (const d of [0, 3, '2', undefined]) {
      expect(() => checkDepth(d)).toThrow(AppError);
    }
  });

  it('clamps node limits to 300', () => {
    expect(clampNodes(undefined)).toBe(200);
    expect(clampNodes(1000)).toBe(300);
    expect(clampNodes(0)).toBe(1);
    expect(clampNodes(12.7)).toBe(12);
  });
});

describe('buildSlice', () => {
  it('cuts at the limit, flags truncation and drops dangling edges', () => {
    const hits = [
      {rid: 'ri.T.a', hop: 0},
      {rid: 'ri.T.b', hop: 1},
      {rid: 'ri.T.c', hop: 2},
    ];
    const edges = [
      {src: 'ri.T.a' as Rid, type: 'l', dst: 'ri.T.b' as Rid, weight: 0.5},
      {src: 'ri.T.b' as Rid, type: 'l', dst: 'ri.T.c' as Rid, weight: null},
    ];
    const s = buildSlice(
      schema,
      hits,
      2,
      [obj('a'), obj('b'), obj('c')],
      edges,
    );
    expect(s.truncated).toBe(true);
    expect(s.nodes.map(n => [n.rid, n.hop])).toEqual([
      ['ri.T.a', 0],
      ['ri.T.b', 1],
    ]);
    expect(s.edges).toEqual([edges[0]]);
    const full = buildSlice(schema, hits, 3, [obj('a'), obj('c')], edges);
    expect(full.truncated).toBe(false);
    expect(full.nodes.map(n => n.rid)).toEqual(['ri.T.a', 'ri.T.c']);
    expect(full.edges).toEqual([]);
  });
});
