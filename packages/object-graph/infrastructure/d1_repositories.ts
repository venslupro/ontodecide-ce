/**
 * @fileoverview D1 repositories for action logs, merge suggestions, saved
 * object sets, metadata and the object-writes inbox.
 */

import type {WriteResult} from '@ontodecide/integration/contract';
import {parseJson} from '@ontodecide/shared-kernel';
import type {ObjectSetDef, Rid} from '@ontodecide/shared-kernel';
import type {
  MergeSuggestionDto,
  ObjectSetDto,
  WritebackStatus,
} from '../contract';
import type {
  ActionLogRecord,
  ActionLogRepository,
  InboxRecord,
  MergeSuggestionRepository,
  MetaRepository,
  ObjectSetRepository,
} from '../application/ports';

interface ActionLogRow {
  id: string;
  tenant_id: string;
  action_type: string;
  target_rid: string;
  params: string | null;
  before: string | null;
  after: string | null;
  actor: string;
  recommendation_id: string | null;
  writeback_status: string;
  writeback_attempts: number;
  executed_at: number;
}

const ACTION_COLUMNS =
  'id, tenant_id, action_type, target_rid, params, before, after, actor, recommendation_id, writeback_status, writeback_attempts, executed_at';

function toActionLog(r: ActionLogRow): ActionLogRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    actionType: r.action_type,
    targetRid: r.target_rid as Rid,
    params: parseJson(r.params, {}),
    before: parseJson(r.before, {}),
    after: parseJson(r.after, {}),
    actor: r.actor,
    ...(r.recommendation_id ? {recommendationId: r.recommendation_id} : {}),
    writebackStatus: r.writeback_status as WritebackStatus,
    writebackAttempts: Number(r.writeback_attempts),
    executedAt: new Date(Number(r.executed_at)).toISOString(),
  };
}

/** og_action_log access. */
export class D1ActionLogRepository implements ActionLogRepository {
  constructor(private readonly db: D1Database) {}

  async findByRecommendation(
    tenantId: string,
    recommendationId: string,
    actionType: string,
    target: Rid,
  ): Promise<ActionLogRecord | null> {
    const r = await this.db
      .prepare(
        `SELECT ${ACTION_COLUMNS} FROM og_action_log
         WHERE tenant_id = ? AND recommendation_id = ? AND action_type = ? AND target_rid = ?
         ORDER BY executed_at DESC LIMIT 1`,
      )
      .bind(tenantId, recommendationId, actionType, target)
      .first<ActionLogRow>();
    return r ? toActionLog(r) : null;
  }

  async list(
    tenantId: string,
    filter: {rid?: Rid; limit: number},
  ): Promise<ActionLogRecord[]> {
    const {results} = await this.db
      .prepare(
        `SELECT ${ACTION_COLUMNS} FROM og_action_log
         WHERE tenant_id = ?${filter.rid ? ' AND target_rid = ?' : ''}
         ORDER BY executed_at DESC, id DESC LIMIT ?`,
      )
      .bind(tenantId, ...(filter.rid ? [filter.rid] : []), filter.limit)
      .all<ActionLogRow>();
    return results.map(toActionLog);
  }

  async setWriteback(
    tenantId: string,
    id: string,
    status: WritebackStatus,
    attempts: number,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE og_action_log SET writeback_status = ?, writeback_attempts = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(status, attempts, tenantId, id)
      .run();
  }

  async pendingWritebacks(
    maxAttempts: number,
    limit: number,
  ): Promise<ActionLogRecord[]> {
    // System maintenance scan across tenants (cron only).
    const {results} = await this.db
      .prepare(
        `SELECT ${ACTION_COLUMNS} FROM og_action_log
         WHERE writeback_status = 'WRITEBACK_PENDING' AND writeback_attempts < ?
         ORDER BY executed_at LIMIT ?`,
      )
      .bind(maxAttempts, limit)
      .all<ActionLogRow>();
    return results.map(toActionLog);
  }
}

interface SuggestionRow {
  id: string;
  rid_a: string;
  rid_b: string;
  title_a: string | null;
  title_b: string | null;
  score: number;
  status: MergeSuggestionDto['status'];
  created_at: number;
}

function toSuggestion(r: SuggestionRow): MergeSuggestionDto {
  return {
    id: r.id,
    ridA: r.rid_a as Rid,
    ridB: r.rid_b as Rid,
    titleA: r.title_a ?? '',
    titleB: r.title_b ?? '',
    score: Number(r.score),
    status: r.status,
    createdAt: new Date(Number(r.created_at)).toISOString(),
  };
}

const SUGGESTION_SELECT = `SELECT s.id, s.rid_a, s.rid_b, a.title AS title_a, b.title AS title_b,
    s.score, s.status, s.created_at
  FROM og_merge_suggestion s
  LEFT JOIN og_object a ON a.rid = s.rid_a AND a.tenant_id = s.tenant_id
  LEFT JOIN og_object b ON b.rid = s.rid_b AND b.tenant_id = s.tenant_id`;

