/**
 * @fileoverview Graph limiting with "+N" aggregation and type colors.
 */

import {describe, expect, it} from 'vitest';
import {
  type GEdge,
  type GNode,
  GRAPH_NODE_MAX,
  limitGraph,
  typeColor,
} from './limit';

function graph(n: number): {nodes: GNode[]; edges: GEdge[]} {
  const nodes: GNode[] = [
    {id: 'root', label: 'root', type: 'Supplier', root: true, hop: 0},
  ];
  const edges: GEdge[] = [];
  for (let i = 0; i < n - 1; i++) {
    const type = i % 2 ? 'Material' : 'Product';
    nodes.push({id: `n${i}`, label: `n${i}`, type, impact: i / n, hop: 1});
    edges.push({source: 'root', target: `n${i}`, type: 'supplies'});
  }
  return {nodes, edges};
}

describe('limitGraph', () => {
  it('keeps small graphs untouched', () => {
    const g = graph(10);
    const r = limitGraph(g.nodes, g.edges, 200);
    expect(r.nodes).toHaveLength(10);
    expect(r.hiddenCount).toBe(0);
  });

  it('caps at the limit with one +N node per hidden type, keeping the root', () => {
    const g = graph(1000);
    const r = limitGraph(g.nodes, g.edges, 200);
    expect(r.nodes.length).toBeLessThanOrEqual(200);
    expect(r.nodes.some(n => n.id === 'root')).toBe(true);
    const agg = r.nodes.filter(n => n.hidden);
    expect(agg.map(n => n.id).sort()).toEqual(['+Material', '+Product']);
    expect(agg.reduce((s, n) => s + (n.hidden ?? 0), 0)).toBe(r.hiddenCount);
    expect(r.hiddenCount).toBe(1000 - (r.nodes.length - agg.length));
    // Highest-impact nodes are kept.
    expect(r.nodes.some(n => n.id === 'n998')).toBe(true);
    // Edges only reference existing nodes; hidden neighbors fold into one edge per aggregate.
    const ids = new Set(r.nodes.map(n => n.id));
    expect(r.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(
      true,
    );
    expect(r.edges.filter(e => e.target.startsWith('+'))).toHaveLength(2);
  });

  it('never exceeds 500 nodes', () => {
    const g = graph(2000);
    expect(
      limitGraph(g.nodes, g.edges, 10_000).nodes.length,
    ).toBeLessThanOrEqual(GRAPH_NODE_MAX);
  });

  it('gives each type a stable color', () => {
    expect(typeColor('Supplier')).toBe(typeColor('Supplier'));
    expect(typeColor('Supplier', ['Supplier', 'Material'])).not.toBe(
      typeColor('Material', ['Supplier', 'Material']),
    );
  });
});
