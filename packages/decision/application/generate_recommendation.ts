/**
 * @fileoverview Queues recommendation generation: inserts a Draft and
 * sends a decision-jobs message; the consumer does the work.
 */

import {
  AppError,
  HOUR_MS,
  parseOrThrow,
  ulid,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import type {DecisionJobMsg} from '@ontodecide/situation/contract';
import {DECISION_LIMITS, generateRecommendationInputSchema} from '../contract';
import {normalizeLocale} from '../domain';
import type {DecisionDeps} from './deps';
import type {RecommendationRecord} from './ports';
import {requireTenantRid} from './support';

/** Builds a Draft recommendation row. */
export function newDraft(
  deps: Pick<DecisionDeps, 'config'>,
  input: {
    id: string;
    tenantId: string;
    focus: Rid;
    alertId?: string;
    scenarioId?: string;
    locale?: string;
    requestedBy?: string;
    now: Date;
  },
): RecommendationRecord {
  const hours = Math.min(
    Math.max(
      1,
      deps.config.recExpireHours || DECISION_LIMITS.recExpireHoursDefault,
    ),
    DECISION_LIMITS.recExpireHoursMax,
  );
  return {
    id: input.id,
    tenantId: input.tenantId,
    status: 'Draft',
    focus: input.focus,
    ...(input.alertId ? {alertId: input.alertId} : {}),
    ...(input.scenarioId ? {scenarioId: input.scenarioId} : {}),
    summary: '',
    rationale: '',
    actions: [],
    evidence: [],
    risks: [],
    confidence: 0,
    model: '',
    degraded: false,
    locale: normalizeLocale(input.locale),
    ...(input.requestedBy ? {requestedBy: input.requestedBy} : {}),
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + hours * HOUR_MS).toISOString(),
  };
}

/** Queues a recommendation job; returns the recommendation id as jobId. */
export class GenerateRecommendation {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(
    ctx: CallCtx,
    req: {alertId?: string; scenarioId?: string; focus: Rid; locale?: string},
  ): Promise<{jobId: string}> {
    const input = parseOrThrow(generateRecommendationInputSchema, req);
    const focus = requireTenantRid(ctx, input.focus);
    if (input.scenarioId) {
      const s = await this.deps.scenarios.get(ctx.tenantId, input.scenarioId);
      if (!s)
        throw new AppError(
          'NOT_FOUND',
          `Scenario ${input.scenarioId} not found`,
        );
    }
    const now = this.deps.clock.now();
    const id = ulid(now.getTime());
    const locale = normalizeLocale(input.locale ?? ctx.locale);
    await this.deps.recommendations.insert(
      newDraft(this.deps, {
        id,
        tenantId: ctx.tenantId,
        focus,
        alertId: input.alertId,
        scenarioId: input.scenarioId,
        locale,
        requestedBy: ctx.userId,
        now,
      }),
    );
    const msg: DecisionJobMsg = {
      ctx,
      jobId: id,
      focus,
      locale,
      ...(input.alertId ? {alertId: input.alertId} : {}),
      ...(input.scenarioId ? {scenarioId: input.scenarioId} : {}),
    };
    await this.deps.jobs.send(msg);
    return {jobId: id};
  }
}
