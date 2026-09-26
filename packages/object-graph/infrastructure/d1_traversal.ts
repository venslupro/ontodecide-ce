/**
 * @fileoverview GraphTraversal over og_link in D1: hop-by-hop frontier
 * expansion (one query per hop), then pure BFS / path enumeration.
 */

import type {Rid} from '@ontodecide/shared-kernel';
import type {
  GraphTraversal,
  ObjectReader,
  TraversalResult,
} from '../application/ports';
import {bfs, findPaths, linkKey} from '../domain';
import type {StoredLink} from '../domain';

/** Frontier cap per hop for path search. */
const PATH_FRONTIER_MAX = 500;

/** D1-backed traversal. */
export class D1GraphTraversal implements GraphTraversal {
  constructor(private readonly reader: ObjectReader) {}

  async impact(
    tenantId: string,
    q: {
      rids: readonly Rid[];
      linkTypes?: readonly string[];
      maxHops: number;
      limit: number;
    },
  ): Promise<TraversalResult> {
    const edges = new Map<string, StoredLink>();
    const visited = new Set<Rid>(q.rids);
    let frontier = [...visited];
    for (let hop = 1; hop <= q.maxHops && frontier.length; hop++) {
      const found = await this.reader.links(tenantId, frontier, {
        direction: 'out',
        linkTypes: q.linkTypes,
      });
      const next: Rid[] = [];
      for (const e of found) {
        edges.set(linkKey(e), e);
        if (!visited.has(e.dst)) {
          visited.add(e.dst);
          next.push(e.dst);
        }
      }
      if (visited.size >= q.limit) break;
      frontier = next;
    }
    const t = bfs(q.rids, [...edges.values()], q.maxHops, q.limit);
    return {
      nodes: [...t.hops].map(([rid, hop]) => ({rid, hop})),
      edges: t.edges,
    };
  }

  private async expand(
    tenantId: string,
    start: Rid,
    hops: number,
    edges: Map<string, StoredLink>,
  ): Promise<void> {
    const visited = new Set<Rid>([start]);
    let frontier: Rid[] = [start];
    for (let hop = 1; hop <= hops && frontier.length; hop++) {
      const found = await this.reader.links(
        tenantId,
        frontier.slice(0, PATH_FRONTIER_MAX),
        {
          direction: 'both',
        },
      );
      const next: Rid[] = [];
      for (const e of found) {
        edges.set(linkKey(e), e);
        for (const r of [e.src, e.dst]) {
          if (!visited.has(r)) {
            visited.add(r);
            next.push(r);
          }
        }
      }
      frontier = next;
    }
  }

  async paths(
    tenantId: string,
    from: Rid,
    to: Rid,
    maxHops: number,
  ): Promise<Rid[][]> {
    // Meet in the middle: every path of length ≤ maxHops has each edge
    // within ceil(maxHops/2) hops of `from` or floor(maxHops/2) of `to`.
    const edges = new Map<string, StoredLink>();
    await this.expand(tenantId, from, Math.ceil(maxHops / 2), edges);
    await this.expand(tenantId, to, Math.floor(maxHops / 2), edges);
    return findPaths([...edges.values()], from, to, maxHops);
  }
}
