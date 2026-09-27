/**
 * @fileoverview Recommendation use cases: list / get (expiry evaluated and
 * persisted on read), decide (confirm → execute ranking[0] as
 * svc:decision-engine, or reject) and the personal AI quota.
 */

import {
  AppError,
  isIdempotencyKey,
  parseOrThrow,
  serviceCtx,
  utcDay,
  type CallCtx,
  type PageRequest,
  type PageResult,
  type QuotaItem,
} from '@ontodecide/shared-kernel';
import {
  DECISION_LIMITS,
  decisionInputSchema,
  type DecisionInput,
  type ExecutionRecord,
  type RecStatus,
  type RecommendationDto,
} from '../contract';
import {
  bestCandidate,
  canRetryExecution,
  decidedByRole,
  isDue,
  toDto,
  type RecRecord,
} from '../domain';
import {userScope} from './ai_ranker';
import type {DecisionDeps} from './ports';
import {pushSummary} from './push';

const STATUSES: readonly RecStatus[] = [
  'Proposed',
  'Confirmed',
  'Rejected',
  'Expired',
  'Executed',
  'ExecFailed',
];

/** Worker name used as the service principal of executions. */
export const EXECUTOR = 'decision-engine';

/** GET /recommendations. */
export class ListRecommendations {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(
    ctx: CallCtx,
    q: {status?: RecStatus},
    page: PageRequest,
  ): Promise<PageResult<RecommendationDto>> {
    if (q?.status !== undefined && !STATUSES.includes(q.status)) {
      throw new AppError('VALIDATION_FAILED', `Unknown status ${q.status}`);
    }
    const repo = this.deps.recommendations(ctx.tid);
    await repo.expireDue(this.deps.clock.now().getTime());
    const res = await repo.list(
      q?.status ? {status: q.status} : {},
      page ?? {},
    );
    return {items: res.items.map(toDto), nextCursor: res.nextCursor};
  }
}

/** GET /recommendations/{id}. */
export class GetRecommendation {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx, id: string): Promise<RecommendationDto> {
    const repo = this.deps.recommendations(ctx.tid);
    await repo.expireDue(this.deps.clock.now().getTime(), String(id));
    const rec = await repo.get(String(id));
    if (!rec) throw new AppError('NOT_FOUND', `Recommendation ${id} not found`);
    return toDto(rec);
  }
}

/** POST /recommendations/{id}/decision. */
export class Decide {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(
    ctx: CallCtx,
    id: string,
    raw: DecisionInput,
    key: string,
  ): Promise<RecommendationDto> {
    if (!isIdempotencyKey(key)) {
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
    }
    const input = parseOrThrow(decisionInputSchema, raw);
    const decidedBy = decidedByRole(ctx);
    const repo = this.deps.recommendations(ctx.tid);
    const now = this.deps.clock.now();
    const rec = await repo.get(String(id));
    if (!rec) throw new AppError('NOT_FOUND', `Recommendation ${id} not found`);
    if (rec.decisionKey === key) return this.replay(ctx, rec, key);
    if (rec.decisionKey) {
      throw new AppError('CONFLICT', 'Recommendation already decided');
    }
    if (isDue(rec, now)) {
      await repo.expireDue(now.getTime(), rec.id);
      throw new AppError('CONFLICT', 'Recommendation expired');
    }
    if (rec.status !== 'Proposed') {
      throw new AppError('CONFLICT', `Recommendation is ${rec.status}`);
    }
    const claimed = await repo.claimDecision(
      rec.id,
      {
        status: input.decision === 'confirm' ? 'Confirmed' : 'Rejected',
        key,
        decidedBy,
        decidedAtMs: now.getTime(),
        ...(input.decision === 'reject' ? {rejectReason: input.reason} : {}),
      },
      now.getTime(),
    );
    if (!claimed) {
      const current = await repo.get(rec.id);
      if (current?.decisionKey === key) return this.replay(ctx, current, key);
      throw new AppError('CONFLICT', 'Recommendation already decided');
    }
    if (input.decision === 'reject') {
      const done = toDto((await repo.get(rec.id))!);
      await pushSummary(this.deps, ctx, done);
      return done;
    }
    return this.run(ctx, rec.id, key);
  }

  /** Same key: the stored result, or a bounded re-execution after failure. */
  private async replay(
    ctx: CallCtx,
    rec: RecRecord,
    key: string,
  ): Promise<RecommendationDto> {
    const stalled = rec.status === 'Confirmed' && rec.execAttempts === 0;
    if (canRetryExecution(rec) || stalled) return this.run(ctx, rec.id, key);
    return toDto(rec);
  }

  /** Executes ranking[0] once (attempts ≤ 3) and records the outcome. */
  private async run(
    ctx: CallCtx,
    id: string,
    key: string,
  ): Promise<RecommendationDto> {
    const repo = this.deps.recommendations(ctx.tid);
    const started = await repo.beginExecution(
      id,
      key,
      DECISION_LIMITS.execAttemptsMax,
    );
    const rec = (await repo.get(id))!;
    if (!started) return toDto(rec);
    const cand = bestCandidate(rec);
    let entry: ExecutionRecord;
    if (!cand) {
      entry = {
        candidateId: rec.ranking[0] ?? '',
        status: 'Failed',
        error: 'NO_CANDIDATE',
      };
    } else {
      try {
        const res = await this.deps.objects.applyAction(
          serviceCtx(ctx.tid, EXECUTOR, ctx.requestId, ctx.locale),
          {
            actionType: cand.actionType,
            target: cand.target,
            params: cand.params,
            idempotencyKey: `${key}:0`,
            recommendationId: rec.id,
          },
        );
        entry = {
          candidateId: cand.id,
          status: 'Executed',
          actionLogId: res.actionLogId,
        };
      } catch (e) {
        const err = AppError.from(e);
        entry = {
          candidateId: cand.id,
          status: 'Failed',
          error: `${err.code}${err.detail ? `: ${err.detail}` : ''}`.slice(
            0,
            300,
          ),
        };
      }
    }
    await repo.finishExecution(
      id,
      entry.status === 'Executed' ? 'Executed' : 'ExecFailed',
      [...(rec.execution ?? []), entry],
    );
    const done = toDto((await repo.get(id))!);
    await pushSummary(this.deps, ctx, done);
    return done;
  }
}

/** Personal quota of AI recommendations (GET /me). */
export class RecommendationUsage {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx): Promise<QuotaItem[]> {
    const used = await this.deps.usage.read(
      utcDay(this.deps.clock.now()),
      userScope(ctx),
      'rec_ai',
    );
    const limit = this.deps.config.recAiUserDailyLimit;
    return [{key: 'aiRecsToday', used: Math.min(used, limit), limit}];
  }
}
