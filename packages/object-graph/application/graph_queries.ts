/**
 * @fileoverview Graph queries (详细设计 6.3.2): links around an object and
 * the outgoing impact subgraph, both via D1 recursive CTEs with depth ≤ 2
 * and ≤ 300 nodes; plus workspace stats.
 */

import {AppError, isRid} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import {GRAPH_LIMITS} from '../contract/types';
import type {
  GraphSlice,
  GraphStats,
  ImpactQuery,
  LinksQuery,
} from '../contract/types';
import {buildSlice, checkDepth, clampNodes} from '../domain';
import type {GraphDeps} from './ports';

const DIRECTIONS = ['out', 'in', 'both'] as const;

function linkTypes(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some(t => typeof t !== 'string')) {
    throw new AppError('VALIDATION_FAILED', 'linkTypes must be strings');
  }
  return v.length ? (v as string[]) : undefined;
}

/** Links around one object (NOT_FOUND when it is not in the workspace). */
export async function getLinks(
  deps: GraphDeps,
  ctx: CallCtx,
  rid: Rid,
  q: LinksQuery,
): Promise<GraphSlice> {
  if (!isRid(rid)) throw new AppError('NOT_FOUND');
  const depth = checkDepth(q?.depth ?? 1);
  const limit = clampNodes(q?.limit);
  const direction = q?.direction ?? 'both';
  if (!DIRECTIONS.includes(direction)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid direction');
  }
  const types = linkTypes(q?.linkTypes);
  const repos = deps.repos(ctx.tid);
  const hits = await repos.traversal.walk({
    rid,
    depth,
    direction,
    types,
    limit: limit + 1,
  });
  const kept = hits.slice(0, limit).map(h => h.rid);
  const [objects, edges, schema] = await Promise.all([
    repos.reader.getMany(kept as Rid[]),
    repos.traversal.edgesAmong(kept, types),
    deps.schema.get(ctx),
  ]);
  if (!objects.some(o => o.rid === rid)) throw new AppError('NOT_FOUND');
  return buildSlice(schema, hits, limit, objects, edges);
}

/** Outgoing impact subgraph along propagating link types. */
export async function impactSubgraph(
  deps: GraphDeps,
  ctx: CallCtx,
  q: ImpactQuery,
): Promise<GraphSlice> {
  const rids = [...new Set((q?.rids ?? []).filter(isRid))];
  if (!rids.length) return {nodes: [], edges: [], truncated: false};
  if (rids.length > GRAPH_LIMITS.subgraphNodesMax) {
    throw new AppError('VALIDATION_FAILED', 'Too many start rids');
  }
  const depth = checkDepth(q.depth ?? GRAPH_LIMITS.maxDepth);
  const limit = clampNodes(q.limit);
  const types = linkTypes(q.linkTypes) ?? [];
  const repos = deps.repos(ctx.tid);
  const hits = await repos.traversal.impactWalk({
    rids,
    types,
    depth,
    limit: limit + 1,
  });
  const kept = hits.slice(0, limit).map(h => h.rid);
  const [objects, edges, schema] = await Promise.all([
    repos.reader.getMany(kept as Rid[]),
    types.length
      ? repos.traversal.edgesAmong(kept, types)
      : Promise.resolve([]),
    deps.schema.get(ctx),
  ]);
  return buildSlice(schema, hits, limit, objects, edges);
}

/** Object and link counts of the workspace. */
export function stats(deps: GraphDeps, ctx: CallCtx): Promise<GraphStats> {
  return deps.repos(ctx.tid).reader.stats();
}
