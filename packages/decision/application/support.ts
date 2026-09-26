/**
 * @fileoverview Helpers shared by handlers: authorization, DTO mapping and
 * notifications.
 */

import {
  AppError,
  hasRole,
  parseRid,
  type CallCtx,
  type Logger,
  type Rid,
  type Role,
} from '@ontodecide/shared-kernel';
import type {RecommendationSummary} from '@ontodecide/situation/contract';
import type {RecommendationDto, ScenarioDto} from '../contract';
import type {Notifier, RecommendationRecord, ScenarioRecord} from './ports';

/** Throws unless the context identifies a user of a tenant with the role. */
export function requireRole(ctx: CallCtx | undefined, role: Role): CallCtx {
  if (!ctx || !ctx.tenantId || !ctx.userId) {
    throw new AppError('AUTH_INVALID', 'Missing call context');
  }
  if (!hasRole(ctx.roles ?? [], role)) {
    throw new AppError('FORBIDDEN', `${role} role required`);
  }
  return ctx;
}

/** Throws VALIDATION_FAILED unless the rid belongs to the caller's tenant. */
export function requireTenantRid(ctx: CallCtx, rid: string): Rid {
  const parts = parseRid(rid);
  if (!parts || parts.tenantId !== ctx.tenantId) {
    throw new AppError('VALIDATION_FAILED', `Invalid rid: ${rid}`);
  }
  return rid as Rid;
}

/** Public DTO of a stored recommendation. */
export function toRecommendationDto(
  r: RecommendationRecord,
): RecommendationDto {
  const {tenantId: _t, requestedBy: _r, executedAt: _e, ...dto} = r;
  return dto;
}

/** Public DTO of a stored scenario. */
export function toScenarioDto(s: ScenarioRecord): ScenarioDto {
  const {tenantId: _t, ...dto} = s;
  return dto;
}

/** Summary pushed to the cockpit. */
export function toSummary(r: RecommendationDto): RecommendationSummary {
  const top = r.actions.find(a => a.rank === 1) ?? r.actions[0];
  return {
    id: r.id,
    status: r.status,
    summary: r.summary,
    confidence: r.confidence,
    focus: r.focus,
    ...(r.alertId ? {alertId: r.alertId} : {}),
    expectedImpact: top?.expectedImpact ?? 0,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    degraded: r.degraded,
  };
}

/** Pushes a summary; failures are logged, never thrown. */
export async function pushSummary(
  notifier: Notifier,
  logger: Logger,
  ctx: CallCtx,
  r: RecommendationDto,
): Promise<void> {
  try {
    await notifier.pushRecommendation(ctx, toSummary(r));
  } catch (e) {
    logger.warn('decision.push_failed', {
      id: r.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Loads a recommendation of the caller's tenant or throws NOT_FOUND. */
export async function loadRecommendation(
  repo: {get(t: string, id: string): Promise<RecommendationRecord | null>},
  ctx: CallCtx,
  id: string,
): Promise<RecommendationRecord> {
  const rec = typeof id === 'string' ? await repo.get(ctx.tenantId, id) : null;
  if (!rec) throw new AppError('NOT_FOUND', `Recommendation ${id} not found`);
  return rec;
}
