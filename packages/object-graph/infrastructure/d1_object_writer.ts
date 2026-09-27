/**
 * @fileoverview D1 ObjectWriter (详细设计 6.2): every commit is one D1
 * batch. Upserts write the whole batch with one `INSERT … SELECT … FROM
 * json_each(?)` per table (unchanged rows skipped by props_hash), guarded
 * so that concurrent batches never exceed the object and link limits.
 * Patches and actions guard every statement on the expected version and run
 * the version-bumping UPDATE last, so they apply all-or-nothing.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {TenantRepository} from '@ontodecide/shared-kernel/d1';
import type {
  CommitOutcome,
  GuardedUpdate,
  HashedObject,
  ObjectWriter,
  OutboxRow,
  UpsertCommit,
} from '../application/ports';
import type {ActionLogRow} from '../application/ports';
import type {GraphCaps, PlannedLink, StoredLink} from '../domain';
import {linkKey} from '../domain';
import {isUniqueViolation} from './rows';

const GUARD =
  'EXISTS (SELECT 1 FROM og_object g WHERE g.tenant_id = ?1 AND ' +
  'g.rid = ?2 AND g.version = ?3)';

/** Workspace-scoped object writes. */
export class D1ObjectWriter extends TenantRepository implements ObjectWriter {
  /**
   * Outbox row of an upsert, written after the guarded object and link
   * statements of the same batch. RETURNING is not visible to later
   * statements, so the row keeps only the changes whose object this batch
   * wrote (props_hash and updated_at match) or that have a link this batch
   * wrote (weight matches); no row at all when nothing was written. Cron
   * redelivery therefore never resends objects rejected by the 300/900
   * guards.
   */
  private upsertOutboxStmt(
    row: OutboxRow,
    input: {objects: HashedObject[]; links: PlannedLink[]},
    nowMs: number,
  ): D1PreparedStatement {
    // Non-correlated IN subqueries: each set is built once per execution,
    // with one primary-key probe per planned object / link.
    const written = `(c.value ->> 'rid' IN (SELECT h.value ->> 'rid'
         FROM json_each(?5) AS h
         WHERE EXISTS (SELECT 1 FROM og_object o WHERE o.tenant_id = ?1
           AND o.rid = h.value ->> 'rid'
           AND o.props_hash = h.value ->> 'hash' AND o.updated_at = ?7))
       OR c.value ->> 'rid' IN (SELECT l.value ->> 's'
         FROM json_each(?6) AS l
         WHERE EXISTS (SELECT 1 FROM og_link k WHERE k.tenant_id = ?1
           AND k.src_rid = l.value ->> 's' AND k.link_type = l.value ->> 't'
           AND k.dst_rid = l.value ->> 'd'
           AND k.weight IS (l.value ->> 'w'))))`;
    return this.stmt(
      `INSERT INTO domain_event (tenant_id, id, payload, occurred_at)
       SELECT ?1, ?2, json_set(?3, '$.changes', json((
           SELECT json_group_array(json(w.value)) FROM (
             SELECT c.value AS value FROM json_each(?3, '$.changes') AS c
             WHERE ${written} ORDER BY c.key) AS w))), ?4
       WHERE EXISTS (SELECT 1 FROM json_each(?3, '$.changes') AS c
         WHERE ${written})`,
      row.id,
      JSON.stringify(row.msg),
      row.msg.occurredAt,
      JSON.stringify(input.objects.map(o => ({rid: o.rid, hash: o.hash}))),
      JSON.stringify(
        input.links.map(l => ({s: l.src, t: l.type, d: l.dst, w: l.weight})),
      ),
      nowMs,
    );
  }

