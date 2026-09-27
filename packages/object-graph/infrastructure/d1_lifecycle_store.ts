/**
 * @fileoverview TenantLifecycle storage over object-graph-db
 * (SystemRepository; constructed only by the lifecycle entry point): keyset
 * export of objects, links and the action audit, bounded purge in the
 * design's order, counts and the local tombstone.
 */

import {SystemRepository, writeTombstone} from '@ontodecide/shared-kernel/d1';
import type {GraphExportFile, LifecycleStore} from '../application/ports';
import {toActionLogDto, toStoredLink, toStoredObject} from './rows';
import type {ActionLogDbRow, LinkRow, ObjectRow} from './rows';

/** Purge order (详细设计 6.11.3) with each table's key columns. */
export const PURGE_TABLES: readonly {table: string; key: string}[] = [
  {table: 'og_prop_index', key: 'rid, prop'},
  {table: 'og_link', key: 'src_rid, link_type, dst_rid'},
  {table: 'og_object', key: 'rid'},
  {table: 'og_action_log', key: 'id'},
  {table: 'domain_event', key: 'id'},
];

/** object-graph-db lifecycle storage. */
export class D1LifecycleStore
  extends SystemRepository
  implements LifecycleStore
{
  async exportRows(
    tid: string,
    file: GraphExportFile,
    after: string[] | null,
    limit: number,
  ): Promise<{key: string[]; record: unknown}[]> {
    if (file === 'objects.jsonl') {
      const {results} = await this.sql(
        `SELECT o.rid, o.object_type, o.primary_key, o.title, o.props,
                o.props_hash, o.provenance, o.version, o.updated_at
         FROM og_object o WHERE o.tenant_id = ?1 AND o.rid > ?2
         ORDER BY o.rid LIMIT ?3`,
        tid,
        after?.[0] ?? '',
        limit,
      ).all<ObjectRow>();
      return results.map(r => {
        const o = toStoredObject(r);
        return {
          key: [o.rid],
          record: {
            rid: o.rid,
            type: o.type,
            primaryKey: o.primaryKey,
            title: o.title,
            props: o.props,
            provenance: o.provenance,
            version: o.version,
            updatedAt: new Date(o.updatedAt).toISOString(),
          },
        };
      });
    }
    if (file === 'links.jsonl') {
      const [s, t, d] = after ?? ['', '', ''];
      const {results} = await this.sql(
        `SELECT src_rid, link_type, dst_rid, weight FROM og_link
         WHERE tenant_id = ?1 AND (src_rid, link_type, dst_rid) > (?2, ?3, ?4)
         ORDER BY src_rid, link_type, dst_rid LIMIT ?5`,
        tid,
        s ?? '',
        t ?? '',
        d ?? '',
        limit,
      ).all<LinkRow>();
      return results.map(r => {
        const l = toStoredLink(r);
        return {key: [l.src, l.type, l.dst], record: l};
      });
    }
    const {results} = await this.sql(
      `SELECT id, action_type, target_rid, params, before, after, actor,
              actor_user_id, recommendation_id, executed_at
       FROM og_action_log WHERE tenant_id = ?1 AND id > ?2
       ORDER BY id LIMIT ?3`,
      tid,
      after?.[0] ?? '',
      limit,
    ).all<ActionLogDbRow>();
    return results.map(r => ({key: [r.id], record: toActionLogDto(r)}));
  }

  async purgeStep(
    tid: string,
    maxRows: number,
  ): Promise<{deleted: number; remaining: boolean}> {
    let budget = maxRows;
    let deleted = 0;
    for (const {table, key} of PURGE_TABLES) {
      if (budget <= 0) return {deleted, remaining: true};
      const r = await this.sql(
        `DELETE FROM ${table} WHERE tenant_id = ?1 AND (${key}) IN
           (SELECT ${key} FROM ${table} WHERE tenant_id = ?1 LIMIT ?2)`,
        tid,
        budget,
      ).run();
      const n = Number(r.meta.changes ?? 0);
      deleted += n;
      budget -= n;
      if (n > 0 && budget <= 0) return {deleted, remaining: true};
    }
    return {deleted, remaining: false};
  }

  async count(tid: string): Promise<number> {
    const r = await this.sql(
      `SELECT (SELECT COUNT(*) FROM og_prop_index WHERE tenant_id = ?1)
            + (SELECT COUNT(*) FROM og_link WHERE tenant_id = ?1)
            + (SELECT COUNT(*) FROM og_object WHERE tenant_id = ?1)
            + (SELECT COUNT(*) FROM og_action_log WHERE tenant_id = ?1)
            + (SELECT COUNT(*) FROM domain_event WHERE tenant_id = ?1) AS n`,
      tid,
    ).first<{n: number}>();
    return Number(r?.n ?? 0);
  }

  async writeTombstone(tid: string, nowMs: number): Promise<void> {
    await writeTombstone(this.db, tid, nowMs).run();
  }
}
