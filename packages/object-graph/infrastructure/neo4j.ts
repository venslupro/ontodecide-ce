/**
 * @fileoverview Neo4j adapters over the HTTPS Query API
 * (`POST {base}/db/{db}/query/v2`, Basic auth): a small client, the
 * projection writer (MERGE grouped by type with fixed labels, no APOC) and a
 * GraphTraversal for 3-hop queries.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {Rid} from '@ontodecide/shared-kernel';
import {GRAPH_LIMITS} from '../contract';
import type {GraphSyncMsg} from '../contract';
import type {
  GraphProjection,
  GraphTraversal,
  TraversalResult,
} from '../application/ports';
import {bfs} from '../domain';
import type {StoredLink} from '../domain';

/** Connection settings. */
export interface Neo4jConfig {
  url: string;
  user: string;
  password: string;
  database?: string;
}

/** Tabular query result. */
export interface Neo4jResult {
  fields: string[];
  values: unknown[][];
}

/** Converts `neo4j+s://host` (or bolt/https) into the HTTPS base URL. */
export function neo4jBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/^(neo4j|bolt)(\+s|\+ssc)?:\/\//, 'https://')
    .replace(/\/+$/, '');
}

/** Whether a name can be used as a label / relationship type. */
export function safeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Minimal Query API client with a request timeout. */
export class Neo4jClient {
  private readonly endpoint: string;
  private readonly auth: string;

  constructor(
    cfg: Neo4jConfig,
    private readonly fetchFn: typeof fetch,
    private readonly timeoutMs: number = GRAPH_LIMITS.neo4jTimeoutMs,
  ) {
    this.endpoint = `${neo4jBaseUrl(cfg.url)}/db/${encodeURIComponent(cfg.database || 'neo4j')}/query/v2`;
    this.auth = `Basic ${btoa(`${cfg.user}:${cfg.password}`)}`;
  }