  async commitUpsert(input: {
    objects: HashedObject[];
    links: PlannedLink[];
    caps: GraphCaps;
    outbox: OutboxRow | null;
    nowMs: number;
  }): Promise<UpsertCommit> {
    const stmts: D1PreparedStatement[] = [];
    let objectsAt = -1;
    let linksAt = -1;
    if (input.objects.length) {
      const objects = JSON.stringify(
        input.objects.map(o => ({
          rid: o.rid,
          type: o.type,
          pk: o.primaryKey,
          title: o.title,
          props: JSON.stringify(o.state.props),
          hash: o.hash,
          prov: JSON.stringify(o.state.provenance),
          n: o.newOrdinal,
        })),
      );
      objectsAt = stmts.length;
      stmts.push(
        this.stmt(
          `INSERT INTO og_object (tenant_id, rid, object_type, primary_key,
             title, props, props_hash, provenance, version, updated_at)
           SELECT ?1, j.value ->> 'rid', j.value ->> 'type', j.value ->> 'pk',
             j.value ->> 'title', j.value ->> 'props', j.value ->> 'hash',
             j.value ->> 'prov', 1, ?3
           FROM json_each(?2) AS j
           WHERE (j.value ->> 'n' IS NULL
             OR (SELECT COUNT(*) FROM og_object c WHERE c.tenant_id = ?1)
                + (j.value ->> 'n') <= ?4)
           ON CONFLICT (tenant_id, rid) DO UPDATE SET
             props = excluded.props, props_hash = excluded.props_hash,
             provenance = excluded.provenance, title = excluded.title,
             version = og_object.version + 1, updated_at = excluded.updated_at
           WHERE og_object.props_hash <> excluded.props_hash
           RETURNING rid`,
          objects,
          input.nowMs,
          input.caps.maxObjects,
        ),
      );
      const written = JSON.stringify(
        input.objects.map(o => ({rid: o.rid, hash: o.hash})),
      );
      stmts.push(
        this.stmt(
          `DELETE FROM og_prop_index WHERE tenant_id = ?1 AND rid IN
             (SELECT j.value ->> 'rid' FROM json_each(?2) AS j
              WHERE EXISTS (SELECT 1 FROM og_object o WHERE o.tenant_id = ?1
                AND o.rid = j.value ->> 'rid'
                AND o.props_hash = j.value ->> 'hash'))`,
          written,
        ),
      );
      const index = input.objects.flatMap(o =>
        o.index.map(i => ({
          rid: o.rid,
          type: o.type,
          hash: o.hash,
          prop: i.prop,
          v: i.value,
        })),
      );
      if (index.length) {
        stmts.push(
          this.stmt(
            `INSERT INTO og_prop_index (tenant_id, rid, prop, object_type, value)
             SELECT ?1, j.value ->> 'rid', j.value ->> 'prop',
               j.value ->> 'type', j.value ->> 'v'
             FROM json_each(?2) AS j
             WHERE EXISTS (SELECT 1 FROM og_object o WHERE o.tenant_id = ?1
               AND o.rid = j.value ->> 'rid'
               AND o.props_hash = j.value ->> 'hash')
             ON CONFLICT (tenant_id, rid, prop) DO UPDATE SET
               value = excluded.value, object_type = excluded.object_type`,
            JSON.stringify(index),
          ),
        );
      }
    }
    if (input.links.length) {
      linksAt = stmts.length;
      stmts.push(
        this.stmt(
          `INSERT INTO og_link (tenant_id, src_rid, link_type, dst_rid, weight)
           SELECT ?1, j.value ->> 's', j.value ->> 't', j.value ->> 'd',
             j.value ->> 'w'
           FROM json_each(?2) AS j
           WHERE EXISTS (SELECT 1 FROM og_object a WHERE a.tenant_id = ?1
               AND a.rid = j.value ->> 's')
             AND EXISTS (SELECT 1 FROM og_object b WHERE b.tenant_id = ?1
               AND b.rid = j.value ->> 'd')
             AND (j.value ->> 'n' IS NULL
               OR (SELECT COUNT(*) FROM og_link c WHERE c.tenant_id = ?1)
                  + (j.value ->> 'n') <= ?3)
           ON CONFLICT (tenant_id, src_rid, link_type, dst_rid) DO UPDATE SET
             weight = excluded.weight
           WHERE og_link.weight IS NOT excluded.weight
           RETURNING src_rid, link_type, dst_rid`,
          JSON.stringify(
            input.links.map(l => ({
              s: l.src,
              t: l.type,
              d: l.dst,
              w: l.weight,
              n: l.newOrdinal,
            })),
          ),
          input.caps.maxLinks,
        ),
      );
    }
    if (input.outbox) {
      stmts.push(this.upsertOutboxStmt(input.outbox, input, input.nowMs));
    }

    let results: D1Result[];
    try {
      results = await this.db.batch(stmts);
    } catch (e) {
      if (isUniqueViolation(e, 'og_object')) {
        throw new AppError('CONFLICT', 'Concurrent write; retry the batch');
      }
      throw e;
    }
    const objects = new Set<string>();
    if (objectsAt >= 0) {
      for (const r of results[objectsAt].results as {rid: string}[]) {
        objects.add(r.rid);
      }
    }
    const links = new Set<string>();
    if (linksAt >= 0) {
      for (const r of results[linksAt].results as {
        src_rid: string;
        link_type: string;
        dst_rid: string;
      }[]) {
        links.add(linkKey(r.src_rid, r.link_type, r.dst_rid));
      }
    }
    return {objects, links};
  }

