/**
 * @fileoverview ListActionLog: audit entries, newest first.
 */

import {clampLimit} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import type {ActionLogDto} from '../contract';
import {filterByMarkings} from '../domain';
import type {AppDeps} from './ports';
import {requireRole, ridInTenant} from './support';

/** Use case: list executed actions (optionally for one object). */
export class ListActionLog {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    filter: {rid?: Rid; limit?: number} = {},
  ): Promise<ActionLogDto[]> {
    requireRole(ctx, 'Viewer');
    if (filter.rid && !ridInTenant(ctx, filter.rid)) return [];
    const model = await this.d.models.get(ctx);
    const rows = await this.d.actionLogs.list(ctx.tenantId, {
      rid: filter.rid,
      limit: clampLimit(filter.limit),
    });
    return rows.map(r => {
      const type =
        model.objectTypes[model.actionTypes[r.actionType]?.targetType ?? ''];
      return {
        id: r.id,
        actionType: r.actionType,
        targetRid: r.targetRid,
        params: r.params,
        before: filterByMarkings(ctx, type, r.before).props,
        after: filterByMarkings(ctx, type, r.after).props,
        actor: r.actor,
        ...(r.recommendationId ? {recommendationId: r.recommendationId} : {}),
        writebackStatus: r.writebackStatus,
        executedAt: r.executedAt,
      };
    });
  }
}
