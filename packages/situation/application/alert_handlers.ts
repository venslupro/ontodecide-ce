/**
 * @fileoverview Alert use cases: list and acknowledge / close.
 */

import {AppError, type CallCtx, clampLimit} from '@ontodecide/shared-kernel';
import type {AlertDto, AlertFilter} from '../contract';
import {canTransition} from '../domain';
import type {SituationDeps} from './deps';
import {publish, requireRole} from './support';

/** Lists alerts (Viewer). */
export class ListAlerts {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, filter: AlertFilter = {}): Promise<AlertDto[]> {
    requireRole(ctx, 'Viewer');
    return this.deps.repos.alerts.list(ctx.tenantId, {
      ...filter,
      limit: clampLimit(filter.limit),
    });
  }
}

/** Acknowledges or closes an alert (Operator). */
export class UpdateAlert {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    ctx: CallCtx,
    id: string,
    patch: {status: 'ACKED' | 'CLOSED'},
  ): Promise<AlertDto> {
    requireRole(ctx, 'Operator');
    const status = patch?.status;
    if (status !== 'ACKED' && status !== 'CLOSED') {
      throw new AppError('VALIDATION_FAILED', 'status must be ACKED or CLOSED');
    }
    const {alerts} = this.deps.repos;
    const current = await alerts.get(ctx.tenantId, id);
    if (!current) throw new AppError('NOT_FOUND', 'Alert not found');
    if (!canTransition(current.status, status)) {
      throw new AppError(
        'INVALID_TRANSITION',
        `${current.status} → ${status} is not allowed`,
      );
    }
    if (current.status !== status) {
      await alerts.setStatus(
        ctx.tenantId,
        id,
        status,
        status === 'ACKED'
          ? {ackedBy: ctx.userId}
          : {closedAt: this.deps.clock.now().getTime()},
      );
    }
    const dto = (await alerts.get(ctx.tenantId, id))!;
    await publish(this.deps, ctx.tenantId, 'alert', dto);
    return dto;
  }
}