/** og_merge_suggestion access. */
export class D1MergeSuggestionRepository implements MergeSuggestionRepository {
  constructor(private readonly db: D1Database) {}

  async list(tenantId: string, limit: number): Promise<MergeSuggestionDto[]> {
    const {results} = await this.db
      .prepare(
        `${SUGGESTION_SELECT} WHERE s.tenant_id = ?
         ORDER BY (s.status = 'OPEN') DESC, s.created_at DESC, s.id DESC LIMIT ?`,
      )
      .bind(tenantId, limit)
      .all<SuggestionRow>();
    return results.map(toSuggestion);
  }

  async get(tenantId: string, id: string): Promise<MergeSuggestionDto | null> {
    const r = await this.db
      .prepare(`${SUGGESTION_SELECT} WHERE s.tenant_id = ? AND s.id = ?`)
      .bind(tenantId, id)
      .first<SuggestionRow>();
    return r ? toSuggestion(r) : null;
  }
}

interface ObjectSetRow {
  id: string;
  name: string;
  definition: string;
  created_by: string;
  updated_at: number;
}

function toObjectSet(r: ObjectSetRow): ObjectSetDto {
  return {
    id: r.id,
    name: r.name,
    definition: parseJson<ObjectSetDef>(r.definition, {objectType: ''}),
    createdBy: r.created_by,
    updatedAt: new Date(Number(r.updated_at)).toISOString(),
  };
}

/** og_object_set access. */
export class D1ObjectSetRepository implements ObjectSetRepository {
  constructor(private readonly db: D1Database) {}

  async list(tenantId: string): Promise<ObjectSetDto[]> {
    const {results} = await this.db
      .prepare(
        `SELECT id, name, definition, created_by, updated_at FROM og_object_set
         WHERE tenant_id = ? ORDER BY name, id`,
      )
      .bind(tenantId)
      .all<ObjectSetRow>();
    return results.map(toObjectSet);
  }

  async get(tenantId: string, id: string): Promise<ObjectSetDto | null> {
    const r = await this.db
      .prepare(
        `SELECT id, name, definition, created_by, updated_at FROM og_object_set
         WHERE tenant_id = ? AND id = ?`,
      )
      .bind(tenantId, id)
      .first<ObjectSetRow>();
    return r ? toObjectSet(r) : null;
  }

  async save(tenantId: string, dto: ObjectSetDto): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO og_object_set (id, tenant_id, name, definition, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, definition = excluded.definition,
           updated_at = excluded.updated_at
         WHERE og_object_set.tenant_id = excluded.tenant_id`,
      )
      .bind(
        dto.id,
        tenantId,
        dto.name,
        JSON.stringify(dto.definition),
        dto.createdBy,
        Date.parse(dto.updatedAt),
      )
      .run();
  }
}

/** og_meta and og_inbox access. */
export class D1MetaRepository implements MetaRepository {
  constructor(private readonly db: D1Database) {}

  async get(tenantId: string, key: string): Promise<string | null> {
    const v = await this.db
      .prepare('SELECT value FROM og_meta WHERE tenant_id = ? AND key = ?')
      .bind(tenantId, key)
      .first<string | null>('value');
    return v ?? null;
  }

  async set(tenantId: string, key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO og_meta (tenant_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value`,
      )
      .bind(tenantId, key, value)
      .run();
  }

  async getInbox(tenantId: string, key: string): Promise<InboxRecord | null> {
    const r = await this.db
      .prepare(
        'SELECT tenant_id, result, reported_at FROM og_inbox WHERE msg_key = ? AND (tenant_id = ? OR tenant_id IS NULL)',
      )
      .bind(key, tenantId)
      .first<{
        tenant_id: string | null;
        result: string | null;
        reported_at: number | null;
      }>();
    if (!r) return null;
    return {
      tenantId: r.tenant_id ?? tenantId,
      result: parseJson<WriteResult>(r.result, {
        upserted: 0,
        merged: 0,
        skipped: 0,
        rejected: [],
      }),
      reportedAt: r.reported_at === null ? null : Number(r.reported_at),
    };
  }

  async markReported(tenantId: string, key: string, at: number): Promise<void> {
    await this.db
      .prepare(
        'UPDATE og_inbox SET reported_at = ? WHERE msg_key = ? AND tenant_id = ?',
      )
      .bind(at, key, tenantId)
      .run();
  }

  async purgeInbox(before: number): Promise<number> {
    // System maintenance across tenants (cron only).
    const r = await this.db
      .prepare('DELETE FROM og_inbox WHERE processed_at < ?')
      .bind(before)
      .run();
    return r.meta.changes ?? 0;
  }
}
