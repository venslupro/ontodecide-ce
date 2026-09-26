/**
 * @fileoverview Graph queries: impact subgraph (outgoing traversal; ≤ 2 hops
 * from D1, 3 hops from Neo4j with a D1 fallback) and paths between objects.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import {GRAPH_LIMITS} from '../contract';
import type {GraphNode, GraphSlice, ImpactQuery} from '../contract';
import {filterByMarkings} from '../domain';
import type {AppDeps, TraversalResult} from './ports';
import {requireRole, ridInTenant, visibleTitle} from './support';

/** Maximum hops for path queries served from D1. */
export const PATHS_MAX_HOPS = 4;

/** Rejects after `ms` milliseconds. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError('UPSTREAM_FAILED', 'Graph query timed out')),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Use case: impact subgraph for the simulator. */
export class ImpactSubgraph {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    q: ImpactQuery,
  ): Promise<GraphSlice & {degraded: boolean}> {
    requireRole(ctx, 'Viewer');
    const limit = q.limit ?? GRAPH_LIMITS.subgraphNodesDefault;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new AppError(
        'VALIDATION_FAILED',
        'limit must be a positive integer',
      );
    }
    if (limit > GRAPH_LIMITS.subgraphNodesMax) {
      throw new AppError(
        'GRAPH_TOO_LARGE',
        `limit must be ≤ ${GRAPH_LIMITS.subgraphNodesMax}`,
      );
    }
    const maxHops = q.maxHops;
    if (![1, 2, 3].includes(maxHops)) {
      throw new AppError('VALIDATION_FAILED', 'maxHops must be 1, 2 or 3');
    }
    const rids = [...new Set((q.rids ?? []).filter(r => ridInTenant(ctx, r)))];
    if (!rids.length) throw new AppError('OBJECT_NOT_FOUND');
    const query = {rids, linkTypes: q.linkTypes ?? [], limit};

    let degraded = false;
    let result: TraversalResult;
    if (maxHops <= GRAPH_LIMITS.d1MaxHops) {
      result = await this.d.d1Traversal.impact(ctx.tenantId, {
        ...query,
        maxHops,
      });
    } else {
      result = await this.deep(ctx, query).catch(async e => {
        this.d.logger.warn('neo4j traversal unavailable; degraded to D1', {
          useCase: 'ImpactSubgraph',
          error: String(e),
        });
        degraded = true;
        return this.d.d1Traversal.impact(ctx.tenantId, {
          ...query,
          maxHops: GRAPH_LIMITS.d1MaxHops,
        });
      });
    }

    const model = await this.d.models.get(ctx);
    const objects = result.nodes.length
      ? await this.d.reader.getByRids(
          ctx.tenantId,
          result.nodes.map(n => n.rid),
        )
      : [];
    const byRid = new Map(objects.map(o => [o.rid, o]));
    const nodes: GraphNode[] = [];
    for (const n of result.nodes) {
      const o = byRid.get(n.rid);
      if (!o) continue;
      const type = model.objectTypes[o.type];
      nodes.push({
        rid: o.rid,
        type: o.type,
        title: visibleTitle(ctx, type, o),
        props: filterByMarkings(ctx, type, o.props).props,
        hop: n.hop,
      });
    }
    const present = new Set(nodes.map(n => n.rid));
    const edges = result.edges
      .filter(e => present.has(e.src) && present.has(e.dst))
      .map(e => ({
        type: e.type,
        src: e.src,
        dst: e.dst,
        weight: e.weight ?? null,
      }));
    return {nodes, edges, degraded};
  }

  private async deep(
    ctx: CallCtx,
    query: {rids: Rid[]; linkTypes: string[]; limit: number},
  ): Promise<TraversalResult> {
    const neo = this.d.neo4jTraversal;
    if (!neo) throw new Error('Neo4j projection disabled');
    return withTimeout(
      neo.impact(ctx.tenantId, {...query, maxHops: GRAPH_LIMITS.neo4jMaxHops}),
      GRAPH_LIMITS.neo4jTimeoutMs,
    );
  }
}

/** Use case: paths between two objects (D1, ≤ 4 hops). */
export class FindPaths {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    q: {from: Rid; to: Rid; maxHops?: number},
  ): Promise<{paths: Rid[][]; degraded: boolean}> {
    requireRole(ctx, 'Viewer');
    if (!ridInTenant(ctx, q.from) || !ridInTenant(ctx, q.to)) {
      throw new AppError('OBJECT_NOT_FOUND');
    }
    const found = await this.d.reader.getByRids(ctx.tenantId, [q.from, q.to]);
    const rids = new Set(found.map(o => o.rid));
    if (!rids.has(q.from) || !rids.has(q.to)) {
      throw new AppError('OBJECT_NOT_FOUND');
    }
    const maxHops = Math.min(
      PATHS_MAX_HOPS,
      Math.max(1, Math.floor(q.maxHops ?? PATHS_MAX_HOPS)),
    );
    const paths = await this.d.d1Traversal.paths(
      ctx.tenantId,
      q.from,
      q.to,
      maxHops,
    );
    return {paths, degraded: false};
  }
}
