/**
 * @fileoverview Breadth-first traversal and path enumeration over an
 * in-memory edge list.
 */

import type {Rid} from '@ontodecide/shared-kernel';
import {linkKey} from './stored_object';
import type {StoredLink} from './stored_object';

/** Result of a traversal. */
export interface Traversal {
  /** Reached nodes (roots included, hop 0) with their hop distance. */
  hops: Map<Rid, number>;
  /** Edges between reached nodes, in discovery order. */
  edges: StoredLink[];
  /** True when the node limit cut the traversal short. */
  truncated: boolean;
}

/**
 * Outgoing BFS from the roots up to `maxHops`, visiting at most `limit`
 * nodes (roots count towards the limit).
 */
export function bfs(
  roots: readonly Rid[],
  edges: readonly StoredLink[],
  maxHops: number,
  limit: number,
): Traversal {
  const out = new Map<Rid, StoredLink[]>();
  for (const e of edges) {
    const list = out.get(e.src) ?? [];
    list.push(e);
    out.set(e.src, list);
  }
  const hops = new Map<Rid, number>();
  const seenEdges = new Map<string, StoredLink>();
  let truncated = false;
  let frontier: Rid[] = [];
  for (const r of roots) {
    if (hops.has(r)) continue;
    if (hops.size >= limit) {
      truncated = true;
      break;
    }
    hops.set(r, 0);
    frontier.push(r);
  }
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: Rid[] = [];
    for (const n of frontier) {
      for (const e of out.get(n) ?? []) {
        if (!hops.has(e.dst)) {
          if (hops.size >= limit) {
            truncated = true;
            continue;
          }
          hops.set(e.dst, hop);
          next.push(e.dst);
        }
        seenEdges.set(linkKey(e), e);
      }
    }
    frontier = next;
  }
  return {hops, edges: [...seenEdges.values()], truncated};
}

/**
 * Enumerates simple paths from `from` to `to` with at most `maxHops` edges,
 * shortest first. Edges may be walked in either direction.
 */
export function findPaths(
  edges: readonly StoredLink[],
  from: Rid,
  to: Rid,
  maxHops: number,
  maxPaths = 10,
  maxExpansions = 20_000,
): Rid[][] {
  if (from === to) return [[from]];
  const adj = new Map<Rid, Set<Rid>>();
  const add = (a: Rid, b: Rid) => {
    const s = adj.get(a) ?? new Set<Rid>();
    s.add(b);
    adj.set(a, s);
  };
  for (const e of edges) {
    add(e.src, e.dst);
    add(e.dst, e.src);
  }
  const paths: Rid[][] = [];
  let queue: Rid[][] = [[from]];
  let expansions = 0;
  for (let depth = 1; depth <= maxHops && queue.length > 0; depth++) {
    const next: Rid[][] = [];
    for (const path of queue) {
      const last = path[path.length - 1];
      for (const n of adj.get(last) ?? []) {
        if (path.includes(n)) continue;
        if (++expansions > maxExpansions) return paths;
        const p = [...path, n];
        if (n === to) {
          paths.push(p);
          if (paths.length >= maxPaths) return paths;
        } else {
          next.push(p);
        }
      }
    }
    queue = next;
  }
  return paths;
}
