/**
 * @fileoverview D1 ObjectReader: workspace-scoped object reads. Filters and
 * sort keys on indexed properties run on og_prop_index.
 */

import {TenantRepository} from '@ontodecide/shared-kernel/d1';
import type {FilterExpr, Rid} from '@ontodecide/shared-kernel';
import type {ObjectReader} from '../application/ports';
import type {GraphStats} from '../contract/types';
import type {GraphCounts, SortPlan, StoredObject} from '../domain';
import {OBJECT_COLUMNS, toStoredObject} from './rows';
import type {ObjectRow} from './rows';
import {SqlArgs, filterToSql, likePattern} from './sql_filter';

const SORT_COLUMNS = {
  title: 'o.title COLLATE NOCASE',
  primaryKey: 'o.primary_key',
  updatedAt: 'o.updated_at',
} as const;

/** Workspace-scoped object reads. */
export class D1ObjectReader extends TenantRepository implements ObjectReader {
  async counts(): Promise<GraphCounts & {tombstoned: boolean}> {
    const r = await this.stmt(
      `SELECT (SELECT COUNT(*) FROM og_object WHERE tenant_id = ?1) AS objects,
              (SELECT COUNT(*) FROM og_link WHERE tenant_id = ?1) AS links,
              EXISTS (SELECT 1 FROM tenant_tombstone WHERE tenant_id = ?1) AS tomb`,
    ).first<{objects: number; links: number; tomb: number}>();
    return {
      objects: Number(r?.objects ?? 0),
      links: Number(r?.links ?? 0),
      tombstoned: Number(r?.tomb ?? 0) === 1,
    };
  }

  async findByKeys(
    keys: {type: string; primaryKey: string}[],
  ): Promise<StoredObject[]> {
    if (!keys.length) return [];
    const {results} = await this.stmt(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o
       WHERE o.tenant_id = ?1 AND (o.object_type, o.primary_key) IN
         (SELECT j.value ->> 't', j.value ->> 'k' FROM json_each(?2) AS j)`,
      JSON.stringify(keys.map(k => ({t: k.type, k: k.primaryKey}))),
    ).all<ObjectRow>();
    return results.map(toStoredObject);
  }

  async get(rid: Rid): Promise<StoredObject | null> {
    const r = await this.stmt(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o
       WHERE o.tenant_id = ?1 AND o.rid = ?2`,
      rid,
    ).first<ObjectRow>();
    return r ? toStoredObject(r) : null;
  }

  async getMany(rids: Rid[]): Promise<StoredObject[]> {
    if (!rids.length) return [];
    const {results} = await this.stmt(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o
       WHERE o.tenant_id = ?1 AND o.rid IN (SELECT value FROM json_each(?2))`,
      JSON.stringify(rids),
    ).all<ObjectRow>();
    return results.map(toStoredObject);
  }

  async query(spec: {
    type?: string;
    q?: string;
    pushdown?: FilterExpr;
    sort: SortPlan;
    offset: number;
    limit: number | null;
  }): Promise<StoredObject[]> {
    const args = new SqlArgs();
    let join = '';
    let order = 'o.updated_at DESC, o.rid ASC';
    if (spec.sort.kind === 'indexed') {
      join =
        'LEFT JOIN og_prop_index s ON s.tenant_id = ?1 AND s.rid = o.rid ' +
        `AND s.prop = ${args.add(spec.sort.prop)}`;
      order = `s.value IS NULL, s.value ${spec.sort.dir.toUpperCase()}, o.rid ASC`;
    } else if (spec.sort.kind === 'column') {
      order =
        `${SORT_COLUMNS[spec.sort.key]} ${spec.sort.dir.toUpperCase()}, ` +
        'o.rid ASC';
    }
    const where = ['o.tenant_id = ?1'];
    if (spec.type) where.push(`o.object_type = ${args.add(spec.type)}`);
    if (spec.q) {
      const like = args.add(likePattern(spec.q));
      const exact = args.add(spec.q.toLowerCase());
      where.push(
        `(o.title LIKE ${like} ESCAPE '\\' OR o.primary_key LIKE ${like} ` +
          `ESCAPE '\\' OR lower(o.rid) = ${exact})`,
      );
    }
    if (spec.pushdown) where.push(filterToSql(spec.pushdown, 'o', args));
    let page = '';
    if (spec.limit !== null) {
      page = `LIMIT ${args.add(spec.limit)} OFFSET ${args.add(spec.offset)}`;
    }
    const {results} = await this.stmt(
      `SELECT ${OBJECT_COLUMNS} FROM og_object o ${join}
       WHERE ${where.join(' AND ')} ORDER BY ${order} ${page}`,
      ...args.values(),
    ).all<ObjectRow>();
    return results.map(toStoredObject);
  }

  async stats(): Promise<GraphStats> {
    const [types, links] = await this.db.batch([
      this.stmt(
        `SELECT object_type AS t, COUNT(*) AS n FROM og_object
         WHERE tenant_id = ?1 GROUP BY object_type`,
      ),
      this.stmt('SELECT COUNT(*) AS n FROM og_link WHERE tenant_id = ?1'),
    ]);
    const byType: Record<string, number> = {};
    let objects = 0;
    for (const r of types.results as {t: string; n: number}[]) {
      byType[r.t] = Number(r.n);
      objects += Number(r.n);
    }
    const n = (links.results as {n: number}[])[0]?.n ?? 0;
    return {objects, links: Number(n), byType};
  }
}
