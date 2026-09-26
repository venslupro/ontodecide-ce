/**
 * @fileoverview D1 repository for int_source.
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {SourceRecord, SourceRepository} from '../application';
import type {
  ConflictPolicy,
  MappingSpec,
  QualityRule,
  SourceKind,
} from '../contract';

interface SourceRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: string;
  config: string;
  secret_enc: string | null;
  mapping: string;
  quality_rules: string;
  conflict_policy: string;
  priority: number;
  schedule: string | null;
  cursor: string | null;
  enabled: number;
  paused: number;
  last_job_at: number | null;
  created_at: number;
}

const COLUMNS =
  'id, tenant_id, name, kind, config, secret_enc, mapping, quality_rules, conflict_policy, ' +
  'priority, schedule, cursor, enabled, paused, last_job_at, created_at';

function fromRow(r: SourceRow): SourceRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    kind: r.kind as SourceKind,
    config: parseJson<Record<string, unknown>>(r.config, {}),
    secretEnc: r.secret_enc,
    mapping: parseJson<MappingSpec>(r.mapping, {
      targetType: '',
      primaryKey: {from: ''},
      fields: [],
    }),
    qualityRules: parseJson<QualityRule[]>(r.quality_rules, []),
    conflictPolicy: r.conflict_policy as ConflictPolicy,
    priority: r.priority,
    schedule: r.schedule,
    cursor: r.cursor,
    enabled: r.enabled === 1,
    paused: r.paused === 1,
    lastJobAt: r.last_job_at,
    createdAt: r.created_at,
  };
}

/** int_source over D1. */
export class D1SourceRepository implements SourceRepository {
  constructor(private readonly db: D1Database) {}

  async list(ctx: CallCtx): Promise<SourceRecord[]> {
    const {results} = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM int_source WHERE tenant_id = ? ORDER BY created_at, id`,
      )
      .bind(ctx.tenantId)
      .all<SourceRow>();
    return results.map(fromRow);
  }

  async get(ctx: CallCtx, id: string): Promise<SourceRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM int_source WHERE tenant_id = ? AND id = ?`,
      )
      .bind(ctx.tenantId, id)
      .first<SourceRow>();
    return row ? fromRow(row) : null;
  }

  async insert(s: SourceRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO int_source (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        s.id,
        s.tenantId,
        s.name,
        s.kind,
        JSON.stringify(s.config),
        s.secretEnc,
        JSON.stringify(s.mapping),
        JSON.stringify(s.qualityRules),
        s.conflictPolicy,
        s.priority,
        s.schedule,
        s.cursor,
        s.enabled ? 1 : 0,
        s.paused ? 1 : 0,
        s.lastJobAt,
        s.createdAt,
      )
      .run();
  }

  async update(s: SourceRecord): Promise<void> {
    await this.db
      .prepare(
        `UPDATE int_source SET name = ?, config = ?, secret_enc = ?, mapping = ?, quality_rules = ?,
           conflict_policy = ?, priority = ?, schedule = ?, enabled = ?, paused = ?
         WHERE tenant_id = ? AND id = ?`,
      )
      .bind(
        s.name,
        JSON.stringify(s.config),
        s.secretEnc,
        JSON.stringify(s.mapping),
        JSON.stringify(s.qualityRules),
        s.conflictPolicy,
        s.priority,
        s.schedule,
        s.enabled ? 1 : 0,
        s.paused ? 1 : 0,
        s.tenantId,
        s.id,
      )
      .run();
  }

  async delete(ctx: CallCtx, id: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM int_source WHERE tenant_id = ? AND id = ?')
      .bind(ctx.tenantId, id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async setCursor(
    ctx: CallCtx,
    id: string,
    cursor: string | null,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE int_source SET cursor = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(cursor, ctx.tenantId, id)
      .run();
  }

  async touchLastJob(ctx: CallCtx, id: string, at: number): Promise<void> {
    await this.db
      .prepare(
        'UPDATE int_source SET last_job_at = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(at, ctx.tenantId, id)
      .run();
  }

  async setPaused(
    ctx: CallCtx,
    ids: string[],
    paused: boolean,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.db
      .prepare(
        `UPDATE int_source SET paused = ? WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      )
      .bind(paused ? 1 : 0, ctx.tenantId, ...ids)
      .run();
    return res.meta?.changes ?? 0;
  }

  async findForWebhook(id: string): Promise<SourceRecord | null> {
    // Tenant-less by design: the webhook URL carries only the source id and
    // the tenant is taken from the source row.
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM int_source WHERE id = ? AND kind = 'webhook'`,
      )
      .bind(id)
      .first<SourceRow>();
    return row ? fromRow(row) : null;
  }

  async listPullable(): Promise<SourceRecord[]> {
    // Cross-tenant system scan (cron); callers switch to systemCtx(tenant).
    const {results} = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM int_source
         WHERE kind = 'rest' AND enabled = 1 AND paused = 0
         ORDER BY tenant_id, id LIMIT 200`,
      )
      .all<SourceRow>();
    return results.map(fromRow);
  }
}
