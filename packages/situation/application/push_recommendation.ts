/**
 * @fileoverview Receives recommendation summaries from decision-engine.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import type {RecommendationSummary} from '../contract';
import type {SituationDeps} from './deps';
import {publish, requireRole} from './support';

/**
 * Stores the summary, links it to its alert and pushes a `recommendation`
 * message (Operator; decision-engine calls with a system context).
 */
export class PushRecommendation {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, dto: RecommendationSummary): Promise<void> {
    requireRole(ctx, 'Operator');
    if (!dto || typeof dto.id !== 'string' || typeof dto.status !== 'string') {
      throw new AppError('VALIDATION_FAILED', 'id and status are required');
    }
    const {repos, clock} = this.deps;
    await repos.recommendations.upsert(
      ctx.tenantId,
      dto,
      clock.now().getTime(),
    );
    if (dto.alertId) {
      const linked = await repos.alerts.linkRecommendation(
        ctx.tenantId,
        dto.alertId,
        dto.id,
      );
      if (!linked) {
        this.deps.logger.warn('recommendation alert not found', {
          tenantId: ctx.tenantId,
          alertId: dto.alertId,
        });
      }
    }
    await publish(this.deps, ctx.tenantId, 'recommendation', dto);
  }
}