  /** Runs one parameterised statement. */
  async run(
    statement: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Neo4jResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: this.auth,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({statement, parameters}),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const body = text
        ? (JSON.parse(text) as {
            data?: {fields?: string[]; values?: unknown[][]};
            errors?: {code?: string; message?: string}[];
          })
        : {};
      if (!res.ok || body.errors?.length) {
        throw new AppError(
          'UPSTREAM_FAILED',
          `Neo4j ${res.status}: ${body.errors?.[0]?.code ?? 'error'}`,
        );
      }
      return {fields: body.data?.fields ?? [], values: body.data?.values ?? []};
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Keeps only values Neo4j can store as node properties. */
export function scalarProps(
  idx: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(idx)) {
    if (!safeIdent(k)) continue;
    if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Maps result rows to objects keyed by field name. */
export function rowsOf(r: Neo4jResult): Record<string, unknown>[] {
  return r.values.map(v =>
    Object.fromEntries(r.fields.map((f, i) => [f, v[i]])),
  );
}

/** Projection writer. */
export class Neo4jProjection implements GraphProjection {
  readonly enabled = true;
  constructor(private readonly client: Neo4jClient) {}

  async sync(msg: GraphSyncMsg): Promise<void> {
    const byType = new Map<string, GraphSyncMsg['upserts']>();
    for (const u of msg.upserts) {
      if (!safeIdent(u.type)) continue;
      byType.set(u.type, [...(byType.get(u.type) ?? []), u]);
    }
    for (const [type, rows] of byType) {
      await this.client.run(
        `UNWIND $rows AS u
         MERGE (n:Object {rid: u.rid})
         SET n:\`${type}\`, n += u.idx, n.title = u.title, n.tenant = $tenant`,
        {
          tenant: msg.tenantId,
          rows: rows.map(u => ({
            rid: u.rid,
            title: u.title,
            idx: scalarProps(u.idx),
          })),
        },
      );
    }
    const byLink = new Map<string, GraphSyncMsg['links']>();
    for (const l of msg.links) {
      if (!safeIdent(l.type)) continue;
      const k = `${l.op}|${l.type}`;
      byLink.set(k, [...(byLink.get(k) ?? []), l]);
    }
    for (const [k, rows] of byLink) {
      const [op, type] = k.split('|');
      const params = {
        tenant: msg.tenantId,
        rows: rows.map(l => ({
          src: l.src,
          dst: l.dst,
          weight: l.weight ?? null,
        })),
      };
      if (op === 'delete') {
        await this.client.run(
          `UNWIND $rows AS l
           MATCH (a:Object {rid: l.src})-[r:\`${type}\`]->(b:Object {rid: l.dst})
           WHERE a.tenant = $tenant
           DELETE r`,
          params,
        );
      } else {
        await this.client.run(
          `UNWIND $rows AS l
           MERGE (a:Object {rid: l.src}) ON CREATE SET a.tenant = $tenant
           MERGE (b:Object {rid: l.dst}) ON CREATE SET b.tenant = $tenant
           MERGE (a)-[r:\`${type}\`]->(b)
           SET r.weight = l.weight`,
          params,
        );
      }
    }
  }

  async heartbeat(at: Date): Promise<void> {
    await this.client.run(
      "MERGE (c:Checkpoint {name: 'heartbeat'}) SET c.at = $at",
      {at: at.toISOString()},
    );
  }
}

/** Projection used when Neo4j is disabled: acknowledges as a no-op. */
export const noopProjection: GraphProjection = {
  enabled: false,
  sync: async () => {},
  heartbeat: async () => {},
};

/** Deep traversal served by Neo4j. */
export class Neo4jGraphTraversal implements GraphTraversal {
  constructor(private readonly client: Neo4jClient) {}

  async impact(
    tenantId: string,
    q: {
      rids: readonly Rid[];
      linkTypes?: readonly string[];
      maxHops: number;
      limit: number;
    },
  ): Promise<TraversalResult> {
    const hops = Math.min(
      GRAPH_LIMITS.neo4jMaxHops,
      Math.max(1, Math.floor(q.maxHops)),
    );
    const r = await this.client.run(
      `UNWIND $rids AS root
       MATCH p = (s:Object {rid: root})-[rs*1..${hops}]->(t:Object)
       WHERE s.tenant = $tenant AND t.tenant = $tenant
         AND (size($linkTypes) = 0 OR all(x IN rs WHERE type(x) IN $linkTypes))
       WITH p LIMIT $pathLimit
       UNWIND relationships(p) AS r
       RETURN DISTINCT startNode(r).rid AS src, endNode(r).rid AS dst, type(r) AS type, r.weight AS weight`,
      {
        tenant: tenantId,
        rids: [...q.rids],
        linkTypes: [...(q.linkTypes ?? [])],
        pathLimit: q.limit * 10,
      },
    );
    const edges: StoredLink[] = rowsOf(r).map(row => ({
      type: String(row.type),
      src: String(row.src) as Rid,
      dst: String(row.dst) as Rid,
      weight: typeof row.weight === 'number' ? row.weight : null,
    }));
    const t = bfs(q.rids, edges, hops, q.limit);
    return {
      nodes: [...t.hops].map(([rid, hop]) => ({rid, hop})),
      edges: t.edges,
    };
  }

  async paths(
    tenantId: string,
    from: Rid,
    to: Rid,
    maxHops: number,
  ): Promise<Rid[][]> {
    const hops = Math.min(4, Math.max(1, Math.floor(maxHops)));
    const r = await this.client.run(
      `MATCH p = (a:Object {rid: $from})-[*1..${hops}]-(b:Object {rid: $to})
       WHERE a.tenant = $tenant AND b.tenant = $tenant
       RETURN [n IN nodes(p) | n.rid] AS rids ORDER BY length(p) LIMIT 10`,
      {tenant: tenantId, from, to},
    );
    return rowsOf(r).map(row => (row.rids as string[]).map(x => x as Rid));
  }
}
