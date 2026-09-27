/**
 * @fileoverview Graph traversal bounds and subgraph assembly (详细设计 6.3.2):
 * depth ≤ 2, ≤ 300 nodes, a `truncated` flag when the limit cut the walk.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import {GRAPH_LIMITS} from '../contract/types';
import type {GraphSlice} from '../contract/types';
import {toGraphNode} from './stored_object';
import type {StoredLink, StoredObject} from './stored_object';

/** Validates a traversal depth (1 or 2). */
export function checkDepth(depth: unknown): 1 | 2 {
  if (depth === 1 || depth === 2) return depth;
  throw new AppError('VALIDATION_FAILED', 'depth must be 1 or 2');
}

/** Clamps a node limit into [1, 300] (default 200). */
export function clampNodes(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return GRAPH_LIMITS.subgraphNodesDefault;
  }
  return Math.max(
    1,
    Math.min(GRAPH_LIMITS.subgraphNodesMax, Math.floor(limit)),
  );
}

/** One node reached by a walk. */
export interface WalkHit {
  rid: string;
  hop: number;
}

/**
 * Assembles a slice from walk hits (already ordered by hop), the stored
 * objects and the edges among them. `hits` may hold `limit + 1` rows; the
 * extra row only sets `truncated`. Hits whose object is missing are
 * dropped, and so are edges touching them.
 */
export function buildSlice(
  schema: CompiledSchema,
  hits: WalkHit[],
  limit: number,
  objects: StoredObject[],
  edges: StoredLink[],
): GraphSlice {
  const truncated = hits.length > limit;
  const kept = hits.slice(0, limit);
  const byRid = new Map(objects.map(o => [o.rid as string, o]));
  const nodes = kept
    .filter(h => byRid.has(h.rid))
    .map(h => toGraphNode(schema, byRid.get(h.rid)!, h.hop));
  const inSlice = new Set(nodes.map(n => n.rid as string));
  return {
    nodes,
    edges: edges
      .filter(e => inSlice.has(e.src) && inSlice.has(e.dst))
      .map(e => ({type: e.type, src: e.src, dst: e.dst, weight: e.weight})),
    truncated,
  };
}
