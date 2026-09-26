/**
 * @fileoverview Recommendation use cases: list, get, approve (execute via
 * signed voucher), reject and feedback.
 */

import {
  AppError,
  clampLimit,
  parseOrThrow,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import {signVoucher} from '@ontodecide/object-graph/contract';
import {
  feedbackInputSchema,
  rejectInputSchema,
  type RecStatus,
  type RecommendationDto,
  type RecommendedAction,
} from '../contract';
import {isExpired, transition} from '../domain';
import type {DecisionDeps} from './deps';
import type {RecommendationRecord} from './ports';
import {loadRecommendation, pushSummary, toRecommendationDto} from './support';

const STATUSES: RecStatus[] = [
  'Draft',
  'Proposed',
  'Approved',
  'Rejected',
  'Expired',
  'Executed',
  'ExecFailed',
  'Evaluated',
  'Failed',
];

/** Lists recommendations of the tenant. */
export class ListRecommendations {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(
    ctx: CallCtx,
    filter: {status?: RecStatus; focus?: Rid; limit?: number} = {},
  ): Promise<RecommendationDto[]> {
    if (filter.status && !STATUSES.includes(filter.status)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Unknown status: ${filter.status}`,
      );
    }
    const rows = await this.deps.recommendations.list(ctx.tenantId, {
      ...(filter.status ? {status: filter.status} : {}),
      ...(filter.focus ? {focus: filter.focus} : {}),
      limit: clampLimit(filter.limit),
    });
    return rows.map(toRecommendationDto);
  }
}

/** Gets one recommendation. */
export class GetRecommendation {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx, id: string): Promise<RecommendationDto> {
    return toRecommendationDto(
      await loadRecommendation(this.deps.recommendations, ctx, id),
    );
  }
}

/**
 * Approves a Proposed, unexpired recommendation and executes its rank-1
 * action(s) through object-graph with a signed approval voucher.
 */
export class ApproveRecommendation {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx, id: string): Promise<RecommendationDto> {
    const {recommendations: repo, clock, config} = this.deps;
    const rec = await loadRecommendation(repo, ctx, id);
    const now = clock.now();
    if (rec.status !== 'Proposed') transition(rec.status, 'Approved');
    if (isExpired(rec, now)) {
      throw new AppError('INVALID_TRANSITION', 'Recommendation has expired');
    }
    const toRun = rec.actions.filter(a => a.rank === 1);
    if (toRun.length === 0) {
      throw new AppError(
        'INVALID_TRANSITION',
        'Recommendation has no action to execute',
      );
    }
    const approved: RecommendationRecord = {
      ...rec,
      status: transition(rec.status, 'Approved'),
      approvedBy: ctx.userId,
      decidedAt: now.toISOString(),
    };
    if (!(await repo.update(approved, 'Proposed'))) {
      throw new AppError(
        'INVALID_TRANSITION',
        'Recommendation changed concurrently',
      );
    }
    const expiresAt = new Date(
      now.getTime() + config.voucherTtlMs,
    ).toISOString();
    const actions: RecommendedAction[] = [];
    for (const a of approved.actions) {
      if (a.rank !== 1) {
        actions.push(a);
        continue;
      }
      try {
        const approval = await signVoucher(config.approvalSecret, {
          recommendationId: rec.id,
          tenantId: ctx.tenantId,
          actionType: a.actionType,
          target: a.target,
          expiresAt,
        });
        const res = await this.deps.graph.applyAction(ctx, {
          actionType: a.actionType,
          target: a.target,
          params: a.params,
          recommendationId: rec.id,
          approval,
        });
        actions.push({
          ...a,
          execution: {status: 'Executed', actionLogId: res.actionLogId},
        });
      } catch (e) {
        const err = AppError.from(e);
        this.deps.logger.warn('decision.apply_failed', {
          id: rec.id,
          code: err.code,
        });
        actions.push({
          ...a,
          execution: {
            status: 'Failed',
            error: `${err.code}${err.detail ? `: ${err.detail}` : ''}`,
          },
        });
      }
    }
    const ok = actions.every(
      a => a.rank !== 1 || a.execution?.status === 'Executed',
    );
    const done = clock.now().toISOString();
    const final: RecommendationRecord = {
      ...approved,
      actions,
      status: transition('Approved', ok ? 'Executed' : 'ExecFailed'),
      ...(ok ? {executedAt: done} : {}),
    };
    await repo.update(final, 'Approved');
    await pushSummary(this.deps.notifier, this.deps.logger, ctx, final);
    return toRecommendationDto(final);
  }
}

/** Rejects a Proposed recommendation with a reason. */
export class RejectRecommendation {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(
    ctx: CallCtx,
    id: string,
    reason: string,
  ): Promise<RecommendationDto> {
    const input = parseOrThrow(rejectInputSchema, {reason});
    const rec = await loadRecommendation(this.deps.recommendations, ctx, id);
    const next: RecommendationRecord = {
      ...rec,
      status: transition(rec.status, 'Rejected'),
      approvedBy: ctx.userId,
      decidedAt: this.deps.clock.now().toISOString(),
      rejectReason: input.reason,
    };
    if (!(await this.deps.recommendations.update(next, rec.status))) {
      throw new AppError(
        'INVALID_TRANSITION',
        'Recommendation changed concurrently',
      );
    }
    await pushSummary(this.deps.notifier, this.deps.logger, ctx, next);
    return toRecommendationDto(next);
  }
}

/** Stores a 1–5 rating (any status). */
export class SubmitFeedback {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(
    ctx: CallCtx,
    id: string,
    input: {rating: number; comment?: string},
  ): Promise<RecommendationDto> {
    const fb = parseOrThrow(feedbackInputSchema, input);
    for (let attempt = 0; attempt < 3; attempt++) {
      const rec = await loadRecommendation(this.deps.recommendations, ctx, id);
      const next: RecommendationRecord = {
        ...rec,
        feedback: {
          rating: fb.rating,
          ...(fb.comment ? {comment: fb.comment} : {}),
        },
      };
      if (await this.deps.recommendations.update(next, rec.status)) {
        return toRecommendationDto(next);
      }
    }
    throw new AppError('CONFLICT', 'Recommendation changed concurrently');
  }
}
