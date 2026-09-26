/**
 * @fileoverview D1 implementation of ObjectReader. Every query filters by
 * tenant; list parameters are bound as JSON arrays and expanded with
 * json_each so one statement serves any list size.
 */

import type {FilterExpr, Rid} from '@ontodecide/shared-kernel';
import type {ObjectSummary} from '../contract';
import type {ObjectQuery, ObjectReader} from '../application/ports';
import type {
  AggregateFn,
  FuzzyCandidate,
  StoredLink,
  StoredObject,
} from '../domain';
import {OBJECT_COLUMNS, chunks, toStoredLink, toStoredObject} from './rows';
import type {LinkRow, ObjectRow} from './rows';
import {checkParams, filterToSql, likeEscape, orderToSql} from './sql_filter';

/** RIDs per json_each chunk. */
const CHUNK = 500;

/** D1-backed object and link reads. */
export class D1ObjectReader implements ObjectReader {
  constructor(private readonly db: D1Database) {}

  private async objects(
    sql: string,
    params: unknown[],
  ): Promise<StoredObject[]> {
    const {results} = await this.db
      .prepare(sql)
      .bind(...params)
      .all<ObjectRow>();
    return results.map(toStoredObject);
  }

  async getByRid(tenantId: string, rid: Rid): Promise<StoredObject | null> {
    const [o] = await this.objects(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o WHERE o.tenant_id = ? AND o.rid = ?`,
      [tenantId, rid],
    );
    return o ?? null;
  }

  async getByRids(
    tenantId: string,
    rids: readonly Rid[],
  ): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    for (const part of chunks([...new Set(rids)], CHUNK)) {
      out.push(
        ...(await this.objects(
          `SELECT ${OBJECT_COLUMNS} FROM og_object o
           WHERE o.tenant_id = ? AND o.rid IN (SELECT value FROM json_each(?))`,
          [tenantId, JSON.stringify(part)],
        )),
      );
    }
    return out;
  }

  async getByKeys(
    tenantId: string,
    keys: readonly {type: string; primaryKey: string}[],
  ): Promise<StoredObject[]> {
    if (!keys.length) return [];
    return this.objects(
      `SELECT ${OBJECT_COLUMNS} FROM json_each(?) j
       JOIN og_object o ON o.tenant_id = ?
        AND o.object_type = json_extract(j.value, '$[0]')
        AND o.primary_key = json_extract(j.value, '$[1]')`,
      [JSON.stringify(keys.map(k => [k.type, k.primaryKey])), tenantId],
    );
  }

  async findAliases(
    tenantId: string,
    keys: readonly {sourceId: string; externalKey: string}[],
  ): Promise<{sourceId: string; externalKey: string; rid: Rid}[]> {
    if (!keys.length) return [];
    const {results} = await this.db
      .prepare(
        `SELECT a.source_id, a.external_key, a.rid FROM json_each(?) j
         JOIN og_object_alias a ON a.source_id = json_extract(j.value, '$[0]')
          AND a.external_key = json_extract(j.value, '$[1]')
         WHERE a.tenant_id = ?`,
      )
      .bind(
        JSON.stringify(keys.map(k => [k.sourceId, k.externalKey])),
        tenantId,
      )
      .all<{source_id: string; external_key: string; rid: string}>();
    return results.map(r => ({
      sourceId: r.source_id,
      externalKey: r.external_key,
      rid: r.rid as Rid,
    }));
  }

  async fuzzyCandidates(
    tenantId: string,
    type: string,
    bucket: string,
    limit: number,
  ): Promise<FuzzyCandidate[]> {
    const {results} = await this.db
      .prepare(
        `SELECT rid, title FROM og_object
         WHERE tenant_id = ? AND object_type = ? AND lower(substr(trim(title), 1, 1)) = ?
         LIMIT ?`,
      )
      .bind(tenantId, type, bucket, limit)
      .all<{rid: string; title: string | null}>();
    return results.map(r => ({rid: r.rid as Rid, title: r.title ?? ''}));
  }

  private where(
    tenantId: string,
    type: string,
    filter: FilterExpr | undefined,
  ): {sql: string; params: unknown[]} {
    const f = filter ? filterToSql(filter) : null;
    return {
      sql: `o.tenant_id = ? AND o.object_type = ?${f ? ` AND ${f.sql}` : ''}`,
      params: [tenantId, type, ...(f?.params ?? [])],
    };
  }

  async query(tenantId: string, q: ObjectQuery): Promise<StoredObject[]> {
    const w = this.where(tenantId, q.type, q.filter);
    const order = orderToSql(q.orderBy);
    const params = [...order.joins.params, ...w.params, q.limit, q.offset];
    checkParams(params);
    return this.objects(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o ${order.joins.sql}
       WHERE ${w.sql} ORDER BY ${order.orderBy} LIMIT ? OFFSET ?`,
      params,
    );
  }

