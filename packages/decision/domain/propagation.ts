/**
 * @fileoverview Impact propagation (影响传播推演). A perturbation spreads
 * breadth-first from its source objects along link types that declare
 * `propagation`. Node j receives Σ w(i,j) × Δi × γ^(d+1) from its
 * predecessors, contributions below 0.5% are pruned, results are clamped to
 * [−1, 1]. Pure, O(V + E).
 */

import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphEdge, GraphSlice} from '@ontodecide/object-graph/contract';
import type {LinkTypeDef} from '@ontodecide/ontology/contract';
import {DECISION_LIMITS, type Perturbation} from '../contract';

/** Propagation parameters. */
export interface PropagationOptions {
  gamma?: number;
  maxHops?: number;
  pruneBelow?: number;
}

/** Result of a propagation: relative change and hop distance per object. */
export interface Impact {
  /** Relative change −1..1 (−0.6 means a 60% drop). */
  delta: Map<Rid, number>;
  /** Hop distance from the nearest perturbation source. */
  hop: Map<Rid, number>;
}

/** Clamps a value into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Link types (by api name) that carry propagation. */
export function propagatingLinkTypes(
  linkTypes: Record<string, LinkTypeDef>,
): string[] {
  return Object.values(linkTypes)
    .filter(l => l.propagation !== undefined)
    .map(l => l.apiName);
}

/** Outgoing adjacency restricted to propagating link types. */
function outAdjacency(
  edges: readonly GraphEdge[],
  linkTypes: Record<string, LinkTypeDef>,
): Map<Rid, {edge: GraphEdge; weight: number}[]> {
  const out = new Map<Rid, {edge: GraphEdge; weight: number}[]>();
  for (const e of edges) {
    const prop = linkTypes[e.type]?.propagation;
    if (!prop) continue;
    const weight =
      typeof e.weight === 'number' && Number.isFinite(e.weight)
        ? e.weight
        : prop.defaultWeight;
    const list = out.get(e.src);
    if (list) list.push({edge: e, weight});
    else out.set(e.src, [{edge: e, weight}]);
  }
  return out;
}

/**
 * Propagates perturbations through a slice.
 *
 * Follows the detailed design exactly: sources start at hop 0; a node is
 * enqueued the first time it is reached; its (accumulated) Δ is propagated
 * when it is dequeued.
 */
export function propagate(
  slice: GraphSlice,
  linkTypes: Record<string, LinkTypeDef>,
  perturbations: readonly Perturbation[],
  opts: PropagationOptions = {},
): Impact {
  const gamma = opts.gamma ?? DECISION_LIMITS.gamma;
  const maxHops = opts.maxHops ?? DECISION_LIMITS.maxHops;
  const pruneBelow = opts.pruneBelow ?? DECISION_LIMITS.pruneBelow;
  const adj = outAdjacency(slice.edges, linkTypes);
  const delta = new Map<Rid, number>();
  const hop = new Map<Rid, number>();
  const queue: Rid[] = [];
  for (const p of perturbations) {
    delta.set(p.rid, clamp((delta.get(p.rid) ?? 0) + p.change, -1, 1));
    if (!hop.has(p.rid)) {
      hop.set(p.rid, 0);
      queue.push(p.rid);
    }
  }
  // Index pointer instead of shift() keeps the traversal O(V + E).
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const d = hop.get(i)!;
    if (d >= maxHops) continue;
    const di = delta.get(i) ?? 0;
    for (const {edge, weight} of adj.get(i) ?? []) {
      const contrib = weight * di * gamma ** (d + 1);
      if (Math.abs(contrib) < pruneBelow) continue;
      delta.set(edge.dst, clamp((delta.get(edge.dst) ?? 0) + contrib, -1, 1));
      if (!hop.has(edge.dst)) {
        hop.set(edge.dst, d + 1);
        queue.push(edge.dst);
      }
    }
  }
  return {delta, hop};
}
