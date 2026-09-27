/**
 * @fileoverview D1 GraphTraversal (详细设计 6.3.2): recursive CTEs over
 * og_link (whose primary key doubles as the outgoing-edge index; incoming
 * edges use ix_link_dst), depth ≤ 2, filtered by workspace.
 */

import {TenantRepository} from '@ontodecide/shared-kernel/d1';
import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphTraversal} from '../application/ports';
import type {StoredLink, WalkHit} from '../domain';
import {toStoredLink} from './rows';
import type {LinkRow} from './rows';

const LINK_COLUMNS = 'src_rid, link_type, dst_rid, weight';

const DIRECTION_JOIN = {
  out: 'l.src_rid = w.rid',
  in: 'l.dst_rid = w.rid',
  both: '(l.src_rid = w.rid OR l.dst_rid = w.rid)',
} as const;

function typesParam(types: string[] | undefined): string | null {
  return types && types.length ? JSON.stringify(types) : null;
}

/** Workspace-scoped link traversal. */
export class D1GraphTraversal
  extends TenantRepository
  implements GraphTraversal
{
  async linksFrom(rids: Rid[]): Promise<StoredLink[]> {
    if (!rids.length) return [];
    const {results} = await this.stmt(
      `SELECT ${LINK_COLUMNS} FROM og_link
       WHERE tenant_id = ?1 AND src_rid IN (SELECT value FROM json_each(?2))`,
      JSON.stringify(rids),
    ).all<LinkRow>();
    return results.map(toStoredLink);
  }

  async linksOf(rid: Rid, types: string[]): Promise<StoredLink[]> {
    if (!types.length) return [];
    const {results} = await this.stmt(
      `SELECT ${LINK_COLUMNS} FROM og_link
       WHERE tenant_id = ?1 AND (src_rid = ?2 OR dst_rid = ?2)
         AND link_type IN (SELECT value FROM json_each(?3))`,
      rid,
      JSON.stringify(types),
    ).all<LinkRow>();
    return results.map(toStoredLink);
  }

  async walk(q: {
    rid: Rid;
    depth: 1 | 2;
    direction: 'out' | 'in' | 'both';
    types?: string[];
    limit: number;
  }): Promise<WalkHit[]> {
    const {results} = await this.stmt(
      `WITH RECURSIVE walk(rid, hop) AS (
         SELECT ?2, 0
         UNION
         SELECT CASE WHEN l.src_rid = w.rid THEN l.dst_rid ELSE l.src_rid END,
                w.hop + 1
         FROM walk w JOIN og_link l
           ON l.tenant_id = ?1 AND ${DIRECTION_JOIN[q.direction]}
         WHERE w.hop < ?3
           AND (?4 IS NULL OR l.link_type IN (SELECT value FROM json_each(?4)))
       )
       SELECT rid, MIN(hop) AS hop FROM walk GROUP BY rid
       ORDER BY hop, rid LIMIT ?5`,
      q.rid,
      q.depth,
      typesParam(q.types),
      q.limit,
    ).all<{rid: string; hop: number}>();
    return results.map(r => ({rid: r.rid, hop: Number(r.hop)}));
  }

  async impactWalk(q: {
    rids: Rid[];
    types: string[];
    depth: 1 | 2;
    limit: number;
  }): Promise<WalkHit[]> {
    const {results} = await this.stmt(
      `WITH RECURSIVE walk(rid, hop, exposure) AS (
         SELECT value, 0, 1.0 FROM json_each(?2)
         UNION
         SELECT l.dst_rid, w.hop + 1, w.exposure * COALESCE(l.weight, 1.0)
         FROM walk w JOIN og_link l ON l.tenant_id = ?1 AND l.src_rid = w.rid
         WHERE w.hop < ?3
           AND l.link_type IN (SELECT value FROM json_each(?4))
       )
       SELECT rid, MIN(hop) AS hop, MAX(exposure) AS exposure FROM walk
       GROUP BY rid ORDER BY hop, exposure DESC, rid LIMIT ?5`,
      JSON.stringify(q.rids),
      q.depth,
      JSON.stringify(q.types),
      q.limit,
    ).all<{rid: string; hop: number}>();
    return results.map(r => ({rid: r.rid, hop: Number(r.hop)}));
  }

  async edgesAmong(rids: string[], types?: string[]): Promise<StoredLink[]> {
    if (!rids.length) return [];
    const {results} = await this.stmt(
      `SELECT ${LINK_COLUMNS} FROM og_link
       WHERE tenant_id = ?1
         AND src_rid IN (SELECT value FROM json_each(?2))
         AND dst_rid IN (SELECT value FROM json_each(?2))
         AND (?3 IS NULL OR link_type IN (SELECT value FROM json_each(?3)))`,
      JSON.stringify(rids),
      typesParam(types),
    ).all<LinkRow>();
    return results.map(toStoredLink);
  }
}