  async count(
    tenantId: string,
    type: string,
    filter?: FilterExpr,
  ): Promise<number> {
    const w = this.where(tenantId, type, filter);
    checkParams(w.params);
    const n = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM og_object o WHERE ${w.sql}`)
      .bind(...w.params)
      .first<number>('n');
    return Number(n ?? 0);
  }

  async queryRids(
    tenantId: string,
    type: string,
    filter: FilterExpr | undefined,
    limit: number,
  ): Promise<Rid[]> {
    const w = this.where(tenantId, type, filter);
    checkParams(w.params);
    const {results} = await this.db
      .prepare(
        `SELECT o.rid FROM og_object o WHERE ${w.sql} ORDER BY o.rid LIMIT ?`,
      )
      .bind(...w.params, limit)
      .all<{rid: string}>();
    return results.map(r => r.rid as Rid);
  }

  async aggregateIndexed(
    tenantId: string,
    type: string,
    filter: FilterExpr | undefined,
    prop: string,
    fn: Exclude<AggregateFn, 'count'>,
  ): Promise<number> {
    const w = this.where(tenantId, type, filter);
    const params = [prop, ...w.params];
    checkParams(params);
    const sqlFn = {sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX'}[fn];
    const v = await this.db
      .prepare(
        `SELECT ${sqlFn}(a.num_val) AS v FROM og_object o
         JOIN og_prop_index a ON a.rid = o.rid AND a.prop = ?
         WHERE ${w.sql} AND a.num_val IS NOT NULL`,
      )
      .bind(...params)
      .first<number | null>('v');
    return v === null || v === undefined ? 0 : Number(v);
  }

  async links(
    tenantId: string,
    rids: readonly Rid[],
    opts: {direction: 'out' | 'in' | 'both'; linkTypes?: readonly string[]},
  ): Promise<StoredLink[]> {
    const out: StoredLink[] = [];
    const types = opts.linkTypes?.length
      ? JSON.stringify(opts.linkTypes)
      : null;
    const typeSql = types
      ? ' AND link_type IN (SELECT value FROM json_each(?))'
      : '';
    for (const part of chunks([...new Set(rids)], CHUNK)) {
      const list = JSON.stringify(part);
      let cond: string;
      let params: unknown[];
      if (opts.direction === 'out') {
        cond = 'src_rid IN (SELECT value FROM json_each(?))';
        params = [list];
      } else if (opts.direction === 'in') {
        cond = 'dst_rid IN (SELECT value FROM json_each(?))';
        params = [list];
      } else {
        cond =
          '(src_rid IN (SELECT value FROM json_each(?)) OR dst_rid IN (SELECT value FROM json_each(?)))';
        params = [list, list];
      }
      const {results} = await this.db
        .prepare(
          `SELECT link_type, src_rid, dst_rid, weight FROM og_link
           WHERE tenant_id = ? AND ${cond}${typeSql}`,
        )
        .bind(tenantId, ...params, ...(types ? [types] : []))
        .all<LinkRow>();
      out.push(...results.map(toStoredLink));
    }
    return out;
  }

  async summaries(
    tenantId: string,
    rids: readonly Rid[],
  ): Promise<(ObjectSummary & {primaryKey: string})[]> {
    const out: (ObjectSummary & {primaryKey: string})[] = [];
    for (const part of chunks([...new Set(rids)], CHUNK)) {
      const {results} = await this.db
        .prepare(
          `SELECT rid, object_type, title, primary_key FROM og_object
           WHERE tenant_id = ? AND rid IN (SELECT value FROM json_each(?))`,
        )
        .bind(tenantId, JSON.stringify(part))
        .all<{
          rid: string;
          object_type: string;
          title: string | null;
          primary_key: string;
        }>();
      out.push(
        ...results.map(r => ({
          rid: r.rid as Rid,
          type: r.object_type,
          title: r.title ?? r.primary_key,
          primaryKey: r.primary_key,
        })),
      );
    }
    return out;
  }

  search(
    tenantId: string,
    q: string,
    type: string | undefined,
    limit: number,
  ): Promise<StoredObject[]> {
    return this.objects(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o
       WHERE o.tenant_id = ? AND o.title LIKE ? ESCAPE '\\'${type ? ' AND o.object_type = ?' : ''}
       ORDER BY o.title, o.rid LIMIT ?`,
      [tenantId, `%${likeEscape(q)}%`, ...(type ? [type] : []), limit],
    );
  }

  pageByTypes(
    tenantId: string,
    types: readonly string[],
    afterRid: string,
    limit: number,
  ): Promise<StoredObject[]> {
    return this.objects(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o
       WHERE o.tenant_id = ? AND o.object_type IN (SELECT value FROM json_each(?)) AND o.rid > ?
       ORDER BY o.rid LIMIT ?`,
      [tenantId, JSON.stringify(types), afterRid, limit],
    );
  }

  async pageLinks(
    tenantId: string,
    linkTypes: readonly string[],
    after: {type: string; src: string; dst: string} | null,
    limit: number,
  ): Promise<StoredLink[]> {
    const a = after ?? {type: '', src: '', dst: ''};
    const {results} = await this.db
      .prepare(
        `SELECT link_type, src_rid, dst_rid, weight FROM og_link
         WHERE tenant_id = ? AND link_type IN (SELECT value FROM json_each(?))
           AND (link_type, src_rid, dst_rid) > (?, ?, ?)
         ORDER BY link_type, src_rid, dst_rid LIMIT ?`,
      )
      .bind(tenantId, JSON.stringify(linkTypes), a.type, a.src, a.dst, limit)
      .all<LinkRow>();
    return results.map(toStoredLink);
  }
}
