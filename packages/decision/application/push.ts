/**
 * @fileoverview Best-effort push of a recommendation summary to the
 * cockpit (SituationRpc.pushRecommendation). Failures are logged only.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import type {RecommendationDto} from '../contract';
import {toSummary} from '../domain';
import type {DecisionDeps} from './ports';

/** Pushes the summary; never throws. */
export async function pushSummary(
  deps: Pick<DecisionDeps, 'situation' | 'logger'>,
  ctx: CallCtx,
  dto: RecommendationDto,
): Promise<void> {
  try {
    await deps.situation.pushRecommendation(ctx, toSummary(dto));
  } catch (e) {
    deps.logger.warn('push_recommendation_failed', {
      tid: ctx.tid,
      code: AppError.from(e).code,
    });
  }
}
