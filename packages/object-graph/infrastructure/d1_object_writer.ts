/**
 * @fileoverview D1 implementation of ObjectWriter: translates a unit of
 * work into statements committed with one `db.batch()` (a transaction).
 */

import {indexValue} from '@ontodecide/ontology/contract';
import {AppError} from '@ontodecide/shared-kernel';
import type {ObjectWriter, WriteOp} from '../application/ports';
import type {StoredObject} from '../domain';

function objectValues(o: StoredObject): unknown[] {
  return [
    o.title,
    JSON.stringify(o.props),
    o.propsHash,
    JSON.stringify(o.provenance),
    JSON.stringify(o.history),
    o.schemaVersion,
    o.version,
    o.updatedAt,
  ];
}

/** D1-backed atomic writer. */
export class D1ObjectWriter implements ObjectWriter {
  constructor(private readonly db: D1Database) {}

  private statements(op: WriteOp): D1PreparedStatement[] {
    const db = this.db;
    switch (op.kind) {
      case 'insertObject':
        return [
          db
            .prepare(
              `INSERT INTO og_object (rid, tenant_id, object_type, primary_key, title, props,
                 props_hash, provenance, prov_history, schema_version, version, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              op.obj.rid,
              op.obj.tenantId,
              op.obj.type,
              op.obj.primaryKey,
              ...objectValues(op.obj),
            ),
        ];
      case 'updateObject':
        return [
          db
            .prepare(
              `UPDATE og_object SET title = ?, props = ?, props_hash = ?, provenance = ?,
                 prov_history = ?, schema_version = ?, version = ?, updated_at = ?
               WHERE tenant_id = ? AND rid = ?`,
            )
            .bind(...objectValues(op.obj), op.obj.tenantId, op.obj.rid),
        ];
      case 'deleteObject':
        return [
          db
            .prepare('DELETE FROM og_object WHERE tenant_id = ? AND rid = ?')
            .bind(op.tenantId, op.rid),
        ];
      case 'guardVersion':
        // Violates og_meta.key NOT NULL (aborting the batch) unless the
        // object still has the expected version.
        return [
          db
            .prepare(
              `INSERT INTO og_meta (tenant_id, key, value)
               SELECT ?, NULL, NULL
               WHERE NOT EXISTS (SELECT 1 FROM og_object WHERE tenant_id = ? AND rid = ? AND version = ?)`,
            )
            .bind(op.tenantId, op.tenantId, op.rid, op.version),
        ];
      case 'setIndex': {
        if (op.value === null || op.value === undefined) {
          return [
            db
              .prepare(
                'DELETE FROM og_prop_index WHERE tenant_id = ? AND rid = ? AND prop = ?',
              )
              .bind(op.tenantId, op.rid, op.prop),
          ];
        }
        const v = indexValue(op.value);
        return [
          db
            .prepare(
              `INSERT INTO og_prop_index (tenant_id, object_type, prop, rid, num_val, str_val)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (rid, prop) DO UPDATE SET
                 object_type = excluded.object_type, num_val = excluded.num_val, str_val = excluded.str_val`,
            )
            .bind(op.tenantId, op.type, op.prop, op.rid, v.num, v.str),
        ];
      }
      case 'clearIndex':
        return [
          db
            .prepare(
              'DELETE FROM og_prop_index WHERE tenant_id = ? AND rid = ?',
            )
            .bind(op.tenantId, op.rid),
        ];
      case 'clearIndexProp':
        return [
          db
            .prepare(
              'DELETE FROM og_prop_index WHERE tenant_id = ? AND object_type = ? AND prop = ?',
            )
            .bind(op.tenantId, op.type, op.prop),
        ];
      case 'upsertLink':
        return [
          db
            .prepare(
              `INSERT INTO og_link (tenant_id, link_type, src_rid, dst_rid, weight)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (link_type, src_rid, dst_rid) DO UPDATE SET
                 weight = COALESCE(excluded.weight, og_link.weight)`,
            )
            .bind(
              op.tenantId,
              op.link.type,
              op.link.src,
              op.link.dst,
              op.link.weight ?? null,
            ),
        ];
      case 'deleteLink':
        return [
          db
            .prepare(
              'DELETE FROM og_link WHERE tenant_id = ? AND link_type = ? AND src_rid = ? AND dst_rid = ?',
            )
            .bind(op.tenantId, op.link.type, op.link.src, op.link.dst),
        ];
      case 'moveLinks':
        return [
          db
            .prepare(
              `INSERT OR IGNORE INTO og_link (tenant_id, link_type, src_rid, dst_rid, weight, props)
               SELECT tenant_id, link_type, ?, dst_rid, weight, props FROM og_link
               WHERE tenant_id = ? AND src_rid = ? AND dst_rid <> ? AND dst_rid <> ?`,
            )
            .bind(op.to, op.tenantId, op.from, op.to, op.from),
          db
            .prepare(
              `INSERT OR IGNORE INTO og_link (tenant_id, link_type, src_rid, dst_rid, weight, props)
               SELECT tenant_id, link_type, src_rid, ?, weight, props FROM og_link
               WHERE tenant_id = ? AND dst_rid = ? AND src_rid <> ? AND src_rid <> ?`,
            )
            .bind(op.to, op.tenantId, op.from, op.to, op.from),
          db
            .prepare(
              'DELETE FROM og_link WHERE tenant_id = ? AND (src_rid = ? OR dst_rid = ?)',
            )
            .bind(op.tenantId, op.from, op.from),
        ];
      case 'alias':
        return [
          db
            .prepare(
              op.replace
                ? `INSERT INTO og_object_alias (tenant_id, source_id, external_key, rid) VALUES (?, ?, ?, ?)
                   ON CONFLICT (source_id, external_key) DO UPDATE SET rid = excluded.rid`
                : `INSERT OR IGNORE INTO og_object_alias (tenant_id, source_id, external_key, rid)
                   VALUES (?, ?, ?, ?)`,
            )
            .bind(op.tenantId, op.sourceId, op.externalKey, op.rid),
        ];
      case 'mergeSuggestion':
        return [
          db
            .prepare(
              `INSERT INTO og_merge_suggestion (id, tenant_id, rid_a, rid_b, score, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
            )
            .bind(op.id, op.tenantId, op.ridA, op.ridB, op.score, op.createdAt),
        ];
      case 'resolveSuggestion':
        return [
          db
            .prepare(
              'UPDATE og_merge_suggestion SET status = ? WHERE tenant_id = ? AND id = ?',
            )
            .bind(op.status, op.tenantId, op.id),
        ];
      case 'actionLog': {
        const e = op.entry;
        return [
          db
            .prepare(
              `INSERT INTO og_action_log (id, tenant_id, action_type, target_rid, params, before, after,
                 actor, recommendation_id, writeback_status, writeback_attempts, executed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              e.id,
              e.tenantId,
              e.actionType,
              e.targetRid,
              JSON.stringify(e.params),
              JSON.stringify(e.before),
              JSON.stringify(e.after),
              e.actor,
              e.recommendationId ?? null,
              e.writebackStatus,
              e.writebackAttempts,
              Date.parse(e.executedAt),
            ),
        ];
      }
      case 'outbox':
        return [
          db
            .prepare(
              `INSERT INTO domain_event (id, tenant_id, type, topic, payload, occurred_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              op.event.id,
              op.event.tenantId,
              op.event.type,
              op.event.topic,
              JSON.stringify(op.event.payload),
              op.event.occurredAt,
            ),
        ];
      case 'inbox':
        return [
          db
            .prepare(
              'INSERT INTO og_inbox (msg_key, processed_at, tenant_id, result) VALUES (?, ?, ?, ?)',
            )
            .bind(op.key, op.at, op.tenantId, JSON.stringify(op.result)),
        ];
      case 'meta':
        return [
          db
            .prepare(
              `INSERT INTO og_meta (tenant_id, key, value) VALUES (?, ?, ?)
               ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value`,
            )
            .bind(op.tenantId, op.key, op.value),
        ];
      default:
        return [];
    }
  }

  /**
   * One statement for a run of same-kind ops (rows passed as a JSON array),
   * or null when the kind has no bulk form. Keeps a large upsert batch to a
   * handful of statements.
   */
  private bulk(
    key: string,
    ops: readonly WriteOp[],
  ): D1PreparedStatement | null {
    const db = this.db;
    const rows = (f: (op: WriteOp) => unknown[]) => JSON.stringify(ops.map(f));
    const col = (i: number) => `json_extract(j.value, '$[${i}]')`;
    const cols = (n: number) =>
      Array.from({length: n}, (_, i) => col(i)).join(', ');
    switch (key) {
      case 'insertObject':
        return db
          .prepare(
            `INSERT INTO og_object (rid, tenant_id, object_type, primary_key, title, props,
               props_hash, provenance, prov_history, schema_version, version, updated_at)
             SELECT ${cols(12)} FROM json_each(?) j`,
          )
          .bind(
            rows(op => {
              const o = (op as Extract<WriteOp, {kind: 'insertObject'}>).obj;
              return [
                o.rid,
                o.tenantId,
                o.type,
                o.primaryKey,
                ...objectValues(o),
              ];
            }),
          );
      case 'updateObject':
        return db
          .prepare(
            `UPDATE og_object SET title = u.title, props = u.props, props_hash = u.props_hash,
               provenance = u.provenance, prov_history = u.prov_history,
               schema_version = u.schema_version, version = u.version, updated_at = u.updated_at
             FROM (SELECT ${col(0)} AS tenant_id, ${col(1)} AS rid, ${col(2)} AS title,
                     ${col(3)} AS props, ${col(4)} AS props_hash, ${col(5)} AS provenance,
                     ${col(6)} AS prov_history, ${col(7)} AS schema_version,
                     ${col(8)} AS version, ${col(9)} AS updated_at
                   FROM json_each(?) j) AS u
             WHERE og_object.tenant_id = u.tenant_id AND og_object.rid = u.rid`,
          )
          .bind(
            rows(op => {
              const o = (op as Extract<WriteOp, {kind: 'updateObject'}>).obj;
              return [o.tenantId, o.rid, ...objectValues(o)];
            }),
          );
      case 'guardVersion':
        return db
          .prepare(
            `INSERT INTO og_meta (tenant_id, key, value)
             SELECT ${col(0)}, NULL, NULL FROM json_each(?) j
             WHERE NOT EXISTS (SELECT 1 FROM og_object g
               WHERE g.tenant_id = ${col(0)} AND g.rid = ${col(1)} AND g.version = ${col(2)})`,
          )
          .bind(
            rows(op => {
              const g = op as Extract<WriteOp, {kind: 'guardVersion'}>;
              return [g.tenantId, g.rid, g.version];
            }),
          );
      case 'setIndex': {
        return db
          .prepare(
            `INSERT INTO og_prop_index (tenant_id, object_type, prop, rid, num_val, str_val)
             SELECT ${cols(6)} FROM json_each(?) j WHERE true
             ON CONFLICT (rid, prop) DO UPDATE SET
               object_type = excluded.object_type, num_val = excluded.num_val, str_val = excluded.str_val`,
          )
          .bind(
            rows(op => {
              const x = op as Extract<WriteOp, {kind: 'setIndex'}>;
              const v = indexValue(x.value);
              return [x.tenantId, x.type, x.prop, x.rid, v.num, v.str];
            }),
          );
      }
      case 'setIndex:delete':
        return db
          .prepare(
            `DELETE FROM og_prop_index WHERE EXISTS (SELECT 1 FROM json_each(?) j
               WHERE og_prop_index.tenant_id = ${col(0)} AND og_prop_index.rid = ${col(1)}
                 AND og_prop_index.prop = ${col(2)})`,
          )
          .bind(
            rows(op => {
              const x = op as Extract<WriteOp, {kind: 'setIndex'}>;
              return [x.tenantId, x.rid, x.prop];
            }),
          );
      case 'upsertLink':
        return db
          .prepare(
            `INSERT INTO og_link (tenant_id, link_type, src_rid, dst_rid, weight)
             SELECT ${cols(5)} FROM json_each(?) j WHERE true
             ON CONFLICT (link_type, src_rid, dst_rid) DO UPDATE SET
               weight = COALESCE(excluded.weight, og_link.weight)`,
          )
          .bind(
            rows(op => {
              const x = op as Extract<WriteOp, {kind: 'upsertLink'}>;
              return [
                x.tenantId,
                x.link.type,
                x.link.src,
                x.link.dst,
                x.link.weight ?? null,
              ];
            }),
          );
      case 'deleteLink':
        return db
          .prepare(
            `DELETE FROM og_link WHERE EXISTS (SELECT 1 FROM json_each(?) j
               WHERE og_link.tenant_id = ${col(0)} AND og_link.link_type = ${col(1)}
                 AND og_link.src_rid = ${col(2)} AND og_link.dst_rid = ${col(3)})`,
          )
          .bind(
            rows(op => {
              const x = op as Extract<WriteOp, {kind: 'deleteLink'}>;
              return [x.tenantId, x.link.type, x.link.src, x.link.dst];
            }),
          );
      case 'alias':
        return db
          .prepare(
            `INSERT OR IGNORE INTO og_object_alias (tenant_id, source_id, external_key, rid)
             SELECT ${cols(4)} FROM json_each(?) j`,
          )
          .bind(
            rows(op => {
              const x = op as Extract<WriteOp, {kind: 'alias'}>;
              return [x.tenantId, x.sourceId, x.externalKey, x.rid];
            }),
          );
      case 'mergeSuggestion':
        return db
          .prepare(
            `INSERT INTO og_merge_suggestion (id, tenant_id, rid_a, rid_b, score, status, created_at)
             SELECT ${col(0)}, ${col(1)}, ${col(2)}, ${col(3)}, ${col(4)}, 'OPEN', ${col(5)}
             FROM json_each(?) j`,
          )
          .bind(
            rows(op => {
              const x = op as Extract<WriteOp, {kind: 'mergeSuggestion'}>;
              return [x.id, x.tenantId, x.ridA, x.ridB, x.score, x.createdAt];
            }),
          );
      case 'outbox':
        return db
          .prepare(
            `INSERT INTO domain_event (id, tenant_id, type, topic, payload, occurred_at)
             SELECT ${cols(6)} FROM json_each(?) j`,
          )
          .bind(
            rows(op => {
              const e = (op as Extract<WriteOp, {kind: 'outbox'}>).event;
              return [
                e.id,
                e.tenantId,
                e.type,
                e.topic,
                JSON.stringify(e.payload),
                e.occurredAt,
              ];
            }),
          );
      default:
        return null;
    }
  }

  async commit(ops: readonly WriteOp[]): Promise<void> {
    const keyOf = (op: WriteOp): string => {
      if (
        op.kind === 'setIndex' &&
        (op.value === null || op.value === undefined)
      ) {
        return 'setIndex:delete';
      }
      if (op.kind === 'alias' && op.replace) return 'alias:replace';
      return op.kind;
    };
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < ops.length;) {
      const key = keyOf(ops[i]);
      let j = i + 1;
      while (j < ops.length && keyOf(ops[j]) === key) j++;
      const run = ops.slice(i, j);
      const bulk = run.length > 1 ? this.bulk(key, run) : null;
      if (bulk) stmts.push(bulk);
      else for (const op of run) stmts.push(...this.statements(op));
      i = j;
    }
    if (!stmts.length) return;
    try {
      await this.db.batch(stmts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('og_meta.key')) {
        throw new AppError('VERSION_CONFLICT', 'Object version changed');
      }
      if (msg.includes('og_inbox.msg_key')) {
        throw new AppError('CONFLICT', 'Message already processed', {
          duplicate: 'inbox',
        });
      }
      throw e;
    }
  }
}
