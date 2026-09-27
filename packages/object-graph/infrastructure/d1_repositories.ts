/**
 * @fileoverview Remaining workspace-scoped D1 repositories (action log,
 * outbox cleanup) and the factory assembling every repository of one
 * workspace.
 */

import {TenantRepository} from '@ontodecide/shared-kernel/d1';
import type {Rid} from '@ontodecide/shared-kernel';
import type {
  ActionLogReader,
  OutboxStore,
  TenantRepos,
} from '../application/ports';
import type {ActionLogDto, ActionResult} from '../contract/types';
import {D1ObjectReader} from './d1_object_reader';
import {D1ObjectWriter} from './d1_object_writer';
import {D1GraphTraversal} from './d1_traversal';
import {toActionLogDto} from './rows';
import type {ActionLogDbRow} from './rows';

/** Workspace-scoped action log reads. */
export class D1ActionLogReader
  extends TenantRepository
  implements ActionLogReader
{
  async findByKey(key: string): Promise<{
    actionType: string;
    targetRid: string;
    result: Omit<ActionResult, 'replayed'>;
  } | null> {
    const r = await this.stmt(
      `SELECT action_type, target_rid, result FROM og_action_log
       WHERE tenant_id = ?1 AND idempotency_key = ?2`,
      key,
    ).first<{action_type: string; target_rid: string; result: string}>();
    if (!r) return null;
    return {
      actionType: r.action_type,
      targetRid: r.target_rid,
      result: JSON.parse(r.result) as Omit<ActionResult, 'replayed'>,
    };
  }

  async listForTarget(
    rid: Rid,
    after: {at: number; id: string} | null,
    limit: number,
  ): Promise<ActionLogDto[]> {
    const cols =
      'id, action_type, target_rid, params, before, after, actor, ' +
      'actor_user_id, recommendation_id, executed_at';
    const stmt = after
      ? this.stmt(
          `SELECT ${cols} FROM og_action_log
           WHERE tenant_id = ?1 AND target_rid = ?2
             AND (executed_at < ?3 OR (executed_at = ?3 AND id < ?4))
           ORDER BY executed_at DESC, id DESC LIMIT ?5`,
          rid,
          after.at,
          after.id,
          limit,
        )
      : this.stmt(
          `SELECT ${cols} FROM og_action_log
           WHERE tenant_id = ?1 AND target_rid = ?2
           ORDER BY executed_at DESC, id DESC LIMIT ?3`,
          rid,
          limit,
        );
    const {results} = await stmt.all<ActionLogDbRow>();
    return results.map(toActionLogDto);
  }
}

/** Deletes delivered outbox rows of one workspace. */
export class D1OutboxStore extends TenantRepository implements OutboxStore {
  async delete(id: string): Promise<void> {
    await this.stmt(
      'DELETE FROM domain_event WHERE tenant_id = ?1 AND id = ?2',
      id,
    ).run();
  }
}

/** Builds every repository of one workspace. */
export function createTenantRepos(db: D1Database, tid: string): TenantRepos {
  return {
    reader: new D1ObjectReader(db, tid),
    writer: new D1ObjectWriter(db, tid),
    traversal: new D1GraphTraversal(db, tid),
    actions: new D1ActionLogReader(db, tid),
    outbox: new D1OutboxStore(db, tid),
  };
}