  /** Statements replacing an object's index rows, guarded on its version. */
  private indexStmts(u: GuardedUpdate, type: string): D1PreparedStatement[] {
    if (!u.index) return [];
    const out = [
      this.stmt(
        `DELETE FROM og_prop_index WHERE tenant_id = ?1 AND rid = ?2
         AND ${GUARD}`,
        u.rid,
        u.expectedVersion,
      ),
    ];
    if (u.index.length) {
      out.push(
        this.stmt(
          `INSERT INTO og_prop_index (tenant_id, rid, prop, object_type, value)
           SELECT ?1, ?2, j.value ->> 'prop', ?4, j.value ->> 'v'
           FROM json_each(?5) AS j WHERE ${GUARD}`,
          u.rid,
          u.expectedVersion,
          type,
          JSON.stringify(u.index.map(i => ({prop: i.prop, v: i.value}))),
        ),
      );
    }
    return out;
  }

  private updateStmt(u: GuardedUpdate): D1PreparedStatement {
    return this.stmt(
      `UPDATE og_object SET props = ?4, props_hash = ?5, provenance = ?6,
         title = ?7, version = version + 1, updated_at = ?8
       WHERE tenant_id = ?1 AND rid = ?2 AND version = ?3`,
      u.rid,
      u.expectedVersion,
      JSON.stringify(u.state.props),
      u.hash,
      JSON.stringify(u.state.provenance),
      u.title,
      u.nowMs,
    );
  }

  private guardedOutbox(u: GuardedUpdate, row: OutboxRow): D1PreparedStatement {
    return this.stmt(
      `INSERT INTO domain_event (tenant_id, id, payload, occurred_at)
       SELECT ?1, ?4, ?5, ?6 WHERE ${GUARD}`,
      u.rid,
      u.expectedVersion,
      row.id,
      JSON.stringify(row.msg),
      row.msg.occurredAt,
    );
  }

  async commitPatch(u: GuardedUpdate, row: OutboxRow): Promise<CommitOutcome> {
    const type = u.rid.split('.')[1] ?? '';
    const stmts = [
      ...this.indexStmts(u, type),
      this.guardedOutbox(u, row),
      this.updateStmt(u),
    ];
    const results = await this.db.batch(stmts);
    return results[results.length - 1].meta.changes === 1 ? 'ok' : 'stale';
  }

  async commitAction(input: {
    update: GuardedUpdate;
    removeLinks: StoredLink[];
    addLinks: StoredLink[];
    log: ActionLogRow;
    outbox: OutboxRow;
  }): Promise<CommitOutcome> {
    const u = input.update;
    const type = u.rid.split('.')[1] ?? '';
    const linkJson = (ls: StoredLink[]): string =>
      JSON.stringify(
        ls.map(l => ({s: l.src, t: l.type, d: l.dst, w: l.weight})),
      );
    const stmts: D1PreparedStatement[] = [...this.indexStmts(u, type)];
    if (input.removeLinks.length) {
      stmts.push(
        this.stmt(
          `DELETE FROM og_link WHERE tenant_id = ?1
           AND (src_rid, link_type, dst_rid) IN
             (SELECT j.value ->> 's', j.value ->> 't', j.value ->> 'd'
              FROM json_each(?4) AS j)
           AND ${GUARD}`,
          u.rid,
          u.expectedVersion,
          linkJson(input.removeLinks),
        ),
      );
    }
    if (input.addLinks.length) {
      stmts.push(
        this.stmt(
          `INSERT INTO og_link (tenant_id, src_rid, link_type, dst_rid, weight)
           SELECT ?1, j.value ->> 's', j.value ->> 't', j.value ->> 'd',
             j.value ->> 'w'
           FROM json_each(?4) AS j WHERE ${GUARD}
           ON CONFLICT (tenant_id, src_rid, link_type, dst_rid) DO NOTHING`,
          u.rid,
          u.expectedVersion,
          linkJson(input.addLinks),
        ),
      );
    }
    const log = input.log;
    stmts.push(
      this.stmt(
        `INSERT INTO og_action_log (tenant_id, id, action_type, target_rid,
           params, before, after, actor, actor_user_id, recommendation_id,
           idempotency_key, result, executed_at)
         SELECT ?1, ?4, ?5, ?2, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
         WHERE ${GUARD}`,
        u.rid,
        u.expectedVersion,
        log.id,
        log.actionType,
        JSON.stringify(log.params),
        JSON.stringify(log.before),
        JSON.stringify(log.after),
        log.actor,
        log.actorUserId,
        log.recommendationId,
        log.idempotencyKey,
        JSON.stringify(log.result),
        log.executedAt,
      ),
      this.guardedOutbox(u, input.outbox),
      this.updateStmt(u),
    );
    try {
      const results = await this.db.batch(stmts);
      return results[results.length - 1].meta.changes === 1 ? 'ok' : 'stale';
    } catch (e) {
      if (isUniqueViolation(e, 'og_action_log')) return 'duplicate';
      throw e;
    }
  }
}
